import { describe, expect, it } from 'vitest'
import { parseBoxShadow } from '../src/css/shadow.js'

describe('parseBoxShadow', () => {
  it('возвращает пустой массив для none', () => {
    expect(parseBoxShadow('none')).toEqual([])
    expect(parseBoxShadow('')).toEqual([])
  })

  it('разбирает одну внешнюю тень с цветом впереди', () => {
    expect(parseBoxShadow('rgba(0, 0, 0, 0.25) 0px 4px 8px 1px')).toEqual([
      {
        kind: 'outer',
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offsetX: 0, offsetY: 4, blur: 8, spread: 1,
      },
    ])
  })

  it('разбирает тень без spread', () => {
    expect(parseBoxShadow('rgb(255, 0, 0) 2px 3px 4px')).toEqual([
      {
        kind: 'outer',
        color: { r: 255, g: 0, b: 0, a: 1 },
        offsetX: 2, offsetY: 3, blur: 4, spread: 0,
      },
    ])
  })

  it('распознаёт inset как внутреннюю тень', () => {
    const result = parseBoxShadow('rgb(0, 0, 0) 0px 1px 2px 0px inset')
    expect(result[0]?.kind).toBe('inner')
  })

  it('разбивает несколько теней по запятой, не ломаясь на запятых внутри rgba()', () => {
    const result = parseBoxShadow(
      'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgba(0, 0, 0, 0.2) 0px 4px 8px 0px',
    )
    expect(result).toHaveLength(2)
    expect(result[1]?.offsetY).toBe(4)
  })

  it('отбрасывает тень с неразбираемым цветом вместо подстановки чёрного', () => {
    expect(parseBoxShadow('нечто 0px 1px 2px')).toEqual([])
  })
})
