import { describe, expect, it } from 'vitest'
import type { IrNode } from '@w2f/ir'
import { hoistEscaped } from '../src/hoist.js'

/** Перенос всплывших узлов.
 *
 *  Проверяется здесь, а не только пикселями, потому что главное в нём —
 *  РЕШЕНИЕ, переносить или нет, и решение это несимметрично по цене.
 *  Лишний перенос ломает группировку: абсолютный бейдж уезжает из
 *  карточки на верхний уровень, и дизайнер получает разобранный макет
 *  вместо чуть неверного z-порядка. Недостающий перенос оставляет
 *  элемент под тем, что должно лежать под ним.
 *
 *  Пиксели ловят второе и молчат о первом: макет с уехавшим бейджем
 *  выглядит точно так же. Поэтому цена лишнего переноса проверяется
 *  только здесь. */

const node = (id: string, over: Partial<IrNode> = {}): IrNode => ({
  id, sourceTag: 'div', name: 'div', kind: 'frame',
  rect: { x: 0, y: 0, w: 100, h: 100 },
  paintOrder: 0, isStackingContext: false, transform: null,
  layout: {
    mode: 'none', align: 'start', justify: 'start', wrap: false, gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  selfLayout: {
    positioning: 'flow', grow: 0, shrink: 1, align: null,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    marginAuto: { horizontal: false, vertical: false },
  },
  style: {
    fills: [], stroke: null, corner: { tl: 0, tr: 0, br: 0, bl: 0 },
    shadows: [], opacity: 1, blend: 'normal', blur: null, clip: false,
  },
  children: [],
  ...over,
} as IrNode)

const idsUnder = (root: IrNode, id: string): string[] => {
  const find = (current: IrNode): IrNode | null => {
    if (current.id === id) return current
    for (const child of current.children) {
      const hit = find(child)
      if (hit !== null) return hit
    }
    return null
  }
  return find(root)?.children.map((child) => child.id) ?? []
}

describe('hoistEscaped', () => {
  /** Всплывший узел ОБЯЗАН переехать, когда вложенный обход рисует
   *  поверх него то, что должно лежать под ним.
   *
   *  `escaped` красится последним (paintOrder 3), но как ребёнок
   *  `wrap` он будет нарисован сразу за ним, то есть ДО `sibling`, —
   *  и `sibling`, перекрывающий его, ляжет сверху. */
  it('переносит, когда сосед накрывает всплывший узел', () => {
    const escaped = node('escaped', {
      paintOrder: 3, rect: { x: 0, y: 0, w: 100, h: 100 },
    })
    const wrap = node('wrap', { paintOrder: 1, children: [escaped] })
    const sibling = node('sibling', {
      paintOrder: 2, rect: { x: 50, y: 50, w: 100, h: 100 },
    })
    const root = node('root', { isStackingContext: true, children: [wrap, sibling] })

    const result = hoistEscaped(root)
    expect(result.hoisted.map((move) => move.id)).toEqual(['escaped'])
    expect(idsUnder(root, 'root')).toContain('escaped')
    expect(idsUnder(root, 'wrap')).toEqual([])
  })

  /** А вот здесь перенос был бы ВРЕДОМ: `sibling` с всплывшим не
   *  пересекается, значит вложенный обход рисует картинку правильно, и
   *  единственным следствием переноса стала бы разобранная группировка.
   *
   *  Первая редакция критерия переносила и такое — по одному лишь
   *  различию номеров. На фикстуре `absolute-in-flex` из-за этого
   *  уезжал абсолютный ребёнок флекс-карточки. */
  it('НЕ переносит, когда картинка и так верна', () => {
    const escaped = node('escaped', {
      paintOrder: 3, rect: { x: 0, y: 0, w: 40, h: 40 },
    })
    const wrap = node('wrap', { paintOrder: 1, children: [escaped] })
    const sibling = node('sibling', {
      paintOrder: 2, rect: { x: 500, y: 500, w: 100, h: 100 },
    })
    const root = node('root', { isStackingContext: true, children: [wrap, sibling] })

    const result = hoistEscaped(root)
    expect(result.hoisted).toEqual([])
    expect(idsUnder(root, 'wrap')).toEqual(['escaped'])
  })

  /** Координаты обязаны пересчитаться: `rect` в контракте локальный, и
   *  узел, переехавший к другому родителю, без пересчёта уедет на
   *  смещение прежнего. Ошибка тихая — узел на месте, размер верный,
   *  сдвинут ровно на отступ родителя. */
  it('пересчитывает координаты под нового родителя', () => {
    const escaped = node('escaped', {
      paintOrder: 3, rect: { x: 5, y: 7, w: 100, h: 100 },
    })
    const wrap = node('wrap', {
      paintOrder: 1, rect: { x: 30, y: 40, w: 200, h: 200 }, children: [escaped],
    })
    const sibling = node('sibling', {
      paintOrder: 2, rect: { x: 35, y: 47, w: 100, h: 100 },
    })
    const root = node('root', { isStackingContext: true, children: [wrap, sibling] })

    hoistEscaped(root)
    const moved = root.children.find((child) => child.id === 'escaped')
    expect(moved?.rect.x).toBe(35)
    expect(moved?.rect.y).toBe(47)
  })

  /** Трансформа на пути делает сложение смещений неверным: под
   *  поворотом оси родителя не совпадают с осями цели. Такой узел
   *  остаётся на месте, и это обязано попасть в отчёт — иначе неверный
   *  порядок выдавался бы за верный. */
  it('не переносит сквозь трансформу и говорит об этом', () => {
    const escaped = node('escaped', {
      paintOrder: 3, rect: { x: 0, y: 0, w: 100, h: 100 },
    })
    const wrap = node('wrap', {
      paintOrder: 1, children: [escaped],
      transform: {
        angle: 0.5, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0,
        originX: 0, originY: 0,
      },
    })
    const sibling = node('sibling', {
      paintOrder: 2, rect: { x: 50, y: 50, w: 100, h: 100 },
    })
    const root = node('root', { isStackingContext: true, children: [wrap, sibling] })

    const result = hoistEscaped(root)
    expect(result.hoisted).toEqual([])
    expect(result.blockedByTransform).toEqual(['escaped'])
    expect(idsUnder(root, 'wrap')).toEqual(['escaped'])
  })
})
