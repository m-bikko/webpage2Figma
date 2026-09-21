import { describe, expect, it } from 'vitest'
import {
  establishesStackingContext,
  resolvePaintOrder,
} from '../src/stacking.js'
import type { LayoutProbe } from '../src/probe.js'

const probe = (id: string, overrides: Partial<LayoutProbe> = {}): LayoutProbe => ({
  id,
  position: 'static',
  zIndex: 'auto',
  opacity: 1,
  hasTransform: false,
  hasFilter: false,
  hasMixBlendMode: false,
  isIsolated: false,
  isFloat: false,
  isInline: false,
  parentIsFlexOrGrid: false,
  children: [],
  ...overrides,
})

const orderOf = (root: LayoutProbe): string[] => {
  const map = resolvePaintOrder(root)
  return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
}

describe('establishesStackingContext', () => {
  it('позиционированный узел с числовым z-index — создаёт', () => {
    expect(establishesStackingContext(probe('a', { position: 'relative', zIndex: 0 }))).toBe(true)
  })

  it('позиционированный узел с z-index: auto — не создаёт', () => {
    expect(establishesStackingContext(probe('a', { position: 'relative' }))).toBe(false)
  })

  it('opacity меньше единицы — создаёт', () => {
    expect(establishesStackingContext(probe('a', { opacity: 0.5 }))).toBe(true)
  })

  it('transform — создаёт', () => {
    expect(establishesStackingContext(probe('a', { hasTransform: true }))).toBe(true)
  })

  it('position: fixed — создаёт всегда, даже с auto', () => {
    expect(establishesStackingContext(probe('a', { position: 'fixed' }))).toBe(true)
  })

  it('flex-ребёнок с z-index — создаёт, несмотря на position: static', () => {
    expect(establishesStackingContext(
      probe('a', { zIndex: 1, parentIsFlexOrGrid: true }),
    )).toBe(true)
  })
})

describe('resolvePaintOrder', () => {
  it('сохраняет порядок DOM для обычных потоковых узлов', () => {
    const root = probe('root', { children: [probe('a'), probe('b'), probe('c')] })
    expect(orderOf(root)).toEqual(['root', 'a', 'b', 'c'])
  })

  it('кладёт отрицательный z-index под фон родителя по документу, но после самого родителя', () => {
    const root = probe('root', {
      children: [
        probe('flow'),
        probe('under', { position: 'relative', zIndex: -1 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'under', 'flow'])
  })

  it('кладёт положительный z-index поверх потока, независимо от порядка DOM', () => {
    const root = probe('root', {
      children: [
        probe('over', { position: 'relative', zIndex: 5 }),
        probe('flow'),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'flow', 'over'])
  })

  it('сортирует положительные z-index по возрастанию', () => {
    const root = probe('root', {
      children: [
        probe('high', { position: 'relative', zIndex: 10 }),
        probe('low', { position: 'relative', zIndex: 2 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'low', 'high'])
  })

  it('при равном z-index сохраняет порядок DOM', () => {
    const root = probe('root', {
      children: [
        probe('first', { position: 'relative', zIndex: 3 }),
        probe('second', { position: 'relative', zIndex: 3 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'first', 'second'])
  })

  it('изолирует z-index внутри вложенного stacking context', () => {
    // 'inner' имеет z-index 999, но он внутри контекста 'ctx' с z-index 1,
    // поэтому не может перекрыть 'sibling' с z-index 2.
    const root = probe('root', {
      children: [
        probe('ctx', {
          position: 'relative',
          zIndex: 1,
          children: [probe('inner', { position: 'relative', zIndex: 999 })],
        }),
        probe('sibling', { position: 'relative', zIndex: 2 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'ctx', 'inner', 'sibling'])
  })

  it('позиционированные с auto красятся после потоковых', () => {
    const root = probe('root', {
      children: [
        probe('positioned', { position: 'absolute' }),
        probe('flow'),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'flow', 'positioned'])
  })

  // Считать узлы дерева обязательно. Проверка «все индексы уникальны»
  // сама по себе бесполезна: ПРОПАВШИЙ узел делает оставшиеся индексы
  // тривиально уникальными, и такой тест прошёл бы даже на пустой карте.
  // Ровно так и была пропущена потеря поддеревьев у непозиционированных
  // stacking context.
  const countNodes = (p: LayoutProbe): number =>
    1 + p.children.reduce((sum, child) => sum + countNodes(child), 0)

  const expectDensePermutation = (root: LayoutProbe): void => {
    const order = resolvePaintOrder(root)
    const total = countNodes(root)
    expect(order.size, 'испущен индекс не для каждого узла').toBe(total)
    const values = [...order.values()].sort((a, b) => a - b)
    expect(values).toEqual([...Array(total).keys()])
  }

  it('испускает плотную перестановку 0..n-1 по всем узлам', () => {
    expectDensePermutation(probe('root', {
      children: [probe('a', { children: [probe('b')] }), probe('c')],
    }))
  })

  it('не теряет поддерево у stacking context из opacity', () => {
    expectDensePermutation(probe('root', {
      children: [probe('ctx', { opacity: 0.5, children: [probe('kid')] })],
    }))
  })

  it('не теряет поддерево у stacking context из transform, filter, blend и isolation', () => {
    for (const trigger of [
      { hasTransform: true },
      { hasFilter: true },
      { hasMixBlendMode: true },
      { isIsolated: true },
    ]) {
      expectDensePermutation(probe('root', {
        children: [probe('ctx', { ...trigger, children: [probe('kid')] })],
      }))
    }
  })

  it('держит плотность на дереве со всеми видами участников разом', () => {
    expectDensePermutation(probe('root', {
      children: [
        probe('flow', { children: [probe('deep', { children: [probe('deeper')] })] }),
        probe('faded', { opacity: 0.4, children: [probe('in-faded')] }),
        probe('abs', { position: 'absolute', children: [probe('in-abs')] }),
        probe('over', { position: 'relative', zIndex: 4, children: [probe('in-over')] }),
        probe('under', { position: 'relative', zIndex: -2 }),
        probe('floated', { isFloat: true }),
        probe('inl', { isInline: true }),
        probe('flex-kid', { parentIsFlexOrGrid: true, zIndex: 2 }),
      ],
    }))
  })

  // Два теста ниже — ядро задачи. Первая редакция резолвера их не проходила:
  // она бакетировала только ПРЯМЫХ детей контекста, из-за чего
  // позиционированный потомок, спрятанный за обычной потоковой обёрткой,
  // не сравнивался по z-index с соседями обёртки. Остальные тесты этого не
  // ловили, потому что в каждом z-индексированный узел — прямой ребёнок
  // контекста.

  it('поднимает позиционированного потомка из потоковой обёртки в предка-контекст', () => {
    // wrapper не создаёт контекст, поэтому P (z=5) обязан сравниваться
    // с B (z=3) в корневом контексте и красится ПОВЕРХ него.
    const root = probe('root', {
      children: [
        probe('wrapper', {
          children: [probe('P', { position: 'relative', zIndex: 5 })],
        }),
        probe('B', { position: 'relative', zIndex: 3 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'wrapper', 'B', 'P'])
  })

  it('поднимает потомка с отрицательным z-index под фон потоковой обёртки', () => {
    const root = probe('root', {
      children: [
        probe('wrapper', {
          children: [probe('under', { position: 'relative', zIndex: -1 })],
        }),
        probe('sibling'),
      ],
    })
    // under уходит в отрицательный бакет КОРНЕВОГО контекста, то есть
    // красится раньше и обёртки, и её потокового соседа.
    expect(orderOf(root)).toEqual(['root', 'under', 'wrapper', 'sibling'])
  })

  it('не поднимает потомка сквозь узел, который сам создаёт контекст', () => {
    // ctx создаёт контекст (позиционирован и имеет z-index), поэтому
    // inner заперт внутри и не может перекрыть sibling с z-index 2.
    const root = probe('root', {
      children: [
        probe('ctx', {
          position: 'relative',
          zIndex: 1,
          children: [probe('inner', { position: 'relative', zIndex: 999 })],
        }),
        probe('sibling', { position: 'relative', zIndex: 2 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'ctx', 'inner', 'sibling'])
  })

  it('не считает z-index у статичного элемента: случайный z-index: 0 не поднимает его', () => {
    // getComputedStyle возвращает указанное значение и для статики,
    // поэтому копипастный `z-index: 0` не должен менять порядок.
    const root = probe('root', {
      children: [
        probe('static-with-z', { zIndex: 0 }),
        probe('plain'),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'static-with-z', 'plain'])
  })

  it('поднимает flex-ребёнка с z-index сквозь потоковую обёртку — осознанно', () => {
    // По тому же правилу «ближайший предок-КОНТЕКСТ»: flex-ребёнок с
    // числовым z-index создаёт контекст, поэтому участвует в стекинге
    // предка, а не обёртки. Поведение зафиксировано тестом, потому что
    // оно неочевидно и проверять его больше нечем.
    const root = probe('root', {
      children: [
        probe('wrapper', {
          children: [probe('fc', { parentIsFlexOrGrid: true, zIndex: 5 })],
        }),
        probe('sib', { position: 'relative', zIndex: 3 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'wrapper', 'sib', 'fc'])
  })
})
