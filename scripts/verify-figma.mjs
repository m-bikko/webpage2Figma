/**
 * Сверяет экспорт из Figma с браузерным скриншотом.
 *
 * Превращает «сверку глазами» в измерение. До этого момента вся точность
 * проекта проверялась против Chromium — в том числе pixel-diff, который
 * растеризует наш SVG ТЕМ ЖЕ движком. Figma — третий движок, и здесь
 * впервые видно, насколько он расходится.
 *
 *   pnpm verify-figma <экспорт.png> [эталон.png]
 *
 * Эталон по умолчанию — out/page.png от последнего `pnpm capture`.
 * Экспорт обрезается по размеру фрейма, поэтому эталон берётся его же
 * верхним левым куском: у браузерного скриншота высота вьюпорта, у
 * фрейма — высота содержимого.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const [, , exportArg, referenceArg] = process.argv
if (exportArg === undefined) {
  console.error('Укажи PNG, выгруженный из Figma. Пример:')
  console.error('  pnpm verify-figma out/figma-export.png')
  process.exit(1)
}

const exported = PNG.sync.read(readFileSync(resolve(process.cwd(), exportArg)))
const reference = PNG.sync.read(
  readFileSync(resolve(process.cwd(), referenceArg ?? 'out/page.png')),
)

console.log(`экспорт из Figma: ${exported.width}×${exported.height}`)
console.log(`браузер:          ${reference.width}×${reference.height}`)

if (exported.width > reference.width || exported.height > reference.height) {
  console.error(
    '\nЭкспорт БОЛЬШЕ эталона. Скорее всего выгружено с множителем 2x —\n' +
    'выгрузи заново с 1x, иначе сравнивать нечего.',
  )
  process.exit(1)
}

/** Эталон обрезается до размера экспорта: у браузерного скриншота
 *  высота вьюпорта, у фрейма — высота содержимого. Обрезка по верхнему
 *  левому углу верна, потому что корневой узел стоит в нуле. */
const cropped = new PNG({ width: exported.width, height: exported.height })
for (let y = 0; y < exported.height; y += 1) {
  for (let x = 0; x < exported.width; x += 1) {
    const from = (reference.width * y + x) * 4
    const to = (exported.width * y + x) * 4
    cropped.data[to] = reference.data[from]
    cropped.data[to + 1] = reference.data[from + 1]
    cropped.data[to + 2] = reference.data[from + 2]
    cropped.data[to + 3] = reference.data[from + 3]
  }
}

const diff = new PNG({ width: exported.width, height: exported.height })
const total = exported.width * exported.height
const differing = pixelmatch(
  cropped.data, exported.data, diff.data, exported.width, exported.height,
  { threshold: 0.1 },
)

const out = resolve(process.cwd(), 'out/figma-diff.png')
writeFileSync(out, PNG.sync.write(diff))

const percent = ((differing / total) * 100).toFixed(3)
console.log(`\nрасхождение: ${differing} из ${total} пикселей (${percent}%)`)
console.log(`карта различий: ${out}`)

/** Где именно расходится — важнее, чем сколько. Расхождение ровным
 *  слоем по всей площади означает разную растеризацию; сосредоточенное
 *  в одном месте означает дефект переноса, и это совсем другой разговор. */
const columns = new Map()
for (let y = 0; y < exported.height; y += 1) {
  for (let x = 0; x < exported.width; x += 1) {
    const i = (exported.width * y + x) * 4
    if (diff.data[i] === 255 && diff.data[i + 1] === 0) {
      const bucket = Math.floor(x / 50) * 50
      columns.set(bucket, (columns.get(bucket) ?? 0) + 1)
    }
  }
}
if (columns.size > 0) {
  console.log('\nпо колонкам (шаг 50px):')
  for (const [bucket, count] of [...columns].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  x ${bucket}..${bucket + 49}: ${count}`)
  }
}
