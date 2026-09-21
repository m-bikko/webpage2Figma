import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { IrNode } from '@h2d/ir'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'

type TextNode = Extract<IrNode, { kind: 'text' }>

const FIXTURES = [
  'boxes', 'stacking', 'flex', 'text',
  'transformed', 'transform-nested', 'broken-transform', 'gradient', 'radial-gradient', 'inline-text', 'absolute-in-flex',
  'missing-font', 'dashed-border', 'text-transform', 'blend', 'blend-isolated', 'group-effects',
  'blur',
] as const

const snapshotPath = (fixture: string, width: number): string =>
  resolve(repoRoot, 'fixtures', fixture, 'ir', `${width}.json`)

/** Снапшот создаётся при первом запуске с UPDATE_SNAPSHOTS=1 и после этого
 *  коммитится. Без флага отсутствие снапшота — провал теста, иначе
 *  регрессия могла бы молча «создать новый эталон». */
const compareSnapshot = (fixture: string, width: number, actual: unknown): void => {
  const file = snapshotPath(fixture, width)
  const serialized = `${JSON.stringify(actual, null, 2)}\n`

  if (process.env['UPDATE_SNAPSHOTS'] === '1') {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, serialized, 'utf8')
    return
  }

  expect(
    existsSync(file),
    `Снапшот IR отсутствует: ${file}. Создай его через UPDATE_SNAPSHOTS=1.`,
  ).toBe(true)
  expect(JSON.parse(serialized)).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}

for (const fixture of FIXTURES) {
  for (const size of SIZES) {
    test(`IR-снапшот: ${fixture} @ ${size.width}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(fixtureUrl(fixture))
      const { screen, report } = await captureScreen(page, `s-${size.width}`, size.name)

      expect(screen.width).toBe(size.width)
      expect(screen.root.sourceTag).toBe('body')
      compareSnapshot(fixture, size.width, { screen, report })
    })
  }
}

test('стекинг: порядок отрисовки не совпадает с порядком DOM', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('stacking'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  type Flat = { tag: string; order: number; x: number; y: number; w: number; h: number }
  const flat: Flat[] = []
  /** Координаты складываются по пути от корня: с плана 3 `rect` задан
   *  относительно родителя, а опознавать блоки удобнее по абсолютному
   *  положению — оно уникально и совпадает с тем, что написано в CSS
   *  фикстуры. */
  const visit = (node: typeof screen.root, offX: number, offY: number): void => {
    const x = offX + node.rect.x
    const y = offY + node.rect.y
    flat.push({
      tag: node.sourceTag,
      order: node.paintOrder,
      x, y, w: node.rect.w, h: node.rect.h,
    })
    for (const child of node.children) visit(child, x, y)
  }
  visit(screen.root, 0, 0)

  /** Геометрия в этой фикстуре уникальна у каждого блока, а имён классов
   *  в IR нет — узлы опознаются по прямоугольнику. */
  const at = (x: number, y: number, w: number, h: number): Flat => {
    const found = flat.find((n) => n.x === x && n.y === y && n.w === w && n.h === h)
    if (found === undefined) {
      throw new Error(
        `Узел ${w}x${h} в (${x},${y}) не найден. Найдено: ` +
        flat.map((n) => `${n.w}x${n.h}@${n.x},${n.y}`).join(' '),
      )
    }
    return found
  }

  /** Сначала — что узлы вообще все на месте. Без этого проверка
   *  уникальности индексов ниже проходит ТРИВИАЛЬНО на пропавшем узле:
   *  это один из трёх случаев, перечисленных в правиле «проверяй
   *  проверки», и он был именно здесь. */
  expect(flat).toHaveLength(10)

  /** Плотная перестановка 0..n-1, а не просто уникальность: плотность —
   *  инвариант контракта, и ловит она ровно потерянный узел. */
  expect(flat.map((n) => n.order).sort((a, b) => a - b))
    .toEqual(flat.map((_, index) => index))

  // .top идёт в DOM ПЕРВЫМ среди блоков .stage, а красится ПОСЛЕДНИМ:
  // это и есть заявленное в названии расхождение с порядком DOM.
  const top = at(20, 20, 140, 140)
  const mid = at(70, 60, 140, 140)
  const bottom = at(120, 100, 140, 140)
  expect(top.order).toBe(Math.max(...flat.map((n) => n.order)))
  expect(top.order).toBeGreaterThan(mid.order)
  expect(mid.order).toBeGreaterThan(bottom.order)

  // z-index: 999 внутри .ctx (z-index: 1) не поднимает .inner выше
  // .isolated-sibling (z-index: 2) — z-index изолирован контекстом.
  // Проверено в настоящем Chrome скриншотом, а не только по спеке.
  const inner = at(280, 60, 160, 80)
  const isolated = at(300, 120, 200, 60)
  expect(inner.order).toBeLessThan(isolated.order)

  // .under (z-index: -1) существует и не потерялся.
  // ВНИМАНИЕ: его индекс сейчас БОЛЬШЕ, чем у потокового .flow, хотя
  // Chrome красит отрицательный z-index раньше потоковых блоков.
  // Причина — сознательное упрощение в `isStackingParticipant`
  // (packages/serializer/src/stacking.ts): `position: relative` с
  // `z-index: auto` трактуется как атомарная единица, и потомки из него
  // не поднимаются. Утверждение о порядке здесь НЕ делается намеренно:
  // и «раньше» (упало бы), и «позже» (заморозило бы неверное поведение)
  // были бы неправдой о том, что проект хочет. Разбирается отдельно.
  expect(at(170, 140, 140, 140)).toBeDefined()
})

test('boxes: цвет в синтаксисе oklch() разобран, а не отброшен', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('boxes'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const wrap = screen.root.children[0]
  expect(wrap).toBeDefined()
  // oklch(0.62 0.19 29) — насыщенный красно-оранжевый: канал r должен
  // заметно преобладать, а сам цвет обязан быть разобран.
  const modern = wrap?.children.find((node) => {
    const fill = node.style.fills[0]
    return fill?.kind === 'solid' && fill.color.r > 180 && fill.color.g < 120
  })
  expect(modern, 'элемент с oklch-цветом должен иметь разобранную заливку').toBeDefined()
  expect(report.filter((item) => item.code === 'fidelity.color-unparsed')).toHaveLength(0)
})

test('flex: на 390px первый ряд превращается в колонку', async ({ page }) => {
  await page.goto(fixtureUrl('flex'))

  await page.setViewportSize({ width: 1440, height: 900 })
  const wide = await captureScreen(page, 's0', 'Desktop')
  const wideRow = wide.screen.root.children[0]
  expect(wideRow?.layout.mode).toBe('row')

  await page.setViewportSize({ width: 390, height: 844 })
  const narrow = await captureScreen(page, 's1', 'Mobile')
  const narrowRow = narrow.screen.root.children[0]
  expect(narrowRow?.layout.mode).toBe('column')
})

test('text: узкий абзац переносится на несколько строк с разными боксами', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('text'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  // `kind`, а не `node.text !== null`: `text` есть только у члена
  // объединения `kind: 'text'` и там он не nullable. Проверка на null
  // не компилируется вовсе — у остальных членов такого поля нет.
  const paragraphs = screen.root.children.filter(
    (node): node is TextNode => node.kind === 'text',
  )
  expect(paragraphs.length).toBeGreaterThanOrEqual(6)

  const narrow = paragraphs.find((node) => node.text.lines.length > 2)
  expect(narrow, 'узкий абзац должен дать больше двух строк').toBeDefined()

  const lines = narrow?.text.lines ?? []
  const ys = lines.map((line) => line.y)
  expect(new Set(ys).size).toBe(ys.length)
  for (const line of lines) {
    expect(line.text.length).toBeGreaterThan(0)
  }
})
