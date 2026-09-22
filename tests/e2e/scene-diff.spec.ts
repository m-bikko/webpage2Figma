import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { reconcileAssets, type Bundle, type IrNode } from '@w2f/ir'
import { IR_VERSION } from '@w2f/ir/version'
import { autoLayoutVerdict, buildScene, sceneToIr } from '@w2f/plugin'
import { renderScreenToSvg, wrapSvgInHtml } from '@w2f/reference-renderer'
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
  /** Вектор здесь ради БОКСА, а не рисунка: сам SVG проходит через
   *  строитель строкой и сравнивался бы сам с собой. Проверяются
   *  положение, размер и обёртка с фоном — их строитель считает, и
   *  ошибиться в них есть чем. */
  'vector',
  /** Многослойный фон проверяет СТОРОНУ ПЛАГИНА: несколько заливок
   *  становятся несколькими вложенными прямоугольниками, и потерять
   *  один из них легко — прежняя редакция брала только первый. */
  'background-layers',
  'svg-background',
  'text-box',
  /** Текст в круговом обходе НЕ БЫЛО никогда — и текстовый узел размером
   *  в элемент вместо строк, и фон, заменённый цветом текста, прожили
   *  незамеченными до первой текстовой фикстуры здесь. */
  'text', 'inline-text',
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
      const resolved = await page.evaluate(() => window.__w2f.resolvePendingAssets())
      const { screen: reconciled } =
        reconcileAssets(screen, new Set(resolved.assets.map((a) => a.id)))

      const browserShot = await shotOfScreen(page, screen)

      const bundle: Bundle = {
        format: 'w2f', version: IR_VERSION,
        capturedAt: '2026-09-21T00:00:00.000Z',
        url: fixtureUrl(fixture), title: fixture, userAgent: 'scene-diff',
        screens: [reconciled], assets: resolved.assets, fonts,
        tokens: { variables: [], textStyles: [], paintStyles: [] },
        report,
      }

      /** Векторные ассеты передаются строителю ОТДЕЛЬНО — так же, как
       *  это делает плагин: байты живут в файлах бандла, а строитель
       *  чист и архив сам не распаковывает. Без этого SVG-фон пошёл
       *  бы по растровой ветке, и круговой обход проверял бы не то,
       *  что поедет в Figma. */
      const svgTexts = new Map<string, string>()
      for (const asset of resolved.assets) {
        if (asset.mimeType !== 'image/svg+xml') continue
        const base64 = resolved.base64[asset.id]
        if (base64 === undefined) continue
        svgTexts.set(asset.id, Buffer.from(base64, 'base64').toString('utf8'))
      }

      const scene = buildScene(bundle, svgTexts)
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

/** Вердикт на НАСТОЯЩЕЙ раскладке, снятой браузером.
 *
 *  Юнит-тесты решателя строят прямоугольники руками; здесь их кладёт
 *  сам браузер, и совпадение означает, что модель флекса в решателе
 *  описывает реальность, а не наши представления о ней. */
test('auto-layout признаётся безопасным на настоящей флекс-раскладке', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('flex'))
  const { screen } = await captureScreen(page, 's-1440', 'D')

  /** Ищем узел, который браузер разложил флексом: у него есть режим и
   *  есть дети. Первый такой и проверяется. */
  const findFlex = (node: IrNode): IrNode | null => {
    if (node.layout.mode !== 'none' && node.children.length > 1) return node
    for (const child of node.children) {
      const found = findFlex(child)
      if (found !== null) return found
    }
    return null
  }

  const flex = findFlex(screen.root)
  expect(flex).not.toBeNull()
  if (flex === null) return

  const verdict = autoLayoutVerdict(flex)
  expect(
    verdict.safe,
    verdict.safe ? '' : `вердикт отказал: ${verdict.reason}`,
  ).toBe(true)
})
