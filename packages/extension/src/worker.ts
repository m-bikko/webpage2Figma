import { IR_VERSION } from '@w2f/ir/version'
import { reconcileAssets } from '@w2f/ir'
import type { Bundle, Diagnostic, FontRequirement, Screen } from '@w2f/ir'
import {
  BREAKPOINTS, captureFullPage, selectedBreakpoints, waitForImages, withViewport,
  type Breakpoint,
} from './breakpoints.js'
import { encodeBundleText, packBundle } from '@w2f/bundle'
import { resolveAssets, type AssetRequest } from './assets.js'

/** Оркестровка, и только она.
 *
 *  Своей логики у расширения быть не должно: разбор DOM живёт в
 *  сериализаторе, сборка бандла — в `@w2f/bundle`, проверки — в
 *  `@w2f/ir`. Всё, что появится здесь сверх «позвать в правильном
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

/** Впрыскивает сериализатор ЗАНОВО, не проверяя, есть ли он уже.
 *
 *  Первая редакция проверяла и пропускала впрыск, если `window.__w2f`
 *  уже стоял. Это дало тихий и очень неприятный дефект: страница
 *  переживает перезагрузку расширения. Пользователь обновлял
 *  расширение, снимал ту же вкладку — и в ней работал СТАРЫЙ
 *  сериализатор с прошлого захвата. Новый воркер ставил свежую версию
 *  формата, а поля писал старый код, и бандл отвергался валидатором
 *  на поле, которого старый код не знает.
 *
 *  Понять такое со стороны невозможно: сборка свежая, расширение
 *  перезагружено, а ошибка говорит про поле.
 *
 *  Повторный впрыск безопасен, потому что вызывается РОВНО ОДИН раз
 *  на захват — до `beginCapture`, который и так сбрасывает счётчик
 *  идентификаторов. Внутри цикла по экранам впрыска нет: вот там он
 *  сбросил бы нумерацию посреди захвата, и узлы разных экранов
 *  получили бы одинаковые имена.
 *
 *  Цена — 90 КиБ скрипта на захват. Против тихой подмены кода это
 *  ничто. */
const injectSerializer = async (tabId: number): Promise<void> => {
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
  await injectSerializer(tabId)
  return captureInPage(tabId, size)
})

/** Снимает экран, считая, что эмуляция уже применена и сериализатор
 *  уже впрыснут. Вынесено отдельно, чтобы скриншот и дерево снимались
 *  под ОДНИМ подключением отладчика. */
const captureInPage = async (
  tabId: number,
  size: Breakpoint,
): Promise<CaptureResult> => {
  /** ПОСЛЕ эмуляции, а не до: смена размера сама вызывает загрузку
   *  новых картинок — медиазапросы, `srcset`, ленивые изображения,
   *  попавшие в видимую область. */
  await waitForImages(tabId)
  const captured = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [size.name],
    func: (name: string) => {
      const api = (globalThis as unknown as { __w2f: PageApi }).__w2f
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
}

/** Снимает все пять брейкпоинтов одним заходом.
 *
 *  `beginCapture` вызывается РОВНО ОДИН раз, до первого экрана.
 *  Счётчик идентификаторов живёт в странице именно для этого:
 *  инвариант `asset.dangling` проверяет ссылки в пределах бандла, а
 *  отчёт ссылается на узлы по имени. Сброс счётчика перед каждым
 *  экраном дал бы пять узлов `n0`, и ссылка стала бы неоднозначной. */
/** Ключ, под которым лежит выбор брейкпоинтов. */
export const BREAKPOINTS_KEY = 'breakpoints'

const chosenBreakpoints = async (): Promise<Breakpoint[]> => {
  const stored = await chrome.storage.sync.get(BREAKPOINTS_KEY)
  const keys = stored[BREAKPOINTS_KEY] as string[] | undefined
  return selectedBreakpoints(keys)
}

export const captureAll = async (
  tabId: number,
  sizes?: readonly Breakpoint[],
): Promise<{ screen: CaptureResult; base64: string }[]> => {
  /** Впрыск ровно здесь: один раз на захват, до `beginCapture`.
   *  Внутри цикла по экранам его нет — там он сбросил бы нумерацию
   *  посреди захвата. */
  await injectSerializer(tabId)
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => { (globalThis as unknown as { __w2f: PageApi }).__w2f.beginCapture() },
  })

  const out: { screen: CaptureResult; base64: string }[] = []
  const wanted = sizes ?? await chosenBreakpoints()
  /** Последовательно, а не параллельно: эмуляция применяется к ОДНОЙ
   *  вкладке, и два размера одновременно на ней несовместимы. */
  for (const size of wanted) {
    const shot = await shotAt(tabId, size)
    out.push({ screen: shot.screen, base64: shot.base64 })
  }
  return out
}

/** Снимает экран ВМЕСТЕ со скриншотом.
 *
 *  Скриншот делается внутри того же `withViewport`: отладчик уже
 *  подключён, а подключить его второй раз к той же вкладке нельзя.
 *  Разнести это на два захода значило бы эмулировать размер дважды —
 *  и получить скриншот от одной раскладки, а дерево от другой. */
/** Снимает экран со скриншотом, СЧИТАЯ, что сериализатор уже
 *  впрыснут. Отдельно от публичной `captureShot` потому, что внутри
 *  цикла по экранам впрыскивать нельзя: он сбросил бы счётчик
 *  идентификаторов посреди захвата, и узлы разных экранов получили бы
 *  одинаковые имена. Эти два случая пришлось развести явно — общая
 *  функция с флагом скрыла бы ровно то, что здесь важно. */
const shotAt = async (
  tabId: number,
  size: Breakpoint,
): Promise<{ screen: CaptureResult; base64: string
             contentHeight: number; imageHeight: number }> =>
  withViewport(tabId, size, async () => {
    const captured = await captureInPage(tabId, size)
    const base64 = await captureFullPage(
      tabId, captured.screen.width, captured.screen.height,
    )
    /** Высота проверяется по самому PNG, а не по тому, что мы просили:
     *  просьба и результат — разные вещи, и расхождение между ними
     *  ровно то, ради чего снимок берётся через CDP. */
    const imageHeight = pngHeight(base64)
    return {
      screen: captured, base64,
      contentHeight: captured.screen.height, imageHeight,
    }
  })

/** base64 → байты. `Buffer` в воркере нет, `atob` есть. */
const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Снимает один экран со скриншотом, впрыскивая сериализатор.
 *  Публичная точка входа для одиночного снимка. */
export const captureShot = async (
  tabId: number,
  size: Breakpoint,
): Promise<{ screen: CaptureResult; base64: string
             contentHeight: number; imageHeight: number }> => {
  await injectSerializer(tabId)
  return shotAt(tabId, size)
}

/** Высота PNG из его заголовка.
 *
 *  Разбор вручную, потому что в service worker нет ни `Image`, ни
 *  `document`. Размеры лежат в чанке IHDR: восемь байт подписи, потом
 *  четыре длины, четыре типа, потом ширина и высота по четыре байта. */
const pngHeight = (base64: string): number => {
  const head = atob(base64.slice(0, 64))
  let height = 0
  for (let i = 20; i < 24; i += 1) height = height * 256 + head.charCodeAt(i)
  return height
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
export const captureBundle = async (
  tabId: number,
  sizes?: readonly Breakpoint[],
): Promise<{
  bundle: Bundle
  bytes: Record<string, Uint8Array>
  assets: Bundle['assets']
  report: Diagnostic[]
}> => {
  const captured = await captureAll(tabId, sizes)
  const last = captured[captured.length - 1]
  if (last === undefined) throw new Error('Ни одного экрана не снято.')

  const resolved = await resolveAssets(last.screen.assetRequests)
  const available = new Set(resolved.assets.map((asset) => asset.id))

  const screens: Screen[] = []
  const report: Diagnostic[] = [...resolved.report]
  const bytes: Record<string, Uint8Array> = { ...resolved.bytes }
  const assets: Bundle['assets'] = [...resolved.assets]

  for (const item of captured) {
    report.push(...item.screen.report)
    /** Дерево приводится в согласие с доехавшим: узел, чья картинка не
     *  пришла даже воркеру, становится заглушкой. Иначе инвариант
     *  `asset.dangling` отверг бы бандл целиком. */
    const fixed = reconcileAssets(item.screen.screen, available)

    /** Скриншот кладётся ОБЫЧНЫМ ассетом: инвариант требует, чтобы
     *  `screenshotId` нашёлся среди `assets`, а упаковка пишет ассет по
     *  его собственному `path`. Отдельного механизма не нужно. */
    const shotId = `shot-${fixed.screen.id}`
    assets.push({
      id: shotId, mimeType: 'image/png',
      width: fixed.screen.width, height: fixed.screen.height,
      path: `screenshots/${fixed.screen.id}.png`,
    })
    bytes[shotId] = base64ToBytes(item.base64)

    screens.push({ ...fixed.screen, screenshotId: shotId })
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
      format: 'w2f', version: IR_VERSION,
      capturedAt: new Date().toISOString(),
      url, title,
      userAgent: navigator.userAgent,
      screens, assets,
      fonts: dedupeFonts(captured.flatMap((item) => item.screen.fonts)),
      tokens: { variables: [], textStyles: [], paintStyles: [] },
      report,
    },
    bytes,
    assets,
    report,
  }
}

/** Поверхность для тестов. Воркер MV3 не имеет экспорта наружу, и
 *  вызвать его функции иначе нечем. */
/** Пакует бандл в файл `.w2f`.
 *
 *  Байты отдаются массивом чисел: границу `worker.evaluate` переживает
 *  только то, что сериализуется как JSON, — `Uint8Array` приехал бы
 *  пустым. Та же причина, по которой в плане 4 байты ездили base64. */
/** Имя файла: домен и время съёмки.
 *
 *  Домен, а не заголовок страницы: заголовок бывает пустым, длинным и
 *  с символами, которых в имени файла быть не может. */
export const fileNameFor = (bundle: Bundle): string => {
  const host = (() => {
    try { return new URL(bundle.url).hostname } catch { return 'page' }
  })()
  const stamp = bundle.capturedAt.slice(0, 19).replace(/[:T]/g, '-')
  return `${host === '' ? 'page' : host}-${stamp}.w2f`
}

export const captureToFile = async (
  tabId: number,
): Promise<{ zip: number[]; name: string }> => {
  const { bundle, bytes } = await captureBundle(tabId)
  const zip = await packBundle(bundle, { assets: bytes })
  return { zip: Array.from(zip), name: fileNameFor(bundle) }
}

/** Отдаёт УЖЕ собранный файл пользователю.
 *
 *  Принимает готовый архив, а не идентификатор вкладки. Первая
 *  редакция снимала страницу сама, и обработчик команды получался с
 *  двойным захватом: сначала `captureBundle` ради отчёта, потом
 *  `downloadCapture` ещё раз ради файла. Пять размеров снимались
 *  дважды, а во второй раз узлы получали новые идентификаторы, то есть
 *  отчёт в окне ссылался на узлы, которых в скачанном файле нет.
 *
 *  `data:`-URL, а не `URL.createObjectURL`: в MV3-воркере его нет. */
export const downloadCapture = async (
  zip: readonly number[],
  name: string,
): Promise<string> => {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < zip.length; i += CHUNK) {
    binary += String.fromCharCode(...zip.slice(i, i + CHUNK))
  }
  await chrome.downloads.download({
    /** `application/octet-stream`, а НЕ `application/zip`.
     *
     *  Chrome сверяет тип с расширением и переименовывает файл, если
     *  считает, что знает лучше: с `application/zip` он молча
     *  превращал `page.w2f` в `page.zip`. Проверено на настоящем
     *  захвате — файл приехал с расширением `.zip`.
     *
     *  Нейтральный тип заставляет его уважать имя. Содержимое от
     *  этого не меняется: `.w2f` и есть ZIP, просто с нашим
     *  расширением, и плагин ждёт именно его. */
    url: `data:application/octet-stream;base64,${btoa(binary)}`,
    filename: name,
    saveAs: false,
  })
  return name
}

;(self as unknown as { w2f: unknown }).w2f = {
  captureAt, captureAll, captureBundle, captureShot, captureToFile,
  downloadCapture, BREAKPOINTS, selectedBreakpoints,
  /** Выставлено ради теста стыка: он обязан получить текст ИЗ ТОГО ЖЕ
   *  архива, что уходит в файл, и потому зовёт кодек здесь, а не
   *  повторяет его у себя. */
  encodeBundleText,
}

/** Приём команды из окна расширения.
 *
 *  Работа идёт ЗДЕСЬ, а не в окне: воркер переживает закрытие окна, а
 *  съёмка пяти размеров занимает секунды. Делать её в окне значило бы
 *  терять захват от случайного клика мимо.
 *
 *  Отказ уходит обратно ПОЛНЫМ текстом. Свернуть его в «ошибка»
 *  значило бы выбросить единственное, что здесь есть полезного: у
 *  сообщений распаковки и валидатора написано, что делать. */
chrome.runtime.onMessage.addListener((message: { kind?: string }) => {
  if (message.kind !== 'capture') return
  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id === undefined) throw new Error('Активная вкладка не найдена.')
      /** Захват РОВНО ОДИН. Отчёт и файл берутся из одного и того же
       *  бандла, иначе окно показывало бы ссылки на узлы, которых в
       *  скачанном файле нет. */
      const { bundle, bytes } = await captureBundle(tab.id)
      const zip = await packBundle(bundle, { assets: bytes })
      const name = await downloadCapture(Array.from(zip), fileNameFor(bundle))

      /** Текст для буфера считается ЗДЕСЬ, вместе с файлом, из того же
       *  архива. Второй захват ради него дал бы узлам новые
       *  идентификаторы, и отчёт в окне ссылался бы на узлы, которых
       *  во вставленном нет — та же ошибка, из-за которой захват уже
       *  сведён к одному.
       *
       *  Файл скачивается В ЛЮБОМ СЛУЧАЕ, даже когда пользуются
       *  буфером. Буфер — путь короче, но и ненадёжнее: его затирает
       *  любое следующее копирование. Терять захват из-за этого
       *  нельзя. */
      const text = encodeBundleText(zip)

      await chrome.runtime.sendMessage({
        kind: 'done', file: name, text,
        report: bundle.report.map((entry) => ({
          level: entry.level, code: entry.code, message: entry.message,
        })),
      })
    } catch (error) {
      await chrome.runtime.sendMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})
