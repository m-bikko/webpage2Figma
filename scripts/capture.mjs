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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
// Берутся собранные dist, а не исходники: обычный node не разрешает .ts
// через поле exports, а собрать их всё равно нужно — это делает tsc -b
// в составе pnpm typecheck.
const { parseBundle, IR_VERSION } = await import(
  pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/ir/dist/index.js')).href
)
const { renderScreenToSvg, wrapSvgInHtml } = await import(
  pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/reference-renderer/dist/index.js')).href
)

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
const url = /^https?:\/\//.test(target)
  ? target
  : pathToFileURL(resolve(root, target)).href

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
  writeFileSync(resolve(outDir, 'page.png'), browserShot)

  const svg = renderScreenToSvg(captured.screen)
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
    screens: [captured.screen],
    assets: [],
    fonts: captured.fonts,
    tokens: { variables: [], textStyles: [], paintStyles: [] },
    report: captured.report,
  }
  const verdict = parseBundle(bundle)

  const nodes = []
  const walk = (node) => { nodes.push(node); node.children.forEach(walk) }
  walk(captured.screen.root)

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

  console.log('\nв out/: ir.json, page.png, render.svg, render.png')
  console.log('сравни page.png и render.png — это и есть проверка точности глазами\n')
} finally {
  await browser.close()
}
