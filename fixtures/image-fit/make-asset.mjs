/** Генератор тестового изображения. Существует вместо закоммиченного
 *  бинарника, чтобы содержимое можно было прочитать и воспроизвести:
 *  непрозрачный PNG в репозитории невозможно отревьюить.
 *
 *  Картинка намеренно НЕквадратная (64×32) и с градиентом по обеим осям:
 *  на квадратной невозможно отличить `contain` от `cover`, а на
 *  однотонной — заметить зеркальное отражение или поворот. */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const W = 64
const H = 32
const png = new PNG({ width: W, height: H })
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = (W * y + x) << 2
    png.data[i] = Math.round((x / (W - 1)) * 255)
    png.data[i + 1] = Math.round((y / (H - 1)) * 255)
    png.data[i + 2] = 64
    png.data[i + 3] = 255
  }
}
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(resolve(here, 'asset.png'), PNG.sync.write(png))
console.log('fixtures/image-fit/asset.png записан')
