import { describe, expect, it } from 'vitest'
import { backgroundPlacementFor } from '../src/css/image.js'

/** Значения взяты замером в том же Chromium, а не из памяти. Важное:
 *  `cover`, `contain` и `auto` в вычисленном стиле остаются СЛОВАМИ и
 *  в пиксели не разворачиваются — значит арифметику надо считать самим,
 *  прочитать готовое нельзя. */
const originBox = { x: 0, y: 0, w: 120, h: 90 }
const natural = { w: 64, h: 32 }

describe('backgroundPlacementFor: размер', () => {
  it('cover ведёт себя как object-fit: cover', () => {
    const p = backgroundPlacementFor('cover', '50% 50%', 'no-repeat', originBox, natural)
    expect(p.scaleX).toBeCloseTo(2.8125, 6)
    expect(p.mode).toBe('fill')
  })

  it('contain ведёт себя как object-fit: contain', () => {
    const p = backgroundPlacementFor('contain', '50% 50%', 'no-repeat', originBox, natural)
    expect(p.scaleX).toBeCloseTo(1.875, 6)
    expect(p.mode).toBe('fit')
  })

  /** `auto` — начальное значение: натуральный размер БЕЗ подгонки под
   *  бокс. Отличие от `contain` принципиально: `contain` увеличил бы до
   *  1.875. Именно эта пара и различает реализацию от «всегда contain». */
  it('auto оставляет натуральный размер', () => {
    const p = backgroundPlacementFor('auto', '0% 0%', 'no-repeat', originBox, natural)
    expect(p.scaleX).toBe(1)
    expect(p.scaleY).toBe(1)
  })

  /** `auto` во второй позиции означает «сохрани пропорцию», а НЕ
   *  «натуральная высота»: иначе картинка поехала бы по вертикали. */
  it('пара значений задаёт размер, auto держит пропорцию', () => {
    const p = backgroundPlacementFor('96px auto', '0% 0%', 'no-repeat', originBox, natural)
    expect(p.scaleX).toBeCloseTo(96 / 64, 6)
    expect(p.scaleY).toBeCloseTo(96 / 64, 6)
  })

  it('проценты в размере считаются от бокса начала отсчёта', () => {
    const p = backgroundPlacementFor('50% 50%', '0% 0%', 'no-repeat', originBox, natural)
    expect(p.scaleX).toBeCloseTo(60 / 64, 6)
    expect(p.scaleY).toBeCloseTo(45 / 32, 6)
  })
})

describe('backgroundPlacementFor: повтор', () => {
  it('repeat даёт режим плитки', () => {
    expect(backgroundPlacementFor('auto', '0% 0%', 'repeat', originBox, natural).mode)
      .toBe('tile')
  })

  /** repeat-x повторяет ТОЛЬКО по горизонтали. Контракт держит один
   *  режим на обе оси и этого не выражает; молча выдать за полную
   *  плитку значило бы залить весь бокс вместо одной полосы. */
  it('repeat-x не выдаётся за полную плитку', () => {
    expect(backgroundPlacementFor('auto', '0% 0%', 'repeat-x', originBox, natural).mode)
      .not.toBe('tile')
  })
})

describe('backgroundPlacementFor: начало отсчёта', () => {
  /** `background-origin` по умолчанию `padding-box`: фон начинается
   *  ВНУТРИ рамки, а `rect` узла — это border box. Смещения обязаны
   *  включать сдвиг начала отсчёта, иначе фон на элементе с рамкой
   *  уедет на её толщину. */
  it('смещение включает сдвиг начала отсчёта', () => {
    const inset = { x: 12, y: 12, w: 96, h: 66 }
    const p = backgroundPlacementFor('contain', '0% 0%', 'no-repeat', inset, natural)
    expect(p.offsetX).toBeCloseTo(12, 6)
    expect(p.offsetY).toBeCloseTo(12, 6)
  })

  it('проценты позиции считаются внутри бокса начала отсчёта', () => {
    const inset = { x: 12, y: 12, w: 96, h: 66 }
    const p = backgroundPlacementFor('auto', '100% 0%', 'no-repeat', inset, natural)
    expect(p.offsetX).toBeCloseTo(12 + (96 - 64), 6)
  })
})
