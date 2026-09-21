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

test('broken-transform: потомки НЕпереносимой трансформы объяснены', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('broken-transform'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const skewed = screen.root.children[0]
  const kid = skewed?.children[0]
  const grandkid = kid?.children[0]

  // Сам скошенный узел объяснён отдельным кодом — скос невыразим в Figma.
  expect(report.some((i) => i.nodeId === skewed?.id && i.code === 'unsupported.transform-3d'))
    .toBe(true)

  // А вот потомки — это ОСТАТОК, вскрывшийся при снятии общих диагностик
  // групповых эффектов. Скос не попадает в накопленную матрицу, поэтому
  // положение потомков наследует ошибку предка. Без этой проверки случай
  // стал бы молчаливым: четвёртый раз подряд, когда общая диагностика
  // прикрывала соседний случай помимо своего.
  const explained = (id: string | undefined): boolean =>
    report.some((i) => i.nodeId === id && i.code === 'fidelity.transform-descendant')
  expect(explained(kid?.id), 'ребёнок скошенного узла обязан быть объяснён').toBe(true)
  expect(explained(grandkid?.id), 'и внук — признак наследуется вглубь').toBe(true)

  // На самом скошенном узле этой диагностики быть не должно: он не потомок.
  expect(explained(skewed?.id)).toBe(false)
})

test('transform-nested: групповой эффект действует на поддерево, диагностики нет', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('transform-nested'))
  const { report } = await captureScreen(page, 's0', 'Desktop')

  // Утверждение перевёрнуто планом 3. Раньше эти коды были обязательны:
  // эффект применялся только к узлу, поддерево оставалось неверным, и
  // молчать об этом было нельзя. Теперь координаты локальные, рендерер
  // вложенный, и эффект действует на всё поддерево — значит объяснять
  // нечего.
  //
  // Проверка не формальная: если диагностика осталась, обходчик всё ещё
  // считает случай непереносимым, а pixel-diff на этой же фикстуре
  // зелёный. Одно из двух утверждений тогда ложно.
  for (const code of ['fidelity.transform-descendant']) {
    expect(report.some((i) => i.code === code), `лишняя диагностика ${code}`)
      .toBe(false)
  }
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

test('group-effects: групповой эффект действует на поддерево, диагностики нет', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('group-effects'))
  const { report } = await captureScreen(page, 's0', 'Desktop')

  // Утверждение перевёрнуто планом 3. Раньше эти коды были обязательны:
  // эффект применялся только к узлу, поддерево оставалось неверным, и
  // молчать об этом было нельзя. Теперь координаты локальные, рендерер
  // вложенный, и эффект действует на всё поддерево — значит объяснять
  // нечего.
  //
  // Проверка не формальная: если диагностика осталась, обходчик всё ещё
  // считает случай непереносимым, а pixel-diff на этой же фикстуре
  // зелёный. Одно из двух утверждений тогда ложно.
  for (const code of ['fidelity.transform-descendant', 'fidelity.blur-descendant', 'fidelity.opacity-group']) {
    expect(report.some((i) => i.code === code), `лишняя диагностика ${code}`)
      .toBe(false)
  }
})

test('boxes: узлы БЕЗ групповых эффектов не диагностируются', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('boxes'))
  const { report } = await captureScreen(page, 's0', 'Desktop')

  // Иначе диагностика стала бы шумом. В boxes есть и полупрозрачный блок,
  // и блок с клипом — но ни у одного нет детей под эффектом.
  for (const code of [
    'fidelity.opacity-group', 'fidelity.blur-descendant',
    'fidelity.transform-descendant',
  ]) {
    expect(report.some((i) => i.code === code), `лишняя диагностика ${code}`)
      .toBe(false)
  }
})

test('blend-isolated: групповой эффект действует на поддерево, диагностики нет', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('blend-isolated'))
  const { report } = await captureScreen(page, 's0', 'Desktop')

  // Утверждение перевёрнуто планом 3. Раньше эти коды были обязательны:
  // эффект применялся только к узлу, поддерево оставалось неверным, и
  // молчать об этом было нельзя. Теперь координаты локальные, рендерер
  // вложенный, и эффект действует на всё поддерево — значит объяснять
  // нечего.
  //
  // Проверка не формальная: если диагностика осталась, обходчик всё ещё
  // считает случай непереносимым, а pixel-diff на этой же фикстуре
  // зелёный. Одно из двух утверждений тогда ложно.
  for (const code of ['fidelity.blend-isolation']) {
    expect(report.some((i) => i.code === code), `лишняя диагностика ${code}`)
      .toBe(false)
  }
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

test('blur: размытие слоя доезжает и не диагностируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('blur'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  // Неразмытый блок обязан приехать с blur === null, а не с нулевым
  // объектом: пустой `{0,0}` заставил бы инвариант @h2d/ir требовать
  // диагностику там, где откладывать нечего.
  const blurs = screen.root.children.map((n) => n.style.blur)
  expect(blurs).toEqual([
    null,
    { layer: 4, background: 0 },
    { layer: 10, background: 0 },
  ])

  // Перенесённое размытие диагностировать не нужно — это был бы шум.
  // Отложено теперь только фоновое, а его в фикстуре нет.
  expect(report.some((i) => i.code === 'deferred.blur')).toBe(false)
})

/** Фоновое размытие остаётся отложенным, и молчать о нём нельзя. Фикстуры
 *  для этого нет намеренно: `backdrop-filter` рендерер воспроизвести не
 *  может в принципе — он плющит дерево, и «того, что за элементом» у него
 *  не существует, — поэтому в pixel-diff такая фикстура внесла бы
 *  заведомое расхождение. Проверяется ровно то, что проверяемо:
 *  диагностика есть и указывает на нужный узел. */
test('backdrop-filter остаётся отложенным и объяснён диагностикой', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await page.setContent(
    '<!doctype html><body style="margin:0;background:#6366f1">' +
    '<div id="glass" style="width:200px;height:100px;' +
    'backdrop-filter:blur(8px);background:rgba(255,255,255,0.2)"></div>' +
    '</body>',
  )
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const glass = screen.root.children[0]
  expect(glass?.style.blur).toEqual({ layer: 0, background: 8 })
  expect(
    report.some((i) => i.nodeId === glass?.id && i.code === 'deferred.blur'),
    'фоновое размытие обязано быть объяснено, иначе оно теряется молча',
  ).toBe(true)
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
