import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { IR_VERSION, parseBundle, reconcileAssets, type Bundle } from '@w2f/ir'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'

/**
 * Собирает бандл из настоящего захвата и прогоняет через входную проверку
 * плагина Figma.
 *
 * Эта проверка существует потому, что её отсутствие было дырой, найденной
 * скриптом capture.mjs, а не тестами. Двадцать инвариантов в `@w2f/ir`
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

/** Список берётся ИЗ КАТАЛОГА, а не пишется руками.
 *
 *  Рукописный список молчит ровно тогда, когда нужен больше всего: при
 *  добавлении фикстуры о нём забывают, и новая возможность остаётся
 *  непроверенной валидатором. Это не догадка — так и случилось с
 *  векторами. Фикстура `vector/` прошла пиксельный гейт и круговой
 *  обход, а бандл через валидатор не прогонялся вовсе, и устаревший
 *  инвариант `deferred.undiagnosed` отвергал КАЖДЫЙ захват страницы с
 *  иконками. Нашлось это замером на живых страницах: три из шести —
 *  github.com, stripe.com, tailwindcss.com — валидатор отклонял.
 *
 *  Каталог врать не может: фикстура либо есть, либо её нет. */
const FIXTURES = readdirSync(resolve(repoRoot, 'fixtures'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

for (const fixture of FIXTURES) {
  test(`бандл принимается валидатором: ${fixture}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(fixtureUrl(fixture))
    const captured = await captureScreen(page, 's0', 'Desktop')

    /** Ассеты забираются и дерево приводится в согласие с доехавшим —
     *  ровно как в расширении. Без этого фикстуры с картинками
     *  отвергались бы по `asset.dangling`, то есть проверка спотыкалась
     *  бы о собственную неполноту вместо настоящих изъянов. */
    const resolved = await page.evaluate(() => window.__w2f.resolvePendingAssets())
    const available = new Set(resolved.assets.map((asset) => asset.id))
    const { screen } = reconcileAssets(captured.screen, available)

    const bundle: Bundle = {
      format: 'w2f',
      version: IR_VERSION,
      capturedAt: new Date().toISOString(),
      url: fixtureUrl(fixture),
      title: fixture,
      userAgent: 'bundle.spec.ts',
      screens: [screen],
      assets: resolved.assets,
      fonts: captured.fonts,
      tokens: { variables: [], textStyles: [], paintStyles: [] },
      report: [...captured.report, ...resolved.report],
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
    format: 'w2f',
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
