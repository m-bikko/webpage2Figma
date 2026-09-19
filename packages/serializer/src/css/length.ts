/** Computed styles всегда отдают длины в пикселях, поэтому достаточно
 *  вытащить число. `none`, `auto` и пустая строка означают отсутствие. */
export const parsePx = (value: string): number => {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim())
  if (match?.[1] === undefined) return 0
  return Number.parseFloat(match[1])
}
