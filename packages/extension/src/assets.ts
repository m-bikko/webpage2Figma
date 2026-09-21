import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import type { Asset, Diagnostic } from '@w2f/ir'

/** Заявка на байты, поданная страницей. Повтор формы из сериализатора,
 *  а не импорт: воркер не импортирует сериализатор — тот доставляется
 *  в страницу как текст файла. */
export type AssetRequest = {
  id: string
  url: string
  naturalWidth: number
  naturalHeight: number
  nodeId: string
  screenId: string
}

export type ResolvedAssets = {
  assets: Asset[]
  bytes: Record<string, Uint8Array>
  report: Diagnostic[]
}

/** Предел `figma.createImage`. */
const MAX_SIDE = 4096
const NATIVE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])

const extensionFor = (mimeType: string): string =>
  mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/gif' ? 'gif' : 'png'

/** Забирает байты ИЗ ВОРКЕРА, а не из страницы.
 *
 *  Это и есть главная выгода расширения. Страница ограничена CORS:
 *  кросс-доменная картинка отрисовывается, но её байты `fetch` не
 *  отдаёт — а это доминирующий случай в жизни, любая картинка с чужого
 *  CDN. Воркер с `host_permissions` их получает. Измерено до написания
 *  плана: со страницы `TypeError: Failed to fetch`, из воркера —
 *  исходные 195 байт.
 *
 *  Нормализация формата и размера делается через `OffscreenCanvas`,
 *  который в service worker ЕСТЬ — проверено замером, а не принято на
 *  веру. Если его не окажется, честнее отдать исходные байты и
 *  сообщить, чем молча отдать неподдерживаемый формат. */
export const resolveAssets = async (
  requests: readonly AssetRequest[],
): Promise<ResolvedAssets> => {
  const assets: Asset[] = []
  const bytes: Record<string, Uint8Array> = {}
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
      complain(request, DIAGNOSTIC_CODES.imageUnreadable,
        `Байты недоступны (${String(error)}): ${request.url}`, 'warning', true)
      continue
    }

    const mimeType = blob.type.split(';')[0]?.trim() ?? ''
    if (mimeType === 'image/svg+xml') {
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

    let width = bitmap.width
    let height = bitmap.height
    let outType = mimeType
    let raw: Uint8Array

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
      raw = new Uint8Array(await recoded.arrayBuffer())
      outType = 'image/png'
      if (needsRescale) {
        complain(request, DIAGNOSTIC_CODES.imageRescaled,
          `Ужато с ${bitmap.width}×${bitmap.height} до ${width}×${height}: ` +
          `Figma не принимает сторону больше ${MAX_SIDE}px.`, 'info', false)
      }
      if (needsRecode) {
        complain(request, DIAGNOSTIC_CODES.imageRecoded,
          `Формат ${mimeType} переупакован в PNG.`, 'info', false)
      }
    } else {
      /** ИСХОДНЫЕ байты. Измерено в плане 4: `fetch` отдаёт 241 байт,
       *  канва переупаковывает в 449. Переупаковывать без причины
       *  значит раздувать бандл и терять качество. */
      raw = new Uint8Array(await blob.arrayBuffer())
    }
    bitmap.close()

    assets.push({
      id: request.id, mimeType: outType, width, height,
      path: `assets/${request.id}.${extensionFor(outType)}`,
    })
    bytes[request.id] = raw
  }

  return { assets, bytes, report }
}
