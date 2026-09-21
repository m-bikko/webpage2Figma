import { describe, expect, it } from 'vitest'
import { autoLayoutVerdict } from '../src/layout/verdict.js'
import { frameNode } from '@w2f/ir/test-fixtures'
import type { IrNode } from '@w2f/ir'

/** Вердикт отвечает на один вопрос: воспроизводит ли флекс то, что
 *  браузер уже намерил. Браузер здесь оракул — его результат лежит в
 *  `rect` детей.
 *
 *  Осторожность несимметрична намеренно. Ложное «безопасно» ломает
 *  геометрию, ради которой писались шесть планов. Ложное
 *  «небезопасно» оставляет абсолютные координаты — то, что было до
 *  этого плана. Поэтому при любом сомнении вердикт отрицательный. */

const rowParent = (childRects: { x: number; y: number; w: number; h: number }[],
                   o: Partial<IrNode['layout']> = {}): IrNode => {
  const parent = frameNode({ id: 'p', rect: { x: 0, y: 0, w: 300, h: 100 } })
  parent.layout = {
    mode: 'row', gap: 10,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    align: 'start', justify: 'start', wrap: false,
    ...o,
  }
  parent.children = childRects.map((rect, index) =>
    frameNode({ id: `c${index}`, rect }))
  return parent
}

describe('autoLayoutVerdict: раскладка объяснима флексом', () => {
  /** Дети стоят ровно там, куда их ставит флекс: 0, затем 50+10. */
  it('совпадение с измеренным — безопасно', () => {
    const verdict = autoLayoutVerdict(rowParent([
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 60, y: 0, w: 40, h: 20 },
    ]))
    expect(verdict.safe).toBe(true)
  })

  /** Сдвиг одного ребёнка означает, что в CSS есть что-то, чего нет в
   *  нашей модели: `margin`, `order`, `position: relative`. Навязывать
   *  auto-layout нельзя — он этот сдвиг сотрёт. */
  it('сдвиг на пиксель — небезопасно', () => {
    const verdict = autoLayoutVerdict(rowParent([
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 61, y: 0, w: 40, h: 20 },
    ]))
    expect(verdict.safe).toBe(false)
  })
})

describe('autoLayoutVerdict: исключения по построению', () => {
  it('без раскладки — небезопасно', () => {
    expect(autoLayoutVerdict(rowParent([{ x: 0, y: 0, w: 50, h: 20 }],
      { mode: 'none' })).safe).toBe(false)
  })

  /** Перенос строк Figma выражает, но по своим правилам, и совпадение
   *  надо доказывать отдельно. */
  it('перенос строк — небезопасно', () => {
    expect(autoLayoutVerdict(rowParent([{ x: 0, y: 0, w: 50, h: 20 }],
      { wrap: true })).safe).toBe(false)
  })

  /** Абсолютно позиционированный ребёнок в auto-layout встанет в
   *  очередь и сдвинет остальных — ровно тот случай, ради которого в
   *  контракте есть `selfLayout.positioning`. */
  it('абсолютно позиционированный ребёнок — небезопасно', () => {
    const parent = rowParent([
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 60, y: 0, w: 40, h: 20 },
    ])
    const badge = parent.children[1]
    if (badge !== undefined) badge.selfLayout = { ...badge.selfLayout, positioning: 'absolute' }
    expect(autoLayoutVerdict(parent).safe).toBe(false)
  })

  /** `flex-grow` НЕ отвергается: он влияет на размер, а размеры в IR
   *  уже измерены браузером. Если положение сошлось, auto-layout с
   *  фиксированными размерами даёт ту же картину.
   *
   *  Первая редакция его отвергала, и на живой странице это давало 39
   *  отказов из 125 — вторая причина по частоте, и вся она была
   *  перестраховкой. Тест перевёрнут, а не удалён: он сторожит, чтобы
   *  перестраховка не вернулась. */
  it('растягивающийся ребёнок безопасен, если положение сошлось', () => {
    const parent = rowParent([
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 60, y: 0, w: 40, h: 20 },
    ])
    const grower = parent.children[0]
    if (grower !== undefined) grower.selfLayout = { ...grower.selfLayout, grow: 1 }
    expect(autoLayoutVerdict(parent).safe).toBe(true)
  })

  /** Но если положение НЕ сошлось, растяжение не спасает: решает
   *  сравнение, а не признак. */
  it('растягивающийся ребёнок не спасает несошедшееся положение', () => {
    const parent = rowParent([
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 75, y: 0, w: 40, h: 20 },
    ])
    const grower = parent.children[0]
    if (grower !== undefined) grower.selfLayout = { ...grower.selfLayout, grow: 1 }
    expect(autoLayoutVerdict(parent).safe).toBe(false)
  })

  /** Причина обязана называться: «не применили» без объяснения не
   *  говорит дизайнеру, что поправить в вёрстке. */
  it('отказ называет причину', () => {
    const verdict = autoLayoutVerdict(rowParent([{ x: 0, y: 0, w: 50, h: 20 }],
      { wrap: true }))
    expect(verdict.safe).toBe(false)
    if (verdict.safe) return
    expect(verdict.reason).toMatch(/перенос/i)
  })
})

describe('autoLayoutVerdict: допуск', () => {
  /** Браузер отдаёт дробные размеры, и зазор на нескольких детях
   *  накапливает доли пикселя. Требовать точного совпадения значило
   *  бы отвергать раскладки, которые флекс воспроизводит верно. */
  it('доли пикселя не мешают', () => {
    const verdict = autoLayoutVerdict(rowParent([
      { x: 0, y: 0, w: 50.3, h: 20 },
      { x: 60.3, y: 0, w: 40, h: 20 },
      { x: 110.31, y: 0, w: 30, h: 20 },
    ]))
    expect(verdict.safe).toBe(true)
  })
})
