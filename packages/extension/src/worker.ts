import { BREAKPOINTS, withViewport, type Breakpoint } from './breakpoints.js'

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
  screen: { id: string; name: string; width: number; height: number; root: unknown }
  report: unknown[]
  fonts: unknown[]
  assetRequests: { id: string; url: string; naturalWidth: number
                   naturalHeight: number; nodeId: string; screenId: string }[]
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

/** Поверхность для тестов. Воркер MV3 не имеет экспорта наружу, и
 *  вызвать его функции иначе нечем. */
;(self as unknown as { h2d: unknown }).h2d = { captureAt, BREAKPOINTS }
