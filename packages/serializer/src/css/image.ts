import { DIAGNOSTIC_CODES, type DiagnosticCode } from '@w2f/ir/codes'
import type { ImagePlacement } from '@w2f/ir'

export type BackgroundImageVerdict =
  | { kind: 'none' }
  | { kind: 'raster'; url: string }
  | { kind: 'gradient' }
  | { kind: 'unknown'; raw: string }

/** Верхнеуровневые запятые — границы слоёв фона. Наивный `split(',')`
 *  здесь не годится: запятые есть внутри `rgb(...)` и внутри самих
 *  градиентов, то есть он разрезал бы один слой на несколько и объявил
 *  многослойным обычный `linear-gradient(red, blue)`. */
const splitLayers = (value: string): string[] => {
  const layers: string[] = []
  let depth = 0
  let start = 0
  let quote: string | null = null
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      layers.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  layers.push(value.slice(start).trim())
  return layers.filter((layer) => layer.length > 0)
}

const URL_PATTERN = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)$/

export const parseUrlToken = (layer: string): string | null => {
  const match = URL_PATTERN.exec(layer)
  if (match === null) return null
  const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
  return raw.length > 0 ? raw : null
}

/** Слои фона, от ВЕРХНЕГО к нижнему — в том порядке, в каком они
 *  записаны в CSS.
 *
 *  Порядок важно помнить именно таким, потому что в наших заливках он
 *  ОБРАТНЫЙ: там они идут снизу вверх, как их красит браузер.
 *  Перепутать легко, а выглядит перепутанное правдоподобно: тот же
 *  набор цветов, только поверх оказывается не тот. */
export const backgroundLayers = (value: string): string[] => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return []
  return splitLayers(trimmed)
}

/** Значения послойных свойств (`background-size`, `-position`,
 *  `-repeat`) с ЦИКЛИЧЕСКИМ повтором.
 *
 *  По CSS список короче списка изображений повторяется: два слоя и
 *  один `background-size` означают, что размер применяется к обоим.
 *  Взять вместо этого пустое значение значило бы разместить второй
 *  слой по умолчанию, то есть не так, как на странице, — и молча. */
export const layerValue = (value: string, index: number): string => {
  const parts = splitLayers(value)
  if (parts.length === 0) return ''
  return parts[index % parts.length] ?? ''
}

/** Распознавание SVG по расширению пути УБРАНО вместе с отдельной
 *  веткой для него.
 *
 *  Приём был ненадёжен по построению — путь без расширения или `.svg`,
 *  отдающий PNG, обманывали его, — и, главное, нужды в нём не
 *  осталось: SVG едет тем же путём ассета, что растр, только байтами
 *  исходника. Тип узнаётся после загрузки, по заголовку ответа, и
 *  только там на него и смотрят. */

export const classifyBackgroundImage = (value: string): BackgroundImageVerdict => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return { kind: 'none' }

  /** Многослойность здесь БОЛЬШЕ НЕ РАЗБИРАЕТСЯ: слои разделяет
   *  вызывающий (`backgroundLayers`) и передаёт сюда по одному. Ветка
   *  «несколько слоёв» осталась бы мёртвой, а мёртвая ветка с кодом
   *  диагностики выглядит как работающая защита — и потому хуже её
   *  отсутствия.
   *
   *  На всякий случай берётся ПЕРВЫЙ слой, а не весь текст: если
   *  вызывающий когда-нибудь передаст сюда список, разбор коснётся
   *  чего-то осмысленного, а не склейки. */
  const layer = splitLayers(trimmed)[0] ?? ''
  const url = parseUrlToken(layer)
  if (url !== null) {
    /** SVG в фоне — ТОТ ЖЕ растровый путь.
     *
     *  Различать их здесь больше незачем: браузер рисует фоновый SVG
     *  через `<image>` так же, как PNG, и эталонный рендерер тоже —
     *  он кодирует ассет в `data:`-URL, а `data:image/svg+xml` в
     *  `<image>` работает. Векторность при этом не теряется: байты
     *  едут исходником, и плагин строит из них настоящий векторный
     *  узел через `createNodeFromSvg`, а не картинку.
     *
     *  Прежнее разделение стоило дорого: на Hacker News 30 записей из
     *  31 были «векторный фон не переносится растром», то есть почти
     *  весь отчёт страницы — про иконки, которых в макете не
     *  появлялось. */
    return { kind: 'raster', url }
  }
  if (layer.includes('gradient(')) return { kind: 'gradient' }
  return { kind: 'unknown', raw: layer }
}

type Size = { w: number; h: number }

/** Одна компонента `object-position` / `background-position`.
 *
 *  `null` — не разобрана: вызывающий обязан подставить НАЧАЛЬНОЕ
 *  значение CSS (центр), а не ноль. Ноль сдвинул бы картинку влево и
 *  вверх и выглядел бы при этом как настоящая раскладка.
 *
 *  Разбирается только то, что реально приходит из вычисленного стиля.
 *  Замерено в Chromium: ключевые слова приведены к процентам
 *  (`left top` → `0% 0%`), пара всегда полная. */
const parsePositionPart = (part: string, free: number): number | null => {
  const percent = /^(-?[\d.]+)%$/.exec(part)
  if (percent !== null) {
    const value = Number.parseFloat(percent[1] ?? '')
    return Number.isNaN(value) ? null : (free * value) / 100
  }
  const px = /^(-?[\d.]+)px$/.exec(part)
  if (px !== null) {
    const value = Number.parseFloat(px[1] ?? '')
    return Number.isNaN(value) ? null : value
  }
  return null
}

/** Масштабы по осям для заданного `object-fit`.
 *
 *  Возвращается ПАРА, а не одно число: при `fill` масштабы различаются,
 *  и единственное число молча растеряло бы растяжение. */
const scaleFor = (fit: string, box: Size, natural: Size): { x: number; y: number } => {
  const byWidth = box.w / natural.w
  const byHeight = box.h / natural.h
  switch (fit) {
    case 'contain': {
      const s = Math.min(byWidth, byHeight)
      return { x: s, y: s }
    }
    case 'cover': {
      const s = Math.max(byWidth, byHeight)
      return { x: s, y: s }
    }
    case 'none':
      return { x: 1, y: 1 }
    case 'scale-down': {
      const s = Math.min(1, Math.min(byWidth, byHeight))
      return { x: s, y: s }
    }
    /** `fill` — начальное значение CSS, сюда же попадает нераспознанное:
     *  это совпадает с тем, как повёл бы себя браузер с неизвестным
     *  ключевым словом. */
    default:
      return { x: byWidth, y: byHeight }
  }
}

/** Режим для Figma.
 *
 *  ВНИМАНИЕ НА ИМЕНА. CSS `object-fit: fill` означает «растянуть,
 *  пропорции не сохранять». Режим `fill` контракта означает то же, что
 *  `FILL` в Figma: «заполнить бокс, сохранив пропорции, лишнее
 *  обрезать» — то есть CSS `cover`. Слово одно, смысл разный, и
 *  перепутать их значит получить растянутую картинку там, где нужна
 *  обрезанная.
 *
 *  Поле НЕ проверяется pixel-diff: рендерер рисует по `scale`/`offset`,
 *  а режим нужен только плагину. Единственная его проверка — таблица в
 *  юнит-тесте; настоящая сверка приходит в плане 5, на живом плагине.
 *  Записано здесь, чтобы поле не считалось проверенным гейтом. */
const modeFor = (fit: string): ImagePlacement['mode'] => {
  switch (fit) {
    case 'cover': return 'fill'
    case 'contain': return 'fit'
    default: return 'crop'
  }
}

export const placementFor = (
  fit: string,
  position: string,
  box: Size,
  natural: Size,
): ImagePlacement => {
  const scale = scaleFor(fit, box, natural)
  const freeX = box.w - natural.w * scale.x
  const freeY = box.h - natural.h * scale.y

  const parts = position.trim().split(/\s+/)
  const rawX = parts[0] ?? ''
  const rawY = parts[1] ?? parts[0] ?? ''

  return {
    mode: modeFor(fit),
    offsetX: parsePositionPart(rawX, freeX) ?? freeX / 2,
    offsetY: parsePositionPart(rawY, freeY) ?? freeY / 2,
    scaleX: scale.x,
    scaleY: scale.y,
  }
}

/** Бокс НАЧАЛА ОТСЧЁТА фона, в координатах узла.
 *
 *  Фон считается не от границы бокса: `background-origin` по умолчанию
 *  `padding-box`, то есть фон начинается ВНУТРИ рамки. `rect` узла —
 *  это border box, поэтому смещения обязаны включать сдвиг, а проценты
 *  размера и позиции — считаться от размеров именно этого бокса.
 *  Измерено: Chromium отдаёт `background-origin: padding-box` даже
 *  когда свойство не объявлено. */
export type OriginBox = { x: number; y: number; w: number; h: number }

/** Одна компонента `background-size`: пиксели, проценты от стороны
 *  бокса начала отсчёта, либо `auto`. */
const parseSizePart = (part: string, side: number): number | 'auto' => {
  if (part === 'auto') return 'auto'
  const percent = /^(-?[\d.]+)%$/.exec(part)
  if (percent !== null) {
    const value = Number.parseFloat(percent[1] ?? '')
    return Number.isNaN(value) ? 'auto' : (side * value) / 100
  }
  const px = /^(-?[\d.]+)px$/.exec(part)
  if (px !== null) {
    const value = Number.parseFloat(px[1] ?? '')
    return Number.isNaN(value) ? 'auto' : value
  }
  return 'auto'
}

/** Масштабы фона.
 *
 *  Замерено: `cover`, `contain` и `auto` в вычисленном стиле остаются
 *  словами и в пиксели НЕ разворачиваются. Прочитать готовое нельзя,
 *  арифметику приходится считать самим. */
const backgroundScaleFor = (
  size: string,
  origin: OriginBox,
  natural: Size,
): { x: number; y: number } => {
  const trimmed = size.trim()
  if (trimmed === 'cover' || trimmed === 'contain') {
    return scaleFor(trimmed, { w: origin.w, h: origin.h }, natural)
  }

  const parts = trimmed.split(/\s+/)
  const rawW = parseSizePart(parts[0] ?? 'auto', origin.w)
  const rawH = parseSizePart(parts[1] ?? 'auto', origin.h)

  /** Оба `auto` — натуральный размер. Это НЕ то же, что `contain`:
   *  `contain` растянул бы картинку до бокса. */
  if (rawW === 'auto' && rawH === 'auto') return { x: 1, y: 1 }
  /** Одно `auto` означает «сохрани пропорцию», а не «натуральная
   *  сторона»: иначе картинка поехала бы по второй оси. */
  if (rawH !== 'auto' && rawW === 'auto') {
    const s = rawH / natural.h
    return { x: s, y: s }
  }
  if (rawW !== 'auto' && rawH === 'auto') {
    const s = rawW / natural.w
    return { x: s, y: s }
  }
  if (rawW === 'auto' || rawH === 'auto') return { x: 1, y: 1 }
  return { x: rawW / natural.w, y: rawH / natural.h }
}

/** Режим повтора.
 *
 *  `repeat-x`, `repeat-y`, `round` и `space` намеренно НЕ сводятся к
 *  плитке: контракт держит один режим на обе оси, а такая подмена
 *  залила бы весь бокс вместо одной полосы. Вызывающий обязан сообщить
 *  по `deferredRepeatMode` — признак `partial`. */
export const repeatVerdict = (
  repeat: string,
): { tile: boolean; partial: boolean } => {
  const value = repeat.trim()
  if (value === 'repeat') return { tile: true, partial: false }
  if (value === 'no-repeat') return { tile: false, partial: false }
  return { tile: false, partial: true }
}

export const backgroundPlacementFor = (
  size: string,
  position: string,
  repeat: string,
  origin: OriginBox,
  natural: Size,
): ImagePlacement => {
  const scale = backgroundScaleFor(size, origin, natural)
  const freeX = origin.w - natural.w * scale.x
  const freeY = origin.h - natural.h * scale.y

  const parts = position.trim().split(/\s+/)
  const rawX = parts[0] ?? ''
  const rawY = parts[1] ?? parts[0] ?? ''

  const { tile } = repeatVerdict(repeat)
  /** Режим берётся из `background-size`, а не из `object-fit`: слов
   *  `cover`/`contain` в нём те же, но `auto` — своё. */
  const trimmedSize = size.trim()
  const mode: ImagePlacement['mode'] =
    tile ? 'tile'
    : trimmedSize === 'cover' ? 'fill'
    : trimmedSize === 'contain' ? 'fit'
    : 'crop'

  return {
    mode,
    /** Сдвиг начала отсчёта прибавляется в конце: всё выше считалось
     *  ВНУТРИ бокса начала отсчёта, а наружу отдаются координаты узла. */
    offsetX: origin.x + (parsePositionPart(rawX, freeX) ?? freeX / 2),
    offsetY: origin.y + (parsePositionPart(rawY, freeY) ?? freeY / 2),
    scaleX: scale.x,
    scaleY: scale.y,
  }
}
