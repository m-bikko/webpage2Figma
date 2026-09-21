import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { reconcileAssets } from '@w2f/ir'
import { renderScreenToSvg, wrapSvgInHtml } from '@w2f/reference-renderer'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'
import { imagesFor } from './helpers/images.js'
import { diffPng, shotOfScreen } from './helpers/diff.js'

/** В гейте — БОЛЬШИНСТВО фикстур, и отсутствие каждой оставшейся
 *  объяснено ниже поимённо.
 *
 *  Числа в этом заголовке намеренно НЕ приводятся. Прежняя редакция
 *  начиналась словами «участвуют восемь фикстур из шестнадцати», и к
 *  моменту, когда их стало девятнадцать, фраза превратилась в ложь,
 *  которую никто не замечал: счёт в комментарии не проверяется ничем.
 *  Список ниже — единственный источник истины, и он проверяется сам
 *  собой.
 *
 *  Фикстура входит в гейт вместе с реализацией того, ради чего она
 *  заведена: `gradient/` вошла с линейными градиентами (до того
 *  расходилась на 19–30%), `transformed/` — с 2D-трансформами,
 *  `blend/` — с режимами наложения, `blur/` — с размытием слоя,
 *  `radial-gradient/` — с радиальными градиентами.
 *
 *  Про `radial-gradient/` стоит сказать отдельно, потому что её
 *  исключение держалось на НЕВЕРНОМ обосновании: «радиальному
 *  градиенту в SVG нет соответствия вовсе». Соответствие есть —
 *  `radialGradient`, — а эллипс выражается через него сжатием
 *  относительно центра. Фикстура вернулась в гейт с нулём
 *  расходящихся пикселей. Урок общий: исключение из гейта обязано
 *  перечитываться вместе с его обоснованием, иначе оно переживает
 *  причину.
 *
 *  Вне гейта остаются те, чей рендер заведомо приближён или чья
 *  картина в принципе невоспроизводима, — и каждая проверяется
 *  утверждениями об IR или о диагностиках:
 *
 *  `inline-text`, `missing-font`, `text-transform` и `absolute-in-flex`
 *  гоняют ровно те же ветки рендерера, что `text` и `flex`, и в гейте
 *  не нужны. `dashed-border` рисует штрих по своей формуле, а
 *  `border-style: double` сводит к сплошной линии. `video`,
 *  `image-cors` и `image-broken` показывают ЗАГЛУШКИ — красную
 *  пунктирную рамку с подписью, которую браузер не рисует никогда.
 *  `clip-partial` не переносит форму обрезки, `pseudo-element-flow`
 *  не переносит потоковые псевдоэлементы, `vector-id-collision`
 *  воспроизводит патологию самой страницы — во всех трёх случаях
 *  расхождение есть замысел, а не дефект, и поднятый под него порог
 *  сделал бы проверку пустой. */
const FIXTURES = [
  'boxes', 'stacking', 'flex', 'text', 'gradient', 'transformed', 'blend', 'blur', 'group-effects', 'transform-nested', 'blend-isolated',
  'image-fit', 'image-bg', 'image-data',
  'vector',
  'pseudo-stacking',
  'pseudo-element',
  'clip-hidden',
  'radial-gradient',
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
/** Фикстуры, НАМЕРЕННО оставленные вне гейта, с причиной у каждой.
 *
 *  Список существует ради теста ниже, а не ради чтения: он заставляет
 *  каждую новую фикстуру получить одно из двух — место в гейте или
 *  записанную причину, почему её там нет. Третьего, то есть тихого
 *  отсутствия, больше не предусмотрено.
 *
 *  Нужда в этом доказана дважды. `vector/` прошла мимо валидатора
 *  бандла, потому что тот вёл список руками. А `radial-gradient/`
 *  простояла вне гейта с обоснованием, которое к тому моменту стало
 *  неверным, — и заметить это было некому, потому что за соответствием
 *  списка и каталога никто не следил. */
const EXCLUDED: Record<string, string> = {
  'inline-text': 'гоняет те же ветки рендерера, что text',
  'missing-font': 'гоняет те же ветки рендерера, что text',
  'text-transform': 'гоняет те же ветки рендерера, что text',
  'absolute-in-flex': 'гоняет те же ветки рендерера, что flex',
  'dashed-border': 'рисунок штриха приближён, double сведён к сплошной',
  video: 'узел — заглушка, которую браузер не рисует никогда',
  'image-cors': 'браузер показывает картинку, байтов не отдаёт: заглушка',
  'image-broken': 'узел — заглушка, которую браузер не рисует никогда',
  'image-slow': 'проверяет ожидание загрузки, а не рисунок',
  'image-lazy': 'проверяет проход прокруткой, а не рисунок',
  'broken-transform': 'скос и 3D не переносятся, расхождение — замысел',
  'clip-partial': 'форма обрезки не переносится, расхождение — замысел',
  'pseudo-element-flow': 'потоковые псевдоэлементы неизмеримы, это замысел',
  'vector-id-collision': 'воспроизводит патологию самой страницы',
}

/** Каталог и два списка обязаны сходиться.
 *
 *  Без этой проверки фикстура может появиться и не попасть никуда —
 *  и тогда она не проверяет НИЧЕГО, выглядя при этом работой. */
test('каждая фикстура либо в гейте, либо исключена с причиной', () => {
  const onDisk = readdirSync(resolve(repoRoot, 'fixtures'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const covered = new Set<string>([...FIXTURES, ...Object.keys(EXCLUDED)])
  const missing = onDisk.filter((name) => !covered.has(name))
  expect(
    missing,
    `фикстуры без места: ${missing.join(', ')}. Добавь их в FIXTURES ` +
    `или в EXCLUDED с причиной — тихо отсутствовать нельзя.`,
  ).toEqual([])

  /** И обратно: список не должен помнить удалённые фикстуры. Мёртвая
   *  запись в EXCLUDED выглядит как объяснение, но не объясняет
   *  ничего. */
  const onDiskSet = new Set(onDisk)
  const stale = [...covered].filter((name) => !onDiskSet.has(name)).sort()
  expect(stale, `записи о несуществующих фикстурах: ${stale.join(', ')}`)
    .toEqual([])
})

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
