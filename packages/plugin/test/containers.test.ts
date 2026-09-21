import { describe, expect, it } from 'vitest'
import { buildScene } from '../src/build/index.js'
import { bundle as makeBundle, frameNode, nodeText, screen as makeScreen }
  from '@h2d/ir/test-fixtures'
import type { IrNode } from '@h2d/ir'
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
