import { IR_VERSION } from '@w2f/ir/version'
import type { Bundle, Diagnostic, FontRequirement, Screen } from '@w2f/ir'
import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import { DiagnosticSink } from './diagnostics.js'
import { readCanvas } from './page-canvas.js'
import type { AssetRequest, AssetRequests } from './assets.js'
import {
  collectFonts, createIdAllocator, walkDocument, type IdAllocator,
} from './walk.js'

export type SerializeResult = {
  screen: Screen
  report: Diagnostic[]
  /** Шрифты, использованные на этом экране. Отдаются наружу потому, что
   *  `Bundle.fonts` — уровень бандла, а данные есть только у обходчика.
   *  Сборщик бандла обязан объединить их по всем экранам: без этого
   *  инвариант `font.uncovered` отвергнет бандл на входе плагина. */
  fonts: FontRequirement[]
  /** Заявки на байты, поданные к этому моменту. Отдаются наружу по той
   *  же причине, что и `fonts`: `Bundle.assets` — уровень бандла, а
   *  данные есть только у обходчика.
   *
   *  Накопитель общий на весь захват, поэтому на пятом экране здесь
   *  будут и заявки первых четырёх. Это верно: сборщику бандла нужен
   *  полный список, а не приращение. */
  assetRequests: AssetRequest[]
}

export type SerializeOptions = {
  /** Стабильный идентификатор экрана. На него ссылается отчёт. */
  id: string
  /** Отображаемое имя. Редактируется пользователем, уникальность не нужна. */
  name: string
  /** Общий на весь захват аллокатор: идентификаторы узлов уникальны
   *  в пределах бандла, а не экрана. */
  allocId: IdAllocator
  /** Общий на весь захват накопитель заявок на изображения. */
  requests: AssetRequests
}

/** Снимает текущее состояние документа как один Screen.
 *  Размерами управляет драйвер в extension — сериализатор про них
 *  ничего не знает и ничего не эмулирует. */
export const serializeScreen = (options: SerializeOptions): SerializeResult => {
  const sink = new DiagnosticSink(options.id)
  const root = walkDocument(sink, options.allocId, options.requests, options.id)
  if (root === null) {
    throw new Error('Документ пуст: <body> не отрисован.')
  }
  /** Холст — свойство экрана, не корня: см. `Screen.canvas`. Отчёт
   *  только когда фон не объявлен нигде — тогда цвет ВЫВЕДЕН, а не
   *  прочитан, и человеку стоит это знать. Объявленный фон — обычный
   *  случай, и запись о нём была бы шумом в каждом бандле. */
  const canvas = readCanvas()
  if (canvas.source === 'default') {
    const { r, g, b } = canvas.color
    sink.report(
      'info', DIAGNOSTIC_CODES.canvasDefaulted,
      `Фон страницы не задан ни на <html>, ни на <body>: холсту дан цвет ` +
      `холста браузера rgb(${r},${g},${b}) (color-scheme: ${canvas.scheme || 'normal'}).`,
      root.id, false,
    )
  }
  return {
    screen: {
      id: options.id,
      name: options.name,
      width: window.innerWidth,
      /** Высота фрейма макета: высота содержимого, но не меньше высоты
       *  вьюпорта. Скриншот для pixel-diff приводится к этому числу,
       *  а не наоборот — иначе короткая страница, где скриншот выше
       *  содержимого, давала бы ложное расхождение. */
      height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
      dpr: window.devicePixelRatio,
      scroll: { x: window.scrollX, y: window.scrollY },
      canvas: canvas.color,
      root,
      screenshotId: null,
    },
    report: sink.drain(),
    fonts: collectFonts(root),
    assetRequests: options.requests.drain(),
  }
}

export const emptyBundle = (): Bundle => ({
  format: 'w2f',
  version: IR_VERSION,
  capturedAt: new Date().toISOString(),
  url: window.location.href,
  title: document.title,
  userAgent: navigator.userAgent,
  screens: [],
  assets: [],
  fonts: [],
  tokens: { variables: [], textStyles: [], paintStyles: [] },
  report: [],
})

export { createIdAllocator }
