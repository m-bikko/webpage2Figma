import { decodeBundleText, unpackBundle } from '@w2f/bundle'
import { buildScene, layOutScreens } from './build/index.js'
import { applyScreen, type FigmaSurface } from './apply.js'
import type { Diagnostic } from '@w2f/ir'

/** Точка входа плагина.
 *
 *  Намеренно тонкая. Всё, что здесь происходит, не покрыто ничем:
 *  Figma не запускается ни в CI, ни у разработчика. Поэтому здесь нет
 *  ни одного вычисления — только разбор файла, перебор экранов и
 *  вызовы уже проверенных частей. Появление здесь арифметики означает,
 *  что логика ускользнула из проверяемой половины. */

declare const figma: FigmaSurface & {
  showUI: (html: string, options?: { width: number; height: number }) => void
  ui: { onmessage: ((message: unknown) => void) | null
        postMessage: (message: unknown) => void }
  currentPage: { appendChild: (node: unknown) => void }
  createPage: () => { name: string; appendChild: (node: unknown) => void }
  notify: (text: string) => void
  closePlugin: (message?: string) => void
}
declare const __html__: string

/** Высота с запасом на поле вставки: при 320 оно оказывалось ниже
 *  края окна, и второй способ загрузки был не виден вовсе. */
figma.showUI(__html__, { width: 420, height: 420 })

type IncomingMessage =
  | { kind: 'bundle'; bytes: number[] }
  /** Вставленное из буфера приходит СТРОКОЙ и разбирается здесь.
   *
   *  Окно плагина — отдельный HTML без сборки; декодер в нём стал бы
   *  вторым экземпляром той же логики, а второй экземпляр расходится
   *  с первым молча. */
  | { kind: 'bundle-text'; text: string }

const isBundleMessage = (message: unknown): message is IncomingMessage => {
  if (typeof message !== 'object' || message === null) return false
  const kind = (message as { kind?: unknown }).kind
  if (kind === 'bundle') return Array.isArray((message as { bytes?: unknown }).bytes)
  if (kind === 'bundle-text') {
    return typeof (message as { text?: unknown }).text === 'string'
  }
  return false
}

/** Всё тело обёрнуто в перехват намеренно.
 *
 *  При первом запуске у пользователя код упал на присваивании чужой
 *  формы — и окно плагина навсегда осталось на «Читаю…», потому что
 *  ответ не пришёл. Исключение ушло в консоль, которую надо было ещё
 *  догадаться открыть, а созданные узлы остались висеть на странице.
 *
 *  Молчаливое зависание хуже любой ошибки: пользователю не видно
 *  даже того, что что-то случилось. */
figma.ui.onmessage = async (message: unknown): Promise<void> => {
  try {
    await handleMessage(message)
  } catch (error) {
    const text = error instanceof Error
      ? `${error.message}\n${error.stack ?? ''}`
      : String(error)
    figma.ui.postMessage({ kind: 'error', text })
  }
}


/** UTF-8 своими руками.
 *
 *  `TextDecoder` в песочнице плагина есть не всегда, а отказ там
 *  выглядит как «плагин не работает» без единой подсказки. Разбор
 *  короткий и полностью определённый, так что своя реализация надёжнее
 *  проверки наличия чужой. */
const decodeUtf8 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i] ?? 0
    if (first < 0x80) { out += String.fromCharCode(first); i += 1; continue }
    if (first < 0xe0) {
      out += String.fromCharCode(((first & 0x1f) << 6) | ((bytes[i + 1] ?? 0) & 0x3f))
      i += 2
      continue
    }
    if (first < 0xf0) {
      out += String.fromCharCode(
        ((first & 0x0f) << 12) | (((bytes[i + 1] ?? 0) & 0x3f) << 6)
        | ((bytes[i + 2] ?? 0) & 0x3f),
      )
      i += 3
      continue
    }
    const code = ((first & 0x07) << 18) | (((bytes[i + 1] ?? 0) & 0x3f) << 12)
      | (((bytes[i + 2] ?? 0) & 0x3f) << 6) | ((bytes[i + 3] ?? 0) & 0x3f)
    out += String.fromCodePoint(code)
    i += 4
  }
  return out
}

const handleMessage = async (message: unknown): Promise<void> => {
  if (!isBundleMessage(message)) return

  /** Декодирование вставленного отделено от распаковки намеренно:
   *  отказы у них разные, и разными должны остаться. «Вставил не то»
   *  и «файл другой версии» требуют от человека разных действий, и
   *  свести их в одно «ошибка импорта» значило бы отнять у него
   *  единственную подсказку. */
  let raw: Uint8Array
  if (message.kind === 'bundle-text') {
    try {
      raw = decodeBundleText(message.text)
    } catch (error) {
      figma.ui.postMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
      })
      return
    }
  } else {
    raw = new Uint8Array(message.bytes)
  }

  let unpacked
  try {
    unpacked = await unpackBundle(raw)
  } catch (error) {
    /** Отказ показывается ПОЛНЫМ текстом. Сообщения `unpackBundle`
     *  написаны так, чтобы человек понял, что делать: «выбран не тот
     *  файл», «файл другой версии». Свернуть их в «ошибка импорта»
     *  значило бы выбросить единственное, что здесь есть полезного. */
    figma.ui.postMessage({ kind: 'error', text: String(error) })
    return
  }

  const { bundle, files } = unpacked

  /** Векторные ассеты отделяются ДО загрузки картинок: SVG в
   *  `figma.createImage` не идёт вовсе — он принимает растр, — и
   *  попытка кончилась бы отказом на первой же иконке. Вместо
   *  картинки из них строится векторный узел. */
  const svgTexts = new Map<string, string>()
  for (const asset of bundle.assets) {
    if (asset.mimeType !== 'image/svg+xml') continue
    const bytes = files.assets[asset.id]
    if (bytes === undefined) continue
    svgTexts.set(asset.id, decodeUtf8(bytes))
  }

  const scene = buildScene(bundle, svgTexts)

  /** Картинки загружаются ОДИН раз на бандл: один и тот же ассет может
   *  стоять на многих узлах и на всех пяти экранах, а `createImage`
   *  каждый раз клал бы в файл новую копию. */
  const images = new Map<string, string>()
  for (const asset of bundle.assets) {
    if (svgTexts.has(asset.id)) continue
    const bytes = files.assets[asset.id]
    if (bytes === undefined) continue
    images.set(asset.id, figma.createImage(bytes).hash)
  }

  const report: Diagnostic[] = [...bundle.report, ...scene.report]

  /** Экраны раскладываются В РЯД, а не в одну точку. Корень каждого
   *  стоит в нуле своих координат — верно внутри экрана и неверно на
   *  холсте. Первая редакция клала все пять друг на друга, и вместо
   *  пяти макетов получалось месиво. */
  const places = layOutScreens(scene.screens)
  for (const [index, screen] of scene.screens.entries()) {
    const applied = await applyScreen(figma, screen, scene.fonts, images)
    report.push(...applied.report)
    const place = places[index]
    if (place !== undefined) {
      applied.root.x = place.x
      applied.root.y = place.y
    }
    figma.currentPage.appendChild(applied.root)
  }

  figma.ui.postMessage({
    kind: 'done',
    screens: scene.screens.length,
    report: report.map((entry) => ({
      level: entry.level, code: entry.code, message: entry.message,
    })),
    /** Отдельно от отчёта: это не найденные изъяны, а места, где наша
     *  модель семантики Figma остаётся догадкой и требует, чтобы
     *  человек посмотрел глазами ОДИН раз. Смешать их с диагностикой
     *  значило бы утопить в ней. */
    needsVerification: scene.needsVerification,
  })
}
