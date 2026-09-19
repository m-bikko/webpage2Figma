import type { Corner } from '@h2d/ir'
import { parsePx } from './length.js'

/** Эллиптический угол задаётся двумя значениями через пробел.
 *  Figma поддерживает только круглый радиус, поэтому берём горизонтальный
 *  и оставляем расхождение на усмотрение отчёта вызывающего. */
const firstRadius = (value: string): number => {
  const first = value.trim().split(/\s+/)[0]
  return first === undefined ? 0 : parsePx(first)
}

export const readCorner = (cs: CSSStyleDeclaration): Corner => ({
  tl: firstRadius(cs.borderTopLeftRadius),
  tr: firstRadius(cs.borderTopRightRadius),
  br: firstRadius(cs.borderBottomRightRadius),
  bl: firstRadius(cs.borderBottomLeftRadius),
})

export const isEllipticalCorner = (cs: CSSStyleDeclaration): boolean =>
  [
    cs.borderTopLeftRadius, cs.borderTopRightRadius,
    cs.borderBottomRightRadius, cs.borderBottomLeftRadius,
  ].some((value) => value.trim().split(/\s+/).length > 1)
