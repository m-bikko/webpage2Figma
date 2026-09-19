import { describe, expect, it } from 'vitest'
import { parseColor, TRANSPARENT } from '../src/css/color.js'
import { parsePx } from '../src/css/length.js'

describe('parseColor', () => {
  it('разбирает rgb()', () => {
    expect(parseColor('rgb(255, 128, 0)')).toEqual({ r: 255, g: 128, b: 0, a: 1 })
  })

  it('разбирает rgba() с дробной альфой', () => {
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })

  it('разбирает современный синтаксис rgb() со слэшем', () => {
    expect(parseColor('rgb(10 20 30 / 0.25)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 })
  })

  it('считает transparent полностью прозрачным', () => {
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual(TRANSPARENT)
  })

  it('возвращает null на нераспознанном значении, когда канвас недоступен', () => {
    expect(parseColor('такого-цвета-нет')).toBeNull()
  })
})

describe('parsePx', () => {
  it('разбирает пиксельные значения', () => {
    expect(parsePx('12px')).toBe(12)
    expect(parsePx('0.5px')).toBe(0.5)
    expect(parsePx('-3px')).toBe(-3)
  })

  it('считает none и auto нулём', () => {
    expect(parsePx('none')).toBe(0)
    expect(parsePx('auto')).toBe(0)
  })

  it('не падает на пустой строке', () => {
    expect(parsePx('')).toBe(0)
  })
})
