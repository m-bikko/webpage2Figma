import { IR_VERSION } from '@h2d/ir/version'
import { reconcileAssets } from '@h2d/ir'
import type { Bundle, Diagnostic, FontRequirement, Screen } from '@h2d/ir'
import { BREAKPOINTS, withViewport, type Breakpoint } from './breakpoints.js'
import { resolveAssets, type AssetRequest } from './assets.js'

/** Оркестровка, и только она.
 *
 *  Своей логики у расширения быть не должно: разбор DOM живёт в
 *  сериализаторе, сборка бандла — в `@h2d/bundle`, проверки — в
 *  `@h2d/ir`. Всё, что появится здесь сверх «позвать в правильном
 *  порядке», будет кодом, который проверяется только через целое
 *  расширение, — а это дороже и хуже.
 *
 *  Гейт на этом и построен: дерево, снятое расширением, обязано
 *  совпадать с деревом, снятым напрямую. Разошлись — значит логика
 *  просочилась. */

/** Форма, которую сериализатор ставит на `window` внутри страницы.
 *  Объявлена здесь, потому что воркер не импортирует сериализатор: тот
 *  доставляется в страницу как текст файла. */
type PageApi = {
  beginCapture: () => void
  captureScreen: (id: string, name: string) => CaptureResult
}

type CaptureResult = {
  screen: Screen
  report: Diagnostic[]
  fonts: FontRequirement[]
  assetRequests: AssetRequest[]
}

const SERIALIZER_PATH = 'vendor/serializer.global.js'

/** Впрыск ОДИН раз на вкладку. Сериализатор держит в странице счётчик
 *  идентификаторов, и повторный впрыск сбросил бы его — узлы разных
 *  экранов получили бы одинаковые имена, а инвариант требует
 *  уникальности в пределах бандла. */
const injectOnce = async (tabId: number): Promise<void> => {
  const probe = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => typeof (globalThis as { __h2d?: unknown }).__h2d !== 'undefined',
  })
  if (probe[0]?.result === true) return
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [SERIALIZER_PATH],
    world: 'MAIN',
  })
}

export const captureAt = async (
  tabId: number,
  size: Breakpoint,
): Promise<CaptureResult> => withViewport(tabId, size, async () => {
  await injectOnce(tabId)
  const captured = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [size.name],
    func: (name: string) => {
      const api = (globalThis as unknown as { __h2d: PageApi }).__h2d
      return api.captureScreen(`s-${String(window.innerWidth)}`, name)
    },
  })
  const result = captured[0]?.result
  if (result === undefined || result === null) {
    /** Пустой результат значит, что скрипт не выполнился: страница
     *  могла закрыться или запретить впрыск. Вернуть `undefined` под
     *  видом экрана нельзя — дальше он молча развалит бандл. */
    throw new Error(
      `Снять экран ${size.width}×${size.height} не удалось: скрипт не вернул ` +
      `результат. Вероятно, вкладка закрылась или запрещает впрыск.`,
    )
  }
  return result as CaptureResult
})

/** Снимает все пять брейкпоинтов одним заходом.
 *
 *  `beginCapture` вызывается РОВНО ОДИН раз, до первого экрана.
 *  Счётчик идентификаторов живёт в странице именно для этого:
 *  инвариант `asset.dangling` проверяет ссылки в пределах бандла, а
 *  отчёт ссылается на узлы по имени. Сброс счётчика перед каждым
 *  экраном дал бы пять узлов `n0`, и ссылка стала бы неоднозначной. */
export const captureAll = async (tabId: number): Promise<CaptureResult[]> => {
  await injectOnce(tabId)
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => { (globalThis as unknown as { __h2d: PageApi }).__h2d.beginCapture() },
  })

  const screens: CaptureResult[] = []
  /** Последовательно, а не параллельно: эмуляция применяется к ОДНОЙ
   *  вкладке, и два размера одновременно на ней несовместимы. */
  for (const size of BREAKPOINTS) {
    screens.push(await captureAt(tabId, size))
  }
  return screens
}

/** Шрифты объединяются по всем экранам: без этого инвариант
 *  `font.uncovered` отвергнет бандл, в котором текст пятого экрана
 *  набран шрифтом, не объявленным на первом. */
const dedupeFonts = (fonts: readonly FontRequirement[]): FontRequirement[] => {
  const seen = new Set<string>()
  const out: FontRequirement[] = []
  for (const font of fonts) {
    const key = `${font.family}|${font.weight}|${font.style}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(font)
  }
  return out
}

/** Собирает бандл: пять экранов, байты и отчёт.
 *
 *  Байты забирает ВОРКЕР, а не страница. В этом весь смысл: страница
 *  ограничена CORS, и кросс-доменная картинка — которая отрисовалась,
 *  значит узел построен — осталась бы без байтов. Воркер с
 *  `host_permissions` их достаёт.
 *
 *  Заявки берутся с ПОСЛЕДНЕГО экрана: накопитель в странице общий на
 *  весь захват, и на пятом экране в нём лежат заявки всех пяти. */
export const captureBundle = async (tabId: number): Promise<{
  bundle: Bundle
  bytes: Record<string, Uint8Array>
  assets: Bundle['assets']
  report: Diagnostic[]
}> => {
  const captured = await captureAll(tabId)
  const last = captured[captured.length - 1]
  if (last === undefined) throw new Error('Ни одного экрана не снято.')

  const resolved = await resolveAssets(last.assetRequests)
  const available = new Set(resolved.assets.map((asset) => asset.id))

  const screens: Screen[] = []
  const report: Diagnostic[] = [...resolved.report]
  for (const item of captured) {
    report.push(...item.report)
    /** Дерево приводится в согласие с доехавшим: узел, чья картинка не
     *  пришла даже воркеру, становится заглушкой. Иначе инвариант
     *  `asset.dangling` отверг бы бандл целиком. */
    const fixed = reconcileAssets(item.screen, available)
    screens.push(fixed.screen)
    report.push(...fixed.report)
  }

  const identity = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => ({ url: location.href, title: document.title }),
  })
  /** Пустой результат означает, что вкладка закрылась. Подставить
   *  пустые строки честнее, чем упасть: экраны уже сняты, и терять их
   *  из-за адреса было бы несоразмерно. */
  const { url, title } = identity[0]?.result ?? { url: '', title: '' }

  return {
    bundle: {
      format: 'h2d', version: IR_VERSION,
      capturedAt: new Date().toISOString(),
      url, title,
      userAgent: navigator.userAgent,
      screens, assets: resolved.assets,
      fonts: dedupeFonts(captured.flatMap((item) => item.fonts)),
      tokens: { variables: [], textStyles: [], paintStyles: [] },
      report,
    },
    bytes: resolved.bytes,
    assets: resolved.assets,
    report,
  }
}

/** Поверхность для тестов. Воркер MV3 не имеет экспорта наружу, и
 *  вызвать его функции иначе нечем. */
;(self as unknown as { h2d: unknown }).h2d = {
  captureAt, captureAll, captureBundle, BREAKPOINTS,
}
