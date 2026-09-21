/**
 * Снимает страницу в IR и показывает, что получилось.
 *
 * Это инструмент отладки, обещанный в дизайн-документе: посмотреть, что
 * сериализатор увидел, не заходя в Figma и не имея расширения. Расширение
 * с пятью размерами и chrome.debugger — план 2; здесь один размер и
 * прямое управление через Playwright.
 *
 * Использование:
 *   node scripts/capture.mjs <url|путь> [ширина] [высота]
 *
 * Примеры:
 *   node scripts/capture.mjs fixtures/boxes/index.html
 *   node scripts/capture.mjs https://example.com 1440 900
 *
 * Что кладёт в out/:
 *   ir.json       — снятый Screen и отчёт
 *   page.png      — скриншот браузера
 *   render.svg    — тот же IR, отрендеренный обратно
 *   render.png    — скриншот рендера, для сравнения глазами
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// Берутся собранные dist, а не исходники: обычный node не разрешает .ts
// через поле exports, а собрать их всё равно нужно — это делает tsc -b
// в составе pnpm typecheck.
//
// ЛОВУШКА, найденная на живом прогоне: `tsc -b` инкрементален и доверяет
// .tsconfig.tsbuildinfo, а не факту наличия dist/. Если dist/ удалили
// (`rm -rf packages/*/dist`), но забыли удалить .tsbuildinfo рядом — а
// именно так делает рекомендованный "чистый" прогон, — tsc решит, что
// собирать нечего, и выйдет молча с кодом 0, оставив dist/ пустым. Тогда
// упавший здесь `import` раньше давал голый ERR_MODULE_NOT_FOUND без
// подсказки. Явная проверка ниже превращает это в понятное сообщение.
const irDist = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/ir/dist/index.js')
const rendererDist = resolve(
  dirname(fileURLToPath(import.meta.url)), '../packages/reference-renderer/dist/index.js',
)
const bundleDist = resolve(
  dirname(fileURLToPath(import.meta.url)), '../packages/bundle/dist/bundled.js',
)

let parseBundle, IR_VERSION, reconcileAssets, renderScreenToSvg, wrapSvgInHtml
let packBundle
try {
  ;({ parseBundle, IR_VERSION, reconcileAssets } = await import(pathToFileURL(irDist).href))
  ;({ renderScreenToSvg, wrapSvgInHtml } = await import(pathToFileURL(rendererDist).href))
  ;({ packBundle } = await import(pathToFileURL(bundleDist).href))
} catch (error) {
  console.error('Не удалось загрузить собранные @h2d/ir, @h2d/reference-renderer или @h2d/bundle.')
  console.error(`Ожидались: ${irDist}\n           ${rendererDist}\n           ${bundleDist}`)
  console.error('Собери их: pnpm typecheck && pnpm build:bundle')
  console.error(
    'Если dist/ удаляли руками без удаления *.tsbuildinfo — tsc -b мог решить, ' +
    'что пересобирать нечего. Удали packages/*/tsconfig.tsbuildinfo и повтори pnpm typecheck.',
  )
  console.error(`\n${error.message}`)
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = resolve(root, 'packages/serializer/dist/serializer.global.js')

const [, , target, widthArg, heightArg] = process.argv
if (target === undefined) {
  console.error('Укажи URL или путь к файлу. Пример:')
  console.error('  node scripts/capture.mjs fixtures/boxes/index.html')
  process.exit(1)
}

const width = Number.parseInt(widthArg ?? '1440', 10)
const height = Number.parseInt(heightArg ?? '900', 10)
/** Локальный путь внутри `fixtures/` отдаётся через HTTP по той же
 *  причине, что и в тестах: под `file://` Chrome считает документ
 *  непрозрачным источником, канва отравлена и `fetch` запрещён, поэтому
 *  изображения не читаются вовсе. Внешний URL передаётся как есть.
 *
 *  Файл ВНЕ `fixtures/` по-прежнему открывается через `file://`, и это
 *  намеренно: так ведёт себя настоящая страница с недоступными байтами,
 *  а путь отказа тоже должен быть выполним руками. */
const serveTarget = async () => {
  if (/^https?:\/\//.test(target)) return { url: target, close: async () => {} }
  const abs = resolve(root, target)
  const fixtures = resolve(root, 'fixtures')
  if (!abs.startsWith(fixtures + sep)) {
    return { url: pathToFileURL(abs).href, close: async () => {} }
  }
  const { createFixtureServer, FIXTURE_PORT } =
    await import(pathToFileURL(resolve(root, 'scripts/fixture-server.mjs')).href)
  const origin = `http://127.0.0.1:${FIXTURE_PORT}`
  /** Уже поднятый сервер переиспользуется, а не приводит к падению.
   *  Playwright держит свой на том же порту между прогонами
   *  (`reuseExistingServer`), и захват рядом с идущими тестами — не
   *  исключительная ситуация, а обычная. Падать на EADDRINUSE стеком
   *  означало бы наказывать за нормальный сценарий. */
  const alive = await fetch(origin, { method: 'HEAD' })
    .then(() => true, () => false)
  if (alive) {
    return {
      url: `${origin}${abs.slice(fixtures.length).split(sep).join('/')}`,
      close: async () => {},
    }
  }

  const server = createFixtureServer()
  await new Promise((done) => server.listen(FIXTURE_PORT, '127.0.0.1', done))
  return {
    url: `http://127.0.0.1:${FIXTURE_PORT}${abs.slice(fixtures.length).split(sep).join('/')}`,
    close: () => new Promise((done) => server.close(done)),
  }
}

const served = await serveTarget()
const url = served.url

let serializer
try {
  serializer = readFileSync(bundlePath, 'utf8')
} catch {
  console.error(`Бандл не собран: ${bundlePath}`)
  console.error('Собери его: pnpm build:serializer')
  process.exit(1)
}

const outDir = resolve(root, 'out')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })

try {
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  await page.addScriptTag({ content: serializer })
  await page.evaluate(() => { window.__h2d.beginCapture() })
  const captured = await page.evaluate(() => window.__h2d.captureScreen('s0', 'Capture'))

  const browserShot = await page.screenshot({ fullPage: true })
  const shotId = `shot-${captured.screen.id}`
  writeFileSync(resolve(outDir, 'page.png'), browserShot)

  /** Байты забираются ПОСЛЕ снимка: обход синхронен, а получение
   *  байтов асинхронно. */
  const resolved = await page.evaluate(() => window.__h2d.resolvePendingAssets())
  const images = new Map(resolved.assets.map((asset) => [asset.id, {
    dataUri: `data:${asset.mimeType};base64,${resolved.base64[asset.id] ?? ''}`,
    width: asset.width,
    height: asset.height,
  }]))
  /** Дерево приводится в согласие с доехавшим: узел, чья картинка не
   *  пришла, становится заглушкой. Иначе бандл отверг бы инвариант, а
   *  рендерер упал бы на ссылке в никуда. */
  const { screen: reconciledScreen, report: reconcileReport } =
    reconcileAssets(captured.screen, new Set(resolved.assets.map((a) => a.id)))
  const svg = renderScreenToSvg(reconciledScreen, images)
  writeFileSync(resolve(outDir, 'render.svg'), svg)
  await page.setContent(wrapSvgInHtml(svg, captured.screen.width, captured.screen.height))
  writeFileSync(resolve(outDir, 'render.png'), await page.screenshot({ fullPage: true }))

  writeFileSync(
    resolve(outDir, 'ir.json'),
    `${JSON.stringify(captured, null, 2)}\n`,
  )

  // Собираем полноценный бандл и прогоняем через валидатор: так сразу
  // видно, прошёл бы этот захват входную проверку плагина Figma.
  const bundle = {
    format: 'h2d',
    version: IR_VERSION,
    capturedAt: new Date().toISOString(),
    url,
    title: await page.title().catch(() => ''),
    userAgent: 'capture.mjs',
    /** Скриншот экрана кладётся ОБЫЧНЫМ ассетом: инвариант уже
     *  требует, чтобы `screenshotId` нашёлся среди `assets`, а
     *  упаковка пишет ассет по его собственному `path`. Отдельного
     *  механизма не нужно вовсе. */
    screens: [{ ...reconciledScreen, screenshotId: shotId }],
    assets: [...resolved.assets, {
      id: shotId,
      mimeType: 'image/png',
      width: captured.screen.width,
      height: captured.screen.height,
      path: `screenshots/${captured.screen.id}.png`,
    }],
    fonts: captured.fonts,
    tokens: { variables: [], textStyles: [], paintStyles: [] },
    /** Отчёт экрана И отчёт фазы разрешения: отказ по байтам
     *  относится к узлу, но случается уже после снимка. Потерять его
     *  здесь значило бы вернуть ровно тот молчаливый откат, ради
     *  которого писался план. */
    report: [...captured.report, ...resolved.report, ...reconcileReport],
  }
  const verdict = parseBundle(bundle)

  /** Первый артефакт, который можно отдать плагину. Пишется даже при
   *  отказе валидатора: багрепорт с непринятым бандлом полезнее, чем
   *  багрепорт без него. */
  const assetBytes = Object.fromEntries([
    ...resolved.assets.map((a) => [a.id, Buffer.from(resolved.base64[a.id] ?? '', 'base64')]),
    [shotId, browserShot],
  ])
  writeFileSync(resolve(outDir, 'bundle.h2d'), await packBundle(bundle, { assets: assetBytes }))

  const nodes = []
  const walk = (node) => { nodes.push(node); node.children.forEach(walk) }
  walk(reconciledScreen.root)

  const byKind = {}
  for (const node of nodes) byKind[node.kind] = (byKind[node.kind] ?? 0) + 1

  const byCode = {}
  for (const item of captured.report) byCode[item.code] = (byCode[item.code] ?? 0) + 1

  console.log(`\n${url}  @ ${width}×${height}`)
  console.log(`экран: ${captured.screen.width}×${captured.screen.height}, узлов: ${nodes.length}`)
  console.log(`виды узлов: ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log(`шрифты: ${captured.fonts.map((f) => `${f.family} ${f.weight}`).join(', ') || '(нет текста)'}`)

  console.log(`\nотчёт: ${captured.report.length} записей`)
  for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    const sample = captured.report.find((item) => item.code === code)
    console.log(`  ${String(count).padStart(4)} × ${code}  [${sample.level}]`)
  }
  if (captured.report.length === 0) {
    console.log('  (пусто — сериализатор не встретил ничего, чего не умеет)')
  }

  console.log(
    `\nвалидатор: ${verdict.ok ? 'бандл принят' : 'бандл ОТКЛОНЁН'}`,
  )
  if (!verdict.ok) console.log(verdict.error.split('\n').slice(0, 12).join('\n'))

  const bundleSize = statSync(resolve(outDir, 'bundle.h2d')).size
  console.log(`\nв out/: ir.json, page.png, render.svg, render.png, ` +
              `bundle.h2d (${(bundleSize / 1024).toFixed(1)} КиБ)`)
  console.log('сравни page.png и render.png — это и есть проверка точности глазами\n')
} finally {
  await browser.close()
  await served.close()
}
