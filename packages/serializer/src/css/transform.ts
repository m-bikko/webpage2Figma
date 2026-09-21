import type { Transform } from '@h2d/ir'
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

/** Размер НЕтрансформированного border box.
 *
 *  `cs.width` в Chrome — ширина content box, поэтому границы и отступы
 *  добавляются вручную. Это точнее `offsetWidth`, который округлён до
 *  целого, а округление на трансформированном элементе даёт видимое
 *  расхождение в pixel-diff.
 *
 *  Вызывать только когда `appliesTransform` истинна: на строчном элементе
 *  `cs.width` равен `auto` и результат вырождается в размер отступов. */
export const untransformedSize = (
  cs: CSSStyleDeclaration,
): { w: number; h: number } => ({
  w: parsePx(cs.width) + parsePx(cs.paddingLeft) + parsePx(cs.paddingRight) +
     parsePx(cs.borderLeftWidth) + parsePx(cs.borderRightWidth),
  h: parsePx(cs.height) + parsePx(cs.paddingTop) + parsePx(cs.paddingBottom) +
     parsePx(cs.borderTopWidth) + parsePx(cs.borderBottomWidth),
})

/** Левый верхний угол НЕтрансформированного бокса в координатах вьюпорта.
 *
 *  `getBoundingClientRect()` отдаёт габарит уже трансформированного
 *  элемента, поэтому положение восстанавливается через сравнение: тот же
 *  габарит считается в локальных координатах, и разница даёт смещение. */
export const untransformedOrigin = (
  el: Element,
  m: Matrix,
  size: { w: number; h: number },
  origin: { x: number; y: number },
): { x: number; y: number } => {
  const corners: [number, number][] = [
    [0, 0], [size.w, 0], [size.w, size.h], [0, size.h],
  ]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const [cx, cy] of corners) {
    const lx = cx - origin.x
    const ly = cy - origin.y
    const tx = m.a * lx + m.c * ly + m.e + origin.x
    const ty = m.b * lx + m.d * ly + m.f + origin.y
    minX = Math.min(minX, tx)
    minY = Math.min(minY, ty)
  }
  const rect = el.getBoundingClientRect()
  return { x: rect.left - minX, y: rect.top - minY }
}
