import type { Rgba8, TextAlign, TextDecoration, TextRun } from '@w2f/ir'
import { parseColor } from './css/color.js'

/** ПСЕВДОЭЛЕМЕНТЫ `::before` и `::after`.
 *
 *  Самая массовая потеря содержимого из всех, что были у проекта: на
 *  восьми живых страницах — 710 записей в отчёте, семь страниц из
 *  восьми. Ими рисуют разделители, подчёркивания, блики, бейджи,
 *  номера строк и кавычки; ничего из этого в Figma не приезжало.
 *
 *  ГЛАВНОЕ ОГРАНИЧЕНИЕ, от которого всё здесь пляшет: у псевдоэлемента
 *  НЕТ узла в DOM, а значит нет и `getBoundingClientRect`. Геометрию
 *  взять неоткуда — кроме одного случая.
 *
 *  Случай этот — позиционирование. Измерено в Chrome: для
 *  `position: absolute` псевдоэлемента `getComputedStyle` отдаёт
 *  ИСПОЛЬЗОВАННЫЕ значения, готовые пиксели, даже там, где в
 *  таблице стилей стоит `auto`: `left: 280px` у элемента, прижатого
 *  через `right: 0`. Ширина и высота приходят так же. Этого хватает,
 *  чтобы построить бокс точно, а не приблизительно.
 *
 *  Для потокового псевдоэлемента всё наоборот: `width`, `height`,
 *  `top`, `left` приходят как `auto`, текстовых боксов у него нет, и
 *  вычислить положение нечем. Такой не переносится — и об этом есть
 *  запись. Догадка тут была бы хуже отказа: текст, поставленный не на
 *  своё место, выглядит как перенесённый. */

export type PseudoKind = '::before' | '::after'

/** Почему псевдоэлемент не перенесён. Причины разные по смыслу, и
 *  сводить их в одну нельзя: про одни пользователю надо знать, что
 *  потерян ТЕКСТ, про другие — что потеряно оформление. */
export type PseudoRefusal =
  | { reason: 'flow' }
  | { reason: 'containing-block' }
  | { reason: 'generated-content'; content: string }

export type PseudoBox = {
  /** Локально относительно padding box хозяина. */
  x: number
  y: number
  w: number
  h: number
}

export type PseudoRead =
  /** Псевдоэлемента нет вовсе. */
  | { kind: 'absent' }
  /** Есть, но рисовать нечего: ни фона, ни рамки, ни видимого текста.
   *  Сообщать о нём не нужно — потери нет, а запись в отчёте была бы
   *  шумом. На живых страницах такого 15% всех псевдоэлементов:
   *  склейки вроде U+2060 и одиночные пробелы. */
  | { kind: 'empty' }
  | { kind: 'refused'; refusal: PseudoRefusal; hasPaint: boolean }
  | { kind: 'node'; box: PseudoBox; text: PseudoText | null }

export type PseudoText = {
  characters: string
  run: TextRun
  lineHeight: number
  align: TextAlign
}

const px = (value: string): number | null => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Литерал в кавычках — единственная форма `content`, чей текст
 *  известен без раскладки.
 *
 *  `counter(...)`, `attr(...)`, `open-quote`, `url(...)` отдаются
 *  вычисленным стилем КАК ЗАПИСАНО, без значения: `content` для
 *  нумерованного списка приходит строкой `counter(n) ". "`. Подставить
 *  вместо счётчика догадку — значит написать в макете неверный номер,
 *  и заметить это будет некому. */
const literalOf = (content: string): string | null => {
  const trimmed = content.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null
  if (trimmed.length < 2) return null
  return trimmed
    .slice(1, -1)
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1')
}

/** Видим ли текст на экране.
 *
 *  Пробелы, неразрывные пробелы и склейки вроде U+2060 (word joiner)
 *  ставят, чтобы повлиять на перенос строк, а не чтобы их читали.
 *  Переносить нечего. */
const hasVisibleText = (value: string): boolean =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\s ​-‍⁠﻿\u0000-\u001f]/g, '') !== ''

const isPaintedColor = (color: Rgba8 | null): boolean =>
  color !== null && color.a > 0

const DECORATION: Record<string, TextDecoration> = {
  underline: 'underline', 'line-through': 'strikethrough',
}

const decorationOf = (cs: CSSStyleDeclaration): TextDecoration => {
  const line = cs.textDecorationLine
  for (const [key, value] of Object.entries(DECORATION)) {
    if (line.includes(key)) return value
  }
  return 'none'
}

/** Читает псевдоэлемент хозяина.
 *
 *  `hostCs` нужен не для стиля, а для ответа на один вопрос: является
 *  ли хозяин содержащим блоком. Абсолютный псевдоэлемент
 *  позиционируется относительно ближайшего позиционированного предка,
 *  и только когда это сам хозяин, его `left`/`top` можно сложить с
 *  боксом хозяина. Иначе они отсчитаны от кого-то ещё, и сложение дало
 *  бы узел, уехавший неизвестно куда. */
export const readPseudo = (
  host: Element,
  hostCs: CSSStyleDeclaration,
  which: PseudoKind,
): PseudoRead => {
  const cs = window.getComputedStyle(host, which)
  const content = cs.content
  if (content === 'none' || content === 'normal' || content === '') {
    return { kind: 'absent' }
  }
  if (cs.display === 'none' || Number.parseFloat(cs.opacity) === 0) {
    return { kind: 'absent' }
  }

  const background = parseColor(cs.backgroundColor)
  const borderWidth = Math.max(
    px(cs.borderTopWidth) ?? 0, px(cs.borderRightWidth) ?? 0,
    px(cs.borderBottomWidth) ?? 0, px(cs.borderLeftWidth) ?? 0,
  )
  const hasPaint =
    isPaintedColor(background) ||
    (borderWidth > 0 && isPaintedColor(parseColor(cs.borderTopColor))) ||
    cs.backgroundImage !== 'none' ||
    cs.boxShadow !== 'none'

  const literal = literalOf(content)
  const visibleText = literal !== null && hasVisibleText(literal)

  /** Ни краски, ни видимого текста — переносить нечего. */
  if (!hasPaint && !visibleText) return { kind: 'empty' }

  const positioned = cs.position === 'absolute' || cs.position === 'fixed'
  if (!positioned) {
    return { kind: 'refused', refusal: { reason: 'flow' }, hasPaint }
  }
  /** `fixed` отсчитывается от вьюпорта, а не от хозяина; `absolute` —
   *  от ближайшего позиционированного предка. Складывать с боксом
   *  хозяина можно только во втором случае и только когда предок —
   *  он сам. */
  if (cs.position === 'fixed' || hostCs.position === 'static') {
    return { kind: 'refused', refusal: { reason: 'containing-block' }, hasPaint }
  }

  const left = px(cs.left)
  const top = px(cs.top)
  const width = px(cs.width)
  const height = px(cs.height)
  if (left === null || top === null || width === null || height === null) {
    return { kind: 'refused', refusal: { reason: 'flow' }, hasPaint }
  }

  /** `width`/`height` вычисленного стиля — это CONTENT box. Узел в
   *  контракте несёт border box, поэтому паддинги и рамки
   *  прибавляются. Без этого бейдж с `padding: 2px 6px` приехал бы
   *  уже своего фона ровно на эти пиксели. */
  const padX = (px(cs.paddingLeft) ?? 0) + (px(cs.paddingRight) ?? 0)
  const padY = (px(cs.paddingTop) ?? 0) + (px(cs.paddingBottom) ?? 0)
  const borderX = (px(cs.borderLeftWidth) ?? 0) + (px(cs.borderRightWidth) ?? 0)
  const borderY = (px(cs.borderTopWidth) ?? 0) + (px(cs.borderBottomWidth) ?? 0)
  const box: PseudoBox = {
    x: left, y: top,
    w: width + padX + borderX,
    h: height + padY + borderY,
  }

  if (!visibleText || literal === null) return { kind: 'node', box, text: null }

  /** Текст переносится ТОЛЬКО в одну строку.
   *
   *  Боксов строк у псевдоэлемента нет, и разбиение взять неоткуда.
   *  Пока строка одна, она совпадает с боксом узла, и это факт, а не
   *  допущение. Как только высота содержимого заметно больше
   *  межстрочного расстояния, текст перенесён на несколько строк, а
   *  где именно — неизвестно. */
  const lineHeight = px(cs.lineHeight) ?? (px(cs.fontSize) ?? 16) * 1.2
  if (height > lineHeight * 1.5) {
    return {
      kind: 'refused',
      refusal: { reason: 'generated-content', content: literal },
      hasPaint,
    }
  }

  const color = parseColor(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 }
  const run: TextRun = {
    text: literal,
    fontStack: cs.fontFamily.split(',').map((name) => name.trim().replace(/^["']|["']$/g, '')),
    usedFamily: cs.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? 'sans-serif',
    fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
    fontStyle: cs.fontStyle === 'italic' ? 'italic' : 'normal',
    fontSize: px(cs.fontSize) ?? 16,
    letterSpacing: px(cs.letterSpacing) ?? 0,
    color,
    decoration: decorationOf(cs),
    shadows: [],
  }

  const align = (['left', 'right', 'center', 'justify'] as const)
    .find((value) => cs.textAlign === value) ?? 'left'

  return {
    kind: 'node', box,
    text: { characters: literal, run, lineHeight, align },
  }
}
