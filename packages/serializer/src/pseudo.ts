import type { Rgba8, TextAlign, TextDecoration, TextRun } from '@w2f/ir'
import { parseColor } from './css/color.js'
import { formatCounter, type CounterValues } from './counters.js'

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
  /** Текст есть, но его ЗНАЧЕНИЕ неизвестно: `counter()`, `attr()`,
   *  `open-quote`. Вычисленный стиль отдаёт их как записано. */
  | { reason: 'generated'; content: string }
  /** Текст известен, но не помещается в одну строку, а мест переносов
   *  у псевдоэлемента взять неоткуда. */
  | { reason: 'multiline'; content: string }

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
  /** `lostText` — текст, который у узла ЕСТЬ на странице, но не
   *  переносится. Узел при этом строится: его подложка видна, и
   *  выбрасывать её было бы потерей вдобавок к потере. */
  | {
      kind: 'node'; box: PseudoBox; text: PseudoText | null
      lostText?: PseudoRefusal
    }

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
/** Разворачивает `content` в строку, подставляя значения счётчиков.
 *
 *  `content` — это СПИСОК частей: литералы в кавычках вперемешку с
 *  функциями. `content: "шаг " counter(c)` — две части, и печатается
 *  их склейка. Разбирать только первую значило бы терять половину
 *  надписи.
 *
 *  `null` означает, что встретилась часть, чьё значение взять
 *  неоткуда: `attr()` на чужом атрибуте, `url()`, `open-quote`.
 *  Частичная подстановка запрещена — обрывок надписи выглядит как
 *  целая и потому хуже честного отказа. */
const expandContent = (
  content: string,
  counters: CounterValues,
  host: Element,
): string | null => {
  const parts = splitContentParts(content)
  if (parts.length === 0) return null

  let out = ''
  for (const part of parts) {
    const literal = quotedLiteral(part)
    if (literal !== null) { out += literal; continue }

    const single = /^counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)$/.exec(part)
    if (single?.[1] !== undefined) {
      /** Счётчика с таким именем нет — печатается НОЛЬ, а не отказ.
       *  Так требует спецификация: использование несуществующего
       *  счётчика неявно создаёт его со значением ноль. Отказ здесь
       *  был бы не осторожностью, а расхождением с браузером, причём
       *  ровно в том месте, где область видимости кончилась. */
      const value = counters.top.get(single[1]) ?? 0
      out += formatCounter(value, single[2] ?? 'decimal')
      continue
    }

    const nested =
      /^counters\(\s*([\w-]+)\s*,\s*("[^"]*")\s*(?:,\s*([\w-]+)\s*)?\)$/
        .exec(part)
    if (nested?.[1] !== undefined && nested[2] !== undefined) {
      const chain = counters.chain.get(nested[1]) ?? [0]
      const separator = quotedLiteral(nested[2]) ?? ''
      out += chain
        .map((value) => formatCounter(value, nested[3] ?? 'decimal'))
        .join(separator)
      continue
    }

    const attribute = /^attr\(\s*([\w-]+)\s*\)$/.exec(part)
    if (attribute?.[1] !== undefined) {
      /** `attr()` читает атрибут ХОЗЯИНА, и он у нас под рукой.
       *  Отсутствующий атрибут даёт пустую строку — так определено в
       *  спецификации, и отказ здесь был бы расхождением с браузером,
       *  а не осторожностью. */
      out += host.getAttribute(attribute[1]) ?? ''
      continue
    }

    return null
  }
  return out
}

/** Делит `content` на части верхнего уровня: кавычки и функции.
 *  Наивное деление по пробелам сломалось бы и на пробеле внутри
 *  строки, и на пробеле внутри `counters(c, ". ")`. */
const splitContentParts = (content: string): string[] => {
  const parts: string[] = []
  let current = ''
  let inQuotes = false
  let depth = 0
  for (const ch of content.trim()) {
    if (ch === '"') { inQuotes = !inQuotes; current += ch; continue }
    if (!inQuotes && ch === '(') depth += 1
    if (!inQuotes && ch === ')') depth -= 1
    if (!inQuotes && depth === 0 && /\s/.test(ch)) {
      if (current !== '') { parts.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (current !== '') parts.push(current)
  return parts
}

/** Содержимое строки в кавычках с раскрытыми экранированиями. */
const quotedLiteral = (part: string): string | null => {
  const text = part.trim()
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return null
  return text
    .slice(1, -1)
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1')
}

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


/** Прямоугольник, от которого отсчитывается абсолютный псевдоэлемент,
 *  и бокс хозяина — в одних и тех же экранных координатах.
 *
 *  `null` означает, что перевод небезопасен: на пути есть трансформа.
 *  `getBoundingClientRect` возвращает габарит уже трансформированного
 *  элемента, и разность таких габаритов не является смещением в осях
 *  родителя — узел уехал бы тем сильнее, чем больше поворот. Отказ
 *  здесь честнее подстановки правдоподобного числа. */
const containingBlockOf = (
  host: Element,
  cs: CSSStyleDeclaration,
  hostCs: CSSStyleDeclaration,
): { x: number; y: number; hostX: number; hostY: number } | null => {
  const hostRect = host.getBoundingClientRect()
  if (hostCs.transform !== 'none') return null

  /** `fixed` отсчитывается от вьюпорта — начала экранных координат,
   *  в которых и живёт `getBoundingClientRect`. */
  if (cs.position === 'fixed') {
    return { x: 0, y: 0, hostX: hostRect.left, hostY: hostRect.top }
  }

  /** Хозяин позиционирован — он и есть содержащий блок. Отсчёт идёт
   *  от его PADDING box, то есть от границы внутрь на толщину рамки. */
  if (hostCs.position !== 'static') {
    return {
      x: hostRect.left + (Number.parseFloat(hostCs.borderLeftWidth) || 0),
      y: hostRect.top + (Number.parseFloat(hostCs.borderTopWidth) || 0),
      hostX: hostRect.left, hostY: hostRect.top,
    }
  }

  /** Иначе — ближайший позиционированный предок. `offsetParent` даёт
   *  ровно его, но не годится при `position: fixed` у предка и внутри
   *  `display: none`; в обоих случаях он возвращает `null`, и отказ
   *  честнее догадки. */
  const parent = (host as HTMLElement).offsetParent
  if (parent === null) return null
  const parentCs = window.getComputedStyle(parent)
  if (parentCs.transform !== 'none') return null
  const parentRect = parent.getBoundingClientRect()
  return {
    x: parentRect.left + (Number.parseFloat(parentCs.borderLeftWidth) || 0),
    y: parentRect.top + (Number.parseFloat(parentCs.borderTopWidth) || 0),
    hostX: hostRect.left, hostY: hostRect.top,
  }
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
  /** Значения счётчиков, посчитанные заранее одним проходом по
   *  документу. `null` означает, что счётчики не считались, и тогда
   *  сгенерированное содержимое остаётся неразрешимым. */
  counters: CounterValues | null,
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

  /** Сначала — полное разворачивание со счётчиками; чистый литерал
   *  разбирается той же функцией и потому отдельной ветки не
   *  требует. */
  const literal = counters === null
    ? literalOf(content)
    : expandContent(content, counters, host)
  const visibleText = literal !== null && hasVisibleText(literal)

  /** Содержимое ЕСТЬ, но его значение неизвестно: `counter(n)`,
   *  `attr(data-x)`, `open-quote`. Вычисленный стиль отдаёт такие
   *  строки как записано, без подстановки.
   *
   *  Отличать это от пустоты критично. Первая редакция валила оба
   *  случая в «переносить нечего», и номера строк в блоках кода —
   *  `counter(line)`, самая частая форма сгенерированного содержимого
   *  на живых страницах — исчезали МОЛЧА, без записи в отчёте.
   *  Тихая потеря содержимого есть ровно то, против чего заведена вся
   *  диагностика проекта. */
  const generated = literal === null && content.trim() !== '""'

  /** Ни краски, ни видимого текста, ни сгенерированного — переносить
   *  действительно нечего, и запись была бы шумом. */
  if (!hasPaint && !visibleText && !generated) return { kind: 'empty' }


  /** ПОРЯДОК ПРОВЕРОК ЗДЕСЬ — ЧАСТЬ СМЫСЛА.
   *
   *  Сначала геометрия, потом содержимое. Причина в том, что
   *  пользователю сообщается не «чего не хватило нам», а «что с этим
   *  можно сделать»: для потокового узла бокса нет в принципе, и
   *  знание значения счётчика ничего бы не изменило. Назвать такой
   *  случай «сгенерированным содержимым» значило бы указать на
   *  поправимое там, где препятствие непреодолимо.
   *
   *  Первая редакция проверяла содержимое раньше, и на живой
   *  странице все 87 записей оказались названы «сгенерированным
   *  содержимым», хотя среди них были и потоковые. */
  const positioned = cs.position === 'absolute' || cs.position === 'fixed'
  if (!positioned) {
    return { kind: 'refused', refusal: { reason: 'flow' }, hasPaint }
  }
  /** СОДЕРЖАЩИЙ БЛОК находится, а не требуется от хозяина.
   *
   *  Первая редакция отказывалась, когда хозяин не позиционирован, —
   *  и на живой странице так отсеклись ВСЕ 88 псевдоэлементов до
   *  единого. Отказ был лишним: содержащий блок абсолютного потомка —
   *  ближайший позиционированный предок, и его можно найти. Для
   *  `fixed` это вьюпорт, тоже вполне определённый прямоугольник.
   *
   *  Координаты потом переводятся в систему ХОЗЯИНА, потому что
   *  псевдоузел едет его ребёнком, а `rect` в контракте локален
   *  относительно родителя. */
  const container = containingBlockOf(host, cs, hostCs)
  if (container === null) {
    return { kind: 'refused', refusal: { reason: 'containing-block' }, hasPaint }
  }

  const left = px(cs.left)
  const top = px(cs.top)
  const width = px(cs.width)
  const height = px(cs.height)
  if (left === null || top === null || width === null || height === null) {
    return { kind: 'refused', refusal: { reason: 'flow' }, hasPaint }
  }

  /** Геометрия есть, а значения содержимого нет. Теперь причина
   *  названа точно: не хватает именно значения, и бокс тут ни при
   *  чём. Краска, если она есть, всё равно переносится — ветка ниже. */
  if (generated && !hasPaint) {
    return {
      kind: 'refused',
      refusal: { reason: 'generated', content: content.trim() },
      hasPaint,
    }
  }

  /** `width`/`height` вычисленного стиля — это CONTENT box. Узел в
   *  контракте несёт border box, поэтому паддинги и рамки
   *  прибавляются. Без этого бейдж с `padding: 2px 6px` приехал бы
   *  уже своего фона ровно на эти пиксели. */
  const padX = (px(cs.paddingLeft) ?? 0) + (px(cs.paddingRight) ?? 0)
  const padY = (px(cs.paddingTop) ?? 0) + (px(cs.paddingBottom) ?? 0)
  const borderX = (px(cs.borderLeftWidth) ?? 0) + (px(cs.borderRightWidth) ?? 0)
  const borderY = (px(cs.borderTopWidth) ?? 0) + (px(cs.borderBottomWidth) ?? 0)
  /** Из системы содержащего блока — в систему хозяина.
   *
   *  `left`/`top` отсчитаны от padding box содержащего блока; бокс
   *  хозяина known в экранных координатах. Разность и даёт локальную
   *  координату. Когда содержащий блок и есть хозяин, слагаемые
   *  сокращаются до прежней формулы — но теперь это следствие, а не
   *  отдельный случай. */
  const box: PseudoBox = {
    x: container.x + left - container.hostX,
    y: container.y + top - container.hostY,
    w: width + padX + borderX,
    h: height + padY + borderY,
  }

  /** Краска есть, а текст сгенерирован: подложка переносится, текст —
   *  нет. Узел при этом СТРОИТСЯ, поэтому отказать нельзя, а промолчать
   *  тем более: в макете появится пустая плашка там, где на странице
   *  стоял номер. Возвращается узел И причина — вызывающий обязан
   *  сообщить о потерянном тексте, сохранив подложку. */
  if (generated) {
    return {
      kind: 'node', box, text: null,
      lostText: { reason: 'generated', content: content.trim() },
    }
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
    /** Подложка у многострочного тоже может быть, и терять её незачем:
     *  узел строится, а о потерянном тексте сообщает вызывающий. */
    if (hasPaint) {
      return {
        kind: 'node', box, text: null,
        lostText: { reason: 'multiline', content: literal },
      }
    }
    return {
      kind: 'refused',
      refusal: { reason: 'multiline', content: literal },
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
