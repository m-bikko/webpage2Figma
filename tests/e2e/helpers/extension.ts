import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Worker } from '@playwright/test'
import type { Bundle, Diagnostic, FontRequirement, Screen } from '@h2d/ir'

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

/** Поверхность, которую воркер расширения ставит на `self`.
 *
 *  Объявлена здесь, а не в пакете расширения: тесты его не
 *  импортируют — воркер живёт в браузере и достижим только через
 *  `worker.evaluate`. Та же причина, по которой форма `window.__h2d`
 *  повторена в `helpers/capture.ts`.
 *
 *  Типы намеренно неширокие: это ровно то, что вызывают тесты. */
export type CapturedScreen = {
  screen: Screen
  report: Diagnostic[]
  fonts: FontRequirement[]
  assetRequests: { id: string; url: string; nodeId: string; screenId: string }[]
}

export type CapturedBundle = {
  bundle: Bundle
  bytes: Record<string, number[]>
  assets: { id: string; mimeType: string; width: number; height: number }[]
  report: Diagnostic[]
}

declare global {
  // eslint-disable-next-line no-var
  var h2d: {
    captureAt: (tabId: number, size: { name: string; width: number; height: number })
      => Promise<CapturedScreen>
    captureAll: (tabId: number) => Promise<CapturedScreen[]>
    captureBundle: (tabId: number) => Promise<CapturedBundle>
  }
}
