import type { LayoutAlign, LayoutJustify, LayoutMode, NodeLayout } from '@w2f/ir'
import { parsePx } from './css/length.js'

/** `column-gap: normal` для flex и grid означает ноль, и `parsePx` уже
 *  возвращает ноль на любом неразбираемом значении — это его
 *  задокументированный и протестированный контракт. Отдельная ветка на
 *  'normal' была бы мёртвым кодом: её удаление не смогло бы сломать ни
 *  один тест, то есть проверить её существование нечем. */
const gapValue = (value: string): number => parsePx(value)

const ALIGN_MAP: Record<string, LayoutAlign> = {
  'flex-start': 'start',
  start: 'start',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  stretch: 'stretch',
  baseline: 'baseline',
}

const JUSTIFY_MAP: Record<string, LayoutJustify> = {
  'flex-start': 'start',
  start: 'start',
  normal: 'start',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  'space-between': 'space-between',
  'space-around': 'space-around',
  'space-evenly': 'space-evenly',
}

/** Сетка записывается СЕТКОЙ, а не сводится к колонке.
 *
 *  IR описывает страницу, а не то, во что её удобно превратить.
 *  Сведение здесь означало бы, что плагин уже не узнает, была ли это
 *  сетка, и станет предсказывать раскладку по неверной оси — измерено
 *  на живой странице как главная причина отказов от auto-layout. */
const modeOf = (cs: CSSStyleDeclaration): LayoutMode => {
  const display = cs.display
  if (display === 'grid' || display === 'inline-grid') return 'grid'
  if (display !== 'flex' && display !== 'inline-flex') return 'none'
  return cs.flexDirection.startsWith('column') ? 'column' : 'row'
}

export const readLayout = (cs: CSSStyleDeclaration): NodeLayout => {
  const mode = modeOf(cs)
  const gap = mode === 'column' ? gapValue(cs.rowGap) : gapValue(cs.columnGap)
  const alignRaw = cs.alignItems
  const align: LayoutAlign =
    alignRaw === 'normal'
      ? (mode === 'none' ? 'start' : 'stretch')
      : (ALIGN_MAP[alignRaw] ?? 'start')

  const justify = JUSTIFY_MAP[cs.justifyContent] ?? 'start'
  return {
    mode,
    gap,
    padding: {
      top: parsePx(cs.paddingTop),
      right: parsePx(cs.paddingRight),
      bottom: parsePx(cs.paddingBottom),
      left: parsePx(cs.paddingLeft),
    },
    align,
    /** У `-reverse` главная ось идёт с КОНЦА: `justify-content: start`
     *  прижимает детей к правому краю ряда, а не к левому. Порядок
     *  детей обходчик уже разворачивает; без разворота выравнивания
     *  решатель клал единственного ребёнка слева, а браузер — справа.
     *  Измерено на живой странице: сдвиг ровно на 8 в контейнере 32 с
     *  ребёнком 24. `space-*` симметричны и не меняются. */
    justify: isReversed(cs) ? FLIPPED[justify] : justify,
    wrap: cs.flexWrap.startsWith('wrap'),
  }
}

const FLIPPED: Record<LayoutJustify, LayoutJustify> = {
  start: 'end', end: 'start', center: 'center',
  'space-between': 'space-between', 'space-around': 'space-around',
  'space-evenly': 'space-evenly',
}

export const isReversed = (cs: CSSStyleDeclaration): boolean =>
  cs.flexDirection.endsWith('-reverse')
