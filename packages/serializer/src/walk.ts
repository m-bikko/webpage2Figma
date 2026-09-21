// Значение берётся из подпути, а не из барреля: баррель тянет schema.ts,
// то есть zod, который сериализатору не нужен вовсе. Через баррель бандл
// весил 171 КиБ при ~18 КиБ собственного кода, и всё это впрыскивалось
// в каждую захватываемую страницу.
import { DIAGNOSTIC_CODES } from '@h2d/ir/codes'
import type {
  Fill, FontRequirement, IrNode, LayoutAlign, NodeStyle,
  SelfLayout, SelfPositioning, Transform,
} from '@h2d/ir'
import { isInvisible, parseColor } from './css/color.js'
import { isEllipticalCorner, readCorner } from './css/corner.js'
import { parseLinearGradient } from './css/gradient.js'
import { hasMixedBorderColors, hasNonSolidStroke, readStroke } from './css/stroke.js'
import { parseBoxShadow } from './css/shadow.js'
import {
  appliesTransform, decomposeMatrix, hasSkew, IDENTITY_MATRIX, invertMatrix,
  localOffset, matrixAboutOrigin, multiplyMatrix, originUnderMatrix,
  parseMatrix, readOrigin, untransformedSize, type Matrix,
} from './css/transform.js'
import type { DiagnosticSink } from './diagnostics.js'
import { isReversed, readLayout } from './layout.js'
import { readProbe, type LayoutProbe } from './probe.js'
import {
  establishesStackingContext, findApproximatedOrder, findInterleaved,
  resolvePaintOrder,
} from './stacking.js'
import { hasFontFallback, parseFontStack, readText } from './text.js'

export type IdAllocator = () => string

/** Идентификаторы уникальны в пределах БАНДЛА, а не экрана: на них
 *  ссылается отчёт, и `n42` в пяти экранах сделал бы ссылку неоднозначной.
 *  Поэтому аллокатор создаётся один раз на захват и передаётся снаружи. */
export const createIdAllocator = (): IdAllocator => {
  let counter = 0
  return () => {
    const id = `n${counter}`
    counter += 1
    return id
  }
}

const GROUP_EFFECT_MESSAGES = {
  transform: 'трансформа предка к нему не применяется, а его прямоугольник ' +
    'снят как габарит уже трансформированного элемента',
  blur: 'размытие предка к нему не применяется, и он остаётся резким',
  opacity: 'прозрачность предка применяется к группе целиком, а рендерер ' +
    'применяет её к каждому узлу отдельно',
} as const

type WalkContext = {
  sink: DiagnosticSink
  scrollX: number
  scrollY: number
  allocId: IdAllocator
  /** Есть ли среди предков узел с НЕпереносимой трансформой — скосом или
   *  трёхмерной матрицей. Такая трансформа не попадает в накопленную
   *  матрицу, поэтому положение всех потомков наследует ошибку.
   *  Ведётся сверху вниз: снизу этого не восстановить. */
  insideBrokenTransform: boolean
  /** Произведение матриц всех трансформированных предков. Ведётся сверху
   *  вниз: снизу его не восстановить, потому что `getBoundingClientRect()`
   *  отдаёт результат их применения, но не сами матрицы. */
  ancestorMatrix: Matrix
  /** Обратная к `ancestorMatrix`. Ведётся рядом, а не считается на каждом
   *  узле: она нужна каждому ребёнку, а меняется только там, где у предка
   *  есть собственная трансформа — то есть почти нигде.
   *
   *  `null` означает вырожденную цепочку (`scale(0)` где-то выше):
   *  положение потомков в такой системе не восстановимо, и подставлять
   *  единичную нельзя — это выдало бы неверный ответ за верный. */
  ancestorInverse: Matrix | null
  /** Экранное положение локального нуля родителя ПОСЛЕ его собственной
   *  трансформы. Начало системы координат, в которой выражены дети. */
  parentOrigin: { x: number; y: number }
}

/** Элементы, которые не рисуются и не должны попадать в макет. */
const SKIPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'BR',
])

const isRendered = (el: Element, cs: CSSStyleDeclaration): boolean => {
  if (SKIPPED_TAGS.has(el.tagName)) return false
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

const ALIGN_SELF: Record<string, LayoutAlign> = {
  'flex-start': 'start', start: 'start',
  center: 'center',
  'flex-end': 'end', end: 'end',
  stretch: 'stretch',
  baseline: 'baseline',
}

/** Как узел участвует в раскладке РОДИТЕЛЯ. Без этого плагин не отличит
 *  обычного ребёнка flex-контейнера от абсолютно позиционированного
 *  бейджа и уложит бейдж третьим элементом auto-layout, сдвинув
 *  остальных. Данные читаются здесь и больше нигде не восстановимы. */
const readSelfLayout = (cs: CSSStyleDeclaration): SelfLayout => {
  const positioning: SelfPositioning =
    cs.position === 'absolute' ? 'absolute'
    : cs.position === 'fixed' ? 'fixed'
    : cs.position === 'sticky' ? 'sticky'
    : cs.float !== 'none' ? 'float'
    : 'flow'

  const rawAlign = cs.alignSelf
  return {
    positioning,
    align: rawAlign === 'auto' ? null : (ALIGN_SELF[rawAlign] ?? null),
    grow: Number.parseFloat(cs.flexGrow) || 0,
    shrink: Number.isNaN(Number.parseFloat(cs.flexShrink))
      ? 1
      : Number.parseFloat(cs.flexShrink),
  }
}

/** `box` — размер того прямоугольника, который поедет в `rect`, а НЕ
 *  габарит из `getBoundingClientRect()`. Разница появляется ровно на
 *  трансформированном элементе: ручки градиента нормализованы по боксу, и
 *  рендерер разворачивает их в пиксели по `rect`. Считать их по габариту
 *  повёрнутого элемента, а рисовать в НЕповёрнутом боксе — значит задать
 *  угол градиента от чужого соотношения сторон, потому что угол в CSS
 *  зависит от пропорций бокса (см. `cornerAngle` в `gradient.ts`). */
const readFills = (
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
  sink: DiagnosticSink,
  id: string,
): Fill[] => {
  const fills: Fill[] = []

  const background = parseColor(cs.backgroundColor)
  if (background === null) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.colorUnparsed,
      `Не удалось разобрать background-color: "${cs.backgroundColor}"`, id, false,
    )
  } else if (!isInvisible(background)) {
    fills.push({ kind: 'solid', color: background })
  }

  /** Градиент кладётся ПОВЕРХ цвета фона — так же, как красит браузер:
   *  `background-image` рисуется над `background-color`. Порядок в массиве
   *  `fills` и есть порядок отрисовки. */
  if (cs.backgroundImage !== 'none') {
    const gradient = parseLinearGradient(cs.backgroundImage, box)
    if (gradient !== null) {
      fills.push({ kind: 'gradient', gradient })
    }
  }

  return fills
}

const BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])

const readStyle = (
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
  sink: DiagnosticSink,
  id: string,
): NodeStyle => {
  if (isEllipticalCorner(cs)) {
    sink.report(
      'info', DIAGNOSTIC_CODES.ellipticalCorner,
      'Эллиптический радиус угла сведён к горизонтальному: в Figma эллиптических углов нет.',
      id, false,
    )
  }
  if (hasMixedBorderColors(cs)) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.mixedBorderColors,
      'Границы разных цветов сведены к одному: Figma держит один цвет обводки на узел.',
      id, false,
    )
  }
  if (hasNonSolidStroke(cs)) {
    sink.report(
      'info', DIAGNOSTIC_CODES.strokeStyleFlattened,
      'Стиль границы не воспроизводится рендерером плана 1 либо невыразим в Figma.',
      id, false,
    )
  }

  const rawBlend = cs.mixBlendMode
  const blend = BLEND_MODES.has(rawBlend)
    ? (rawBlend as NodeStyle['blend'])
    : 'normal'

  return {
    fills: readFills(cs, box, sink, id),
    stroke: readStroke(cs),
    corner: readCorner(cs),
    shadows: parseBoxShadow(cs.boxShadow),
    // СОБСТВЕННАЯ непрозрачность, не композитная: плагин вкладывает узлы,
    // и Figma перемножает так же, как браузер. Запекать вниз запрещено.
    opacity: Number.parseFloat(cs.opacity),
    blend,
    /** Два размытия разведены намеренно: `filter: blur()` размывает САМ
     *  слой и переносится, `backdrop-filter: blur()` размывает то, что за
     *  элементом, и остаётся отложенным — у плоского рендерера «за
     *  элементом» не существует, проверить перенос нечем. Поле остаётся
     *  `null`, когда размытия нет вовсе: пустой объект `{0,0}` заставил бы
     *  инвариант требовать диагностику там, где нечего откладывать. */
    blur: (() => {
      const layer = blurRadius(cs.filter)
      const background = blurRadius(cs.backdropFilter)
      return layer > 0 || background > 0 ? { layer, background } : null
    })(),
    clip: cs.overflowX === 'hidden' || cs.overflowY === 'hidden'
      || cs.overflowX === 'clip' || cs.overflowY === 'clip',
  }
}

const blurRadius = (value: string): number => {
  const match = /blur\(\s*([\d.]+)px\s*\)/.exec(value)
  if (match?.[1] === undefined) return 0
  return Number.parseFloat(match[1])
}

/** Диагностирует всё, что этот план не переносит.
 *
 *  Разделение обязательное: `unsupported.*` — то, что невозможно в Figma
 *  в принципе, `deferred.*` — то, что ещё не реализовано. Второе
 *  проверяется инвариантом в `@h2d/ir`: узел с ФОНОВЫМ размытием
 *  без парной диагностики отвергается на входе плагина. Именно так правило
 *  «молчаливый fallback — это баг» стало машинным.
 *
 *  Трансформа, режим наложения и размытие СЛОЯ из этого списка ВЫШЛИ: все
 *  три переносятся, поэтому диагностируется только то, что перенести
 *  нельзя — трёхмерная матрица трансформы, сдвиг и `backdrop-filter`.
 *  Сообщать о переносимом повороте, наложении или размытии было бы шумом,
 *  а шум учит игнорировать отчёт целиком. */
const reportGaps = (
  el: Element,
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): void => {
  if (cs.backgroundImage !== 'none') {
    const rect = el.getBoundingClientRect()
    const linear = parseLinearGradient(cs.backgroundImage, {
      w: rect.width, h: rect.height,
    })
    /** Диагностика только на то, что НЕ разобрали. Линейные градиенты
     *  теперь переносятся, и сообщать о них было бы шумом, а шум учит
     *  игнорировать отчёт целиком. Радиальные, конические и repeating
     *  по-прежнему не переносятся и обязаны быть названы. */
    if (linear === null) {
      const repeating = cs.backgroundImage.includes('repeating-')
      sink.report(
        repeating ? 'warning' : 'info',
        repeating ? DIAGNOSTIC_CODES.unsupportedRepeatingGradient
                  : DIAGNOSTIC_CODES.deferredGradient,
        `background-image "${cs.backgroundImage.slice(0, 60)}" не переносится: ` +
        `в этом плане поддержан только linear-gradient.`,
        id, false,
      )
    }
  }
  if (cs.transform !== 'none') {
    const matrix = parseMatrix(cs.transform)
    if (matrix === null) {
      sink.report('error', DIAGNOSTIC_CODES.unsupportedTransform3d,
        `transform "${cs.transform}" не переносится: трёхмерных трансформ в ` +
        `Figma нет физически.`, id, false)
    } else if (hasSkew(matrix)) {
      /** Сдвиг в Figma отсутствует. Узел при этом приезжает без трансформы
       *  вообще, а не со сдвигом, приведённым к повороту: приближение
       *  выглядело бы правдоподобно и потому хуже честного отказа. */
      sink.report('error', DIAGNOSTIC_CODES.unsupportedTransform3d,
        `transform "${cs.transform}" содержит сдвиг, которого в Figma нет.`,
        id, false)
    }
  }
  const bgBlur = blurRadius(cs.backdropFilter)
  if (bgBlur > 0) {
    /** Размытие слоя переносится, фоновое — нет. Причина не в Figma, где
     *  Background Blur есть, а в рендерере: он плющит дерево в плоский
     *  список, и «того, что за элементом» у него не существует. Проверить
     *  перенос нечем, поэтому фича остаётся отложенной. */
    sink.report('info', DIAGNOSTIC_CODES.deferredBlur,
      `backdrop-filter: blur(${bgBlur}px) не переносится: рендерер плющит ` +
      `дерево, и фона за элементом у него нет.`, id, false)
  }
  /** Проверяется НАЛИЧИЕ не-blur функций, а не отсутствие blur.
   *  Условие `layerBlur === 0` пропускало `filter: blur(3px) grayscale(1)`:
   *  размытие диагностировалось, grayscale терялся без записи. То же для
   *  `backdrop-filter`, который раньше осматривался только на размытие. */
  const hasNonBlur = (value: string): boolean =>
    value !== 'none' && value.replace(/blur\([^)]*\)/g, '').trim() !== ''

  if (hasNonBlur(cs.filter)) {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedFilter,
      `filter "${cs.filter}" содержит функции кроме размытия: Figma их не имеет.`,
      id, false)
  }
  if (hasNonBlur(cs.backdropFilter)) {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedFilter,
      `backdrop-filter "${cs.backdropFilter}" содержит функции кроме размытия.`,
      id, false)
  }
  if (cs.clipPath !== 'none') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedClipPath,
      `clip-path "${cs.clipPath}" не переносится.`, id, false)
  }
  if (cs.position === 'sticky' || cs.position === 'fixed') {
    sink.report('info', DIAGNOSTIC_CODES.stickyFlattened,
      `position: ${cs.position} снят в текущем скролл-положении.`, id, false)
  }
  if (cs.display === 'grid' || cs.display === 'inline-grid') {
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened,
      'CSS grid сведён к колонке: в Figma нет двумерного auto-layout.', id, false)
  }
  if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
    sink.report('info', DIAGNOSTIC_CODES.deferredVector,
      'Векторное содержимое не переносится в этом плане.', id, false)
  }
  for (const pseudo of ['::before', '::after']) {
    const content = window.getComputedStyle(el, pseudo).content
    if (content !== 'none' && content !== 'normal' && content !== '') {
      sink.report('info', DIAGNOSTIC_CODES.deferredPseudoElement,
        `Псевдоэлемент ${pseudo} с содержимым ${content} не переносится.`, id, false)
    }
  }
}

/** Содержимое, которое невозможно перенести в принципе, становится
 *  ВИДИМОЙ заглушкой, а не пустым фреймом. Парная диагностика с тем же
 *  кодом и `needsPlaceholder: true` обязательна: инвариант в `@h2d/ir`
 *  отвергнет заглушку, которую отчёт не объясняет. */
const placeholderFor = (
  el: Element,
  sink: DiagnosticSink,
  id: string,
): { code: typeof DIAGNOSTIC_CODES[keyof typeof DIAGNOSTIC_CODES]; label: string } | null => {
  if (el.tagName === 'CANVAS') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas,
      'Содержимое <canvas> не переносится.', id, true)
    return { code: DIAGNOSTIC_CODES.unsupportedCanvas, label: 'canvas' }
  }
  if (el.tagName === 'IFRAME') {
    const frame = el as HTMLIFrameElement
    let sameOrigin = false
    try {
      sameOrigin = frame.contentDocument !== null
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) {
      sink.report('warning', DIAGNOSTIC_CODES.unsupportedCrossOriginIframe,
        'Содержимое iframe с другого источника недоступно.', id, true)
      return { code: DIAGNOSTIC_CODES.unsupportedCrossOriginIframe, label: 'iframe' }
    }
  }
  return null
}

type Built = { node: IrNode; probe: LayoutProbe }

const buildNode = (
  el: Element,
  parentCs: CSSStyleDeclaration | null,
  ctx: WalkContext,
): Built | null => {
  const cs = window.getComputedStyle(el)
  if (!isRendered(el, cs)) return null

  const id = ctx.allocId()
  reportGaps(el, cs, ctx.sink, id)

  const ownMatrixRaw = parseMatrix(cs.transform)
  const rawRect = el.getBoundingClientRect()

  /** Читается ли НЕтрансформированный бокс из вычисленного стиля. Тот же
   *  признак отвечает, применил ли браузер объявленную трансформу: у
   *  незамещаемого строчного элемента computed `width` равен `auto`, и
   *  трансформа к нему не применяется — см. `appliesTransform`. */
  const boxReadable = appliesTransform(cs)
  const usable = ownMatrixRaw !== null && !hasSkew(ownMatrixRaw) && boxReadable

  const origin = readOrigin(cs)
  /** Собственная матрица, приведённая к форме вокруг нуля. Единичная,
   *  когда трансформы нет ИЛИ она непереносима (сдвиг, трёхмерная,
   *  неприменённая): в этих случаях она отсутствует и в поле `transform`,
   *  и рендерер её не применит — значит и здесь её быть не должно. */
  const ownMatrix = usable && ownMatrixRaw !== null
    ? matrixAboutOrigin(ownMatrixRaw, origin)
    : IDENTITY_MATRIX

  /** Размер НЕтрансформированного бокса. `untransformedSize` годится
   *  только когда бокс читается: на строчном элементе `cs.width` равен
   *  `auto`, и безусловный вызов схлопнул бы каждый `<span>` в точку — он
   *  исчез бы из рендера молча. Там, где бокс не читается, трансформа к
   *  элементу и не применена, поэтому габарит `getBoundingClientRect()` и
   *  есть нетрансформированный размер. */
  const size = boxReadable
    ? untransformedSize(cs)
    : { w: rawRect.width, h: rawRect.height }

  /** Полная цепочка: сначала собственная матрица узла, затем матрицы
   *  предков. Единичную собственную матрицу пропускаем по ссылке — это
   *  подавляющее большинство узлов, а произведение с единичной побитово
   *  равно исходной матрице, так что сокращение точное, а не приближённое. */
  const ownIsIdentity = ownMatrix === IDENTITY_MATRIX
  const total = ownIsIdentity
    ? ctx.ancestorMatrix
    : multiplyMatrix(ctx.ancestorMatrix, ownMatrix)
  const totalInverse = ownIsIdentity ? ctx.ancestorInverse : invertMatrix(total)

  const screenOrigin = originUnderMatrix(el, total, size)

  /** Положение выражается относительно родителя — в ЕГО осях, а не в
   *  экранных. Разность экранных нулей под повёрнутым предком повёрнута
   *  вместе с ним, поэтому её приходится вернуть в оси родителя обратной
   *  матрицей; собственная трансформа узла из результата вычитается,
   *  потому что уезжает отдельным полем. Оба шага живут в `localOffset`.
   *
   *  Вырожденная цепочка предков (`scale(0)` выше по дереву) схлопывает
   *  всё поддерево в точку. Нулевое смещение — честный ответ для этого
   *  случая, а не заглушка: именно так это и выглядит. На практике
   *  недостижимо, потому что такой предок не проходит `isRendered`. */
  const local = ctx.ancestorInverse === null
    ? { x: 0, y: 0 }
    : localOffset({
        screenOrigin,
        parentOrigin: ctx.parentOrigin,
        ancestorInverse: ctx.ancestorInverse,
        ownMatrix,
      })

  const box = { x: local.x, y: local.y, w: size.w, h: size.h }

  const transform: Transform | null = usable && ownMatrixRaw !== null
    ? { ...decomposeMatrix(ownMatrixRaw), originX: origin.x, originY: origin.y }
    : null

  const children: IrNode[] = []
  const childProbes: LayoutProbe[] = []

  /** Трансформа есть, но не переносится: скос или трёхмерная матрица.
   *  Она не попадёт в накопленную матрицу, поэтому все потомки унаследуют
   *  ошибку положения и должны быть об этом предупреждены. */
  const brokenTransform = ownMatrixRaw !== null && !usable

  /** Порядок детей нормализуется по -reverse: сам порядок отрисовки
   *  живёт в paintOrder, а здесь он логический, раскладочный. */
  const ordered = isReversed(cs) ? [...el.children].reverse() : [...el.children]

  const childCtx: WalkContext = {
    ...ctx,
    ancestorMatrix: total,
    ancestorInverse: invertMatrix(total),
    parentOrigin: screenOrigin,
    insideBrokenTransform: ctx.insideBrokenTransform || brokenTransform,
  }

  for (const child of ordered) {
    const built = buildNode(child, cs, childCtx)
    if (built === null) continue
    children.push(built.node)
    childProbes.push(built.probe)
  }

  const base = {
    id,
    sourceTag: el.tagName.toLowerCase(),
    name: el.tagName.toLowerCase(),
    /** Координаты родителя. Прокрутка сюда больше не прибавляется: она
     *  входит в положение КОРНЯ и наследуется вложенностью, а прибавленная
     *  на каждом уровне сложилась бы столько раз, какова глубина. Корню её
     *  добавляет `walkDocument` после обхода. */
    rect: box,
    // Заполняется вторым проходом: требует готового дерева.
    paintOrder: -1,
    isStackingContext: false,
    transform,
    layout: readLayout(cs),
    selfLayout: readSelfLayout(cs),
    style: readStyle(cs, box, ctx.sink, id),
    children,
  }

  /** Потомок трансформированного предка переносится НЕВЕРНО: его `rect`
   *  снят как осепараллельный габарит уже повёрнутого элемента, потому что
   *  `getBoundingClientRect()` включает трансформы предков, а рендерер
   *  рисует его неповёрнутым.
   *
   *  Геометрию это не чинит — чинит честность. Пока трансформы были
   *  отложены, родитель нёс `deferred.transform`, и инвариант заставлял
   *  бандл объяснить, что поддерево не перенесено. Когда родитель стал
   *  переноситься верно, объяснение исчезло, а неверность потомков
   *  осталась: улучшение корректности породило молчаливую потерю.
   *  Исправление геометрии — отдельная работа, требующая хранить `rect`
   *  в локальных координатах родителя и композировать трансформы вниз. */
  if (ctx.insideBrokenTransform) {
    ctx.sink.report(
      'warning', DIAGNOSTIC_CODES.transformDescendant,
      'Узел лежит внутри предка с непереносимой трансформой (скос или ' +
      'трёхмерная): её нет в накопленной матрице, поэтому положение узла ' +
      'унаследовало ошибку предка.',
      id, false,
    )
  }

  const placeholder = placeholderFor(el, ctx.sink, id)
  let node: IrNode
  if (placeholder !== null) {
    node = { ...base, kind: 'placeholder', placeholder }
  } else {
    const text = readText(el, cs, screenOrigin)
    if (text.kind === 'text') {
      /** Фактический шрифт отличается от объявленного — главный убийца
       *  точности. Уровень error намеренно: `lines` содержат метрики
       *  фактического шрифта, и если в Figma объявленный шрифт установлен,
       *  плагин применит к нему чужие метрики и получит вылезающий текст,
       *  считая при этом, что шрифт найден. */
      if (hasFontFallback(cs)) {
        const stack = parseFontStack(cs.fontFamily)
        ctx.sink.report(
          'error', DIAGNOSTIC_CODES.fontFallback,
          `Объявлен "${stack[0] ?? '?'}", браузер рисовал ` +
          `"${text.text.runs[0]?.usedFamily ?? '?'}". Метрики строк — от ` +
          `фактического шрифта.`,
          id, false,
        )
      }
      node = { ...base, kind: 'text', text: text.text }
    } else {
      if (text.kind === 'lost') {
        ctx.sink.report('warning', DIAGNOSTIC_CODES.textLost,
          `Текст "${text.sample}" не дал ни одного бокса строки и потерян.`, id, false)
      }
      node = { ...base, kind: 'frame' }
    }
  }

  const probe: LayoutProbe = {
    ...readProbe(el, cs, parentCs),
    id,
    children: childProbes,
  }

  return { node, probe }
}

/** Порядок отрисовки считается вторым проходом: он требует готового дерева.
 *
 *  Промах по карте — НЕ данные, которые надо продиагностировать, а
 *  рассинхрон дерева узлов и дерева проб, то есть баг продюсера. Он обязан
 *  убить захват здесь, в расширении. Мягкий вариант `?? 0` присвоил бы
 *  нулевой порядок всем непопавшим узлам, а на 50 000 узлов это даёт
 *  сообщение об ошибке на 7,8 МБ в UI плагина Figma — измерено. */
const applyPaintOrder = (
  node: IrNode,
  order: Map<string, number>,
  contexts: Set<string>,
): void => {
  const resolved = order.get(node.id)
  if (resolved === undefined) {
    throw new Error(
      `Порядок отрисовки не содержит узла ${node.id} (${node.sourceTag}). ` +
      `Дерево узлов и дерево проб рассинхронизированы — это баг сериализатора.`,
    )
  }
  node.paintOrder = resolved
  node.isStackingContext = contexts.has(node.id)
  for (const child of node.children) applyPaintOrder(child, order, contexts)
}

/** Собирает идентификаторы узлов, создающих stacking context.
 *  Признак вычисляется тем же предикатом, что использует резолвер, —
 *  дублировать его логику нельзя, иначе два места разойдутся. Плагин
 *  восстановить признак не может: ни `transform`, ни `filter`, ни
 *  `isolation` по отдельности в IR не лежат. */
const collectStackingContexts = (probe: LayoutProbe, out: Set<string>): void => {
  if (establishesStackingContext(probe)) out.add(probe.id)
  for (const child of probe.children) collectStackingContexts(child, out)
}

/** Собирает требования к шрифтам из текстовых узлов поддерева.
 *
 *  Данные есть только здесь, а нужны на уровне бандла: инвариант
 *  `font.uncovered` в `@h2d/ir` требует, чтобы каждое использованное в
 *  тексте семейство было перечислено в `Bundle.fonts`, иначе плагин не
 *  сможет предзагрузить шрифт и создание текста упадёт посреди
 *  построения. Обходчик их не записывает — это не его уровень — но
 *  отдаёт наружу, чтобы сборщику бандла было откуда взять. */
export const collectFonts = (node: IrNode): FontRequirement[] => {
  const seen = new Map<string, FontRequirement>()
  const visit = (current: IrNode): void => {
    if (current.kind === 'text') {
      for (const run of current.text.runs) {
        const key = `${run.usedFamily}|${run.fontWeight}|${run.fontStyle}`
        if (!seen.has(key)) {
          seen.set(key, {
            family: run.usedFamily,
            weight: run.fontWeight,
            style: run.fontStyle,
          })
        }
      }
    }
    for (const child of current.children) visit(child)
  }
  visit(node)
  return [...seen.values()]
}

export const walkDocument = (
  sink: DiagnosticSink,
  allocId: IdAllocator,
): IrNode | null => {
  const ctx: WalkContext = {
    sink,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    allocId,
    insideBrokenTransform: false,
    ancestorMatrix: IDENTITY_MATRIX,
    ancestorInverse: IDENTITY_MATRIX,
    parentOrigin: { x: 0, y: 0 },
  }

  const built = buildNode(document.body, null, ctx)
  if (built === null) return null

  /** Корень — единственный узел, чей `rect` абсолютен, и прокрутку несёт
   *  он один. Все остальные выражены относительно родителя, поэтому
   *  получают её по наследству через вложенность. Складывать её на каждом
   *  уровне, как делал прежний обходчик, теперь означало бы умножить
   *  смещение на глубину дерева. */
  built.node.rect = {
    ...built.node.rect,
    x: built.node.rect.x + window.scrollX,
    y: built.node.rect.y + window.scrollY,
  }

  /** Фон страницы часто объявлен на `<html>`, а обход начинается с `<body>`.
   *  Браузер красит им весь холст, поэтому без переноса тёмная страница
   *  приехала бы на белом фоне. Поймать это ниже по конвейеру нечем:
   *  обход просто не доходит до элемента, где фон объявлен, и в бандле не
   *  остаётся следа — ни валидатору, ни pixel-diff не за что зацепиться. */
  const htmlStyle = window.getComputedStyle(document.documentElement)
  const htmlBackground = parseColor(htmlStyle.backgroundColor)
  if (
    htmlBackground !== null &&
    !isInvisible(htmlBackground) &&
    built.node.style.fills.length === 0
  ) {
    built.node.style.fills = [{ kind: 'solid', color: htmlBackground }]
    sink.report(
      'info', DIAGNOSTIC_CODES.pageBackgroundMoved,
      `Фон страницы объявлен на <html> и перенесён на корневой узел: ` +
      `rgb(${htmlBackground.r},${htmlBackground.g},${htmlBackground.b}).`,
      built.node.id, false,
    )
  }

  const order = resolvePaintOrder(built.probe)
  const contexts = new Set<string>()
  collectStackingContexts(built.probe, contexts)
  applyPaintOrder(built.node, order, contexts)

  for (const id of findApproximatedOrder(built.probe)) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.paintOrderApproximated,
      'Порядок отрисовки приближён: у этого узла position задан, а ' +
      'z-index равен auto, поэтому по CSS его позиционированные потомки ' +
      'должны участвовать в стекинге предка, а не его собственном. ' +
      'Резолвер считает узел атомарным — порядок может отличаться.',
      id, false,
    )
  }

  for (const id of findInterleaved(built.probe, order)) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.paintOrderInterleaved,
      'Поддерево красится с разрывом: дерево Figma такой порядок выразить ' +
      'не может, потому что там z-порядок задаётся порядком среди сиблингов.',
      id, false,
    )
  }

  return built.node
}
