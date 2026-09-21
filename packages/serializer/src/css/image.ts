import { DIAGNOSTIC_CODES, type DiagnosticCode } from '@h2d/ir/codes'

export type BackgroundImageVerdict =
  | { kind: 'none' }
  | { kind: 'raster'; url: string }
  | { kind: 'gradient' }
  | { kind: 'vector'; code: DiagnosticCode }
  | { kind: 'multi-layer'; code: DiagnosticCode }
  | { kind: 'unknown'; raw: string }

/** Верхнеуровневые запятые — границы слоёв фона. Наивный `split(',')`
 *  здесь не годится: запятые есть внутри `rgb(...)` и внутри самих
 *  градиентов, то есть он разрезал бы один слой на несколько и объявил
 *  многослойным обычный `linear-gradient(red, blue)`. */
const splitLayers = (value: string): string[] => {
  const layers: string[] = []
  let depth = 0
  let start = 0
  let quote: string | null = null
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      layers.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  layers.push(value.slice(start).trim())
  return layers.filter((layer) => layer.length > 0)
}

const URL_PATTERN = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)$/

export const parseUrlToken = (layer: string): string | null => {
  const match = URL_PATTERN.exec(layer)
  if (match === null) return null
  const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
  return raw.length > 0 ? raw : null
}

/** SVG распознаётся по расширению пути, а не по типу содержимого: тип
 *  известен только после загрузки, а решение нужно на СИНХРОННОМ обходе.
 *  Ошибка возможна в обе стороны (`.svg`, отдающий PNG; путь без
 *  расширения, отдающий SVG), поэтому вторая проверка — по настоящему
 *  MIME — живёт в фазе разрешения ассетов, где содержимое уже в руках. */
const looksLikeSvg = (url: string): boolean => {
  const path = url.split('?')[0]?.split('#')[0] ?? ''
  return path.toLowerCase().endsWith('.svg')
}

export const classifyBackgroundImage = (value: string): BackgroundImageVerdict => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return { kind: 'none' }

  const layers = splitLayers(trimmed)
  if (layers.length > 1) {
    return {
      kind: 'multi-layer',
      code: DIAGNOSTIC_CODES.deferredMultiLayerBackground,
    }
  }

  const layer = layers[0] ?? ''
  const url = parseUrlToken(layer)
  if (url !== null) {
    return looksLikeSvg(url)
      ? { kind: 'vector', code: DIAGNOSTIC_CODES.deferredVector }
      : { kind: 'raster', url }
  }
  if (layer.includes('gradient(')) return { kind: 'gradient' }
  return { kind: 'unknown', raw: layer }
}
