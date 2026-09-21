import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import type { Diagnostic, FontRequirement, Screen } from '@h2d/ir'

/** То же, что отдаёт сериализатор. Объявлено здесь, потому что тесты
 *  не импортируют сам сериализатор: он читается с диска как текст. */
export type CaptureResult = {
  screen: Screen
  report: Diagnostic[]
  fonts: FontRequirement[]
  assetRequests: AssetRequest[]
}

/** Повтор формы из сериализатора, а не импорт: тесты читают его бандл
 *  как текст и не импортируют пакет. Та же причина, что у блока
 *  `declare global` ниже. */
export type AssetRequest = {
  id: string
  url: string
  naturalWidth: number
  naturalHeight: number
  nodeId: string
}

/** Поверхность, которую бандл ставит на `window` внутри страницы.
 *  Объявление обязано жить здесь: `declare global` из `src/global.ts`
 *  сериализатора в область типов тестов не попадает — тесты его не
 *  импортируют. Без этого блока колбэк `page.evaluate` не типизируется
 *  и `pnpm typecheck:root` падает на `window.__h2d`. */
declare global {
  interface Window {
    __h2d: {
      beginCapture: () => void
      captureScreen: (id: string, name: string) => CaptureResult
    }
  }
}

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')

const bundlePath = resolve(
  repoRoot,
  'packages/serializer/dist/serializer.global.js',
)

export const SIZES = [
  { name: 'Desktop XL', width: 1920, height: 1080 },
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Tablet L', width: 1024, height: 1366 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
] as const

/** Фикстуры отдаются по HTTP, а не `file://`. Причина — в
 *  `scripts/fixture-server.mjs`: под `file://` Chrome считает документ
 *  непрозрачным источником, канва отравлена и `fetch` запрещён, поэтому
 *  успешный путь работы с ассетами не выполняется ни разу. */
export const FIXTURE_ORIGIN = 'http://127.0.0.1:4317'

export const fixtureUrl = (name: string): string =>
  `${FIXTURE_ORIGIN}/${name}/index.html`

/** Инжектит собранный сериализатор и вызывает его внутри страницы.
 *
 *  Бандл читается с диска каждый раз, чтобы тест всегда проверял свежую
 *  сборку, а не закешированную.
 *
 *  Аллокатор идентификаторов живёт внутри страницы и передаётся через
 *  `beginCapture`, а не аргументом: функции не пересекают границу
 *  `page.evaluate`, поэтому внешний API принимает только строки.
 *  `beginCapture` вызывается здесь на каждый снимок, потому что каждый
 *  тест снимает один экран; серию из пяти экранов с общей нумерацией
 *  собирает extension в плане 2. */
export type CaptureOptions = {
  /** Сбрасывать нумерацию узлов. По умолчанию да: каждый тест снимает один
   *  экран. Для серии из нескольких экранов с общей нумерацией — которую
   *  требует инвариант уникальности идентификаторов в пределах бандла —
   *  вызывающий передаёт `true` только на первом снимке. */
  beginCapture?: boolean
}

export const captureScreen = async (
  page: Page,
  screenId: string,
  screenName: string,
  options: CaptureOptions = {},
): Promise<CaptureResult> => {
  /** Повторный впрыск заново исполняет IIFE и СБРАСЫВАЕТ аллокатор
   *  идентификаторов, из-за чего они сталкиваются между экранами одного
   *  бандла. Расширение впрыскивает скрипт один раз на вкладку и
   *  переживает ресайзы, поэтому хелпер обязан вести себя так же. */
  const alreadyInjected = await page.evaluate(
    () => typeof window.__h2d !== 'undefined',
  )
  if (!alreadyInjected) {
    const source = readFileSync(bundlePath, 'utf8')
    await page.addScriptTag({ content: source })
  }
  await page.evaluate(() => document.fonts.ready)
  if (options.beginCapture ?? true) {
    await page.evaluate(() => { window.__h2d.beginCapture() })
  }
  return page.evaluate(
    ([id, name]) => window.__h2d.captureScreen(id ?? '', name ?? ''),
    [screenId, screenName],
  )
}
