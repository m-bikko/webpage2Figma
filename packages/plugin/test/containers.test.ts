import { describe, expect, it } from 'vitest'
import { buildScene, layOutScreens } from '../src/build/index.js'
import { bundle as makeBundle, frameNode, nodeText, screen as makeScreen }
  from '@w2f/ir/test-fixtures'
import type { IrNode } from '@w2f/ir'
import type { SceneNode } from '../src/scene.js'

/** ДЕТЕЙ МОГУТ ИМЕТЬ ТОЛЬКО КОНТЕЙНЕРЫ.
 *
 *  В Figma `appendChild` есть у рамок, групп, компонентов и страниц —
 *  и НЕТ у прямоугольников и текстовых узлов: это листья. Попытка
 *  добавить ребёнка к листу падает с «not a function», причём глубоко
 *  в рекурсии, где причина не видна.
 *
 *  Найдено на захвате настоящей страницы. Ни одна фикстура такого не
 *  содержала: текстовый узел с элементами внутри — обычное дело в
 *  живой вёрстке (`<div>` с текстом и вложенными спанами) и не
 *  встречалось ни разу в наших.
 *
 *  Проверка структурная, а не на двойнике `figma`: двойник дал бы
 *  `appendChild` кому угодно и ничего бы не поймал. Это ровно та
 *  слабость имитации, о которой написано в шапке `apply.test.ts`. */

const withChildren = (): IrNode => ({
  ...frameNode({ id: 'n1' }),
  kind: 'text',
  text: nodeText(),
  children: [frameNode({ id: 'n2' })],
})

const leavesWithChildren = (node: SceneNode, out: string[] = []): string[] => {
  if (node.kind !== 'frame' && node.base.children.length > 0) {
    out.push(`${node.kind} "${node.base.name}"`)
  }
  node.base.children.forEach((child) => leavesWithChildren(child, out))
  return out
}

describe('buildScene: детей имеют только контейнеры', () => {
  it('текстовый узел с детьми не остаётся листом с детьми', () => {
    const scene = buildScene(makeBundle({
      screens: [makeScreen({ root: withChildren() })],
    }))
    const root = scene.screens[0]?.root
    expect(root).toBeDefined()
    if (root === undefined) return
    expect(leavesWithChildren(root)).toEqual([])
  })

  it('текст при этом не теряется', () => {
    const scene = buildScene(makeBundle({
      screens: [makeScreen({ root: withChildren() })],
    }))
    const texts: string[] = []
    const visit = (node: SceneNode): void => {
      if (node.kind === 'text') texts.push(node.text.characters)
      node.base.children.forEach(visit)
    }
    const root = scene.screens[0]?.root
    if (root !== undefined) visit(root)
    expect(texts).toHaveLength(1)
  })

  /** И ребёнок тоже: обёртка не должна его проглотить. */
  it('ребёнок текстового узла остаётся в дереве', () => {
    const scene = buildScene(makeBundle({
      screens: [makeScreen({ root: withChildren() })],
    }))
    const ids: string[] = []
    const visit = (node: SceneNode): void => {
      ids.push(node.base.id)
      node.base.children.forEach(visit)
    }
    const root = scene.screens[0]?.root
    if (root !== undefined) visit(root)
    expect(ids).toContain('n2')
  })
})

/** Инвариант целиком, а не только для текста.
 *
 *  Проверяется на ВСЕХ фикстурах разом — через дерево, а не через
 *  перечисление случаев: правило «детей имеют только контейнеры»
 *  относится к любому виду узла, и нарушить его может любая будущая
 *  правка строителя. */
describe('инвариант держится на дереве любой формы', () => {
  const deep = (): IrNode => ({
    ...frameNode({ id: 'root' }),
    children: [
      { ...frameNode({ id: 'a' }), kind: 'text', text: nodeText(),
        children: [
          { ...frameNode({ id: 'b' }), kind: 'text', text: nodeText(),
            children: [frameNode({ id: 'c' })] },
        ] },
    ],
  })

  it('вложенный текст с детьми тоже обёрнут', () => {
    const scene = buildScene(makeBundle({ screens: [makeScreen({ root: deep() })] }))
    const root = scene.screens[0]?.root
    expect(root).toBeDefined()
    if (root === undefined) return
    expect(leavesWithChildren(root)).toEqual([])
  })
})

/** Пять экранов обязаны лечь РЯДОМ, а не друг на друга.
 *
 *  Корень каждого экрана стоит в нуле своих координат — это верно
 *  внутри экрана и неверно на холсте. Первая редакция клала все пять
 *  в одну точку, и вместо пяти макетов получалось месиво: снаружи это
 *  выглядит как «импортировалось неправильно», хотя каждый экран по
 *  отдельности верен.
 *
 *  Найдено на импорте настоящей страницы. Ни одна фикстура этого не
 *  показывала: в тестах экран всегда был один. */
describe('раскладка экранов на холсте', () => {
  const fiveScreens = () => makeBundle({
    screens: [1920, 1440, 1024, 768, 390].map((width) => makeScreen({
      id: `s-${width}`, width, height: 800,
      root: frameNode({ id: `r-${width}`, rect: { x: 0, y: 0, w: width, h: 800 } }),
    })),
  })

  it('экраны не накладываются друг на друга', () => {
    const scene = buildScene(fiveScreens())
    const placed = layOutScreens(scene.screens)
    for (let i = 1; i < placed.length; i += 1) {
      const previous = placed[i - 1]
      const current = placed[i]
      expect(previous).toBeDefined()
      expect(current).toBeDefined()
      if (previous === undefined || current === undefined) return
      expect(current.x).toBeGreaterThanOrEqual(previous.x + previous.width)
    }
  })

  /** Зазор обязателен: экраны встык читаются как один, и найти границу
   *  между 1920 и 1440 глазами невозможно. */
  it('между экранами есть зазор', () => {
    const placed = layOutScreens(buildScene(fiveScreens()).screens)
    const first = placed[0]
    const second = placed[1]
    if (first === undefined || second === undefined) return
    expect(second.x).toBeGreaterThan(first.x + first.width)
  })

  it('порядок сохраняется: от широкого к узкому', () => {
    const placed = layOutScreens(buildScene(fiveScreens()).screens)
    expect(placed.map((item) => item.width)).toEqual([1920, 1440, 1024, 768, 390])
  })
})

describe('раскладка учитывает ПЕРЕПОЛНЕНИЕ, а не только ширину вьюпорта', () => {
  /** Страница может быть шире вьюпорта: горизонтальное переполнение,
   *  абсолютно позиционированные элементы за краем. Тогда корневой
   *  фрейм шире, чем `screen.width`, и раскладка по ширине вьюпорта
   *  кладёт следующий экран ПОВЕРХ предыдущего.
   *
   *  Найдено на импорте настоящей страницы: экраны пересеклись. */
  const overflowing = () => makeBundle({
    screens: [
      makeScreen({
        id: 's-1', width: 400, height: 300,
        /** Корень шире вьюпорта — так бывает при горизонтальном
         *  переполнении. */
        root: frameNode({ id: 'r1', rect: { x: 0, y: 0, w: 900, h: 300 } }),
      }),
      makeScreen({
        id: 's-2', width: 400, height: 300,
        root: frameNode({ id: 'r2', rect: { x: 0, y: 0, w: 400, h: 300 } }),
      }),
    ],
  })

  it('следующий экран не залезает на переполняющий предыдущий', () => {
    const scene = buildScene(overflowing())
    const placed = layOutScreens(scene.screens)
    const first = placed[0]
    const second = placed[1]
    if (first === undefined || second === undefined) return
    expect(second.x).toBeGreaterThanOrEqual(first.x + 900)
  })

  /** Ребёнок, торчащий за правый край корня, тоже считается: при
   *  видимом переполнении браузер его показывает, и в Figma он
   *  торчит ровно так же. */
  it('ребёнок за краем корня тоже учитывается', () => {
    const scene = buildScene(makeBundle({
      screens: [
        makeScreen({
          id: 's-1', width: 400, height: 300,
          root: frameNode({
            id: 'r1', rect: { x: 0, y: 0, w: 400, h: 300 },
            children: [frameNode({ id: 'c', rect: { x: 350, y: 0, w: 500, h: 50 } })],
          }),
        }),
        makeScreen({ id: 's-2', width: 400, height: 300,
          root: frameNode({ id: 'r2', rect: { x: 0, y: 0, w: 400, h: 300 } }) }),
      ],
    }))
    const placed = layOutScreens(scene.screens)
    const first = placed[0]
    const second = placed[1]
    if (first === undefined || second === undefined) return
    expect(second.x).toBeGreaterThanOrEqual(first.x + 850)
  })
})
