import type { Gradient, GradientStop } from '@h2d/ir'
import { parseColor } from './color.js'

export type BoxSize = { w: number; h: number }

/** Разбивает список аргументов по запятым верхнего уровня.
 *  Наивный `split(',')` сломался бы на запятых внутри `rgba()`. */
const splitTopLevel = (value: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

const SIDE_ANGLES: Record<string, number> = {
  top: 0, right: 90, bottom: 180, left: 270,
}

/** Угол для угловых ключевых слов зависит от пропорций бокса.
 *
 *  По спецификации отрезок перпендикулярен диагонали между двумя соседними
 *  углами. Для `to top right` соседние — верхний левый и нижний правый,
 *  их диагональ направлена как `(w, h)`, перпендикуляр вверх-вправо как
 *  `(h, −w)`. Из `d = (sin θ, −cos θ) ∝ (h, −w)` следует `θ = atan2(h, w)`.
 *
 *  Именно здесь легко перепутать аргументы: на квадратном боксе `atan2(h,w)`
 *  и `atan2(w,h)` оба дают 45°, и ошибка невидима. На боксе 200×100
 *  правильный ответ 26.6°, перепутанный — 63.4°. */
const cornerAngle = (box: BoxSize): number =>
  (Math.atan2(box.h, box.w) * 180) / Math.PI

const directionAngle = (raw: string, box: BoxSize): number | null => {
  const text = raw.trim().toLowerCase()

  const deg = /^(-?[\d.]+)deg$/.exec(text)
  if (deg?.[1] !== undefined) return Number.parseFloat(deg[1])

  const turn = /^(-?[\d.]+)turn$/.exec(text)
  if (turn?.[1] !== undefined) return Number.parseFloat(turn[1]) * 360

  const rad = /^(-?[\d.]+)rad$/.exec(text)
  if (rad?.[1] !== undefined) return (Number.parseFloat(rad[1]) * 180) / Math.PI

  if (!text.startsWith('to ')) return null
  const sides = text.slice(3).trim().split(/\s+/).sort().join(' ')
  const corner = cornerAngle(box)
  switch (sides) {
    case 'top': return SIDE_ANGLES['top'] ?? 0
    case 'right': return SIDE_ANGLES['right'] ?? 90
    case 'bottom': return SIDE_ANGLES['bottom'] ?? 180
    case 'left': return SIDE_ANGLES['left'] ?? 270
    case 'right top': return corner
    case 'bottom right': return 180 - corner
    case 'bottom left': return 180 + corner
    case 'left top': return 360 - corner
    default: return null
  }
}

/** Концы отрезка градиента в НОРМАЛИЗОВАННЫХ координатах бокса.
 *
 *  Ось `y` растёт вниз, а угол CSS отсчитывается от «вверх» по часовой,
 *  поэтому направление `d = (sin θ, −cos θ)`. Длина отрезка по
 *  спецификации `L = |w·sin θ| + |h·cos θ|`, и он проходит через центр. */
const endpoints = (
  angleDeg: number,
  box: BoxSize,
): { from: { x: number; y: number }; to: { x: number; y: number }; length: number } => {
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const length = Math.abs(box.w * dx) + Math.abs(box.h * dy)

  const cx = box.w / 2
  const cy = box.h / 2
  const half = length / 2

  /** Округление до шести знаков и складывание отрицательного нуля.
   *
   *  Это не косметика. `Math.sin(Math.PI)` равен 1.22e-16, а не нулю,
   *  поэтому при θ=180° длина отрезка выходит 100.00000000000001, а
   *  `from.x` уезжает на один ulp ниже 0.5. При θ=135° появляется `-0`,
   *  который `Object.is` отличает от `+0`.
   *
   *  Главный довод не в тестах: IR едет как JSON, а `JSON.stringify(-0)`
   *  даёт `"0"`. Значит отрицательный ноль в транспорте не представим, и
   *  его наличие в памяти создаёт расхождение между значением до и после
   *  round-trip. Шесть знаков при ширине 1920 это 0.002 пикселя — ниже
   *  всякой различимости, зато значения становятся сравнимыми. */
  const norm = (value: number): number => Math.round(value * 1e6) / 1e6 + 0

  return {
    from: { x: norm((cx - dx * half) / box.w), y: norm((cy - dy * half) / box.h) },
    to: { x: norm((cx + dx * half) / box.w), y: norm((cy + dy * half) / box.h) },
    length,
  }
}

type RawStop = { color: GradientStop['color']; offset: number | null }

/** Вырезает цветовую функцию или ключевое слово из начала описания
 *  остановки, возвращая остаток — положение, если оно задано. */
const splitStop = (raw: string): { color: string; position: string } => {
  const text = raw.trim()
  const functional = /^(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^)]*\)/i
  const fn = functional.exec(text)
  if (fn !== null) {
    return { color: fn[0], position: text.slice(fn[0].length).trim() }
  }
  const space = text.indexOf(' ')
  if (space === -1) return { color: text, position: '' }
  return { color: text.slice(0, space), position: text.slice(space + 1).trim() }
}

const parsePosition = (text: string, length: number): number | null => {
  if (text === '') return null
  const pct = /^(-?[\d.]+)%$/.exec(text)
  if (pct?.[1] !== undefined) return Number.parseFloat(pct[1]) / 100
  const px = /^(-?[\d.]+)px$/.exec(text)
  if (px?.[1] !== undefined) return Number.parseFloat(px[1]) / length
  return null
}

/** Восстанавливает неявные положения по правилам спецификации:
 *  первая остановка без положения — 0, последняя — 1, промежуточные
 *  распределяются равномерно между ближайшими заданными, и положения
 *  принудительно не убывают. */
const resolveOffsets = (raws: RawStop[]): GradientStop[] => {
  const offsets: (number | null)[] = raws.map((stop) => stop.offset)
  if (offsets[0] === null) offsets[0] = 0
  const last = offsets.length - 1
  if (offsets[last] === null) offsets[last] = 1

  let index = 0
  while (index < offsets.length) {
    if (offsets[index] !== null) {
      index += 1
      continue
    }
    let end = index
    while (end < offsets.length && offsets[end] === null) end += 1
    const before = offsets[index - 1] ?? 0
    const after = offsets[end] ?? 1
    const gapCount = end - index + 1
    for (let step = 0; step < end - index; step += 1) {
      offsets[index + step] = before + ((after - before) * (step + 1)) / gapCount
    }
    index = end
  }

  const result: GradientStop[] = []
  let previous = 0
  for (let i = 0; i < raws.length; i += 1) {
    const stop = raws[i]
    const offset = offsets[i]
    if (stop === undefined || offset === null || offset === undefined) continue
    const clamped = Math.min(1, Math.max(previous, Math.max(0, offset)))
    previous = clamped
    result.push({ offset: Math.round(clamped * 10000) / 10000, color: stop.color })
  }
  return result
}

/** Разбирает `linear-gradient(...)` из computed style.
 *
 *  Возвращает `null` на всём, что не линейный градиент — включая
 *  `radial-`, `conic-` и `repeating-`. Вызывающий обязан породить
 *  `Diagnostic`: подстановка чего-либо вместо неразобранного градиента
 *  была бы молчаливой потерей. */
export const parseLinearGradient = (
  value: string,
  box: BoxSize,
): Gradient | null => {
  const text = value.trim()
  if (!/^linear-gradient\(/i.test(text)) return null
  if (box.w <= 0 || box.h <= 0) return null

  const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
  const args = splitTopLevel(inner)
  if (args.length === 0) return null

  const firstArg = args[0]
  if (firstArg === undefined) return null

  let angle = 180
  let stopArgs = args
  const asDirection = directionAngle(firstArg, box)
  if (asDirection !== null) {
    angle = asDirection
    stopArgs = args.slice(1)
  }
  if (stopArgs.length < 2) return null

  const geometry = endpoints(angle, box)
  if (geometry.length <= 0) return null

  const raws: RawStop[] = []
  for (const arg of stopArgs) {
    const { color: colorText, position } = splitStop(arg)
    const color = parseColor(colorText)
    if (color === null) return null
    raws.push({ color, offset: parsePosition(position, geometry.length) })
  }

  return {
    kind: 'linear',
    from: geometry.from,
    to: geometry.to,
    stops: resolveOffsets(raws),
  }
}
