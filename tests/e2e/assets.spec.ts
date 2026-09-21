import { expect, test } from '@playwright/test'
import { fixtureUrl } from './helpers/capture.js'

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
