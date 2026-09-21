/** Размер изображения из заголовка `data:`-URL, без декодирования.
 *
 *  Зачем. Синхронный обход узнаёт натуральный размер фоновой картинки
 *  приёмом `new Image(); img.src = url; img.complete` — браузер держит
 *  уже отрисованную картинку в кеше и отвечает немедленно. Для
 *  `data:`-URL это не работает: декодирование асинхронно, хотя байты
 *  прямо в строке, и `complete` остаётся `false`.
 *
 *  Найдено на захвате НАСТОЯЩЕЙ страницы: 20 фоновых картинок из 28
 *  недоступных оказались `data:image/png`. Ни одна фикстура такого не
 *  содержала — они все ссылались на файлы.
 *
 *  Разбирается только заголовок и только известных форматов. Всё
 *  остальное отдаёт `null`: подставить сюда правдоподобное число
 *  значило бы молча исказить масштаб, а это ровно тот молчаливый
 *  откат, против которого написан весь проект. */

const decodeBase64Prefix = (payload: string, bytesNeeded: number): Uint8Array | null => {
  /** Берётся только начало: заголовок короткий, а картинка может быть
   *  мегабайтной, и декодировать её целиком ради восьми байт — трата
   *  на каждом узле. Base64 кодирует по три байта в четыре символа,
   *  поэтому длина округляется вверх до кратности четырёх. */
  const charsNeeded = Math.ceil(bytesNeeded / 3) * 4
  const slice = payload.slice(0, charsNeeded)
  if (slice.length < charsNeeded) return null
  try {
    const binary = atob(slice)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
    return out.length >= bytesNeeded ? out : null
  } catch {
    return null
  }
}

const be32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 24 | (bytes[at + 1] ?? 0) << 16
   | (bytes[at + 2] ?? 0) << 8 | (bytes[at + 3] ?? 0)) >>> 0

const le16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | (bytes[at + 1] ?? 0) << 8

export const sizeFromDataUrl = (url: string): { w: number; h: number } | null => {
  if (!url.startsWith('data:')) return null
  const comma = url.indexOf(',')
  if (comma === -1) return null
  const header = url.slice(5, comma)
  if (!header.includes('base64')) return null
  const payload = url.slice(comma + 1)

  if (header.startsWith('image/png')) {
    /** PNG: подпись 8 байт, длина 4, тип 4, затем ширина и высота по
     *  четыре байта в ПРЯМОМ порядке. */
    const bytes = decodeBase64Prefix(payload, 24)
    if (bytes === null) return null
    const w = be32(bytes, 16)
    const h = be32(bytes, 20)
    return w > 0 && h > 0 ? { w, h } : null
  }

  if (header.startsWith('image/gif')) {
    /** GIF: подпись 6 байт, затем ширина и высота по два байта в
     *  ОБРАТНОМ порядке — не так, как в PNG. Отдельная ветка именно
     *  поэтому, а не ради аккуратности. */
    const bytes = decodeBase64Prefix(payload, 10)
    if (bytes === null) return null
    const w = le16(bytes, 6)
    const h = le16(bytes, 8)
    return w > 0 && h > 0 ? { w, h } : null
  }

  if (header.startsWith('image/jpeg') || header.startsWith('image/jpg')) {
    /** JPEG: размер лежит в сегменте SOF, а до него идут сегменты
     *  произвольной длины, которые приходится пройти. Читается первый
     *  килобайт: дальше SOF почти не встречается, а брать больше —
     *  платить на каждом узле. */
    const bytes = decodeBase64Prefix(payload, 1024)
    if (bytes === null) return null
    let at = 2
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at += 1; continue }
      const marker = bytes[at + 1] ?? 0
      /** SOF0..SOF15, кроме 0xC4, 0xC8 и 0xCC — это не кадры. */
      if (marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0)
        const w = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0)
        return w > 0 && h > 0 ? { w, h } : null
      }
      at += 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
    }
    return null
  }

  return null
}
