import { expect, test } from '@playwright/test'
import type { DiagnosticCode } from '@h2d/ir'
import { captureScreen, fixtureUrl } from './helpers/capture.js'

/** Коды, обязанные появиться на каждой фикстуре. Список положительный
 *  намеренно: «нет лишних диагностик» — слабое утверждение, а «есть
 *  ожидаемая» — сильное, и именно оно ловит молчаливую потерю.
 *
 *  Тип значений — `DiagnosticCode`, а не `string`: иначе опечатка в коде
 *  дала бы вечно «отсутствующую» диагностику, то есть тест, который
 *  падает не по той причине, по которой обещает. */
const EXPECTED: Record<string, readonly DiagnosticCode[]> = {
  transformed: ['deferred.transform'],
  gradient: ['deferred.gradient'],
  'missing-font': ['fidelity.font-fallback'],
  'dashed-border': ['fidelity.stroke-style-flattened'],
  /** Признанное упрощение резолвера: позиционированный узел с
   *  `z-index: auto` считается атомарным, хотя по CSS его
   *  z-индексированные потомки должны подниматься к предку. Молчать
   *  о нём нельзя, поэтому диагностика обязана присутствовать —
   *  и эта проверка не даст ей потеряться при будущих правках. */
  stacking: ['fidelity.paint-order-approximated'],
  'absolute-in-flex': ['fidelity.paint-order-approximated'],
}

for (const [fixture, codes] of Object.entries(EXPECTED)) {
  test(`диагностики: ${fixture}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(fixtureUrl(fixture))
    const { report } = await captureScreen(page, 's0', 'Desktop')
    const present = new Set(report.map((item) => item.code))
    for (const code of codes) {
      expect(
        present.has(code),
        `фикстура ${fixture} обязана породить "${code}", а в отчёте: ` +
        `${[...present].join(', ') || '(пусто)'}`,
      ).toBe(true)
    }
  })
}

test('фон <html> переносится на корневой узел и об этом сообщается', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  // Фикстура не нужна: setContent достаточно, а фон на <html> — единственное,
  // что здесь проверяется.
  await page.setContent(
    '<!doctype html><html style="background:#1e293b"><body>' +
    '<div style="width:100px;height:50px;background:#fff"></div>' +
    '</body></html>',
  )
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  // Без переноса тёмная страница приехала бы на белом фоне, и поймать это
  // было бы нечем: обход начинается с <body> и до <html> не доходит.
  expect(screen.root.style.fills).toEqual([
    { kind: 'solid', color: { r: 30, g: 41, b: 59, a: 1 } },
  ])
  const explained = report.some(
    (item) => item.code === 'fidelity.page-background-moved',
  )
  expect(explained, 'перенос фона обязан быть объяснён в отчёте').toBe(true)
})

test('фон <body> не подменяется фоном <html>', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await page.setContent(
    '<!doctype html><html style="background:#1e293b">' +
    '<body style="background:#f8fafc"></body></html>',
  )
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')
  // У body свой фон — переносить нечего, и диагностики быть не должно.
  expect(screen.root.style.fills).toEqual([
    { kind: 'solid', color: { r: 248, g: 250, b: 252, a: 1 } },
  ])
  expect(report.some((i) => i.code === 'fidelity.page-background-moved')).toBe(false)
})

test('transformed: диагностика уровня error на каждом трансформированном узле', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('transformed'))
  const { report } = await captureScreen(page, 's0', 'Desktop')
  const transforms = report.filter((item) => item.code === 'deferred.transform')
  expect(transforms.length).toBe(3)
  for (const item of transforms) {
    expect(item.level).toBe('error')
    expect(item.nodeId).not.toBeNull()
  }
})

test('gradient: блок с градиентом НЕ приезжает молча прозрачным', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('gradient'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')
  // Заливки у него действительно нет — градиенты в этом плане не
  // переносятся. Но это обязано быть СКАЗАНО, а не умолчано.
  const hero = screen.root.children[0]
  expect(hero?.style.fills).toEqual([])
  const explained = report.some(
    (item) => item.code === 'deferred.gradient' && item.nodeId === hero?.id,
  )
  expect(explained, 'градиент без диагностики — молчаливая потеря').toBe(true)
})

test('inline-text: конкатенация ранов равна конкатенации строк', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('inline-text'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const collect = (node: typeof screen.root, out: typeof screen.root[]): void => {
    out.push(node)
    for (const child of node.children) collect(child, out)
  }
  const all: typeof screen.root[] = []
  collect(screen.root, all)

  const norm = (v: string): string => v.replace(/\s+/g, ' ').trim()
  let checked = 0
  for (const node of all) {
    if (node.kind !== 'text') continue
    checked += 1
    const fromRuns = norm(node.text.runs.map((r) => r.text).join(''))
    const fromLines = norm(node.text.lines.map((l) => l.text).join(''))
    expect(fromRuns, `узел ${node.id} (${node.sourceTag})`).toBe(fromLines)
  }
  expect(checked, 'текстовых узлов не найдено — фикстура не сработала')
    .toBeGreaterThan(1)
})

test('inline-text: "world" не дублируется между абзацем и вложенным b', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('inline-text'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const texts: string[] = []
  const walk = (node: typeof screen.root): void => {
    if (node.kind === 'text') texts.push(node.text.runs.map((r) => r.text).join(''))
    for (const child of node.children) walk(child)
  }
  walk(screen.root)

  const occurrences = texts.filter((t) => t.includes('world')).length
  // Ровно один узел несёт "world" — сам <b>. Абзац несёт только
  // собственный текст, без подграфа. Два вхождения означали бы, что
  // плагин Figma нарисует слово дважды с наложением.
  expect(occurrences, `"world" встретился в ${occurrences} узлах: ${texts.join(' | ')}`)
    .toBe(1)
})

test('absolute-in-flex: участие в раскладке родителя различается по детям', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('absolute-in-flex'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const card = screen.root.children[0]
  expect(card?.layout.mode).toBe('row')
  const kids = card?.children ?? []
  expect(kids).toHaveLength(3)

  const positioning = kids.map((k) => k.selfLayout.positioning)
  expect(positioning).toContain('absolute')
  expect(positioning.filter((p) => p === 'flow')).toHaveLength(2)

  const grower = kids.find((k) => k.selfLayout.grow === 2)
  expect(grower, 'flex-grow: 2 должен доехать в selfLayout').toBeDefined()
})

test('missing-font: usedFamily — фактический шрифт, а не объявленный', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('missing-font'))
  const { screen, fonts } = await captureScreen(page, 's0', 'Desktop')

  const paragraphs = screen.root.children.filter((n) => n.kind === 'text')
  expect(paragraphs).toHaveLength(2)

  const first = paragraphs[0]
  if (first === undefined || first.kind !== 'text') throw new Error('нет абзаца')
  const run = first.text.runs[0]
  expect(run?.fontStack[0]).toBe('Заведомо Отсутствующий Шрифт XYZ')
  expect(run?.usedFamily).not.toBe('Заведомо Отсутствующий Шрифт XYZ')
  expect(run?.usedFamily).toBe('Arial')

  // collectFonts обязан отдать фактический шрифт: по нему плагин будет
  // предзагружать, и объявленный там бесполезен.
  expect(fonts.map((f) => f.family)).toContain('Arial')
  expect(fonts.map((f) => f.family)).not.toContain('Заведомо Отсутствующий Шрифт XYZ')
})

test('dashed-border: стиль обводки доезжает, невыразимый сводится к solid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('dashed-border'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const styles = screen.root.children.map((n) => n.style.stroke?.style)
  expect(styles).toEqual(['dashed', 'dotted', 'solid'])
  for (const child of screen.root.children) {
    expect(child.style.stroke?.align).toBe('inside')
  }
})

test('text-transform: преобразование применено к самой строке', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('text-transform'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const paragraphs = screen.root.children.filter((n) => n.kind === 'text')
  expect(paragraphs).toHaveLength(3)

  const textOf = (index: number): string => {
    const node = paragraphs[index]
    if (node === undefined || node.kind !== 'text') throw new Error('нет абзаца')
    return node.text.runs.map((r) => r.text).join('')
  }

  // Эту потерю pixel-diff увидеть не может: рендерер сравнивал бы одну и
  // ту же непреобразованную строку с обеих сторон и остался бы зелёным.
  expect(textOf(0)).toBe('СТРОЧНЫЙ ИСХОДНИК СТАНЕТ ПРОПИСНЫМ')
  expect(textOf(1)).toBe('Каждое Слово С Большой Буквы')
  expect(textOf(2)).toBe('прописной исходник станет строчным')

  // И строки тоже: инвариант контракта сверяет их конкатенации.
  const first = paragraphs[0]
  if (first === undefined || first.kind !== 'text') throw new Error('нет абзаца')
  expect(first.text.lines.map((l) => l.text).join('')).toContain('ПРОПИСНЫМ')
})
