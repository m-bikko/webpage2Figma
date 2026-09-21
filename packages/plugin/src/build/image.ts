import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import type { ImagePlacement, Rect } from '@w2f/ir'
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
  effects: [], autoLayout: null, children: [],
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
    /** Отметка «требует сверки» про `scalingFactor` СНЯТА: закрыто
     *  замером в настоящей Figma на неквадратном источнике 64×32.
     *  Проверено, что период плитки совпадает с браузером и по
     *  горизонтали, и по вертикали, при масштабе 1 и 0.5, — причём в
     *  середине периода цвет другой, то есть проверка периода не
     *  пустая. Подробности — в [[figma-semantics]].
     *
     *  Что отметка прикрывала, кроме самого `scalingFactor`: ничего.
     *  Потеря смещения плитки помечается ОТДЕЛЬНО, ниже, и остаётся
     *  настоящей потерей. */
    /** У TILE в Figma нет смещения: `background-position` для
     *  повторяющегося фона теряется. Молчать нельзя — сетка плитки
     *  сдвинется, и выглядеть это будет как своя, тоже правдоподобная
     *  раскладка. */
    if (placement.offsetX !== 0 || placement.offsetY !== 0) {
      needsVerification.push({
        code: DIAGNOSTIC_CODES.deferredRepeatMode,
        nodeId,
        message:
          `Смещение плитки (${placement.offsetX}, ${placement.offsetY}) ` +
          'потеряно: у режима TILE в Figma смещения нет.',
      })
    }
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
  /** Отметка «требует сверки» здесь БОЛЬШЕ НЕ СТАВИТСЯ: вопрос закрыт
   *  замером в настоящей Figma. `CROP` без заданного `imageTransform`
   *  растягивает картинку по границам узла — ровно то, что нужно.
   *
   *  Различающий признак из замера: левый верхний угол блока у
   *  `object-fit: fill` равен [3, 2, 64] (видна вся ширина исходника),
   *  у `cover` — [45, 2, 64] (левые ~17% обрезаны). Браузер даёт [3, 3]
   *  и [45, 3]. Подробности — в [[figma-semantics]].
   *
   *  Что эта отметка прикрывала, кроме самого `CROP`: ничего. Плитка
   *  помечается отдельно и остаётся непроверенной, потеря смещения
   *  плитки — тоже. */

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

  /** Обрезающая рамка добавляется ТОЛЬКО когда есть что обрезать.
   *
   *  Раньше она ставилась всегда, и на `contain`, `auto` и заданном
   *  размере это добавляло границу, которой в браузере нет: край
   *  ложился на дробный пиксель и давал одиночные расхождения — 3
   *  пикселя на 768 и 12 на 390. Лишний клип не бесплатен, и ставить
   *  его «на всякий случай» значит платить артефактами за случай,
   *  которого нет.
   *
   *  Нужна ли обрезка — вопрос геометрии, а не режима: сравниваются
   *  нарисованный прямоугольник и бокс. */
  const overflows =
    placement.offsetX < 0 || placement.offsetY < 0 ||
    placement.offsetX + inner.base.width > rect.w ||
    placement.offsetY + inner.base.height > rect.h

  if (!overflows) return { ...inner, needsVerification }

  return {
    kind: 'frame',
    clipsContent: true,
    base: { ...emptyBase(nodeId, 'image', rect), children: [inner] },
    needsVerification,
  }
}
