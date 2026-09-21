import { describe, expect, it } from 'vitest'
import {
  figmaRotation, originOffset, scaleSubtree, sizeUnderTransform,
} from '../src/build/geometry.js'
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

describe('originOffset: CSS преобразует вокруг центра, Figma — вокруг угла', () => {
  /** Документация Figma: при установке `rotation` меняются только
   *  m00/m01/m10/m11, а сдвиг m02/m12 остаётся. Значит неподвижна
   *  локальная точка (0,0) — левый верхний угол. CSS же по умолчанию
   *  вращает вокруг ЦЕНТРА (`transform-origin: 50% 50%`).
   *
   *  Без поправки повёрнутый узел приедет не на своё место, и заметить
   *  это на глаз тем труднее, чем меньше угол. */
  it('без поворота поправки нет', () => {
    expect(originOffset(null)).toEqual({ dx: 0, dy: 0 })
  })

  /** Поворот на 180° вокруг центра переводит левый верхний угол в
   *  правый нижний. Чтобы Figma, вращая вокруг угла, дала ту же
   *  картину, узел надо сдвинуть на всю ширину и высоту.
   *  Значение выведено геометрически, а не прогоном кода. */
  it('поворот на 180 вокруг центра сдвигает на размер узла', () => {
    const out = originOffset(
      { angle: Math.PI, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0,
        originX: 50, originY: 25 })
    expect(out.dx).toBeCloseTo(100, 6)
    expect(out.dy).toBeCloseTo(50, 6)
  })

  /** Поворот вокруг САМОГО угла поправки не требует: точка вращения
   *  уже совпадает с фигмовской. Случай отличает настоящую формулу от
   *  «сдвинуть на половину размера всегда». */
  it('поворот вокруг левого верхнего угла поправки не требует', () => {
    const out = originOffset(
      { angle: 0.4, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0,
        originX: 0, originY: 0 })
    expect(out.dx).toBeCloseTo(0, 9)
    expect(out.dy).toBeCloseTo(0, 9)
  })

  /** Поворот на 90° вокруг центра неквадратного узла: сдвиг по осям
   *  РАЗНЫЙ. Квадратный узел эту ошибку скрыл бы — ровно тот случай,
   *  что описан в вики как «проверка выбрала вход, на котором ошибка
   *  невидима». */
  it('на неквадратном узле сдвиги по осям различаются', () => {
    const out = originOffset(
      { angle: Math.PI / 2, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0,
        originX: 50, originY: 25 })
    expect(out.dx).toBeCloseTo(75, 6)
    expect(out.dy).toBeCloseTo(-25, 6)
  })
})

describe('originOffset: масштаб и перенос', () => {
  /** Чистый масштаб вокруг центра ТОЖЕ двигает левый верхний угол:
   *  блок растёт во все стороны, а не только вправо и вниз. Первая
   *  редакция поправки этого не учитывала, и круговой обход показал
   *  6000 расходящихся пикселей на блоке `scale(1.5)`. */
  it('масштаб вокруг центра сдвигает угол', () => {
    const out = originOffset({ angle: 0, scaleX: 1.5, scaleY: 1.5,
      translateX: 0, translateY: 0, originX: 60, originY: 30 })
    expect(out.dx).toBeCloseTo(-30, 9)
    expect(out.dy).toBeCloseTo(-15, 9)
  })

  /** Перенос в `rect` не входит вовсе: референс-рендерер применяет его
   *  отдельной строкой трансформы. Забыть его — сдвинуть узел ровно на
   *  величину переноса. */
  it('перенос прибавляется целиком', () => {
    const out = originOffset({ angle: 0, scaleX: 1, scaleY: 1,
      translateX: 20, translateY: 10, originX: 60, originY: 30 })
    expect(out.dx).toBeCloseTo(20, 9)
    expect(out.dy).toBeCloseTo(10, 9)
  })

  /** Поворот вместе с НЕравномерным масштабом: порядок множителей
   *  виден только здесь. При равномерном масштабе поворот и масштаб
   *  коммутируют, и перестановка невидима — тот же довод, по которому
   *  неравномерный блок есть в самой фикстуре. */
  it('поворот применяется к масштабу, а не наоборот', () => {
    const out = originOffset({ angle: Math.PI / 2, scaleX: 2, scaleY: 0.5,
      translateX: 0, translateY: 0, originX: 60, originY: 30 })
    // M·o = (cos·sx·ox − sin·sy·oy, sin·sx·ox + cos·sy·oy)
    //     = (0·2·60 − 1·0.5·30, 1·2·60 + 0·0.5·30) = (−15, 120)
    expect(out.dx).toBeCloseTo(60 - -15, 9)
    expect(out.dy).toBeCloseTo(30 - 120, 9)
  })
})
