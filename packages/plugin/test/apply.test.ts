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
    const self: FigmaLikeNode = {
      name: '', x: 0, y: 0, rotation: 0, opacity: 1, blendMode: 'NORMAL',
      fills: [], strokes: [], effects: [],
      resize: () => { calls.push({ op: 'resize' }) },
      appendChild: () => { calls.push({ op: 'appendChild' }) },
    }
    return self
  }
  return {
    calls,
    createFrame: () => node('createFrame'),
    createRectangle: () => node('createRectangle'),
    createText: () => node('createText') as never,
    createImage: () => ({ hash: 'h' }),
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
  corner: { tl: 0, tr: 0, br: 0, bl: 0 }, effects: [], children: [],
})

const textNode: SceneNode = {
  kind: 'text', base: base('t'),
  text: {
    characters: 'раз', lineHeight: 20, align: 'left',
    runs: [{ start: 0, end: 3, family: 'Inter', style: 'Bold',
             fontSize: 16, letterSpacing: 0,
             fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
             decoration: 'none' }],
  },
}

const screen = (root: SceneNode): SceneScreen =>
  ({ id: 's', name: 'S', width: 100, height: 100, root })

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
