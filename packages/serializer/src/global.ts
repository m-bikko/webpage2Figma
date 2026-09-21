import {
  createIdAllocator, emptyBundle, serializeScreen, type SerializeResult,
} from './serialize.js'
import type { IdAllocator } from './walk.js'
import { AssetRequests } from './assets.js'

/** Аллокатор идентификаторов живёт ВНУТРИ страницы и переживает несколько
 *  вызовов. Это не деталь реализации, а требование двух сторон сразу.
 *
 *  Контракт требует, чтобы идентификаторы узлов были уникальны в пределах
 *  бандла, а не экрана: на них ссылается отчёт. Пять экранов снимаются
 *  пятью вызовами по одной и той же вкладке, поэтому счётчик обязан
 *  сохраняться между ними.
 *
 *  Передать аллокатор снаружи нельзя: функции не пересекают границу
 *  `page.evaluate` и `chrome.scripting.executeScript`. Поэтому внешний API
 *  принимает только строки, а состояние держит здесь. */
let allocator: IdAllocator | null = null

/** Накопитель заявок на изображения живёт рядом с аллокатором узлов и по
 *  той же причине: идентификаторы ассетов обязаны быть уникальны в
 *  пределах БАНДЛА, а дедупликация по URL между экранами — требование
 *  инварианта `asset.dangling`, а не оптимизация. */
let requests: AssetRequests | null = null

/** Начинает новый захват: сбрасывает нумерацию узлов.
 *  Вызывается один раз перед серией экранов, а не перед каждым. */
const beginCapture = (): void => {
  allocator = createIdAllocator()
  requests = new AssetRequests()
}

/** Снимает один экран. Принимает только строки — см. комментарий выше.
 *  Если захват не был начат явно, аллокатор создаётся лениво: так
 *  одиночный снимок в тесте не требует лишнего вызова. */
const captureScreen = (id: string, name: string): SerializeResult => {
  if (allocator === null) allocator = createIdAllocator()
  if (requests === null) requests = new AssetRequests()
  return serializeScreen({ id, name, allocId: allocator, requests })
}

/** Точка входа IIFE-бандла: то, что Playwright и extension вызывают
 *  внутри страницы. */
const api = { beginCapture, captureScreen, emptyBundle }

declare global {
  interface Window {
    __h2d: typeof api
  }
}

window.__h2d = api
