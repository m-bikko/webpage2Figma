import type { Fill, IrNode, NodeStyle, Screen, Transform } from '@h2d/ir'
import type { SceneBase, SceneNode, SceneScreen } from './scene.js'

/** Обратная сборка сцены в IR — для кругового обхода.
 *
 *  ЗАЧЕМ. Figma здесь не запускается, а заглушка `figma` проверяла бы
 *  нашу имитацию, а не наш код. Поэтому построенная сцена собирается
 *  обратно в IR, рисуется уже существующим референс-рендерером и
 *  сравнивается с браузерным скриншотом тем же pixel-diff гейтом.
 *
 *  ЧЕГО ЭТО СТОИТ. Проверка имеет смысл ровно там, где `SceneSpec`
 *  устроен ИНАЧЕ, чем IR: узел-изображение стал рамкой с вложенным
 *  прямоугольником, масштаб вписан в поддерево, поворот сменил знак и
 *  единицы, положение поправлено на разную точку вращения. Там, где
 *  это переименование полей, круговой обход не доказывает ничего, и
 *  делать вид, что доказывает, нельзя.
 *
 *  ПОЧЕМУ ЭТО НЕ ЗАМКНУТО НА СЕБЯ. Обратное преобразование поворота
 *  написано не как «отменить то, что сделал строитель», а по
 *  документированной форме матрицы Figma:
 *
 *      поворот = [[cos, sin, 0], [-sin, cos, 0]]
 *
 *  Отсюда ось X равна `(cos, −sin)`, что в терминах CSS-матрицы даёт
 *  `a = cos`, `b = −sin`, и наш угол `atan2(b, a) = −r`. Если строитель
 *  ошибётся со знаком или единицами, здесь ошибка НЕ повторится, и
 *  pixel-diff это увидит. Проверено сломом.
 *
 *  Градиенты — исключение, названное прямо: документация формулы
 *  `gradientTransform` не даёт, обе стороны используют одно и то же
 *  неподтверждённое соглашение, и системную ошибку в нём круговой
 *  обход поймать не может. */

const EMPTY_STYLE: NodeStyle = {
  fills: [], stroke: null, corner: { tl: 0, tr: 0, br: 0, bl: 0 },
  shadows: [], opacity: 1, blend: 'normal', blur: null, clip: false,
}

/** Угол CSS из `rotation` Figma — через документированную форму
 *  матрицы, а не обращением формулы строителя. */
const angleFromFigma = (rotationDegrees: number): number => {
  const r = (rotationDegrees * Math.PI) / 180
  /** Ось X матрицы поворота Figma: (cos r, −sin r). В терминах
   *  CSS-матрицы это a = cos r, b = −sin r. */
  const a = Math.cos(r)
  const b = -Math.sin(r)
  return Math.atan2(b, a)
}

const transformFrom = (base: SceneBase): Transform | null => {
  if (base.rotation === 0) return null
  return {
    angle: angleFromFigma(base.rotation),
    scaleX: 1, scaleY: 1,
    translateX: 0, translateY: 0,
    /** Figma вращает вокруг ЛЕВОГО ВЕРХНЕГО УГЛА — значит в терминах
     *  CSS это `transform-origin: 0 0`. Строитель уже внёс поправку в
     *  координаты, поэтому обратно она не применяется: здесь описано
     *  то, что Figma сделает, а не то, что было в CSS. */
    originX: 0, originY: 0,
  }
}

const styleFrom = (base: SceneBase): NodeStyle => ({
  ...EMPTY_STYLE,
  opacity: base.opacity,
  corner: base.corner,
  blend: base.blendMode === 'NORMAL' ? 'normal'
    : base.blendMode.toLowerCase().replace(/_/g, '-') as NodeStyle['blend'],
  fills: base.fills.flatMap((paint): Fill[] => {
    if (paint.type === 'SOLID') {
      return [{
        kind: 'solid' as const,
        color: {
          r: Math.round(paint.color.r * 255),
          g: Math.round(paint.color.g * 255),
          b: Math.round(paint.color.b * 255),
          a: paint.opacity,
        },
      }]
    }
    if (paint.type === 'GRADIENT_LINEAR') {
      /** Обращение матрицы обратно в пару концов.
       *
       *  ЗДЕСЬ КРУГОВОЙ ОБХОД САМОСОГЛАСОВАН, и это сказано прямо:
       *  документация формулы `gradientTransform` не даёт, обе стороны
       *  пользуются одним неподтверждённым соглашением, и системную
       *  ошибку в его понимании эта проверка поймать не может. Что она
       *  ловит: потерю градиента целиком, перепутанный порядок
       *  остановок, потерянную альфу, сбитую нормализацию позиций.
       *  Первая редакция теряла градиент целиком — 762118 расходящихся
       *  пикселей, — и это она поймала. */
      /** Обращение матрицы обратно в пару концов. Матрица включает
       *  разворот нормализованных координат в пиксели, поэтому сначала
       *  снимается он — делением первого столбца на ширину, второго на
       *  высоту, — и только потом обращается размещение. Без этого
       *  шага обратный путь разошёлся бы с прямым на любом
       *  неквадратном боксе. */
      const w = base.width === 0 ? 1 : base.width
      const h = base.height === 0 ? 1 : base.height
      const [[m00, m01, m02], [m10, m11, m12]] = paint.gradientTransform
      const a = m00 / w
      const c = m01 / h
      const e = m02
      const b = m10 / w
      const d = m11 / h
      const f = m12
      const determinant = a * d - b * c
      if (determinant === 0) return []
      const placement = [
        [d / determinant, -c / determinant, (c * f - d * e) / determinant],
        [-b / determinant, a / determinant, (b * e - a * f) / determinant],
      ] as const
      /** Концы получаются в пикселях и нормализуются обратно по боксу. */
      const from = { x: placement[0][2] / w, y: placement[1][2] / h }
      const to = {
        x: (placement[0][0] + placement[0][2]) / w,
        y: (placement[1][0] + placement[1][2]) / h,
      }
      return [{
        kind: 'gradient' as const,
        gradient: {
          kind: 'linear' as const, from, to,
          stops: paint.gradientStops.map((stop) => ({
            offset: stop.position,
            color: {
              r: Math.round(stop.color.r * 255),
              g: Math.round(stop.color.g * 255),
              b: Math.round(stop.color.b * 255),
              a: stop.color.a,
            },
          })),
        },
      }]
    }
    return []
  }),
  stroke: base.stroke === null ? null : {
    color: {
      r: Math.round(base.stroke.paint.color.r * 255),
      g: Math.round(base.stroke.paint.color.g * 255),
      b: Math.round(base.stroke.paint.color.b * 255),
      a: base.stroke.paint.opacity,
    },
    weight: base.stroke.weight,
    style: base.stroke.dashPattern.length === 0 ? 'solid'
      : base.stroke.dashPattern[0] === base.stroke.dashPattern[1] ? 'dotted' : 'dashed',
    align: 'inside',
  },
  shadows: base.effects.flatMap((effect) =>
    effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
      ? [{
          kind: effect.type === 'INNER_SHADOW' ? 'inner' as const : 'outer' as const,
          color: {
            r: Math.round(effect.color.r * 255),
            g: Math.round(effect.color.g * 255),
            b: Math.round(effect.color.b * 255),
            a: effect.color.a,
          },
          offsetX: effect.offset.x, offsetY: effect.offset.y,
          blur: effect.radius, spread: effect.spread,
        }]
      : []),
  blur: (() => {
    const layer = base.effects.find((e) => e.type === 'LAYER_BLUR')
    const background = base.effects.find((e) => e.type === 'BACKGROUND_BLUR')
    if (layer === undefined && background === undefined) return null
    return {
      layer: layer !== undefined && 'radius' in layer ? layer.radius : 0,
      background: background !== undefined && 'radius' in background ? background.radius : 0,
    }
  })(),
})

/** Натуральные размеры источников. Нужны, чтобы восстановить узел
 *  изображения из вложенного прямоугольника: строитель выразил
 *  размещение его геометрией, и обратный путь обязан пройти тем же
 *  местом, иначе круговой обход проверял бы не то преобразование. */
export type NaturalSizes = ReadonlyMap<string, { width: number; height: number }>

const nodeFrom = (
  node: SceneNode,
  order: { value: number },
  natural: NaturalSizes,
): IrNode => {
  const { base } = node
  const children = base.children.map((child) => nodeFrom(child, order, natural))
  const paintOrder = order.value
  order.value += 1

  const common = {
    id: base.id,
    sourceTag: 'div',
    name: base.name,
    rect: { x: base.x, y: base.y, w: base.width, h: base.height },
    paintOrder,
    /** Группа нужна узлу, которому есть что в неё завернуть: детей
     *  (изоляция наложения, установленная измерением в плане 3) или
     *  собственную трансформу (референс-рендерер вешает её на ту же
     *  группу).
     *
     *  Условие выведено двумя измерениями, а не рассуждением. Сначала
     *  контекстами объявлялись ВСЕ узлы — лишняя изолирующая группа у
     *  листа добавляла слой композиции и меняла сглаживание края: один
     *  расходящийся пиксель на `image-bg` при 390px. Затем — только
     *  узлы с детьми, и падений стало шесть: у повёрнутого листа
     *  исчезла группа, а вместе с ней и поворот. Верно ровно
     *  дизъюнкция. */
    isStackingContext: children.length > 0 || transformFrom(base) !== null,
    transform: transformFrom(base),
    layout: { mode: 'none' as const, gap: 0,
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
              align: 'start' as const, justify: 'start' as const, wrap: false },
    selfLayout: { positioning: 'flow' as const, align: null, grow: 0, shrink: 1 },
    children,
  }

  /** Прямоугольник с заливкой-изображением — это то, во что строитель
   *  превратил узел `kind: 'image'`. Размещение он выразил геометрией
   *  самого прямоугольника, поэтому здесь оно восстанавливается как
   *  тождественное: смещения нет, а масштаб — отношение нарисованного
   *  размера к натуральному. */
  const imagePaint = base.fills.find((paint) => paint.type === 'IMAGE')
  if (imagePaint !== undefined && imagePaint.type === 'IMAGE') {
    if (imagePaint.scaleMode === 'TILE') {
      /** Плитка устроена иначе: краска лежит на самом узле, а не на
       *  вложенном прямоугольнике, потому что повторение геометрией
       *  прямоугольника не выражается. Первая редакция принимала её за
       *  одиночную картинку и растягивала на весь бокс — 9688
       *  расходящихся пикселей. */
      return {
        ...common, kind: 'image',
        style: { ...styleFrom(base), clip: false },
        image: {
          assetId: imagePaint.assetId,
          placement: {
            mode: 'tile', offsetX: 0, offsetY: 0,
            scaleX: imagePaint.scalingFactor ?? 1,
            scaleY: imagePaint.scalingFactor ?? 1,
          },
        },
      }
    }

    const size = natural.get(imagePaint.assetId)
    if (size === undefined) {
      throw new Error(
        `Натуральный размер ассета "${imagePaint.assetId}" не передан: ` +
        `восстановить размещение нечем, а нарисовать пустоту значило бы ` +
        `показать расхождение без причины.`,
      )
    }
    return {
      ...common, kind: 'image',
      style: { ...styleFrom(base), clip: false },
      image: {
        assetId: imagePaint.assetId,
        placement: {
          mode: 'crop', offsetX: 0, offsetY: 0,
          scaleX: base.width / size.width,
          scaleY: base.height / size.height,
        },
      },
    }
  }

  if (node.kind === 'text') {
    return {
      ...common,
      kind: 'text',
      style: { ...styleFrom(base), clip: false },
      text: {
        runs: [{
          text: node.text.characters,
          fontStack: [node.text.runs[0]?.family ?? 'Inter'],
          usedFamily: node.text.runs[0]?.family ?? 'Inter',
          fontWeight: 400, fontStyle: 'normal',
          fontSize: node.text.runs[0]?.fontSize ?? 16,
          letterSpacing: node.text.runs[0]?.letterSpacing ?? 0,
          color: (() => {
            const c = node.text.runs[0]?.color
            return c === undefined ? { r: 0, g: 0, b: 0, a: 1 } : {
              r: Math.round(c.r * 255), g: Math.round(c.g * 255),
              b: Math.round(c.b * 255), a: c.a,
            }
          })(),
          decoration: node.text.runs[0]?.decoration ?? 'none',
          shadows: [],
        }],
        lines: [],
        lineHeight: node.text.lineHeight,
        align: node.text.align,
      },
    }
  }

  if (node.kind === 'placeholder') {
    return {
      ...common, kind: 'placeholder',
      style: { ...styleFrom(base), clip: false },
      placeholder: { code: node.code, label: node.label },
    }
  }

  return {
    ...common, kind: 'frame',
    style: { ...styleFrom(base), clip: node.kind === 'frame' ? node.clipsContent : false },
  }
}

export const sceneToIr = (
  screen: SceneScreen,
  natural: NaturalSizes = new Map(),
): Screen => {
  return {
    id: screen.id,
    name: screen.name,
    width: screen.width,
    height: screen.height,
    dpr: 1,
    scroll: { x: 0, y: 0 },
    root: nodeFrom(screen.root, { value: 0 }, natural),
    screenshotId: null,
  }
}
