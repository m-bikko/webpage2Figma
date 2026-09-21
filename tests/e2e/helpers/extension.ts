import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Worker } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
export const extensionRoot = resolve(here, '../../../packages/extension')

/** Поднимает браузер с загруженным расширением.
 *
 *  `--headless=new` ОБЯЗАТЕЛЕН. Измерено: в обычном headless расширение
 *  не загружается вовсе, service worker не появляется, и тест падает
 *  таймаутом ожидания события — из которого причина не видна никак.
 *  Поэтому флаг стоит здесь, в одном месте, с этим комментарием.
 *
 *  `headless: false` при этом тоже обязателен: Playwright, увидев
 *  `true`, добавит СВОЙ флаг headless и перебьёт наш. Комбинация
 *  выглядит противоречиво и таковой не является. */
export const launchWithExtension = async (): Promise<{
  context: BrowserContext
  worker: Worker
}> => {
  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'h2d-ext-')),
    {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
      ],
    },
  )
  const worker = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
  return { context, worker }
}
