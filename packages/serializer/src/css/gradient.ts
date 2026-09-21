import type { GradientStop, LinearGradient, RadialGradient } from '@w2f/ir'
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
): LinearGradient | null => {
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


/** РАЗБОР `radial-gradient`.
 *
 *  Вычисленный стиль нормализует запись умеренно, и это измерено, а не
 *  предположено: `ellipse` и `farthest-corner` опускаются как значения
 *  по умолчанию, ключевые слова позиции превращаются в проценты
 *  (`at top left` → `at 0% 0%`), `circle 60px` сводится к `60px`, а
 *  порядок слов приводится к `circle farthest-side`. Поэтому разбирать
 *  приходится не одну форму, а несколько — но конечное их число.
 *
 *  Форма по умолчанию — ЭЛЛИПС, и это главное, что нельзя упростить:
 *  `radial-gradient(...)` без слова `circle` растягивается по сторонам
 *  бокса. Свести его к кругу значило бы испортить самый частый случай
 *  ради простоты кода. */

type RadialSpec = {
  shape: 'circle' | 'ellipse'
  /** Ключевое слово размера либо явные радиусы в пикселях. */
  size:
    | { kind: 'keyword'; value: 'closest-side' | 'farthest-side'
        | 'closest-corner' | 'farthest-corner' }
    | { kind: 'explicit'; rx: number; ry: number }
  center: { x: number; y: number }
}

const SIZE_KEYWORDS = new Set([
  'closest-side', 'farthest-side', 'closest-corner', 'farthest-corner',
])

const POSITION_KEYWORDS: Record<string, number> = {
  left: 0, top: 0, center: 0.5, right: 1, bottom: 1,
}

/** Одна координата позиции: процент, пиксели или ключевое слово. */
const positionPart = (raw: string, basis: number): number | null => {
  const text = raw.trim().toLowerCase()
  const keyword = POSITION_KEYWORDS[text]
  if (keyword !== undefined) return keyword
  const pct = /^(-?[\d.]+)%$/.exec(text)
  if (pct?.[1] !== undefined) return Number.parseFloat(pct[1]) / 100
  const px = /^(-?[\d.]+)px$/.exec(text)
  if (px?.[1] !== undefined) return Number.parseFloat(px[1]) / basis
  return null
}

/** Разбирает первый аргумент как описание формы и положения.
 *
 *  `null` означает «это не описание, а первая остановка цвета»: в
 *  `radial-gradient(red, blue)` первый аргумент — именно цвет.
 *  Различать их по содержимому, а не по позиции, обязательно — иначе
 *  самая короткая и самая частая запись разбиралась бы неверно. */
const parseRadialSpec = (raw: string, box: BoxSize): RadialSpec | null => {
  const text = raw.trim().toLowerCase()
  if (text === '') return null

  const [before, after] = text.split(/\s+at\s+/)
  if (before === undefined) return null

  let center = { x: 0.5, y: 0.5 }
  if (after !== undefined) {
    const parts = after.trim().split(/\s+/)
    const first = parts[0]
    if (first === undefined) return null
    const x = positionPart(first, box.w)
    /** Одна координата означает «по горизонтали, по центру
     *  вертикально» — правило спецификации, а не догадка. */
    const y = parts[1] === undefined ? 0.5 : positionPart(parts[1], box.h)
    if (x === null || y === null) return null
    center = { x, y }
  }

  const words = before.trim() === '' ? [] : before.trim().split(/\s+/)
  let shape: 'circle' | 'ellipse' = 'ellipse'
  const lengths: number[] = []
  let keyword: RadialSpec['size'] | null = null

  for (const word of words) {
    if (word === 'circle') { shape = 'circle'; continue }
    if (word === 'ellipse') { shape = 'ellipse'; continue }
    if (SIZE_KEYWORDS.has(word)) {
      keyword = { kind: 'keyword', value: word as 'closest-side' }
      continue
    }
    const px = /^(-?[\d.]+)px$/.exec(word)
    if (px?.[1] !== undefined) { lengths.push(Number.parseFloat(px[1])); continue }
    const pct = /^(-?[\d.]+)%$/.exec(word)
    if (pct?.[1] !== undefined) {
      /** Процентный радиус считается от соответствующей стороны:
       *  первый от ширины, второй от высоты. */
      const basis = lengths.length === 0 ? box.w : box.h
      lengths.push((Number.parseFloat(pct[1]) / 100) * basis)
      continue
    }
    /** Неизвестное слово: это не описание формы, а цвет. */
    if (after === undefined) return null
    return null
  }

  /** Ни формы, ни размера, ни позиции — описывать нечего. */
  if (words.length === 0 && after === undefined) return null

  if (lengths.length > 0) {
    const rx = lengths[0]
    if (rx === undefined) return null
    /** Один размер означает круг — так его и нормализует браузер,
     *  выбрасывая слово `circle`. */
    const ry = lengths[1] ?? rx
    return { shape, size: { kind: 'explicit', rx, ry }, center }
  }

  return {
    shape,
    size: keyword ?? { kind: 'keyword', value: 'farthest-corner' },
    center,
  }
}

/** Радиусы в пикселях по ключевому слову размера.
 *
 *  Угловые варианты выражены через сторонние намеренно: по
 *  спецификации эллипс `farthest-corner` имеет ТО ЖЕ отношение сторон,
 *  что `farthest-side`, и проходит через дальний угол. Отсюда
 *  масштабирование сторонних радиусов на множитель, приводящий эллипс
 *  к углу, — а не независимый расчёт по каждой оси, который дал бы
 *  другую фигуру. */
const radiiFor = (spec: RadialSpec, box: BoxSize): { rx: number; ry: number } => {
  if (spec.size.kind === 'explicit') {
    return { rx: spec.size.rx, ry: spec.size.ry }
  }
  const cx = spec.center.x * box.w
  const cy = spec.center.y * box.h
  const left = Math.abs(cx)
  const right = Math.abs(box.w - cx)
  const top = Math.abs(cy)
  const bottom = Math.abs(box.h - cy)

  const closestSide = spec.shape === 'circle'
    ? { rx: Math.min(left, right, top, bottom), ry: Math.min(left, right, top, bottom) }
    : { rx: Math.min(left, right), ry: Math.min(top, bottom) }
  const farthestSide = spec.shape === 'circle'
    ? { rx: Math.max(left, right, top, bottom), ry: Math.max(left, right, top, bottom) }
    : { rx: Math.max(left, right), ry: Math.max(top, bottom) }

  if (spec.size.value === 'closest-side') return closestSide
  if (spec.size.value === 'farthest-side') return farthestSide

  const corner = spec.size.value === 'closest-corner'
    ? { dx: Math.min(left, right), dy: Math.min(top, bottom) }
    : { dx: Math.max(left, right), dy: Math.max(top, bottom) }

  if (spec.shape === 'circle') {
    const r = Math.hypot(corner.dx, corner.dy)
    return { rx: r, ry: r }
  }

  const base = spec.size.value === 'closest-corner' ? closestSide : farthestSide
  if (base.rx === 0 || base.ry === 0) return base
  const scale = Math.hypot(corner.dx / base.rx, corner.dy / base.ry)
  return { rx: base.rx * scale, ry: base.ry * scale }
}

export const parseRadialGradient = (
  value: string,
  box: BoxSize,
): RadialGradient | null => {
  const text = value.trim()
  if (!/^radial-gradient\(/i.test(text)) return null
  if (box.w <= 0 || box.h <= 0) return null

  const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
  const args = splitTopLevel(inner)
  if (args.length === 0) return null

  const firstArg = args[0]
  if (firstArg === undefined) return null

  const spec = parseRadialSpec(firstArg, box)
    ?? { shape: 'ellipse' as const,
         size: { kind: 'keyword' as const, value: 'farthest-corner' as const },
         center: { x: 0.5, y: 0.5 } }
  const stopArgs = parseRadialSpec(firstArg, box) === null ? args : args.slice(1)
  if (stopArgs.length < 2) return null

  const { rx, ry } = radiiFor(spec, box)
  /** Вырожденный радиус рисует не градиент, а сплошную заливку
   *  последним цветом. Выразить это градиентом нельзя — схема требует
   *  положительных радиусов, — и притворяться, что перенос удался,
   *  тоже: отказ станет диагностикой у вызывающего. */
  if (rx <= 0 || ry <= 0) return null

  /** Положения остановок отсчитываются вдоль ГОРИЗОНТАЛЬНОГО радиуса:
   *  именно он служит единицей длины градиентного луча, а
   *  вертикальный получается сжатием. */
  const raws: RawStop[] = []
  for (const arg of stopArgs) {
    const { color: colorText, position } = splitStop(arg)
    const color = parseColor(colorText)
    if (color === null) return null
    raws.push({ color, offset: parsePosition(position, rx) })
  }

  return {
    kind: 'radial',
    center: spec.center,
    radius: { x: rx / box.w, y: ry / box.h },
    stops: resolveOffsets(raws),
  }
}
