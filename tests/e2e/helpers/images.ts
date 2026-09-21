import type { RenderImage } from '@w2f/reference-renderer'
import type { ResolvedAssets } from './capture.js'

/** Превращает разрешённые ассеты в то, что читает рендерер.
 *
 *  `data:`-URI, а не путь к файлу: SVG растеризуется в отрыве от
 *  бандла, и внешняя ссылка не разрешилась бы — растеризатор нарисовал
 *  бы пустоту молча, а pixel-diff показал бы расхождение без причины. */
export const imagesFor = (
  resolved: ResolvedAssets,
): ReadonlyMap<string, RenderImage> => new Map(
  resolved.assets.map((asset) => [asset.id, {
    dataUri: `data:${asset.mimeType};base64,${resolved.base64[asset.id] ?? ''}`,
    width: asset.width,
    height: asset.height,
  }]),
)
