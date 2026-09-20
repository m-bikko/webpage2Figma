import { describe, expect, it } from 'vitest'
import { parseLinearGradient } from '../src/css/gradient.js'

const box = { w: 100, h: 100 }
const wide = { w: 200, h: 100 }

const round = (value: number): number => Math.round(value * 1000) / 1000

describe('parseLinearGradient: направление', () => {
  it('без направления берёт to bottom', () => {
    const g = parseLinearGradient(
      'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))', box,
    )
    expect(g).not.toBeNull()
    expect(g?.from).toEqual({ x: 0.5, y: 0 })
    expect(g?.to).toEqual({ x: 0.5, y: 1 })
  })

  it('to right даёт горизонтальный отрезок', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(g?.from).toEqual({ x: 0, y: 0.5 })
    expect(g?.to).toEqual({ x: 1, y: 0.5 })
  })

  it('to top даёт отрезок снизу вверх', () => {
    const g = parseLinearGradient(
      'linear-gradient(to top, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(g?.from).toEqual({ x: 0.5, y: 1 })
    expect(g?.to).toEqual({ x: 0.5, y: 0 })
  })

  it('90deg равен to right', () => {
    const byAngle = parseLinearGradient(
      'linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    const byKeyword = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(byAngle).toEqual(byKeyword)
  })

  it('135deg на квадрате идёт из верхнего левого в нижний правый', () => {
    const g = parseLinearGradient(
      'linear-gradient(135deg, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(round(g?.from.x ?? -1)).toBe(0)
    expect(round(g?.from.y ?? -1)).toBe(0)
    expect(round(g?.to.x ?? -1)).toBe(1)
    expect(round(g?.to.y ?? -1)).toBe(1)
  })

  it('to top right на КВАДРАТЕ равен 45deg', () => {
    const byKeyword = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    const byAngle = parseLinearGradient(
      'linear-gradient(45deg, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(byKeyword).toEqual(byAngle)
  })

  it('to top right на ШИРОКОМ боксе даёт ТОЧНО ожидаемые концы', () => {
    // Здесь ловится перепутанный atan2. На квадрате оба варианта дают 45°,
    // и ошибка невидима — поэтому проверять надо на неквадратном боксе.
    //
    // Утверждение намеренно о ТОЧНЫХ значениях, а не о соотношении сторон.
    // Первая редакция этого теста сравнивала |dy| > |dx| и оказалась
    // бесполезной: при перепутанном atan2 угол выходит 63.435°, его
    // направление (0.894, −0.447) параллельно диагонали бокса, отрезок
    // ложится РОВНО на диагональ, концы попадают в углы (0,1) и (1,0), и
    // тогда |dx| = |dy| = 1 в точности. Неравенство садилось на лезвие и
    // проходило на шуме плавающей точки.
    //
    // Правильный угол atan2(100,200) = 26.565°: L = 178.9, концы уходят
    // за пределы бокса по вертикали, что нормально — отрезок градиента не
    // обязан лежать внутри.
    const g = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    expect(g?.from).toEqual({ x: 0.3, y: 1.3 })
    expect(g?.to).toEqual({ x: 0.7, y: -0.3 })
  })

  it('to top right на широком боксе совпадает с явным 26.565deg', () => {
    const byKeyword = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    const byAngle = parseLinearGradient(
      'linear-gradient(26.565deg, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    expect(byKeyword).toEqual(byAngle)
  })

  it('to bottom left зеркалит to top right', () => {
    const a = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    const b = parseLinearGradient(
      'linear-gradient(to bottom left, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    expect(round(a?.from.x ?? -1)).toBe(round(b?.to.x ?? -2))
    expect(round(a?.from.y ?? -1)).toBe(round(b?.to.y ?? -2))
  })
})

describe('parseLinearGradient: остановки', () => {
  it('две остановки без положений получают 0 и 1', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))', box,
    )
    expect(g?.stops).toEqual([
      { offset: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { offset: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ])
  })

  it('три остановки без положений распределяются равномерно', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(1, 1, 1), rgb(2, 2, 2), rgb(3, 3, 3))', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
  })

  it('читает положения в процентах', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0) 20%, rgb(255, 255, 255) 80%)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0.2, 0.8])
  })

  it('переводит положения в пикселях через длину отрезка', () => {
    // to right на боксе шириной 100: длина отрезка 100, значит 25px = 0.25.
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0) 25px, rgb(255, 255, 255) 75px)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0.25, 0.75])
  })

  it('распределяет неявные положения между заданными', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(1, 1, 1) 0%, rgb(2, 2, 2), ' +
      'rgb(3, 3, 3), rgb(4, 4, 4) 60%)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0, 0.2, 0.4, 0.6])
  })

  it('не допускает убывания положений', () => {
    // По спецификации положение, меньшее предыдущего, поднимается до него.
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0) 60%, rgb(255, 255, 255) 20%)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0.6, 0.6])
  })

  it('читает альфу остановки', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgba(0, 0, 0, 0.5), rgb(255, 255, 255))', box,
    )
    expect(g?.stops[0]?.color.a).toBe(0.5)
  })
})

describe('parseLinearGradient: отказы', () => {
  it('возвращает null на радиальном градиенте', () => {
    expect(parseLinearGradient(
      'radial-gradient(rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )).toBeNull()
  })

  it('возвращает null на коническом', () => {
    expect(parseLinearGradient(
      'conic-gradient(rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )).toBeNull()
  })

  it('возвращает null на repeating-linear-gradient', () => {
    expect(parseLinearGradient(
      'repeating-linear-gradient(to right, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 10%)',
      box,
    )).toBeNull()
  })

  it('возвращает null на url()', () => {
    expect(parseLinearGradient('url("a.png")', box)).toBeNull()
  })

  it('возвращает null на none', () => {
    expect(parseLinearGradient('none', box)).toBeNull()
  })

  it('возвращает null при единственной остановке', () => {
    // Градиент из одного цвета — это сплошная заливка, и схема контракта
    // такой Fill отвергает. Значит парсер обязан отказаться здесь.
    expect(parseLinearGradient('linear-gradient(rgb(0, 0, 0))', box)).toBeNull()
  })

  it('возвращает null на нулевом боксе', () => {
    // Делить положения в пикселях на нулевую длину отрезка нельзя.
    expect(parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))',
      { w: 0, h: 0 },
    )).toBeNull()
  })

  it('возвращает null, если цвет остановки не разобрался', () => {
    // Подстановка чёрного была бы молчаливой потерей.
    expect(parseLinearGradient(
      'linear-gradient(to right, нечто, rgb(255, 255, 255))', box,
    )).toBeNull()
  })
})
