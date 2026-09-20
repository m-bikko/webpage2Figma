// Значение берётся из подпути, а не из барреля: баррель тянет schema.ts,
// то есть zod, который сериализатору не нужен вовсе. Через баррель бандл
// весил 171 КиБ при ~18 КиБ собственного кода, и всё это впрыскивалось
// в каждую захватываемую страницу.
import { DIAGNOSTIC_CODES } from '@h2d/ir/codes'
import type {
  Fill, FontRequirement, IrNode, LayoutAlign, NodeStyle,
  SelfLayout, SelfPositioning,
} from '@h2d/ir'
import { isInvisible, parseColor } from './css/color.js'
import { isEllipticalCorner, readCorner } from './css/corner.js'
import { hasMixedBorderColors, hasNonSolidStroke, readStroke } from './css/stroke.js'
import { parseBoxShadow } from './css/shadow.js'
import type { DiagnosticSink } from './diagnostics.js'
import { isReversed, readLayout } from './layout.js'
import { readProbe, type LayoutProbe } from './probe.js'
import {
  establishesStackingContext, findInterleaved, resolvePaintOrder,
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

type WalkContext = {
  sink: DiagnosticSink
  scrollX: number
  scrollY: number
  allocId: IdAllocator
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

const readFills = (
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): Fill[] => {
  const background = parseColor(cs.backgroundColor)
  if (background === null) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.colorUnparsed,
      `Не удалось разобрать background-color: "${cs.backgroundColor}"`, id, false,
    )
    return []
  }
  if (isInvisible(background)) return []
  return [{ kind: 'solid', color: background }]
}

const BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])

const readStyle = (
  cs: CSSStyleDeclaration,
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
    fills: readFills(cs, sink, id),
    stroke: readStroke(cs),
    corner: readCorner(cs),
    shadows: parseBoxShadow(cs.boxShadow),
    // СОБСТВЕННАЯ непрозрачность, не композитная: плагин вкладывает узлы,
    // и Figma перемножает так же, как браузер. Запекать вниз запрещено.
    opacity: Number.parseFloat(cs.opacity),
    blend,
    blur: null,
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
 *  в принципе, `deferred.*` — то, что реализуется в плане 2. Второе
 *  проверяется инвариантом в `@h2d/ir`: узел с непустым `transform` без
 *  парной диагностики `deferred.transform` отвергается на входе плагина.
 *  Именно так правило «молчаливый fallback — это баг» стало машинным. */
const reportGaps = (
  el: Element,
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): void => {
  if (cs.backgroundImage !== 'none') {
    const repeating = cs.backgroundImage.includes('repeating-')
    sink.report(
      repeating ? 'warning' : 'info',
      repeating ? DIAGNOSTIC_CODES.unsupportedRepeatingGradient
                : DIAGNOSTIC_CODES.deferredGradient,
      `background-image "${cs.backgroundImage.slice(0, 60)}" не переносится в этом плане.`,
      id, false,
    )
  }
  if (cs.transform !== 'none') {
    sink.report(
      'error',
      cs.transform.startsWith('matrix3d')
        ? DIAGNOSTIC_CODES.unsupportedTransform3d
        : DIAGNOSTIC_CODES.deferredTransform,
      `transform "${cs.transform}" не переносится: прямоугольник снят как ` +
      `осепараллельный габарит повёрнутого элемента и потому больше исходного.`,
      id, false,
    )
  }
  const layerBlur = blurRadius(cs.filter)
  const bgBlur = blurRadius(cs.backdropFilter)
  if (layerBlur > 0 || bgBlur > 0) {
    sink.report('info', DIAGNOSTIC_CODES.deferredBlur,
      `Размытие ${layerBlur || bgBlur}px не переносится в этом плане.`, id, false)
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
  if (cs.mixBlendMode !== 'normal') {
    sink.report('info', DIAGNOSTIC_CODES.deferredBlend,
      `mix-blend-mode "${cs.mixBlendMode}" не переносится в этом плане.`, id, false)
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

  const rect = el.getBoundingClientRect()
  const children: IrNode[] = []
  const childProbes: LayoutProbe[] = []

  const ordered = isReversed(cs) ? [...el.children].reverse() : [...el.children]
  for (const child of ordered) {
    const built = buildNode(child, cs, ctx)
    if (built === null) continue
    children.push(built.node)
    childProbes.push(built.probe)
  }

  const base = {
    id,
    sourceTag: el.tagName.toLowerCase(),
    name: el.tagName.toLowerCase(),
    rect: {
      x: rect.left + ctx.scrollX,
      y: rect.top + ctx.scrollY,
      w: rect.width,
      h: rect.height,
    },
    // Заполняется вторым проходом: требует готового дерева.
    paintOrder: -1,
    isStackingContext: false,
    transform: null,
    layout: readLayout(cs),
    selfLayout: readSelfLayout(cs),
    style: readStyle(cs, ctx.sink, id),
    children,
  }

  const placeholder = placeholderFor(el, ctx.sink, id)
  let node: IrNode
  if (placeholder !== null) {
    node = { ...base, kind: 'placeholder', placeholder }
  } else {
    const text = readText(el, cs, ctx.scrollX, ctx.scrollY)
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
  }

  const built = buildNode(document.body, null, ctx)
  if (built === null) return null

  const order = resolvePaintOrder(built.probe)
  const contexts = new Set<string>()
  collectStackingContexts(built.probe, contexts)
  applyPaintOrder(built.node, order, contexts)

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
