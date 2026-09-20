import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { renderScreenToSvg, wrapSvgInHtml } from '@h2d/reference-renderer'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'
import { diffPng, shotOfScreen } from './helpers/diff.js'

/** Участвуют ЧЕТЫРЕ фикстуры из одиннадцати, и это не недосмотр.
 *
 *  `transformed/` и `gradient/` обязаны расходиться: трансформы и
 *  градиенты в этом плане не реализованы, рендер заведомо неверен, и
 *  подогнанный под него порог был бы ложью в чеклисте. Измерено:
 *  `gradient` расходится на 19–30%. Они проверяются `diagnostics.spec.ts`
 *  — там утверждается НАЛИЧИЕ кодов, объясняющих пропуск.
 *
 *  Остальные пять фикстур существуют ради утверждений об IR и в гейте
 *  не нужны: `inline-text`, `missing-font`, `text-transform` (210–247
 *  расходящихся пикселей) и `absolute-in-flex` (0) гоняют ровно те же
 *  ветки рендерера, что `text` и `flex`, а `dashed-border` — ветку
 *  заведомо ПРИБЛИЖЁННУЮ: рисунок штриха рендерер считает по своей
 *  формуле, а `border-style: double` сводит к сплошной линии. Место
 *  такой ветки рядом с `transformed`, то есть в проверке диагностик,
 *  а не в гейте точности. */
const FIXTURES = ['boxes', 'stacking', 'flex', 'text'] as const

const thresholdOf = (fixture: string): number => {
  const file = resolve(repoRoot, 'fixtures', fixture, 'threshold.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { maxDiffRatio: number }
  return parsed.maxDiffRatio
}

for (const fixture of FIXTURES) {
  for (const size of SIZES) {
    test(`pixel-diff: ${fixture} @ ${size.width}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(fixtureUrl(fixture))
      const { screen } = await captureScreen(page, `s-${size.width}`, size.name)

      const browserShot = await shotOfScreen(page, screen)

      const svg = renderScreenToSvg(screen)
      await page.setContent(wrapSvgInHtml(svg, screen.width, screen.height))
      const renderedShot = await shotOfScreen(page, screen)

      const out = resolve(
        repoRoot, 'test-results', `${fixture}-${size.width}.diff.png`,
      )
      const result = diffPng(browserShot, renderedShot, out)

      expect(
        result.ratio,
        `Расхождение ${(result.ratio * 100).toFixed(3)}% ` +
        `(${result.diffPixels} из ${result.total} пикселей). ` +
        `Карта различий: ${out}`,
      ).toBeLessThanOrEqual(thresholdOf(fixture))
    })
  }
}
