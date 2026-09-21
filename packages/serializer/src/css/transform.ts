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

/** Сдвиг присутствует, когда оси перестают быть перпендикулярными, то есть
 *  скалярное произведение столбцов не ноль. В Figma сдвига нет, поэтому
 *  его нельзя молча потерять. */
export const hasSkew = (m: Matrix): boolean =>
  Math.abs(m.a * m.c + m.b * m.d) > 1e-6

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

/** Размер НЕтрансформированного border box.
 *
 *  `cs.width` в Chrome — ширина content box, поэтому границы и отступы
 *  добавляются вручную. Это точнее `offsetWidth`, который округлён до
 *  целого, а округление на трансформированном элементе даёт видимое
 *  расхождение в pixel-diff. */
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
