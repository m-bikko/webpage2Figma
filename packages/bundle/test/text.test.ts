import { describe, expect, it } from 'vitest'
import { decodeBundleText, encodeBundleText } from '../src/text.js'

/** Что здесь проверяется и почему именно это.
 *
 *  Кодек сам по себе тривиален, и проверять «base64 работает» было бы
 *  пусто. Проверяются ОТКАЗЫ: путь через буфер обмена тем и опасен,
 *  что в буфере у человека лежит что угодно, а строка легко приезжает
 *  обрезанной. Каждый такой случай обязан кончаться внятным текстом, а
 *  не молчанием и не «неверный формат».
 *
 *  Круговой обход здесь НЕ тавтология, в отличие от вектора: байты
 *  проходят через две разные функции с разной арифметикой, и
 *  переполнение стека на длинных входах ловится именно им. */

const bytes = (...values: number[]) => new Uint8Array(values)

describe('encodeBundleText / decodeBundleText', () => {
  it('круговой обход возвращает те же байты', () => {
    const source = bytes(0, 1, 2, 250, 251, 255, 128, 64)
    expect(decodeBundleText(encodeBundleText(source))).toEqual(source)
  })

  /** Длина больше размера куска: разбиение на куски по 32768 заведено
   *  ради стека вызовов, и без входа такой длины оно не проверяется
   *  вовсе. 200000 байт — три куска с хвостом. */
  it('длинный вход переживает разбиение на куски', () => {
    const source = new Uint8Array(200000)
    for (let i = 0; i < source.length; i += 1) source[i] = i % 256
    const decoded = decodeBundleText(encodeBundleText(source))
    expect(decoded.length).toBe(source.length)
    expect(decoded).toEqual(source)
  })

  it('строка начинается с маркера версии', () => {
    expect(encodeBundleText(bytes(1, 2, 3)).startsWith('w2f1:')).toBe(true)
  })

  /** Пробелы по краям приносит любой путь через буфер. */
  it('обрамляющие пробелы и переносы не мешают', () => {
    const source = bytes(9, 8, 7)
    const messy = `\n  ${encodeBundleText(source)}  \n`
    expect(decodeBundleText(messy)).toEqual(source)
  })

  /** Почта и мессенджеры ломают длинную строку переносами. */
  it('переносы внутри base64 снимаются', () => {
    const source = new Uint8Array(3000).fill(42)
    const encoded = encodeBundleText(source)
    const wrapped = encoded.replace(/(.{76})/g, '$1\n')
    expect(decodeBundleText(wrapped)).toEqual(source)
  })

  it('чужой текст отвергается с указанием, что делать', () => {
    expect(() => decodeBundleText('просто текст из буфера'))
      .toThrow(/не бандл webpage2figma/)
    expect(() => decodeBundleText('просто текст из буфера'))
      .toThrow(/Скопировать для Figma/)
  })

  it('пустое поле названо пустым, а не повреждённым', () => {
    expect(() => decodeBundleText('   ')).toThrow(/пустое/)
  })

  /** Обрезанная строка — самый вероятный отказ на большом бандле, и
   *  отличать его от «вставил не то» обязательно: действия разные. */
  it('обрезанная строка названа обрезанной', () => {
    const encoded = encodeBundleText(new Uint8Array(1000).fill(7))
    /** Один символ с конца: длина перестаёт делиться на четыре, и
     *  `atob` отказывает. */
    expect(() => decodeBundleText(encoded.slice(0, -1)))
      .toThrow(/повреждена или скопирована не целиком/)
  })

  it('маркер без содержимого назван пустым значением', () => {
    expect(() => decodeBundleText('w2f1:')).toThrow(/ничего нет/)
  })
})
