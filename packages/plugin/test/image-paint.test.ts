import { describe, expect, it } from 'vitest'
import { imageNodeFor } from '../src/build/image.js'
import type { ImagePlacement } from '@h2d/ir'

const rect = { x: 0, y: 0, w: 120, h: 90 }
const natural = { width: 64, height: 32 }

const place = (o: Partial<ImagePlacement> = {}): ImagePlacement =>
  ({ mode: 'fit', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, ...o })

describe('imageNodeFor: размещение сведено к геометрии', () => {
  /** Главное решение плана. Вместо того чтобы полагаться на режимы
   *  Figma, размещение выражается размерами и координатами вложенного
   *  прямоугольника: они однозначны, а семантика режимов — нет.
   *  От Figma остаётся ровно одно допущение — что `FILL` на
   *  прямоугольнике ТЕХ ЖЕ пропорций, что и источник, рисует картинку
   *  точно по нему, не обрезая и не добавляя полей. */
  it('прямоугольник картинки имеет пропорции источника', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 1.875, scaleY: 1.875 }), 'a0', natural)
    const inner = node.base.children[0]
    expect(inner?.base.width / inner!.base.height)
      .toBeCloseTo(natural.width / natural.height, 9)
  })

  it('размеры равны натуральным, умноженным на масштаб', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 2, scaleY: 2 }), 'a0', natural)
    expect(node.base.children[0]?.base.width).toBe(128)
    expect(node.base.children[0]?.base.height).toBe(64)
  })

  it('смещение попадает в координаты прямоугольника', () => {
    const node = imageNodeFor('n1', rect, place({ offsetX: 10, offsetY: -4 }), 'a0', natural)
    expect(node.base.children[0]?.base.x).toBe(10)
    expect(node.base.children[0]?.base.y).toBe(-4)
  })

  /** При `cover` нарисованный прямоугольник БОЛЬШЕ рамки и вылезает за
   *  неё. Без обрезки картинка легла бы на соседей. */
  it('рамка обрезает содержимое', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 3, scaleY: 3 }), 'a0', natural)
    expect(node.kind === 'frame' && node.clipsContent).toBe(true)
  })

  it('равномерный масштаб едет режимом FILL, без догадок', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 2, scaleY: 2 }), 'a0', natural)
    const fill = node.base.children[0]?.base.fills[0]
    expect(fill?.type).toBe('IMAGE')
    expect(fill?.type === 'IMAGE' && fill.scaleMode).toBe('FILL')
  })
})

describe('imageNodeFor: неравномерное растяжение', () => {
  /** CSS `object-fit: fill` растягивает по осям НЕЗАВИСИМО. Пропорции
   *  прямоугольника перестают совпадать с пропорциями источника, и
   *  трюк с `FILL` перестаёт работать: Figma обрезала бы картинку
   *  вместо растяжения. Выразить это можно только через `CROP` с
   *  `imageTransform`, семантика которого документирована одной
   *  строкой. Значит здесь остаётся догадка — и она обязана быть
   *  названа, а не спрятана. */
  it('неравные масштабы едут режимом CROP', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 1.875, scaleY: 2.8125 }), 'a0', natural)
    const fill = node.base.children[0]?.base.fills[0]
    expect(fill?.type === 'IMAGE' && fill.scaleMode).toBe('CROP')
  })

  it('и получают отметку «требует сверки»', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 1.875, scaleY: 2.8125 }), 'a0', natural)
    expect(node.needsVerification).toHaveLength(1)
    expect(node.needsVerification[0]?.nodeId).toBe('n1')
  })

  /** Отметка НЕ ставится там, где догадки нет: иначе список станет
   *  шумом, а шум учит игнорировать его целиком — ровно та причина,
   *  по которой диагностика ставится только на неразобранное. */
  it('равномерный масштаб отметки не получает', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 2, scaleY: 2 }), 'a0', natural)
    expect(node.needsVerification).toEqual([])
  })

  /** Плитка выражается только режимом TILE, и поведение
   *  `scalingFactor` при неквадратной плитке не документировано. */
  it('плитка едет TILE и тоже требует сверки', () => {
    const node = imageNodeFor('n1', rect, place({ mode: 'tile', scaleX: 1, scaleY: 1 }), 'a0', natural)
    const fill = node.base.fills[0]
    expect(fill?.type === 'IMAGE' && fill.scaleMode).toBe('TILE')
    expect(node.needsVerification).toHaveLength(1)
  })
})
