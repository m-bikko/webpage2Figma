/**
 * Картинки для листингов: обложка Figma Community и скриншот для
 * Chrome Web Store.
 *
 *   node scripts/make-store-assets.mjs   → release/assets/
 *
 * Обложка Figma обязана быть 1920×960, скриншот магазина Chrome —
 * 1280×800 (магазин принимает и 640×400, но тогда мылит). Обе
 * собираются из НАСТОЯЩИХ частей: окно расширения на скриншоте — это
 * живой popup, снятый в Chromium с загруженным расширением, а не
 * нарисованный макет; иконка — та же, что в манифесте. Рисовать
 * «как будет выглядеть» нельзя: листинг обещает пользователю то,
 * чего он не получит, и это как раз то, за что магазины снимают
 * расширения.
 *
 * Зачем скрипт, а не Figma/Photoshop: картинка воспроизводится с
 * любой версии одной командой, и текст на ней не расходится с
 * текстом расширения, потому что берётся из того же места.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const extensionDir = resolve(root, 'packages/extension')
const outDir = resolve(root, 'release/assets')
mkdirSync(outDir, { recursive: true })

const icon = readFileSync(resolve(extensionDir, 'icons/icon-128.png')).toString('base64')
const iconUrl = `data:image/png;base64,${icon}`

/** Живой popup: расширение загружается в Chromium так же, как в e2e. */
const capturePopup = async () => {
  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'w2f-assets-')),
    {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    },
  )
  const worker = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
  const id = new URL(worker.url()).host
  const page = await context.newPage()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 420, height: 640 })
  await page.goto(`chrome-extension://${id}/src/popup.html`)
  await page.waitForSelector('#sizes label')
  const shot = await page.locator('body').screenshot({ scale: 'device' })
  await context.close()
  return `data:image/png;base64,${shot.toString('base64')}`
}

const page = (body, width, height) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  *{margin:0;box-sizing:border-box}
  body{width:${width}px;height:${height}px;overflow:hidden;
    font-family:Inter,-apple-system,"Segoe UI",system-ui,sans-serif;
    background:#0f172a;color:#f8fafc;position:relative}
  .glow{position:absolute;inset:-20%;background:
    radial-gradient(60% 50% at 20% 30%,rgba(99,102,241,.55),transparent 70%),
    radial-gradient(50% 40% at 85% 80%,rgba(14,165,233,.35),transparent 70%)}
  .wrap{position:relative;height:100%;display:flex;align-items:center;
    padding:0 120px;gap:96px}
  .text{flex:1}
  .brand{display:flex;align-items:center;gap:20px;margin-bottom:40px}
  .brand img{width:72px;height:72px;border-radius:16px}
  .brand span{font-size:34px;font-weight:600;letter-spacing:-.01em}
  h1{font-size:64px;line-height:1.08;font-weight:700;letter-spacing:-.02em;
    margin-bottom:28px}
  p{font-size:26px;line-height:1.45;color:rgba(248,250,252,.78);max-width:720px}
  .screens{display:flex;align-items:flex-end;gap:18px}
  .screen{background:#fff;border-radius:10px;box-shadow:0 30px 60px rgba(0,0,0,.45);
    position:relative;overflow:hidden}
  .screen::before{content:"";position:absolute;left:0;right:0;top:0;height:14%;
    background:#e2e8f0}
  .screen::after{content:"";position:absolute;left:10%;right:10%;top:28%;
    height:52%;background:repeating-linear-gradient(#f1f5f9 0 14px,#fff 14px 26px)}
  .popup{border-radius:12px;box-shadow:0 30px 60px rgba(0,0,0,.45);
    background:#fff;overflow:hidden}
  .popup img{display:block;width:420px}
</style></head><body><div class="glow"></div>${body}</body></html>`

const cover = page(`
  <div class="wrap">
    <div class="text">
      <div class="brand"><img src="${iconUrl}"><span>webpage2figma</span></div>
      <h1>Открытая страница —<br>в слои Figma</h1>
      <p>Расширение снимает вкладку в том состоянии, в каком вы её видите,
         в пяти брейкпоинтах. Плагин собирает из снимка настоящие фреймы,
         тексты и auto-layout — и показывает отчёт о том, что не перенеслось.</p>
    </div>
    <div class="screens">
      <div class="screen" style="width:300px;height:420px"></div>
      <div class="screen" style="width:190px;height:320px"></div>
      <div class="screen" style="width:110px;height:230px"></div>
    </div>
  </div>`, 1920, 960)

const browser = await chromium.launch()
const render = async (html, width, height, file) => {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await tab.setContent(html)
  await tab.evaluate(() => document.fonts.ready)
  writeFileSync(resolve(outDir, file), await tab.screenshot({ type: 'png' }))
  await tab.close()
  console.log(`✓ release/assets/${file}  ${width}×${height}`)
}

await render(cover, 1920, 960, 'figma-cover-1920x960.png')

const popupUrl = await capturePopup()
const screenshot = page(`
  <div class="wrap" style="padding:0 96px;gap:72px">
    <div class="text">
      <div class="brand"><img src="${iconUrl}"><span>webpage2figma</span></div>
      <h1 style="font-size:48px">Одна кнопка —<br>пять макетов</h1>
      <p style="font-size:22px">Выберите размеры, нажмите «Снять страницу» —
         получите файл .w2f для плагина Figma. Ничего не уходит в сеть.</p>
    </div>
    <div class="popup"><img src="${popupUrl}"></div>
  </div>`, 1280, 800)
await render(screenshot, 1280, 800, 'chrome-screenshot-1280x800.png')

writeFileSync(resolve(outDir, 'figma-icon-128.png'), readFileSync(resolve(extensionDir, 'icons/icon-128.png')))
console.log('✓ release/assets/figma-icon-128.png  128×128')
await browser.close()
