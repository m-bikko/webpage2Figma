import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES } from '@h2d/ir'
import { DiagnosticSink } from '../src/diagnostics.js'

describe('DiagnosticSink', () => {
  it('начинается пустым', () => {
    expect(new DiagnosticSink('s0').drain()).toEqual([])
  })

  it('записывает диагностику со стабильным screenId, а не с именем экрана', () => {
    const sink = new DiagnosticSink('s3')
    sink.report(
      'warning', DIAGNOSTIC_CODES.unsupportedCanvas,
      'canvas не переносится', 'n7', true,
    )
    expect(sink.drain()).toEqual([
      {
        level: 'warning',
        code: 'unsupported.canvas',
        message: 'canvas не переносится',
        nodeId: 'n7',
        screenId: 's3',
        needsPlaceholder: true,
      },
    ])
  })

  it('пишет needsPlaceholder: false для кодов класса пометки', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid сведён', 'n1', false)
    expect(sink.drain()[0]?.needsPlaceholder).toBe(false)
  })

  it('дедуплицирует одинаковые записи по коду и узлу', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n1', true)
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'два', 'n1', true)
    expect(sink.drain()).toHaveLength(1)
  })

  it('не дедуплицирует один код на разных узлах', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n1', true)
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n2', true)
    expect(sink.drain()).toHaveLength(2)
  })

  it('не дедуплицирует разные коды на одном узле', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid', 'n1', false)
    sink.report('info', DIAGNOSTIC_CODES.stickyFlattened, 'sticky', 'n1', false)
    expect(sink.drain()).toHaveLength(2)
  })

  it('различает записи с nodeId: null и с узлом', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'без узла', null, false)
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'с узлом', 'n1', false)
    expect(sink.drain()).toHaveLength(2)
  })

  it('drain не разрушает накопленное — отчёт можно прочитать дважды', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid', 'n1', false)
    expect(sink.drain()).toHaveLength(1)
    expect(sink.drain()).toHaveLength(1)
  })

  it('drain отдаёт копию: правка результата не портит накопленное', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid', 'n1', false)
    const first = sink.drain()
    first.pop()
    expect(sink.drain()).toHaveLength(1)
  })
})
