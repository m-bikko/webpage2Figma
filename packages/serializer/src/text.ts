import type { NodeText, TextAlign, TextDecoration, TextRun } from '@h2d/ir'
import { parseColor } from './css/color.js'
import { parsePx } from './css/length.js'
import { parseBoxShadow } from './css/shadow.js'

const ALIGN_MAP: Record<string, TextAlign> = {
  left: 'left', start: 'left',
  center: 'center',
  right: 'right', end: 'right',
  justify: 'justify',
}

const decorationOf = (cs: CSSStyleDeclaration): TextDecoration => {
  const line = cs.textDecorationLine
  if (line.includes('underline')) return 'underline'
  if (line.includes('line-through')) return 'strikethrough'
  return 'none'
}

/** `line-height: normal` не имеет численного значения в computed style.
 *  Множитель 1.2 — то, что использует Chrome для большинства шрифтов;
 *  точная величина восстанавливается из боксов строк. */
const lineHeightOf = (cs: CSSStyleDeclaration, fontSize: number): number => {
  if (cs.lineHeight === 'normal') return Math.round(fontSize * 1.2 * 100) / 100
  return parsePx(cs.lineHeight)
}

/** Разбирает объявленный `font-family` в список семейств.
 *  Кавычки снимаются, generic-семейства остаются: они значимы для отчёта. */
export const parseFontStack = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter((part) => part !== '')

/** Generic-семейства CSS. Доступны всегда и в CSS НЕ кавычатся:
 *  `"sans-serif"` в кавычках — литеральное имя семейства, которого нет
 *  ни в одной системе, а не ключевое слово. */
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'math', 'emoji', 'fangsong',
])

/** Строка содержит и узкие, и широкие глифы, и латиницу, и кириллицу:
 *  чем больше метрической разницы между шрифтами она вскрывает, тем
 *  надёжнее различение. */
const PROBE_TEXT = 'mmmmmwwwwwiiiii0123 МЖЩ'

/** Три подложки, а не одна: семейство может случайно совпасть по
 *  метрикам с одной из них, и тогда одиночная проверка дала бы ложное
 *  «семейства нет». */
const PROBE_FALLBACKS = ['monospace', 'serif', 'sans-serif'] as const

const availability = new Map<string, boolean>()

/** `undefined` — ещё не пробовали, `null` — canvas недоступен. */
let probeCtx: CanvasRenderingContext2D | null | undefined

const measure = (font: string): number | null => {
  if (probeCtx === undefined) {
    probeCtx = document.createElement('canvas').getContext('2d')
  }
  if (probeCtx === null) return null
  probeCtx.font = font
  return probeCtx.measureText(PROBE_TEXT).width
}

/** Имя семейства в кавычках, пригодное для шорткода `font`.
 *  Без экранирования имя с кавычкой давало бы невалидный шорткод, а
 *  `ctx.font` при невалидном значении молча сохраняет предыдущее — то
 *  есть измерение вернуло бы ширину чужого шрифта. */
const quoted = (family: string): string =>
  `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Доступно ли семейство для рисования.
 *
 *  `document.fonts.check()` для этого НЕ годится, хотя выглядит ровно как
 *  нужный вопрос. `FontFaceSet` содержит только `@font-face`, а для
 *  незнакомого имени спецификация предписывает считать шрифт доступным.
 *  Измерено в настоящем Chrome: `document.fonts.check('18px "NoSuchFontQQQ"')`
 *  возвращает `true`, как и для любой бессмыслицы. Из-за этого fallback не
 *  обнаруживался НИКОГДА, `usedFamily` всегда равнялся объявленному, а
 *  `fidelity.font-fallback` не мог сработать ни на одной странице.
 *
 *  Работающий приём — измерение на canvas: недоступное семейство даёт
 *  ровно ширину подложки, доступное отличается хотя бы от одной из трёх. */
const isFamilyAvailable = (family: string, fontSize: number): boolean => {
  if (GENERIC_FAMILIES.has(family.toLowerCase())) return true

  const key = `${family}|${fontSize}`
  const cached = availability.get(key)
  if (cached !== undefined) return cached

  let available = false
  for (const fallback of PROBE_FALLBACKS) {
    const base = measure(`${fontSize}px ${fallback}`)
    const probe = measure(`${fontSize}px ${quoted(family)}, ${fallback}`)
    /** Canvas недоступен — различить нечем. Считаем семейство доступным:
     *  иначе на каждом текстовом узле появилась бы ложная диагностика
     *  fallback, а ложная диагностика на всём подряд читается как шум
     *  и обесценивает отчёт целиком. */
    if (base === null || probe === null) {
      available = true
      break
    }
    if (probe !== base) {
      available = true
      break
    }
  }
  availability.set(key, available)
  return available
}

/** Находит семейство, которым браузер РЕАЛЬНО рисовал.
 *
 *  Это не педантизм: если объявлено `"Söhne", Helvetica` и Söhne в системе
 *  нет, браузер рисует Helvetica, и `lines` содержат метрики Helvetica.
 *  Записав в IR «Söhne», мы заставили бы плагин применить метрики Helvetica
 *  к настоящему Söhne (который в Figma может быть установлен) и получить
 *  вылезающий текст — причём с точки зрения IR шрифт был бы «найден»,
 *  и диагностика бы не сработала.
 *
 *  Первое доступное из стека и есть использованное. */
export const findUsedFamily = (stack: string[], fontSize: number): string => {
  if (typeof document === 'undefined') return stack[0] ?? 'sans-serif'
  for (const family of stack) {
    if (isFamilyAvailable(family, fontSize)) return family
  }
  return stack[0] ?? 'sans-serif'
}

/** Значения `white-space`, при которых браузер СХЛОПЫВАЕТ пробельные
 *  последовательности. Для `pre`, `pre-wrap`, `pre-line` и `break-spaces`
 *  пробелы значимы и трогать их нельзя. */
const COLLAPSING_WHITE_SPACE = new Set(['normal', 'nowrap'])

/** Схлопывает пробелы так же, как это делает браузер.
 *
 *  Иначе перенос строки и отступ из ИСХОДНИКА едут в IR как есть.
 *  Браузер рисует на их месте один пробел, а Figma пробелы не схлопывает
 *  — значит в макете появилась бы дыра там, где в разметке был перенос.
 *  Обнаружено именно pixel-diff'ом: в опорном рендере фикстуры `text`
 *  посреди строки зиял провал шириной в четыре пробела, и у строки с
 *  выравниванием по центру из-за лишней ширины уезжал анкер. */
export const collapseWhiteSpace = (text: string, cs: CSSStyleDeclaration): string =>
  COLLAPSING_WHITE_SPACE.has(cs.whiteSpace) ? text.replace(/\s+/g, ' ') : text

/** Убирает пробел, съеденный САМИМ переносом строки.
 *
 *  Обрезается только та граница, за которой есть ещё одна строка этого же
 *  текстового узла: там перенос, и пробел на нём браузер не рисует.
 *  Внешние границы узла остаются нетронутыми — пробел в конце `"Hello "`
 *  перед вложенным `<b>world</b>` разделяет слова, и его удаление склеило
 *  бы их в Figma. */
const trimAtLineBreaks = (
  text: string,
  cs: CSSStyleDeclaration,
  lineBefore: boolean,
  lineAfter: boolean,
): string => {
  if (!COLLAPSING_WHITE_SPACE.has(cs.whiteSpace)) return text
  const head = lineBefore ? text.replace(/^ +/, '') : text
  return lineAfter ? head.replace(/ +$/, '') : head
}

/** Применяет `text-transform` к самой строке.
 *
 *  В Figma этого свойства нет, поэтому преобразование обязано произойти
 *  здесь. Потеря невидима для обоих нижних слоёв: валидатор ловит
 *  несогласованные бандлы, а pixel-diff сравнивал бы одну и ту же
 *  непреобразованную строку с обеих сторон и остался бы зелёным. */
export const applyTextTransform = (text: string, cs: CSSStyleDeclaration): string => {
  switch (cs.textTransform) {
    case 'uppercase': return text.toLocaleUpperCase()
    case 'lowercase': return text.toLocaleLowerCase()
    case 'capitalize':
      return text.replace(
        /(^|\s)(\p{L})/gu,
        (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase(),
      )
    default: return text
  }
}

const weightOf = (cs: CSSStyleDeclaration): number => {
  const parsed = Number.parseInt(cs.fontWeight, 10)
  return Number.isNaN(parsed) ? 400 : parsed
}

/** Собственный текст узла: только ПРЯМЫЕ текстовые дети, без подграфа.
 *  Инвариант контракта требует, чтобы это равнялось конкатенации `lines`. */
const ownText = (el: Element): string => {
  let out = ''
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    out += node.textContent ?? ''
  }
  return out
}

/** Находит подстроку, попадающую в данный бокс строки, двигая границу
 *  Range посимвольно от позиции `from`. Единственный надёжный способ
 *  узнать, где именно браузер поставил перенос. */
const sliceForRect = (node: ChildNode, rect: DOMRect, from: number): string => {
  const full = node.textContent ?? ''
  const probe = document.createRange()
  let end = from
  while (end < full.length) {
    probe.setStart(node, from)
    probe.setEnd(node, end + 1)
    const candidate = probe.getBoundingClientRect()
    if (candidate.bottom > rect.bottom + 0.5) break
    end += 1
  }
  probe.detach()
  return full.slice(from, end)
}

/** Собирает боксы строк для прямых текстовых детей элемента. */
/** `origin` — экранное положение левого верхнего угла бокса узла.
 *  Вычитается, чтобы боксы строк легли в систему координат самого узла:
 *  `Range.getClientRects()` отдаёт экранные координаты, а контракт с
 *  плана 3 требует локальных. */
const readLines = (
  el: Element,
  cs: CSSStyleDeclaration,
  origin: { x: number; y: number },
): NodeText['lines'] => {
  const lines: NodeText['lines'] = []
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const content = node.textContent
    if (content === null || content.trim() === '') continue

    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = [...range.getClientRects()].filter(
      (rect) => rect.width > 0 && rect.height > 0,
    )

    let cursor = 0
    for (const [index, rect] of rects.entries()) {
      const raw = sliceForRect(node, rect, cursor)
      cursor += raw.length
      const visible = trimAtLineBreaks(
        collapseWhiteSpace(raw, cs), cs,
        index > 0, index < rects.length - 1,
      )
      lines.push({
        x: rect.left - origin.x,
        y: rect.top - origin.y,
        w: rect.width,
        h: rect.height,
        // Преобразование применяется и к строкам, и к рану — инвариант
        // контракта сверяет их конкатенации между собой.
        text: applyTextTransform(visible, cs),
      })
    }
    range.detach()
  }
  return lines
}

export type ReadTextResult =
  | { kind: 'text'; text: NodeText }
  | { kind: 'none' }
  /** Текст есть, но боксов строк нет. Молча вернуть «нет текста» означало бы,
   *  что он исчезает, не оставив в бандле следа, по которому это можно
   *  обнаружить ниже по конвейеру. Вызывающий обязан породить Diagnostic. */
  | { kind: 'lost'; sample: string }

export const readText = (
  el: Element,
  cs: CSSStyleDeclaration,
  origin: { x: number; y: number },
): ReadTextResult => {
  const own = ownText(el)
  if (own.trim() === '') return { kind: 'none' }

  const fontSize = parsePx(cs.fontSize)
  const stack = parseFontStack(cs.fontFamily)
  const color = parseColor(cs.color)

  const run: TextRun = {
    text: applyTextTransform(collapseWhiteSpace(own, cs), cs),
    fontStack: stack.length > 0 ? stack : ['sans-serif'],
    usedFamily: findUsedFamily(stack, fontSize),
    fontWeight: weightOf(cs),
    fontStyle: cs.fontStyle === 'italic' ? 'italic' : 'normal',
    fontSize,
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : parsePx(cs.letterSpacing),
    color: color ?? { r: 0, g: 0, b: 0, a: 1 },
    decoration: decorationOf(cs),
    shadows: parseBoxShadow(cs.textShadow),
  }

  const lines = readLines(el, cs, origin)
  if (lines.length === 0) return { kind: 'lost', sample: own.slice(0, 40) }

  return {
    kind: 'text',
    text: {
      runs: [run],
      lines,
      lineHeight: lineHeightOf(cs, fontSize),
      align: ALIGN_MAP[cs.textAlign] ?? 'left',
    },
  }
}

/** Цвет текста не разобран. Вызывающий обязан породить Diagnostic:
 *  подстановка чёрного в `readText` — молчаливый fallback, допущенный
 *  только чтобы не терять сам текст. */
export const hasUnparsedColor = (cs: CSSStyleDeclaration): boolean =>
  parseColor(cs.color) === null

/** Фактический шрифт отличается от объявленного. Вызывающий обязан
 *  породить `fontFallback` уровня error: это главный убийца точности. */
export const hasFontFallback = (cs: CSSStyleDeclaration): boolean => {
  const stack = parseFontStack(cs.fontFamily)
  const first = stack[0]
  if (first === undefined) return false
  return findUsedFamily(stack, parsePx(cs.fontSize)) !== first
}
