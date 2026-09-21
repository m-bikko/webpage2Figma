import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { reconcileAssets, type Bundle } from '@h2d/ir'
import { IR_VERSION } from '@h2d/ir/version'
import { buildScene, sceneToIr } from '@h2d/plugin'
import { renderScreenToSvg, wrapSvgInHtml } from '@h2d/reference-renderer'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'
import { imagesFor } from './helpers/images.js'
import { diffPng, shotOfScreen } from './helpers/diff.js'

/** Круговой обход: IR → SceneSpec → IR' → SVG → сравнение с браузером.
 *
 *  Так проверяется плагин, которого негде запустить. Figma не
 *  стартует ни в CI, ни у меня, а заглушка `figma` проверяла бы нашу
 *  имитацию — ровно та ошибка, которую план 4 обошёл, унеся проверку в
 *  настоящий браузер.
 *
 *  Проверка имеет силу там, где `SceneSpec` устроен ИНАЧЕ, чем IR:
 *  узел-изображение стал рамкой с вложенным прямоугольником, масштаб
 *  вписан в поддерево, поворот сменил знак и единицы, положение
 *  поправлено на разную точку вращения. Где это переименование полей —
 *  не доказывает ничего, и вид, что доказывает, не делается. */

const FIXTURES = [
  'boxes', 'stacking', 'flex', 'gradient', 'transformed', 'blend', 'blur',
  'group-effects', 'transform-nested', 'blend-isolated', 'image-fit', 'image-bg', 'image-data',
] as const

type Threshold = { maxDiffPixels: number; maxDiffRatio: number }

/** Бюджет на СТРУКТУРНОЕ различие, а не на растеризацию.
 *
 *  Сцена устроена иначе, чем страница, и обязана быть: в Figma нет
 *  узлов-изображений, поэтому картинка становится отдельным
 *  прямоугольником внутри рамки. У рамки появляется ребёнок, значит она
 *  становится группой, а группа — это отдельный слой композиции. На
 *  дробной границе он даёт иное сглаживание края.
 *
 *  Измерено на всех 60 прогонах: максимум ОДИН пиксель, на фикстуре
 *  `image-bg` при 390px, где flex сжимает ячейки до дробных координат
 *  (левый край ячейки `contain` приходится на x = 81.05). Обычный
 *  pixel-diff на той же фикстуре даёт ноль — различие вносит именно
 *  группировка, которую требует Figma.
 *
 *  Бюджет равен измеренному максимуму, без запаса. Если он перестанет
 *  сходиться, это сигнал разбираться, а не поднимать число: ровно тем
 *  способом гейт и превращают в пустой. */
const SCENE_COMPOSITING_BUDGET = 1

const thresholdOf = (fixture: string): Threshold =>
  JSON.parse(readFileSync(
    resolve(repoRoot, 'fixtures', fixture, 'threshold.json'), 'utf8',
  )) as Threshold

for (const fixture of FIXTURES) {
  for (const size of SIZES) {
    test(`scene-diff: ${fixture} @ ${size.width}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(fixtureUrl(fixture))
      const { screen, report, fonts } = await captureScreen(page, `s-${size.width}`, size.name)
      const resolved = await page.evaluate(() => window.__h2d.resolvePendingAssets())
      const { screen: reconciled } =
        reconcileAssets(screen, new Set(resolved.assets.map((a) => a.id)))

      const browserShot = await shotOfScreen(page, screen)

      const bundle: Bundle = {
        format: 'h2d', version: IR_VERSION,
        capturedAt: '2026-09-21T00:00:00.000Z',
        url: fixtureUrl(fixture), title: fixture, userAgent: 'scene-diff',
        screens: [reconciled], assets: resolved.assets, fonts,
        tokens: { variables: [], textStyles: [], paintStyles: [] },
        report,
      }

      const scene = buildScene(bundle)
      const natural = new Map(resolved.assets.map(
        (asset) => [asset.id, { width: asset.width, height: asset.height }],
      ))
      const back = sceneToIr(scene.screens[0]!, natural)

      const svg = renderScreenToSvg(back, imagesFor(resolved))
      await page.setContent(wrapSvgInHtml(svg, screen.width, screen.height))
      const sceneShot = await shotOfScreen(page, screen)

      const out = resolve(repoRoot, 'test-results', `${fixture}-${size.width}.scene.png`)
      const result = diffPng(browserShot, sceneShot, out)
      const limit = thresholdOf(fixture)
      const budget = Math.max(limit.maxDiffPixels, SCENE_COMPOSITING_BUDGET)

      expect(
        result.diffPixels <= budget,
        `Сцена разошлась с браузером: ${result.diffPixels} из ${result.total} ` +
        `пикселей. Карта различий: ${out}`,
      ).toBe(true)
    })
  }
}
