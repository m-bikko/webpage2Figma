import { describe, expect, it } from 'vitest'
import { flattenScene } from '../src/build/flatten.js'
import type { SceneNode } from '../src/scene.js'

/** Схлопывание невидимых обёрток.
 *
 *  Круговой обход стережёт ГЛАВНОЕ — что картинка от схлопывания не
 *  изменилась: он сравнивает сцену с браузером и поймает узел,
 *  уехавший хоть на пиксель. Но он не скажет, произошло ли
 *  схлопывание вообще: дерево без единого поднятия рисует ровно то же.
 *
 *  Поэтому здесь проверяется само решение — что схлопывается, что нет
 *  и что происходит с координатами. */

const frame = (id: string, over: Partial<SceneNode['base']> = {},
                clips = false): SceneNode => ({
  kind: 'frame', clipsContent: clips,
  base: {
    id, name: id, x: 0, y: 0, width: 100, height: 100,
    rotation: 0, opacity: 1, blendMode: 'NORMAL',
    fills: [], stroke: null, corner: { tl: 0, tr: 0, br: 0, bl: 0 },
    effects: [], autoLayout: null, isolates: false, children: [],
    ...over,
  },
})

const ids = (node: SceneNode): string[] =>
  [node.base.id, ...node.base.children.flatMap(ids)]

const find = (node: SceneNode, id: string): SceneNode | null => {
  if (node.base.id === id) return node
  for (const child of node.base.children) {
    const hit = find(child, id)
    if (hit !== null) return hit
  }
  return null
}

const paint = [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: 0 }, opacity: 1 }]

describe('flattenScene', () => {
  it('невидимая обёртка исчезает, ребёнок поднимается', () => {
    const root = frame('root', {
      children: [frame('wrap', { children: [frame('kid', { fills: paint })] })],
    })
    const out = flattenScene(root)
    expect(ids(out)).toEqual(['root', 'kid'])
  })

  /** Координаты обязаны сложиться: ребёнок был отсчитан от обёртки, а
   *  встаёт на её место. Забыть об этом значит собрать макет, где
   *  каждый поднятый узел уехал, и тем дальше, чем глубже он лежал. */
  it('координаты поднятого ребёнка складываются со смещением обёртки', () => {
    const root = frame('root', {
      children: [frame('wrap', {
        x: 30, y: 40,
        children: [frame('kid', { x: 5, y: 7, fills: paint })],
      })],
    })
    const kid = find(flattenScene(root), 'kid')
    expect(kid?.base.x).toBe(35)
    expect(kid?.base.y).toBe(47)
  })

  it('схлопывание идёт вглубь: цепочка обёрток исчезает целиком', () => {
    const root = frame('root', {
      children: [frame('a', {
        x: 10,
        children: [frame('b', {
          x: 20,
          children: [frame('c', { x: 5, fills: paint })],
        })],
      })],
    })
    const out = flattenScene(root)
    expect(ids(out)).toEqual(['root', 'c'])
    expect(find(out, 'c')?.base.x).toBe(35)
  })

  /** Пустая невидимая обёртка не рисует ничего и ничего не содержит —
   *  ей в панели слоёв делать нечего. */
  it('пустая невидимая обёртка исчезает совсем', () => {
    const root = frame('root', { children: [frame('ghost')] })
    expect(ids(flattenScene(root))).toEqual(['root'])
  })

  /** Дальше — то, что схлопывать НЕЛЬЗЯ. Ошибка в эту сторону
   *  молчалива: узел исчезает вместе со своим фоном или обрезкой, а
   *  выглядит это как «так и было». */
  it.each([
    ['заливкой', { fills: paint }],
    ['обводкой', { stroke: { paint: paint[0]!, weight: { top: 1, right: 1, bottom: 1, left: 1 }, dashPattern: [] } }],
    ['эффектом', { effects: [{ type: 'DROP_SHADOW' as const, color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true, blendMode: 'NORMAL' as const }] }],
    ['непрозрачностью', { opacity: 0.5 }],
    ['режимом наложения', { blendMode: 'MULTIPLY' }],
    ['поворотом', { rotation: 10 }],
    ['скруглением', { corner: { tl: 4, tr: 4, br: 4, bl: 4 } }],
  ])('обёртка с %s остаётся', (_name, over) => {
    const root = frame('root', {
      children: [frame('wrap', { ...over, children: [frame('kid', { fills: paint })] })],
    })
    expect(ids(flattenScene(root))).toContain('wrap')
  })

  it('обёртка с обрезкой остаётся', () => {
    const wrap = frame('wrap', { children: [frame('kid', { fills: paint })] }, true)
    const root = frame('root', { children: [wrap] })
    expect(ids(flattenScene(root))).toContain('wrap')
  })

  /** Auto-layout держит детей, и убрать его носителя значит рассыпать
   *  раскладку. */
  it('обёртка с auto-layout остаётся', () => {
    const layout = {
      mode: 'HORIZONTAL' as const, itemSpacing: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      primaryAxisAlignItems: 'MIN' as const, counterAxisAlignItems: 'MIN' as const,
      expected: [],
    }
    const root = frame('root', {
      children: [frame('wrap', {
        autoLayout: layout, children: [frame('kid', { fills: paint })],
      })],
    })
    expect(ids(flattenScene(root))).toContain('wrap')
  })

  /** И зеркальный случай: поднять детей В auto-layout нельзя — они
   *  стали бы элементами чужой раскладки и встали в ряд вместо своего
   *  места. Ребёнок здесь МЕНЬШЕ обёртки: именно это и делает замену
   *  небезопасной. */
  const vertical = {
    mode: 'VERTICAL' as const, itemSpacing: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    primaryAxisAlignItems: 'MIN' as const, counterAxisAlignItems: 'MIN' as const,
    expected: [],
  }

  it('внутри auto-layout обёртка с ребёнком другого размера остаётся', () => {
    const root = frame('root', {
      autoLayout: vertical,
      children: [frame('wrap', {
        children: [frame('kid', { fills: paint, width: 40, height: 40 })],
      })],
    })
    expect(ids(flattenScene(root))).toContain('wrap')
  })

  it('внутри auto-layout обёртка с двумя детьми остаётся', () => {
    const root = frame('root', {
      autoLayout: vertical,
      children: [frame('wrap', {
        children: [frame('a', { fills: paint }), frame('b', { fills: paint })],
      })],
    })
    expect(ids(flattenScene(root))).toContain('wrap')
  })

  /** Единственное исключение, безопасное ПО ПОСТРОЕНИЮ: ребёнок один и
   *  занимает обёртку целиком. Элемент того же размера на том же месте
   *  раскладки не меняет. На живом figma.com именно такие обёртки
   *  держали глубину: 20 после первого схлопывания, 19 после этого, и
   *  ещё семь процентов узлов. */
  it('внутри auto-layout обёртка, занятая ребёнком целиком, схлопывается', () => {
    const root = frame('root', {
      autoLayout: vertical,
      children: [frame('wrap', {
        x: 10, y: 20,
        children: [frame('kid', { fills: paint })],
      })],
    })
    const out = flattenScene(root)
    expect(ids(out)).toEqual(['root', 'kid'])
    expect(find(out, 'kid')?.base.x).toBe(10)
  })

  /** Корень держит экран целиком: его размер — размер макета. */
  it('корень не схлопывается, даже будучи невидимым', () => {
    const root = frame('root', { children: [frame('kid', { fills: paint })] })
    expect(flattenScene(root).base.id).toBe('root')
  })

  /** Не-фреймы уносить нельзя никогда: текст, картинка и вектор сами
   *  суть содержимое. */
  it('текстовый узел не схлопывается', () => {
    const text: SceneNode = {
      kind: 'text',
      base: { ...frame('t').base, children: [] },
      text: { characters: 'раз', runs: [], lineHeight: 10, align: 'left' },
    }
    const root = frame('root', { children: [text] })
    expect(ids(flattenScene(root))).toContain('t')
  })
})
