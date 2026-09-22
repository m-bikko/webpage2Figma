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

  /** Разворот порядка — только половина дела. У `-reverse` главная ось
   *  идёт с конца, и `justify-content: start` прижимает детей к
   *  правому краю. Без разворота выравнивания единственный ребёнок
   *  ряда вставал слева, а браузер клал его справа: сдвиг на 8 в
   *  контейнере 32 с ребёнком 24 на живой странице. */
  it('у обратного направления выравнивание по главной оси разворачивается', () => {
    const reversed = (justify: string) => readLayout(style({
      display: 'flex', flexDirection: 'row-reverse', justifyContent: justify,
    })).justify
    expect(reversed('flex-start')).toBe('end')
    expect(reversed('flex-end')).toBe('start')
    expect(reversed('normal')).toBe('end')
    expect(reversed('center')).toBe('center')
    expect(reversed('space-between')).toBe('space-between')
  })

  it('у прямого направления выравнивание не трогается', () => {
    expect(readLayout(style({
      display: 'flex', flexDirection: 'row', justifyContent: 'flex-start',
    })).justify).toBe('start')
  })

  /** Сетка записывается СЕТКОЙ, а не сводится к колонке.
   *
   *  Раньше сводилась, и это было ошибкой проектирования: IR описывает
   *  страницу, а не то, во что её удобно превратить. Плагин после
   *  сведения уже не мог узнать, что это была сетка, и предсказывал
   *  раскладку по неверной оси.
   *
   *  Измерено на живой странице: именно это было главной причиной
   *  отказов от auto-layout — двухколоночная сетка предсказывалась
   *  как стопка и расходилась с измеренным на сотни пикселей. Решение,
   *  как выразить сетку, теперь принимает плагин: одномерную кладёт по
   *  её настоящей оси, двумерную честно отвергает. */
  it('grid записывается сеткой, а не сводится к колонке', () => {
    expect(readLayout(style({ display: 'grid' })).mode).toBe('grid')
  })


  it('берёт gap по главной оси', () => {
    const row = readLayout(style({ display: 'flex', columnGap: '12px', rowGap: '4px' }))
    expect(row.gap).toBe(12)
    const col = readLayout(style({
      display: 'flex', flexDirection: 'column', columnGap: '12px', rowGap: '4px',
    }))
    expect(col.gap).toBe(4)
  })

  it('normal gap даёт ноль — проверка результата, не ветки', () => {
    // Намеренно отмечено: эта проверка НЕ доказывает существование
    // отдельной обработки 'normal'. parsePx возвращает ноль на любом
    // неразбираемом значении, поэтому результат тот же и без неё.
    // Ветка удалена как мёртвая; тест оставлен, потому что сам
    // результат важен.
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
