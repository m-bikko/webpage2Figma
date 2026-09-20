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

/** Находит семейство, которым браузер РЕАЛЬНО рисовал.
 *
 *  Это не педантизм: если объявлено `"Söhne", Helvetica` и Söhne в системе
 *  нет, браузер рисует Helvetica, и `lines` содержат метрики Helvetica.
 *  Записав в IR «Söhne», мы заставили бы плагин применить метрики Helvetica
 *  к настоящему Söhne (который в Figma может быть установлен) и получить
 *  вылезающий текст — причём с точки зрения IR шрифт был бы «найден»,
 *  и диагностика бы не сработала.
 *
 *  `document.fonts.check` отвечает на вопрос «доступно ли это семейство
 *  для рисования». Первое доступное из стека и есть использованное. */
export const findUsedFamily = (stack: string[], fontSize: number): string => {
  if (typeof document === 'undefined' || document.fonts === undefined) {
    return stack[0] ?? 'sans-serif'
  }
  for (const family of stack) {
    try {
      if (document.fonts.check(`${fontSize}px "${family}"`)) return family
    } catch {
      // Некорректное для CSS имя семейства: пропускаем, не роняя захват.
      continue
    }
  }
  return stack[0] ?? 'sans-serif'
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
const readLines = (
  el: Element,
  cs: CSSStyleDeclaration,
  scrollX: number,
  scrollY: number,
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
    for (const rect of rects) {
      const raw = sliceForRect(node, rect, cursor)
      cursor += raw.length
      lines.push({
        x: rect.left + scrollX,
        y: rect.top + scrollY,
        w: rect.width,
        h: rect.height,
        // Преобразование применяется и к строкам, и к рану — инвариант
        // контракта сверяет их конкатенации между собой.
        text: applyTextTransform(raw, cs),
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
  scrollX: number,
  scrollY: number,
): ReadTextResult => {
  const own = ownText(el)
  if (own.trim() === '') return { kind: 'none' }

  const fontSize = parsePx(cs.fontSize)
  const stack = parseFontStack(cs.fontFamily)
  const color = parseColor(cs.color)

  const run: TextRun = {
    text: applyTextTransform(own, cs),
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

  const lines = readLines(el, cs, scrollX, scrollY)
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
