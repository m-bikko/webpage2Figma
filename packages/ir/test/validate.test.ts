import { describe, expect, it } from 'vitest'
import { IR_VERSION } from '../src/version.js'
import { parseBundle } from '../src/validate.js'
import { bundle, frameNode, screen } from './fixtures.js'

describe('parseBundle: конверт', () => {
  it('принимает валидный бандл и возвращает типизированный объект', () => {
    const result = parseBundle(bundle())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.screens[0]?.width).toBe(1440)
  })

  it('отклоняет не-объект', () => {
    expect(parseBundle('не бандл').ok).toBe(false)
  })

  it('отличает чужой файл от чужой версии', () => {
    const result = parseBundle({ foo: 'bar' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('не похож на бандл html2design')
    expect(result.error).not.toContain('undefined')
  })

  it('отклоняет чужую версию с внятным сообщением', () => {
    const result = parseBundle({ ...bundle(), version: 999 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('версия IR')
    expect(result.error).toContain(String(IR_VERSION))
  })
})

describe('parseBundle: схема', () => {
  it('отклоняет сломанный rect, указывая путь', () => {
    const broken = structuredClone(bundle()) as Record<string, unknown>
    const screens = broken['screens'] as { root: { rect: unknown } }[]
    const first = screens[0]
    if (first === undefined) throw new Error('фикстура без экранов')
    first.root.rect = { x: 0, y: 0 }
    const result = parseBundle(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('rect')
  })

  it('отклоняет дробный канал цвета — это единицы Figma, а не наши', () => {
    const b = bundle({
      screens: [screen({
        root: frameNode({
          style: {
            ...frameNode().style,
            fills: [{ kind: 'solid', color: { r: 0.5, g: 1, b: 1, a: 1 } }],
          },
        }),
      })],
    })
    expect(parseBundle(b).ok).toBe(false)
  })

  it('отклоняет неизвестный kind узла', () => {
    const b = bundle({
      screens: [screen({ root: { ...frameNode(), kind: 'нечто' } as never })],
    })
    expect(parseBundle(b).ok).toBe(false)
  })

  it('отклоняет неизвестный код диагностики', () => {
    const b = bundle({
      report: [{
        level: 'info', code: 'нет.такого', message: 'x',
        nodeId: null, screenId: null, needsPlaceholder: false,
      } as never],
    })
    expect(parseBundle(b).ok).toBe(false)
  })
})

describe('parseBundle: инварианты', () => {
  it('отклоняет бандл, валидный по форме, но с дыркой в paintOrder', () => {
    const b = bundle({
      screens: [screen({
        root: frameNode({
          id: 'a', paintOrder: 0,
          children: [frameNode({ id: 'b', paintOrder: 7 })],
        }),
      })],
    })
    const result = parseBundle(b)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('порядке отрисовки')
  })

  it('сообщает обо всех нарушенных инвариантах, а не только о первом', () => {
    const b = bundle({
      screens: [screen({
        screenshotId: 'нет-такого',
        root: frameNode({
          id: 'dup', paintOrder: 0,
          children: [frameNode({ id: 'dup', paintOrder: 1 })],
        }),
      })],
    })
    const result = parseBundle(b)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('screenshotId')
    expect(result.error).toContain('id узла')
  })
})
