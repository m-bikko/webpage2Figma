import { describe, expect, it } from 'vitest'
import { figmaColor, solidPaint, gradientPaint } from '../src/build/paint.js'
import type { Gradient } from '@h2d/ir'

describe('figmaColor', () => {
  /** Figma держит цвет в долях 0..1, а альфу ОТДЕЛЬНО в `opacity`
   *  краски. Сложить их обратно в RGBA нельзя: у узла есть ещё
   *  собственная непрозрачность, которая на неё домножается. */
  it('переводит байты в доли', () => {
    expect(figmaColor({ r: 255, g: 0, b: 128, a: 1 }))
      .toEqual({ r: 1, g: 0, b: 128 / 255 })
  })

  it('альфа в цвет не попадает', () => {
    expect(figmaColor({ r: 0, g: 0, b: 0, a: 0.5 })).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('solidPaint', () => {
  it('альфа уезжает в opacity краски', () => {
    expect(solidPaint({ r: 255, g: 255, b: 255, a: 0.25 }))
      .toEqual({ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.25 })
  })
})

const grad = (from: Gradient['from'], to: Gradient['to']): Gradient => ({
  kind: 'linear', from, to,
  stops: [
    { offset: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
    { offset: 1, color: { r: 0, g: 0, b: 255, a: 0.5 } },
  ],
})

describe('gradientPaint: опорные точки из документации', () => {
  /** Единственные две вещи, которые документация про Transform
   *  утверждает прямо: тождественная матрица — это [[1,0,0],[0,1,0]],
   *  а поворот имеет вид [[cos, sin, 0], [-sin, cos, 0]].
   *
   *  Горизонтальный градиент слева направо — это и есть тождественное
   *  размещение: он идёт вдоль оси X от 0 до 1. Проверка привязывает
   *  нашу арифметику к документированному факту, а не к самой себе. */
  it('градиент слева направо даёт тождественную матрицу', () => {
    const paint = gradientPaint(grad({ x: 0, y: 0 }, { x: 1, y: 0 }))
    expect(paint.gradientTransform[0][0]).toBeCloseTo(1, 9)
    expect(paint.gradientTransform[0][1]).toBeCloseTo(0, 9)
    expect(paint.gradientTransform[0][2]).toBeCloseTo(0, 9)
    expect(paint.gradientTransform[1][0]).toBeCloseTo(0, 9)
    expect(paint.gradientTransform[1][1]).toBeCloseTo(1, 9)
    expect(paint.gradientTransform[1][2]).toBeCloseTo(0, 9)
  })

  /** Градиент сверху вниз — поворот на 90°. По документированному виду
   *  поворота [[cos, sin, 0], [-sin, cos, 0]] при 90° это
   *  [[0, 1, 0], [-1, 0, 0]], а поскольку сам градиент задан обратной
   *  матрицей, ожидаемое — её обращение: [[0, -1, 1], [1, 0, 0]].
   *  Числа выписаны руками из документированной формы, а не получены
   *  прогоном нашего же кода. */
  it('градиент сверху вниз даёт поворот на 90 градусов', () => {
    const m = gradientPaint(grad({ x: 0, y: 0 }, { x: 0, y: 1 })).gradientTransform
    expect(m[0][0]).toBeCloseTo(0, 9)
    expect(m[0][1]).toBeCloseTo(1, 9)
    expect(m[1][0]).toBeCloseTo(-1, 9)
    expect(m[1][1]).toBeCloseTo(0, 9)
  })
})

describe('gradientPaint: то, что проверяемо безусловно', () => {
  it('порядок остановок сохраняется', () => {
    const stops = gradientPaint(grad({ x: 0, y: 0 }, { x: 1, y: 0 })).gradientStops
    expect(stops.map((s) => s.position)).toEqual([0, 1])
    expect(stops[0]?.color).toEqual({ r: 1, g: 0, b: 0 })
  })

  /** Альфа остановки живёт в её собственном opacity, как и у сплошной
   *  краски. Потерять её значило бы получить непрозрачный градиент,
   *  выглядящий совершенно нормально. */
  it('альфа остановки не теряется', () => {
    const stops = gradientPaint(grad({ x: 0, y: 0 }, { x: 1, y: 0 })).gradientStops
    expect(stops[1]?.opacity).toBe(0.5)
  })

  /** Направление обязано различаться при ОДИНАКОВОМ начале.
   *
   *  Первая редакция этого теста брала (0,0)→(1,0) против (1,0)→(0,0)
   *  и проходила даже когда направление считалось по модулю: матрицы
   *  различались сдвигом, а не направлением. Проверка была пустой и
   *  найдена сломом. Здесь начало общее, поэтому отличить их может
   *  только знак направления. */
  it('противоположные направления из одной точки дают разные матрицы', () => {
    const right = gradientPaint(grad({ x: 0.5, y: 0 }, { x: 1, y: 0 })).gradientTransform
    const left = gradientPaint(grad({ x: 0.5, y: 0 }, { x: 0, y: 0 })).gradientTransform
    expect(left).not.toEqual(right)
  })

  /** Обращение против транспонирования.
   *
   *  Обе опорные проверки выше используют ЧИСТЫЕ ПОВОРОТЫ, а у поворота
   *  обратная матрица равна транспонированной — различить эти две
   *  операции они не могут в принципе, и слом «транспонировать вместо
   *  обращения» проходил их обе. Нужен случай с масштабом и сдвигом.
   *
   *  Градиент занимает среднюю половину по горизонтали: слой x=0.25
   *  обязан попасть в начало градиента, x=0.75 — в конец. То есть
   *  g = 2·(x − 0.25) = 2x − 0.5, откуда матрица [[2,0,−0.5],[0,2,0]].
   *  Числа получены из определения, а не прогоном нашего же кода. */
  it('матрица обращается, а не транспонируется', () => {
    const m = gradientPaint(grad({ x: 0.25, y: 0 }, { x: 0.75, y: 0 })).gradientTransform
    expect(m[0][0]).toBeCloseTo(2, 9)
    expect(m[0][2]).toBeCloseTo(-0.5, 9)
    expect(m[1][1]).toBeCloseTo(2, 9)
  })
})
