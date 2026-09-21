import { describe, expect, it } from 'vitest'
import type { ImagePlacement, IrNode, NodeText, Screen } from '@w2f/ir'
import { renderScreenToSvg } from '../src/render.js'

const frame = (o: Partial<Omit<IrNode, 'kind'>> = {}): IrNode => ({
  kind: 'frame',
  id: 'n0', sourceTag: 'div', name: 'div',
  rect: { x: 0, y: 0, w: 100, h: 50 },
  paintOrder: 0, isStackingContext: false, transform: null,
  layout: { mode: 'none', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 },
            align: 'start', justify: 'start', wrap: false },
  selfLayout: { positioning: 'flow', align: null, grow: 0, shrink: 1,
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                marginAuto: { horizontal: false, vertical: false } },
  style: { fills: [], stroke: null, corner: { tl: 0, tr: 0, br: 0, bl: 0 },
           shadows: [], opacity: 1, blend: 'normal', blur: null, clip: false },
  children: [],
  ...o,
})

/** Заливка поверх переданного стиля, а не ВМЕСТО него.
 *
 *  Раньше `style` из `o` молча отбрасывался: ключ шёл после `...o` и
 *  затирал его целиком. Пока фикстуры задавали эффекты мутацией
 *  (`node.style.opacity = ...`), это не проявлялось, но тест на групповой
 *  эффект, передающий `style` через переопределения, получал бы узел с
 *  `opacity: 1` — то есть проверял бы не то условие, которое называет. */
const filled = (color: { r: number; g: number; b: number; a: number },
                o: Partial<Omit<IrNode, 'kind'>> = {}): IrNode =>
  frame({
    ...o,
    style: { ...(o.style ?? frame().style), fills: [{ kind: 'solid', color }] },
  })

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
   *  `effectsFilter` просто игнорировал `kind: 'inner'`: узел приезжал
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

describe('renderScreenToSvg: размытие слоя', () => {
  const blurred = (blur: { layer: number; background: number }): IrNode => {
    const node = filled({ r: 99, g: 102, b: 241, a: 1 })
    node.style.blur = blur
    return node
  }

  const withShadow = (kind: 'outer' | 'inner', layer: number): IrNode => {
    const node = blurred({ layer, background: 0 })
    node.style.shadows = [{
      kind, color: { r: 0, g: 0, b: 0, a: 0.45 },
      offsetX: 0, offsetY: 4, blur: 8, spread: 0,
    }]
    return node
  }

  /** Единица измерения — единственное, что здесь легко перепутать, и
   *  ошибка не выглядит ошибкой: размытие просто вдвое сильнее или
   *  слабее. CSS `blur(4px)` — это стандартное отклонение 4, тогда как
   *  `box-shadow ... 8px` — отклонение 4. Проверяется точное значение,
   *  а не факт наличия примитива: pixel-diff ловит перепутанную единицу
   *  508 пикселями на фикстуре `blur/`, но тест здесь называет причину. */
  it('stdDeviation равен радиусу CSS, а не его половине', () => {
    const svg = renderScreenToSvg(screen(blurred({ layer: 4, background: 0 })))
    expect(svg).toContain('<feGaussianBlur stdDeviation="4"/>')
    expect(svg).not.toContain('stdDeviation="2"')
  })

  it('размытый узел ссылается на фильтр, которого без размытия не было бы', () => {
    const svg = renderScreenToSvg(screen(blurred({ layer: 10, background: 0 })))
    expect(svg).toContain('filter="url(#fx-n0)"')
    expect(svg).toContain('color-interpolation-filters="sRGB"')
  })

  /** Фоновое размытие рендерер не воспроизводит: дерево плоское, и
   *  «того, что за элементом», у него нет. Пустой `<filter>` в этом
   *  случае был бы хуже отсутствия: ссылка на фильтр без примитивов
   *  оставляет элемент невидимым, то есть узел исчез бы молча. */
  it('одно фоновое размытие не порождает ни фильтра, ни ссылки на него', () => {
    const svg = renderScreenToSvg(screen(blurred({ layer: 0, background: 8 })))
    expect(svg).not.toContain('<filter')
    expect(svg).not.toContain('filter="url(')
  })

  /** Размытие идёт ПОСЛЕ теней в той же цепочке: в CSS `filter`
   *  применяется к уже отрисованному элементу вместе с его
   *  `box-shadow`. Поставленное первым, оно осталось бы неиспользованным
   *  результатом, потому что первая `feDropShadow` берёт `SourceGraphic`
   *  явно — то есть размытие молча пропало бы на узле с тенью. */
  it('на узле с тенью размытие не теряется и стоит в конце цепочки', () => {
    const svg = renderScreenToSvg(screen(withShadow('outer', 6)))
    const blurAt = svg.indexOf('<feGaussianBlur stdDeviation="6"/>')
    const dropAt = svg.indexOf('<feDropShadow')
    expect(blurAt).toBeGreaterThan(-1)
    expect(blurAt).toBeGreaterThan(dropAt)
  })

  it('внутренняя тень вместе с размытием сохраняет свои примитивы', () => {
    const svg = renderScreenToSvg(screen(withShadow('inner', 6)))
    expect(svg).toContain('<feComponentTransfer')
    expect(svg).toContain('in2="SourceAlpha" operator="in"')
    expect(svg).toContain('<feGaussianBlur stdDeviation="6"/>')
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

describe('renderScreenToSvg: вложенность и групповые эффекты', () => {
  const withChild = (
    parentOverrides: Partial<Omit<IrNode, 'kind'>>,
    childOverrides: Partial<Omit<IrNode, 'kind'>> = {},
  ): IrNode => filled({ r: 1, g: 1, b: 1, a: 1 }, {
    id: 'parent', paintOrder: 1,
    rect: { x: 0, y: 0, w: 100, h: 100 },
    ...parentOverrides,
    children: [filled({ r: 2, g: 2, b: 2, a: 1 }, {
      id: 'child', paintOrder: 2,
      rect: { x: 10, y: 10, w: 20, h: 20 },
      ...childOverrides,
    })],
  })

  it('координаты ребёнка складываются с родительскими', () => {
    const root = filled({ r: 9, g: 9, b: 9, a: 1 }, {
      id: 'root', paintOrder: 0,
      rect: { x: 5, y: 7, w: 200, h: 200 },
      children: [withChild({ rect: { x: 20, y: 30, w: 100, h: 100 } })],
    })
    const svg = renderScreenToSvg(screen(root))
    // Ребёнок: 5 + 20 + 10 = 35 по x, 7 + 30 + 10 = 47 по y.
    expect(svg).toContain('x="35"')
    expect(svg).toContain('y="47"')
  })

  it('узел с прозрачностью оборачивается в группу', () => {
    const root = withChild({
      isStackingContext: true,
      style: { ...frame().style, opacity: 0.5 },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg).toContain('<g opacity="0.5"')
  })

  it('прозрачность применяется к ГРУППЕ, а не к каждому узлу', () => {
    // Ключевое отличие от плоского рендера. Если прозрачность стоит на
    // каждой фигуре отдельно, перекрывающиеся потомки просвечивают друг
    // через друга — измерено как 6000 расходящихся пикселей.
    const root = withChild({
      isStackingContext: true,
      style: { ...frame().style, opacity: 0.5 },
    })
    const svg = renderScreenToSvg(screen(root))
    const shapeOpacities = svg.match(/<rect[^>]*opacity="0\.5"/g) ?? []
    expect(shapeOpacities, 'прозрачность не должна дублироваться на фигурах')
      .toHaveLength(0)
  })

  it('размытие применяется к группе целиком', () => {
    const root = withChild({
      isStackingContext: true,
      style: { ...frame().style, blur: { layer: 4, background: 0 } },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg).toMatch(/<g[^>]*filter="url\(#/)
  })

  it('трансформа группы не применяется к детям повторно', () => {
    // Дети выражены в системе родителя, поэтому трансформа на группе
    // действует на них автоматически. Отдельной трансформы у ребёнка
    // быть не должно.
    const root = withChild({
      isStackingContext: true,
      transform: {
        angle: 0.2, scaleX: 1, scaleY: 1,
        translateX: 0, translateY: 0, originX: 50, originY: 50,
      },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.match(/rotate\(/g) ?? []).toHaveLength(1)
  })

  it('размытие не применяется дважды — на группе и на фигуре', () => {
    // Оставить эффект на обоих означало бы наложить размытие поверх
    // размытия: визуально правдоподобно и вдвое сильнее нужного.
    const root = withChild({
      isStackingContext: true,
      style: { ...frame().style, blur: { layer: 4, background: 0 } },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.match(/filter="url\(#blur-/g) ?? [],
      'фильтр размытия должен встретиться ровно один раз').toHaveLength(1)
  })

  /** Отдельно от предыдущего: там считаются ССЫЛКИ на фильтр, здесь —
   *  сам примитив. Снятие размытия с фигуры обязано убрать и определение
   *  фильтра, иначе в `<defs>` остаётся мёртвый `fx-parent`, а вместе с
   *  ним и сомнение, применяется ли он где-то ещё. */
  it('размытие не оставляет собственного фильтра на фигуре', () => {
    const root = withChild({
      isStackingContext: true,
      style: { ...frame().style, blur: { layer: 4, background: 0 } },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg).not.toContain('id="fx-parent"')
  })

  it('изолирующая группа получает isolation', () => {
    const root = withChild({
      isStackingContext: true,
      style: { ...frame().style, opacity: 0.5 },
    })
    expect(renderScreenToSvg(screen(root))).toContain('isolation:isolate')
  })


  it('узел БЕЗ эффектов не создаёт лишней группы', () => {
    const root = withChild({})
    const svg = renderScreenToSvg(screen(root))
    expect(svg.match(/<g/g) ?? [], 'плоские узлы не должны обрастать группами')
      .toHaveLength(0)
  })

  /** Этот тест утверждал ОБРАТНОЕ — что контекст без эффектов группы не
   *  получает, раз обёртка «ничего не меняет в картинке». Меняет: всякий
   *  stacking context изолирует наложение потомков.
   *
   *  Измерено на `blend-isolated`: блок `position:relative; z-index:1`
   *  поверх красного держит чистый зелёный [34,197,94], а стоит убрать
   *  один только `z-index` — чернеет до [32,53,25]. Тест в прежнем виде
   *  прикрывал дефект, из-за которого зелёный чернел и у нас. */
  it('stacking context БЕЗ эффектов всё равно создаёт изолирующую группу', () => {
    const root = withChild({ isStackingContext: true })
    const svg = renderScreenToSvg(screen(root))
    expect(svg).toContain('isolation:isolate')
  })

  it('порядок отрисовки внутри группы сохраняется', () => {
    const root = filled({ r: 9, g: 9, b: 9, a: 1 }, {
      id: 'root', paintOrder: 0,
      isStackingContext: true,
      style: { ...frame().style, opacity: 0.5 },
      children: [
        filled({ r: 1, g: 1, b: 1, a: 1 }, { id: 'late', paintOrder: 2 }),
        filled({ r: 2, g: 2, b: 2, a: 1 }, { id: 'early', paintOrder: 1 }),
      ],
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.indexOf('rgb(2,2,2)')).toBeLessThan(svg.indexOf('rgb(1,1,1)'))
  })

  /** Боксы строк стали локальными относительно `rect` своего узла, поэтому
   *  рендерер обязан складывать их со смещением узла. Без сложения текст
   *  остался бы там, где его клал прежний абсолютный контракт, а внутри
   *  трансформированной группы преобразовался бы дважды. */
  it('строки текста смещаются вместе с узлом', () => {
    const inner: IrNode = {
      ...frame({ id: 'label', paintOrder: 1, rect: { x: 10, y: 20, w: 40, h: 20 } }),
      kind: 'text',
      text: text({ lines: [{ x: 3, y: 4, w: 40, h: 20, text: 'раз' }] }),
    }
    const root = frame({
      id: 'root', paintOrder: 0,
      rect: { x: 0, y: 0, w: 200, h: 100 },
      children: [inner],
    })
    const svg = renderScreenToSvg(screen(root))
    // x: 10 + 3 = 13; базовая линия: 20 + 4 + (20 + 16 * 0.6934) / 2 = 39.5472.
    // Хвост — шум двоичной дроби: сложение смещения даёт 39.547200000000004,
    // и округлять в рендерере ради красивого литерала было бы подгонкой.
    expect(svg).toContain('x="13"')
    expect(svg).toMatch(/y="39\.5472\d*"/)
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

describe('renderScreenToSvg: изображения', () => {
  const IMAGES = new Map([['a0', {
    dataUri: 'data:image/png;base64,iVBORw0KGgo=', width: 64, height: 32,
  }]])

  const imageNode = (
    placement: ImagePlacement,
    o: Partial<Omit<IrNode, 'kind'>> = {},
    assetId = 'a0',
  ): IrNode => ({ ...frame(o), kind: 'image', image: { assetId, placement } })

  const fit: ImagePlacement =
    { mode: 'fit', offsetX: 10, offsetY: 4, scaleX: 2, scaleY: 2 }

  it('узел изображения рисуется как <image>', () => {
    expect(renderScreenToSvg(screen(imageNode(fit)), IMAGES)).toContain('<image')
  })

  /** Размер — НАТУРАЛЬНЫЙ, умноженный на масштаб, а не размер бокса.
   *  Иначе `contain` растянулся бы на весь бокс и стал неотличим от
   *  `fill`, то есть вся арифметика размещения пропала бы впустую. */
  it('размер берётся из натурального и масштаба, а не из бокса', () => {
    const svg = renderScreenToSvg(screen(imageNode(fit)), IMAGES)
    expect(svg).toContain('width="128"')
    expect(svg).toContain('height="64"')
  })

  /** Пропорции уже учтены в scaleX/scaleY. Дефолтный
   *  `preserveAspectRatio` подогнал бы картинку ВТОРОЙ раз и
   *  перечеркнул бы растяжение при CSS `object-fit: fill`. */
  it('вторая подгонка пропорций отключена', () => {
    expect(renderScreenToSvg(screen(imageNode(fit)), IMAGES))
      .toContain('preserveAspectRatio="none"')
  })

  /** При `cover` нарисованный размер БОЛЬШЕ бокса, и без обрезки
   *  картинка залезла бы на соседей. */
  it('изображение обрезается по боксу узла', () => {
    expect(renderScreenToSvg(screen(imageNode(fit)), IMAGES))
      .toContain('clip-path="url(#')
  })

  /** Отсутствующий ассет НЕ пропускается молча: дыра без следа в SVG
   *  неотличима от прозрачного пикселя, и pixel-diff показал бы
   *  расхождение без объяснения причины. */
  it('неизвестный assetId бросает, а не рисует пустоту', () => {
    expect(() => renderScreenToSvg(screen(imageNode(fit, {}, 'нет-такого')), IMAGES))
      .toThrow(/нет-такого/)
  })

  it('плитка рисуется через pattern', () => {
    const tile: ImagePlacement =
      { mode: 'tile', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
    const svg = renderScreenToSvg(screen(imageNode(tile)), IMAGES)
    expect(svg).toContain('<pattern')
    expect(svg).toContain('width="64"')
  })

  /** Заливка-изображение рисуется тем же кодом, что и узел: разница
   *  только в том, откуда взялась ссылка. Проверка существует потому,
   *  что два пути легко разъезжаются — и тогда фон теряет обрезку или
   *  плитку, а узел нет. */
  it('заливка-изображение рисуется так же, как узел', () => {
    const node = frame({
      style: { ...frame().style, fills: [{ kind: 'image', ref: { assetId: 'a0', placement: fit } }] },
    })
    expect(renderScreenToSvg(screen(node), IMAGES)).toContain('<image')
  })
})
