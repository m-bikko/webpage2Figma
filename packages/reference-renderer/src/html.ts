/** Оборачивает SVG в минимальную страницу для скриншота в Playwright.
 *  Обнулённые margin и заданный фон обязательны: иначе диффы поедут
 *  на смещении и на прозрачности. */
export const wrapSvgInHtml = (svg: string, width: number, height: number): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0}
    html,body{width:${width}px;height:${height}px;background:#fff}
    svg{display:block}
  </style></head><body>${svg}</body></html>`
