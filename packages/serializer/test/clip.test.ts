import { describe, expect, it } from 'vitest'
import { clipsAwayEverything } from '../src/css/clip.js'

/** Граница этого правила несимметрична по цене, и потому проверяется
 *  подробно.
 *
 *  Сработало где не надо — элемент молча исчез из макета: потеря
 *  содержимого, причём без единой записи в отчёте, потому что
 *  невидимые узлы не диагностируются вовсе. Не сработало где надо —
 *  в макете появился лишний невидимый текст, что заметно сразу.
 *
 *  Поэтому правило обязано отвечать «да» только на доказанное
 *  схлопывание, и таких тестов здесь больше, чем на обратный случай. */

const box = { w: 200, h: 40 }

describe('clipsAwayEverything: схлопывает', () => {
  it('inset(50%) — обе оси в ноль', () => {
    expect(clipsAwayEverything('inset(50%)', box)).toBe(true)
  })

  /** Самая частая форма идиомы sr-only в дикой природе. */
  it('inset(0px 100% 100% 0px) — правый и нижний край съедают всё', () => {
    expect(clipsAwayEverything('inset(0px 100% 100% 0px)', box)).toBe(true)
  })

  it('inset(0px 0px 100%) — схлопнуто только по высоте', () => {
    expect(clipsAwayEverything('inset(0px 0px 100%)', box)).toBe(true)
  })

  it('пиксели, перекрывающие бокс, тоже схлопывают', () => {
    expect(clipsAwayEverything('inset(30px)', { w: 200, h: 40 })).toBe(true)
  })

  /** Часть после `round` описывает скругление выреза, а не размеры. */
  it('round не мешает распознать схлопывание', () => {
    expect(clipsAwayEverything('inset(50% round 4px)', box)).toBe(true)
  })
})

describe('clipsAwayEverything: НЕ схлопывает', () => {
  it('частичная обрезка оставляет содержимое', () => {
    expect(clipsAwayEverything('inset(6px 12px)', box)).toBe(false)
  })

  it('inset(0px) не режет ничего', () => {
    expect(clipsAwayEverything('inset(0px)', box)).toBe(false)
  })

  it('none — обрезки нет', () => {
    expect(clipsAwayEverything('none', box)).toBe(false)
  })

  /** Другие формы не разбираются вовсе: частичная обрезка — это
   *  приближение, а выкинуть из-за неё узел значило бы потерять
   *  содержимое. */
  it('circle, polygon и url не трогаются', () => {
    expect(clipsAwayEverything('circle(50%)', box)).toBe(false)
    expect(clipsAwayEverything('polygon(0 0, 100% 0, 50% 100%)', box)).toBe(false)
    expect(clipsAwayEverything('url(#mask)', box)).toBe(false)
  })

  /** Неизвестное значение обязано означать «не знаю», а не «ноль»:
   *  иначе `calc()` в вырезе схлопнул бы узел на пустом месте. */
  it('неразобранное значение не считается схлопыванием', () => {
    expect(clipsAwayEverything('inset(calc(50% - 2px))', box)).toBe(false)
    expect(clipsAwayEverything('inset(auto)', box)).toBe(false)
  })
})
