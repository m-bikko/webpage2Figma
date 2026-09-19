import { describe, expect, it } from 'vitest'
import { checkInvariants } from '../src/invariants.js'
import { bundle, frameNode, nodeText, screen, textRun } from './fixtures.js'

const codesOf = (errors: { code: string }[]): string[] => errors.map((e) => e.code)

describe('checkInvariants: paintOrder', () => {
  it('пропускает плотную перестановку', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [frameNode({ id: 'b', paintOrder: 1 }), frameNode({ id: 'c', paintOrder: 2 })],
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  it('ловит дубль paintOrder', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [frameNode({ id: 'b', paintOrder: 1 }), frameNode({ id: 'c', paintOrder: 1 })],
    })
    const errors = checkInvariants(bundle({ screens: [screen({ root })] }))
    expect(codesOf(errors)).toContain('paint-order.duplicate')
  })

  it('ловит дырку в перестановке', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [frameNode({ id: 'b', paintOrder: 5 })],
    })
    const errors = checkInvariants(bundle({ screens: [screen({ root })] }))
    expect(codesOf(errors)).toContain('paint-order.not-dense')
  })

  it('считает paintOrder независимо по экранам', () => {
    const root = frameNode({ id: 'a', paintOrder: 0 })
    const b = bundle({
      screens: [
        screen({ id: 's0', root }),
        screen({ id: 's1', root: frameNode({ id: 'z', paintOrder: 0 }) }),
      ],
    })
    expect(checkInvariants(b)).toEqual([])
  })
})

describe('checkInvariants: уникальность id узлов', () => {
  it('ловит дубль id внутри экрана', () => {
    const root = frameNode({
      id: 'dup', paintOrder: 0,
      children: [frameNode({ id: 'dup', paintOrder: 1 })],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('node-id.duplicate')
  })

  it('ловит дубль id МЕЖДУ экранами — id уникальны по бандлу, не по экрану', () => {
    const b = bundle({
      screens: [
        screen({ id: 's0', root: frameNode({ id: 'n0', paintOrder: 0 }) }),
        screen({ id: 's1', root: frameNode({ id: 'n0', paintOrder: 0 }) }),
      ],
    })
    expect(codesOf(checkInvariants(b))).toContain('node-id.duplicate')
  })
})

describe('checkInvariants: ссылочная целостность', () => {
  it('ловит висячий assetId у image-узла', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 'img', paintOrder: 1 }),
        kind: 'image',
        image: {
          assetId: 'нет-такого',
          placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
        },
      }],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('asset.dangling')
  })

  it('ловит висячий assetId в image-заливке', () => {
    const root = frameNode({
      id: 'a',
      paintOrder: 0,
      style: {
        ...frameNode().style,
        fills: [{
          kind: 'image',
          ref: {
            assetId: 'нет-такого',
            placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
          },
        }],
      },
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('asset.dangling')
  })

  it('принимает assetId, который есть в assets', () => {
    const b = bundle({
      assets: [{ id: 'a1', mimeType: 'image/png', width: 10, height: 10, path: 'assets/a1.png' }],
      screens: [screen({
        root: frameNode({
          id: 'a',
          paintOrder: 0,
          style: {
            ...frameNode().style,
            fills: [{
              kind: 'image',
              ref: {
                assetId: 'a1',
                placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
              },
            }],
          },
        }),
      })],
    })
    expect(checkInvariants(b)).toEqual([])
  })

  it('ловит висячий screenshotId', () => {
    const b = bundle({ screens: [screen({ screenshotId: 'нет-такого' })] })
    expect(codesOf(checkInvariants(b))).toContain('screenshot.dangling')
  })

  it('ловит диагностику, ссылающуюся на несуществующий узел', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: 'нет-такого', screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('diagnostic.dangling-node')
  })

  it('ловит диагностику, ссылающуюся на несуществующий экран', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: null, screenId: 'нет-такого', needsPlaceholder: false,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('diagnostic.dangling-screen')
  })

  it('ловит шрифт, использованный в тексте, но отсутствующий в fonts', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 't', paintOrder: 1 }),
        kind: 'text',
        text: nodeText({ runs: [textRun({ usedFamily: 'Söhne', fontWeight: 700 })] }),
      }],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('font.uncovered')
  })
})

describe('checkInvariants: связность текста', () => {
  it('ловит расхождение конкатенации ранов и строк', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 't', paintOrder: 1 }),
        kind: 'text',
        text: nodeText({
          runs: [textRun({ text: 'привет мир' })],
          lines: [{ x: 0, y: 0, w: 50, h: 20, text: 'привет' }],
        }),
      }],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('text.concat-mismatch')
  })
})
