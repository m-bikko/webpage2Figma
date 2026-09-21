import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { reconcileAssets } from '@w2f/ir'
import { renderScreenToSvg, wrapSvgInHtml } from '@w2f/reference-renderer'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'
import { imagesFor } from './helpers/images.js'
import { diffPng, shotOfScreen } from './helpers/diff.js'

/** Участвуют ВОСЕМЬ фикстур из шестнадцати, и это не недосмотр.
 *
 *  `gradient/` вошла в гейт вместе с реализацией линейных градиентов:
 *  раньше она обязана была расходиться (измерено 19–30%), теперь её
 *  рендер верен и проверяется наравне с остальными. `transformed/` вошла
 *  тем же путём вместе с реализацией 2D-трансформ, `blend/` — вместе с
 *  режимами наложения, `blur/` — вместе с размытием слоя.
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
  'boxes', 'stacking', 'flex', 'text', 'gradient', 'transformed', 'blend', 'blur', 'group-effects', 'transform-nested', 'blend-isolated',
  'image-fit', 'image-bg', 'image-data',
  'vector',
  'pseudo-stacking',
  'pseudo-element',
  /** `image-cors` и `image-broken` здесь НЕ значатся намеренно. Её узлы — заглушки, а
   *  заглушка нарочно громкая: красная пунктирная рамка с подписью,
   *  которую браузер не рисует никогда. Расхождение измерено — 21155
   *  пикселей, — и оно не дефект, а замысел. Поднять порог до этого
   *  числа значило бы сделать проверку пустой, а это ровно тот способ
   *  сломать гейт, от которого защищает правило «пороги не
   *  подгоняются».
   *
   *  У `image-cors` причина та же, хотя выглядит иначе: браузер
   *  кросс-доменную картинку ПОКАЗЫВАЕТ (для показа CORS не мешает), а
   *  байты не отдаёт — значит у нас на её месте законно стоит заглушка.
   *  Совпасть эти две картины не могут в принципе.
   *
   *  Пиксельно сверять можно только то, что мы в состоянии
   *  воспроизвести. Обе фикстуры проверяются снапшотом IR в
   *  fidelity.spec и отдельными тестами в assets.spec. */
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
      /** Ассеты забираются ПОСЛЕ снимка: обход синхронен, а байты
       *  приходят асинхронно. Порядок обратный сломал бы ровно то
       *  разделение фаз, ради которого оно заведено. */
      const resolved = await page.evaluate(() => window.__w2f.resolvePendingAssets())
      /** Дерево приводится в согласие с тем, что реально доехало.
       *  Кросс-доменная картинка отрисовалась, значит узел построен, —
       *  а байтов нет, и без этого шага рендерер упал бы на ссылке в
       *  никуда. Именно так гейт и нашёл пробел. */
      const { screen: reconciled } =
        reconcileAssets(screen, new Set(resolved.assets.map((a) => a.id)))

      const browserShot = await shotOfScreen(page, screen)

      const svg = renderScreenToSvg(reconciled, imagesFor(resolved))
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
