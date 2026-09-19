import { describe, expect, it } from 'vitest'
import { hasNonSolidStroke, readStroke } from '../src/css/stroke.js'
import { readCorner } from '../src/css/corner.js'

type FakeStyle = Record<string, string>
const style = (overrides: FakeStyle): CSSStyleDeclaration => {
  const base: FakeStyle = {
    borderTopWidth: '0px', borderRightWidth: '0px',
    borderBottomWidth: '0px', borderLeftWidth: '0px',
    borderTopColor: 'rgb(0, 0, 0)', borderRightColor: 'rgb(0, 0, 0)',
    borderBottomColor: 'rgb(0, 0, 0)', borderLeftColor: 'rgb(0, 0, 0)',
    borderTopStyle: 'solid', borderRightStyle: 'solid',
    borderBottomStyle: 'solid', borderLeftStyle: 'solid',
    borderTopLeftRadius: '0px', borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px', borderBottomLeftRadius: '0px',
  }
  const merged: FakeStyle = { ...base, ...overrides }
  const camel = (kebab: string): string =>
    kebab.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
  return {
    ...merged,
    getPropertyValue: (prop: string): string => merged[camel(prop)] ?? '',
  } as unknown as CSSStyleDeclaration
}

describe('readStroke', () => {
  it('возвращает null при отсутствии границ', () => {
    expect(readStroke(style({}))).toBeNull()
  })

  it('читает равномерную границу', () => {
    const result = readStroke(style({
      borderTopWidth: '2px', borderRightWidth: '2px',
      borderBottomWidth: '2px', borderLeftWidth: '2px',
      borderTopColor: 'rgb(255, 0, 0)', borderRightColor: 'rgb(255, 0, 0)',
      borderBottomColor: 'rgb(255, 0, 0)', borderLeftColor: 'rgb(255, 0, 0)',
    }))
    // Сравнение объекта ЦЕЛИКОМ, а не частичное: так тест поймает поле,
    // которое добавят в Stroke и забудут здесь. Именно поэтому style и
    // align перечислены явно, хотя ниже есть и отдельные тесты на них.
    expect(result).toEqual({
      color: { r: 255, g: 0, b: 0, a: 1 },
      weight: { top: 2, right: 2, bottom: 2, left: 2 },
      style: 'solid',
      align: 'inside',
    })
  })

  it('читает разную толщину по сторонам', () => {
    const result = readStroke(style({
      borderTopWidth: '1px', borderBottomWidth: '4px',
    }))
    expect(result?.weight).toEqual({ top: 1, right: 0, bottom: 4, left: 0 })
  })

  it('игнорирует границы со style: none, даже если ширина задана', () => {
    const result = readStroke(style({
      borderTopWidth: '3px', borderTopStyle: 'none',
    }))
    expect(result).toBeNull()
  })

  it('берёт цвет первой видимой стороны', () => {
    const result = readStroke(style({
      borderBottomWidth: '2px', borderBottomColor: 'rgb(0, 0, 255)',
    }))
    expect(result?.color).toEqual({ r: 0, g: 0, b: 255, a: 1 })
  })

  it('всегда выставляет align: inside', () => {
    const result = readStroke(style({ borderTopWidth: '1px' }))
    // CSS рисует границу внутрь бокса, а Figma по умолчанию по центру.
    // При значении по умолчанию каждый элемент с границей сдвинулся бы
    // на половину толщины — поле существует, чтобы плагин обязан был
    // выставить strokeAlign, а не забыть про него.
    expect(result?.align).toBe('inside')
  })

  it('читает solid по умолчанию', () => {
    expect(readStroke(style({ borderTopWidth: '1px' }))?.style).toBe('solid')
  })

  it('читает dashed и dotted вместо молчаливого приведения к solid', () => {
    expect(readStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'dashed',
    }))?.style).toBe('dashed')
    expect(readStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'dotted',
    }))?.style).toBe('dotted')
  })

  it('берёт стиль первой видимой стороны', () => {
    const result = readStroke(style({
      borderBottomWidth: '3px', borderBottomStyle: 'dotted',
    }))
    expect(result?.style).toBe('dotted')
  })

  it('сводит редкие стили CSS к solid — Figma их не имеет', () => {
    // double, groove, ridge, inset, outset в Figma невыразимы.
    // Приведение к solid допустимо только вместе с диагностикой,
    // которую порождает вызывающий через hasNonSolidStroke.
    expect(readStroke(style({
      borderTopWidth: '4px', borderTopStyle: 'double',
    }))?.style).toBe('solid')
  })
})

describe('hasNonSolidStroke', () => {
  it('false при отсутствии границ', () => {
    expect(hasNonSolidStroke(style({}))).toBe(false)
  })

  it('false для solid', () => {
    expect(hasNonSolidStroke(style({ borderTopWidth: '1px' }))).toBe(false)
  })

  it('true для dashed — рендерер плана 1 штрихи не рисует', () => {
    expect(hasNonSolidStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'dashed',
    }))).toBe(true)
  })

  it('true для стиля, невыразимого в Figma', () => {
    expect(hasNonSolidStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'groove',
    }))).toBe(true)
  })

  it('не срабатывает на невидимой границе нулевой толщины', () => {
    expect(hasNonSolidStroke(style({ borderTopStyle: 'dashed' }))).toBe(false)
  })
})

describe('readCorner', () => {
  it('читает нулевые радиусы', () => {
    expect(readCorner(style({}))).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 })
  })

  it('читает разные радиусы по углам', () => {
    const result = readCorner(style({
      borderTopLeftRadius: '8px', borderBottomRightRadius: '16px',
    }))
    expect(result).toEqual({ tl: 8, tr: 0, br: 16, bl: 0 })
  })

  it('берёт горизонтальный радиус у эллиптического угла', () => {
    expect(readCorner(style({ borderTopLeftRadius: '10px 20px' })).tl).toBe(10)
  })
})
