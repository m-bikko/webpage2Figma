import type { Stroke, StrokeStyle } from '@h2d/ir'
import { parseColor } from './color.js'
import { parsePx } from './length.js'

type Side = 'Top' | 'Right' | 'Bottom' | 'Left'
const SIDES: readonly Side[] = ['Top', 'Right', 'Bottom', 'Left']

const widthOf = (cs: CSSStyleDeclaration, side: Side): number => {
  const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`)
  if (style === 'none' || style === 'hidden') return 0
  return parsePx(cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
}

const styleOf = (cs: CSSStyleDeclaration, side: Side): string =>
  cs.getPropertyValue(`border-${side.toLowerCase()}-style`)

/** Из стилей границ CSS у Figma есть только сплошная и пунктир через
 *  `dashPattern`. `double`, `groove`, `ridge`, `inset`, `outset`
 *  невыразимы и сводятся к `solid` — но только вместе с диагностикой,
 *  которую порождает вызывающий через `hasNonSolidStroke`. */
const strokeStyleOf = (value: string): StrokeStyle => {
  if (value === 'dashed') return 'dashed'
  if (value === 'dotted') return 'dotted'
  return 'solid'
}

/** Figma поддерживает разную толщину обводки по сторонам, но только один
 *  цвет и один стиль на узел. Берём цвет и стиль первой видимой стороны;
 *  расхождение по сторонам фиксирует вызывающий через Diagnostic. */
export const readStroke = (cs: CSSStyleDeclaration): Stroke | null => {
  const weight = {
    top: widthOf(cs, 'Top'),
    right: widthOf(cs, 'Right'),
    bottom: widthOf(cs, 'Bottom'),
    left: widthOf(cs, 'Left'),
  }
  if (weight.top === 0 && weight.right === 0 && weight.bottom === 0 && weight.left === 0) {
    return null
  }

  for (const side of SIDES) {
    if (widthOf(cs, side) === 0) continue
    const color = parseColor(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
    if (color !== null && color.a > 0) {
      return {
        color,
        weight,
        style: strokeStyleOf(styleOf(cs, side)),
        // Всегда 'inside': CSS рисует границу внутрь бокса. Значение
        // по умолчанию Figma ('CENTER') сдвинуло бы каждый элемент
        // с границей на половину толщины.
        align: 'inside',
      }
    }
  }
  return null
}

/** Видимая граница имеет стиль, который рендерер плана 1 не воспроизводит
 *  либо Figma не имеет вовсе. Вызывающий обязан породить `strokeStyleFlattened`:
 *  пунктирный разделитель, приехавший сплошным, — молчаливая потеря. */
export const hasNonSolidStroke = (cs: CSSStyleDeclaration): boolean =>
  SIDES.some((side) => widthOf(cs, side) > 0 && styleOf(cs, side) !== 'solid')

export const hasMixedBorderColors = (cs: CSSStyleDeclaration): boolean => {
  const visible = SIDES.filter((side) => widthOf(cs, side) > 0)
  const colors = new Set(
    visible.map((side) => cs.getPropertyValue(`border-${side.toLowerCase()}-color`)),
  )
  return colors.size > 1
}
