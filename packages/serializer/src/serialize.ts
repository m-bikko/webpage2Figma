import { IR_VERSION } from '@h2d/ir/version'
import type { Bundle, Diagnostic, FontRequirement, Screen } from '@h2d/ir'
import { DiagnosticSink } from './diagnostics.js'
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
}

export type SerializeOptions = {
  /** Стабильный идентификатор экрана. На него ссылается отчёт. */
  id: string
  /** Отображаемое имя. Редактируется пользователем, уникальность не нужна. */
  name: string
  /** Общий на весь захват аллокатор: идентификаторы узлов уникальны
   *  в пределах бандла, а не экрана. */
  allocId: IdAllocator
}

/** Снимает текущее состояние документа как один Screen.
 *  Размерами управляет драйвер в extension — сериализатор про них
 *  ничего не знает и ничего не эмулирует. */
export const serializeScreen = (options: SerializeOptions): SerializeResult => {
  const sink = new DiagnosticSink(options.id)
  const root = walkDocument(sink, options.allocId)
  if (root === null) {
    throw new Error('Документ пуст: <body> не отрисован.')
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
      root,
      screenshotId: null,
    },
    report: sink.drain(),
    fonts: collectFonts(root),
  }
}

export const emptyBundle = (): Bundle => ({
  format: 'h2d',
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
