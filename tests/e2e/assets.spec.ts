import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IrNode } from '@w2f/ir'
import { captureScreen, fixtureUrl, repoRoot } from './helpers/capture.js'

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

test('байты ассета доезжают и совпадают с исходником побайтно', async ({ page }) => {
  await page.goto(fixtureUrl('image-fit'))
  await captureScreen(page, 's', 'Probe')
  const resolved = await page.evaluate(() => window.__w2f.resolvePendingAssets())

  expect(resolved.report).toEqual([])
  expect(resolved.assets).toHaveLength(1)
  const asset = resolved.assets[0]
  expect(asset?.mimeType).toBe('image/png')
  expect(asset?.width).toBe(64)
  expect(asset?.height).toBe(32)

  /** Байт в байт с файлом на диске. `fetch` отдаёт исходник, и
   *  переупаковки быть не должно: измерено — канва вернула бы 449 байт
   *  вместо 241. Проверка именно побайтная, потому что «картинка
   *  похожа» прошло бы и на переупакованной. */
  const onDisk = readFileSync(resolve(repoRoot, 'fixtures/image-fit/asset.png'))
  const got = Buffer.from(resolved.base64[asset?.id ?? ''] ?? '', 'base64')
  expect(got.equals(onDisk)).toBe(true)
})

test('недоступный источник даёт диагностику, а не тишину', async ({ page }) => {
  await page.goto(fixtureUrl('image-broken'))
  await captureScreen(page, 's', 'Probe')
  const resolved = await page.evaluate(() => window.__w2f.resolvePendingAssets())

  /** Битые <img> до заявок не доходят вовсе: их отсеивает синхронный
   *  обход, потому что `naturalWidth` нулевой. Заявок нет — и отчёт
   *  фазы разрешения пуст, а диагностика уже лежит в отчёте экрана. */
  expect(resolved.assets).toEqual([])
})

/** Доминирующий случай в жизни: картинка с чужого источника
 *  ОТРИСОВАЛАСЬ (изображения не ограничены CORS для показа), то есть
 *  заявка подана и узел стал изображением, — а байты `fetch` не отдаёт.
 *  Без второго источника этот путь не выполнялся бы ни разу: битый
 *  `<img>` до заявки не доходит вовсе, его отсекает синхронный обход. */
test('кросс-доменная картинка: узел есть, байтов нет, отчёт не пуст', async ({ page }) => {
  await page.goto(fixtureUrl('image-cors'))
  const { screen, assetRequests } = await captureScreen(page, 's', 'Probe')

  const kinds: string[] = []
  const visit = (node: IrNode): void => {
    if (node.sourceTag === 'img') kinds.push(node.kind)
    node.children.forEach(visit)
  }
  visit(screen.root)
  expect(kinds).toEqual(['image'])
  expect(assetRequests).toHaveLength(1)

  const resolved = await page.evaluate(() => window.__w2f.resolvePendingAssets())
  /** Ассета нет — и это намеренно. Узел на него ссылается, поэтому
   *  бандл отвергнет инвариант `asset.dangling`: в Figma такой узел
   *  дал бы пустой прямоугольник без всяких объяснений. */
  expect(resolved.assets).toEqual([])
  expect(resolved.report.map((d) => d.code)).toEqual(['fidelity.image-unreadable'])
  expect(resolved.report[0]?.needsPlaceholder).toBe(true)
  expect(resolved.report[0]?.nodeId).toBe(assetRequests[0]?.nodeId)
})

/** ПОЧЕМУ разбор заголовка `data:`-URL вообще нужен.
 *
 *  Синхронный обход узнаёт натуральный размер фоновой картинки приёмом
 *  `new Image(); img.src = url; img.complete`. Для УЖЕ отрисованного
 *  `data:`-фона он работает: браузер кеширует по строке URL, и
 *  `complete` истинно сразу. Для НЕЗНАКОМОГО — нет.
 *
 *  Проверка стоит здесь, а не в фикстуре, и это осознанно. Фикстура
 *  условие не воспроизводит: её фон отрисован, значит закеширован, и
 *  ветка разбора в ней не выполняется — слом «убрать разбор» не ронял
 *  её. Претендовать, что фикстура покрывает этот случай, было бы
 *  неправдой, поэтому условие проверяется там, где оно воспроизводимо.
 *
 *  Найдено на захвате настоящей страницы: 20 фоновых картинок из 28
 *  недоступных оказались `data:image/png`. */
test('незнакомый data:-URL не даёт размера через кеш, но даёт через заголовок',
  async ({ page }) => {
    await page.goto(fixtureUrl('image-data'))
    /** Захват нужен только ради впрыска сериализатора: его поверхность
     *  и есть предмет проверки. */
    await captureScreen(page, 's', 'Probe')

    /** PNG 33×17, которого на странице заведомо нет. */
    const unseen = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 33
      canvas.height = 17
      const context = canvas.getContext('2d')
      if (context === null) return null
      context.fillStyle = '#123456'
      context.fillRect(0, 0, 33, 17)
      return canvas.toDataURL('image/png')
    })
    expect(unseen).not.toBeNull()

    const viaCache = await page.evaluate((url) => {
      const probe = new Image()
      probe.src = url
      return { complete: probe.complete, width: probe.naturalWidth }
    }, unseen ?? '')
    expect(viaCache).toEqual({ complete: false, width: 0 })

    const viaHeader = await page.evaluate((url) => {
      const api = (globalThis as unknown as {
        __w2f: { sizeFromDataUrl?: (u: string) => { w: number; h: number } | null }
      }).__w2f
      return api.sizeFromDataUrl?.(url) ?? null
    }, unseen ?? '')
    expect(viaHeader).toEqual({ w: 33, h: 17 })
  })
