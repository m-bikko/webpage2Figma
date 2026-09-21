import { describe, expect, it } from 'vitest'
import {
  appliesTransform, decomposeMatrix, hasSkew, parseMatrix, type Matrix,
} from '../src/css/transform.js'

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

  /** Компоненты округляются до шести знаков, потому что именно так их
   *  сериализует Chrome в `getComputedStyle().transform`. Без округления
   *  тест бесполезен: при полной точности `c = −b` и `d = a` дают побитово
   *  точное сокращение, скалярное произведение равно ровно нулю, и
   *  проблема не воспроизводится. Первая редакция этих тестов брала
   *  `Math.cos`/`Math.sin` напрямую и проходила при заведомо неверном
   *  абсолютном допуске. */
  const chromeMatrix = (deg: number, sx: number, sy: number): Matrix => {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const round = (value: number): number => Math.round(value * 1e6) / 1e6
    return {
      a: round(sx * cos), b: round(sx * sin),
      c: round(-sy * sin), d: round(sy * cos),
      e: 0, f: 0,
    }
  }

  it('false для поворота с НЕРАВНОМЕРНЫМ масштабом', () => {
    // Измерено: с абсолютным допуском скалярное произведение здесь равно
    // 1.20e-6 и элемент объявлялся сдвинутым, то есть корректная
    // трансформа отвергалась. После нормировки — 6.02e-8.
    expect(hasSkew(chromeMatrix(37, 5, 4))).toBe(false)
  })

  it('false при большом неравномерном масштабе', () => {
    // Абсолютное произведение 2.41e-5 — в двадцать четыре раза выше
    // допуска. Нормированное 2.51e-9.
    expect(hasSkew(chromeMatrix(37, 120, 80))).toBe(false)
  })

  it('false при повороте с масштабом на другом угле', () => {
    // 23° scale(50,20): абсолютное 3.15e-5, нормированное 3.15e-8.
    expect(hasSkew(chromeMatrix(23, 50, 20))).toBe(false)
  })

  it('true для сдвига даже при большом масштабе — нормировка не глушит сигнал', () => {
    // skewX(20deg) вместе со scale(100): нормировка обязана сохранить
    // чувствительность, а не списать сдвиг на масштаб.
    expect(hasSkew({
      a: 100, b: 0, c: 100 * 0.364, d: 100, e: 0, f: 0,
    })).toBe(true)
  })

  it('false для единичной матрицы', () => {
    expect(hasSkew({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false)
  })
})

/** Признак, отделяющий «матрица объявлена» от «матрица применена».
 *
 *  Измерено в Chrome: у `<span style="transform:rotate(30deg)">`
 *  `cs.transform` равен `matrix(0.866, 0.5, -0.5, 0.866, 0, 0)`, а
 *  `getBoundingClientRect()` отдаёт НЕповёрнутый строчный бокс — CSS
 *  трансформу к незамещаемым строчным элементам не применяет. У таких
 *  элементов computed `width` равен `auto`, поэтому один и тот же признак
 *  ловит и неприменённую трансформу, и невосстановимый бокс. */
describe('appliesTransform', () => {
  it('true, когда бокс читается из computed style', () => {
    expect(appliesTransform({ width: '120px', height: '60px' })).toBe(true)
  })

  it('false на строчном элементе: computed width равен auto', () => {
    expect(appliesTransform({ width: 'auto', height: 'auto' })).toBe(false)
  })

  it('false, если auto хотя бы в одном измерении', () => {
    expect(appliesTransform({ width: '120px', height: 'auto' })).toBe(false)
  })

  it('true на дробной ширине — округления быть не должно', () => {
    expect(appliesTransform({ width: '12.4531px', height: '18px' })).toBe(true)
  })
})
