import { unzipSync, strFromU8 } from 'fflate'
import { parseBundle } from '@h2d/ir'
import type { UnpackedBundle } from './types.js'

/** Разбирает файл `.h2d`.
 *
 *  Порядок проверок не случаен и идёт от самой понятной ошибки к самой
 *  подробной: это наш файл вообще? — та ли версия? — цел ли по схеме и
 *  инвариантам? — на месте ли байты? Обратный порядок вывалил бы на
 *  человека, открывшего не тот файл, простыню zod. */
export const unpackBundle = async (zip: Uint8Array): Promise<UnpackedBundle> => {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip)
  } catch (error) {
    throw new Error(`Файл не читается как ZIP: ${String(error)}`)
  }

  const irBytes = entries['ir.json']
  if (irBytes === undefined) {
    throw new Error(
      'В архиве нет ir.json — это не бандл h2d. Похоже, выбран не тот файл.',
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(strFromU8(irBytes))
  } catch (error) {
    throw new Error(`ir.json повреждён и не разбирается: ${String(error)}`)
  }

  /** Маркер формата и версию сверяет сам `parseBundle`, причём ДО
   *  схемы — ровно для этого в контракте и заведён `BundleEnvelope`.
   *
   *  Здесь стояла такая же проверка, и сломать её было невозможно: за
   *  ней немедленно шла вторая, дававшая тот же отказ. Ветка, которую
   *  нельзя сломать с изменением результата, мертва — удаляется ветка,
   *  а не тест. Тесты про версию и формат остались: они проверяют
   *  поведение `unpackBundle` наружу, а не то, чьей строкой оно
   *  достигнуто. */
  const verdict = parseBundle(raw)
  if (!verdict.ok) {
    throw new Error(`Бандл не прошёл проверку: ${verdict.error}`)
  }

  const assets: Record<string, Uint8Array> = {}
  for (const asset of verdict.bundle.assets) {
    const bytes = entries[asset.path]
    if (bytes === undefined) {
      throw new Error(
        `Ассет "${asset.id}" объявлен в ir.json, но файла ${asset.path} в ` +
        `архиве нет. В Figma это дало бы пустой прямоугольник без диагностики.`,
      )
    }
    assets[asset.id] = bytes
  }

  return { bundle: verdict.bundle, files: { assets } }
}
