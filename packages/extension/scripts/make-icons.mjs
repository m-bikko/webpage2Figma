/**
 * Логотип расширения.
 *
 * Рисуется кодом, а не кладётся бинарником, по той же причине, что и
 * тестовая картинка в фикстурах: непрозрачный PNG в репозитории
 * невозможно отревьюить, а сгенерированный читается и воспроизводится.
 *
 * Знак: прямоугольник страницы, из которого вырастают три прямоугольника
 * макета — метафора «страница разошлась на экраны». Без текста и без
 * эмодзи: на 16px читается только силуэт.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../icons')
mkdirSync(outDir, { recursive: true })

/** Индиго — цвет, уже используемый в окне расширения. */
const INK = [99, 102, 241]
const PAPER = [255, 255, 255]

const draw = (size) => {
  const png = new PNG({ width: size, height: size })
  const u = size / 16

  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (size * y + x) << 2
    png.data[i] = rgb[0]
    png.data[i + 1] = rgb[1]
    png.data[i + 2] = rgb[2]
    png.data[i + 3] = 255
  }

  const rect = (x, y, w, h, rgb) => {
    for (let dy = 0; dy < Math.round(h); dy += 1) {
      for (let dx = 0; dx < Math.round(w); dx += 1) {
        put(Math.round(x) + dx, Math.round(y) + dy, rgb)
      }
    }
  }

  /** Подложка со скруглением: углы просто не закрашиваются. */
  const radius = Math.round(3 * u)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = Math.min(x, size - 1 - x)
      const ny = Math.min(y, size - 1 - y)
      if (nx < radius && ny < radius
          && Math.hypot(radius - nx, radius - ny) > radius) continue
      put(x, y, INK)
    }
  }

  /** Окно браузера: рамка, полоса вкладки с двумя точками и два
   *  блока содержимого. Метафора прямая — расширение снимает
   *  открытую страницу. Столбики читались как диаграмма и вели не
   *  туда, поэтому знак заменён.
   *
   *  Всё рисуется из прямоугольников кратно 1/16, чтобы на 16px
   *  границы попадали в целые пиксели и силуэт не расплывался. */
  const x0 = Math.round(2.5 * u)
  const y0 = Math.round(3 * u)
  const w = size - 2 * x0
  const h = size - y0 - Math.round(3 * u)
  rect(x0, y0, w, h, PAPER)

  /** Полоса вкладки — тем же цветом подложки, чтобы читалась как
   *  вырез, а не как третий цвет. */
  const barH = Math.max(1, Math.round(2 * u))
  rect(x0, y0, w, barH, INK)
  rect(x0, y0 + barH, w, Math.max(1, Math.round(0.3 * u)), INK)

  /** Две точки на полосе — только там, где для них есть место. */
  if (size >= 32) {
    const dot = Math.max(1, Math.round(0.8 * u))
    rect(x0 + Math.round(0.8 * u), y0 + Math.round(0.6 * u), dot, dot, PAPER)
    rect(x0 + Math.round(2.2 * u), y0 + Math.round(0.6 * u), dot, dot, PAPER)
  }

  /** Два блока содержимого: широкий и узкий — намёк на разные
   *  ширины экрана, ради которых расширение и существует. */
  const inset = Math.round(1.3 * u)
  const blockTop = y0 + barH + Math.round(1.2 * u)
  const blockH = Math.max(1, Math.round(2.2 * u))
  rect(x0 + inset, blockTop, w - 2 * inset, blockH, INK)
  rect(x0 + inset, blockTop + blockH + Math.round(1 * u),
       Math.round((w - 2 * inset) * 0.55), blockH, INK)

  return PNG.sync.write(png)
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), draw(size))
}
console.log('icons/icon-{16,32,48,128}.png записаны')
