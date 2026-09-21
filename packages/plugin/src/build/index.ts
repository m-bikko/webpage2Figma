import { DIAGNOSTIC_CODES } from '@h2d/ir/codes'
import type {
  Asset, Bundle, Diagnostic, Fill, IrNode, NodeStyle, Screen, Shadow,
} from '@h2d/ir'
import type {
  FontRequest, Scene, SceneBase, SceneEffect, SceneNode, ScenePaint,
  SceneScreen, SceneStroke, SceneText,
} from '../scene.js'
import {
  figmaRotation, originOffset, scaleSubtree, sizeUnderTransform,
} from './geometry.js'
import { figmaRgba, gradientPaint, solidPaint } from './paint.js'
import { imageNodeFor } from './image.js'

/** Режимы наложения CSS и Figma пишутся по-разному: `multiply` против
 *  `MULTIPLY`, `color-dodge` против `COLOR_DODGE`. Перевод механический,
 *  но молча отдать неизвестное значение нельзя — Figma откажет при
 *  присваивании, и отказ придёт из применителя, где разбираться труднее
 *  всего. */
const BLEND: Record<string, string> = {
  normal: 'NORMAL', multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY',
  darken: 'DARKEN', lighten: 'LIGHTEN', 'color-dodge': 'COLOR_DODGE',
  'color-burn': 'COLOR_BURN', 'hard-light': 'HARD_LIGHT',
  'soft-light': 'SOFT_LIGHT', difference: 'DIFFERENCE', exclusion: 'EXCLUSION',
  hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY',
}

/** Пунктир. Шаги СОГЛАСОВАНЫ с тем, что рисует референс-рендерер:
 *  иначе круговой обход поймает расхождение — и будет прав, потому что
 *  две половины рисовали бы разное. */
const dashPatternFor = (style: 'solid' | 'dashed' | 'dotted', weight: number): number[] => {
  if (style === 'dashed') return [weight * 3, weight * 2]
  if (style === 'dotted') return [weight, weight]
  return []
}

const strokeFor = (style: NodeStyle): SceneStroke | null => {
  if (style.stroke === null) return null
  const { weight } = style.stroke
  /** Толщина сохраняется ПО СТОРОНАМ: Figma это умеет. Первая редакция
   *  сводила её к максимуму «как референс-рендерер» — но тот сводит не
   *  от хорошей жизни, а потому что одиночная обводка SVG имеет одну
   *  ширину на весь путь. Повторять чужое ограничение там, где его
   *  нет, значит терять данные. Круговой обход поймал это сразу: 1744
   *  расходящихся пикселя на фикстуре `boxes` — ровно то же число, что
   *  и у исходного дефекта рендерера в плане 2. */
  const longest = Math.max(weight.top, weight.right, weight.bottom, weight.left)
  return {
    paint: {
      type: 'SOLID',
      color: { r: style.stroke.color.r / 255, g: style.stroke.color.g / 255,
               b: style.stroke.color.b / 255 },
      opacity: style.stroke.color.a,
    },
    weight,
    /** Шаг пунктира считается от НАИБОЛЬШЕЙ стороны: у Figma
     *  `dashPattern` один на узел, по сторонам его не развести. */
    dashPattern: dashPatternFor(style.stroke.style === 'solid' ? 'solid'
      : style.stroke.style === 'dotted' ? 'dotted' : 'dashed', longest),
  }
}

const effectsFor = (style: NodeStyle): SceneEffect[] => {
  /** Формы взяты из официальных типов Figma: смещение — вектор, цвет —
   *  с альфой внутри, `visible` и `blendMode` обязательны. Похожая, но
   *  не та форма отвергается при присваивании — и отвергалась. */
  const effects: SceneEffect[] = style.shadows.map((shadow: Shadow) => ({
    type: shadow.kind === 'inner' ? 'INNER_SHADOW' as const : 'DROP_SHADOW' as const,
    color: figmaRgba(shadow.color),
    offset: { x: shadow.offsetX, y: shadow.offsetY },
    radius: shadow.blur, spread: shadow.spread,
    visible: true, blendMode: 'NORMAL' as const,
  }))
  if (style.blur !== null) {
    if (style.blur.layer > 0) {
      effects.push({
        type: 'LAYER_BLUR', blurType: 'NORMAL',
        radius: style.blur.layer, visible: true,
      })
    }
    /** Фоновое размытие в Figma ВЫРАЗИМО, в отличие от плоского
     *  референс-рендерера, у которого «за элементом» не существует.
     *  Поэтому здесь оно переносится, и диагностика `deferred.blur`
     *  для него снимается.
     *
     *  Правило про снятие диагностики: спроси, что ещё она прикрывала.
     *  `deferred.blur` покрывала ровно этот случай и ничего больше —
     *  размытие слоя переносилось с плана 2, а потомки размытого узла
     *  закрыты планом 3. */
    if (style.blur.background > 0) {
      effects.push({
        type: 'BACKGROUND_BLUR', blurType: 'NORMAL',
        radius: style.blur.background, visible: true,
      })
    }
  }
  return effects
}

const paintsFor = (
  fills: readonly Fill[],
  /** Размер бокса нужен градиенту: `gradientTransform` действует на
   *  нормализованных координатах, и на неквадратном боксе без поправки
   *  диагональный градиент уезжает. Найдено замером в Figma. */
  box: { w: number; h: number },
): ScenePaint[] => {
  const paints: ScenePaint[] = []
  for (const fill of fills) {
    if (fill.kind === 'solid') paints.push(solidPaint(fill.color))
    else if (fill.kind === 'gradient') paints.push(gradientPaint(fill.gradient, box))
    else if (fill.kind === 'image' && fill.ref.placement.mode === 'tile') {
      /** Плитка — единственный случай, когда краска ложится на САМ
       *  узел: повторение геометрией прямоугольника не выражается.
       *  Лишняя рамка вокруг неё давала артефакт обрезки — три
       *  расходящихся пикселя в один ряд на границе. */
      paints.push({
        type: 'IMAGE', assetId: fill.ref.assetId, scaleMode: 'TILE',
        scalingFactor: fill.ref.placement.scaleX,
      })
    }
    /** Остальные заливки-изображения краской на узле НЕ становятся: им
     *  нужен вложенный прямоугольник, чтобы размещение выражалось
     *  геометрией, а не режимом. Их собирает `imageChildFor`. */
  }
  return paints
}

/** Вложенный прямоугольник для заливки-изображения на обычном узле.
 *
 *  Первая редакция обрабатывала только узлы `kind: 'image'`, и фоновые
 *  картинки терялись целиком — круговой обход показал 38155
 *  расходящихся пикселей на фикстуре `image-bg`. Комментарий при этом
 *  утверждал, что случай обработан в `buildNode`; утверждение было
 *  неверным, и поймал его не он, а измерение. */
const imageChildFor = (
  node: IrNode,
  ctx: BuildCtx,
): SceneNode | null => {
  const fill = node.style.fills.find((candidate) => candidate.kind === 'image')
  if (fill === undefined || fill.kind !== 'image') return null
  /** Плитка уже стала краской на самом узле — см. `paintsFor`. */
  if (fill.ref.placement.mode === 'tile') return null
  const asset = ctx.assets.get(fill.ref.assetId)
  if (asset === undefined) return null
  const built = imageNodeFor(
    node.id, { x: 0, y: 0, w: node.rect.w, h: node.rect.h },
    fill.ref.placement, fill.ref.assetId,
    { width: asset.width, height: asset.height },
  )
  ctx.needsVerification.push(...built.needsVerification)
  return built
}

const textFor = (node: Extract<IrNode, { kind: 'text' }>): SceneText => {
  let cursor = 0
  const runs = node.text.runs.map((run) => {
    const start = cursor
    cursor += run.text.length
    return {
      start, end: cursor,
      family: run.usedFamily,
      /** Начертание Figma — строка вида «Regular»/«Bold»/«Italic».
       *  Перевод из веса и наклона приблизителен и потому вынесен
       *  в отдельную функцию с собственными тестами. */
      style: figmaFontStyle(run.fontWeight, run.fontStyle),
      fontSize: run.fontSize,
      letterSpacing: run.letterSpacing,
      color: figmaRgba(run.color),
      decoration: run.decoration,
    }
  })
  return {
    characters: node.text.runs.map((run) => run.text).join(''),
    runs,
    lineHeight: node.text.lineHeight,
    align: node.text.align,
  }
}

/** Вес CSS → начертание Figma.
 *
 *  Приблизительно по необходимости: Figma не знает числовых весов, у
 *  неё имена начертаний, и набор имён свой у каждого семейства.
 *  Промах отлавливается применителем при `loadFontAsync` и превращается
 *  в запись отчёта уровня error — метрики строк в IR сняты с
 *  фактического шрифта браузера, и подстановка чужого делает их ложью. */
export const figmaFontStyle = (weight: number, italic: 'normal' | 'italic'): string => {
  const name =
    weight >= 900 ? 'Black'
    : weight >= 800 ? 'ExtraBold'
    : weight >= 700 ? 'Bold'
    : weight >= 600 ? 'SemiBold'
    : weight >= 500 ? 'Medium'
    : weight >= 400 ? 'Regular'
    : weight >= 300 ? 'Light'
    : weight >= 200 ? 'ExtraLight'
    : 'Thin'
  if (italic !== 'italic') return name
  return name === 'Regular' ? 'Italic' : `${name} Italic`
}

type BuildCtx = {
  assets: Map<string, Asset>
  needsVerification: Scene['needsVerification']
  report: Diagnostic[]
  screenId: string
}

const backgroundFirst = (
  background: SceneNode | null,
  rest: SceneNode[],
): SceneNode[] => (background === null ? rest : [background, ...rest])

const baseFor = (node: IrNode, ctx: BuildCtx): SceneBase => {
  const size = sizeUnderTransform({ w: node.rect.w, h: node.rect.h }, node.transform)
  /** Поправка на разные точки преобразования: CSS работает вокруг
   *  центра, Figma — вокруг левого верхнего угла. Без неё узел с любой
   *  трансформой приезжает не на своё место, и при малых величинах это
   *  выглядит как небрежная вёрстка, а не как дефект переноса. */
  const shift = originOffset(node.transform)
  return {
    id: node.id,
    name: node.name,
    x: node.rect.x + shift.dx, y: node.rect.y + shift.dy,
    width: size.width, height: size.height,
    rotation: figmaRotation(node.transform),
    opacity: node.style.opacity,
    blendMode: BLEND[node.style.blend] ?? 'NORMAL',
    fills: paintsFor(node.style.fills, { w: node.rect.w, h: node.rect.h }),
    stroke: strokeFor(node.style),
    corner: node.style.corner,
    effects: effectsFor(node.style),
    /** Картинка-фон идёт ПЕРВЫМ ребёнком: в CSS `background-image`
     *  ложится над `background-color`, но под содержимым. */
    children: backgroundFirst(imageChildFor(node, ctx), childrenOf(node, ctx)),
  }
}

const childrenOf = (node: IrNode, ctx: BuildCtx): SceneNode[] => {
  /** Масштаб вписывается в поддерево ДО построения: `resize` в Figma
   *  детей не масштабирует, в отличие от CSS `transform: scale()`. */
  const scale = node.transform
  const kids = scale !== null && (scale.scaleX !== 1 || scale.scaleY !== 1)
    ? scaleSubtree(node.children, scale.scaleX, scale.scaleY)
    : node.children

  if (kids !== node.children) {
    ctx.report.push({
      level: 'info', code: DIAGNOSTIC_CODES.imageRecoded,
      message:
        `Масштаб ${scale?.scaleX} × ${scale?.scaleY} вписан в геометрию ` +
        `поддерева: resize в Figma детей не масштабирует. Картинка верна, ` +
        `но размеры потомков больше не совпадают с исходными.`,
      nodeId: node.id, screenId: ctx.screenId, needsPlaceholder: false,
    })
  }

  /** Порядок детей в Figma — это порядок ОТРИСОВКИ. Сортировка здесь,
   *  в чистой части, а применитель добавляет как есть и не сортирует. */
  return [...kids]
    .sort((a, b) => a.paintOrder - b.paintOrder)
    .map((child) => buildNode(child, ctx))
}

export const buildNode = (node: IrNode, ctx: BuildCtx): SceneNode => {
  if (node.kind === 'image') {
    const asset = ctx.assets.get(node.image.assetId)
    if (asset === undefined) {
      /** Ассета нет — узел обязан стать заглушкой, а не пустой рамкой.
       *  Бандл такое не пропустил бы (инвариант `asset.dangling`), но
       *  строитель не вправе полагаться на то, что его вызвали только
       *  с проверенным бандлом. */
      return {
        kind: 'placeholder', label: 'img',
        code: DIAGNOSTIC_CODES.imageUnreadable,
        base: baseFor(node, ctx),
      }
    }
    const built = imageNodeFor(
      node.id, node.rect, node.image.placement, node.image.assetId,
      { width: asset.width, height: asset.height },
    )
    ctx.needsVerification.push(...built.needsVerification)
    /** Собственные заливки и эффекты узла остаются на рамке: у `<img>`
     *  бывает фон, видимый в незакрытых полях при `contain`.
     *
     *  `built` — это либо обрезающая рамка (когда картинка выходит за
     *  бокс), либо сам прямоугольник. В первом случае его содержимое
     *  переносится внутрь нашей рамки вместе с обрезкой, во втором он
     *  просто становится ребёнком. */
    const base = baseFor(node, ctx)
    const inner = built.kind === 'frame' && built.base.children.length > 0
      ? built.base.children
      : [built]
    return {
      kind: 'frame',
      clipsContent: built.kind === 'frame' ? built.clipsContent : node.style.clip,
      base: { ...base, children: [...inner, ...base.children] },
    }
  }

  if (node.kind === 'placeholder') {
    return {
      kind: 'placeholder',
      label: node.placeholder.label,
      code: node.placeholder.code,
      base: baseFor(node, ctx),
    }
  }

  if (node.kind === 'text') {
    const base = baseFor(node, ctx)
    const text: SceneNode = {
      kind: 'text',
      /** Текст занимает ВЕСЬ бокс узла, поэтому стоит в нуле его
       *  координат и не несёт ни заливок, ни эффектов: они остались
       *  на обёртке, как и в CSS, где фон принадлежит блоку, а не
       *  строке. */
      base: {
        ...base, id: `${node.id}-text`,
        x: 0, y: 0, rotation: 0, opacity: 1, blendMode: 'NORMAL',
        fills: [], stroke: null,
        corner: { tl: 0, tr: 0, br: 0, bl: 0 },
        effects: [], children: [],
      },
      text: textFor(node),
    }

    /** БЕЗ детей текстовый узел остаётся текстовым узлом: лишняя
     *  обёртка — лишний слой в панели, и на странице с тысячами узлов
     *  это заметно. */
    if (base.children.length === 0) {
      return { kind: 'text', base, text: textFor(node) }
    }

    /** С детьми — обёртка обязательна. В Figma `appendChild` есть
     *  только у контейнеров; у текстового узла его нет вовсе, и
     *  попытка добавить ребёнка падает с «not a function» глубоко в
     *  рекурсии, где причина не видна.
     *
     *  Найдено на захвате настоящей страницы: `<div>` с текстом и
     *  вложенными элементами — обычная вёрстка, но ни одна фикстура
     *  такого не содержала.
     *
     *  Текст идёт ПЕРВЫМ ребёнком: в CSS собственное содержимое блока
     *  рисуется до вложенных элементов. */
    return {
      kind: 'frame',
      clipsContent: node.style.clip,
      base: { ...base, children: [text, ...base.children] },
    }
  }

  if (node.kind === 'vector') {
    /** Векторы отложены с плана 1 и здесь тоже: перенести кривые без
     *  способа их сверить значило бы выдать догадку за перенос. */
    return {
      kind: 'placeholder', label: 'vector',
      code: DIAGNOSTIC_CODES.deferredVector,
      base: baseFor(node, ctx),
    }
  }

  return { kind: 'frame', clipsContent: node.style.clip, base: baseFor(node, ctx) }
}

/** Шрифты, которые применитель обязан загрузить ДО построения текста.
 *  Отдельной функцией потому, что `loadFontAsync` асинхронен, а
 *  строитель чист: смешать их значило бы утащить в чистую часть
 *  ожидание, а в применитель — логику. */
export const fontsOf = (scene: SceneScreen[]): FontRequest[] => {
  const seen = new Set<string>()
  const fonts: FontRequest[] = []
  const visit = (node: SceneNode): void => {
    if (node.kind === 'text') {
      for (const run of node.text.runs) {
        const key = `${run.family}|${run.style}`
        if (!seen.has(key)) {
          seen.add(key)
          fonts.push({ family: run.family, style: run.style })
        }
      }
    }
    node.base.children.forEach(visit)
  }
  scene.forEach((screen) => { visit(screen.root) })
  return fonts
}

export const buildScreen = (
  screen: Screen,
  assets: Map<string, Asset>,
  report: Diagnostic[],
  needsVerification: Scene['needsVerification'],
): SceneScreen => ({
  id: screen.id,
  name: screen.name,
  width: screen.width,
  height: screen.height,
  root: buildNode(screen.root, { assets, needsVerification, report, screenId: screen.id }),
})

export const buildScene = (bundle: Bundle): Scene & { report: Diagnostic[] } => {
  const assets = new Map(bundle.assets.map((asset) => [asset.id, asset]))
  const needsVerification: Scene['needsVerification'] = []
  const report: Diagnostic[] = []
  const screens = bundle.screens.map(
    (screen) => buildScreen(screen, assets, report, needsVerification),
  )
  return { screens, fonts: fontsOf(screens), needsVerification, report }
}
