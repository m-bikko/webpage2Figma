import type {
  Blur, Corner, Gradient, ImageRef, IrNode, Rect, Rgba8, Screen, Shadow, Sides,
  Stroke,
  TextRun,
} from '@w2f/ir'

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const rgb = (color: Rgba8): string => `rgb(${color.r},${color.g},${color.b})`

const uniformCorner = (corner: Corner): number | null =>
  corner.tl === corner.tr && corner.tr === corner.br && corner.br === corner.bl
    ? corner.tl
    : null

/** Прямоугольник с разными радиусами углов не выражается через `<rect rx>`,
 *  поэтому строится путь с четырьмя дугами. */
const cornerPath = (rect: Rect, c: Corner): string => {
  const { x, y, w, h } = rect
  return [
    `M ${x + c.tl} ${y}`,
    `H ${x + w - c.tr}`,
    c.tr > 0 ? `A ${c.tr} ${c.tr} 0 0 1 ${x + w} ${y + c.tr}` : '',
    `V ${y + h - c.br}`,
    c.br > 0 ? `A ${c.br} ${c.br} 0 0 1 ${x + w - c.br} ${y + h}` : '',
    `H ${x + c.bl}`,
    c.bl > 0 ? `A ${c.bl} ${c.bl} 0 0 1 ${x} ${y + h - c.bl}` : '',
    `V ${y + c.tl}`,
    c.tl > 0 ? `A ${c.tl} ${c.tl} 0 0 1 ${x + c.tl} ${y}` : '',
    'Z',
  ].filter((segment) => segment !== '').join(' ')
}

const maxWeight = (stroke: Stroke): number => Math.max(
  stroke.weight.top, stroke.weight.right, stroke.weight.bottom, stroke.weight.left,
)

/** Все четыре стороны одной толщины. Разделение существенно: одиночная
 *  обводка SVG имеет ровно одну ширину, поэтому неравные стороны через
 *  неё невыразимы в принципе и требуют другого способа рисования. */
const hasUniformWeight = (stroke: Stroke): boolean =>
  stroke.weight.top === stroke.weight.right
  && stroke.weight.right === stroke.weight.bottom
  && stroke.weight.bottom === stroke.weight.left

/** Прямоугольник, сжатый на толщину границ — это padding box, он же
 *  внутренний край рамки и он же край обрезки `overflow: hidden`. */
const insetBySides = (rect: Rect, sides: Sides): Rect => ({
  x: rect.x + sides.left,
  y: rect.y + sides.top,
  w: Math.max(0, rect.w - sides.left - sides.right),
  h: Math.max(0, rect.h - sides.top - sides.bottom),
})

/** Радиусы внутреннего края рамки. CSS уменьшает радиус на толщину
 *  прилегающей границы; берётся ГОРИЗОНТАЛЬНАЯ сторона — та же
 *  упрощающая договорённость, что и в `isEllipticalCorner` сериализатора,
 *  где эллиптический угол сводится к горизонтальному радиусу. */
const insetCorner = (corner: Corner, sides: Sides): Corner => ({
  tl: Math.max(0, corner.tl - sides.left),
  tr: Math.max(0, corner.tr - sides.right),
  br: Math.max(0, corner.br - sides.right),
  bl: Math.max(0, corner.bl - sides.left),
})

/** SVG рисует обводку ПО ЦЕНТРУ пути, CSS — ВНУТРЬ бокса, и контракт
 *  фиксирует это как `align: 'inside'`. Без сжатия на половину толщины
 *  каждый элемент с границей давал бы расхождение в pixel-diff. */
const insetRect = (rect: Rect, stroke: Stroke | null): Rect => {
  if (stroke === null) return rect
  const half = maxWeight(stroke) / 2
  return {
    x: rect.x + half, y: rect.y + half,
    w: Math.max(0, rect.w - half * 2), h: Math.max(0, rect.h - half * 2),
  }
}

const dashArray = (stroke: Stroke): string => {
  const w = maxWeight(stroke)
  if (stroke.style === 'dashed') return ` stroke-dasharray="${w * 3} ${w * 2}"`
  if (stroke.style === 'dotted') return ` stroke-dasharray="${w} ${w}"`
  return ''
}

/** Внутренняя тень средствами SVG.
 *
 *  Прямого примитива для неё нет, поэтому собирается вручную:
 *  1. альфа исходной фигуры ИНВЕРТИРУЕТСЯ — снаружи непрозрачно,
 *     внутри пусто;
 *  2. инверсия размывается и сдвигается — получается «свет извне»,
 *     затекающий внутрь;
 *  3. заливается цветом тени;
 *  4. обрезается по исходной альфе, чтобы тень осталась ВНУТРИ фигуры.
 *
 *  Шаг 1 имеет смысл только потому, что область фильтра заметно больше
 *  фигуры: инверсия непрозрачна ровно в пределах этой области, и её
 *  запаса должно хватать на размытие со сдвигом. */
const innerShadowPrimitives = (shadow: Shadow, out: string): string =>
  `<feComponentTransfer in="SourceAlpha" result="${out}-inv">` +
  `<feFuncA type="table" tableValues="1 0"/></feComponentTransfer>` +
  `<feGaussianBlur in="${out}-inv" stdDeviation="${shadow.blur / 2}" ` +
  `result="${out}-blur"/>` +
  `<feOffset in="${out}-blur" dx="${shadow.offsetX}" dy="${shadow.offsetY}" ` +
  `result="${out}-off"/>` +
  `<feFlood flood-color="${rgb(shadow.color)}" ` +
  `flood-opacity="${shadow.color.a}" result="${out}-color"/>` +
  `<feComposite in="${out}-color" in2="${out}-off" operator="in" ` +
  `result="${out}-shade"/>` +
  `<feComposite in="${out}-shade" in2="SourceAlpha" operator="in" result="${out}"/>`

/** Область фильтра намеренно велика: тень со сдвигом и размытием легко
 *  выходит за габарит фигуры, а всё, что вышло за область, обрезается
 *  без предупреждения. Для внутренней тени тот же запас нужен с другой
 *  стороны — там в этой области живёт инвертированная альфа. */
const FILTER_REGION = 'x="-75%" y="-75%" width="250%" height="250%"'

/** Фильтры SVG по умолчанию считают в linearRGB, а CSS композитит тень
 *  в sRGB. Без переключения градиент тени идёт по другой кривой, и
 *  pixel-diff показывал полосу у верхнего края внутренней тени, где
 *  расхождение накапливается сильнее всего. */
const FILTER_SPACE = 'color-interpolation-filters="sRGB"'

/** Размытие слоя, то есть CSS `filter: blur()`.
 *
 *  `stdDeviation` берётся из контракта БЕЗ деления, и это главное отличие
 *  от теней рядом: CSS `blur(Npx)` задаёт стандартное отклонение НАПРЯМУЮ,
 *  тогда как радиус `box-shadow` вдвое больше отклонения — отсюда `/ 2` в
 *  `innerShadowPrimitives` и в цепочке `feDropShadow`. Перепутать легко, а
 *  ошибка выглядит правдоподобно: размытие просто вдвое сильнее или слабее
 *  нужного, и без pixel-diff это не отличить от «так и задумано».
 *
 *  Примитив ставится в КОНЕЦ цепочки, а не в начало. План предполагал
 *  начало, но цепочка теней там уже занята: первая `feDropShadow` явно
 *  берёт `in="SourceGraphic"`, а внутренняя тень — `in="SourceAlpha"`,
 *  поэтому размытие, поставленное первым, осталось бы НИ КЕМ не
 *  использованным результатом — то есть молча потерялось бы на узле, где
 *  есть и тень, и размытие. Конец цепочки вдобавок соответствует CSS: там
 *  `filter` применяется к УЖЕ отрисованному элементу вместе с его
 *  `box-shadow`, а не к содержимому под тенью. */
const layerBlurPrimitive = (blur: Blur | null): string =>
  blur !== null && blur.layer > 0
    ? `<feGaussianBlur stdDeviation="${blur.layer}"/>`
    : ''

const effectsFilter = (id: string, shadows: Shadow[], blur: Blur | null): string => {
  const outer = shadows.filter((shadow) => shadow.kind === 'outer')
  const inner = shadows.filter((shadow) => shadow.kind === 'inner')
  const layerBlur = layerBlurPrimitive(blur)
  if (outer.length === 0 && inner.length === 0) {
    return layerBlur === ''
      ? ''
      : `<filter id="${id}" ${FILTER_REGION} ${FILTER_SPACE}>${layerBlur}</filter>`
  }

  /** Внешние тени цепочкой: каждый `feDropShadow` без `in` берёт
   *  результат предыдущего, поэтому тени накладываются одна на другую,
   *  и в конце цепочки лежит исходная фигура со всеми тенями под ней. */
  const outerParts = outer.map((shadow, index) =>
    `<feDropShadow ${index === 0 ? 'in="SourceGraphic" ' : ''}` +
    `dx="${shadow.offsetX}" dy="${shadow.offsetY}" ` +
    `stdDeviation="${shadow.blur / 2}" flood-color="${rgb(shadow.color)}" ` +
    `flood-opacity="${shadow.color.a}" result="outer${index}"/>`,
  ).join('')
  const base = outer.length === 0 ? 'SourceGraphic' : `outer${outer.length - 1}`

  if (inner.length === 0) {
    return (
      `<filter id="${id}" ${FILTER_REGION} ${FILTER_SPACE}>` +
      `${outerParts}${layerBlur}</filter>`
    )
  }

  const innerParts = inner
    .map((shadow, index) => innerShadowPrimitives(shadow, `inner${index}`))
    .join('')
  /** Внутренние тени кладутся ПОВЕРХ фигуры — они и есть затенение
   *  её собственной поверхности, а не подложка под ней. */
  const merge =
    `<feMerge><feMergeNode in="${base}"/>` +
    inner.map((_, index) => `<feMergeNode in="inner${index}"/>`).join('') +
    `</feMerge>`

  return (
    `<filter id="${id}" ${FILTER_REGION} ${FILTER_SPACE}>` +
    `${outerParts}${innerParts}${merge}${layerBlur}</filter>`
  )
}

/** Рамка с РАЗНЫМИ толщинами сторон.
 *
 *  Одиночная обводка SVG имеет одну ширину на весь путь, поэтому
 *  `border-top: 2px; border-bottom: 8px` через неё невыразим: рендерер
 *  брал максимум и рисовал 8px со всех сторон. Рамка собирается как
 *  ЗАЛИВКА кольца — внешний контур минус внутренний, правило
 *  `evenodd`, — и тогда каждая сторона получает свою толщину точно. */
const borderRing = (node: IrNode, stroke: Stroke): string => {
  const outer = cornerPath(node.rect, node.style.corner)
  const innerRect = insetBySides(node.rect, stroke.weight)
  const inner = cornerPath(innerRect, insetCorner(node.style.corner, stroke.weight))
  return (
    `<path d="${outer} ${inner}" fill-rule="evenodd" ` +
    `fill="${rgb(stroke.color)}" fill-opacity="${stroke.color.a}"/>`
  )
}

/** Градиент в АБСОЛЮТНЫХ координатах, а не в `objectBoundingBox`.
 *
 *  `objectBoundingBox` масштабирует систему координат неравномерно и
 *  искажает угол на неквадратном боксе: градиент под 45° на широком блоке
 *  наклонился бы не так, как в браузере. `userSpaceOnUse` от этого свободен,
 *  поэтому нормализованные ручки контракта переводятся здесь в пиксели. */
const gradientDef = (id: string, gradient: Gradient, rect: Rect): string => {
  const stops = gradient.stops
    .map((stop) =>
      `<stop offset="${stop.offset}" stop-color="${rgb(stop.color)}" ` +
      `stop-opacity="${stop.color.a}"/>`,
    )
    .join('')

  if (gradient.kind === 'linear') {
    const x1 = rect.x + gradient.from.x * rect.w
    const y1 = rect.y + gradient.from.y * rect.h
    const x2 = rect.x + gradient.to.x * rect.w
    const y2 = rect.y + gradient.to.y * rect.h
    return (
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`
    )
  }

  /** Эллипс выражается КРУГОМ плюс масштабирование.
   *
   *  У `<radialGradient>` радиус один: `r` задаёт окружность. Эллипс
   *  CSS — форма по умолчанию — получается сжатием этой окружности по
   *  вертикали, и сжимать надо ОТНОСИТЕЛЬНО ЦЕНТРА, иначе градиент
   *  уедет тем сильнее, чем дальше центр от нуля координат. Отсюда
   *  тройка translate-scale-translate: увести центр в ноль, сжать,
   *  вернуть.
   *
   *  Радиусом круга берётся горизонтальный, а вертикальный
   *  отрабатывает масштабом — выбор безразличен, но он обязан быть
   *  одним и тем же в обеих ветках, иначе масштаб посчитается от
   *  другой величины. */
  const cx = rect.x + gradient.center.x * rect.w
  const cy = rect.y + gradient.center.y * rect.h
  const rx = gradient.radius.x * rect.w
  const ry = gradient.radius.y * rect.h
  const squeeze = ry / rx
  const transform =
    `translate(${cx} ${cy}) scale(1 ${squeeze}) translate(${-cx} ${-cy})`
  return (
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `cx="${cx}" cy="${cy}" r="${rx}" ` +
    `gradientTransform="${transform}">${stops}</radialGradient>`
  )
}

/** Одна фигура: прямоугольник, если все углы равны, иначе путь с дугами.
 *  Вынесено отдельно потому, что узел может дать ДВЕ фигуры — цвет и
 *  градиент поверх него — и обе обязаны иметь одинаковую геометрию. */
const shapeFor = (
  node: IrNode,
  rect: Rect,
  corner: Corner,
  attrs: string[],
  dash: string,
): string => {
  const uniform = uniformCorner(corner)
  if (uniform === null) {
    return `<path d="${cornerPath(rect, corner)}" ${attrs.join(' ')}${dash}/>`
  }
  const rx = uniform > 0 ? ` rx="${uniform}"` : ''
  return (
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"` +
    `${rx} ${attrs.join(' ')}${dash}/>`
  )
}

/** Картинка, готовая к вставке в SVG. `dataUri`, а не путь к файлу:
 *  SVG рендерится в отрыве от бандла, и внешняя ссылка не разрешилась
 *  бы — растеризатор просто нарисовал бы пустоту, молча. */
export type RenderImage = { dataUri: string; width: number; height: number }

/** То, что протаскивается сквозь всю отрисовку. Раньше это был голый
 *  список `defs`; ассеты добавили второе такое же сквозное значение, и
 *  тащить их парой параметров значило бы повторять одну и ту же связку
 *  в каждой сигнатуре. */
type RenderCtx = {
  defs: string[]
  images: ReadonlyMap<string, RenderImage>
}

/** Тег изображения. Общий для узла `kind: 'image'` и для заливки
 *  `Fill{kind:'image'}` намеренно: два пути легко разъезжаются, и тогда
 *  фон теряет обрезку или плитку, а узел нет.
 *
 *  Отсутствующий ассет БРОСАЕТ, а не рисует пустоту. Дыра без следа в
 *  SVG неотличима от прозрачного пикселя: pixel-diff показал бы
 *  расхождение, не назвав причины, а валидатор бандла сюда не дошёл бы
 *  вовсе. Пусть падает громко и по имени. */
const imageTag = (
  ref: ImageRef,
  rect: Rect,
  nodeId: string,
  ctx: RenderCtx,
): string => {
  const image = ctx.images.get(ref.assetId)
  if (image === undefined) {
    throw new Error(
      `Ассет "${ref.assetId}" не передан рендереру (узел ${nodeId}). ` +
      `Пустое место в SVG было бы неотличимо от прозрачного пикселя.`,
    )
  }
  const { placement } = ref
  const w = image.width * placement.scaleX
  const h = image.height * placement.scaleY

  /** Обрезка ставится ТОЛЬКО когда есть что обрезать.
   *
   *  При `cover` нарисованный размер больше бокса, и без обрезки
   *  картинка залезла бы на соседей. Но когда она помещается целиком,
   *  клип не нужен — а не бесплатен: если его границы совпадают с
   *  границами самой картинки, он срезает сглаженный край. Проявилось,
   *  когда изображение стало ОТДЕЛЬНЫМ узлом (сцена плагина): его
   *  `rect` равен нарисованному прямоугольнику, клип ложился ровно по
   *  краю и давал 12 одиночных расходящихся пикселей там, где на пути
   *  с заливкой их было ноль. */
  const overflows =
    placement.offsetX < 0 || placement.offsetY < 0 ||
    placement.offsetX + w > rect.w || placement.offsetY + h > rect.h

  const clipId = `clip-${nodeId}-${ref.assetId}`
  if (overflows) {
    ctx.defs.push(
      `<clipPath id="${clipId}"><rect x="${rect.x}" y="${rect.y}" ` +
      `width="${rect.w}" height="${rect.h}"/></clipPath>`,
    )
  }

  if (placement.mode === 'tile') {
    const patternId = `tile-${nodeId}-${ref.assetId}`
    ctx.defs.push(
      `<pattern id="${patternId}" patternUnits="userSpaceOnUse" ` +
      `x="${rect.x + placement.offsetX}" y="${rect.y + placement.offsetY}" ` +
      `width="${w}" height="${h}">` +
      `<image href="${image.dataUri}" width="${w}" height="${h}" ` +
      `preserveAspectRatio="none"/></pattern>`,
    )
    return (
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" ` +
      `fill="url(#${patternId})"/>`
    )
  }

  const open = overflows ? `<g clip-path="url(#${clipId})">` : '<g>'
  return (
    open +
    `<image href="${image.dataUri}" ` +
    `x="${rect.x + placement.offsetX}" y="${rect.y + placement.offsetY}" ` +
    `width="${w}" height="${h}" ` +
    /** Пропорции УЖЕ учтены в scaleX/scaleY. Дефолтный
     *  `preserveAspectRatio` подогнал бы картинку вторым проходом и
     *  перечеркнул бы растяжение при CSS `object-fit: fill`. */
    `preserveAspectRatio="none"/></g>`
  )
}

const renderBox = (node: IrNode, ctx: RenderCtx): string => {
  const { style } = node
  const hasShadow = style.shadows.length > 0
  /** Фильтр нужен и ради теней, и ради размытия слоя — оба живут в одном
   *  `<filter>`, потому что SVG допускает только один на элемент. */
  const needsFilter = hasShadow || style.blur !== null
  if (style.fills.length === 0 && style.stroke === null && !hasShadow) return ''

  /** Неравные стороны рисуются кольцом, а не обводкой; тогда заливка
   *  занимает ВЕСЬ border box, как в CSS с `background-clip: border-box`,
   *  и кольцо ложится поверх неё. */
  const ringed = style.stroke !== null
    && !hasUniformWeight(style.stroke)
    && style.stroke.style === 'solid'

  const rect = insetRect(node.rect, ringed ? null : style.stroke)

  /** ВСЕ заливки рисуются стопкой, в порядке массива — снизу вверх,
   *  как их красит браузер.
   *
   *  Прежняя редакция брала ПЕРВЫЙ градиент и ПЕРВОЕ изображение через
   *  `find`, то есть умела ровно по одному каждого вида. Многослойный
   *  фон — градиент поверх фотографии, два градиента друг на друге —
   *  рисовался одним слоем, и расхождение доходило до 596913 пикселей
   *  на фикстуре `background-layers`.
   *
   *  Первая заливка достаётся САМОЙ фигуре, потому что на ней же
   *  висят обводка и эффекты; остальные ложатся поверх отдельными
   *  фигурами той же геометрии. У одного элемента SVG заливка может
   *  быть только одна. */
  const over: string[] = []
  let fillAttrs: string[] | null = null

  for (const [index, fill] of style.fills.entries()) {
    if (fill.kind === 'image') {
      /** Картинка — не заливка фигуры, а отдельный элемент со своей
       *  геометрией размещения.
       *
       *  `node.rect`, а НЕ `rect`: последний ужат на половину обводки,
       *  чтобы SVG рисовал её по центру пути, как CSS рисует внутрь.
       *  Смещения в `placement` посчитаны от border box — сложить их с
       *  ужатым прямоугольником значит прибавить половину рамки
       *  дважды. Измерено на фикстуре `image-bg`: 1365 расходящихся
       *  пикселей, ВСЕ в единственной ячейке с рамкой.
       *
       *  Border box верен и для обрезки: `background-clip` по
       *  умолчанию `border-box`, то есть фон заходит ПОД рамку. */
      over.push(imageTag(fill.ref, node.rect, node.id, ctx))
      continue
    }

    const own: string[] = []
    if (fill.kind === 'solid') {
      own.push(`fill="${rgb(fill.color)}"`, `fill-opacity="${fill.color.a}"`)
    } else {
      /** Идентификатор несёт номер слоя: без него два градиента на
       *  одном узле получили бы одно имя, и второй молча покрасился
       *  бы первым. */
      const gradientId = `grad-${node.id}-${index}`
      ctx.defs.push(gradientDef(gradientId, fill.gradient, rect))
      own.push(`fill="url(#${gradientId})"`)
    }

    if (fillAttrs === null) fillAttrs = own
    else over.push(shapeFor(node, rect, style.corner, own, ''))
  }

  const attrs: string[] = [...(fillAttrs ?? ['fill="none"'])]

  if (style.stroke !== null && !ringed) {
    attrs.push(
      `stroke="${rgb(style.stroke.color)}"`,
      `stroke-opacity="${style.stroke.color.a}"`,
      `stroke-width="${maxWeight(style.stroke)}"`,
    )
  }
  if (style.opacity < 1) attrs.push(`opacity="${style.opacity}"`)
  /** SVG принимает режим наложения как свойство стиля, не как атрибут
   *  презентации, поэтому он идёт через `style=`. Значения CSS и SVG
   *  совпадают по написанию, так что перевод не нужен. */
  if (style.blend !== 'normal') {
    attrs.push(`style="mix-blend-mode:${style.blend}"`)
  }
  if (needsFilter) {
    const filterId = `fx-${node.id}`
    const filter = effectsFilter(filterId, style.shadows, style.blur)
    /** Пустая строка означает, что эффектов не оказалось (например
     *  `blur: { layer: 0, background: 4 }` — фоновое размытие рендерер не
     *  воспроизводит). Ссылаться на несуществующий фильтр нельзя: браузер
     *  тогда не рисует элемент вовсе, и узел исчез бы молча. */
    if (filter !== '') {
      ctx.defs.push(filter)
      attrs.push(`filter="url(#${filterId})"`)
    }
  }

  const ring = ringed && style.stroke !== null ? borderRing(node, style.stroke) : ''
  const dash = style.stroke === null || ringed ? '' : dashArray(style.stroke)
  /** Рамка идёт ПОСЛЕДНЕЙ: в CSS граница рисуется поверх всех слоёв
   *  фона. */
  return shapeFor(node, rect, style.corner, attrs, dash) + over.join('') + ring
}

/** Базовая линия ставится из бокса строки: `y + (h + fontSize * R) / 2`.
 *
 *  `LineBox.h` — это НЕ line-height, а высота шрифтового бокса, которую
 *  отдаёт `Range.getClientRects()`: ascent + descent. Подставив
 *  `h = (asc + desc) * fontSize` в формулу и потребовав, чтобы она дала
 *  ровно `y + asc * fontSize`, получаем `R = asc - desc` — коэффициент
 *  перестаёт быть подобранным числом и становится метрикой шрифта.
 *
 *  Для Arial (hhea: ascender 1854/2048, descender 434/2048) это
 *  0.9053 - 0.2119 = 0.6934. Прежнее значение 0.72 опускало базовую
 *  линию примерно на 0.013 кегля: у глифов сдвиг тонул в сглаживании,
 *  но подчёркивание — резкая горизонтальная линия — показывало его
 *  прямо, и pixel-diff фикстуры `text` падал с 1411 до 633 пикселей
 *  от одной этой правки.
 *
 *  Значение шрифтозависимо, а метрик шрифта в IR нет: ставить сюда
 *  величину для конкретного семейства — сознательное упрощение плана 1,
 *  и вся неточность собрана в ОДНОЙ именованной константе. */
const BASELINE_RATIO = 0.6934

/** `decoration` снимается сериализатором, но до этого нигде не рисовалась:
 *  подчёркнутая строка приезжала без линии, и pixel-diff показывал ровно
 *  её отсутствие. Имена в CSS и в контракте не совпадают, поэтому нужна
 *  явная таблица, а не подстановка значения как есть. */
const DECORATION_ATTR: Record<TextRun['decoration'], string> = {
  none: '',
  underline: ' text-decoration="underline"',
  strikethrough: ' text-decoration="line-through"',
}

/** Боксы строк заданы ОТНОСИТЕЛЬНО `rect` своего узла — в той же системе,
 *  в которой дети выражены относительно родителя. Поэтому к ним
 *  складывается абсолютное положение узла, которое к моменту вызова уже
 *  лежит в `node.rect`: `renderSubtree` передаёт сюда узел со сдвинутым
 *  прямоугольником.
 *
 *  Без сложения текст остался бы там, куда его клал прежний абсолютный
 *  контракт, а внутри трансформированной группы преобразовался бы ДВАЖДЫ:
 *  один раз группой, второй раз собственными координатами. */
const renderTextLines = (node: IrNode & { kind: 'text' }): string => {
  const run: TextRun | undefined = node.text.runs[0]
  if (run === undefined) return ''
  const anchor =
    node.text.align === 'center' ? 'middle'
    : node.text.align === 'right' ? 'end'
    : 'start'

  return node.text.lines.map((line) => {
    const lineX = node.rect.x + line.x
    const lineY = node.rect.y + line.y
    const x =
      anchor === 'middle' ? lineX + line.w / 2
      : anchor === 'end' ? lineX + line.w
      : lineX
    const baseline = lineY + (line.h + run.fontSize * BASELINE_RATIO) / 2
    return (
      `<text x="${x}" y="${baseline}" text-anchor="${anchor}" ` +
      `dominant-baseline="alphabetic" ` +
      `font-family="${escapeXml(run.usedFamily)}" font-size="${run.fontSize}" ` +
      `font-weight="${run.fontWeight}" font-style="${run.fontStyle}" ` +
      `letter-spacing="${run.letterSpacing}" ` +
      `fill="${rgb(run.color)}" fill-opacity="${run.color.a}" ` +
      `text-rendering="geometricPrecision"${DECORATION_ATTR[run.decoration]} ` +
      `xml:space="preserve">${escapeXml(line.text)}</text>`
    )
  }).join('')
}

/** Заглушка обязана быть ВИДНА: правило проекта запрещает, чтобы
 *  неподдерживаемое содержимое приезжало неотличимо от пустого блока. */
const renderPlaceholder = (node: IrNode & { kind: 'placeholder' }): string => {
  const { x, y, w, h } = node.rect
  return (
    `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, w - 2)}" ` +
    `height="${Math.max(0, h - 2)}" fill="none" stroke="rgb(220,38,38)" ` +
    `stroke-width="2" stroke-dasharray="6 4"/>` +
    `<text x="${x + 6}" y="${y + 18}" font-family="monospace" font-size="12" ` +
    `fill="rgb(220,38,38)" xml:space="preserve">` +
    `${escapeXml(`⚠ ${node.placeholder.label}`)}</text>`
  )
}

/** Исчерпывающий по `kind`: отсутствующая ветка — ошибка компиляции,
 *  а не тихо не нарисованный узел. */
const renderNodeBody = (node: IrNode, ctx: RenderCtx): string => {
  switch (node.kind) {
    case 'frame':
      return renderBox(node, ctx)
    case 'text':
      return renderBox(node, ctx) + renderTextLines(node)
    case 'image':
      /** Бокс рисуется ПЕРЕД картинкой: у `<img>` бывает собственный
       *  фон, и при `contain` он виден в незакрытых полях — именно так
       *  красит браузер. */
      return renderBox(node, ctx) + imageTag(node.image, node.rect, node.id, ctx)
    case 'vector':
      /** SVG встраивается КАК ЕСТЬ, внутри группы со сдвигом в место
       *  узла. Разбирать его самим не нужно и вредно: собственный
       *  разборщик проверить нечем, а встроенный сверяется pixel-diff
       *  точно — браузер рисует обе стороны одним и тем же кодом.
       *
       *  Стили в захваченном SVG уже вписаны атрибутами: в отрыве от
       *  страницы CSS на него не подействует. */
      return (
        /** Бокс рисуется ПЕРЕД вектором: у элемента `<svg>` бывают
         *  собственные фон и рамка, и красит их браузер снизу. */
        renderBox(node, ctx) +
        `<g transform="translate(${node.rect.x} ${node.rect.y})">` +
        `${node.vector.svg}</g>`
      )
    case 'placeholder':
      return renderPlaceholder(node)
  }
}

/** Область обрезки — padding box, то есть border box минус толщины
 *  границ: CSS режет переполнение по внутреннему краю рамки, а не по
 *  внешнему габариту. Прямоугольник передаётся уже АБСОЛЮТНЫМ: координаты
 *  контракта локальны, а `clipPath` без `clipPathUnits` живёт в системе
 *  пользователя, то есть в координатах холста. */
const clipPathDef = (node: IrNode, rect: Rect): string => {
  const sides = node.style.stroke?.weight
    ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const inner = insetBySides(rect, sides)
  const corner = insetCorner(node.style.corner, sides)
  return (
    `<clipPath id="clip-${node.id}">` +
    `<path d="${cornerPath(inner, corner)}"/></clipPath>`
  )
}

/** Абсолютное положение узла в системе экрана.
 *  Координаты локальные, поэтому смещения складываются по пути от корня. */
type Offset = { x: number; y: number }

const shift = (rect: Rect, by: Offset): Rect => ({
  ...rect, x: rect.x + by.x, y: rect.y + by.y,
})

/** Групповые эффекты узла, вынесенные на обёртку `<g>`.
 *
 *  Возвращает пустую строку, если оборачивать нечего. Лишняя группа не
 *  ломает картинку, но засоряет вывод и мешает читать его глазами —
 *  а рендерер служит ещё и инструментом отладки. Поэтому `position:
 *  relative; z-index: 1`, создающий контекст без единого эффекта, группы
 *  не получает. */
const groupAttrs = (node: IrNode, ctx: RenderCtx, at: Offset): string => {
  const parts: string[] = []
  const style: string[] = []

  /** Трансформа применяется ВОКРУГ точки отсчёта, а не вокруг начала
   *  координат: CSS вращает вокруг `transform-origin`, по умолчанию центра.
   *  Отсюда классическая тройка — перенос в точку отсчёта, преобразование,
   *  перенос назад. Угол в градусах, потому что SVG принимает градусы.
   *
   *  Порядок множителей повторяет разложение из сериализатора:
   *  `p' = origin + (tx,ty) + R·S·(p − origin)`. Перестановка `rotate` и
   *  `scale` при НЕравномерном масштабе даёт другую матрицу, поэтому
   *  порядок здесь не косметика.
   *
   *  Раньше трансформа висела на одиночном узле и потомков не задевала:
   *  блок 60×30 внутри `rotate(20deg)` приезжал как 66.64 × 48.71. Теперь
   *  она на группе и потому применяется к поддереву — а дети, выраженные в
   *  системе этого узла, НЕ получают её повторно. */
  if (node.transform !== null) {
    const t = node.transform
    const ox = node.rect.x + at.x + t.originX
    const oy = node.rect.y + at.y + t.originY
    const deg = (t.angle * 180) / Math.PI
    parts.push(
      `transform="translate(${ox} ${oy}) translate(${t.translateX} ${t.translateY})` +
      ` rotate(${deg}) scale(${t.scaleX} ${t.scaleY}) translate(${-ox} ${-oy})"`,
    )
  }
  if (node.style.opacity < 1) parts.push(`opacity="${node.style.opacity}"`)
  if (node.style.blur !== null && node.style.blur.layer > 0) {
    const id = `blur-${node.id}`
    ctx.defs.push(
      `<filter id="${id}" ${FILTER_REGION} ${FILTER_SPACE}>` +
      `<feGaussianBlur stdDeviation="${node.style.blur.layer}"/></filter>`,
    )
    parts.push(`filter="url(#${id})"`)
  }
  if (node.style.blend !== 'normal') style.push(`mix-blend-mode:${node.style.blend}`)

  /** Изоляция безусловна, потому что `groupAttrs` вызывается ТОЛЬКО для
   *  stacking context, а всякий stacking context изолирует. Это измерено,
   *  а не выведено: в фикстуре `blend-isolated` блок с `position:relative;
   *  z-index:1` сохраняет чистый зелёный [34,197,94] поверх красного, и
   *  стоит убрать один только `z-index` — чернеет до [32,53,25].
   *
   *  Прежнее условие ставило изоляцию по наличию ДРУГИХ эффектов. Узел с
   *  единственным `isolation: isolate` эффектов не имеет, группы не
   *  получал вовсе, и наложение потомков доставало до фона под ней. */
  style.push('isolation:isolate')
  if (style.length > 0) parts.push(`style="${style.join(';')}"`)

  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

/** Рисует узел и его поддерево.
 *
 *  Узел, создающий stacking context, становится группой: его эффекты
 *  висят на `<g>` и потому действуют на всё поддерево, как в CSS.
 *  Остальные узлы рисуются плоско, без обёртки, и их дети продолжают
 *  общий порядок отрисовки — иначе группа вокруг каждого узла разрушила
 *  бы возможность перекрывать соседа.
 *
 *  Обёртка ставится по `isStackingContext`, а не по «есть эффект»:
 *  поддерево контекста занимает НЕПРЕРЫВНЫЙ диапазон `paintOrder`
 *  (измерено на всех фикстурах), и только такой диапазон можно обернуть,
 *  не разрушив порядок. Разорванный диапазон возникает у узлов БЕЗ
 *  контекста и отлавливается диагностикой `fidelity.paint-order-interleaved`.
 *
 *  Своя трансформа у узла без контекста невозможна: в CSS `transform`
 *  контекст создаёт всегда. Поэтому условие на группу заодно покрывает
 *  и её. */
const renderSubtree = (node: IrNode, at: Offset, ctx: RenderCtx): string => {
  const absolute = shift(node.rect, at)
  const inner: Offset = { x: absolute.x, y: absolute.y }
  const placed: IrNode = { ...node, rect: absolute }

  const descendants = [...node.children]
    .sort((a, b) => a.paintOrder - b.paintOrder)
    .map((child) => renderSubtree(child, inner, ctx))
    .join('')

  /** Себя узел не обрезает: `overflow` режет СОДЕРЖИМОЕ, а собственные
   *  фон, рамка и тень выходят за padding box совершенно законно. Поэтому
   *  обёртка обнимает только потомков — и не создаётся, когда их нет:
   *  ссылка на `clipPath` без содержимого лишь засоряла бы `<defs>`. */
  const content = node.style.clip && descendants !== ''
    ? (ctx.defs.push(clipPathDef(node, absolute)),
       `<g clip-path="url(#clip-${node.id})">${descendants}</g>`)
    : descendants

  const attrs = node.isStackingContext ? groupAttrs(node, ctx, at) : ''

  if (attrs === '') return renderNodeBody(placed, ctx) + content

  /** Эффекты сняты с самой фигуры, потому что они уже висят на группе.
   *  Оставить их на обоих — значит применить дважды: полупрозрачная
   *  группа с полупрозрачной фигурой внутри даёт квадрат прозрачности,
   *  а размытие накладывается поверх размытия. Оба случая выглядят
   *  правдоподобно и без pixel-diff неотличимы от задуманного. */
  const bare = renderNodeBody(
    {
      ...placed,
      style: { ...node.style, opacity: 1, blend: 'normal', blur: null },
    },
    ctx,
  )
  return `<g${attrs}>${bare}${content}</g>`
}

export const renderScreenToSvg = (
  screen: Screen,
  /** Ассеты по идентификатору. По умолчанию пусто — экран без
   *  изображений рисуется как раньше, и все прежние вызовы остаются
   *  верными. Узел, ссылающийся на отсутствующий здесь ассет, БРОСАЕТ:
   *  см. комментарий в `imageTag`. */
  images: ReadonlyMap<string, RenderImage> = new Map(),
): string => {
  const defs: string[] = []
  const ctx: RenderCtx = { defs, images }
  /** У корня экрана координаты абсолютные, поэтому накопленное смещение
   *  начинается с нуля. */
  const body = renderSubtree(screen.root, { x: 0, y: 0 }, ctx)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" ` +
    `height="${screen.height}" viewBox="0 0 ${screen.width} ${screen.height}">` +
    `<defs>${defs.join('')}</defs>${body}</svg>`
  )
}
