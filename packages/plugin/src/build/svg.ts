/** Подгонка размера векторного ассета под место, где он нарисован.
 *
 *  Фоновый SVG несёт СВОИ `width`/`height` — те, что стоят в файле, —
 *  а `background-size` может задать любые другие. Без подстановки
 *  иконка приедет своего исходного размера, и это заметили не глаза, а
 *  круговой обход: 1746 расходящихся пикселей на фикстуре
 *  `svg-background`, где одна и та же иконка стоит в 48 и в 70
 *  пикселей.
 *
 *  Правится ТОЛЬКО корневой тег, и только два атрибута. `viewBox`
 *  сохраняется нетронутым: он задаёт систему координат содержимого, и
 *  именно благодаря ему замена размеров масштабирует рисунок, а не
 *  обрезает его. */

const ROOT_TAG = /^(\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg)\b([^>]*)(>)/i

const withAttribute = (attrs: string, name: string, value: string): string => {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i')
  const replacement = ` ${name}="${value}"`
  return pattern.test(attrs)
    ? attrs.replace(pattern, replacement)
    : attrs + replacement
}

export const resizeSvg = (svg: string, width: number, height: number): string => {
  const match = ROOT_TAG.exec(svg)
  /** Корневого тега не нашлось — строка не похожа на SVG. Возвращается
   *  как есть: подставлять размеры в неизвестно что хуже, чем отдать
   *  нетронутым, а о непригодном содержимом скажет сам импортёр
   *  Figma. */
  if (match === null) return svg

  const [, head = '', attrs = '', close = '>'] = match
  let next = withAttribute(attrs, 'width', String(width))
  next = withAttribute(next, 'height', String(height))
  return head + next + close + svg.slice(match[0].length)
}
