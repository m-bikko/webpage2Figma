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

  /** Неравные стороны через одиночную обводку SVG невыразимы вовсе:
   *  у неё одна ширина на весь путь. Рендерер брал максимум и рисовал
   *  рамку 8px там, где CSS рисует 2px, — pixel-diff фикстуры `boxes`
   *  показывал это как 1744 расходящихся пикселя. */
  const uneven = (): IrNode => {
    const node = frame()
    node.style.stroke = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: { top: 2, right: 0, bottom: 8, left: 0 },
      style: 'solid', align: 'inside',
    }
    return node
  }

  it('неравные стороны рисуются кольцом, а не обводкой одной ширины', () => {
    const svg = renderScreenToSvg(screen(uneven()))
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).not.toContain('stroke-width="8"')
  })

  it('кольцо строится по padding box: внутренний контур сдвинут на толщину сторон', () => {
    // Бокс 100×50, верх 2, низ 8 — внутренний контур начинается на y = 2
    // и кончается на y = 42, то есть высота 40, а НЕ 50 - 8 - 8.
    const svg = renderScreenToSvg(screen(uneven()))
    expect(svg).toContain('M 0 2')
    expect(svg).toContain('V 42')
  })

  it('равные стороны кольцом НЕ рисуются: обводка их выражает точно', () => {
    expect(renderScreenToSvg(screen(stroked('solid')))).not.toContain('evenodd')
  })
})

describe('renderScreenToSvg: тени', () => {
  const shadowed = (kind: 'outer' | 'inner'): IrNode => {
    const node = frame()
    node.style.fills = [{ kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } }]
    node.style.shadows = [{
      kind, color: { r: 0, g: 0, b: 0, a: 0.45 },
      offsetX: 0, offsetY: 4, blur: 8, spread: 0,
    }]
    return node
  }

  it('внешняя тень — feDropShadow', () => {
    expect(renderScreenToSvg(screen(shadowed('outer')))).toContain('<feDropShadow')
  })

  /** Прямого примитива для внутренней тени в SVG нет, и раньше
   *  `shadowFilter` просто игнорировал `kind: 'inner'`: узел приезжал
   *  вообще без фильтра, а вместе с ним исчезала тень, которую Figma
   *  через INNER_SHADOW поддерживает. */
  it('внутренняя тень собирается из инверсии альфы, а не игнорируется', () => {
    const svg = renderScreenToSvg(screen(shadowed('inner')))
    expect(svg).toContain('<filter')
    expect(svg).toContain('<feComponentTransfer')
    expect(svg).toContain('tableValues="1 0"')
  })

  it('внутренняя тень обрезается по исходной альфе: она внутри фигуры', () => {
    expect(renderScreenToSvg(screen(shadowed('inner'))))
      .toContain('in2="SourceAlpha" operator="in"')
  })

  /** Фильтры SVG по умолчанию считают в linearRGB, CSS композитит тень
   *  в sRGB. Без этого атрибута градиент тени идёт по другой кривой:
   *  на фикстуре `boxes` это были последние 470 расходящихся пикселей. */
  it('фильтр считается в sRGB, а не в linearRGB по умолчанию', () => {
    expect(renderScreenToSvg(screen(shadowed('outer'))))
      .toContain('color-interpolation-filters="sRGB"')
  })
})

describe('renderScreenToSvg: обрезка содержимого', () => {
  const clipping = (): IrNode => {
    const parent = filled({ r: 200, g: 200, b: 200, a: 1 }, {
      id: 'parent', paintOrder: 0,
      children: [filled({ r: 0, g: 0, b: 255, a: 1 }, {
        id: 'child', paintOrder: 1,
        rect: { x: 0, y: 0, w: 500, h: 40 },
      })],
    })
    parent.style.clip = true
    return parent
  }

  /** Рисование плоское: узлы сортируются по `paintOrder` и теряют
   *  вложенность, а с ней и область обрезки родителя. Пока этого не было,
   *  вылезающий потомок рисовался целиком — на фикстуре `boxes` при
   *  390px это давало 3199 расходящихся пикселей. */
  it('потомок обрезающего узла обёрнут в clip-path', () => {
    const svg = renderScreenToSvg(screen(clipping()))
    expect(svg).toContain('<clipPath id="clip-parent">')
    expect(svg).toContain('<g clip-path="url(#clip-parent)">')
  })

  it('сам обрезающий узел не обрезан: overflow режет содержимое, не себя', () => {
    const svg = renderScreenToSvg(screen(clipping()))
    // Обёртка ровно одна — у потомка.
    expect(svg.match(/<g clip-path=/g)).toHaveLength(1)
  })

  it('без clip обёртки не появляется', () => {
    const node = clipping()
    node.style.clip = false
    expect(renderScreenToSvg(screen(node))).not.toContain('clip-path')
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

  /** `decoration` сериализатор снимал, но рендерер не использовал:
   *  подчёркнутая строка приезжала без линии. Pixel-diff фикстуры `text`
   *  показывал ровно её отсутствие. */
  it('рисует подчёркивание, когда оно есть в ране', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      runs: [{ ...text().runs[0], decoration: 'underline' }],
    }))))
    expect(svg).toContain('text-decoration="underline"')
  })

  it('зачёркивание называется в SVG иначе, чем в контракте', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      runs: [{ ...text().runs[0], decoration: 'strikethrough' }],
    }))))
    expect(svg).toContain('text-decoration="line-through"')
  })

  it('без decoration атрибут не ставится', () => {
    expect(renderScreenToSvg(screen(withText(text()))))
      .not.toContain('text-decoration')
  })

  /** Базовая линия — `y + (h + fontSize * (asc - desc)) / 2`. Для бокса
   *  h = 20 при кегле 16 и Arial это 10 + 5.547 = 15.547. Проверка
   *  пришпиливает и формулу, и значение константы: сдвиг базовой линии
   *  на 0.013 кегля тонет в сглаживании глифов и pixel-diff'ом ловится
   *  только через подчёркивание. */
  it('ставит базовую линию по метрике шрифта, а не по центру бокса', () => {
    const svg = renderScreenToSvg(screen(withText(text())))
    expect(svg).toContain('y="15.5472"')
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
