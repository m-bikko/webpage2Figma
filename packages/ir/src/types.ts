import type { DiagnosticCode } from './codes.js'
import type { IrVersion } from './version.js'

/** sRGB, каналы r/g/b — ЦЕЛЫЕ 0..255, альфа — 0..1.
 *  Это НЕ единицы Figma: там все четыре канала 0..1. Конверсия делается
 *  в плагине, потому что источник (`getComputedStyle`) и второй потребитель
 *  (SVG-рендерер) работают в 0..255, и только Figma — нет.
 *  Имя с «8» умышленное: `{r:1,g:1,b:1}` — почти чёрный здесь и белый
 *  в Figma, и эту ошибку легко сделать молча. */
export type Rgba8 = { r: number; g: number; b: number; a: number }

export type Rect = { x: number; y: number; w: number; h: number }

export type Sides = { top: number; right: number; bottom: number; left: number }

export type Corner = { tl: number; tr: number; br: number; bl: number }

/** Разложенная 2D-трансформа в форме, близкой к Figma.
 *  Когда она не null, `rect` — НЕтрансформированный border box.
 *  Иначе два поля противоречат друг другу: `getBoundingClientRect()`
 *  возвращает габарит уже трансформированного элемента, поэтому
 *  повёрнутый на 15° блок 100×20 дал бы ~102×31. */
export type Transform = {
  /** Радианы, против часовой стрелки. */
  angle: number
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
}

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

/** Размещение изображения в боксе. Не keyword: Figma управляет
 *  картинкой через трансформу, а CSS умеет
 *  `right 24px center / 120px auto`, что keyword'ом не выразить. */
export type ImagePlacement = {
  mode: 'fill' | 'fit' | 'tile' | 'crop'
  /** Смещение в пикселях от левого верхнего угла бокса. */
  offsetX: number
  offsetY: number
  /** Масштаб изображения; для `tile` задаёт размер плитки. */
  scaleX: number
  scaleY: number
}

export type ImageRef = { assetId: string; placement: ImagePlacement }

/** Градиенты появятся отдельным членом объединения в плане 2.
 *  Это безопасно именно потому, что `Fill` размечен: неизвестный `kind`
 *  падает громко и в zod, и в исчерпывающем `switch`. */
export type Fill =
  | { kind: 'solid'; color: Rgba8 }
  | { kind: 'image'; ref: ImageRef }

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

export type Stroke = {
  color: Rgba8
  weight: Sides
  style: StrokeStyle
  /** CSS рисует границу внутрь бокса, а Figma по умолчанию по центру —
   *  при значении по умолчанию каждый элемент с границей сдвинулся бы
   *  на половину толщины. Поле существует, чтобы плагин обязан был
   *  выставить `strokeAlign`, а не забыть про него. */
  align: 'inside'
}

export type Shadow = {
  kind: 'outer' | 'inner'
  color: Rgba8
  offsetX: number
  offsetY: number
  blur: number
  spread: number
}

export type Blur = { layer: number; background: number }

export type NodeStyle = {
  fills: Fill[]
  stroke: Stroke | null
  corner: Corner
  shadows: Shadow[]
  /** СОБСТВЕННАЯ непрозрачность узла, не композитная. Ребёнок
   *  полупрозрачного родителя записывает свою, плагин вкладывает узлы,
   *  и Figma перемножает так же, как браузер. Запекать эффективную
   *  непрозрачность вниз по дереву запрещено: Figma применит её дважды. */
  opacity: number
  blend: BlendMode
  blur: Blur | null
  clip: boolean
}

export type LayoutMode = 'row' | 'column' | 'none'
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type LayoutJustify =
  | 'start' | 'center' | 'end'
  | 'space-between' | 'space-around' | 'space-evenly'

/** Описывает раскладку, которую узел навязывает своим детям. */
export type NodeLayout = {
  mode: LayoutMode
  gap: number
  padding: Sides
  align: LayoutAlign
  justify: LayoutJustify
  wrap: boolean
}

export type SelfPositioning = 'flow' | 'absolute' | 'fixed' | 'sticky' | 'float'

/** Описывает, как узел участвует в раскладке РОДИТЕЛЯ.
 *  Без этого плагин не может отличить обычного ребёнка flex-контейнера
 *  от абсолютно позиционированного бейджа и уложит бейдж третьим
 *  элементом auto-layout, сдвинув остальные. */
export type SelfLayout = {
  positioning: SelfPositioning
  /** null — наследуется `align` родителя (`align-self: auto`). */
  align: LayoutAlign | null
  grow: number
  shrink: number
}

export type TextDecoration = 'none' | 'underline' | 'strikethrough'
export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type TextRun = {
  /** ТОЛЬКО собственный текст узла, без текста потомков.
   *  Инвариант: конкатенация `runs[].text` равна собственному тексту узла
   *  и равна конкатенации `lines[].text`. Первая редакция контракта
   *  нарушала это: `run.text` был `el.textContent` (весь подграф), а
   *  `lines` — только прямые текстовые узлы, из-за чего плагин рисовал
   *  вложенный `<b>` дважды. */
  text: string
  /** Весь объявленный `font-family`, по порядку. */
  fontStack: string[]
  /** Семейство, которым браузер РЕАЛЬНО рисовал. Может отличаться от
   *  `fontStack[0]`, и тогда `lines` содержат метрики этого семейства.
   *  Без различения плагин применил бы метрики Helvetica к Söhne и
   *  получил вылезающий текст, считая, что шрифт найден. */
  usedFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  fontSize: number
  letterSpacing: number
  color: Rgba8
  decoration: TextDecoration
  shadows: Shadow[]
}

/** Реальный бокс строки, снятый через `Range.getClientRects()`.
 *  Figma переносит строки сама и почти наверняка иначе, чем браузер,
 *  поэтому места переносов фиксируются явно. */
export type LineBox = { x: number; y: number; w: number; h: number; text: string }

export type NodeText = {
  /** Непустой по построению: текстовый узел без ранов отрендерился бы
   *  в ничто, и это молчаливая потеря. */
  runs: [TextRun, ...TextRun[]]
  lines: LineBox[]
  /** Свойства абзаца, а не отдельного рана: два рана не могут иметь
   *  разное выравнивание, и плагин не должен выбирать произвольно. */
  lineHeight: number
  align: TextAlign
}

export type VectorPath = {
  /** Путь в синтаксисе SVG `d`. */
  data: string
  fill: Rgba8 | null
  stroke: Stroke | null
}

type NodeBase = {
  /** Уникален в пределах БАНДЛА, а не экрана: диагностика ссылается
   *  на узел, и `n42` в пяти экранах сделал бы ссылку неоднозначной. */
  id: string
  sourceTag: string
  name: string
  /** Абсолютные координаты документа, не вьюпорта. Когда `transform`
   *  не null — НЕтрансформированный border box. */
  rect: Rect
  /** Порядок отрисовки браузера, НЕ порядок DOM.
   *  Инвариант, который валидируется: плотный, уникальный, полный
   *  порядок по всем узлам экрана. Плотность важна не сама по себе —
   *  она позволяет плагину обнаружить случай, который дерево Figma
   *  выразить не может: если `paintOrder` узла попадает внутрь
   *  диапазона чужого поддерева, значит потомок красится поверх соседа
   *  родителя, и требуется перестройка либо диагностика. */
  paintOrder: number
  /** Узел создаёт stacking context. Продюсер знает это бесплатно
   *  (он уже вычисляет это для порядка отрисовки), плагин восстановить
   *  не может: ни `transform`, ни `filter`, ни `isolation`, ни
   *  `z-index` в IR по отдельности не лежат. */
  isStackingContext: boolean
  transform: Transform | null
  layout: NodeLayout
  selfLayout: SelfLayout
  style: NodeStyle
  /** В порядке РАСКЛАДКИ: после нормализации `-reverse` и `order`.
   *  Порядок отрисовки живёт только в `paintOrder`. */
  children: IrNode[]
}

/** Размеченное объединение, а не флаги. `kind` делает возможным
 *  исчерпывающий `switch` из §8.5 спеки, исключает представимое
 *  состояние «и текст, и картинка» и даёт заглушке собственный вид. */
export type IrNode =
  | (NodeBase & { kind: 'frame' })
  | (NodeBase & { kind: 'text'; text: NodeText })
  | (NodeBase & { kind: 'image'; image: ImageRef })
  | (NodeBase & { kind: 'vector'; paths: VectorPath[] })
  | (NodeBase & {
      kind: 'placeholder'
      /** Видимая заглушка в Figma. Правило «молчаливый fallback — это баг»
       *  требует, чтобы неподдерживаемое содержимое было ВИДНО, а не
       *  приезжало пустой коробкой. */
      placeholder: { code: DiagnosticCode; label: string }
    })

export type NodeKind = IrNode['kind']

export type DiagnosticLevel = 'info' | 'warning' | 'error'

export type Diagnostic = {
  level: DiagnosticLevel
  code: DiagnosticCode
  message: string
  nodeId: string | null
  /** Стабильный `Screen.id`, не отображаемое имя: имя редактируется
   *  пользователем и не обязано быть уникальным. */
  screenId: string | null
  /** Узел требует видимой заглушки. Иначе плагин, встретив незнакомый
   *  код, нарисовал бы обычную пустую коробку. */
  needsPlaceholder: boolean
}

export type Screen = {
  /** Стабильный идентификатор. На него ссылается диагностика. */
  id: string
  /** Отображаемое имя. Редактируется пользователем, уникальность
   *  не гарантируется. */
  name: string
  /** Эмулированная ширина вьюпорта, то есть брейкпоинт.
   *  Горизонтальное переполнение содержимого здесь НЕ отражается. */
  width: number
  /** Высота фрейма макета: высота содержимого, но не меньше высоты
   *  вьюпорта. Скриншот для pixel-diff приводится к этому числу,
   *  а не наоборот. */
  height: number
  dpr: number
  /** Позиция скролла на момент захвата: `fixed` и `sticky` сняты в ней.
   *  Без этого поля смещение необъяснимо в отчёте, а бандл
   *  из багрепорта невоспроизводим. */
  scroll: { x: number; y: number }
  root: IrNode
  screenshotId: string | null
}

export type Asset = {
  id: string
  mimeType: string
  width: number
  height: number
  path: string
}

export type FontRequirement = {
  family: string
  weight: number
  style: 'normal' | 'italic'
}

export type Tokens = {
  variables: { name: string; value: string }[]
  textStyles: { name: string; run: TextRun }[]
  paintStyles: { name: string; fill: Fill }[]
}

export type Bundle = {
  /** Маркер формата. Позволяет отличить «это не наш файл» от
   *  «наш файл чужой версии» и не сообщать «версия undefined». */
  format: 'h2d'
  version: IrVersion
  capturedAt: string
  url: string
  title: string
  userAgent: string
  screens: Screen[]
  assets: Asset[]
  fonts: FontRequirement[]
  tokens: Tokens
  report: Diagnostic[]
}
