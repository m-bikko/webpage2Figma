import type { Shadow } from '@w2f/ir'
import { parseColor } from './color.js'
import { parsePx } from './length.js'

/** Разбивает список теней по запятым верхнего уровня.
 *  Наивный split(',') сломался бы на запятых внутри rgba(). */
const splitTopLevel = (value: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

/** Вырезает цветовую функцию или ключевое слово, возвращая остаток строки. */
const extractColor = (input: string): { color: string; rest: string } => {
  const functional = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^)]*\)/i
  const match = functional.exec(input)
  if (match !== null) {
    return {
      color: match[0],
      rest: (input.slice(0, match.index) + input.slice(match.index + match[0].length)),
    }
  }
  const hex = /#[0-9a-f]{3,8}\b/i.exec(input)
  if (hex !== null) {
    return {
      color: hex[0],
      rest: input.slice(0, hex.index) + input.slice(hex.index + hex[0].length),
    }
  }
  return { color: '', rest: input }
}

const parseOne = (raw: string): Shadow | null => {
  let input = raw.trim()
  if (input === '') return null

  const isInset = /\binset\b/i.test(input)
  input = input.replace(/\binset\b/i, ' ')

  const { color: colorText, rest } = extractColor(input)
  const color = parseColor(colorText)
  if (color === null) return null

  const lengths = rest.trim().split(/\s+/).filter((token) => token !== '')
  const offsetXRaw = lengths[0]
  const offsetYRaw = lengths[1]
  if (offsetXRaw === undefined || offsetYRaw === undefined) return null

  return {
    kind: isInset ? 'inner' : 'outer',
    color,
    offsetX: parsePx(offsetXRaw),
    offsetY: parsePx(offsetYRaw),
    blur: lengths[2] === undefined ? 0 : parsePx(lengths[2]),
    spread: lengths[3] === undefined ? 0 : parsePx(lengths[3]),
  }
}

export const parseBoxShadow = (value: string): Shadow[] => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return []
  const shadows: Shadow[] = []
  for (const part of splitTopLevel(trimmed)) {
    const shadow = parseOne(part)
    if (shadow !== null) shadows.push(shadow)
  }
  return shadows
}
