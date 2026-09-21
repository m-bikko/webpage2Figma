import { describe, expect, it } from 'vitest'
import {
  appliesTransform, decomposeMatrix, hasSkew, invertMatrix, localOffset,
  matrixAboutOrigin, multiplyMatrix, originUnderMatrix, parseMatrix,
  untransformedSize, IDENTITY_MATRIX, type Matrix, type SizeSource,
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

describe('multiplyMatrix', () => {
  const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

  it('единичная матрица ничего не меняет', () => {
    const m: Matrix = { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }
    expect(multiplyMatrix(identity, m)).toEqual(m)
    expect(multiplyMatrix(m, identity)).toEqual(m)
  })

  it('перенос складывается', () => {
    const a: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 }
    const b: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 3, f: 7 }
    expect(multiplyMatrix(a, b)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 13, f: 12 })
  })

  it('масштаб умножается', () => {
    const a: Matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    const b: Matrix = { a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 }
    expect(multiplyMatrix(a, b)).toEqual({ a: 6, b: 0, c: 0, d: 6, e: 0, f: 0 })
  })

  it('порядок множителей значим: масштаб предка масштабирует перенос потомка', () => {
    // Предок увеличивает вдвое, потомок сдвинут на 10. В экранных
    // координатах сдвиг тоже удваивается — это и есть смысл вложенности,
    // и перестановка множителей его теряет.
    const ancestor: Matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    const own: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 }
    expect(multiplyMatrix(ancestor, own).e).toBe(20)
    expect(multiplyMatrix(own, ancestor).e).toBe(10)
  })

  it('поворот предка разворачивает перенос потомка', () => {
    // Предок повёрнут на 90°, потомок сдвинут вправо на 10. На экране
    // сдвиг идёт ВНИЗ, а не вправо.
    const ancestor: Matrix = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }
    const own: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 }
    const result = multiplyMatrix(ancestor, own)
    expect(Math.round(result.e)).toBe(0)
    expect(Math.round(result.f)).toBe(10)
  })
})

describe('invertMatrix', () => {
  /** `toBeCloseTo`, а не `toBe(0)`: деление на определитель законно рождает
   *  отрицательный ноль, а `Object.is(-0, 0)` ложно. Различать знак нуля
   *  здесь нечего — это одна и та же точка. */
  const isZero = (value: number): void => { expect(value).toBeCloseTo(0, 10) }

  it('единичная матрица обратна себе', () => {
    const back = invertMatrix(IDENTITY_MATRIX)
    expect(back).not.toBeNull()
    if (back === null) return
    expect(back.a).toBe(1)
    expect(back.d).toBe(1)
    isZero(back.b)
    isZero(back.c)
    isZero(back.e)
    isZero(back.f)
  })

  it('произведение с обратной даёт единичную', () => {
    const m: Matrix = { a: 0.939693, b: 0.34202, c: -0.34202, d: 0.939693, e: 17, f: -4 }
    const back = invertMatrix(m)
    expect(back).not.toBeNull()
    if (back === null) return
    const product = multiplyMatrix(m, back)
    expect(round(product.a)).toBe(1)
    expect(round(product.d)).toBe(1)
    isZero(product.b)
    isZero(product.c)
    isZero(product.e)
    isZero(product.f)
  })

  it('вырожденная матрица не обращается', () => {
    // scale(0) схлопывает плоскость в точку: восстановить из неё нечего,
    // и молча вернуть единичную было бы выдачей неверного ответа за верный.
    expect(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBeNull()
    expect(invertMatrix({ a: 2, b: 1, c: 4, d: 2, e: 0, f: 0 })).toBeNull()
  })
})

describe('matrixAboutOrigin', () => {
  it('единичная матрица остаётся единичной при любой точке отсчёта', () => {
    const m = matrixAboutOrigin(IDENTITY_MATRIX, { x: 100, y: 60 })
    expect(round(m.a)).toBe(1)
    expect(round(m.e)).toBe(0)
    expect(round(m.f)).toBe(0)
  })

  it('чистый перенос не зависит от точки отсчёта', () => {
    const m = matrixAboutOrigin({ a: 1, b: 0, c: 0, d: 1, e: 20, f: 10 }, { x: 100, y: 60 })
    expect(round(m.e)).toBe(20)
    expect(round(m.f)).toBe(10)
  })

  it('поворот вокруг центра превращается в поворот вокруг нуля со сдвигом', () => {
    // Измерено в Chrome на fixtures/transform-nested: rotate(20deg) при
    // transform-origin 100px 60px. Без приведения к этой форме произведение
    // матриц по дереву считалось бы вокруг чужих точек.
    const rotate: Matrix = {
      a: 0.939693, b: 0.34202, c: -0.34202, d: 0.939693, e: 0, f: 0,
    }
    const m = matrixAboutOrigin(rotate, { x: 100, y: 60 })
    expect(round(m.a)).toBe(round(rotate.a))
    expect(round(m.b)).toBe(round(rotate.b))
    // o − M·o: (100,60) − (93.9693 − 20.5212, 34.202 + 56.38158)
    expect(round(m.e)).toBe(26.5519)
    expect(round(m.f)).toBe(-30.5836)
  })
})

describe('originUnderMatrix', () => {
  /** Габарит уже трансформированного элемента — единственное, что
   *  сообщает браузер. Тесту хватает `left`/`top`: остальное `originUnderMatrix`
   *  не читает, и подсовывать целый DOMRect значило бы имитировать
   *  зависимость, которой нет. */
  const at = (left: number, top: number): { getBoundingClientRect: () => { left: number; top: number } } =>
    ({ getBoundingClientRect: () => ({ left, top }) })

  it('без трансформ отдаёт просто левый верхний угол', () => {
    const origin = originUnderMatrix(at(40, 60), IDENTITY_MATRIX, { w: 200, h: 120 })
    expect(origin).toEqual({ x: 40, y: 60 })
  })

  it('под поворотом снимает разницу между габаритом и локальным боксом', () => {
    // fixtures/transform-nested: .rotated 200×120, rotate(20deg) вокруг
    // (100,60). Габарит вырастает до 228.98 × 181.17 и уезжает влево-вверх,
    // а нас интересует, куда попал локальный ноль.
    const rotate: Matrix = {
      a: 0.939693, b: 0.34202, c: -0.34202, d: 0.939693, e: 0, f: 0,
    }
    const origin = originUnderMatrix(
      at(25.50952911376953, 29.416427612304688), rotate, { w: 200, h: 120 },
    )
    expect(round(origin.x)).toBe(66.5519)
    expect(round(origin.y)).toBe(29.4164)
  })
})

/** Восстановление положения узла в системе координат РОДИТЕЛЯ.
 *
 *  Числа во всех трёх случаях сняты с `fixtures/transform-nested` в живом
 *  Chrome, а ожидания — с той же раскладки при `transform: none`, то есть
 *  это измеренная истина, а не пересказ формулы своими словами. Раскладка
 *  там такая: `.rotated` лежит в (40, 60) — 40 от padding `body`, ещё 20 от
 *  СХЛОПНУВШЕГОСЯ верхнего margin `.child`, — а сам `.child` из-за этого
 *  схлопывания стоит в (20, 0). */
describe('localOffset', () => {
  const rotate20: Matrix = {
    a: 0.939693, b: 0.34202, c: -0.34202, d: 0.939693, e: 0, f: 0,
  }

  it('без трансформ это вычитание экранных углов', () => {
    const local = localOffset({
      screenOrigin: { x: 130, y: 70 },
      parentOrigin: { x: 100, y: 50 },
      ancestorInverse: IDENTITY_MATRIX,
      ownMatrix: IDENTITY_MATRIX,
    })
    expect(local).toEqual({ x: 30, y: 20 })
  })

  it('СОБСТВЕННАЯ трансформа узла не протекает в его rect', () => {
    // `.rotated`: экранный ноль уехал в (66.55, 29.42), но rect обязан
    // остаться нетрансформированным боксом (40, 60) — поворот уезжает в
    // поле `transform` и применяется рендерером отдельно. Вычесть его
    // здесь забывают легко, и результат выглядит правдоподобно.
    const local = localOffset({
      screenOrigin: { x: 66.55192911376953, y: 29.416427612304688 },
      parentOrigin: { x: 0, y: 0 },
      ancestorInverse: IDENTITY_MATRIX,
      ownMatrix: matrixAboutOrigin(rotate20, { x: 100, y: 60 }),
    })
    expect(round(local.x)).toBe(40)
    expect(round(local.y)).toBe(60)
  })

  it('поворот ПРЕДКА снимается: смещение выражено в осях родителя', () => {
    // `.child` лежит в (20, 0) от бокса `.rotated`. Разность экранных
    // углов даёт (18.79, 6.84) — то же самое, повёрнутое на 20°, то есть
    // величину в ЭКРАННЫХ осях. Без обращения матрицы предка ребёнок
    // приезжает повёрнутым дважды.
    const inverse = invertMatrix(rotate20)
    expect(inverse).not.toBeNull()
    if (inverse === null) return
    const local = localOffset({
      screenOrigin: { x: 85.34579744873047, y: 36.256832122802734 },
      parentOrigin: { x: 66.55192911376953, y: 29.416427612304688 },
      ancestorInverse: inverse,
      ownMatrix: IDENTITY_MATRIX,
    })
    expect(round(local.x)).toBe(20)
    expect(round(local.y)).toBe(0)
  })

  it('масштаб предка снимается вместе с поворотом', () => {
    // Предок увеличен вдвое: ребёнок, стоящий на 30px правее в системе
    // родителя, на экране отстоит на 60. Проверка ловит пропущенное
    // деление — поворот один его не ловит, потому что при чистом
    // масштабе матрица диагональна.
    const scale: Matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    const inverse = invertMatrix(scale)
    expect(inverse).not.toBeNull()
    if (inverse === null) return
    const local = localOffset({
      screenOrigin: { x: 160, y: 100 },
      parentOrigin: { x: 100, y: 40 },
      ancestorInverse: inverse,
      ownMatrix: IDENTITY_MATRIX,
    })
    expect(round(local.x)).toBe(30)
    expect(round(local.y)).toBe(30)
  })
})

/** Размер НЕтрансформированного бокса.
 *
 *  До локальных координат эта функция вызывалась ТОЛЬКО на
 *  трансформированных узлах, а ни в одной такой фикстуре не было ни
 *  отступов, ни границ — поэтому ошибка ниже дремала и тестов у функции
 *  не было вовсе. С переходом на систему координат родителя размер
 *  считается у каждого узла, и дефект стал системным: `body` с
 *  `padding: 40px` приезжал шириной 1520 вместо 1440. */
describe('untransformedSize', () => {
  const style = (over: Partial<SizeSource>): SizeSource => ({
    width: '100px', height: '50px', boxSizing: 'content-box',
    paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
    borderLeftWidth: '0px', borderRightWidth: '0px',
    borderTopWidth: '0px', borderBottomWidth: '0px',
    ...over,
  })

  it('content-box: отступы и границы прибавляются', () => {
    expect(untransformedSize(style({
      paddingLeft: '10px', paddingRight: '10px', paddingTop: '10px', paddingBottom: '10px',
      borderLeftWidth: '5px', borderRightWidth: '5px',
      borderTopWidth: '5px', borderBottomWidth: '5px',
    }))).toEqual({ w: 130, h: 80 })
  })

  it('border-box: отступы и границы УЖЕ внутри — прибавлять нельзя', () => {
    // Измерено в Chrome: при box-sizing: border-box
    // getComputedStyle().width отдаёт ширину border box, а не content box.
    // Прибавив к ней отступы, узел раздувается ровно на их удвоенную
    // величину, и каждый ребёнок внутри уезжает.
    expect(untransformedSize(style({
      boxSizing: 'border-box',
      paddingLeft: '10px', paddingRight: '10px', paddingTop: '10px', paddingBottom: '10px',
      borderLeftWidth: '5px', borderRightWidth: '5px',
      borderTopWidth: '5px', borderBottomWidth: '5px',
    }))).toEqual({ w: 100, h: 50 })
  })

  it('без отступов и границ обе модели совпадают', () => {
    expect(untransformedSize(style({}))).toEqual({ w: 100, h: 50 })
    expect(untransformedSize(style({ boxSizing: 'border-box' }))).toEqual({ w: 100, h: 50 })
  })

  it('несимметричные отступы складываются по своим сторонам', () => {
    expect(untransformedSize(style({
      paddingLeft: '4px', paddingRight: '6px',
      paddingTop: '1px', paddingBottom: '9px',
      borderLeftWidth: '2px', borderTopWidth: '3px',
    }))).toEqual({ w: 112, h: 63 })
  })
})
