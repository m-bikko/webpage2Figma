import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { renderScreenToSvg, wrapSvgInHtml } from '@h2d/reference-renderer'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'
import { diffPng, shotOfScreen } from './helpers/diff.js'

/** Участвуют СЕМЬ фикстур из четырнадцати, и это не недосмотр.
 *
 *  `gradient/` вошла в гейт вместе с реализацией линейных градиентов:
 *  раньше она обязана была расходиться (измерено 19–30%), теперь её
 *  рендер верен и проверяется наравне с остальными. `transformed/` вошла
 *  тем же путём вместе с реализацией 2D-трансформ, `blend/` — вместе с
 *  режимами наложения.
 *
 *  `radial-gradient/` обязана расходиться: радиальному градиенту в SVG нет
 *  соответствия вовсе, поэтому рендер заведомо неверен и подогнанный под
 *  него порог был бы ложью в чеклисте. Она проверяется
 *  `diagnostics.spec.ts` — там утверждается НАЛИЧИЕ кода, объясняющего
 *  пропуск.
 *
 *  Остальные пять фикстур существуют ради утверждений об IR и в гейте
 *  не нужны: `inline-text`, `missing-font`, `text-transform` (210–247
 *  расходящихся пикселей) и `absolute-in-flex` (0) гоняют ровно те же
 *  ветки рендерера, что `text` и `flex`, а `dashed-border` — ветку
 *  заведомо ПРИБЛИЖЁННУЮ: рисунок штриха рендерер считает по своей
 *  формуле, а `border-style: double` сводит к сплошной линии. Место
 *  такой ветки рядом с `radial-gradient`, то есть в проверке диагностик,
 *  а не в гейте точности. */
const FIXTURES = [
  'boxes', 'stacking', 'flex', 'text', 'gradient', 'transformed', 'blend',
] as const

/** Порог двухчастный, и главная часть — АБСОЛЮТНАЯ.
 *
 *  Доля от площади как единственная мера не работает: отключение внутренней
 *  тени даёт 1234 неверных пикселя, то есть 0.1% изображения в миллион точек,
 *  и проходит любой разумный относительный порог. Измерено при исполнении
 *  Task 14: три дефекта из шести, найденных в этой задаче, гейт с одной
 *  относительной метрикой не поймал бы.
 *
 *  Поэтому бюджет задан в пикселях, выведен из измеренного факта плюс запас на
 *  растеризацию, а доля оставлена вторым рубежом — она ловит случай, когда
 *  расхождение размазано по всему изображению. */
type Threshold = { maxDiffPixels: number; maxDiffRatio: number }

const thresholdOf = (fixture: string): Threshold => {
  const file = resolve(repoRoot, 'fixtures', fixture, 'threshold.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Threshold
  return parsed
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

      const limit = thresholdOf(fixture)
      const detail =
        `${result.diffPixels} из ${result.total} пикселей ` +
        `(${(result.ratio * 100).toFixed(3)}%). Карта различий: ${out}`

      expect(
        result.diffPixels,
        `Расхождение превысило бюджет ${limit.maxDiffPixels} пикселей: ${detail}`,
      ).toBeLessThanOrEqual(limit.maxDiffPixels)

      expect(
        result.ratio,
        `Расхождение размазано по изображению: ${detail}`,
      ).toBeLessThanOrEqual(limit.maxDiffRatio)
    })
  }
}
