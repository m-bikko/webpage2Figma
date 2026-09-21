import type { Corner, DiagnosticCode, Rgba8, Sides } from '@h2d/ir'

/** Описание сцены Figma.
 *
 *  Намеренно ОПИСАНИЕ, а не набор команд или замыканий. Описание можно
 *  сравнить в тесте, собрать обратно в IR для кругового обхода и
 *  прочитать глазами в багрепорте; набор замыканий не даёт ничего из
 *  этого. Вся логика живёт в строителе, который его порождает, а
 *  применитель обязан быть механическим перебором — любое вычисление
 *  в нём означает, что кусок логики ускользнул из проверяемой части. */

/** Цвет в представлении Figma: доли `0..1`, альфа ОТДЕЛЬНО.
 *
 *  Разведение не косметическое: в Figma прозрачность краски живёт в
 *  `opacity` самой краски, а не в цвете, и сложить их обратно в RGBA
 *  нельзя — у узла есть ещё собственная непрозрачность, которая на неё
 *  домножается. */
export type FigmaColor = { r: number; g: number; b: number }

export type ScenePaint =
  | { type: 'SOLID'; color: FigmaColor; opacity: number }
  | {
      type: 'GRADIENT_LINEAR'
      /** Матрица, а не пара концов: Figma задаёт градиент именно так.
       *  Наш контракт держит концы (план 2 выбрал их ровно потому, что
       *  «Figma задаёт градиент матрицей, а не углом»), и перевод
       *  делается здесь. */
      gradientTransform: readonly [readonly [number, number, number],
                                   readonly [number, number, number]]
      gradientStops: { position: number; color: FigmaColor; opacity: number }[]
    }
  | {
      type: 'IMAGE'
      assetId: string
      scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
      /** Только для `TILE`. Для остальных режимов размещение выражено
       *  ГЕОМЕТРИЕЙ прямоугольника — см. `paint.ts`. */
      scalingFactor?: number
    }

export type SceneStroke = {
  color: FigmaColor
  opacity: number
  /** Толщина ПО СТОРОНАМ, а не одним числом. Figma это умеет
   *  (`IndividualStrokesMixin`), в отличие от SVG, где одиночная
   *  обводка имеет одну ширину на весь путь и референс-рендереру
   *  приходится рисовать кольцо. Сводить к максимуму здесь было бы
   *  потерей, а не вынужденным упрощением. */
  weight: Sides
  /** Пустой массив — сплошная линия. Шаги согласованы с тем, что
   *  рисует референс-рендерер: иначе круговой обход поймает
   *  расхождение, и будет прав. */
  dashPattern: number[]
}

export type SceneEffect =
  | { type: 'DROP_SHADOW' | 'INNER_SHADOW'
      color: Rgba8; offsetX: number; offsetY: number
      radius: number; spread: number }
  | { type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'; radius: number }

export type SceneText = {
  characters: string
  /** Прогоны применяются диапазонами символов. Границы считаются
   *  строителем, потому что применитель не вычисляет. */
  runs: {
    start: number; end: number
    family: string; style: string
    fontSize: number; letterSpacing: number
    color: Rgba8
    decoration: 'none' | 'underline' | 'strikethrough'
  }[]
  lineHeight: number
  align: 'left' | 'center' | 'right' | 'justify'
}

export type SceneBase = {
  /** Идентификатор исходного узла IR. Нужен, чтобы отчёт мог указать
   *  на конкретное место, а круговой обход — сопоставить деревья. */
  id: string
  name: string
  /** Координаты РОДИТЕЛЯ. Совпадает с `relativeTransform` в Figma,
   *  который задаётся относительно родителя-контейнера, поэтому
   *  преобразования координат не требуется вовсе. Это же подтверждает
   *  задним числом решение плана 3 хранить `rect` так. */
  x: number
  y: number
  width: number
  height: number
  /** Градусы. ЗНАК ПРОТИВОПОЛОЖЕН нашему углу: документация Figma
   *  определяет `rotation` как `atan2(-m10, m00)`, а наш угол —
   *  `atan2(b, a)`, где `m10 = b`. Перепутать знак значит получить
   *  зеркальный поворот, который выглядит правдоподобно и не заметен
   *  ни на чём симметричном. */
  rotation: number
  opacity: number
  blendMode: string
  fills: ScenePaint[]
  stroke: SceneStroke | null
  corner: Corner
  effects: SceneEffect[]
  children: SceneNode[]
}

export type SceneNode =
  | { kind: 'frame'; base: SceneBase; clipsContent: boolean }
  | { kind: 'rect'; base: SceneBase }
  | { kind: 'text'; base: SceneBase; text: SceneText }
  | { kind: 'placeholder'; base: SceneBase; label: string; code: DiagnosticCode }

export type SceneScreen = {
  id: string
  name: string
  width: number
  height: number
  root: SceneNode
}

/** Шрифт, который применитель обязан загрузить ДО построения текста.
 *  `loadFontAsync` асинхронен, а строитель чист — поэтому список
 *  извлекается отдельно и грузится заранее. */
export type FontRequest = { family: string; style: string }

export type Scene = {
  screens: SceneScreen[]
  fonts: FontRequest[]
  /** Что осталось догадкой и требует сверки человеком в Figma. Не
   *  украшение: без этого списка непроверяемое выдавалось бы за
   *  проверенное. */
  needsVerification: { code: DiagnosticCode; nodeId: string; message: string }[]
}
