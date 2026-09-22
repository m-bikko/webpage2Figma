import type { Rgba8 } from '@w2f/ir'
import { isInvisible, parseColor } from './css/color.js'

/** Цвет холста и откуда он взят.
 *
 *  `html` и `body` — фон объявлен и по CSS распространён на холст;
 *  `default` — не объявлен нигде, и холст красит сам браузер. */
export type CanvasColor = {
  color: Rgba8
  source: 'html' | 'body' | 'default'
  /** Значение `color-scheme` корня — ради отчёта: по нему человек
   *  видит, почему холст оказался тёмным или светлым. */
  scheme: string
}

/** Холст без объявленного фона.
 *
 *  Цвета ИЗМЕРЕНЫ в Chromium, а не взяты из памяти: без `color-scheme`
 *  холст белый при любой теме системы; с `color-scheme: dark` —
 *  rgb(18,18,18); `color-scheme: light dark` следует за системой.
 *  Никакой API самого цвета не отдаёт, поэтому правило выведено из
 *  этих трёх измерений и системной темы через `matchMedia`. Другие
 *  движки могут красить иначе — но захват идёт из Chromium, и
 *  скриншот, с которым сверяется pixel-diff, тоже его. */
const DARK_CANVAS: Rgba8 = { r: 18, g: 18, b: 18, a: 1 }
const LIGHT_CANVAS: Rgba8 = { r: 255, g: 255, b: 255, a: 1 }

const defaultCanvas = (scheme: string): Rgba8 => {
  const allowsDark = scheme.includes('dark')
  const allowsLight = scheme.includes('light')
  const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return allowsDark && (!allowsLight || osDark) ? DARK_CANVAS : LIGHT_CANVAS
}

/** Цвет холста по правилу распространения фона (CSS Backgrounds,
 *  «The Canvas Background and the Root Element»): фон корневого
 *  элемента красит весь холст; если корень фона не задаёт — на холст
 *  уходит фон `body`, и им красится весь вьюпорт, а не бокс `body`.
 *
 *  Переносится только ЦВЕТ. Фоновое изображение `body` тоже
 *  распространяется на холст, но у нас оно остаётся заливкой узла
 *  `body` — на части холста ниже `body` его не будет. Известная
 *  граница, записана в [[support-boundaries]]. */
export const readCanvas = (): CanvasColor => {
  const htmlStyle = window.getComputedStyle(document.documentElement)
  const scheme = htmlStyle.colorScheme
  const html = parseColor(htmlStyle.backgroundColor)
  if (html !== null && !isInvisible(html)) return { color: html, source: 'html', scheme }
  const body = parseColor(window.getComputedStyle(document.body).backgroundColor)
  if (body !== null && !isInvisible(body)) return { color: body, source: 'body', scheme }
  return { color: defaultCanvas(scheme), source: 'default', scheme }
}
