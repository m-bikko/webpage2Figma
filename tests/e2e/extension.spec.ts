import { expect, test, type Worker } from '@playwright/test'
import type { IrNode } from '@h2d/ir'
import { fixtureUrl } from './helpers/capture.js'
import { launchWithExtension } from './helpers/extension.js'

/** Идентификатор вкладки по куску URL. Воркер не знает, какую вкладку
 *  открыл тест, а `activeTab` в headless ведёт себя неочевидно —
 *  поэтому вкладка ищется явно. */
const tabIdOf = async (worker: Worker, urlPart: string): Promise<number> => {
  const id = await worker.evaluate(async (part) => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((tab) => (tab.url ?? '').includes(part))?.id ?? null
  }, urlPart)
  if (id === null) throw new Error(`Вкладка с "${urlPart}" не найдена`)
  return id
}

/** Режим раскладки первого узла, который её имеет. Ищется по дереву,
 *  а не по фиксированному пути: путь завязал бы проверку на структуру
 *  фикстуры, которая к сути не относится. */
const modeOfFirstFlex = (node: IrNode): string | null => {
  if (node.layout.mode !== 'none') return node.layout.mode
  for (const child of node.children) {
    const found = modeOfFirstFlex(child)
    if (found !== null) return found
  }
  return null
}

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

/** Эмуляция реально меняет РАСКЛАДКУ, а не только числа.
 *
 *  Фикстура `flex` меняет направление на 390px медиазапросом, поэтому
 *  проверка идёт по самому IR: у флекс-контейнера `row` против
 *  `column`. Проверка по `window.innerWidth` этого бы не дала — он
 *  меняется сразу, а пересчёт стилей может отстать.
 *
 *  ЧЕГО ТЕСТ НЕ ПРОВЕРЯЕТ: что команда эмуляции дождалась ответа.
 *  Замер показал, что без `await` он всё равно проходит — CDP
 *  упорядочивает команды на одну цель сам. `await` в коде оставлен
 *  ради распространения ошибки, и это написано там же. Название теста
 *  исправлено, чтобы не обещать больше, чем он делает. */
test('CDP-эмуляция меняет раскладку, а не только размеры', async () => {
  const { context, worker } = await launchWithExtension()
  try {
    const page = await context.newPage()
    await page.goto(fixtureUrl('flex'))
    const tabId = await tabIdOf(worker, '4317')

    const wide = await worker.evaluate(
      ({ tabId, width, height }) => globalThis.h2d.captureAt(tabId, { width, height, name: 'W' }),
      { tabId, width: 1440, height: 900 },
    )
    const narrow = await worker.evaluate(
      ({ tabId, width, height }) => globalThis.h2d.captureAt(tabId, { width, height, name: 'N' }),
      { tabId, width: 390, height: 844 },
    )

    expect(wide.screen.width).toBe(1440)
    expect(narrow.screen.width).toBe(390)
    expect(modeOfFirstFlex(wide.screen.root)).toBe('row')
    expect(modeOfFirstFlex(narrow.screen.root)).toBe('column')
  } finally {
    await context.close()
  }
})

/** Идентификаторы уникальны в пределах БАНДЛА, а не экрана.
 *
 *  Этого требует инвариант `asset.dangling`: отчёт ссылается на узлы
 *  по имени, и `n42` в пяти экранах сделал бы ссылку неоднозначной.
 *  Счётчик живёт в странице и переживает пять снимков — значит
 *  `beginCapture` обязан быть вызван ровно один раз на захват. */
test('пять экранов с общей нумерацией узлов', async () => {
  const { context, worker } = await launchWithExtension()
  try {
    const page = await context.newPage()
    await page.goto(fixtureUrl('flex'))
    const tabId = await tabIdOf(worker, '4317')

    const screens = await worker.evaluate(
      (tabId) => globalThis.h2d.captureAll(tabId), tabId,
    )

    expect(screens).toHaveLength(5)
    expect(screens.map((item) => item.screen.width)).toEqual([1920, 1440, 1024, 768, 390])

    const ids: string[] = []
    const collect = (node: IrNode): void => {
      ids.push(node.id)
      node.children.forEach(collect)
    }
    screens.forEach((item) => { collect(item.screen.root) })
    expect(new Set(ids).size).toBe(ids.length)
  } finally {
    await context.close()
  }
})

/** Главная выгода расширения над захватом из страницы.
 *
 *  Кросс-доменная картинка ОТРИСОВЫВАЕТСЯ (для показа CORS не мешает),
 *  значит узел строится и ссылается на ассет. Но страница её байты
 *  получить не может, и в плане 4 это было продиагностированной
 *  потерей: узел становился заглушкой. В жизни случай доминирующий —
 *  любая картинка с чужого CDN.
 *
 *  Фоновый воркер с `host_permissions` их достаёт. Измерено до
 *  написания плана: со страницы отказ, из воркера — исходные 195 байт. */
test('воркер достаёт байты, которых странице не отдал CORS', async () => {
  const { context, worker } = await launchWithExtension()
  try {
    const page = await context.newPage()
    await page.goto(fixtureUrl('image-cors'))
    const tabId = await tabIdOf(worker, '4317')

    /** Сначала подтверждаем, что странице действительно отказано —
     *  иначе проверка ничего не значила бы: она могла бы проходить на
     *  картинке, доступной всем. */
    const fromPage = await page.evaluate(async () => {
      try {
        await fetch('http://127.0.0.1:4318/image-fit/asset.png')
        return 'доступно'
      } catch { return 'отказано' }
    })
    expect(fromPage).toBe('отказано')

    const resolved = await worker.evaluate(
      (tabId) => globalThis.h2d.captureBundle(tabId), tabId,
    )
    const asset = resolved.assets[0]
    expect(asset).toBeDefined()
    expect(asset?.mimeType).toBe('image/png')
    expect(resolved.report.filter((entry) => entry.code === 'fidelity.image-unreadable'))
      .toHaveLength(0)
  } finally {
    await context.close()
  }
})
