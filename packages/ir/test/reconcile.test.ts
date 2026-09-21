import { describe, expect, it } from 'vitest'
import { reconcileAssets } from '../src/reconcile.js'
import { frameNode, screen as makeScreen } from './fixtures.js'
import type { IrNode } from '../src/types.js'

const withImage = (assetId: string): IrNode => ({
  ...frameNode(), kind: 'image', id: 'n1',
  image: {
    assetId,
    placement: { mode: 'fit', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
  },
})

describe('reconcileAssets', () => {
  it('узел с доехавшим ассетом не трогается', () => {
    const screen = makeScreen({ root: withImage('a0') })
    const { screen: out, report } = reconcileAssets(screen, new Set(['a0']))
    expect(out.root.kind).toBe('image')
    expect(report).toEqual([])
  })

  /** Кросс-доменная картинка отрисовалась — значит узел построен, — а
   *  байтов нет. Без замены узел ссылался бы в никуда, инвариант
   *  asset.dangling отверг бы бандл целиком, и захват любой страницы с
   *  картинкой с чужого CDN оказался бы непригоден. */
  it('узел без ассета становится заглушкой, а не исчезает', () => {
    const { screen: out, report } = reconcileAssets(makeScreen({ root: withImage('a0') }), new Set())
    expect(out.root.kind).toBe('placeholder')
    expect(report).toHaveLength(1)
    expect(report[0]?.code).toBe('fidelity.image-unreadable')
    expect(report[0]?.needsPlaceholder).toBe(true)
  })

  /** Удаление вместо замены дало бы дыру, неотличимую от прозрачного
   *  места: пользователь не узнал бы, что картинка потерялась. */
  it('заглушка сохраняет геометрию узла', () => {
    const node = withImage('a0')
    const { screen: out } = reconcileAssets(makeScreen({ root: node }), new Set())
    expect(out.root.rect).toEqual(node.rect)
  })

  it('заливка без ассета снимается, а узел остаётся', () => {
    const node = frameNode()
    node.style.fills = [
      { kind: 'solid', color: { r: 1, g: 2, b: 3, a: 1 } },
      { kind: 'image', ref: {
        assetId: 'a9',
        placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
      } },
    ]
    const { screen: out, report } = reconcileAssets(makeScreen({ root: node }), new Set())
    expect(out.root.kind).toBe('frame')
    expect(out.root.style.fills).toHaveLength(1)
    expect(out.root.style.fills[0]?.kind).toBe('solid')
    /** Заливка — не замена узла: под ней остаётся цвет, и заглушка
     *  здесь была бы враньём о том, что узла нет. */
    expect(report[0]?.needsPlaceholder).toBe(false)
  })

  it('обходит поддерево, а не только корень', () => {
    const root = frameNode()
    root.children = [withImage('a0')]
    const { screen: out } = reconcileAssets(makeScreen({ root }), new Set())
    expect(out.root.children[0]?.kind).toBe('placeholder')
  })
})
