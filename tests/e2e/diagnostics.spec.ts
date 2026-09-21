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

test('transform-nested: потомки трансформированного узла ОБЪЯСНЕНЫ, а не молчат', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('transform-nested'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const rotated = screen.root.children[0]
  expect(rotated?.transform, 'сам родитель переносится верно').not.toBeNull()

  const child = rotated?.children[0]
  const grandchild = child?.children[0]
  expect(child).toBeDefined()
  expect(grandchild).toBeDefined()

  // Геометрия потомков неверна — это известно и не чинится здесь. Но
  // молчать об этом нельзя: пока трансформы были отложены, родитель нёс
  // deferred.transform и инвариант заставлял бандл объяснить пропажу.
  // Когда родитель стал переноситься верно, объяснение исчезло бы вместе
  // с ним, а неверность потомков осталась.
  const explained = (id: string | undefined): boolean =>
    report.some((i) => i.nodeId === id && i.code === 'fidelity.transform-descendant')

  expect(explained(child?.id), 'ребёнок обязан быть объяснён').toBe(true)
  expect(explained(grandchild?.id), 'внук тоже — флаг наследуется вглубь').toBe(true)

  // А сам родитель — не потомок, на нём диагностики быть не должно.
  expect(explained(rotated?.id)).toBe(false)
})

test('transformed: трансформа переносится, rect — НЕтрансформированный бокс', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('transformed'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const row = screen.root.children[0]
  const kids = row?.children ?? []
  expect(kids).toHaveLength(4)

  for (const kid of kids) {
    expect(kid.transform, `у ${kid.id} обязана быть трансформа`).not.toBeNull()
  }

  // Повёрнутый блок: rect обязан остаться 120×60, а не раздуться до габарита
  // повёрнутого (131.44×89.01 — именно это раздутие было симптомом в плане 1).
  const rotated = kids[0]
  expect(rotated?.rect.w).toBeCloseTo(120, 1)
  expect(rotated?.rect.h).toBeCloseTo(60, 1)
  expect(rotated?.transform?.angle).toBeGreaterThan(0)

  /** Поворот с НЕравномерным масштабом. Разложение обязано вернуть
   *  РАЗНЫЕ scaleX и scaleY: свёрнутые в один множитель, они дали бы
   *  правдоподобную, но неверную фигуру, а `hasSkew` не должен принять
   *  такую матрицу за сдвинутую — ровно тот случай, ради которого допуск
   *  в нём нормирован. */
  const scaled = kids[3]
  expect(scaled?.rect.w).toBeCloseTo(120, 1)
  expect(scaled?.rect.h).toBeCloseTo(60, 1)
  expect(scaled?.transform?.scaleX).toBeCloseTo(1.6, 3)
  expect(scaled?.transform?.scaleY).toBeCloseTo(0.7, 3)

  expect(report.some((i) => i.code === 'deferred.transform')).toBe(false)
})

/** Строчный элемент — единственный, к которому CSS трансформу НЕ применяет,
 *  хотя Chrome всё равно отдаёт матрицу в computed style. Без проверки
 *  `appliesTransform` такой узел приехал бы с трансформой, которой браузер
 *  не делал, и с боксом 0×0 (computed `width` у строчного равен `auto`), то
 *  есть исчез бы из рендера молча. Фикстуры для этого нет намеренно: текст
 *  в фикстуре `transformed` добавил бы в pixel-diff шум сглаживания глифов
 *  и замутил бы измерение самой трансформы. */
test('строчный элемент: матрица есть, трансформы нет — узел приезжает без неё', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await page.setContent(
    '<!doctype html><body style="margin:0">' +
    '<span id="s" style="transform:rotate(30deg);background:#f00">inline</span>' +
    '<span id="b" style="display:inline-block;width:60px;height:20px;' +
    'transform:rotate(30deg);background:#0f0"></span>' +
    '</body>',
  )
  const expected = await page.evaluate(() => {
    const el = document.getElementById('s')
    if (el === null) throw new Error('нет #s')
    const r = el.getBoundingClientRect()
    return { w: r.width, h: r.height }
  })

  const { screen } = await captureScreen(page, 's0', 'Desktop')
  const [inline, inlineBlock] = screen.root.children

  expect(inline?.transform, 'строчному элементу трансформа не применяется').toBeNull()
  expect(inline?.rect.w).toBeCloseTo(expected.w, 1)
  expect(inline?.rect.h).toBeCloseTo(expected.h, 1)

  // Контроль: inline-block трансформируем, и у него трансформа обязана быть.
  expect(inlineBlock?.transform, 'inline-block трансформируем').not.toBeNull()
  expect(inlineBlock?.rect.w).toBeCloseTo(60, 1)
  expect(inlineBlock?.rect.h).toBeCloseTo(20, 1)
})

test('gradient: линейный градиент переносится и НЕ диагностируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('gradient'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const hero = screen.root.children[0]
  const fill = hero?.style.fills.find((f) => f.kind === 'gradient')
  expect(fill, 'линейный градиент обязан доехать заливкой').toBeDefined()
  if (fill?.kind !== 'gradient') throw new Error('не градиент')
  expect(fill.gradient.stops.length).toBeGreaterThanOrEqual(2)

  // Разобранный градиент диагностировать не нужно: это был бы шум.
  expect(report.some((i) => i.nodeId === hero?.id && i.code === 'deferred.gradient'))
    .toBe(false)
})

test('radial-gradient: радиальный диагностируется, а не теряется молча', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('radial-gradient'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')
  const node = screen.root.children[0]
  expect(node?.style.fills.some((f) => f.kind === 'gradient')).toBe(false)
  expect(report.some((i) => i.nodeId === node?.id && i.code === 'deferred.gradient'))
    .toBe(true)
})

test('blend-isolated: наложение в изолирующей группе ОБЪЯСНЕНО, а не молчит', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('blend-isolated'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const explained = (id: string | undefined): boolean =>
    report.some((i) => i.nodeId === id && i.code === 'fidelity.blend-isolation')

  // Измерено на зонде: в браузере элемент внутри isolation: isolate
  // остаётся своим цветом, а плоский рендерер смешивает его со всем, что
  // нарисовано раньше, и чернит. Геометрия тут ни при чём — ошибается
  // модель композиции, и молчать о ней нельзя.
  const isolated = screen.root.children[1]?.children[0]
  expect(isolated?.style.blend).toBe('multiply')
  expect(explained(isolated?.id), 'наложение под isolation обязано быть объяснено')
    .toBe(true)

  // opacity < 1 изолирует не хуже явного isolation — это часто
  // неожиданно, поэтому проверяется отдельно.
  const faded = screen.root.children[2]?.children[0]
  expect(explained(faded?.id), 'opacity < 1 тоже создаёт изолирующую группу')
    .toBe(true)
})

test('blend: наложение БЕЗ изолирующего предка не диагностируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('blend'))
  const { report } = await captureScreen(page, 's0', 'Desktop')

  // Иначе диагностика была бы шумом на каждом наложении, а шум учит
  // игнорировать отчёт. Здесь рендерер воспроизводит наложение верно —
  // это подтверждено нулевым расхождением в pixel-diff.
  expect(report.some((i) => i.code === 'fidelity.blend-isolation')).toBe(false)
})

test('blend: режим наложения доезжает и не диагностируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('blend'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const modes = screen.root.children.map((s) => s.children[0]?.style.blend)
  expect(modes).toEqual(['multiply', 'screen', 'overlay'])
  expect(report.some((i) => i.code === 'deferred.blend')).toBe(false)
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
