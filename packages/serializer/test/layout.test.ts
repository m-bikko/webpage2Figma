import { describe, expect, it } from 'vitest'
import { readLayout } from '../src/layout.js'

type FakeStyle = Record<string, string>
const style = (overrides: FakeStyle): CSSStyleDeclaration => {
  const base: FakeStyle = {
    display: 'block',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    rowGap: 'normal',
    columnGap: 'normal',
    alignItems: 'normal',
    justifyContent: 'normal',
    paddingTop: '0px', paddingRight: '0px',
    paddingBottom: '0px', paddingLeft: '0px',
  }
  return { ...base, ...overrides } as unknown as CSSStyleDeclaration
}

describe('readLayout', () => {
  it('для block возвращает mode none', () => {
    expect(readLayout(style({})).mode).toBe('none')
  })

  it('flex row даёт mode row', () => {
    expect(readLayout(style({ display: 'flex' })).mode).toBe('row')
  })

  it('flex column даёт mode column', () => {
    expect(readLayout(style({ display: 'flex', flexDirection: 'column' })).mode)
      .toBe('column')
  })

  it('обратные направления сводятся к оси, порядок детей меняет обходчик', () => {
    expect(readLayout(style({ display: 'flex', flexDirection: 'row-reverse' })).mode)
      .toBe('row')
    expect(readLayout(style({ display: 'flex', flexDirection: 'column-reverse' })).mode)
      .toBe('column')
  })

  it('grid трактуется как column: Figma не имеет двумерного auto-layout', () => {
    expect(readLayout(style({ display: 'grid' })).mode).toBe('column')
  })

  it('берёт gap по главной оси', () => {
    const row = readLayout(style({ display: 'flex', columnGap: '12px', rowGap: '4px' }))
    expect(row.gap).toBe(12)
    const col = readLayout(style({
      display: 'flex', flexDirection: 'column', columnGap: '12px', rowGap: '4px',
    }))
    expect(col.gap).toBe(4)
  })

  it('normal gap считается нулём', () => {
    expect(readLayout(style({ display: 'flex' })).gap).toBe(0)
  })

  it('читает padding', () => {
    const result = readLayout(style({ paddingTop: '8px', paddingLeft: '16px' }))
    expect(result.padding).toEqual({ top: 8, right: 0, bottom: 0, left: 16 })
  })

  it('маппит align-items и justify-content', () => {
    const result = readLayout(style({
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }))
    expect(result.align).toBe('center')
    expect(result.justify).toBe('space-between')
  })

  it('normal align трактуется как stretch для flex', () => {
    expect(readLayout(style({ display: 'flex' })).align).toBe('stretch')
  })

  it('читает wrap', () => {
    expect(readLayout(style({ display: 'flex', flexWrap: 'wrap' })).wrap).toBe(true)
  })
})
