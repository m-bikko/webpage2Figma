import type { Corner } from '@w2f/ir'
import { parsePx } from './length.js'

/** Радиус угла — ДВА значения: горизонтальный и вертикальный.
 *
 *  Figma держит один радиус на угол, то есть только круглые скругления.
 *  Когда значения расходятся, берётся горизонтальный, а расхождение
 *  объясняет вызывающий — `isEllipticalCorner`.
 *
 *  Проценты разрешаются здесь, и это не мелочь. Computed style отдаёт
 *  `border-radius: 50%` как есть, строкой «50%», и прежний разборщик,
 *  умевший только `px`, возвращал для неё НОЛЬ. Каждый круг, сделанный
 *  самым обычным способом — аватарка, кнопка-иконка, точка-маркер, —
 *  приезжал квадратом, молча: диагностики не было, потому что
 *  эллиптическим такой угол не считался (значение-то одно).
 *
 *  По CSS горизонтальный радиус считается от ШИРИНЫ бокса,
 *  вертикальный — от ВЫСОТЫ. Поэтому `50%` на неквадратном боксе даёт
 *  настоящий эллипс, и его Figma уже не выразит — но это честное
 *  приближение с записью в отчёте, а не тихий ноль. */
const parsePercent = (value: string): number | null => {
  const match = /^(-?\d*\.?\d+)%$/.exec(value.trim())
  return match?.[1] === undefined ? null : Number.parseFloat(match[1]) / 100
}

/** Пара радиусов угла в пикселях: горизонтальный и вертикальный. */
const radiiOf = (
  value: string,
  box: { w: number; h: number },
): { x: number; y: number } => {
  const parts = value.trim().split(/\s+/)
  const first = parts[0] ?? '0px'
  /** Вертикальный радиус опущен — значит он равен горизонтальному,
   *  но ПРОЦЕНТ при этом считается от другой стороны. */
  const second = parts[1] ?? first

  const resolve = (raw: string, basis: number): number => {
    const percent = parsePercent(raw)
    return percent === null ? parsePx(raw) : percent * basis
  }
  return { x: resolve(first, box.w), y: resolve(second, box.h) }
}

export const readCorner = (
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
): Corner => ({
  tl: radiiOf(cs.borderTopLeftRadius, box).x,
  tr: radiiOf(cs.borderTopRightRadius, box).x,
  br: radiiOf(cs.borderBottomRightRadius, box).x,
  bl: radiiOf(cs.borderBottomLeftRadius, box).x,
})

/** Угол эллиптический, если горизонтальный и вертикальный радиусы
 *  разошлись ПОСЛЕ разрешения процентов.
 *
 *  Сравнение по разобранным значениям, а не по числу слов в строке:
 *  `50%` записано одним словом, но на боксе 200×40 означает радиусы
 *  100 и 20 — эллипс, о котором прежняя проверка молчала. И наоборот,
 *  `10px 10px` — два слова и никакого эллипса. */
export const isEllipticalCorner = (
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
): boolean =>
  [
    cs.borderTopLeftRadius, cs.borderTopRightRadius,
    cs.borderBottomRightRadius, cs.borderBottomLeftRadius,
  ].some((value) => {
    const { x, y } = radiiOf(value, box)
    return Math.abs(x - y) > 0.5
  })
