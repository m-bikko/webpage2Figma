import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { sizeFromDataUrl } from '../src/css/data-url.js'

/** Размер из ЗАГОЛОВКА, без декодирования.
 *
 *  Нужно потому, что приём с `new Image().complete` работает только для
 *  картинок, уже лежащих в кеше браузера. Для `data:`-URL декодирование
 *  асинхронно, хотя байты прямо здесь, — и синхронный обход получает
 *  `complete === false`.
 *
 *  Найдено на захвате НАСТОЯЩЕЙ страницы: 20 фоновых картинок из 28
 *  недоступных оказались `data:image/png`. Ни одна фикстура такого не
 *  содержала. */

const pngDataUrl = (width: number, height: number): string => {
  const png = new PNG({ width, height })
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

describe('sizeFromDataUrl', () => {
  it('читает размер PNG', () => {
    expect(sizeFromDataUrl(pngDataUrl(64, 32))).toEqual({ w: 64, h: 32 })
  })

  /** Неквадратный намеренно: на квадрате перепутанные ширина и высота
   *  неразличимы. */
  it('не путает ширину с высотой', () => {
    expect(sizeFromDataUrl(pngDataUrl(7, 3))).toEqual({ w: 7, h: 3 })
  })

  it('читает размер GIF', () => {
    /** Заголовок GIF87a: подпись, затем ширина и высота по два байта
     *  в ОБРАТНОМ порядке — в отличие от PNG. Именно поэтому формат
     *  разбирается отдельной веткой, а не общей. */
    const bytes = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x40, 0x00, 0x20, 0x00,
    ])
    const base64 = Buffer.from(bytes).toString('base64')
    expect(sizeFromDataUrl(`data:image/gif;base64,${base64}`)).toEqual({ w: 64, h: 32 })
  })

  it('не наш URL — null, а не догадка', () => {
    expect(sizeFromDataUrl('https://example.test/a.png')).toBeNull()
  })

  it('обрезанный data-URL — null, а не мусор', () => {
    expect(sizeFromDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull()
  })

  /** Неизвестный формат не выдаётся за разобранный: подставить сюда
   *  что-нибудь правдоподобное значило бы исказить масштаб молча. */
  it('неизвестный формат — null', () => {
    expect(sizeFromDataUrl('data:image/webp;base64,UklGRhYAAABXRUJQ')).toBeNull()
  })
})
