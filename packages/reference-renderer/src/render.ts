import type {
  Corner, IrNode, Rect, Rgba8, Screen, Shadow, Sides, Stroke, TextRun,
} from '@h2d/ir'

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const rgb = (color: Rgba8): string => `rgb(${color.r},${color.g},${color.b})`

const uniformCorner = (corner: Corner): number | null =>
  corner.tl === corner.tr && corner.tr === corner.br && corner.br === corner.bl
    ? corner.tl
    : null

/** Прямоугольник с разными радиусами углов не выражается через `<rect rx>`,
 *  поэтому строится путь с четырьмя дугами. */
const cornerPath = (rect: Rect, c: Corner): string => {
  const { x, y, w, h } = rect
  return [
    `M ${x + c.tl} ${y}`,
    `H ${x + w - c.tr}`,
    c.tr > 0 ? `A ${c.tr} ${c.tr} 0 0 1 ${x + w} ${y + c.tr}` : '',
    `V ${y + h - c.br}`,
    c.br > 0 ? `A ${c.br} ${c.br} 0 0 1 ${x + w - c.br} ${y + h}` : '',
    `H ${x + c.bl}`,
    c.bl > 0 ? `A ${c.bl} ${c.bl} 0 0 1 ${x} ${y + h - c.bl}` : '',
    `V ${y + c.tl}`,
    c.tl > 0 ? `A ${c.tl} ${c.tl} 0 0 1 ${x + c.tl} ${y}` : '',
    'Z',
  ].filter((segment) => segment !== '').join(' ')
}

const maxWeight = (stroke: Stroke): number => Math.max(
  stroke.weight.top, stroke.weight.right, stroke.weight.bottom, stroke.weight.left,
)

/** Все четыре стороны одной толщины. Разделение существенно: одиночная
 *  обводка SVG имеет ровно одну ширину, поэтому неравные стороны через
 *  неё невыразимы в принципе и требуют другого способа рисования. */
const hasUniformWeight = (stroke: Stroke): boolean =>
  stroke.weight.top === stroke.weight.right
  && stroke.weight.right === stroke.weight.bottom
  && stroke.weight.bottom === stroke.weight.left

/** Прямоугольник, сжатый на толщину границ — это padding box, он же
 *  внутренний край рамки и он же край обрезки `overflow: hidden`. */
const insetBySides = (rect: Rect, sides: Sides): Rect => ({
  x: rect.x + sides.left,
  y: rect.y + sides.top,
  w: Math.max(0, rect.w - sides.left - sides.right),
  h: Math.max(0, rect.h - sides.top - sides.bottom),
})

/** Радиусы внутреннего края рамки. CSS уменьшает радиус на толщину
 *  прилегающей границы; берётся ГОРИЗОНТАЛЬНАЯ сторона — та же
 *  упрощающая договорённость, что и в `isEllipticalCorner` сериализатора,
 *  где эллиптический угол сводится к горизонтальному радиусу. */
const insetCorner = (corner: Corner, sides: Sides): Corner => ({
  tl: Math.max(0, corner.tl - sides.left),
  tr: Math.max(0, corner.tr - sides.right),
  br: Math.max(0, corner.br - sides.right),
  bl: Math.max(0, corner.bl - sides.left),
})

/** SVG рисует обводку ПО ЦЕНТРУ пути, CSS — ВНУТРЬ бокса, и контракт
 *  фиксирует это как `align: 'inside'`. Без сжатия на половину толщины
 *  каждый элемент с границей давал бы расхождение в pixel-diff. */
const insetRect = (rect: Rect, stroke: Stroke | null): Rect => {
  if (stroke === null) return rect
  const half = maxWeight(stroke) / 2
  return {
    x: rect.x + half, y: rect.y + half,
    w: Math.max(0, rect.w - half * 2), h: Math.max(0, rect.h - half * 2),
  }
}

const dashArray = (stroke: Stroke): string => {
  const w = maxWeight(stroke)
  if (stroke.style === 'dashed') return ` stroke-dasharray="${w * 3} ${w * 2}"`
  if (stroke.style === 'dotted') return ` stroke-dasharray="${w} ${w}"`
  return ''
}

/** Внутренняя тень средствами SVG.
 *
 *  Прямого примитива для неё нет, поэтому собирается вручную:
 *  1. альфа исходной фигуры ИНВЕРТИРУЕТСЯ — снаружи непрозрачно,
 *     внутри пусто;
 *  2. инверсия размывается и сдвигается — получается «свет извне»,
 *     затекающий внутрь;
 *  3. заливается цветом тени;
 *  4. обрезается по исходной альфе, чтобы тень осталась ВНУТРИ фигуры.
 *
 *  Шаг 1 имеет смысл только потому, что область фильтра заметно больше
 *  фигуры: инверсия непрозрачна ровно в пределах этой области, и её
 *  запаса должно хватать на размытие со сдвигом. */
const innerShadowPrimitives = (shadow: Shadow, out: string): string =>
  `<feComponentTransfer in="SourceAlpha" result="${out}-inv">` +
  `<feFuncA type="table" tableValues="1 0"/></feComponentTransfer>` +
  `<feGaussianBlur in="${out}-inv" stdDeviation="${shadow.blur / 2}" ` +
  `result="${out}-blur"/>` +
  `<feOffset in="${out}-blur" dx="${shadow.offsetX}" dy="${shadow.offsetY}" ` +
  `result="${out}-off"/>` +
  `<feFlood flood-color="${rgb(shadow.color)}" ` +
  `flood-opacity="${shadow.color.a}" result="${out}-color"/>` +
  `<feComposite in="${out}-color" in2="${out}-off" operator="in" ` +
  `result="${out}-shade"/>` +
  `<feComposite in="${out}-shade" in2="SourceAlpha" operator="in" result="${out}"/>`

/** Область фильтра намеренно велика: тень со сдвигом и размытием легко
 *  выходит за габарит фигуры, а всё, что вышло за область, обрезается
 *  без предупреждения. Для внутренней тени тот же запас нужен с другой
 *  стороны — там в этой области живёт инвертированная альфа. */
const FILTER_REGION = 'x="-75%" y="-75%" width="250%" height="250%"'

/** Фильтры SVG по умолчанию считают в linearRGB, а CSS композитит тень
 *  в sRGB. Без переключения градиент тени идёт по другой кривой, и
 *  pixel-diff показывал полосу у верхнего края внутренней тени, где
 *  расхождение накапливается сильнее всего. */
const FILTER_SPACE = 'color-interpolation-filters="sRGB"'

const shadowFilter = (id: string, shadows: Shadow[]): string => {
  const outer = shadows.filter((shadow) => shadow.kind === 'outer')
  const inner = shadows.filter((shadow) => shadow.kind === 'inner')
  if (outer.length === 0 && inner.length === 0) return ''

  /** Внешние тени цепочкой: каждый `feDropShadow` без `in` берёт
   *  результат предыдущего, поэтому тени накладываются одна на другую,
   *  и в конце цепочки лежит исходная фигура со всеми тенями под ней. */
  const outerParts = outer.map((shadow, index) =>
    `<feDropShadow ${index === 0 ? 'in="SourceGraphic" ' : ''}` +
    `dx="${shadow.offsetX}" dy="${shadow.offsetY}" ` +
    `stdDeviation="${shadow.blur / 2}" flood-color="${rgb(shadow.color)}" ` +
    `flood-opacity="${shadow.color.a}" result="outer${index}"/>`,
  ).join('')
  const base = outer.length === 0 ? 'SourceGraphic' : `outer${outer.length - 1}`

  if (inner.length === 0) {
    return `<filter id="${id}" ${FILTER_REGION} ${FILTER_SPACE}>${outerParts}</filter>`
  }

  const innerParts = inner
    .map((shadow, index) => innerShadowPrimitives(shadow, `inner${index}`))
    .join('')
  /** Внутренние тени кладутся ПОВЕРХ фигуры — они и есть затенение
   *  её собственной поверхности, а не подложка под ней. */
  const merge =
    `<feMerge><feMergeNode in="${base}"/>` +
    inner.map((_, index) => `<feMergeNode in="inner${index}"/>`).join('') +
    `</feMerge>`

  return `<filter id="${id}" ${FILTER_REGION} ${FILTER_SPACE}>${outerParts}${innerParts}${merge}</filter>`
}

/** Рамка с РАЗНЫМИ толщинами сторон.
 *
 *  Одиночная обводка SVG имеет одну ширину на весь путь, поэтому
 *  `border-top: 2px; border-bottom: 8px` через неё невыразим: рендерер
 *  брал максимум и рисовал 8px со всех сторон. Рамка собирается как
 *  ЗАЛИВКА кольца — внешний контур минус внутренний, правило
 *  `evenodd`, — и тогда каждая сторона получает свою толщину точно. */
const borderRing = (node: IrNode, stroke: Stroke): string => {
  const outer = cornerPath(node.rect, node.style.corner)
  const innerRect = insetBySides(node.rect, stroke.weight)
  const inner = cornerPath(innerRect, insetCorner(node.style.corner, stroke.weight))
  return (
    `<path d="${outer} ${inner}" fill-rule="evenodd" ` +
    `fill="${rgb(stroke.color)}" fill-opacity="${stroke.color.a}"/>`
  )
}

const renderBox = (node: IrNode, defs: string[]): string => {
  const { style } = node
  const solid = style.fills.find((fill) => fill.kind === 'solid')
  const hasShadow = style.shadows.length > 0
  if (solid === undefined && style.stroke === null && !hasShadow) return ''

  /** Неравные стороны рисуются кольцом, а не обводкой; тогда заливка
   *  занимает ВЕСЬ border box, как в CSS с `background-clip: border-box`,
   *  и кольцо ложится поверх неё. */
  const ringed = style.stroke !== null
    && !hasUniformWeight(style.stroke)
    && style.stroke.style === 'solid'

  const rect = insetRect(node.rect, ringed ? null : style.stroke)
  const attrs: string[] = []

  if (solid !== undefined && solid.kind === 'solid') {
    attrs.push(`fill="${rgb(solid.color)}"`, `fill-opacity="${solid.color.a}"`)
  } else {
    attrs.push('fill="none"')
  }
  if (style.stroke !== null && !ringed) {
    attrs.push(
      `stroke="${rgb(style.stroke.color)}"`,
      `stroke-opacity="${style.stroke.color.a}"`,
      `stroke-width="${maxWeight(style.stroke)}"`,
    )
  }
  if (style.opacity < 1) attrs.push(`opacity="${style.opacity}"`)
  if (hasShadow) {
    const filterId = `shadow-${node.id}`
    defs.push(shadowFilter(filterId, style.shadows))
    attrs.push(`filter="url(#${filterId})"`)
  }

  const ring = ringed && style.stroke !== null ? borderRing(node, style.stroke) : ''
  const dash = style.stroke === null || ringed ? '' : dashArray(style.stroke)
  const uniform = uniformCorner(style.corner)
  if (uniform === null) {
    return `<path d="${cornerPath(rect, style.corner)}" ${attrs.join(' ')}${dash}/>${ring}`
  }
  const rx = uniform > 0 ? ` rx="${uniform}"` : ''
  return (
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"` +
    `${rx} ${attrs.join(' ')}${dash}/>${ring}`
  )
}

/** Базовая линия ставится из бокса строки: `y + (h + fontSize * R) / 2`.
 *
 *  `LineBox.h` — это НЕ line-height, а высота шрифтового бокса, которую
 *  отдаёт `Range.getClientRects()`: ascent + descent. Подставив
 *  `h = (asc + desc) * fontSize` в формулу и потребовав, чтобы она дала
 *  ровно `y + asc * fontSize`, получаем `R = asc - desc` — коэффициент
 *  перестаёт быть подобранным числом и становится метрикой шрифта.
 *
 *  Для Arial (hhea: ascender 1854/2048, descender 434/2048) это
 *  0.9053 - 0.2119 = 0.6934. Прежнее значение 0.72 опускало базовую
 *  линию примерно на 0.013 кегля: у глифов сдвиг тонул в сглаживании,
 *  но подчёркивание — резкая горизонтальная линия — показывало его
 *  прямо, и pixel-diff фикстуры `text` падал с 1411 до 633 пикселей
 *  от одной этой правки.
 *
 *  Значение шрифтозависимо, а метрик шрифта в IR нет: ставить сюда
 *  величину для конкретного семейства — сознательное упрощение плана 1,
 *  и вся неточность собрана в ОДНОЙ именованной константе. */
const BASELINE_RATIO = 0.6934

/** `decoration` снимается сериализатором, но до этого нигде не рисовалась:
 *  подчёркнутая строка приезжала без линии, и pixel-diff показывал ровно
 *  её отсутствие. Имена в CSS и в контракте не совпадают, поэтому нужна
 *  явная таблица, а не подстановка значения как есть. */
const DECORATION_ATTR: Record<TextRun['decoration'], string> = {
  none: '',
  underline: ' text-decoration="underline"',
  strikethrough: ' text-decoration="line-through"',
}

const renderTextLines = (node: IrNode & { kind: 'text' }): string => {
  const run: TextRun | undefined = node.text.runs[0]
  if (run === undefined) return ''
  const anchor =
    node.text.align === 'center' ? 'middle'
    : node.text.align === 'right' ? 'end'
    : 'start'

  return node.text.lines.map((line) => {
    const x =
      anchor === 'middle' ? line.x + line.w / 2
      : anchor === 'end' ? line.x + line.w
      : line.x
    const baseline = line.y + (line.h + run.fontSize * BASELINE_RATIO) / 2
    return (
      `<text x="${x}" y="${baseline}" text-anchor="${anchor}" ` +
      `dominant-baseline="alphabetic" ` +
      `font-family="${escapeXml(run.usedFamily)}" font-size="${run.fontSize}" ` +
      `font-weight="${run.fontWeight}" font-style="${run.fontStyle}" ` +
      `letter-spacing="${run.letterSpacing}" ` +
      `fill="${rgb(run.color)}" fill-opacity="${run.color.a}" ` +
      `text-rendering="geometricPrecision"${DECORATION_ATTR[run.decoration]} ` +
      `xml:space="preserve">${escapeXml(line.text)}</text>`
    )
  }).join('')
}

/** Заглушка обязана быть ВИДНА: правило проекта запрещает, чтобы
 *  неподдерживаемое содержимое приезжало неотличимо от пустого блока. */
const renderPlaceholder = (node: IrNode & { kind: 'placeholder' }): string => {
  const { x, y, w, h } = node.rect
  return (
    `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, w - 2)}" ` +
    `height="${Math.max(0, h - 2)}" fill="none" stroke="rgb(220,38,38)" ` +
    `stroke-width="2" stroke-dasharray="6 4"/>` +
    `<text x="${x + 6}" y="${y + 18}" font-family="monospace" font-size="12" ` +
    `fill="rgb(220,38,38)" xml:space="preserve">` +
    `${escapeXml(`⚠ ${node.placeholder.label}`)}</text>`
  )
}

/** Исчерпывающий по `kind`: отсутствующая ветка — ошибка компиляции,
 *  а не тихо не нарисованный узел. */
const renderNode = (node: IrNode, defs: string[]): string => {
  switch (node.kind) {
    case 'frame':
      return renderBox(node, defs)
    case 'text':
      return renderBox(node, defs) + renderTextLines(node)
    case 'image':
      // Ассеты в плане 1 не снимаются, поэтому рисуется только бокс.
      // Ветка существует ради исчерпывающего переключения.
      return renderBox(node, defs)
    case 'vector':
      return node.paths.map((path) =>
        `<path d="${path.data}" ` +
        `fill="${path.fill === null ? 'none' : rgb(path.fill)}" ` +
        `${path.stroke === null ? '' : `stroke="${rgb(path.stroke.color)}" ` +
          `stroke-width="${maxWeight(path.stroke)}"`}/>`,
      ).join('')
    case 'placeholder':
      return renderPlaceholder(node)
  }
}

/** Узел вместе с предками, которые его ОБРЕЗАЮТ.
 *
 *  Список нужен именно потому, что рисование плоское: узлы
 *  упорядочиваются по `paintOrder` и теряют вложенность, а вместе с ней
 *  и естественную область обрезки родителя. Без этого `overflow: hidden`
 *  не воспроизводился вовсе — вылезающий потомок рисовался целиком, и
 *  pixel-diff показывал его как расхождение. */
type Placed = { node: IrNode; clippedBy: IrNode[] }

const flatten = (node: IrNode, clippedBy: IrNode[], out: Placed[]): void => {
  out.push({ node, clippedBy })
  /** Себя узел не обрезает: `overflow` режет СОДЕРЖИМОЕ, а собственные
   *  фон, рамка и тень выходят за padding box совершенно законно. */
  const inner = node.style.clip ? [...clippedBy, node] : clippedBy
  for (const child of node.children) flatten(child, inner, out)
}

/** Область обрезки — padding box, то есть border box минус толщины
 *  границ: CSS режет переполнение по внутреннему краю рамки, а не по
 *  внешнему габариту. */
const clipPathDef = (node: IrNode): string => {
  const sides = node.style.stroke?.weight
    ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const rect = insetBySides(node.rect, sides)
  const corner = insetCorner(node.style.corner, sides)
  return (
    `<clipPath id="clip-${node.id}">` +
    `<path d="${cornerPath(rect, corner)}"/></clipPath>`
  )
}

export const renderScreenToSvg = (screen: Screen): string => {
  const placed: Placed[] = []
  flatten(screen.root, [], placed)
  placed.sort((a, b) => a.node.paintOrder - b.node.paintOrder)

  const defs: string[] = []
  const clippers = new Map<string, IrNode>()

  const body = placed.map(({ node, clippedBy }) => {
    const element = renderNode(node, defs)
    if (element === '') return ''
    return clippedBy.reduceRight((inner, clipper) => {
      clippers.set(clipper.id, clipper)
      return `<g clip-path="url(#clip-${clipper.id})">${inner}</g>`
    }, element)
  }).join('')

  for (const clipper of clippers.values()) defs.push(clipPathDef(clipper))

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" ` +
    `height="${screen.height}" viewBox="0 0 ${screen.width} ${screen.height}">` +
    `<defs>${defs.join('')}</defs>${body}</svg>`
  )
}
