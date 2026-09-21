import { describe, expect, it } from 'vitest'
import { decomposeMatrix, hasSkew, parseMatrix } from '../src/css/transform.js'

const round = (value: number): number => Math.round(value * 10000) / 10000

describe('parseMatrix', () => {
  it('разбирает matrix()', () => {
    expect(parseMatrix('matrix(1, 0, 0, 1, 10, 20)'))
      .toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 })
  })

  it('возвращает null на none', () => {
    expect(parseMatrix('none')).toBeNull()
  })

  it('возвращает null на matrix3d — в Figma 3D нет', () => {
    expect(parseMatrix('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)')).toBeNull()
  })
})

describe('decomposeMatrix', () => {
  it('чистый сдвиг', () => {
    const t = decomposeMatrix({ a: 1, b: 0, c: 0, d: 1, e: 10, f: -5 })
    expect(t.translateX).toBe(10)
    expect(t.translateY).toBe(-5)
    expect(round(t.angle)).toBe(0)
    expect(round(t.scaleX)).toBe(1)
    expect(round(t.scaleY)).toBe(1)
  })

  it('чистое масштабирование', () => {
    const t = decomposeMatrix({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 })
    expect(round(t.scaleX)).toBe(2)
    expect(round(t.scaleY)).toBe(3)
    expect(round(t.angle)).toBe(0)
  })

  it('поворот на 90 градусов ПО часовой даёт положительный угол', () => {
    // rotate(90deg) в CSS: matrix(0, 1, -1, 0, 0, 0).
    // Знак здесь и проверяется: отрицательный означал бы перепутанное
    // направление, и повёрнутый блок уехал бы зеркально.
    const t = decomposeMatrix({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 })
    expect(round(t.angle)).toBe(round(Math.PI / 2))
    expect(round(t.scaleX)).toBe(1)
    expect(round(t.scaleY)).toBe(1)
  })

  it('поворот на -45 градусов даёт отрицательный угол', () => {
    const k = Math.SQRT1_2
    const t = decomposeMatrix({ a: k, b: -k, c: k, d: k, e: 0, f: 0 })
    expect(round(t.angle)).toBe(round(-Math.PI / 4))
  })

  it('поворот вместе с масштабом', () => {
    const k = Math.SQRT1_2
    const t = decomposeMatrix({ a: 2 * k, b: 2 * k, c: -2 * k, d: 2 * k, e: 0, f: 0 })
    expect(round(t.angle)).toBe(round(Math.PI / 4))
    expect(round(t.scaleX)).toBe(2)
    expect(round(t.scaleY)).toBe(2)
  })

  it('отрицательный масштаб по вертикали не превращается в поворот', () => {
    const t = decomposeMatrix({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 })
    expect(round(t.angle)).toBe(0)
    expect(round(t.scaleY)).toBe(-1)
  })
})

describe('hasSkew', () => {
  it('false для поворота с масштабом', () => {
    const k = Math.SQRT1_2
    expect(hasSkew({ a: 2 * k, b: 2 * k, c: -2 * k, d: 2 * k, e: 0, f: 0 })).toBe(false)
  })

  it('true для skewX', () => {
    // skewX(20deg) = matrix(1, 0, 0.364, 1, 0, 0)
    expect(hasSkew({ a: 1, b: 0, c: 0.364, d: 1, e: 0, f: 0 })).toBe(true)
  })

  it('false для единичной матрицы', () => {
    expect(hasSkew({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false)
  })
})
