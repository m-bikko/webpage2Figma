import { describe, expect, it } from 'vitest'
import { buildScene } from '../src/build/index.js'
import { bundle as makeBundle, frameNode, nodeText, screen as makeScreen, textRun }
  from '@h2d/ir/test-fixtures'
import type { IrNode } from '@h2d/ir'
import type { SceneNode } from '../src/scene.js'

/** Цвет текста живёт в `fills` ТЕКСТОВОГО УЗЛА.
 *
 *  В Figma у текста нет отдельного свойства цвета: он задаётся
 *  заливкой самого узла. Строитель клал туда заливки ЭЛЕМЕНТА — у
 *  текстового блока их обычно нет вовсе, — и весь текст приезжал
 *  невидимым. Снаружи это выглядело как «текст потерялся»: узлы на
 *  месте, размеры верные, читать нечего.
 *
 *  Найдено на импорте настоящей страницы. Фикстуры этого не
 *  показывали: pixel-diff сравнивает НАШ рендер с браузером, а наш
 *  рендерер берёт цвет из прогона, а не из заливок узла. То есть
 *  ошибка жила ровно в том месте, которое гейт не проверяет по
 *  построению — в переводе IR в термины Figma. */

const red = { r: 220, g: 38, b: 38, a: 1 }

const textNode = (): IrNode => ({
  ...frameNode({ id: 'n1' }),
  kind: 'text',
  text: nodeText({ runs: [textRun({ text: 'привет', color: red })] }),
})

const findText = (node: SceneNode): Extract<SceneNode, { kind: 'text' }> | null => {
  if (node.kind === 'text') return node
  for (const child of node.base.children) {
    const found = findText(child)
    if (found !== null) return found
  }
  return null
}

describe('цвет текста', () => {
  const sceneOf = (root: IrNode) =>
    buildScene(makeBundle({ screens: [makeScreen({ root })] })).screens[0]?.root

  it('текстовый узел получает заливку, а не остаётся пустым', () => {
    const root = sceneOf(textNode())
    expect(root).toBeDefined()
    if (root === undefined) return
    const text = findText(root)
    expect(text).not.toBeNull()
    expect(text?.base.fills.length).toBeGreaterThan(0)
  })

  it('заливка несёт цвет прогона, а не чёрный по умолчанию', () => {
    const root = sceneOf(textNode())
    if (root === undefined) return
    const fill = findText(root)?.base.fills[0]
    expect(fill?.type).toBe('SOLID')
    if (fill?.type !== 'SOLID') return
    expect(fill.color.r).toBeCloseTo(220 / 255, 6)
    expect(fill.color.g).toBeCloseTo(38 / 255, 6)
  })

  /** Прогоны с разными цветами обязаны нести свои заливки: у Figma
   *  цвет задаётся диапазоном символов, и один цвет на весь узел
   *  потерял бы выделенные слова. */
  it('каждый прогон несёт свою заливку', () => {
    const two = {
      ...textNode(),
      text: nodeText({
        runs: [
          textRun({ text: 'красный', color: red }),
          textRun({ text: 'синий', color: { r: 0, g: 0, b: 255, a: 1 } }),
        ] as [ReturnType<typeof textRun>, ...ReturnType<typeof textRun>[]],
      }),
    } as IrNode
    const root = sceneOf(two)
    if (root === undefined) return
    const text = findText(root)
    expect(text?.text.runs).toHaveLength(2)
    const first = text?.text.runs[0]?.fills[0]
    const second = text?.text.runs[1]?.fills[0]
    expect(first).not.toEqual(second)
  })
})
