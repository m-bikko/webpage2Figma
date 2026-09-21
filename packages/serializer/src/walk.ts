// Значение берётся из подпути, а не из барреля: баррель тянет schema.ts,
// то есть zod, который сериализатору не нужен вовсе. Через баррель бандл
// весил 171 КиБ при ~18 КиБ собственного кода, и всё это впрыскивалось
// в каждую захватываемую страницу.
import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import type {
  Fill, FontRequirement, IrNode, LayoutAlign, NodeStyle,
  ImageRef, SelfLayout, SelfPositioning, Transform,
} from '@w2f/ir'
import { isInvisible, parseColor } from './css/color.js'
import { clipsAwayEverything } from './css/clip.js'
import { isEllipticalCorner, readCorner } from './css/corner.js'
import { sizeFromDataUrl } from './css/data-url.js'
import { parseLinearGradient } from './css/gradient.js'
import {
  backgroundPlacementFor, classifyBackgroundImage, placementFor, repeatVerdict,
  type OriginBox,
} from './css/image.js'
import { hasMixedBorderColors, hasNonSolidStroke, readStroke } from './css/stroke.js'
import { parseBoxShadow } from './css/shadow.js'
import {
  appliesTransform, decomposeMatrix, hasSkew, IDENTITY_MATRIX, invertMatrix,
  localOffset, matrixAboutOrigin, multiplyMatrix, originUnderMatrix,
  parseMatrix, readOrigin, untransformedSize, type Matrix,
} from './css/transform.js'
import type { DiagnosticSink } from './diagnostics.js'
import { hoistEscaped } from './hoist.js'
import {
  readPseudo, type PseudoKind, type PseudoRead, type PseudoRefusal,
} from './pseudo.js'
import { readVector } from './vector.js'
import type { AssetRequests } from './assets.js'
import { isReversed, readLayout } from './layout.js'
import { readProbe, type LayoutProbe } from './probe.js'
import {
  establishesStackingContext,
  resolvePaintOrder,
} from './stacking.js'
import { hasFontFallback, parseFontStack, readText } from './text.js'

export type IdAllocator = () => string

/** Идентификаторы уникальны в пределах БАНДЛА, а не экрана: на них
 *  ссылается отчёт, и `n42` в пяти экранах сделал бы ссылку неоднозначной.
 *  Поэтому аллокатор создаётся один раз на захват и передаётся снаружи. */
export const createIdAllocator = (): IdAllocator => {
  let counter = 0
  return () => {
    const id = `n${counter}`
    counter += 1
    return id
  }
}

const GROUP_EFFECT_MESSAGES = {
  transform: 'трансформа предка к нему не применяется, а его прямоугольник ' +
    'снят как габарит уже трансформированного элемента',
  blur: 'размытие предка к нему не применяется, и он остаётся резким',
  opacity: 'прозрачность предка применяется к группе целиком, а рендерер ' +
    'применяет её к каждому узлу отдельно',
} as const

type WalkContext = {
  sink: DiagnosticSink
  /** Накопитель заявок на байты изображений. Общий на весь ЗАХВАТ, а не
   *  на экран: инвариант `asset.dangling` проверяет ссылки в пределах
   *  бандла, и один логотип на пяти экранах обязан быть одним ассетом. */
  requests: AssetRequests
  /** Экран, который снимается сейчас. Уезжает в заявку, чтобы отказ по
   *  ассету был записью с адресом, а не без. */
  screenId: string
  scrollX: number
  scrollY: number
  allocId: IdAllocator
  /** Есть ли среди предков узел с НЕпереносимой трансформой — скосом или
   *  трёхмерной матрицей. Такая трансформа не попадает в накопленную
   *  матрицу, поэтому положение всех потомков наследует ошибку.
   *  Ведётся сверху вниз: снизу этого не восстановить. */
  insideBrokenTransform: boolean
  /** Произведение матриц всех трансформированных предков. Ведётся сверху
   *  вниз: снизу его не восстановить, потому что `getBoundingClientRect()`
   *  отдаёт результат их применения, но не сами матрицы. */
  ancestorMatrix: Matrix
  /** Обратная к `ancestorMatrix`. Ведётся рядом, а не считается на каждом
   *  узле: она нужна каждому ребёнку, а меняется только там, где у предка
   *  есть собственная трансформа — то есть почти нигде.
   *
   *  `null` означает вырожденную цепочку (`scale(0)` где-то выше):
   *  положение потомков в такой системе не восстановимо, и подставлять
   *  единичную нельзя — это выдало бы неверный ответ за верный. */
  ancestorInverse: Matrix | null
  /** Экранное положение локального нуля родителя ПОСЛЕ его собственной
   *  трансформы. Начало системы координат, в которой выражены дети. */
  parentOrigin: { x: number; y: number }
}

/** Элементы, которые не рисуются и не должны попадать в макет. */
const SKIPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'BR',
])

const isRendered = (el: Element, cs: CSSStyleDeclaration): boolean => {
  if (SKIPPED_TAGS.has(el.tagName)) return false
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return false
  /** Полностью вырезанный `clip-path`-ом узел невидим ТАК ЖЕ, как
   *  `display: none`, и пропускается вместе с поддеревом.
   *
   *  Это не потеря, а её противоположность. Идиома
   *  `clip-path: inset(50%)` на боксе 1×1 — стандартный способ
   *  оставить подпись скринридерам, убрав её с экрана; перенеся её,
   *  мы положили бы в макет текст, которого на странице не видно.
   *  Измерено: половина всех записей про `clip-path` на живых
   *  страницах — ровно эта идиома. */
  return !clipsAwayEverything(cs.clipPath, { w: rect.width, h: rect.height })
}

const ALIGN_SELF: Record<string, LayoutAlign> = {
  'flex-start': 'start', start: 'start',
  center: 'center',
  'flex-end': 'end', end: 'end',
  stretch: 'stretch',
  baseline: 'baseline',
}

/** Как узел участвует в раскладке РОДИТЕЛЯ. Без этого плагин не отличит
 *  обычного ребёнка flex-контейнера от абсолютно позиционированного
 *  бейджа и уложит бейдж третьим элементом auto-layout, сдвинув
 *  остальных. Данные читаются здесь и больше нигде не восстановимы. */
const readSelfLayout = (cs: CSSStyleDeclaration): SelfLayout => {
  const positioning: SelfPositioning =
    cs.position === 'absolute' ? 'absolute'
    : cs.position === 'fixed' ? 'fixed'
    : cs.position === 'sticky' ? 'sticky'
    : cs.float !== 'none' ? 'float'
    : 'flow'

  const rawAlign = cs.alignSelf
  const px = (value: string): number => Number.parseFloat(value) || 0

  /** `margin: auto` читается из ОБЪЯВЛЕННОГО значения, а не из
   *  вычисленного: вычисленное браузер уже разрешил в пиксели, и
   *  отличить «поставили 16» от «получилось 16 само» по нему нельзя.
   *  А различать надо: центрирование блока через `margin: 0 auto` —
   *  самая частая раскладка, которую флекс сам по себе не объясняет.
   *
   *  Объявленное значение доступно только через таблицы стилей
   *  элемента; `style` даёт лишь инлайновое. Поэтому берётся то, что
   *  есть: признак `auto` выводится из симметрии вычисленных отступов
   *  при ненулевом свободном месте — способ приблизительный, и он
   *  честно назван приблизительным там, где используется. */
  const margin = {
    top: px(cs.marginTop), right: px(cs.marginRight),
    bottom: px(cs.marginBottom), left: px(cs.marginLeft),
  }

  return {
    positioning,
    align: rawAlign === 'auto' ? null : (ALIGN_SELF[rawAlign] ?? null),
    grow: Number.parseFloat(cs.flexGrow) || 0,
    shrink: Number.isNaN(Number.parseFloat(cs.flexShrink))
      ? 1
      : Number.parseFloat(cs.flexShrink),
    margin,
    marginAuto: {
      horizontal: margin.left > 0 && Math.abs(margin.left - margin.right) < 0.5,
      vertical: margin.top > 0 && Math.abs(margin.top - margin.bottom) < 0.5,
    },
  }
}

/** Натуральный размер уже загруженного фонового изображения.
 *
 *  У фона, в отличие от `<img>`, нет элемента с `naturalWidth`. Приём —
 *  завести `new Image()` на тот же URL: браузер держит картинку в своём
 *  кеше, и для УЖЕ отрисованного фона размер доступен немедленно.
 *  Измерено в Chromium: `complete === true`, размер 64×32 сразу.
 *
 *  `null` означает, что размер синхронно недоступен. Подставлять вместо
 *  него размер бокса нельзя: это выдало бы догадку за факт и молча
 *  исказило бы масштаб. */
const naturalSizeOf = (url: string): { w: number; h: number } | null => {
  /** `data:`-URL разбирается из заголовка: для него приём с кешем не
   *  работает, потому что декодирование асинхронно даже когда байты
   *  прямо в строке. Найдено на захвате настоящей страницы — 20
   *  фоновых картинок из 28 недоступных оказались `data:image/png`. */
  const fromData = sizeFromDataUrl(url)
  if (fromData !== null) return fromData

  const probe = new Image()
  probe.src = url
  if (!probe.complete || probe.naturalWidth === 0) return null
  return { w: probe.naturalWidth, h: probe.naturalHeight }
}

/** Бокс начала отсчёта фона в координатах узла.
 *
 *  `rect` узла — это border box, а `background-origin` по умолчанию
 *  `padding-box`: фон начинается ВНУТРИ рамки. Без этого сдвига фон на
 *  элементе с рамкой уезжает на её толщину. */
const originBoxOf = (
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
): OriginBox => {
  const origin = cs.backgroundOrigin
  if (origin === 'border-box') return { x: 0, y: 0, w: box.w, h: box.h }

  const px = (value: string): number => Number.parseFloat(value) || 0
  let left = px(cs.borderLeftWidth)
  let top = px(cs.borderTopWidth)
  let right = px(cs.borderRightWidth)
  let bottom = px(cs.borderBottomWidth)
  if (origin === 'content-box') {
    left += px(cs.paddingLeft)
    top += px(cs.paddingTop)
    right += px(cs.paddingRight)
    bottom += px(cs.paddingBottom)
  }
  return {
    x: left, y: top,
    w: Math.max(0, box.w - left - right),
    h: Math.max(0, box.h - top - bottom),
  }
}

/** `box` — размер того прямоугольника, который поедет в `rect`, а НЕ
 *  габарит из `getBoundingClientRect()`. Разница появляется ровно на
 *  трансформированном элементе: ручки градиента нормализованы по боксу, и
 *  рендерер разворачивает их в пиксели по `rect`. Считать их по габариту
 *  повёрнутого элемента, а рисовать в НЕповёрнутом боксе — значит задать
 *  угол градиента от чужого соотношения сторон, потому что угол в CSS
 *  зависит от пропорций бокса (см. `cornerAngle` в `gradient.ts`). */
const readFills = (
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
  sink: DiagnosticSink,
  id: string,
  requests: AssetRequests,
  screenId: string,
): Fill[] => {
  const fills: Fill[] = []

  const background = parseColor(cs.backgroundColor)
  if (background === null) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.colorUnparsed,
      `Не удалось разобрать background-color: "${cs.backgroundColor}"`, id, false,
    )
  } else if (!isInvisible(background)) {
    fills.push({ kind: 'solid', color: background })
  }

  /** Градиент кладётся ПОВЕРХ цвета фона — так же, как красит браузер:
   *  `background-image` рисуется над `background-color`. Порядок в массиве
   *  `fills` и есть порядок отрисовки. */
  if (cs.backgroundImage !== 'none') {
    const verdict = classifyBackgroundImage(cs.backgroundImage)
    if (verdict.kind === 'gradient') {
      const gradient = parseLinearGradient(cs.backgroundImage, box)
      if (gradient !== null) fills.push({ kind: 'gradient', gradient })
    } else if (verdict.kind === 'raster') {
      /** URL из вычисленного стиля уже абсолютен, но `new URL` с базой
       *  документа делает это утверждение независимым от браузера:
       *  полагаться на относительность мы не хотим, а идентификатор
       *  ассета выдаётся по URL и обязан быть стабильным. */
      const resolved = new URL(verdict.url, document.baseURI).href
      const natural = naturalSizeOf(resolved)
      if (natural === null) {
        /** Размер источника неизвестен синхронно. Подставить размер
         *  бокса значило бы выдать догадку за факт и молча исказить
         *  масштаб — поэтому заливки не будет, а будет запись в отчёт. */
        sink.report('warning', DIAGNOSTIC_CODES.imageUnreadable,
          `Размер фонового изображения недоступен: ${resolved}`, id, false)
      } else {
        const origin = originBoxOf(cs, box)
        if (repeatVerdict(cs.backgroundRepeat).partial) {
          sink.report('info', DIAGNOSTIC_CODES.deferredRepeatMode,
            `background-repeat: ${cs.backgroundRepeat} не выражается одним ` +
            `режимом на обе оси и перенесён без повтора.`, id, false)
        }
        fills.push({
          kind: 'image',
          ref: {
            assetId: requests.request(resolved, natural.w, natural.h, id, screenId),
            placement: backgroundPlacementFor(
              cs.backgroundSize, cs.backgroundPosition, cs.backgroundRepeat,
              origin, natural,
            ),
          },
        })
      }
    }
  }

  return fills
}

const BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])

const readStyle = (
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
  sink: DiagnosticSink,
  id: string,
  requests: AssetRequests,
  screenId: string,
): NodeStyle => {
  if (isEllipticalCorner(cs, box)) {
    sink.report(
      'info', DIAGNOSTIC_CODES.ellipticalCorner,
      'Эллиптический радиус угла сведён к горизонтальному: в Figma эллиптических углов нет.',
      id, false,
    )
  }
  if (hasMixedBorderColors(cs)) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.mixedBorderColors,
      'Границы разных цветов сведены к одному: Figma держит один цвет обводки на узел.',
      id, false,
    )
  }
  if (hasNonSolidStroke(cs)) {
    sink.report(
      'info', DIAGNOSTIC_CODES.strokeStyleFlattened,
      'Стиль границы не воспроизводится рендерером плана 1 либо невыразим в Figma.',
      id, false,
    )
  }

  const rawBlend = cs.mixBlendMode
  const blend = BLEND_MODES.has(rawBlend)
    ? (rawBlend as NodeStyle['blend'])
    : 'normal'

  return {
    fills: readFills(cs, box, sink, id, requests, screenId),
    stroke: readStroke(cs),
    corner: readCorner(cs, box),
    shadows: parseBoxShadow(cs.boxShadow),
    // СОБСТВЕННАЯ непрозрачность, не композитная: плагин вкладывает узлы,
    // и Figma перемножает так же, как браузер. Запекать вниз запрещено.
    opacity: Number.parseFloat(cs.opacity),
    blend,
    /** Два размытия разведены намеренно: `filter: blur()` размывает САМ
     *  слой и переносится, `backdrop-filter: blur()` размывает то, что за
     *  элементом, и остаётся отложенным — у плоского рендерера «за
     *  элементом» не существует, проверить перенос нечем. Поле остаётся
     *  `null`, когда размытия нет вовсе: пустой объект `{0,0}` заставил бы
     *  инвариант требовать диагностику там, где нечего откладывать. */
    blur: (() => {
      const layer = blurRadius(cs.filter)
      const background = blurRadius(cs.backdropFilter)
      return layer > 0 || background > 0 ? { layer, background } : null
    })(),
    clip: cs.overflowX === 'hidden' || cs.overflowY === 'hidden'
      || cs.overflowX === 'clip' || cs.overflowY === 'clip',
  }
}

const blurRadius = (value: string): number => {
  const match = /blur\(\s*([\d.]+)px\s*\)/.exec(value)
  if (match?.[1] === undefined) return 0
  return Number.parseFloat(match[1])
}

/** Диагностирует всё, что этот план не переносит.
 *
 *  Разделение обязательное: `unsupported.*` — то, что невозможно в Figma
 *  в принципе, `deferred.*` — то, что ещё не реализовано. Второе
 *  проверяется инвариантом в `@w2f/ir`: узел с ФОНОВЫМ размытием
 *  без парной диагностики отвергается на входе плагина. Именно так правило
 *  «молчаливый fallback — это баг» стало машинным.
 *
 *  Трансформа, режим наложения и размытие СЛОЯ из этого списка ВЫШЛИ: все
 *  три переносятся, поэтому диагностируется только то, что перенести
 *  нельзя — трёхмерная матрица трансформы, сдвиг и `backdrop-filter`.
 *  Сообщать о переносимом повороте, наложении или размытии было бы шумом,
 *  а шум учит игнорировать отчёт целиком. */
const reportGaps = (
  el: Element,
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): void => {
  if (cs.backgroundImage !== 'none') {
    const rect = el.getBoundingClientRect()
    const verdict = classifyBackgroundImage(cs.backgroundImage)
    /** Диагностика только на то, что НЕ разобрали. Линейные градиенты
     *  переносятся, и сообщать о них было бы шумом, а шум учит
     *  игнорировать отчёт целиком.
     *
     *  Вердикт нужен потому, что прежняя ветка сообщала обо ВСЁМ
     *  неразобранном кодом `deferred.gradient` — включая `url(...)`.
     *  Растр градиентом не является, и такое сообщение уводило
     *  читателя отчёта не туда. */
    switch (verdict.kind) {
      case 'gradient': {
        const linear = parseLinearGradient(cs.backgroundImage, {
          w: rect.width, h: rect.height,
        })
        if (linear === null) {
          const repeating = cs.backgroundImage.includes('repeating-')
          sink.report(
            repeating ? 'warning' : 'info',
            repeating ? DIAGNOSTIC_CODES.unsupportedRepeatingGradient
                      : DIAGNOSTIC_CODES.deferredGradient,
            `background-image "${cs.backgroundImage.slice(0, 60)}" не переносится: ` +
            `в этом плане поддержан только linear-gradient.`,
            id, false,
          )
        }
        break
      }
      case 'vector':
        sink.report('info', verdict.code,
          'Векторный фон (SVG) не переносится растром.', id, false)
        break
      case 'multi-layer':
        sink.report('info', verdict.code,
          'Несколько слоёв фона: перенесён только случай одного слоя.', id, false)
        break
      case 'unknown':
        sink.report('warning', DIAGNOSTIC_CODES.deferredGradient,
          `Фоновое изображение "${verdict.raw.slice(0, 60)}" не распознано.`,
          id, false)
        break
      case 'raster':
        /** Растровым фоном занимается `readFills`: там есть накопитель
         *  заявок. Он же и сообщит, если байты недоступны. Дублировать
         *  диагностику здесь значило бы ругаться на то, что работает. */
        break
      case 'none':
        break
    }
  }
  if (cs.transform !== 'none') {
    const matrix = parseMatrix(cs.transform)
    if (matrix === null) {
      sink.report('error', DIAGNOSTIC_CODES.unsupportedTransform3d,
        `transform "${cs.transform}" не переносится: трёхмерных трансформ в ` +
        `Figma нет физически.`, id, false)
    } else if (hasSkew(matrix)) {
      /** Сдвиг в Figma отсутствует. Узел при этом приезжает без трансформы
       *  вообще, а не со сдвигом, приведённым к повороту: приближение
       *  выглядело бы правдоподобно и потому хуже честного отказа. */
      sink.report('error', DIAGNOSTIC_CODES.unsupportedTransform3d,
        `transform "${cs.transform}" содержит сдвиг, которого в Figma нет.`,
        id, false)
    }
  }
  const bgBlur = blurRadius(cs.backdropFilter)
  if (bgBlur > 0) {
    /** Размытие слоя переносится, фоновое — нет. Причина не в Figma, где
     *  Background Blur есть, а в рендерере: он плющит дерево в плоский
     *  список, и «того, что за элементом» у него не существует. Проверить
     *  перенос нечем, поэтому фича остаётся отложенной. */
    sink.report('info', DIAGNOSTIC_CODES.deferredBlur,
      `backdrop-filter: blur(${bgBlur}px) не переносится: рендерер плющит ` +
      `дерево, и фона за элементом у него нет.`, id, false)
  }
  /** Проверяется НАЛИЧИЕ не-blur функций, а не отсутствие blur.
   *  Условие `layerBlur === 0` пропускало `filter: blur(3px) grayscale(1)`:
   *  размытие диагностировалось, grayscale терялся без записи. То же для
   *  `backdrop-filter`, который раньше осматривался только на размытие. */
  const hasNonBlur = (value: string): boolean =>
    value !== 'none' && value.replace(/blur\([^)]*\)/g, '').trim() !== ''

  if (hasNonBlur(cs.filter)) {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedFilter,
      `filter "${cs.filter}" содержит функции кроме размытия: Figma их не имеет.`,
      id, false)
  }
  if (hasNonBlur(cs.backdropFilter)) {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedFilter,
      `backdrop-filter "${cs.backdropFilter}" содержит функции кроме размытия.`,
      id, false)
  }
  if (cs.clipPath !== 'none') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedClipPath,
      `clip-path "${cs.clipPath}" не переносится.`, id, false)
  }
  if (cs.position === 'sticky' || cs.position === 'fixed') {
    sink.report('info', DIAGNOSTIC_CODES.stickyFlattened,
      `position: ${cs.position} снят в текущем скролл-положении.`, id, false)
  }
  /** Диагностика про сетку здесь БОЛЬШЕ НЕ ставится.
   *
   *  Она утверждала «сведён к колонке» — а теперь сетка записывается
   *  сеткой, и сводит её (или не сводит) плагин, который единственный
   *  видит, одномерная она или двумерная. Сообщать о сведении там,
   *  где сведения не происходит, значило бы врать в отчёте.
   *
   *  Код `fidelity.grid-flattened` сохранён: коды стабильны, и его
   *  теперь порождает плагин. */
  /** Диагностики «вектор не переносится» здесь БОЛЬШЕ НЕТ: SVG
   *  захватывается исходником и приезжает вектором. Всё, что с ним
   *  может пойти не так, сообщается там, где строится узел, — с
   *  названной причиной вместо общего «не переносится».
   *
   *  Код `deferred.vector` сохранён: коды стабильны, и его всё ещё
   *  порождает `classifyBackgroundImage` для SVG в `background-image`,
   *  который растром не переносится. */
  /** Диагностика про псевдоэлементы выдаётся ТАМ, где они строятся:
   *  причина отказа известна только после разбора, а общее «не
   *  переносится» её скрывало. Переносимые не диагностируются вовсе —
   *  переносить их и есть ответ. */
}

/** Содержимое, которое невозможно перенести в принципе, становится
 *  ВИДИМОЙ заглушкой, а не пустым фреймом. Парная диагностика с тем же
 *  кодом и `needsPlaceholder: true` обязательна: инвариант в `@w2f/ir`
 *  отвергнет заглушку, которую отчёт не объясняет. */
const placeholderFor = (
  el: Element,
  sink: DiagnosticSink,
  id: string,
): { code: typeof DIAGNOSTIC_CODES[keyof typeof DIAGNOSTIC_CODES]; label: string } | null => {
  if (el.tagName === 'CANVAS') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas,
      'Содержимое <canvas> не переносится.', id, true)
    return { code: DIAGNOSTIC_CODES.unsupportedCanvas, label: 'canvas' }
  }
  if (el.tagName === 'VIDEO') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedVideo,
      'Содержимое <video> не переносится: кадр видео — не изображение ' +
      'страницы, и выдавать один момент времени за содержимое неверно.',
      id, true)
    return { code: DIAGNOSTIC_CODES.unsupportedVideo, label: 'video' }
  }
  if (el.tagName === 'IFRAME') {
    const frame = el as HTMLIFrameElement
    let sameOrigin = false
    try {
      sameOrigin = frame.contentDocument !== null
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) {
      sink.report('warning', DIAGNOSTIC_CODES.unsupportedCrossOriginIframe,
        'Содержимое iframe с другого источника недоступно.', id, true)
      return { code: DIAGNOSTIC_CODES.unsupportedCrossOriginIframe, label: 'iframe' }
    }
  }
  return null
}

/** Что делать с элементом как с изображением.
 *
 *  Один вызов решает ОБА исхода намеренно. Развести «дай ссылку» и
 *  «поставь заглушку» по двум функциям значило бы проверять условие
 *  загруженности дважды, в двух местах, — и разъехаться им ничто не
 *  мешает. А разъехавшись, они дали бы ровно тот дефект, из-за которого
 *  писался план: диагностика «нужна заглушка» при узле-фрейме.
 *
 *  До плана 4 `<img>` приезжал пустым фреймом БЕЗ единой записи в
 *  отчёте: 27628 расходящихся пикселей из 320000 на зонде, невидимых и
 *  для валидатора, и для pixel-diff, потому что ни одна фикстура
 *  изображений не содержала.
 *
 *  Читается `currentSrc`, а не `src`: при `srcset`/`<picture>` браузер
 *  уже выбрал источник, и снимать надо выбранный, иначе в бандл уедет
 *  не та картинка, которую видел пользователь. */
type ImageVerdict =
  | { kind: 'not-image' }
  | { kind: 'ref'; ref: ImageRef }
  | { kind: 'broken'; label: string }

const readImage = (
  el: Element,
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
  ctx: WalkContext,
  id: string,
): ImageVerdict => {
  if (el.tagName !== 'IMG') return { kind: 'not-image' }
  const img = el as HTMLImageElement
  if (img.currentSrc === '' || img.naturalWidth === 0 || img.naturalHeight === 0) {
    ctx.sink.report(
      'warning', DIAGNOSTIC_CODES.imageUnreadable,
      `Источник <img> не загружен: "${img.getAttribute('src') ?? ''}".`,
      id, true,
    )
    return { kind: 'broken', label: 'img' }
  }
  const natural = { w: img.naturalWidth, h: img.naturalHeight }
  return {
    kind: 'ref',
    ref: {
      assetId: ctx.requests.request(img.currentSrc, natural.w, natural.h, id, ctx.screenId),
      placement: placementFor(cs.objectFit, cs.objectPosition, box, natural),
    },
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Строит узел псевдоэлемента или сообщает, почему не строит.
 *
 *  Отдельной функцией, потому что у псевдоэлемента нет Element: всё,
 *  что о нём известно, приходит из вычисленного стиля, и путь
 *  обычного `buildNode` для него не годится ни в одной точке — ни
 *  измерение бокса, ни чтение текста, ни рекурсия внутрь.
 *
 *  `hostBox` нужен ради толщин рамки: абсолютный потомок
 *  отсчитывается от PADDING box хозяина, а `rect` узла — его border
 *  box. Без поправки декоративная полоска внутри карточки с рамкой
 *  уехала бы на толщину этой рамки — на пиксель-два, то есть ровно
 *  настолько, чтобы выглядеть правильно.
 */
const buildPseudo = (
  el: Element,
  hostCs: CSSStyleDeclaration,
  which: PseudoKind,
  hostBox: { x: number; y: number; w: number; h: number },
  ctx: WalkContext,
  hostId: string,
): Built | null => {
  const read: PseudoRead = readPseudo(el, hostCs, which)
  if (read.kind === 'absent' || read.kind === 'empty') return null

  if (read.kind === 'refused') {
    reportPseudoRefusal(read, which, ctx.sink, hostId)
    return null
  }

  const id = ctx.allocId()
  const cs = window.getComputedStyle(el, which)

  /** Поправка на рамку хозяина: содержащий блок абсолютного потомка —
   *  padding box, то есть border box минус толщины рамок. */
  const borderLeft = Number.parseFloat(hostCs.borderLeftWidth) || 0
  const borderTop = Number.parseFloat(hostCs.borderTopWidth) || 0
  const rect = {
    x: borderLeft + read.box.x,
    y: borderTop + read.box.y,
    w: read.box.w,
    h: read.box.h,
  }

  /** Отступы содержимого: паддинги плюс рамки самого псевдоэлемента. */
  const inset = (side: string): number =>
    (Number.parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0) +
    (Number.parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0)
  const contentInset = {
    top: inset('top'), right: inset('right'),
    bottom: inset('bottom'), left: inset('left'),
  }

  const base = {
    id,
    /** Имя говорит, откуда узел взялся: в панели слоёв Figma иначе
     *  появится безымянная коробка, которой нет в разметке. */
    sourceTag: which === '::before' ? 'before' : 'after',
    name: which,
    rect,
    paintOrder: -1,
    isStackingContext: false,
    transform: null,
    layout: readLayout(cs),
    selfLayout: readSelfLayout(cs),
    style: readStyle(cs, rect, ctx.sink, id, ctx.requests, ctx.screenId),
    children: [],
  }

  /** Узел построен, но часть содержимого в него не попала. Молчать
   *  нельзя: в макете окажется пустая плашка там, где на странице
   *  стоял номер или многострочная подпись. */
  if (read.lostText !== undefined) {
    reportPseudoRefusal(
      { refusal: read.lostText, hasPaint: true }, which, ctx.sink, hostId,
    )
  }

  const node: IrNode = read.text === null
    ? { ...base, kind: 'frame' }
    : {
        ...base, kind: 'text',
        text: {
          runs: [read.text.run],
          /** Строка одна — это проверено при разборе, а не
           *  предположено: многострочный псевдоэлемент сюда не
           *  доходит. Но лежит она в CONTENT box, а не в боксе узла:
           *  у бейджа с `padding: 2px 6px` текст иначе уехал бы в
           *  левый верхний угол своей же подложки. */
          lines: [{
            x: contentInset.left, y: contentInset.top,
            w: rect.w - contentInset.left - contentInset.right,
            h: rect.h - contentInset.top - contentInset.bottom,
            text: read.text.characters,
          }],
          lineHeight: read.text.lineHeight,
          align: read.text.align,
        },
      }

  const probe: LayoutProbe = {
    ...readProbe(el, cs, hostCs),
    id,
    children: [],
  }

  return { node, probe }
}

/** Отказ объясняется РАЗНЫМИ словами по разным причинам: пользователю
 *  нужно знать, потерян ли текст или оформление, и можно ли с этим
 *  что-то сделать. Общее «не переносится» не давало ни того, ни
 *  другого — а таких записей на живых страницах было больше всех
 *  прочих вместе. */
const reportPseudoRefusal = (
  read: { refusal: PseudoRefusal; hasPaint: boolean },
  which: PseudoKind,
  sink: DiagnosticSink,
  hostId: string,
): void => {
  const { refusal } = read
  if (refusal.reason === 'multiline') {
    sink.report('warning', DIAGNOSTIC_CODES.deferredPseudoElement,
      `Псевдоэлемент ${which} несёт текст "${refusal.content.slice(0, 40)}" ` +
      `в несколько строк. Боксов строк у псевдоэлемента нет, и место ` +
      `переносов взять неоткуда — поставленный наугад текст выглядел бы ` +
      `перенесённым.`, hostId, false)
    return
  }
  if (refusal.reason === 'generated') {
    sink.report('warning', DIAGNOSTIC_CODES.deferredPseudoElement,
      `Псевдоэлемент ${which} несёт сгенерированное содержимое ` +
      `${refusal.content.slice(0, 40)}. Вычисленный стиль отдаёт его как ` +
      `записано, без значения: номер счётчика или значение атрибута взять ` +
      `неоткуда, а подставленная догадка написала бы в макете неверное ` +
      `число.`, hostId, false)
    return
  }
  if (refusal.reason === 'containing-block') {
    sink.report('info', DIAGNOSTIC_CODES.deferredPseudoElement,
      `Псевдоэлемент ${which} позиционирован не от своего хозяина ` +
      `(position: fixed или хозяин не позиционирован), поэтому его ` +
      `координаты отсчитаны от другого элемента и сложить их не с чем.`,
      hostId, false)
    return
  }
  sink.report(
    read.hasPaint ? 'warning' : 'info', DIAGNOSTIC_CODES.deferredPseudoElement,
    `Псевдоэлемент ${which} стоит в потоке, а не позиционирован. ` +
    `У псевдоэлемента нет узла в DOM, поэтому его размер и положение в ` +
    `потоке измерить нечем: вычисленный стиль отдаёт их как auto.`,
    hostId, false)
}

type Built = { node: IrNode; probe: LayoutProbe }

const buildNode = (
  el: Element,
  parentCs: CSSStyleDeclaration | null,
  ctx: WalkContext,
): Built | null => {
  const cs = window.getComputedStyle(el)
  if (!isRendered(el, cs)) return null

  const id = ctx.allocId()
  reportGaps(el, cs, ctx.sink, id)

  const ownMatrixRaw = parseMatrix(cs.transform)
  const rawRect = el.getBoundingClientRect()

  /** Читается ли НЕтрансформированный бокс из вычисленного стиля. Тот же
   *  признак отвечает, применил ли браузер объявленную трансформу: у
   *  незамещаемого строчного элемента computed `width` равен `auto`, и
   *  трансформа к нему не применяется — см. `appliesTransform`. */
  const boxReadable = appliesTransform(cs)
  const usable = ownMatrixRaw !== null && !hasSkew(ownMatrixRaw) && boxReadable

  const origin = readOrigin(cs)
  /** Собственная матрица, приведённая к форме вокруг нуля. Единичная,
   *  когда трансформы нет ИЛИ она непереносима (сдвиг, трёхмерная,
   *  неприменённая): в этих случаях она отсутствует и в поле `transform`,
   *  и рендерер её не применит — значит и здесь её быть не должно. */
  const ownMatrix = usable && ownMatrixRaw !== null
    ? matrixAboutOrigin(ownMatrixRaw, origin)
    : IDENTITY_MATRIX

  /** Размер НЕтрансформированного бокса. `untransformedSize` годится
   *  только когда бокс читается: на строчном элементе `cs.width` равен
   *  `auto`, и безусловный вызов схлопнул бы каждый `<span>` в точку — он
   *  исчез бы из рендера молча. Там, где бокс не читается, трансформа к
   *  элементу и не применена, поэтому габарит `getBoundingClientRect()` и
   *  есть нетрансформированный размер. */
  const size = boxReadable
    ? untransformedSize(cs)
    : { w: rawRect.width, h: rawRect.height }

  /** Полная цепочка: сначала собственная матрица узла, затем матрицы
   *  предков. Единичную собственную матрицу пропускаем по ссылке — это
   *  подавляющее большинство узлов, а произведение с единичной побитово
   *  равно исходной матрице, так что сокращение точное, а не приближённое. */
  const ownIsIdentity = ownMatrix === IDENTITY_MATRIX
  const total = ownIsIdentity
    ? ctx.ancestorMatrix
    : multiplyMatrix(ctx.ancestorMatrix, ownMatrix)
  const totalInverse = ownIsIdentity ? ctx.ancestorInverse : invertMatrix(total)

  const screenOrigin = originUnderMatrix(el, total, size)

  /** Положение выражается относительно родителя — в ЕГО осях, а не в
   *  экранных. Разность экранных нулей под повёрнутым предком повёрнута
   *  вместе с ним, поэтому её приходится вернуть в оси родителя обратной
   *  матрицей; собственная трансформа узла из результата вычитается,
   *  потому что уезжает отдельным полем. Оба шага живут в `localOffset`.
   *
   *  Вырожденная цепочка предков (`scale(0)` выше по дереву) схлопывает
   *  всё поддерево в точку. Нулевое смещение — честный ответ для этого
   *  случая, а не заглушка: именно так это и выглядит. На практике
   *  недостижимо, потому что такой предок не проходит `isRendered`. */
  const local = ctx.ancestorInverse === null
    ? { x: 0, y: 0 }
    : localOffset({
        screenOrigin,
        parentOrigin: ctx.parentOrigin,
        ancestorInverse: ctx.ancestorInverse,
        ownMatrix,
      })

  const box = { x: local.x, y: local.y, w: size.w, h: size.h }

  const transform: Transform | null = usable && ownMatrixRaw !== null
    ? { ...decomposeMatrix(ownMatrixRaw), originX: origin.x, originY: origin.y }
    : null

  const children: IrNode[] = []
  const childProbes: LayoutProbe[] = []

  /** Трансформа есть, но не переносится: скос или трёхмерная матрица.
   *  Она не попадёт в накопленную матрицу, поэтому все потомки унаследуют
   *  ошибку положения и должны быть об этом предупреждены. */
  const brokenTransform = ownMatrixRaw !== null && !usable

  /** Векторный корень. Содержимое SVG уезжает ОДНИМ узлом, исходником,
   *  и потому вглубь обход не идёт: пройденные отдельно `<path>` дали бы
   *  второй комплект узлов поверх того же изображения — и в отчёте это
   *  выглядело бы как «всё перенеслось», хотя нарисовано дважды. */
  const isVectorRoot = el.namespaceURI === SVG_NS
    && el.tagName.toLowerCase() === 'svg'
  const vector = isVectorRoot ? readVector(el, size, id) : null

  /** Порядок детей нормализуется по -reverse: сам порядок отрисовки
   *  живёт в paintOrder, а здесь он логический, раскладочный. */
  const ordered = isVectorRoot
    ? []
    : isReversed(cs) ? [...el.children].reverse() : [...el.children]

  const childCtx: WalkContext = {
    ...ctx,
    ancestorMatrix: total,
    ancestorInverse: invertMatrix(total),
    parentOrigin: screenOrigin,
    insideBrokenTransform: ctx.insideBrokenTransform || brokenTransform,
  }

  /** Псевдоэлемент — ребёнок хозяина, и по CSS `::before` идёт перед
   *  его содержимым, а `::after` после. Порядок детей здесь
   *  логический, а порядок отрисовки посчитает резолвер по пробам —
   *  поэтому псевдоузлы обязаны попасть и в дерево узлов, и в дерево
   *  проб. Забыть второе нельзя: карта порядка тогда не содержала бы
   *  узла, а это не «данные не пришли», а рассинхрон, и `applyPaintOrder`
   *  убивает захват намеренно. */
  const pseudoBefore = buildPseudo(el, cs, '::before', box, ctx, id)
  if (pseudoBefore !== null) {
    children.push(pseudoBefore.node)
    childProbes.push(pseudoBefore.probe)
  }

  for (const child of ordered) {
    const built = buildNode(child, cs, childCtx)
    if (built === null) continue
    children.push(built.node)
    childProbes.push(built.probe)
  }

  const pseudoAfter = buildPseudo(el, cs, '::after', box, ctx, id)
  if (pseudoAfter !== null) {
    children.push(pseudoAfter.node)
    childProbes.push(pseudoAfter.probe)
  }

  const base = {
    id,
    sourceTag: el.tagName.toLowerCase(),
    name: el.tagName.toLowerCase(),
    /** Координаты родителя. Прокрутка сюда больше не прибавляется: она
     *  входит в положение КОРНЯ и наследуется вложенностью, а прибавленная
     *  на каждом уровне сложилась бы столько раз, какова глубина. Корню её
     *  добавляет `walkDocument` после обхода. */
    rect: box,
    // Заполняется вторым проходом: требует готового дерева.
    paintOrder: -1,
    isStackingContext: false,
    transform,
    layout: readLayout(cs),
    selfLayout: readSelfLayout(cs),
    style: readStyle(cs, box, ctx.sink, id, ctx.requests, ctx.screenId),
    children,
  }

  /** Потомок трансформированного предка переносится НЕВЕРНО: его `rect`
   *  снят как осепараллельный габарит уже повёрнутого элемента, потому что
   *  `getBoundingClientRect()` включает трансформы предков, а рендерер
   *  рисует его неповёрнутым.
   *
   *  Геометрию это не чинит — чинит честность. Пока трансформы были
   *  отложены, родитель нёс `deferred.transform`, и инвариант заставлял
   *  бандл объяснить, что поддерево не перенесено. Когда родитель стал
   *  переноситься верно, объяснение исчезло, а неверность потомков
   *  осталась: улучшение корректности породило молчаливую потерю.
   *  Исправление геометрии — отдельная работа, требующая хранить `rect`
   *  в локальных координатах родителя и композировать трансформы вниз. */
  if (ctx.insideBrokenTransform) {
    ctx.sink.report(
      'warning', DIAGNOSTIC_CODES.transformDescendant,
      'Узел лежит внутри предка с непереносимой трансформой (скос или ' +
      'трёхмерная): её нет в накопленной матрице, поэтому положение узла ' +
      'унаследовало ошибку предка.',
      id, false,
    )
  }

  const placeholder = placeholderFor(el, ctx.sink, id)
  const image = readImage(el, cs, box, ctx, id)
  let node: IrNode
  if (isVectorRoot) {
    if (vector === null) {
      /** Заглушка, а не пустой фрейм: иконка, исчезнувшая молча,
       *  неотличима от места, где её и не было. Парная диагностика с
       *  `needsPlaceholder: true` обязательна — инвариант в `@w2f/ir`
       *  отвергнет заглушку, которую отчёт не объясняет. */
      ctx.sink.report('warning', DIAGNOSTIC_CODES.vectorUnreadable,
        'Векторный элемент не удалось собрать самодостаточно.', id, true)
      node = {
        ...base, kind: 'placeholder',
        placeholder: { code: DIAGNOSTIC_CODES.vectorUnreadable, label: 'svg' },
      }
    } else {
      if (el.querySelector('foreignObject') !== null) {
        ctx.sink.report('warning', DIAGNOSTIC_CODES.deferredForeignObject,
          '<foreignObject> внутри SVG: HTML внутри вектора приедет в ' +
          'Figma пустым, хотя в браузере он виден.', id, false)
      }
      if (vector.collidingIds.length > 0) {
        ctx.sink.report('warning', DIAGNOSTIC_CODES.vectorIdCollision,
          `Идентификаторы ${vector.collidingIds.join(', ')} встречаются в ` +
          `документе выше по порядку: браузер разрешал ссылки в чужой ` +
          `элемент. Захват сделан самодостаточным и рисует написанное в ` +
          `этой разметке, а не то, что показала страница.`, id, false)
      }
      node = { ...base, kind: 'vector', vector: vector.source }
    }
  } else if (image.kind === 'ref') {
    node = { ...base, kind: 'image', image: image.ref }
  } else if (image.kind === 'broken') {
    /** Незагруженный `<img>` обязан стать ЗАГЛУШКОЙ, а не фреймом:
     *  `readImage` уже сообщил с `needsPlaceholder: true`, и инвариант
     *  требует, чтобы узел это подтвердил. Пустой фрейм он отвергнет —
     *  и правильно сделает: именно так дыра и выглядела молча. */
    node = {
      ...base, kind: 'placeholder',
      placeholder: { code: DIAGNOSTIC_CODES.imageUnreadable, label: image.label },
    }
  } else if (placeholder !== null) {
    node = { ...base, kind: 'placeholder', placeholder }
  } else {
    const text = readText(el, cs, screenOrigin)
    if (text.kind === 'text') {
      /** Фактический шрифт отличается от объявленного — главный убийца
       *  точности. Уровень error намеренно: `lines` содержат метрики
       *  фактического шрифта, и если в Figma объявленный шрифт установлен,
       *  плагин применит к нему чужие метрики и получит вылезающий текст,
       *  считая при этом, что шрифт найден. */
      if (hasFontFallback(cs)) {
        const stack = parseFontStack(cs.fontFamily)
        ctx.sink.report(
          'error', DIAGNOSTIC_CODES.fontFallback,
          `Объявлен "${stack[0] ?? '?'}", браузер рисовал ` +
          `"${text.text.runs[0]?.usedFamily ?? '?'}". Метрики строк — от ` +
          `фактического шрифта.`,
          id, false,
        )
      }
      node = { ...base, kind: 'text', text: text.text }
    } else {
      if (text.kind === 'lost') {
        ctx.sink.report('warning', DIAGNOSTIC_CODES.textLost,
          `Текст "${text.sample}" не дал ни одного бокса строки и потерян.`, id, false)
      }
      node = { ...base, kind: 'frame' }
    }
  }

  const probe: LayoutProbe = {
    ...readProbe(el, cs, parentCs),
    id,
    children: childProbes,
  }

  return { node, probe }
}

/** Порядок отрисовки считается вторым проходом: он требует готового дерева.
 *
 *  Промах по карте — НЕ данные, которые надо продиагностировать, а
 *  рассинхрон дерева узлов и дерева проб, то есть баг продюсера. Он обязан
 *  убить захват здесь, в расширении. Мягкий вариант `?? 0` присвоил бы
 *  нулевой порядок всем непопавшим узлам, а на 50 000 узлов это даёт
 *  сообщение об ошибке на 7,8 МБ в UI плагина Figma — измерено. */
const applyPaintOrder = (
  node: IrNode,
  order: Map<string, number>,
  contexts: Set<string>,
): void => {
  const resolved = order.get(node.id)
  if (resolved === undefined) {
    throw new Error(
      `Порядок отрисовки не содержит узла ${node.id} (${node.sourceTag}). ` +
      `Дерево узлов и дерево проб рассинхронизированы — это баг сериализатора.`,
    )
  }
  node.paintOrder = resolved
  node.isStackingContext = contexts.has(node.id)
  for (const child of node.children) applyPaintOrder(child, order, contexts)
}

/** Собирает идентификаторы узлов, создающих stacking context.
 *  Признак вычисляется тем же предикатом, что использует резолвер, —
 *  дублировать его логику нельзя, иначе два места разойдутся. Плагин
 *  восстановить признак не может: ни `transform`, ни `filter`, ни
 *  `isolation` по отдельности в IR не лежат. */
const collectStackingContexts = (probe: LayoutProbe, out: Set<string>): void => {
  if (establishesStackingContext(probe)) out.add(probe.id)
  for (const child of probe.children) collectStackingContexts(child, out)
}

/** Собирает требования к шрифтам из текстовых узлов поддерева.
 *
 *  Данные есть только здесь, а нужны на уровне бандла: инвариант
 *  `font.uncovered` в `@w2f/ir` требует, чтобы каждое использованное в
 *  тексте семейство было перечислено в `Bundle.fonts`, иначе плагин не
 *  сможет предзагрузить шрифт и создание текста упадёт посреди
 *  построения. Обходчик их не записывает — это не его уровень — но
 *  отдаёт наружу, чтобы сборщику бандла было откуда взять. */
export const collectFonts = (node: IrNode): FontRequirement[] => {
  const seen = new Map<string, FontRequirement>()
  const visit = (current: IrNode): void => {
    if (current.kind === 'text') {
      for (const run of current.text.runs) {
        const key = `${run.usedFamily}|${run.fontWeight}|${run.fontStyle}`
        if (!seen.has(key)) {
          seen.set(key, {
            family: run.usedFamily,
            weight: run.fontWeight,
            style: run.fontStyle,
          })
        }
      }
    }
    for (const child of current.children) visit(child)
  }
  visit(node)
  return [...seen.values()]
}

export const walkDocument = (
  sink: DiagnosticSink,
  allocId: IdAllocator,
  requests: AssetRequests,
  screenId: string,
): IrNode | null => {
  const ctx: WalkContext = {
    sink,
    requests,
    screenId,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    allocId,
    insideBrokenTransform: false,
    ancestorMatrix: IDENTITY_MATRIX,
    ancestorInverse: IDENTITY_MATRIX,
    parentOrigin: { x: 0, y: 0 },
  }

  const built = buildNode(document.body, null, ctx)
  if (built === null) return null

  /** Корень — единственный узел, чей `rect` абсолютен, и прокрутку несёт
   *  он один. Все остальные выражены относительно родителя, поэтому
   *  получают её по наследству через вложенность. Складывать её на каждом
   *  уровне, как делал прежний обходчик, теперь означало бы умножить
   *  смещение на глубину дерева. */
  built.node.rect = {
    ...built.node.rect,
    x: built.node.rect.x + window.scrollX,
    y: built.node.rect.y + window.scrollY,
  }

  /** Фон страницы часто объявлен на `<html>`, а обход начинается с `<body>`.
   *  Браузер красит им весь холст, поэтому без переноса тёмная страница
   *  приехала бы на белом фоне. Поймать это ниже по конвейеру нечем:
   *  обход просто не доходит до элемента, где фон объявлен, и в бандле не
   *  остаётся следа — ни валидатору, ни pixel-diff не за что зацепиться. */
  const htmlStyle = window.getComputedStyle(document.documentElement)
  const htmlBackground = parseColor(htmlStyle.backgroundColor)
  if (
    htmlBackground !== null &&
    !isInvisible(htmlBackground) &&
    built.node.style.fills.length === 0
  ) {
    built.node.style.fills = [{ kind: 'solid', color: htmlBackground }]
    sink.report(
      'info', DIAGNOSTIC_CODES.pageBackgroundMoved,
      `Фон страницы объявлен на <html> и перенесён на корневой узел: ` +
      `rgb(${htmlBackground.r},${htmlBackground.g},${htmlBackground.b}).`,
      built.node.id, false,
    )
  }

  const order = resolvePaintOrder(built.probe)
  const contexts = new Set<string>()
  collectStackingContexts(built.probe, contexts)
  applyPaintOrder(built.node, order, contexts)

  /** Перенос всплывших — ПОСЛЕ нумерации и по ней.
   *
   *  Резолвер уже сказал, что красится позже родителя; здесь это
   *  становится фактом дерева, потому что иначе исполнить его некому:
   *  и SVG, и Figma рисуют потомка внутри родителя. */
  const lifted = hoistEscaped(built.node)

  for (const move of lifted.hoisted) {
    sink.report(
      'info', DIAGNOSTIC_CODES.paintOrderHoisted,
      `Узел перенесён к предку "${move.toId}": по CSS у его родителя ` +
      `position задан, а z-index равен auto, поэтому узел участвует в ` +
      `стекинге предка и красится позже соседей родителя. Выразить это ` +
      `вложенностью нельзя — ни в SVG, ни в Figma, — поэтому изменилась ` +
      `иерархия слоёв, а не только порядок.`,
      move.id, false,
    )
  }

  /** Диагностика приближения выдаётся ТОЛЬКО там, где перенос не
   *  удался. Выдавать её везде, где есть псевдоконтекст, теперь было
   *  бы шумом: порядок там верен. На захвате figma.com таких записей
   *  было 431 — и почти все про места, где всплытие ни на что не
   *  влияло. */
  for (const id of lifted.blockedByTransform) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.paintOrderApproximated,
      'Порядок отрисовки приближён: узел должен участвовать в стекинге ' +
      'предка, но на пути к нему есть трансформа, и перенести узел без ' +
      'искажения координат нельзя. Он остался на месте — порядок может ' +
      'отличаться.',
      id, false,
    )
  }

  /** Разрыв считается по ФАКТИЧЕСКОМУ дереву — тому, что поедет в
   *  Figma, — и после переноса.
   *
   *  Прежняя редакция считала его по дереву ДО переноса и потому
   *  сообщала о разрывах, которых в результате не осталось: на
   *  `fixtures/pseudo-stacking` — о четырёх, при нулевом расхождении
   *  пикселей. Диагностика, предупреждающая о том, что уже исправлено,
   *  хуже отсутствующей: она учит не верить отчёту. */
  for (const id of lifted.stillWrong) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.paintOrderInterleaved,
      'Порядок отрисовки остался неверным: этот узел обязан краситься ' +
      'иначе, чем его нарисует вложенное дерево, а перенести его некуда — ' +
      'в Figma z-порядок задаётся порядком среди сиблингов, и такое ' +
      'расположение вложенностью не выражается.',
      id, false,
    )
  }

  return built.node
}
