import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import type {
  Asset, Bundle, Diagnostic, Fill, IrNode, LayoutAlign, LayoutJustify,
  NodeStyle, Screen, Shadow,
} from '@w2f/ir'
import type {
  FontRequest, Scene, SceneAutoLayout, SceneBase, SceneEffect, SceneNode,
  ScenePaint, SceneScreen, SceneStroke, SceneText,
} from '../scene.js'
import {
  figmaRotation, originOffset, scaleSubtree, sizeUnderTransform,
} from './geometry.js'
import {
  figmaRgba, gradientPaint, radialGradientPaint, solidPaint,
} from './paint.js'
import { emptyBase, imageNodeFor } from './image.js'
import { resizeSvg } from './svg.js'
import { autoLayoutVerdict } from '../layout/verdict.js'

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
  nodeId: string,
  ctx: BuildCtx,
): ScenePaint[] => {
  const paints: ScenePaint[] = []
  for (const fill of fills) {
    if (fill.kind === 'solid') paints.push(solidPaint(fill.color))
    else if (fill.kind === 'gradient') {
      /** Ветвление по виду градиента, а не общая функция: краски у
       *  Figma разные (`GRADIENT_LINEAR` против `GRADIENT_RADIAL`), и
       *  матрицы строятся из разных величин. */
      if (fill.gradient.kind === 'linear') {
        paints.push(gradientPaint(fill.gradient, box))
      } else {
        paints.push(radialGradientPaint(fill.gradient, box))
        /** Соглашение о матрице для РАДИАЛЬНОГО градиента выведено, а
         *  не измерено: для линейного оно подтверждено экспортом из
         *  настоящей Figma, для радиального такого замера нет.
         *  Выдавать вывод за измерение нельзя — на то и заведён
         *  список «требует сверки глазами». */
        ctx.needsVerification.push({
          code: 'fidelity.gradient-unverified',
          nodeId,
          message:
            'Радиальный градиент: матрица построена по тому же ' +
            'соглашению, что у линейного, но для радиального оно ' +
            'замером не подтверждено. Сверьте центр и радиусы с ' +
            'оригиналом.',
        })
      }
    }
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
/** Вложенные прямоугольники для ВСЕХ заливок-изображений.
 *
 *  Их может быть несколько: многослойный фон — фотография под
 *  градиентом, две текстуры друг на друге — обычное дело. Прежняя
 *  редакция брала `find`, то есть ровно первую, и остальные слои
 *  молча пропадали.
 *
 *  Порядок сохраняется тот же, что в заливках: снизу вверх. */
const imageChildrenFor = (
  node: IrNode,
  ctx: BuildCtx,
): SceneNode[] => {
  const out: SceneNode[] = []
  for (const [index, fill] of node.style.fills.entries()) {
    if (fill.kind !== 'image') continue
    const asset = ctx.assets.get(fill.ref.assetId)
    if (asset === undefined) continue

    const svg = ctx.svgTexts.get(fill.ref.assetId)
    if (svg !== undefined) {
      /** Векторный фон: узел строится ВЕКТОРНЫМ, с той же геометрией
       *  размещения, что была бы у картинки. */
      const place = fill.ref.placement
      if (place.mode === 'tile') {
        /** Повтор вектора выразить нечем: плитка в Figma — свойство
         *  краски-изображения, а вектор краской не бывает. Рисуется
         *  один экземпляр, и об этом обязана быть запись — иначе
         *  повторяющийся узор молча станет одиночной иконкой. */
        ctx.needsVerification.push({
          code: DIAGNOSTIC_CODES.deferredRepeatMode,
          nodeId: node.id,
          message:
            'Повторяющийся векторный фон перенесён одним экземпляром: ' +
            'повтор в Figma есть только у краски-изображения, а вектор ' +
            'краской не бывает.',
        })
      }
      const drawn = {
        x: place.offsetX, y: place.offsetY,
        w: asset.width * place.scaleX, h: asset.height * place.scaleY,
      }
      out.push({
        kind: 'vector',
        /** Размер подставляется В САМ SVG: файл несёт свои
         *  `width`/`height`, а `background-size` может задать любые
         *  другие, и без подстановки иконка приедет исходного
         *  размера. */
        svg: resizeSvg(svg, drawn.w, drawn.h),
        base: emptyBase(`${node.id}-bg${index}`, 'vector', drawn),
      })
      continue
    }

    /** Плитка уже стала краской на самом узле — см. `paintsFor`. */
    if (fill.ref.placement.mode === 'tile') continue
    const built = imageNodeFor(
      /** Номер слоя входит в идентификатор: два прямоугольника с одним
       *  именем сделали бы круговой обход неоднозначным, а отчёт —
       *  указывающим не на тот узел. */
      `${node.id}-bg${index}`, { x: 0, y: 0, w: node.rect.w, h: node.rect.h },
      fill.ref.placement, fill.ref.assetId,
      { width: asset.width, height: asset.height },
    )
    ctx.needsVerification.push(...built.needsVerification)
    out.push(built)
  }
  return out
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
      fills: [solidPaint(run.color)],
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
  /** Исходники SVG-ассетов, по идентификатору. Векторный фон едет
   *  байтами, и строитель делает из него ВЕКТОРНЫЙ узел, а не
   *  картинку: `figma.createImage` SVG не принимает вовсе, а растр
   *  потерял бы то единственное, ради чего вектор и нужен. */
  svgTexts: Map<string, string>
  needsVerification: Scene['needsVerification']
  report: Diagnostic[]
  screenId: string
}

const backgroundFirst = (
  background: SceneNode[],
  rest: SceneNode[],
): SceneNode[] => [...background, ...rest]

/** Отображение ПОЛНОЕ, хотя вердикт и не пропускает сюда
 *  `space-around`/`space-evenly`: неполное дало бы `undefined` в
 *  присваивании, а Figma отвергает такое значение отказом, который
 *  всплыл бы только у пользователя. Значение для непропускаемых
 *  случаев выбрано безопасным, а не «каким-нибудь». */
const PRIMARY_ALIGN: Record<LayoutJustify,
  SceneAutoLayout['primaryAxisAlignItems']> = {
  start: 'MIN', center: 'CENTER', end: 'MAX',
  'space-between': 'SPACE_BETWEEN',
  'space-around': 'MIN', 'space-evenly': 'MIN',
}

const COUNTER_ALIGN: Record<LayoutAlign,
  SceneAutoLayout['counterAxisAlignItems']> = {
  start: 'MIN', center: 'CENTER', end: 'MAX',
  stretch: 'MIN', baseline: 'MIN',
}

/** Auto-layout для узла — или `null`, если навязывать его нельзя.
 *
 *  Отказ ВСЕГДА объясняется в отчёте. «Не применили» без причины не
 *  говорит дизайнеру, что поправить в вёрстке, и превращает отчёт в
 *  шум, который учатся игнорировать. */
const autoLayoutFor = (node: IrNode, ctx: BuildCtx): SceneAutoLayout | null => {
  /** Узлы без раскладки и без детей не отчитываются: их подавляющее
   *  большинство, и запись о каждом утопила бы отчёт. */
  if (node.layout.mode === 'none' || node.children.length === 0) return null

  const verdict = autoLayoutVerdict(node)
  if (!verdict.safe) {
    ctx.report.push({
      level: 'info', code: DIAGNOSTIC_CODES.autoLayoutRejected,
      message: `Auto-layout не применён: ${verdict.reason}.`,
      nodeId: node.id, screenId: ctx.screenId, needsPlaceholder: false,
    })
    return null
  }

  return {
    mode: verdict.mode === 'row' ? 'HORIZONTAL' : 'VERTICAL',
    /** Параметры берутся СВЁРНУТЫЕ: внешние отступы детей уже учтены
     *  в них, потому что у auto-layout отступов на ребёнке нет. */
    itemSpacing: verdict.gap,
    paddingTop: verdict.padding.top,
    paddingRight: verdict.padding.right,
    paddingBottom: verdict.padding.bottom,
    paddingLeft: verdict.padding.left,
    primaryAxisAlignItems: PRIMARY_ALIGN[node.layout.justify],
    counterAxisAlignItems: COUNTER_ALIGN[verdict.align],
    expected: verdict.expected.map((place) => ({ x: place.x, y: place.y })),
  }
}

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
    fills: paintsFor(
      node.style.fills, { w: node.rect.w, h: node.rect.h }, node.id, ctx,
    ),
    stroke: strokeFor(node.style),
    corner: node.style.corner,
    effects: effectsFor(node.style),
    autoLayout: autoLayoutFor(node, ctx),
    /** Картинка-фон идёт ПЕРВЫМ ребёнком: в CSS `background-image`
     *  ложится над `background-color`, но под содержимым. */
    children: backgroundFirst(imageChildrenFor(node, ctx), childrenOf(node, ctx)),
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
        /** Заливка узла — цвет ПЕРВОГО прогона. У текста в Figma нет
         *  отдельного свойства цвета, и пустой список делал весь
         *  текст невидимым: узлы на месте, размеры верные, читать
         *  нечего. Именно так «терялся» текст на живой странице. */
        fills: [solidPaint(node.text.runs[0].color)], stroke: null,
        corner: { tl: 0, tr: 0, br: 0, bl: 0 },
        effects: [], children: [],
      },
      text: textFor(node),
    }

    /** БЕЗ детей текстовый узел остаётся текстовым узлом: лишняя
     *  обёртка — лишний слой в панели, и на странице с тысячами узлов
     *  это заметно. */
    if (base.children.length === 0) {
      return {
        kind: 'text',
        base: { ...base, fills: [solidPaint(node.text.runs[0].color)] },
        text: textFor(node),
      }
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
    const base = baseFor(node, ctx)

    /** Голая иконка — а это подавляющее большинство векторов — едет
     *  ОДНИМ узлом, без обёртки. Безусловная обёртка удваивала бы
     *  число слоёв: на странице со 150 иконками это 150 лишних рамок
     *  в панели, каждая пустая. */
    const bare = base.fills.length === 0 && base.stroke === null
      && base.effects.length === 0 && base.children.length === 0
    if (bare) return { kind: 'vector', base, svg: node.vector.svg }

    /** С фоном, рамкой или тенью обёртка обязательна: у элемента
     *  `<svg>` они принадлежат БОКСУ, а не рисунку, и браузер красит
     *  их под ним. Узел из `createNodeFromSvg` несёт только рисунок,
     *  и навесить на него фон означало бы поменять их местами. */
    return {
      kind: 'frame',
      clipsContent: node.style.clip,
      base: {
        ...base,
        children: [
          {
            kind: 'vector',
            svg: node.vector.svg,
            base: {
              ...base, id: `${node.id}-svg`,
              x: 0, y: 0, rotation: 0, opacity: 1, blendMode: 'NORMAL',
              fills: [], stroke: null,
              corner: { tl: 0, tr: 0, br: 0, bl: 0 },
              effects: [], autoLayout: null, children: [],
            },
          },
          ...base.children,
        ],
      },
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
  svgTexts: Map<string, string> = new Map(),
): SceneScreen => ({
  id: screen.id,
  name: screen.name,
  width: screen.width,
  height: screen.height,
  root: buildNode(screen.root, {
    assets, svgTexts, needsVerification, report, screenId: screen.id,
  }),
})

export const buildScene = (
  bundle: Bundle,
  /** Исходники векторных ассетов. Приходят отдельно, потому что байты
   *  живут в файлах бандла, а не в его описании: строитель чист и сам
   *  архив не распаковывает. */
  svgTexts: Map<string, string> = new Map(),
): Scene & { report: Diagnostic[] } => {
  const assets = new Map(bundle.assets.map((asset) => [asset.id, asset]))
  const needsVerification: Scene['needsVerification'] = []
  const report: Diagnostic[] = []
  const screens = bundle.screens.map(
    (screen) => buildScreen(screen, assets, report, needsVerification, svgTexts),
  )
  return { screens, fonts: fontsOf(screens), needsVerification, report }
}

/** Зазор между экранами на холсте.
 *
 *  Не украшение: встык пять макетов читаются как один, и найти
 *  границу между 1920 и 1440 глазами невозможно. Величина выбрана
 *  заметной на глаз при любом масштабе просмотра. */
const SCREEN_GAP = 120

/** Раскладывает экраны в ряд.
 *
 *  Корень каждого экрана стоит в нуле СВОИХ координат — это верно
 *  внутри экрана и неверно на холсте. Первая редакция клала все пять
 *  в одну точку, и вместо пяти макетов получалось месиво; снаружи это
 *  выглядит как «импортировалось неправильно», хотя каждый экран по
 *  отдельности верен.
 *
 *  Найдено на импорте настоящей страницы: ни одна фикстура этого не
 *  показывала, потому что в тестах экран всегда был один.
 *
 *  Порядок не меняется — он задан порядком брейкпоинтов, от широкого
 *  к узкому, и переставлять его здесь значило бы решать за
 *  пользователя. */
/** Насколько далеко вправо простирается содержимое узла.
 *
 *  Считается по ПОДДЕРЕВУ, а не по самому узлу: при видимом
 *  переполнении ребёнок законно торчит за правый край родителя, и
 *  браузер его показывает. В Figma он торчит ровно так же. */
const rightEdgeOf = (node: SceneNode, offset = 0): number => {
  const own = offset + node.base.x + node.base.width
  return node.base.children.reduce(
    (widest, child) => Math.max(widest, rightEdgeOf(child, offset + node.base.x)),
    own,
  )
}

export const layOutScreens = (
  screens: readonly SceneScreen[],
): { id: string; x: number; y: number; width: number; height: number }[] => {
  let x = 0
  return screens.map((screen) => {
    /** Шаг считается по ФАКТИЧЕСКОЙ ширине содержимого, а не по
     *  ширине вьюпорта. Страница бывает шире: горизонтальное
     *  переполнение, абсолютно позиционированные элементы за краем.
     *  Раскладка по `screen.width` клала следующий экран ПОВЕРХ
     *  предыдущего — найдено на импорте настоящей страницы. */
    const extent = Math.max(screen.width, rightEdgeOf(screen.root))
    const placed = { id: screen.id, x, y: 0, width: extent, height: screen.height }
    x += extent + SCREEN_GAP
    return placed
  })
}
