import { describe, expect, it } from 'vitest'
import { applyTextTransform, parseFontStack } from '../src/text.js'

const cs = (textTransform: string): CSSStyleDeclaration =>
  ({ textTransform }) as unknown as CSSStyleDeclaration

describe('parseFontStack', () => {
  it('разбирает список и снимает кавычки', () => {
    expect(parseFontStack('"Söhne", Helvetica, sans-serif'))
      .toEqual(['Söhne', 'Helvetica', 'sans-serif'])
  })

  it('оставляет generic-семейства: они значимы для отчёта', () => {
    expect(parseFontStack('system-ui')).toEqual(['system-ui'])
  })

  it('снимает одинарные кавычки', () => {
    expect(parseFontStack("'Times New Roman', serif"))
      .toEqual(['Times New Roman', 'serif'])
  })

  it('не возвращает пустых элементов', () => {
    expect(parseFontStack('Arial,,')).toEqual(['Arial'])
  })
})

describe('applyTextTransform', () => {
  it('none оставляет строку как есть', () => {
    expect(applyTextTransform('Привет Мир', cs('none'))).toBe('Привет Мир')
  })

  it('uppercase поднимает регистр, включая кириллицу', () => {
    expect(applyTextTransform('привет мир', cs('uppercase'))).toBe('ПРИВЕТ МИР')
  })

  it('lowercase опускает регистр', () => {
    expect(applyTextTransform('ПРИВЕТ МИР', cs('lowercase'))).toBe('привет мир')
  })

  it('capitalize поднимает первую букву каждого слова', () => {
    expect(applyTextTransform('привет мир', cs('capitalize'))).toBe('Привет Мир')
  })

  it('capitalize не ломает слова после переноса строки', () => {
    expect(applyTextTransform('раз\nдва', cs('capitalize'))).toBe('Раз\nДва')
  })

  it('capitalize не трогает буквы внутри слова', () => {
    expect(applyTextTransform('iPhone', cs('capitalize'))).toBe('IPhone')
  })
})
