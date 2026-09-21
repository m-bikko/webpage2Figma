import { DIAGNOSTIC_CODES } from '@h2d/ir/codes'
import type { ImagePlacement, Rect } from '@h2d/ir'
import type { SceneBase, SceneNode } from '../scene.js'

/** Допуск на сравнение масштабов. Браузер отдаёт вычисленные размеры
 *  с плавающей точкой, и `contain` на неудобном боксе даёт масштабы,
 *  различающиеся в последнем разряде. Считать такую пару неравномерным
 *  растяжением значило бы гнать через `CROP` — то есть через догадку —
 *  совершенно обычный случай. */
const SCALE_TOLERANCE = 1e-9

const emptyBase = (id: string, name: string, rect: Rect): SceneBase => ({
  id, name,
  x: rect.x, y: rect.y, width: rect.w, height: rect.h,
  rotation: 0, opacity: 1, blendMode: 'NORMAL',
  fills: [], stroke: null,
  corner: { tl: 0, tr: 0, br: 0, bl: 0 },
  effects: [], children: [],
})

export type ImageBuildResult = SceneNode & {
  /** Что осталось догадкой. Пусто там, где её нет: список отметок
   *  обязан оставаться коротким, иначе он превращается в шум, а шум
   *  учит игнорировать себя целиком. */
  needsVerification: { code: typeof DIAGNOSTIC_CODES[keyof typeof DIAGNOSTIC_CODES]
                       nodeId: string; message: string }[]
}

/** Узел изображения в терминах Figma.
 *
 *  В Figma отдельных узлов-изображений нет: картинка — это `ImagePaint`
 *  как заливка. Размещение задаётся режимом (`FILL`/`FIT`/`CROP`/`TILE`),
 *  но документация описывает `imageTransform` одной строкой, и точная
 *  семантика матрицы остаётся догадкой. Строить на догадке то, что
 *  нельзя проверить без Figma, запрещено.
 *
 *  Выход: СВЕСТИ РАЗМЕЩЕНИЕ К ГЕОМЕТРИИ.
 *
 *      рамка (clipsContent, размер = rect узла)
 *      └── прямоугольник (координаты и размер = нарисованное место,
 *                         заливка IMAGE со scaleMode FILL)
 *
 *  Размер прямоугольника — это `natural × scale`, поэтому его пропорции
 *  совпадают с пропорциями источника, и `FILL` вырождается в точное
 *  заполнение: ни обрезки, ни полей. Вся арифметика размещения
 *  становится обычной геометрией прямоугольника, которую мы понимаем
 *  однозначно, а от семантики режимов Figma остаётся ровно одно
 *  допущение — самое безобидное из возможных.
 *
 *  Два случая из трюка выпадают и честно помечаются:
 *
 *  - НЕРАВНОМЕРНОЕ растяжение (CSS `object-fit: fill` на боксе других
 *    пропорций): прямоугольник перестаёт совпадать по пропорциям с
 *    источником, и `FILL` начал бы обрезать вместо растяжения.
 *    Выразимо только через `CROP` с `imageTransform`.
 *  - ПЛИТКА: выразима только через `TILE`, а поведение `scalingFactor`
 *    при неквадратной плитке не документировано.
 *
 *  Возможный путь избавиться и от первой догадки — заранее пережать
 *  байты в нужный размер, чтобы растяжение исчезло. Он требует канвы,
 *  которой в песочнице плагина нет (но есть в его UI-фрейме), и потому
 *  отложен до результатов сверки: если `CROP` поведёт себя верно,
 *  усложнение не понадобится. */
export const imageNodeFor = (
  nodeId: string,
  rect: Rect,
  placement: ImagePlacement,
  assetId: string,
  natural: { width: number; height: number },
): ImageBuildResult => {
  const needsVerification: ImageBuildResult['needsVerification'] = []

  if (placement.mode === 'tile') {
    needsVerification.push({
      code: DIAGNOSTIC_CODES.imageRecoded,
      nodeId,
      message:
        'Плитка перенесена режимом TILE. Поведение scalingFactor при ' +
        'неквадратной плитке не документировано — требует сверки в Figma.',
    })
    return {
      kind: 'frame',
      clipsContent: true,
      base: {
        ...emptyBase(nodeId, 'image', rect),
        fills: [{ type: 'IMAGE', assetId, scaleMode: 'TILE',
                  scalingFactor: placement.scaleX }],
      },
      needsVerification,
    }
  }

  const uniform = Math.abs(placement.scaleX - placement.scaleY) <= SCALE_TOLERANCE
  if (!uniform) {
    needsVerification.push({
      code: DIAGNOSTIC_CODES.imageRecoded,
      nodeId,
      message:
        `Неравномерное растяжение (${placement.scaleX} × ${placement.scaleY}) ` +
        'выразимо только через CROP с imageTransform, семантика которого ' +
        'документирована одной строкой — требует сверки в Figma.',
    })
  }

  const inner: SceneNode = {
    kind: 'rect',
    base: {
      ...emptyBase(`${nodeId}-img`, 'image', {
        x: placement.offsetX,
        y: placement.offsetY,
        w: natural.width * placement.scaleX,
        h: natural.height * placement.scaleY,
      }),
      fills: [{
        type: 'IMAGE', assetId,
        /** `FILL` только там, где пропорции совпадают. В остальных
         *  случаях он обрезал бы вместо растяжения. */
        scaleMode: uniform ? 'FILL' : 'CROP',
      }],
    },
  }

  return {
    kind: 'frame',
    clipsContent: true,
    base: { ...emptyBase(nodeId, 'image', rect), children: [inner] },
    needsVerification,
  }
}
