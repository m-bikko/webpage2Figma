import type { Transform } from '@w2f/ir'
import { parsePx } from './length.js'

/** Коэффициенты `matrix(a, b, c, d, e, f)` из CSS.
 *  Отображение: `(x,y) → (a·x + c·y + e, b·x + d·y + f)`. */
export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }

/** Возвращает `null` на `none` и на `matrix3d`. Трёхмерные трансформы в
 *  Figma отсутствуют физически, поэтому сводить их к двумерным нельзя —
 *  вызывающий обязан породить диагностику. */
export const parseMatrix = (value: string): Matrix | null => {
  const match = /^matrix\(([^)]+)\)$/.exec(value.trim())
  if (match?.[1] === undefined) return null
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null
  const [a, b, c, d, e, f] = parts as [number, number, number, number, number, number]
  return { a, b, c, d, e, f }
}

/** Сдвиг присутствует, когда оси перестают быть перпендикулярными.
 *  В Figma сдвига нет, поэтому его нельзя молча потерять.
 *
 *  Скалярное произведение столбцов НОРМИРУЕТСЯ на их длины, то есть
 *  сравнивается косинус угла между осями, а не само произведение.
 *  Абсолютный допуск здесь неверен, и это измерено: при чистом повороте
 *  произведение равно точно нулю (`c = −b`, `d = a`, и слагаемые
 *  сокращаются побитово), но при повороте с НЕРАВНОМЕРНЫМ масштабом
 *  сокращение перестаёт быть точным и растёт вместе с масштабом —
 *  `rotate(37deg) scale(5,4)` даёт 1.2e-6, `scale(120,80)` даёт 2.4e-5.
 *  С абсолютным допуском корректная трансформа была бы объявлена
 *  сдвинутой и отвергнута, а выглядело бы это как «трансформы не
 *  работают». После нормировки 1e-6 соответствует сдвигу около
 *  0.00006 градуса — ниже всякой различимости. */
export const hasSkew = (m: Matrix): boolean => {
  const lengthX = Math.hypot(m.a, m.b)
  const lengthY = Math.hypot(m.c, m.d)
  if (lengthX === 0 || lengthY === 0) return false
  return Math.abs((m.a * m.c + m.b * m.d) / (lengthX * lengthY)) > 1e-6
}

/** Разложение аффинной матрицы.
 *
 *  `angle = atan2(b, a)` — ось `x` отображается в `(a, b)`. Ось `y` в
 *  экранных координатах растёт вниз, поэтому положительный угол визуально
 *  поворачивает ПО часовой, как `rotate()` в CSS.
 *
 *  `scaleY` считается через определитель, а не как `hypot(c, d)`: иначе
 *  отражение по вертикали (`scaleY: -1`) превратилось бы в поворот на 180°
 *  с положительным масштабом — визуально другое преобразование. */
export const decomposeMatrix = (m: Matrix): Omit<Transform, 'originX' | 'originY'> => {
  const scaleX = Math.hypot(m.a, m.b)
  const determinant = m.a * m.d - m.b * m.c
  return {
    angle: Math.atan2(m.b, m.a),
    scaleX,
    scaleY: scaleX === 0 ? 0 : determinant / scaleX,
    translateX: m.e,
    translateY: m.f,
  }
}

/** Точка отсчёта в пикселях от левого верхнего угла border box. */
export const readOrigin = (cs: CSSStyleDeclaration): { x: number; y: number } => {
  const parts = cs.transformOrigin.trim().split(/\s+/)
  return { x: parsePx(parts[0] ?? '0px'), y: parsePx(parts[1] ?? '0px') }
}

/** Применяется ли объявленная трансформа к этому элементу ВООБЩЕ.
 *
 *  CSS Transforms §3: трансформируемы все элементы, КРОМЕ незамещаемых
 *  строчных. Chrome при этом всё равно отдаёт матрицу в computed style —
 *  измерено: у `<span style="transform:rotate(30deg)">` `cs.transform`
 *  равен `matrix(0.866, 0.5, -0.5, 0.866, 0, 0)`, а `getBoundingClientRect()`
 *  отдаёт НЕповёрнутый строчный бокс. То есть матрица есть, а поворота нет.
 *
 *  Без этой проверки такой элемент приезжал бы с трансформой, которой
 *  браузер не применял, и — хуже — с боксом 0×0: у строчного элемента
 *  computed `width` равен `auto`, `parsePx('auto')` даёт 0, и
 *  восстановление бокса выродилось бы в точку. Элемент исчезал бы из
 *  рендера молча.
 *
 *  Оба факта проверяются одним признаком намеренно: НЕчитаемый из
 *  computed style бокс и неприменённая трансформа — это один и тот же
 *  случай, и восстанавливать бокс там, где его нечем восстановить,
 *  бессмысленно. Диагностика не нужна: браузер трансформу не применил,
 *  поэтому пустой `transform` в IR — не потеря, а точность. */
export const appliesTransform = (
  cs: Pick<CSSStyleDeclaration, 'width' | 'height'>,
): boolean => /px$/.test(cs.width.trim()) && /px$/.test(cs.height.trim())

/** Всё, что нужно для восстановления бокса. Именованный набор, а не
 *  `CSSStyleDeclaration`: так видно, от чего функция зависит на самом
 *  деле, и её можно проверить без DOM. */
export type SizeSource = Pick<
  CSSStyleDeclaration,
  'width' | 'height' | 'boxSizing'
  | 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom'
  | 'borderLeftWidth' | 'borderRightWidth' | 'borderTopWidth' | 'borderBottomWidth'
>

/** Размер НЕтрансформированного border box.
 *
 *  Берётся вычисленный стиль, а не `offsetWidth`: последний округлён до
 *  целого, а округление на трансформированном элементе даёт видимое
 *  расхождение в pixel-diff.
 *
 *  `box-sizing` учитывать ОБЯЗАТЕЛЬНО. Измерено в Chrome: при
 *  `content-box` вычисленный `width` — ширина содержимого, и границы с
 *  отступами надо прибавить; при `border-box` он уже равен ширине border
 *  box, и прибавление раздувает узел ровно на их удвоенную величину.
 *  Пока размер считался только у трансформированных узлов, дефект спал:
 *  ни в одной такой фикстуре не было ни отступов, ни границ. С переходом
 *  на координаты родителя он стал системным — `body` с `padding: 40px`
 *  приезжал шириной 1520 вместо 1440, и каждый его ребёнок съезжал.
 *
 *  Вызывать только когда `appliesTransform` истинна: на строчном элементе
 *  `cs.width` равен `auto` и результат вырождается в размер отступов. */
export const untransformedSize = (cs: SizeSource): { w: number; h: number } => {
  const insideWidth = cs.boxSizing === 'border-box'
  const extraX = parsePx(cs.paddingLeft) + parsePx(cs.paddingRight) +
    parsePx(cs.borderLeftWidth) + parsePx(cs.borderRightWidth)
  const extraY = parsePx(cs.paddingTop) + parsePx(cs.paddingBottom) +
    parsePx(cs.borderTopWidth) + parsePx(cs.borderBottomWidth)
  return {
    w: parsePx(cs.width) + (insideWidth ? 0 : extraX),
    h: parsePx(cs.height) + (insideWidth ? 0 : extraY),
  }
}

export const IDENTITY_MATRIX: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Произведение аффинных матриц: сначала применяется `inner`, затем `outer`.
 *
 *  Порядок значим и легко перепутать. Матрица предка стоит СЛЕВА, потому
 *  что точка сначала преобразуется собственной матрицей узла, а затем
 *  матрицей предка — как при вложенности в DOM. Перестановка даёт
 *  правдоподобный, но неверный результат: перенос потомка перестаёт
 *  масштабироваться и поворачиваться вместе с предком.
 *
 *  Проверено сломом: при перестановке аргументов падают ровно два теста —
 *  про порядок множителей и про поворот предка. Тесты про единичную
 *  матрицу, сложение переносов и умножение масштабов остаются зелёными,
 *  потому что эти случаи КОММУТИРУЮТ и как страховка бесполезны. */
export const multiplyMatrix = (outer: Matrix, inner: Matrix): Matrix => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
  e: outer.a * inner.e + outer.c * inner.f + outer.e,
  f: outer.b * inner.e + outer.d * inner.f + outer.f,
})

/** Обратная аффинная матрица, либо `null` на вырожденной.
 *
 *  Нужна, чтобы снять оси предка: разность ЭКРАННЫХ положений узла и его
 *  родителя выражена в осях экрана, а `rect` обязан быть в осях родителя.
 *  Под повёрнутым предком это разные величины, и умножение на обратную
 *  матрицу — ровно то, что их связывает.
 *
 *  `null`, а не единичная, на нулевом определителе: `scale(0)` схлопывает
 *  плоскость в точку, и восстановить из неё нечего. Подставить единичную
 *  значило бы выдать заведомо неверный ответ за верный — а вызывающий
 *  сам решит, что делать с невосстановимым случаем. */
export const invertMatrix = (m: Matrix): Matrix | null => {
  const determinant = m.a * m.d - m.b * m.c
  if (determinant === 0 || !Number.isFinite(determinant)) return null
  return {
    a: m.d / determinant,
    b: -m.b / determinant,
    c: -m.c / determinant,
    d: m.a / determinant,
    e: (m.c * m.f - m.d * m.e) / determinant,
    f: (m.b * m.e - m.a * m.f) / determinant,
  }
}

/** Применяет матрицу к ВЕКТОРУ, а не к точке: перенос не участвует.
 *  Смещение ребёнка внутри родителя — именно вектор, и добавлять к нему
 *  перенос матрицы означало бы прибавить положение предка второй раз. */
const applyLinear = (
  m: Matrix,
  v: { x: number; y: number },
): { x: number; y: number } => ({
  x: m.a * v.x + m.c * v.y,
  y: m.b * v.x + m.d * v.y,
})

/** Матрица узла вокруг его точки отсчёта, приведённая к обычной
 *  аффинной форме. CSS применяет трансформу вокруг `transform-origin`,
 *  то есть `T(o) · M · T(−o)`, и без этого приведения произведение
 *  матриц по дереву считалось бы вокруг чужих точек.
 *
 *  Линейная часть от приведения не меняется — меняется перенос, и именно
 *  он затем вычитается в `localOffset`. Без приведения из `rect` вычиталась
 *  бы трансформа вокруг нуля, то есть не та, которую применил браузер. */
export const matrixAboutOrigin = (
  m: Matrix,
  origin: { x: number; y: number },
): Matrix => multiplyMatrix(
  multiplyMatrix(
    { a: 1, b: 0, c: 0, d: 1, e: origin.x, f: origin.y },
    m,
  ),
  { a: 1, b: 0, c: 0, d: 1, e: -origin.x, f: -origin.y },
)

/** Минимум, который нужен от элемента. Полный `Element` здесь избыточен, а
 *  в юнит-тесте потребовал бы имитировать DOM ради двух чисел. */
type BoundsSource = { getBoundingClientRect: () => { left: number; top: number } }

/** Экранное положение локального нуля узла с учётом ВСЕХ трансформ —
 *  предков и собственной.
 *
 *  Обобщение `untransformedOrigin`: вместо собственной матрицы узла
 *  берётся произведение матрицы предков на собственную. Габарит
 *  четырёхугольника, полученного применением произведения к углам бокса,
 *  отличается от `getBoundingClientRect()` ровно на перенос, поэтому
 *  разница и даёт положение.
 *
 *  ВНИМАНИЕ: результат — положение локального нуля ПОСЛЕ применения
 *  собственной трансформы узла, а не положение его нетрансформированного
 *  бокса. Именно это нужно детям как начало их системы координат, и
 *  именно это НЕЛЬЗЯ класть в `rect` — там собственная трансформа обязана
 *  быть снята, потому что она уезжает отдельным полем. Снимает её
 *  `localOffset`. */
export const originUnderMatrix = (
  el: BoundsSource,
  total: Matrix,
  size: { w: number; h: number },
): { x: number; y: number } => {
  const corners: [number, number][] = [
    [0, 0], [size.w, 0], [size.w, size.h], [0, size.h],
  ]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const [cx, cy] of corners) {
    minX = Math.min(minX, total.a * cx + total.c * cy)
    minY = Math.min(minY, total.b * cx + total.d * cy)
  }
  const rect = el.getBoundingClientRect()
  return { x: rect.left - minX, y: rect.top - minY }
}

/** Положение НЕтрансформированного бокса узла в системе координат РОДИТЕЛЯ.
 *
 *  Два шага, и каждый ловит свою ошибку — обе выглядят правдоподобно.
 *
 *  1. `ancestorInverse` снимает оси предка. Разность экранных нулей узла и
 *     родителя — величина в осях ЭКРАНА: под предком, повёрнутым на 20°,
 *     ребёнок, стоящий на 20px правее, даёт разность (18.79, 6.84).
 *     Положить её в `rect` значило бы повернуть ребёнка дважды — рендерер
 *     повернёт группу ещё раз.
 *  2. `ownMatrix.e`/`f` — это образ локального нуля под собственной
 *     трансформой узла, то есть ровно то, на что `originUnderMatrix` уже
 *     сдвинул результат. Собственная трансформа уезжает отдельным полем
 *     `transform` и применяется рендерером, поэтому из `rect` её надо
 *     вычесть. Без вычитания блок 200×120 с `rotate(20deg)` вокруг центра
 *     приезжает в (66.55, 29.42) вместо (40, 60) — и выглядит это как
 *     «поворот немного не оттуда», а не как ошибка системы координат. */
export const localOffset = (args: {
  screenOrigin: { x: number; y: number }
  parentOrigin: { x: number; y: number }
  ancestorInverse: Matrix
  ownMatrix: Matrix
}): { x: number; y: number } => {
  const inParentAxes = applyLinear(args.ancestorInverse, {
    x: args.screenOrigin.x - args.parentOrigin.x,
    y: args.screenOrigin.y - args.parentOrigin.y,
  })
  return {
    x: inParentAxes.x - args.ownMatrix.e,
    y: inParentAxes.y - args.ownMatrix.f,
  }
}
