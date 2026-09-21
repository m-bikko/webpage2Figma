/** ВЫЧИСЛЕНИЕ CSS-СЧЁТЧИКОВ.
 *
 *  Значение счётчика не отдаёт ни один браузерный API: вычисленный
 *  стиль возвращает `content` как записано — строкой `counter(line)`, —
 *  и узнать, какое число браузер нарисовал, неоткуда. Поэтому счётчики
 *  считаются здесь заново, по правилам CSS Lists.
 *
 *  Зачем это вообще нужно. На живой странице документации все 87
 *  непереносимых псевдоэлементов оказались одной и той же
 *  конструкцией — `counter(line)`, номера строк в примерах кода.
 *  Геометрия у них есть, содержащий блок найден; не хватало ровно
 *  значения.
 *
 *  Область видимости — то, что делает задачу нетривиальной. Счётчик,
 *  созданный на элементе, виден ему, его потомкам И ЕГО ПОСЛЕДУЮЩИМ
 *  БРАТЬЯМ. Поэтому созданное ребёнком снимается не при выходе из
 *  ребёнка, а при выходе из родителя: внутри цикла по детям оно
 *  обязано продолжать действовать. */

type CounterState = Map<string, number[]>

const parsePairs = (value: string, fallback: number): [string, number][] => {
  if (value === 'none' || value === '' || value === 'normal') return []
  const parts = value.trim().split(/\s+/)
  const out: [string, number][] = []
  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i]
    if (name === undefined) continue
    const next = parts[i + 1]
    const parsed = next === undefined ? Number.NaN : Number.parseInt(next, 10)
    if (Number.isFinite(parsed)) {
      out.push([name, parsed])
      i += 1
    } else {
      out.push([name, fallback])
    }
  }
  return out
}

const applyReset = (state: CounterState, value: string): void => {
  /** `counter-reset` СОЗДАЁТ новый экземпляр, а не присваивает
   *  существующему. Разница видна на вложенных списках: внутренний
   *  список начинает свою нумерацию, не трогая внешнюю. */
  for (const [name, start] of parsePairs(value, 0)) {
    const stack = state.get(name) ?? []
    stack.push(start)
    state.set(name, stack)
  }
}

const applyIncrement = (state: CounterState, value: string): void => {
  for (const [name, delta] of parsePairs(value, 1)) {
    const stack = state.get(name)
    if (stack === undefined || stack.length === 0) {
      /** Увеличение счётчика, который никто не создавал, создаёт его
       *  со значением 0 — так требует спецификация, и без этого
       *  правила самая частая запись (только `counter-increment`, без
       *  `counter-reset`) не работала бы вовсе. */
      state.set(name, [delta])
      continue
    }
    stack[stack.length - 1] = (stack[stack.length - 1] ?? 0) + delta
  }
}

const snapshot = (state: CounterState): Map<string, number> => {
  const out = new Map<string, number>()
  for (const [name, stack] of state) {
    const top = stack[stack.length - 1]
    if (top !== undefined) out.set(name, top)
  }
  return out
}

/** Все экземпляры счётчика, от внешнего к внутреннему: нужны для
 *  `counters(name, sep)`, который печатает вложенную нумерацию вида
 *  «2.3.1». */
const allOf = (state: CounterState): Map<string, number[]> => {
  const out = new Map<string, number[]>()
  for (const [name, stack] of state) out.set(name, [...stack])
  return out
}

export type CounterValues = {
  /** Верхний экземпляр каждого счётчика — то, что печатает `counter()`. */
  top: Map<string, number>
  /** Вся цепочка — то, что печатает `counters()`. */
  chain: Map<string, number[]>
}

export type CounterMap = WeakMap<Element, {
  before: CounterValues
  after: CounterValues
}>

/** Считает значения счётчиков для псевдоэлементов всего поддерева.
 *
 *  Один проход в порядке документа — тот же порядок, в котором их
 *  применяет браузер. Результат кладётся в `WeakMap`, чтобы обходчик
 *  мог спросить значения для любого элемента, не считая заново. */
export const computeCounters = (root: Element): CounterMap => {
  const map: CounterMap = new WeakMap()
  const state: CounterState = new Map()

  const visit = (el: Element): void => {
    const cs = window.getComputedStyle(el)
    applyReset(state, cs.counterReset)
    applyIncrement(state, cs.counterIncrement)

    /** `::before` применяет свои изменения ПЕРЕД содержимым элемента,
     *  `::after` — после. Порядок здесь тот же, что на экране. */
    const beforeCs = window.getComputedStyle(el, '::before')
    applyReset(state, beforeCs.counterReset)
    applyIncrement(state, beforeCs.counterIncrement)
    const before: CounterValues = { top: snapshot(state), chain: allOf(state) }

    /** Глубины запоминаются, чтобы снять созданное ДЕТЬМИ при выходе
     *  отсюда. Внутри цикла снимать нельзя: созданное одним ребёнком
     *  обязано действовать на следующих. */
    const depths = new Map<string, number>()
    for (const [name, stack] of state) depths.set(name, stack.length)

    for (const child of el.children) visit(child)

    for (const [name, stack] of state) {
      const depth = depths.get(name) ?? 0
      if (stack.length > depth) stack.length = depth
      if (stack.length === 0) state.delete(name)
    }

    const afterCs = window.getComputedStyle(el, '::after')
    applyReset(state, afterCs.counterReset)
    applyIncrement(state, afterCs.counterIncrement)
    const after: CounterValues = { top: snapshot(state), chain: allOf(state) }

    map.set(el, { before, after })
  }

  visit(root)
  return map
}

const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

const roman = (value: number): string => {
  if (value <= 0 || value > 3999) return String(value)
  let left = value
  let out = ''
  for (const [amount, letters] of ROMAN) {
    while (left >= amount) {
      out += letters
      left -= amount
    }
  }
  return out
}

const alpha = (value: number): string => {
  if (value <= 0) return String(value)
  let left = value
  let out = ''
  while (left > 0) {
    const rest = (left - 1) % 26
    out = String.fromCharCode(97 + rest) + out
    left = Math.floor((left - 1) / 26)
  }
  return out
}

/** Оформление числа по `list-style-type`.
 *
 *  Поддержаны те виды, что встречаются в счётчиках на практике.
 *  Неизвестный вид даёт десятичную запись — и это НЕ тихая замена:
 *  вызывающий сверяет результат с тем, что нарисовал браузер, и
 *  расхождение поймает пиксельный гейт. */
export const formatCounter = (value: number, style: string): string => {
  switch (style.trim()) {
    case 'decimal-leading-zero':
      return value < 10 && value >= 0 ? `0${value}` : String(value)
    case 'lower-alpha': case 'lower-latin': return alpha(value)
    case 'upper-alpha': case 'upper-latin': return alpha(value).toUpperCase()
    case 'lower-roman': return roman(value)
    case 'upper-roman': return roman(value).toUpperCase()
    default: return String(value)
  }
}
