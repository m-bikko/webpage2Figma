import { expect, test } from '@playwright/test'
import { launchWithExtension } from './helpers/extension.js'

/** Расширение проверяется ЦЕЛИКОМ, а не по частям.
 *
 *  Это возможно потому, что Playwright поднимает MV3-расширение в новом
 *  headless — измерено до написания плана. Половина, которую нельзя
 *  проверить, в проекте уже есть (плагин Figma), и второй такой быть не
 *  должно: расширение держится общего стандарта. */

test('расширение поднимается и видит свои разрешения', async () => {
  const { context, worker } = await launchWithExtension()
  try {
    const granted = await worker.evaluate(() => ({
      debug: typeof chrome.debugger?.attach === 'function',
      scripting: typeof chrome.scripting?.executeScript === 'function',
      downloads: typeof chrome.downloads?.download === 'function',
    }))
    expect(granted).toEqual({ debug: true, scripting: true, downloads: true })
  } finally {
    await context.close()
  }
})
