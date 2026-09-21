import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import type { Asset, Diagnostic } from '@w2f/ir'
import type { AssetRequest } from './assets.js'

/** Предел `figma.createImage`: изображение с большей стороной не
 *  примется вовсе. Ужатие поэтому обязательно — но оно необратимо, и
 *  факт обязан попасть в отчёт. */
const MAX_SIDE = 4096

/** Форматы, которые Figma принимает как есть. Всё остальное (WebP,
 *  AVIF) переупаковывается в PNG через канву. */
const NATIVE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])

/** Байты переезжают границу страницы как base64.
 *
 *  Не из любви к строкам: `Uint8Array` не переживает ни
 *  `page.evaluate`, ни `chrome.scripting.executeScript` — обе границы
 *  сериализуют значение как JSON, и типизированный массив приехал бы
 *  объектом с числовыми ключами либо пустым. Молча. */
export type ResolvedAssets = {
  assets: Asset[]
  base64: Record<string, string>
  report: Diagnostic[]
}

const toBase64 = (bytes: Uint8Array): string => {
  /** Кусками: `String.fromCharCode(...bytes)` на мегабайтном массиве
   *  переполняет стек аргументов. */
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const extensionFor = (mimeType: string): string =>
  mimeType === 'image/jpeg' ? 'jpg'
  : mimeType === 'image/gif' ? 'gif'
  : 'png'

/** Забирает байты по заявкам. Отдельная АСИНХРОННАЯ фаза: обход DOM
 *  обязан оставаться синхронным, иначе раскладка успевает измениться
 *  на полпути и IR описывает два разных состояния страницы как одно.
 *
 *  Основной путь — `fetch`, а не канва. Измерено: `fetch` отдаёт
 *  исходные 241 байт, канва — переупакованные 449. Канва нужна только
 *  для нормализации формата и размера, и переупаковывать по умолчанию
 *  значило бы раздувать бандл и терять качество без причины. */
export const resolveAssets = async (
  requests: AssetRequest[],
): Promise<ResolvedAssets> => {
  const assets: Asset[] = []
  const base64: Record<string, string> = {}
  const report: Diagnostic[] = []

  const complain = (
    request: AssetRequest,
    code: Diagnostic['code'],
    message: string,
    level: Diagnostic['level'],
    needsPlaceholder: boolean,
  ): void => {
    report.push({
      level, code, message,
      nodeId: request.nodeId, screenId: request.screenId, needsPlaceholder,
    })
  }

  for (const request of requests) {
    let blob: Blob
    try {
      const response = await fetch(request.url)
      if (!response.ok) {
        complain(request, DIAGNOSTIC_CODES.imageUnreadable,
          `Источник ответил ${response.status}: ${request.url}`, 'warning', true)
        continue
      }
      blob = await response.blob()
    } catch (error) {
      /** Сюда попадают CORS и сетевые отказы. Ассет НЕ добавляется, и
       *  это намеренно: узел, ссылающийся на отсутствующий ассет,
       *  отвергнет инвариант `asset.dangling` — ровно то поведение,
       *  которое нужно, потому что молча он дал бы пустой
       *  прямоугольник в Figma без всяких объяснений. */
      complain(request, DIAGNOSTIC_CODES.imageUnreadable,
        `Байты недоступны (${String(error)}): ${request.url}`, 'warning', true)
      continue
    }

    const mimeType = blob.type.split(';')[0]?.trim() ?? ''
    if (mimeType === 'image/svg+xml') {
      /** Расширение обмануло: путь не оканчивался на `.svg`, а пришёл
       *  вектор. Синхронный обход этого знать не мог — тип известен
       *  только после загрузки. Вторая проверка именно для этого. */
      complain(request, DIAGNOSTIC_CODES.deferredVector,
        `Источник отдал SVG, вектор не переносится растром: ${request.url}`,
        'info', true)
      continue
    }

    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(blob)
    } catch (error) {
      complain(request, DIAGNOSTIC_CODES.imageUnreadable,
        `Изображение не декодируется (${String(error)}): ${request.url}`,
        'warning', true)
      continue
    }

    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1
    const needsRecode = !NATIVE_TYPES.has(mimeType)
    const needsRescale = scale < 1

    let bytes: Uint8Array
    let width = bitmap.width
    let height = bitmap.height
    let outType = mimeType

    if (needsRecode || needsRescale) {
      width = Math.max(1, Math.round(bitmap.width * scale))
      height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (context === null) {
        complain(request, DIAGNOSTIC_CODES.imageUnreadable,
          `Канва недоступна, нормализация невозможна: ${request.url}`,
          'warning', true)
        bitmap.close()
        continue
      }
      context.drawImage(bitmap, 0, 0, width, height)
      const recoded = await canvas.convertToBlob({ type: 'image/png' })
      bytes = new Uint8Array(await recoded.arrayBuffer())
      outType = 'image/png'

      if (needsRescale) {
        complain(request, DIAGNOSTIC_CODES.imageRescaled,
          `Ужато с ${bitmap.width}×${bitmap.height} до ${width}×${height}: ` +
          `Figma не принимает сторону больше ${MAX_SIDE}px.`, 'info', false)
      }
      if (needsRecode) {
        complain(request, DIAGNOSTIC_CODES.imageRecoded,
          `Формат ${mimeType} переупакован в PNG: Figma принимает только ` +
          `PNG, JPEG и GIF.`, 'info', false)
      }
    } else {
      /** ИСХОДНЫЕ байты, без переупаковки. */
      bytes = new Uint8Array(await blob.arrayBuffer())
    }
    bitmap.close()

    assets.push({
      id: request.id,
      mimeType: outType,
      width, height,
      path: `assets/${request.id}.${extensionFor(outType)}`,
    })
    base64[request.id] = toBase64(bytes)
  }

  return { assets, base64, report }
}
