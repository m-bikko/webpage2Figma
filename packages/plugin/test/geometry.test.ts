import { describe, expect, it } from 'vitest'
import { figmaRotation, sizeUnderTransform, scaleSubtree } from '../src/build/geometry.js'
import { frameNode } from '@h2d/ir/test-fixtures'
import type { Transform } from '@h2d/ir'

const t = (o: Partial<Transform> = {}): Transform => ({
  angle: 0, scaleX: 1, scaleY: 1,
  translateX: 0, translateY: 0, originX: 0, originY: 0, ...o,
})

/** Градусы в радианы — контракт хранит угол в радианах, Figma принимает
 *  градусы. Хелпер существует, чтобы тест читался в тех единицах, в
 *  которых думает Figma, и не повторял единицы реализации. */
const deg = (value: number): number => (value * Math.PI) / 180

describe('figmaRotation', () => {
  /** Знак проверяется ЯВНО, без Math.abs. Документация Figma:
   *  rotation = atan2(-m10, m00). Наш угол — atan2(b, a), где m10 = b,
   *  значит знаки противоположны. Перепутать их — получить зеркальный
   *  поворот, который выглядит совершенно правдоподобно и не заметен
   *  ни на чём симметричном. */
  it('меняет знак относительно нашего угла', () => {
    expect(figmaRotation(t({ angle: deg(20) }))).toBeCloseTo(-20, 9)
  })

  it('и в обратную сторону тоже', () => {
    expect(figmaRotation(t({ angle: deg(-35) }))).toBeCloseTo(35, 9)
  })

  /** Единицы. Контракт хранит РАДИАНЫ, Figma принимает ГРАДУСЫ.
   *  Первая редакция возвращала просто `-angle`, и тест этого не
   *  поймал: он был написан в тех же единицах, что и код. Прямой угол
   *  выбран потому, что в радианах это ≈1.5708, а в градусах 90 —
   *  перепутать их незаметно невозможно. */
  it('отдаёт градусы, а не радианы', () => {
    expect(figmaRotation(t({ angle: Math.PI / 2 }))).toBeCloseTo(-90, 9)
  })

  /** `-0` — не косметика: он утекает в JSON как `-0`, ломает сравнение
   *  снапшотов и в Figma может отличаться от `0` при дальнейших
   *  вычислениях. Та же причина, по которой план 2 сворачивал `-0` в
   *  нормализации градиентов. */
  it('нулевой поворот остаётся нулём, а не минус нулём', () => {
    expect(Object.is(figmaRotation(t({ angle: 0 })), 0)).toBe(true)
  })

  it('отсутствие трансформы — нулевой поворот', () => {
    expect(figmaRotation(null)).toBe(0)
  })
})

describe('sizeUnderTransform', () => {
  /** Масштаб в relativeTransform класть НЕЛЬЗЯ: у него единичные оси
   *  (sqrt(m00²+m10²) == 1 по документации). Он обязан уйти в размеры. */
  it('масштаб уходит в размеры, а не в матрицу', () => {
    expect(sizeUnderTransform({ w: 100, h: 50 }, t({ scaleX: 2, scaleY: 3 })))
      .toEqual({ width: 200, height: 150 })
  })

  it('без трансформы размеры не меняются', () => {
    expect(sizeUnderTransform({ w: 100, h: 50 }, null))
      .toEqual({ width: 100, height: 50 })
  })

  /** Поворот размеров НЕ меняет: в Figma повёрнутый узел сохраняет
   *  свои width/height, поворот живёт отдельно. Подстановка габарита
   *  повёрнутого прямоугольника раздула бы узел — ровно тот дефект,
   *  который план 1 диагностировал как transform-descendant. */
  it('поворот размеров не меняет', () => {
    expect(sizeUnderTransform({ w: 100, h: 50 }, t({ angle: 45 })))
      .toEqual({ width: 100, height: 50 })
  })
})

describe('scaleSubtree', () => {
  /** `resize` в Figma детей НЕ масштабирует, в отличие от CSS
   *  `transform: scale()`, который масштабирует поддерево целиком.
   *  Значит масштаб обязан быть вписан в геометрию поддерева, иначе
   *  дети приедут исходного размера внутри растянутого родителя. */
  it('умножает геометрию потомков', () => {
    const child = frameNode({ id: 'c', rect: { x: 5, y: 5, w: 10, h: 10 } })
    const [scaled] = scaleSubtree([child], 2, 2)
    expect(scaled?.rect).toEqual({ x: 10, y: 10, w: 20, h: 20 })
  })

  it('умножает радиусы и толщину обводки', () => {
    const child = frameNode({ id: 'c' })
    child.style.corner = { tl: 4, tr: 4, br: 4, bl: 4 }
    child.style.stroke = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: { top: 2, right: 2, bottom: 2, left: 2 },
      style: 'solid', align: 'inside',
    }
    const [scaled] = scaleSubtree([child], 3, 3)
    expect(scaled?.style.corner.tl).toBe(12)
    expect(scaled?.style.stroke?.weight.top).toBe(6)
  })

  it('спускается глубже одного уровня', () => {
    const grand = frameNode({ id: 'g', rect: { x: 1, y: 1, w: 2, h: 2 } })
    const child = frameNode({ id: 'c', children: [grand] })
    const [scaled] = scaleSubtree([child], 2, 2)
    expect(scaled?.children[0]?.rect).toEqual({ x: 2, y: 2, w: 4, h: 4 })
  })

  /** Неравномерный масштаб обязан применяться по своим осям, иначе
   *  один множитель молча растянет обе. */
  it('разные масштабы по осям не смешиваются', () => {
    const child = frameNode({ id: 'c', rect: { x: 10, y: 10, w: 10, h: 10 } })
    const [scaled] = scaleSubtree([child], 2, 5)
    expect(scaled?.rect).toEqual({ x: 20, y: 50, w: 20, h: 50 })
  })
})
