import { describe, expect, it } from 'vitest'
import type { IrNode, NodeText, Screen } from '@h2d/ir'
import { renderScreenToSvg } from '../src/render.js'

const frame = (o: Partial<Omit<IrNode, 'kind'>> = {}): IrNode => ({
  kind: 'frame',
  id: 'n0', sourceTag: 'div', name: 'div',
  rect: { x: 0, y: 0, w: 100, h: 50 },
  paintOrder: 0, isStackingContext: false, transform: null,
  layout: { mode: 'none', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 },
            align: 'start', justify: 'start', wrap: false },
  selfLayout: { positioning: 'flow', align: null, grow: 0, shrink: 1 },
  style: { fills: [], stroke: null, corner: { tl: 0, tr: 0, br: 0, bl: 0 },
           shadows: [], opacity: 1, blend: 'normal', blur: null, clip: false },
  children: [],
  ...o,
})

const filled = (color: { r: number; g: number; b: number; a: number },
                o: Partial<Omit<IrNode, 'kind'>> = {}): IrNode =>
  frame({ ...o, style: { ...frame().style, fills: [{ kind: 'solid', color }] } })

const text = (o: Partial<NodeText> = {}): NodeText => ({
  runs: [{
    text: 'раз два', fontStack: ['Inter', 'sans-serif'], usedFamily: 'Inter',
    fontWeight: 400, fontStyle: 'normal', fontSize: 16, letterSpacing: 0,
    color: { r: 0, g: 0, b: 0, a: 1 }, decoration: 'none', shadows: [],
  }],
  lines: [{ x: 0, y: 0, w: 40, h: 20, text: 'раз два' }],
  lineHeight: 20, align: 'left',
  ...o,
})

const screen = (root: IrNode): Screen => ({
  id: 's0', name: 'Test', width: 200, height: 100, dpr: 1,
  scroll: { x: 0, y: 0 }, root, screenshotId: null,
})

describe('renderScreenToSvg: геометрия и заливки', () => {
  it('задаёт размеры SVG по экрану', () => {
    const svg = renderScreenToSvg(screen(frame()))
    expect(svg).toContain('width="200"')
    expect(svg).toContain('height="100"')
  })

  it('рендерит сплошную заливку', () => {
    const svg = renderScreenToSvg(screen(filled({ r: 255, g: 0, b: 0, a: 1 })))
    expect(svg).toContain('fill="rgb(255,0,0)"')
    expect(svg).toContain('fill-opacity="1"')
  })

  it('не рендерит rect у пустого фрейма', () => {
    expect(renderScreenToSvg(screen(frame()))).not.toContain('<rect')
  })

  it('рендерит равный радиус через rx', () => {
    const node = filled({ r: 0, g: 0, b: 0, a: 1 })
    node.style.corner = { tl: 8, tr: 8, br: 8, bl: 8 }
    expect(renderScreenToSvg(screen(node))).toContain('rx="8"')
  })

  it('рендерит разные углы через path, а не rect', () => {
    const node = filled({ r: 0, g: 0, b: 0, a: 1 })
    node.style.corner = { tl: 8, tr: 0, br: 16, bl: 0 }
    expect(renderScreenToSvg(screen(node))).toContain('<path')
  })

  it('упорядочивает узлы по paintOrder, а не по вложенности', () => {
    const root = filled({ r: 9, g: 9, b: 9, a: 1 }, {
      id: 'root', paintOrder: 0,
      children: [
        filled({ r: 1, g: 1, b: 1, a: 1 }, { id: 'late', paintOrder: 2 }),
        filled({ r: 2, g: 2, b: 2, a: 1 }, { id: 'early', paintOrder: 1 }),
      ],
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.indexOf('rgb(2,2,2)')).toBeLessThan(svg.indexOf('rgb(1,1,1)'))
  })
})

describe('renderScreenToSvg: обводка', () => {
  const stroked = (style: 'solid' | 'dashed' | 'dotted'): IrNode => {
    const node = frame()
    node.style.stroke = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: { top: 4, right: 4, bottom: 4, left: 4 },
      style, align: 'inside',
    }
    return node
  }

  it('сжимает прямоугольник на половину толщины: CSS рисует внутрь, SVG по центру', () => {
    const svg = renderScreenToSvg(screen(stroked('solid')))
    // Бокс 100×50 с обводкой 4 даёт путь 2,2 96×46.
    expect(svg).toContain('x="2"')
    expect(svg).toContain('y="2"')
    expect(svg).toContain('width="96"')
    expect(svg).toContain('height="46"')
  })

  it('рисует пунктир пунктиром, а не сплошной линией', () => {
    expect(renderScreenToSvg(screen(stroked('dashed')))).toContain('stroke-dasharray')
  })

  it('точечный пунктир отличается от штрихового', () => {
    const dashed = renderScreenToSvg(screen(stroked('dashed')))
    const dotted = renderScreenToSvg(screen(stroked('dotted')))
    expect(dashed).not.toBe(dotted)
  })

  it('сплошная обводка без dasharray', () => {
    expect(renderScreenToSvg(screen(stroked('solid')))).not.toContain('stroke-dasharray')
  })
})

describe('renderScreenToSvg: текст', () => {
  const withText = (t: NodeText): IrNode => ({ ...frame(), kind: 'text', text: t })

  it('рендерит каждую строку своим элементом text', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      lines: [
        { x: 0, y: 0, w: 40, h: 20, text: 'раз' },
        { x: 0, y: 20, w: 40, h: 20, text: 'два' },
      ],
    }))))
    expect(svg.match(/<text/g)).toHaveLength(2)
  })

  it('подставляет usedFamily, а не первое объявленное семейство', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      runs: [{ ...text().runs[0], fontStack: ['Söhne', 'Arial'], usedFamily: 'Arial' }],
    }))))
    expect(svg).toContain('font-family="Arial"')
    expect(svg).not.toContain('font-family="Söhne"')
  })

  it('берёт выравнивание из NodeText', () => {
    const svg = renderScreenToSvg(screen(withText(text({ align: 'center' }))))
    expect(svg).toContain('text-anchor="middle"')
  })

  it('экранирует спецсимволы XML', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      lines: [{ x: 0, y: 0, w: 40, h: 20, text: '<a & b>' }],
    }))))
    expect(svg).toContain('&lt;a &amp; b&gt;')
  })
})

describe('renderScreenToSvg: заглушка видна', () => {
  const placeholder = (): IrNode => ({
    ...frame(),
    kind: 'placeholder',
    placeholder: { code: 'unsupported.canvas', label: 'canvas' },
  })

  it('рисует пунктирную рамку', () => {
    const svg = renderScreenToSvg(screen(placeholder()))
    expect(svg).toContain('stroke-dasharray')
  })

  it('пишет подпись, чтобы причина была видна', () => {
    expect(renderScreenToSvg(screen(placeholder()))).toContain('canvas')
  })

  it('заглушка не невидима: у неё есть и рамка, и текст', () => {
    const svg = renderScreenToSvg(screen(placeholder()))
    expect(svg).toContain('<rect')
    expect(svg).toContain('<text')
  })
})
