import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
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

  /** Утверждение ПЕРЕВЁРНУТО: SVG больше не отделяется от растра.
   *
   *  Раньше он уходил в отдельную ветку и не переносился вовсе — на
   *  Hacker News это давало 30 записей из 31 всего отчёта. Теперь он
   *  едет тем же путём ассета, только байтами исходника, и плагин
   *  строит из них векторный узел. Требовать здесь `vector` значило бы
   *  заморозить пробел: тест падал бы именно тогда, когда его
   *  закрыли. */
  it('svg по url() идёт обычным путём ассета, как и растр', () => {
    const verdict = classifyBackgroundImage('url("/icon.svg")')
    expect(verdict.kind).toBe('raster')
    if (verdict.kind !== 'raster') return
    expect(verdict.url).toBe('/icon.svg')
  })

  /** Утверждение ПЕРЕВЁРНУТО: многослойность здесь больше не
   *  разбирается вовсе.
   *
   *  Слои разделяет вызывающий и передаёт сюда по одному, поэтому
   *  ветка «несколько слоёв» осталась бы мёртвой. А мёртвая ветка с
   *  кодом диагностики выглядит как работающая защита — и потому хуже
   *  её отсутствия.
   *
   *  Что разбор делает со списком теперь: берёт первый слой, а не
   *  склейку. Утверждение об этом и стоит ниже — оно описывает
   *  поведение, а не отсутствие поведения. */
  it('список слоёв разбирается по первому, а не склейкой', () => {
    const verdict = classifyBackgroundImage('url(a.png), linear-gradient(red, blue)')
    expect(verdict.kind).toBe('raster')
    if (verdict.kind !== 'raster') return
    expect(verdict.url).toBe('a.png')
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
