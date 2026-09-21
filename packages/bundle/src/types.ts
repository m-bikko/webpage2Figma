import type { Bundle } from '@w2f/ir'

/** Содержимое файла `.w2f`, помимо самого `ir.json`.
 *
 *  Байты — `Uint8Array`, а не base64: внутри файла кодировать нечего,
 *  а base64 раздул бы архив на треть. Строками они ездят только через
 *  границу страницы, где иначе не проехать. */
export type BundleFiles = {
  /** Байты ассетов по их идентификатору. Ключи обязаны покрывать
   *  `bundle.assets`: ассет, объявленный в IR и отсутствующий в
   *  архиве, — это пустой прямоугольник в Figma без объяснений. */
  assets: Record<string, Uint8Array>
}

export type UnpackedBundle = {
  bundle: Bundle
  files: BundleFiles
}
