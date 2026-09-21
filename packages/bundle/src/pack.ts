import { zipSync, strToU8 } from 'fflate'
import type { Bundle } from '@w2f/ir'
import type { BundleFiles } from './types.js'

/** Пакует бандл в файл `.w2f`.
 *
 *  Файл, а не REST: Figma REST API не умеет создавать содержимое
 *  файла — только плагин внутри Figma. Это ограничение платформы, и
 *  оно определяет архитектуру из двух половин целиком.
 *
 *  ZIP, а не один JSON с base64: байты ассетов составляют почти весь
 *  вес, и base64 раздул бы их на треть без всякой пользы — внутри
 *  файла кодировать нечего. */
export const packBundle = async (
  bundle: Bundle,
  files: BundleFiles,
): Promise<Uint8Array> => {
  const entries: Record<string, Uint8Array> = {
    /** Отступы намеренно: бандл попадает в багрепорты, и его читают
     *  глазами. Сжатие съедает разницу почти целиком. */
    'ir.json': strToU8(JSON.stringify(bundle, null, 2)),
  }

  for (const asset of bundle.assets) {
    const bytes = files.assets[asset.id]
    if (bytes === undefined) {
      /** Ассет объявлен в IR, но байтов нет. Записать такой бандл
       *  значило бы отложить отказ до плагина, где он выглядел бы
       *  пустым прямоугольником без объяснений. */
      throw new Error(
        `Ассет "${asset.id}" объявлен в IR, но его байтов нет. ` +
        `Такой бандл дал бы пустой прямоугольник в Figma без диагностики.`,
      )
    }
    entries[asset.path] = bytes
  }

  return zipSync(entries, { level: 6 })
}
