import { expect, test } from '@playwright/test'
import { IR_VERSION, parseBundle, type Bundle } from '@h2d/ir'
import { captureScreen, fixtureUrl, SIZES } from './helpers/capture.js'

/**
 * Собирает бандл из настоящего захвата и прогоняет через входную проверку
 * плагина Figma.
 *
 * Эта проверка существует потому, что её отсутствие было дырой, найденной
 * скриптом capture.mjs, а не тестами. Двадцать инвариантов в `@h2d/ir`
 * были покрыты юнит-тестами на СИНТЕТИЧЕСКИХ бандлах и ни разу не
 * прогонялись против того, что реально выдаёт сериализатор. В результате
 * инвариант связности текста падал на первой же живой странице с
 * переносом строки, а 95 e2e-тестов этого не видели: снапшоты сравнивают
 * IR сам с собой, а проверка диагностик смотрит только коды.
 *
 * Здесь замыкается последнее звено: захват → сборка бандла → валидатор.
 * Если сериализатор когда-нибудь выдаст то, что плагин откажется
 * принимать, это станет известно здесь, а не в Figma.
 */

const FIXTURES = [
  'boxes', 'stacking', 'flex', 'text',
  'transformed', 'gradient', 'radial-gradient', 'inline-text', 'absolute-in-flex',
  'missing-font', 'dashed-border', 'text-transform',
] as const

for (const fixture of FIXTURES) {
  test(`бандл принимается валидатором: ${fixture}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(fixtureUrl(fixture))
    const captured = await captureScreen(page, 's0', 'Desktop')

    const bundle: Bundle = {
      format: 'h2d',
      version: IR_VERSION,
      capturedAt: new Date().toISOString(),
      url: fixtureUrl(fixture),
      title: fixture,
      userAgent: 'bundle.spec.ts',
      screens: [captured.screen],
      assets: [],
      fonts: captured.fonts,
      tokens: { variables: [], textStyles: [], paintStyles: [] },
      report: captured.report,
    }

    const verdict = parseBundle(bundle)
    expect(
      verdict.ok,
      verdict.ok ? '' : `валидатор отклонил живой захват:\n${verdict.error}`,
    ).toBe(true)
  })
}

test('бандл из пяти экранов принимается: идентификаторы узлов не сталкиваются', async ({ page }) => {
  // Уникальность идентификаторов требуется в пределах БАНДЛА, а не экрана,
  // и проверить это можно только собрав несколько экранов. Аллокатор живёт
  // внутри страницы, поэтому beginCapture вызывается один раз, а
  // captureScreen — пять.
  await page.goto(fixtureUrl('flex'))

  const screens = []
  const fonts = []
  const report = []
  let first = true

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    const captured = await captureScreen(
      page, `s-${size.width}`, size.name, { beginCapture: first },
    )
    first = false
    screens.push(captured.screen)
    fonts.push(...captured.fonts)
    report.push(...captured.report)
  }

  const bundle: Bundle = {
    format: 'h2d',
    version: IR_VERSION,
    capturedAt: new Date().toISOString(),
    url: fixtureUrl('flex'),
    title: 'flex',
    userAgent: 'bundle.spec.ts',
    screens,
    assets: [],
    fonts,
    tokens: { variables: [], textStyles: [], paintStyles: [] },
    report,
  }

  const verdict = parseBundle(bundle)
  expect(
    verdict.ok,
    verdict.ok ? '' : `бандл из пяти экранов отклонён:\n${verdict.error}`,
  ).toBe(true)
})
