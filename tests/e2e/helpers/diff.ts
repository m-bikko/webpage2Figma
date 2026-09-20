import { writeFileSync } from 'node:fs'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { Page } from '@playwright/test'
import type { Screen } from '@h2d/ir'

export type DiffResult = { diffPixels: number; total: number; ratio: number }

/** Снимает страницу РОВНО в габарите `Screen`.
 *
 *  `fullPage` сам по себе не годится: он растягивается до полного
 *  скроллируемого прямоугольника документа. У фикстуры `stacking` блок
 *  торчит за правый край вьюпорта, и на 390px браузер отдавал 500×844
 *  против 390×844 у рендера — сравнивать было нечего.
 *
 *  Приводится СКРИНШОТ, а не `Screen`. `Screen.width` — ширина вьюпорта,
 *  `Screen.height` — высота содержимого, но не меньше вьюпорта; это и
 *  есть определение кадра макета, и фрейм Figma такого размера обрежет
 *  вылезшее ровно так же, как обрезает `viewBox` у SVG. Обратная
 *  подгонка — привести `Screen` к скриншоту — сломала бы короткую
 *  страницу, где `fullPage` выше содержимого. */
export const shotOfScreen = (page: Page, screen: Screen): Promise<Buffer> =>
  page.screenshot({
    fullPage: true,
    clip: { x: 0, y: 0, width: screen.width, height: screen.height },
  })

/** Сравнивает два PNG одинакового размера. Разный размер — это провал
 *  сам по себе: значит IR отдал не ту высоту документа. */
export const diffPng = (
  expected: Buffer,
  actual: Buffer,
  diffOutPath: string,
): DiffResult => {
  const a = PNG.sync.read(expected)
  const b = PNG.sync.read(actual)

  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Размеры не совпадают: браузер ${a.width}×${a.height}, ` +
      `рендер из IR ${b.width}×${b.height}.`,
    )
  }

  const diff = new PNG({ width: a.width, height: a.height })
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.12,
    includeAA: false,
  })
  writeFileSync(diffOutPath, PNG.sync.write(diff))

  const total = a.width * a.height
  return { diffPixels, total, ratio: diffPixels / total }
}
