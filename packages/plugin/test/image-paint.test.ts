import { describe, expect, it } from 'vitest'
import { imageNodeFor } from '../src/build/image.js'
import type { ImagePlacement } from '@h2d/ir'

const rect = { x: 0, y: 0, w: 120, h: 90 }
const natural = { width: 64, height: 32 }

const place = (o: Partial<ImagePlacement> = {}): ImagePlacement =>
  ({ mode: 'fit', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, ...o })

/** Прямоугольник, несущий картинку, — сам узел или его ребёнок.
 *
 *  Хелпер существует потому, что вложенность НЕ является предметом
 *  этих проверок: обрезающая рамка добавляется только при выходе за
 *  бокс, и держаться за неё значило бы ронять тесты про размещение
 *  всякий раз, когда меняется решение про обрезку. Само это решение
 *  проверяется отдельно и явно. */
const rectOf = (node: ReturnType<typeof imageNodeFor>) =>
  node.kind === 'rect' ? node : node.base.children[0]

describe('imageNodeFor: размещение сведено к геометрии', () => {
  /** Главное решение плана. Вместо того чтобы полагаться на режимы
   *  Figma, размещение выражается размерами и координатами вложенного
   *  прямоугольника: они однозначны, а семантика режимов — нет.
   *  От Figma остаётся ровно одно допущение — что `FILL` на
   *  прямоугольнике ТЕХ ЖЕ пропорций, что и источник, рисует картинку
   *  точно по нему, не обрезая и не добавляя полей. */
  it('прямоугольник картинки имеет пропорции источника', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 1.875, scaleY: 1.875 }), 'a0', natural)
    const inner = rectOf(node)
    expect(inner).toBeDefined()
    if (inner === undefined) return
    expect(inner.base.width / inner.base.height)
      .toBeCloseTo(natural.width / natural.height, 9)
  })

  it('размеры равны натуральным, умноженным на масштаб', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 2, scaleY: 2 }), 'a0', natural)
    expect(rectOf(node)?.base.width).toBe(128)
    expect(rectOf(node)?.base.height).toBe(64)
  })

  it('смещение попадает в координаты прямоугольника', () => {
    const node = imageNodeFor('n1', rect, place({ offsetX: 10, offsetY: -4 }), 'a0', natural)
    expect(rectOf(node)?.base.x).toBe(10)
    expect(rectOf(node)?.base.y).toBe(-4)
  })

  /** При `cover` нарисованный прямоугольник БОЛЬШЕ рамки и вылезает за
   *  неё. Без обрезки картинка легла бы на соседей. */
  it('рамка обрезает содержимое', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 3, scaleY: 3 }), 'a0', natural)
    expect(node.kind === 'frame' && node.clipsContent).toBe(true)
  })

  /** Обрезка ставится ТОЛЬКО когда есть что обрезать. Клип не
   *  бесплатен: совпав границами с самой картинкой, он срезает
   *  сглаженный край — измерено, 12 одиночных расходящихся пикселей. */
  it('без выхода за бокс обрезающей рамки нет', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 1, scaleY: 1 }), 'a0', natural)
    expect(node.kind).toBe('rect')
  })

  it('равномерный масштаб едет режимом FILL, без догадок', () => {
    const node = imageNodeFor('n1', rect, place({ scaleX: 2, scaleY: 2 }), 'a0', natural)
    const fill = rectOf(node)?.base.fills[0]
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
    const fill = rectOf(node)?.base.fills[0]
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
