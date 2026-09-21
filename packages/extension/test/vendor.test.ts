import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Копия сериализатора в `vendor/` обязана совпадать с собранным.
 *
 *  Расширение доставляет сериализатор в страницу файлом, а файл должен
 *  лежать внутри пакета расширения. Копия делалась руками — и оказалась
 *  тихой подменой: правки в сериализаторе не доезжали, захват шёл
 *  СТАРЫМ кодом, и обнаружилось это только на живой странице, где в
 *  отчёте всплыли дефекты, починенные двумя часами раньше.
 *
 *  Проверка сравнивает БАЙТЫ, а не время правки: устаревшая копия
 *  может быть и новее по времени, если её трогали. */
const here = dirname(fileURLToPath(import.meta.url))

describe('вендорная копия сериализатора', () => {
  it('совпадает с собранным', () => {
    const vendored = readFileSync(
      resolve(here, '../vendor/serializer.global.js'),
    )
    const built = readFileSync(
      resolve(here, '../../serializer/dist/serializer.global.js'),
    )
    expect(vendored.equals(built)).toBe(true)
  })
})
