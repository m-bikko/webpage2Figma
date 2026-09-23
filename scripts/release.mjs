/**
 * Сборка релизных артефактов.
 *
 *   pnpm release                — проверить версии, прогнать `pnpm test`,
 *                                 собрать zip расширения и папку плагина
 *   pnpm release --skip-tests   — то же, но только `pnpm build` вместо тестов
 *   pnpm release --set 0.2.0    — проставить версию во все четыре места
 *                                 и выйти (артефакты не собираются)
 *
 * Что получается в `release/` (папка не в git):
 *
 *   webpage2figma-extension-<v>.zip   — загружается в Chrome Web Store
 *                                       как есть
 *   webpage2figma-plugin-<v>/         — manifest.json + code.js + ui.html;
 *                                       эту папку выбирают в Figma:
 *                                       Plugins → Development →
 *                                       Import plugin from manifest
 *
 * Почему это скрипт, а не инструкция. Первая публикация делается руками
 * в двух магазинах, и на каждом обновлении те же руки собирают zip
 * заново. Ошибки здесь тихие: забытый файл в zip — расширение не
 * стартует у пользователей, и это видно только по отзывам; source map в
 * zip — лишние 600 КБ и исходники наружу; версия поднята в одном
 * манифесте из двух — магазин отвергнет или, хуже, примет старый код
 * под новым номером. Поэтому каждый шаг здесь ПРОВЕРЯЕТСЯ, а не просто
 * выполняется: набор файлов сверяется с манифестом, а не задаётся
 * списком по памяти.
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const extensionDir = resolve(root, 'packages/extension')
const pluginDir = resolve(root, 'packages/plugin')
const releaseDir = resolve(root, 'release')

const args = process.argv.slice(2)
const skipTests = args.includes('--skip-tests')
const setIndex = args.indexOf('--set')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** Версия живёт в ЧЕТЫРЁХ файлах, и все обязаны совпадать: два
 *  `package.json` (наша сборка) и манифест расширения (его читает
 *  Chrome Web Store). У манифеста плагина Figma поля версии нет —
 *  номер версии плагина ведёт сама Figma при публикации. */
const VERSIONED = [
  'package.json',
  'packages/extension/package.json',
  'packages/extension/manifest.json',
  'packages/plugin/package.json',
]

if (setIndex !== -1) {
  const next = args[setIndex + 1]
  if (next === undefined || !/^\d+\.\d+\.\d+$/.test(next)) {
    fail('--set ожидает версию вида 1.2.3 (Chrome Web Store принимает до четырёх чисел, но мы держим три)')
  }
  for (const file of VERSIONED) {
    const path = resolve(root, file)
    const json = readJson(path)
    json.version = next
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
    console.log(`  ${file}: ${next}`)
  }
  console.log(`✓ версия ${next} проставлена; закоммить и запусти pnpm release`)
  process.exit(0)
}

const versions = VERSIONED.map((file) => [file, readJson(resolve(root, file)).version])
const version = versions[0][1]
for (const [file, found] of versions) {
  if (found !== version) {
    fail(`версии разошлись: ${file} = ${found}, package.json = ${version}. Поправь через pnpm release --set <версия>`)
  }
}
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`версия «${version}» не вида 1.2.3`)
}
console.log(`версия ${version} совпадает во всех ${VERSIONED.length} файлах`)

/** Рабочее дерево обязано быть чистым: артефакт с незакоммиченными
 *  правками невоспроизводим, а номер версии в нём указывает на коммит,
 *  которого нет. */
const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
if (status.status === 0 && status.stdout.trim() !== '') {
  fail(`рабочее дерево не чистое:\n${status.stdout}закоммить или отложи правки перед релизом`)
}

const run = (command, commandArgs) => {
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} завершился с кодом ${result.status}`)
}

/** `pnpm test` включает typecheck, build, unit и e2e — то есть релиз
 *  собирается только из того, что прошло все гейты. `--skip-tests`
 *  оставлен для пересборки артефакта, когда тесты уже прошли на этом
 *  же коммите; сборку он не пропускает. */
run('pnpm', skipTests ? ['build'] : ['test'])

rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })

// ---------------------------------------------------------------- расширение

const manifest = readJson(resolve(extensionDir, 'manifest.json'))

/** Список файлов zip выводится ИЗ МАНИФЕСТА, а не пишется руками:
 *  всё, на что манифест ссылается, плюс то, на что ссылается popup. */
const extensionFiles = new Set(['manifest.json'])
extensionFiles.add(manifest.background.service_worker)
extensionFiles.add(manifest.action.default_popup)
for (const icon of Object.values(manifest.icons)) extensionFiles.add(icon)
for (const icon of Object.values(manifest.action.default_icon)) extensionFiles.add(icon)
for (const entry of manifest.web_accessible_resources) {
  for (const resource of entry.resources) extensionFiles.add(resource)
}

/** Скрипты и стили из popup.html — относительные пути от самого popup. */
const popupPath = resolve(extensionDir, manifest.action.default_popup)
const popupHtml = readFileSync(popupPath, 'utf8')
for (const match of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = match[1]
  if (/^(https?:|data:|#)/.test(ref)) fail(`popup.html ссылается наружу: ${ref}`)
  extensionFiles.add(relative(extensionDir, resolve(dirname(popupPath), ref)))
}

for (const file of extensionFiles) {
  const path = resolve(extensionDir, file)
  if (!existsSync(path)) fail(`манифест расширения ссылается на отсутствующий файл: ${file}`)
  if (file.endsWith('.map')) fail(`source map в релизе: ${file}`)
}

/** Ссылки на source map внутри бандлов тоже недопустимы: DevTools
 *  пользователей будет запрашивать файл, которого в пакете нет. Сам
 *  файл в zip не попадает, а последняя строка вычищается из копии. */
const stageDir = resolve(releaseDir, `extension-${version}`)
for (const file of extensionFiles) {
  const target = resolve(stageDir, file)
  mkdirSync(dirname(target), { recursive: true })
  if (file.endsWith('.js')) {
    const code = readFileSync(resolve(extensionDir, file), 'utf8')
      .replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n')
    writeFileSync(target, code)
  } else {
    copyFileSync(resolve(extensionDir, file), target)
  }
}

const zipName = `webpage2figma-extension-${version}.zip`
const zip = spawnSync('zip', ['-X', '-r', '-q', join('..', zipName), '.'], { cwd: stageDir, stdio: 'inherit' })
if (zip.status !== 0) fail('zip не собрался (нужен /usr/bin/zip)')

// ------------------------------------------------------------------- плагин

const pluginManifest = readJson(resolve(pluginDir, 'manifest.json'))
const pluginOut = resolve(releaseDir, `webpage2figma-plugin-${version}`)
mkdirSync(pluginOut, { recursive: true })

const mainSource = resolve(pluginDir, pluginManifest.main)
const uiSource = resolve(pluginDir, pluginManifest.ui)
if (!existsSync(mainSource)) fail(`плагин не собран: нет ${pluginManifest.main}`)
if (!existsSync(uiSource)) fail(`нет UI плагина: ${pluginManifest.ui}`)

/** Figma забирает только два файла — `main` и `ui`. Всё, что UI
 *  подключал бы извне, до пользователя не доедет, поэтому внешние
 *  ссылки в нём — отказ, а не предупреждение. */
const uiHtml = readFileSync(uiSource, 'utf8')
for (const match of uiHtml.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"/g)) {
  fail(`ui.html плагина ссылается на внешний файл: ${match[1]}`)
}

const mainCode = readFileSync(mainSource, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n')
if (/^\s*(import|export)\s/m.test(mainCode.slice(0, 2000))) {
  fail('main плагина выглядит как ES-модуль; Figma исполняет обычный скрипт (IIFE)')
}
writeFileSync(resolve(pluginOut, 'code.js'), mainCode)
copyFileSync(uiSource, resolve(pluginOut, 'ui.html'))
if (pluginManifest.documentAccess !== 'dynamic-page') {
  fail('в манифесте плагина нет documentAccess: dynamic-page — Figma требует его для новых плагинов')
}
if (pluginManifest.networkAccess?.allowedDomains === undefined) {
  fail('в манифесте плагина нет networkAccess — без него публикация отвергается')
}
writeFileSync(
  resolve(pluginOut, 'manifest.json'),
  `${JSON.stringify({ ...pluginManifest, main: 'code.js', ui: 'ui.html' }, null, 2)}\n`,
)
const placeholderId = !/^\d+$/.test(String(pluginManifest.id))
if (placeholderId) {
  console.log(
    `\n! id плагина «${pluginManifest.id}» — не выданный Figma. Для ПЕРВОЙ публикации это нормально:\n` +
    '  Figma присваивает id при публикации; после неё впиши число в packages/plugin/manifest.json,\n' +
    '  иначе следующий релиз не будет распознан как обновление того же плагина.',
  )
}

// ----------------------------------------------------------- для своих

/** Раздача БЕЗ магазинов: один архив, в котором расширение лежит
 *  папкой для «Load unpacked», плагин — папкой для «Import plugin from
 *  manifest», и инструкция для человека, который не читал этот
 *  репозиторий. Те же файлы, что уходят в магазины: отдельной
 *  «внутренней» сборки нет, иначе она разошлась бы с публичной. */
const teamDir = resolve(releaseDir, `webpage2figma-${version}-team`)
mkdirSync(teamDir, { recursive: true })
const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target)
    else copyFileSync(source, target)
  }
}
copyTree(stageDir, resolve(teamDir, 'extension'))
copyTree(pluginOut, resolve(teamDir, 'plugin'))
const install = readFileSync(resolve(root, 'docs/release/install-team.md'), 'utf8')
  .replaceAll('<v>', version)
writeFileSync(resolve(teamDir, 'INSTALL.md'), install)
const teamZip = `webpage2figma-${version}-team.zip`
const zipTeam = spawnSync('zip', ['-X', '-r', '-q', join('..', teamZip), '.'], { cwd: teamDir, stdio: 'inherit' })
if (zipTeam.status !== 0) fail('командный zip не собрался')
rmSync(teamDir, { recursive: true, force: true })
rmSync(stageDir, { recursive: true, force: true })

// -------------------------------------------------------------------- итог

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
const size = (path) => `${(statSync(path).size / 1024).toFixed(0)} КБ`
console.log(`\n✓ release/${zipName}  ${size(resolve(releaseDir, zipName))}  sha256 ${sha(resolve(releaseDir, zipName))}…`)
console.log(`  содержимое: ${[...extensionFiles].sort().join(', ')}`)
console.log(`✓ release/webpage2figma-plugin-${version}/  ${readdirSync(pluginOut).join(', ')}  code.js ${size(resolve(pluginOut, 'code.js'))}`)
console.log(`✓ release/${teamZip}  ${size(resolve(releaseDir, teamZip))}  — для своих: extension/, plugin/, INSTALL.md`)
console.log('\nДальше: docs/release/publishing.md (магазины) или отдать командный zip как есть')
