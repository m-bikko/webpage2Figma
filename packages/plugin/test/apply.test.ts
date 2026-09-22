import { describe, expect, it } from 'vitest'
import { applyScreen, loadFonts, type FigmaLikeNode, type FigmaSurface } from '../src/apply.js'
import type { SceneNode, SceneScreen } from '../src/scene.js'

/** ЧТО ЭТОТ ФАЙЛ ПРОВЕРЯЕТ И ЧЕГО НЕ ПРОВЕРЯЕТ.
 *
 *  Двойник `figma` ниже — это наша имитация, и проверять на ней
 *  верность построения бессмысленно: она подтвердит ровно то, что мы в
 *  неё заложили. Ровно ту ошибку план 4 назвал в задаче про ассеты и
 *  обошёл, унеся проверку в настоящий браузер.
 *
 *  Здесь проверяется ТОЛЬКО ПОРЯДОК действий, который от нашей модели
 *  Figma не зависит: шрифты загружены до текста, дети добавлены после
 *  создания родителя, лестница подстановки шрифта спускается по
 *  ступеням и на каждой отчитывается.
 *
 *  Верность построения проверяется круговым обходом в
 *  `tests/e2e/scene-diff.spec.ts`, а верность нашей модели семантики
 *  Figma — человеком, один раз, в настоящей Figma. */

type Call = { op: string; detail?: string }

const makeFigma = (missing: string[] = []): FigmaSurface & { calls: Call[] } => {
  const calls: Call[] = []
  const node = (op: string): FigmaLikeNode => {
    calls.push({ op })
    const kids: FigmaLikeNode[] = []
    const self: FigmaLikeNode = {
      name: '', x: 0, y: 0, width: 0, height: 0,
      rotation: 0, opacity: 1, blendMode: 'NORMAL',
      fills: [], strokes: [], effects: [],
      /** `resize` ЗАПОМИНАЕТ размеры. Первая редакция только писала
       *  в журнал, и двойник, раскладывая детей, считал их ширину
       *  нулевой — из-за чего «послушная» Figma всё равно клала их не
       *  туда, и проверка отката срабатывала всегда. То есть двойник
       *  был недостаточно точен ровно в том, что проверяет. */
      resize: (width: number, height: number) => {
        calls.push({ op: 'resize' })
        self.width = width
        self.height = height
      },
      /** Дети запоминаются в ЗАМЫКАНИИ, а не через `this`: двойник
       *  переприсваивают (`const append = frame.appendChild`), и метод
       *  теряет получателя. Ошибка тихая — `this` становится
       *  `undefined`, — и стоила отладки. */
      appendedChildren: kids,
      appendChild: (child: FigmaLikeNode) => {
        calls.push({ op: 'appendChild' })
        kids.push(child)
      },
    }
    return self
  }
  return {
    calls,
    createFrame: () => node('createFrame'),
    createRectangle: () => node('createRectangle'),
    createText: () => node('createText') as never,
    createImage: () => ({ hash: 'h' }),
    /** Двойник читает размер ИЗ SVG — так же, как настоящая Figma:
     *  `createNodeFromSvg` берёт габарит из разметки, а не из наших
     *  пожеланий. Без этого сверка размера в применителе сравнивала бы
     *  ожидание с нулём и срабатывала всегда, то есть проверяла бы не
     *  то, что обещает. */
    createNodeFromSvg: (svg: string) => {
      calls.push({ op: 'createNodeFromSvg', detail: svg.slice(0, 40) })
      const self = node('createNodeFromSvg-node')
      const width = /width="([\d.]+)"/.exec(svg)
      const height = /height="([\d.]+)"/.exec(svg)
      self.width = width === null ? 0 : Number(width[1])
      self.height = height === null ? 0 : Number(height[1])
      return self
    },
    loadFontAsync: async (font) => {
      calls.push({ op: 'loadFontAsync', detail: `${font.family}|${font.style}` })
      if (missing.includes(`${font.family}|${font.style}`)) {
        throw new Error('нет такого шрифта')
      }
    },
  }
}

const base = (name: string) => ({
  id: name, name, x: 0, y: 0, width: 10, height: 10, rotation: 0,
  opacity: 1, blendMode: 'NORMAL', fills: [], stroke: null,
  corner: { tl: 0, tr: 0, br: 0, bl: 0 }, effects: [],
  autoLayout: null, isolates: false, children: [],
})

const textNode: SceneNode = {
  kind: 'text', base: base('t'),
  text: {
    characters: 'раз', lineHeight: 20, align: 'left',
    sizing: 'auto-width', lines: [{ x: 0, y: 0, w: 10, h: 20, text: 'раз' }],
    runs: [{ start: 0, end: 3, family: 'Inter', style: 'Bold',
             fontSize: 16, letterSpacing: 0,
             fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
             decoration: 'none' }],
  },
}

const screen = (root: SceneNode): SceneScreen =>
  ({
    id: 's', name: 'S', artboard: 'S 100', width: 100, height: 100, root,
    canvas: { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
  })

/** `applyScreen` отдаёт РАМКУ ЭКРАНА — артборд с холстом, — а корень
 *  сцены лежит в ней первым ребёнком. Тесты про сам корень идут туда. */
const kidsOf = (node: FigmaLikeNode): FigmaLikeNode[] =>
  (node as unknown as { appendedChildren?: FigmaLikeNode[] }).appendedChildren ?? []
const contentOf = (artboard: FigmaLikeNode): FigmaLikeNode => {
  const content = kidsOf(artboard)[0]
  if (content === undefined) throw new Error('рамка экрана пуста')
  return content
}

describe('applyScreen: порядок действий', () => {
  it('шрифты загружаются ДО создания текста', async () => {
    const figma = makeFigma()
    await applyScreen(figma, screen(textNode), [{ family: 'Inter', style: 'Bold' }])
    const load = figma.calls.findIndex((c) => c.op === 'loadFontAsync')
    const create = figma.calls.findIndex((c) => c.op === 'createText')
    expect(load).toBeGreaterThanOrEqual(0)
    expect(load).toBeLessThan(create)
  })

  it('ребёнок добавляется после создания родителя', async () => {
    const parent: SceneNode = {
      kind: 'frame', clipsContent: false,
      base: { ...base('p'), children: [{ kind: 'rect', base: base('c') }] },
    }
    const figma = makeFigma()
    await applyScreen(figma, screen(parent), [])
    const created = figma.calls.findIndex((c) => c.op === 'createFrame')
    const appended = figma.calls.findIndex((c) => c.op === 'appendChild')
    expect(created).toBeLessThan(appended)
  })
})

describe('loadFonts: лестница подстановки', () => {
  it('найденный шрифт берётся как есть и молчит', async () => {
    const figma = makeFigma()
    const out = await loadFonts(figma, [{ family: 'Inter', style: 'Bold' }], 's')
    expect(out.report).toEqual([])
    expect(out.substitutions.get('Inter|Bold')).toEqual({ family: 'Inter', style: 'Bold' })
  })

  /** Уровень error намеренно: метрики строк в IR сняты с фактического
   *  шрифта браузера, и подстановка другого начертания делает их
   *  ложью, а не приближением. */
  it('промах начертания спускается к Regular и отчитывается как error', async () => {
    const figma = makeFigma(['Roboto|Black'])
    const out = await loadFonts(figma, [{ family: 'Roboto', style: 'Black' }], 's')
    expect(out.substitutions.get('Roboto|Black')).toEqual({ family: 'Roboto', style: 'Regular' })
    expect(out.report[0]?.level).toBe('error')
  })

  it('промах семейства спускается к Inter', async () => {
    const figma = makeFigma(['Comic|Bold', 'Comic|Regular'])
    const out = await loadFonts(figma, [{ family: 'Comic', style: 'Bold' }], 's')
    expect(out.substitutions.get('Comic|Bold')).toEqual({ family: 'Inter', style: 'Regular' })
    expect(out.report).toHaveLength(1)
  })

  /** Ступени обязаны идти по порядку: сначала своё семейство, потом
   *  Inter. Прыжок сразу к Inter потерял бы верное семейство с чуть
   *  другим начертанием — самый частый и самый безобидный случай. */
  it('своё семейство пробуется раньше Inter', async () => {
    const figma = makeFigma(['Roboto|Black'])
    await loadFonts(figma, [{ family: 'Roboto', style: 'Black' }], 's')
    const tried = figma.calls.filter((c) => c.op === 'loadFontAsync').map((c) => c.detail)
    expect(tried).toEqual(['Roboto|Black', 'Roboto|Regular'])
  })
})

/** Откат auto-layout при расхождении.
 *
 *  Проверка ПОВЕДЕНИЯ применителя, а не модели Figma, и потому на
 *  двойнике она законна: двойник изображает две разные Figma —
 *  послушную и своенравную, — и проверяется, что применитель на них
 *  реагирует по-разному. Верность самой раскладки двойник не
 *  подтверждает и подтвердить не может. */
describe('auto-layout: включение и откат', () => {
  const withLayout = (): SceneNode => ({
    kind: 'frame', clipsContent: false,
    base: {
      ...base('p'),
      autoLayout: {
        mode: 'HORIZONTAL', itemSpacing: 10,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN',
        expected: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        positioning: ['AUTO', 'AUTO'],
      },
      children: [
        { kind: 'rect', base: { ...base('a'), x: 0, y: 0, width: 10, height: 10 } },
        { kind: 'rect', base: { ...base('b'), x: 20, y: 0, width: 10, height: 10 } },
      ],
    },
  })

  /** Двойник, у которого включение режима ДВИГАЕТ детей — как это
   *  делает настоящая Figma. Без этого проверка была бы пустой:
   *  координаты, выставленные применителем, так и остались бы на
   *  месте, и откат никогда бы не понадобился.
   *
   *  `shift` задаёт, насколько «своенравна» эта Figma. Ноль — она
   *  кладёт детей туда же, куда флекс браузера. */
  const layingOut = (shift: number) => {
    const figma = makeFigma()
    const createFrame = figma.createFrame
    figma.createFrame = () => {
      const frame = createFrame()
      const kids = (frame as unknown as { appendedChildren: FigmaLikeNode[] })
        .appendedChildren
      let mode = 'NONE'
      Object.defineProperty(frame, 'layoutMode', {
        get: () => mode,
        set: (value: string) => {
          mode = value
          if (value === 'NONE') return
          /** Раскладываем детей в ряд, как HORIZONTAL, и сдвигаем на
           *  `shift` — так изображается несовпадение моделей. */
          let x = 0
          for (const kid of kids) {
            kid.x = x + shift
            kid.y = 0
            x += (typeof kid.width === 'number' ? kid.width : 0) + 10
          }
        },
      })
      return frame
    }
    return figma
  }

  it('совпало — режим остаётся включённым', async () => {
    const figma = layingOut(0)
    const { report } = await applyScreen(figma, screen(withLayout()), [])
    expect(report.map((entry) => entry.code))
      .not.toContain('fidelity.auto-layout-rejected')
  })

  it('разошлось — применитель откатывает и отчитывается', async () => {
    const figma = layingOut(7)
    const { report } = await applyScreen(figma, screen(withLayout()), [])
    expect(report.map((entry) => entry.code))
      .toContain('fidelity.auto-layout-rejected')
  })

  /** Откат обязан ВЕРНУТЬ координаты, а не просто снять режим:
   *  иначе узел останется с тем, что успела наставить Figma. */
  it('после отката координаты возвращены', async () => {
    const figma = layingOut(7)
    const { root: artboard } = await applyScreen(figma, screen(withLayout()), [])
    const root = contentOf(artboard)
    const kids = (root as unknown as { appendedChildren?: FigmaLikeNode[] })
      .appendedChildren
    expect(root['layoutMode']).toBe('NONE')
    if (kids === undefined) return
    expect(kids.map((kid) => kid.x)).toEqual([0, 20])
  })
})

/** Векторы: разбор отдан Figma, а результат СВЕРЯЕТСЯ.
 *
 *  Проверки на двойнике здесь законны по тому же признаку, что и у
 *  auto-layout: утверждается поведение ПРИМЕНИТЕЛЯ — каким вызовом он
 *  создаёт узел и как реагирует на размер, который ему вернули. Каким
 *  выйдет сам рисунок, двойник не знает и знать не может; это
 *  проверяет пиксельный гейт на стороне захвата. */
describe('векторы', () => {
  const vector = (svg: string, width: number, height: number): SceneNode => ({
    kind: 'vector', svg,
    base: { ...base('v'), width, height },
  })

  const svgOf = (w: number, h: number) =>
    `<svg width="${w}" height="${h}" viewBox="0 0 24 24"><path d="M0 0"/></svg>`

  /** Главное утверждение. Новый вариант союза молча провалился бы в
   *  ветку `else`, то есть стал бы пустой рамкой: иконка исчезла бы,
   *  не оставив следа ни в отчёте, ни в дереве. Компилятор такого не
   *  ловит — цепочка `if/else` исчерпывающей не обязана быть. */
  it('создаются через createNodeFromSvg, а не рамкой', async () => {
    const figma = makeFigma()
    await applyScreen(figma, screen(vector(svgOf(48, 48), 48, 48)), [])
    const ops = figma.calls.map((call) => call.op)
    expect(ops).toContain('createNodeFromSvg')
    /** Единственная рамка — артборд экрана; сам вектор рамкой не стал. */
    expect(ops.filter((op) => op === 'createFrame')).toHaveLength(1)
  })

  it('сам SVG доезжает до Figma без изменений', async () => {
    const figma = makeFigma()
    const svg = svgOf(48, 48)
    await applyScreen(figma, screen(vector(svg, 48, 48)), [])
    const call = figma.calls.find((c) => c.op === 'createNodeFromSvg')
    expect(call?.detail).toBe(svg.slice(0, 40))
  })

  it('размер совпал — применитель молчит', async () => {
    const figma = makeFigma()
    const { report } = await applyScreen(
      figma, screen(vector(svgOf(48, 48), 48, 48)), [],
    )
    expect(report.map((entry) => entry.code))
      .not.toContain('fidelity.vector-resized')
  })

  /** Расхождение размера НЕ чинится `resize`: в Figma изменение
   *  размера рамки не масштабирует её содержимое, и подогнанная
   *  коробка с прежним рисунком внутри выглядела бы как успех. */
  it('размер разошёлся — применитель отчитывается', async () => {
    const figma = makeFigma()
    const { report } = await applyScreen(
      figma, screen(vector(svgOf(24, 24), 48, 48)), [],
    )
    expect(report.map((entry) => entry.code)).toContain('fidelity.vector-resized')
  })
})

/** Абсолютный ребёнок внутри auto-layout.
 *
 *  Проверяется на двойнике по тому же праву, что и откат: это
 *  поведение ПРИМЕНИТЕЛЯ — какой ребёнок получает `ABSOLUTE` и где
 *  он в итоге стоит. Двойник изображает Figma, которая раскладывает
 *  в ряд всех, кому не сказали стоять на месте. */
describe('auto-layout: абсолютный ребёнок', () => {
  const withBadge = (): SceneNode => ({
    kind: 'frame', clipsContent: false,
    base: {
      ...base('card'),
      autoLayout: {
        mode: 'HORIZONTAL', itemSpacing: 10,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN',
        expected: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 90, y: -5 }],
        positioning: ['AUTO', 'AUTO', 'ABSOLUTE'],
      },
      children: [
        { kind: 'rect', base: { ...base('a'), x: 0, y: 0, width: 10, height: 10 } },
        { kind: 'rect', base: { ...base('b'), x: 20, y: 0, width: 10, height: 10 } },
        { kind: 'rect', base: { ...base('badge'), x: 90, y: -5, width: 8, height: 8 } },
      ],
    },
  })

  /** Двойник кладёт в ряд только тех, кто не ABSOLUTE, — как Figma. */
  const layingOut = () => {
    const figma = makeFigma()
    const createFrame = figma.createFrame
    figma.createFrame = () => {
      const frame = createFrame()
      const kids = (frame as unknown as { appendedChildren: FigmaLikeNode[] })
        .appendedChildren
      let mode = 'NONE'
      Object.defineProperty(frame, 'layoutMode', {
        get: () => mode,
        set: (value: string) => {
          mode = value
          if (value === 'NONE') return
          let x = 0
          for (const kid of kids) {
            if (kid['layoutPositioning'] === 'ABSOLUTE') continue
            kid.x = x
            kid.y = 0
            x += (typeof kid.width === 'number' ? kid.width : 0) + 10
          }
        },
      })
      return frame
    }
    return figma
  }

  it('получает ABSOLUTE и остаётся на своём месте, режим не откатывается', async () => {
    const figma = layingOut()
    const { root: artboard, report } = await applyScreen(figma, screen(withBadge()), [])
    const root = contentOf(artboard)
    const kids = (root as unknown as { appendedChildren: FigmaLikeNode[] })
      .appendedChildren
    expect(kids[2]?.['layoutPositioning']).toBe('ABSOLUTE')
    expect(kids[2]?.x).toBe(90)
    expect(kids[2]?.y).toBe(-5)
    expect(root['layoutMode']).toBe('HORIZONTAL')
    expect(report.map((entry) => entry.code))
      .not.toContain('fidelity.auto-layout-rejected')
  })
})

/** Сбой одного узла не валит импорт. Двойник отвергает присваивание
 *  у одного ребёнка — как Figma отвергает отрицательный отступ, — и
 *  проверяется, что остальные построены, а причина записана. */
describe('applyScreen: изоляция сбоев', () => {
  it('сломавшийся ребёнок пропускается, братья строятся, причина в отчёте', async () => {
    const figma = makeFigma()
    const createRectangle = figma.createRectangle
    let made = 0
    figma.createRectangle = () => {
      const rect = createRectangle()
      made += 1
      if (made === 2) {
        Object.defineProperty(rect, 'opacity', {
          set: () => { throw new Error('Property "opacity" failed validation') },
        })
      }
      return rect
    }
    const parent: SceneNode = {
      kind: 'frame', clipsContent: false,
      base: {
        ...base('p'),
        children: [
          { kind: 'rect', base: base('a') },
          { kind: 'rect', base: base('b') },
          { kind: 'rect', base: base('c') },
        ],
      },
    }
    const { root: artboard, report } = await applyScreen(figma, screen(parent), [])
    const kids = kidsOf(contentOf(artboard))
    expect(kids.map((kid) => kid.name)).toEqual(['a', 'c'])
    const failed = report.find((entry) => entry.code === 'fidelity.node-failed')
    expect(failed?.nodeId).toBe('b')
    expect(failed?.message).toContain('failed validation')
  })
})
