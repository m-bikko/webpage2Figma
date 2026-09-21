import { expect, test } from '@playwright/test'
import type { IrNode } from '@h2d/ir'
import { captureScreen, fixtureUrl } from './helpers/capture.js'

/** Проверка не про наш код, а про СРЕДУ. Она существует потому, что под
 *  `file://` Chrome считает документ непрозрачным источником: канва
 *  отравлена, `fetch` запрещён, и весь успешный путь работы с ассетами
 *  не выполняется ни разу. Тест на самом сериализаторе этого не покажет —
 *  он покажет ровно то же, что показал бы при полностью сломанном
 *  захвате: отказ. Поэтому условие среды проверяется отдельно и первым. */
test('среда фикстур отдаёт байты изображения', async ({ page }) => {
  await page.goto(fixtureUrl('image-fit'))
  const verdict = await page.evaluate(async () => {
    const img = document.querySelector('img')
    if (img === null) return 'в фикстуре нет <img>'
    try {
      const response = await fetch(img.currentSrc)
      const bytes = await response.arrayBuffer()
      return bytes.byteLength > 0 ? 'ok' : 'нулевая длина'
    } catch (error) {
      return `ОТКАЗ: ${String(error)}`
    }
  })
  expect(verdict).toBe('ok')
})

test('<img> становится узлом изображения, а не пустым фреймом', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 400 })
  await page.goto(fixtureUrl('image-fit'))
  const { screen, assetRequests } = await captureScreen(page, 's-800', 'Probe')

  const kinds: string[] = []
  const visit = (node: IrNode): void => {
    if (node.sourceTag === 'img') kinds.push(node.kind)
    node.children.forEach(visit)
  }
  visit(screen.root)

  expect(kinds).toEqual(['image', 'image', 'image', 'image'])
  /** Четыре <img> с одним src дают ОДНУ заявку: дедупликация по URL —
   *  требование инварианта asset.dangling, а не оптимизация. */
  expect(assetRequests).toHaveLength(1)
  expect(assetRequests[0]?.naturalWidth).toBe(64)
  expect(assetRequests[0]?.naturalHeight).toBe(32)
})

/** Незагруженный источник обязан стать ЗАГЛУШКОЙ с диагностикой.
 *  Пустой фрейм — ровно тот молчаливый откат, ради которого писался
 *  план: 27628 расходящихся пикселей без единой записи в отчёте. */
test('битый <img> становится заглушкой с диагностикой', async ({ page }) => {
  await page.goto(fixtureUrl('image-broken'))
  const { screen, report } = await captureScreen(page, 's', 'Probe')

  const kinds: string[] = []
  const visit = (node: IrNode): void => {
    if (node.sourceTag === 'img') kinds.push(node.kind)
    node.children.forEach(visit)
  }
  visit(screen.root)

  expect(kinds.every((kind) => kind === 'placeholder')).toBe(true)
  expect(report.map((d) => d.code)).toContain('fidelity.image-unreadable')
})
