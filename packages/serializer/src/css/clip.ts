/** `clip-path` как ПРИЁМ СКРЫТИЯ.
 *
 *  Обычная ошибка переноса — потеря: элемент есть на странице, а в
 *  макете его нет. Здесь ошибка обратная и потому незаметнее. Идиома
 *  `clip-path: inset(50%)` вместе с боксом 1×1 — стандартный способ
 *  оставить текст скринридерам, убрав его с экрана. Кто не понимает
 *  `clip-path`, тот видит обычный элемент с текстом и переносит его:
 *  в макете появляется подпись, которой на странице НЕТ, и ложится
 *  поверх соседей.
 *
 *  Измерено на восьми живых страницах: из 54 записей про `clip-path`
 *  27 — ровно эта идиома. То есть половина всех случаев — не то, о чём
 *  диагностика сообщала.
 *
 *  Здесь распознаётся только `inset()`, и только полное схлопывание.
 *  `circle()`, `polygon()`, `url(#…)` остаются неподдержанными и
 *  диагностируются как прежде: частичная обрезка — это приближение,
 *  а не скрытие, и выкидывать элемент из-за неё было бы той самой
 *  потерей, от которой всё и затевалось. */

const parseSide = (raw: string, basis: number): number | null => {
  const value = raw.trim()
  const percent = /^(-?\d*\.?\d+)%$/.exec(value)
  if (percent?.[1] !== undefined) {
    return (Number.parseFloat(percent[1]) / 100) * basis
  }
  const px = /^(-?\d*\.?\d+)px$/.exec(value)
  if (px?.[1] !== undefined) return Number.parseFloat(px[1])
  /** Ключевые слова и вычисления (`calc`, `auto`) не разбираются:
   *  неизвестное значение обязано означать «не знаю», а не «ноль». */
  return null
}

/** Вырезает ли `clip-path` элемент целиком.
 *
 *  `false` при любом сомнении: невидимым объявляется только то, что
 *  доказано невидимо. Ошибиться в эту сторону — потерять содержимое,
 *  и молча. */
export const clipsAwayEverything = (
  clipPath: string,
  box: { w: number; h: number },
): boolean => {
  const match = /^inset\(([^)]*)\)$/.exec(clipPath.trim())
  if (match?.[1] === undefined) return false

  /** Часть после `round` описывает скругление углов выреза, а не его
   *  размеры, и к схлопыванию отношения не имеет. */
  const sides = match[1].split(/\s+round\s+/)[0]?.trim().split(/\s+/) ?? []
  if (sides.length === 0 || sides.length > 4) return false

  /** Сокращение как у `margin`: одно значение на все стороны, два —
   *  вертикаль и горизонталь, три — верх, горизонталь, низ. */
  const [a, b, c, d] = sides
  const top = a
  const right = sides.length === 1 ? a : b
  const bottom = sides.length <= 2 ? a : c
  const left = sides.length === 1 ? a : sides.length === 4 ? d : b
  if (top === undefined || right === undefined
      || bottom === undefined || left === undefined) return false

  const t = parseSide(top, box.h)
  const r = parseSide(right, box.w)
  const bo = parseSide(bottom, box.h)
  const l = parseSide(left, box.w)
  if (t === null || r === null || bo === null || l === null) return false

  /** Остаток по каждой оси. Ноль или меньше — видно нечего.
   *  Сравнение с запасом в четверть пикселя: дробные размеры дают
   *  остаток вроде 0.0000001, который экран всё равно не покажет. */
  return (box.w - l - r) <= 0.25 || (box.h - t - bo) <= 0.25
}
