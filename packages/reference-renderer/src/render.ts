import type {
  Corner, IrNode, Rect, Rgba8, Screen, Shadow, Stroke, TextRun,
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

const shadowFilter = (id: string, shadows: Shadow[]): string => {
  const outer = shadows.filter((shadow) => shadow.kind === 'outer')
  if (outer.length === 0) return ''
  const parts = outer.map((shadow) =>
    `<feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" ` +
    `stdDeviation="${shadow.blur / 2}" flood-color="${rgb(shadow.color)}" ` +
    `flood-opacity="${shadow.color.a}"/>`,
  ).join('')
  return `<filter id="${id}" x="-75%" y="-75%" width="250%" height="250%">${parts}</filter>`
}

const renderBox = (node: IrNode, defs: string[]): string => {
  const { style } = node
  const solid = style.fills.find((fill) => fill.kind === 'solid')
  const hasShadow = style.shadows.some((shadow) => shadow.kind === 'outer')
  if (solid === undefined && style.stroke === null && !hasShadow) return ''

  const rect = insetRect(node.rect, style.stroke)
  const attrs: string[] = []

  if (solid !== undefined && solid.kind === 'solid') {
    attrs.push(`fill="${rgb(solid.color)}"`, `fill-opacity="${solid.color.a}"`)
  } else {
    attrs.push('fill="none"')
  }
  if (style.stroke !== null) {
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

  const dash = style.stroke === null ? '' : dashArray(style.stroke)
  const uniform = uniformCorner(style.corner)
  if (uniform === null) {
    return `<path d="${cornerPath(rect, style.corner)}" ${attrs.join(' ')}${dash}/>`
  }
  const rx = uniform > 0 ? ` rx="${uniform}"` : ''
  return (
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"` +
    `${rx} ${attrs.join(' ')}${dash}/>`
  )
}

/** Базовая линия ставится из бокса строки. Коэффициент 0.72 от кегля —
 *  подобранная доля высоты до базовой линии для латиницы и кириллицы;
 *  зафиксирован константой, чтобы расхождение было объяснимо, а не
 *  подкручивалось в разных местах по-разному. */
const BASELINE_RATIO = 0.72

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
      `text-rendering="geometricPrecision" ` +
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

const flatten = (node: IrNode, out: IrNode[]): void => {
  out.push(node)
  for (const child of node.children) flatten(child, out)
}

export const renderScreenToSvg = (screen: Screen): string => {
  const nodes: IrNode[] = []
  flatten(screen.root, nodes)
  nodes.sort((a, b) => a.paintOrder - b.paintOrder)

  const defs: string[] = []
  const body = nodes.map((node) => renderNode(node, defs)).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" ` +
    `height="${screen.height}" viewBox="0 0 ${screen.width} ${screen.height}">` +
    `<defs>${defs.join('')}</defs>${body}</svg>`
  )
}
