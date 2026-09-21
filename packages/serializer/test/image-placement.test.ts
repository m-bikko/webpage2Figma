import { describe, expect, it } from 'vitest'
import { placementFor } from '../src/css/image.js'

/** Бокс и картинка намеренно РАЗНЫХ пропорций: 120/64 = 1.875 против
 *  90/32 = 2.8125. На совпадающих пропорциях `contain` и `cover`
 *  неразличимы, и половина этих проверок стала бы пустой.
 *
 *  Значения `object-position` взяты не из памяти, а из замера в том же
 *  Chromium: ключевые слова приводятся к процентам (`left top` → `0% 0%`),
 *  пара всегда полная. */
const box = { w: 120, h: 90 }
const natural = { w: 64, h: 32 }

describe('placementFor: object-fit', () => {
  /** Растяжение по обеим осям: масштабы РАЗНЫЕ. Единственный случай,
   *  где scaleX !== scaleY, и именно он ловит подмену «посчитать один
   *  масштаб и положить в оба поля». */
  it('fill растягивает по обеим осям независимо', () => {
    const p = placementFor('fill', '50% 50%', box, natural)
    expect(p.scaleX).toBeCloseTo(120 / 64, 6)
    expect(p.scaleY).toBeCloseTo(90 / 32, 6)
    expect(p.offsetX).toBeCloseTo(0, 6)
    expect(p.offsetY).toBeCloseTo(0, 6)
    /** CSS `fill` — это НЕ режим `fill` контракта. Растяжение без
     *  сохранения пропорций Figma режимом не выражает. */
    expect(p.mode).toBe('crop')
  })

  it('contain берёт меньший масштаб и центрирует остаток', () => {
    const p = placementFor('contain', '50% 50%', box, natural)
    expect(p.scaleX).toBeCloseTo(1.875, 6)
    expect(p.scaleY).toBeCloseTo(1.875, 6)
    expect(p.offsetX).toBeCloseTo(0, 6)
    expect(p.offsetY).toBeCloseTo((90 - 32 * 1.875) / 2, 6)
    expect(p.mode).toBe('fit')
  })

  /** cover заполняет бокс, лишнее уходит за края — поэтому смещение
   *  ОТРИЦАТЕЛЬНОЕ. Проверка существует ради знака: `Math.abs`
   *  где-нибудь в формуле прошёл бы все остальные случаи. */
  it('cover берёт больший масштаб и даёт отрицательное смещение', () => {
    const p = placementFor('cover', '50% 50%', box, natural)
    expect(p.scaleX).toBeCloseTo(2.8125, 6)
    expect(p.offsetX).toBeCloseTo((120 - 64 * 2.8125) / 2, 6)
    expect(p.offsetX).toBeLessThan(0)
    expect(p.mode).toBe('fill')
  })

  it('none оставляет натуральный размер', () => {
    const p = placementFor('none', '50% 50%', box, natural)
    expect(p.scaleX).toBe(1)
    expect(p.scaleY).toBe(1)
    expect(p.offsetX).toBeCloseTo((120 - 64) / 2, 6)
  })

  /** scale-down — это min(none, contain). Картинка МЕНЬШЕ бокса,
   *  поэтому побеждает none. Случай выбран так, чтобы отличать
   *  реализацию от «просто contain»: contain увеличил бы до 1.875. */
  it('scale-down не увеличивает картинку', () => {
    expect(placementFor('scale-down', '50% 50%', box, natural).scaleX).toBe(1)
  })
})

describe('placementFor: object-position', () => {
  it('проценты считаются от свободного места, а не от бокса', () => {
    const p = placementFor('none', '100% 0%', box, natural)
    expect(p.offsetX).toBeCloseTo(120 - 64, 6)
    expect(p.offsetY).toBeCloseTo(0, 6)
  })

  it('пиксели кладутся смещением напрямую', () => {
    const p = placementFor('none', '10px 4px', box, natural)
    expect(p.offsetX).toBeCloseTo(10, 6)
    expect(p.offsetY).toBeCloseTo(4, 6)
  })

  /** Неразобранная позиция обязана дать ЦЕНТР, а не ноль: центр —
   *  начальное значение CSS, и молчаливый ноль сдвинул бы картинку
   *  влево и вверх, выглядя при этом как настоящая раскладка. */
  it('неразобранная позиция даёт центр', () => {
    expect(placementFor('none', 'какая-то ерунда', box, natural).offsetX)
      .toBeCloseTo((120 - 64) / 2, 6)
  })
})
