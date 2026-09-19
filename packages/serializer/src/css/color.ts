import type { Rgba8 } from '@h2d/ir'

export const TRANSPARENT: Rgba8 = { r: 0, g: 0, b: 0, a: 0 }

const RGB_FUNCTIONAL =
  /^rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i

const parseAlpha = (raw: string | undefined): number => {
  if (raw === undefined) return 1
  if (raw.endsWith('%')) return Number.parseFloat(raw) / 100
  return Number.parseFloat(raw)
}

/** Резолв через растеризацию браузером: единственный способ уверенно
 *  разобрать oklch(), color-mix(), lab() и всё, что Chrome добавит позже. */
const resolveViaCanvas = (value: string): Rgba8 | null => {
  if (typeof OffscreenCanvas === 'undefined') return null
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null

    // Валидность проверяется двумя разными сентинелами: невалидное значение
    // Canvas молча игнорирует, и fillStyle сохраняет каждый сентинел, поэтому
    // результаты расходятся. Валидное значение даёт одинаковый резолв в обоих
    // случаях. Проверка «стало ли чёрным» была бы неверна: цвет может
    // законно резолвиться в чёрный.
    const probe = (sentinel: string): string => {
      ctx.fillStyle = sentinel
      ctx.fillStyle = value
      return String(ctx.fillStyle)
    }
    if (probe('#ff00ff') !== probe('#00ff00')) return null

    ctx.fillStyle = value
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    const r = data[0]
    const g = data[1]
    const b = data[2]
    const a = data[3]
    if (r === undefined || g === undefined || b === undefined || a === undefined) {
      return null
    }
    return { r, g, b, a: Math.round((a / 255) * 1000) / 1000 }
  } catch {
    return null
  }
}

/** Возвращает null, если цвет разобрать не удалось. Вызывающий обязан
 *  породить Diagnostic — молчаливая подстановка чёрного запрещена. */
export const parseColor = (value: string): Rgba8 | null => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return null
  if (trimmed === 'transparent') return TRANSPARENT

  const m = RGB_FUNCTIONAL.exec(trimmed)
  if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
    return {
      r: Number.parseFloat(m[1]),
      g: Number.parseFloat(m[2]),
      b: Number.parseFloat(m[3]),
      a: parseAlpha(m[4]),
    }
  }

  return resolveViaCanvas(trimmed)
}

export const isInvisible = (color: Rgba8): boolean => color.a === 0
