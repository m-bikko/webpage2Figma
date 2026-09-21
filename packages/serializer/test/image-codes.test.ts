import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES } from '@h2d/ir/codes'
import { classifyBackgroundImage } from '../src/css/image.js'

describe('classifyBackgroundImage', () => {
  it('растр по url() не называется градиентом', () => {
    const verdict = classifyBackgroundImage('url("https://example.test/a.png")')
    expect(verdict.kind).toBe('raster')
    if (verdict.kind !== 'raster') return
    expect(verdict.url).toBe('https://example.test/a.png')
  })

  it('линейный градиент остаётся градиентом', () => {
    expect(classifyBackgroundImage('linear-gradient(red, blue)').kind)
      .toBe('gradient')
  })

  /** SVG по url() — вектор, а не растр: перенести его пикселями значило
   *  бы молча потерять масштабируемость. Отдельная ветка нужна именно
   *  поэтому, а не ради аккуратности. */
  it('svg по url() отправляется в вектор, а не в растр', () => {
    const verdict = classifyBackgroundImage('url("/icon.svg")')
    expect(verdict.kind).toBe('vector')
    if (verdict.kind !== 'vector') return
    expect(verdict.code).toBe(DIAGNOSTIC_CODES.deferredVector)
  })

  /** Несколько слоёв фона контракт представить может (`fills` — список),
   *  но их порядок и смешение не измерены. Пока это отложенный случай,
   *  и он обязан отличаться от «не разобрали одиночный градиент». */
  it('несколько слоёв — отдельный вердикт, а не первый слой молча', () => {
    expect(classifyBackgroundImage('url(a.png), linear-gradient(red, blue)').kind)
      .toBe('multi-layer')
  })

  /** Ключевой случай для разбора слоёв: запятые ВНУТРИ градиента не
   *  являются границами слоёв. Наивный split(',') объявил бы обычный
   *  двухцветный градиент многослойным. */
  it('запятые внутри градиента не считаются границами слоёв', () => {
    expect(classifyBackgroundImage('linear-gradient(90deg, rgb(1, 2, 3), blue)').kind)
      .toBe('gradient')
  })

  it('none — это отсутствие фона', () => {
    expect(classifyBackgroundImage('none').kind).toBe('none')
  })
})
