/**
 * Копирует собранный сериализатор в `vendor/`.
 *
 * Зачем отдельным шагом. Расширение доставляет сериализатор в страницу
 * файлом, а файл обязан лежать внутри пакета расширения — Chrome не
 * читает за его пределами. Копия делалась руками, и это оказалось
 * тихой подменой: правки в сериализаторе не доезжали до расширения,
 * а захват молча шёл СТАРЫМ кодом. Обнаружилось только на живой
 * странице, где в отчёте всплыли дефекты, починенные двумя часами
 * раньше.
 *
 * Теперь копия обновляется на каждой сборке, а тест сверяет, что она
 * совпадает с исходником.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../serializer/dist/serializer.global.js')
const target = resolve(here, '../vendor/serializer.global.js')

if (!existsSync(source)) {
  console.error(
    `Сериализатор не собран: ${source}\n` +
    'Собери его первым: pnpm build:serializer',
  )
  process.exit(1)
}

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log('vendor/serializer.global.js обновлён')
