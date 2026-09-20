import { createIdAllocator, emptyBundle, serializeScreen } from './serialize.js'

/** Точка входа IIFE-бандла: то, что Playwright и extension вызывают
 *  внутри страницы через `page.evaluate` / `executeScript`. */
const api = { serializeScreen, emptyBundle, createIdAllocator }

declare global {
  interface Window {
    __h2d: typeof api
  }
}

window.__h2d = api
