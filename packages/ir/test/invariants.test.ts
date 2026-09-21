import { describe, expect, it } from 'vitest'
import type { DiagnosticCode } from '../src/codes.js'
import { checkInvariants } from '../src/invariants.js'
import type { IrNode } from '../src/types.js'
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
  it('допускает пробел, съеденный переносом строки', () => {
    // Найдено на настоящем захвате: браузер не включает пробел в бокс
    // строки, на которой произошёл перенос. Раны его несут, строки нет.
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 't', paintOrder: 1 }),
        kind: 'text',
        text: nodeText({
          runs: [textRun({ text: 'который обязан перенестись' })],
          lines: [
            { x: 0, y: 0, w: 50, h: 20, text: 'который обязан' },
            { x: 0, y: 20, w: 50, h: 20, text: 'перенестись' },
          ],
        }),
      }],
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  it('всё ещё ловит ЛИШНИЙ текст — то, ради чего инвариант написан', () => {
    // Ран несёт текст всего подграфа, строки только собственный: ровно тот
    // дефект, из-за которого плагин рисовал вложенный <b> дважды.
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 't', paintOrder: 1 }),
        kind: 'text',
        text: nodeText({
          runs: [textRun({ text: 'Hello world' })],
          lines: [{ x: 0, y: 0, w: 50, h: 20, text: 'Hello' }],
        }),
      }],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('text.concat-mismatch')
  })

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

describe('checkInvariants: связь заглушки и диагностики', () => {
  const placeholderNode = (id: string, code: string, paintOrder: number): IrNode => ({
    ...frameNode({ id, paintOrder }),
    kind: 'placeholder',
    placeholder: { code: code as DiagnosticCode, label: 'canvas' },
  })

  it('ловит заглушку, которую отчёт не объясняет', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [placeholderNode('ph', 'unsupported.canvas', 1)],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('placeholder.unexplained')
  })

  it('принимает заглушку с парной диагностикой', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [placeholderNode('ph', 'unsupported.canvas', 1)],
    })
    const b = bundle({
      screens: [screen({ root })],
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'canvas',
        nodeId: 'ph', screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(checkInvariants(b)).toEqual([])
  })

  it('ловит needsPlaceholder: true с nodeId: null — невыполнимо по построению', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: null, screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('placeholder.no-host')
  })

  it('ловит needsPlaceholder: true, указывающий на обычный фрейм', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: 'n0', screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('placeholder.wrong-host')
  })
})

describe('checkInvariants: отложенные фичи обязаны диагностироваться', () => {
  /** Тесты `ловит transform без diagnostic` и `принимает transform с парной
   *  диагностикой` удалены вместе с самой проверкой: трансформы переносятся,
   *  и требовать для них диагностику значило бы отвергать корректные бандлы.
   *  Ниже — утверждение на снятое требование, чтобы удаление не выглядело
   *  потерей теста: узел с трансформой и ПУСТЫМ отчётом теперь валиден. */
  it('принимает transform без диагностики: фича больше не отложена', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      transform: {
        angle: 0.26, scaleX: 1, scaleY: 1,
        translateX: 0, translateY: 0, originX: 50, originY: 25,
      },
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  /** Тест `ловит blend без diagnostic` удалён вместе с самой проверкой:
   *  режимы наложения переносятся, и требовать для них диагностику значило
   *  бы отвергать корректные бандлы — тот же переход, что уже проделан для
   *  transform. */
  it('принимает blend без диагностики: фича больше не отложена', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      style: { ...frameNode().style, blend: 'multiply' },
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  /** Отложено теперь только ФОНОВОЕ размытие, поэтому и требование
   *  диагностики осталось только на нём. Проверяются оба исхода подряд:
   *  без второго теста сужение прошло бы незаметно и при полностью
   *  выключенной проверке. */
  it('ловит фоновое размытие без diagnostic', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      style: { ...frameNode().style, blur: { layer: 0, background: 4 } },
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('deferred.undiagnosed')
  })

  it('принимает размытие слоя без диагностики: фича больше не отложена', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      style: { ...frameNode().style, blur: { layer: 4, background: 0 } },
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })
})

describe('checkInvariants: уникальность идентификаторов', () => {
  it('ловит дубль Asset.id — иначе картинка молча подменяется другой', () => {
    const b = bundle({
      assets: [
        { id: 'a1', mimeType: 'image/png', width: 1, height: 1, path: 'assets/logo.png' },
        { id: 'a1', mimeType: 'image/png', width: 2, height: 2, path: 'assets/hero.png' },
      ],
    })
    expect(codesOf(checkInvariants(b))).toContain('asset-id.duplicate')
  })

  it('ловит дубль Screen.id — иначе screenId в диагностике неоднозначен', () => {
    const b = bundle({
      screens: [
        screen({ id: 'same', root: frameNode({ id: 'x', paintOrder: 0 }) }),
        screen({ id: 'same', root: frameNode({ id: 'y', paintOrder: 0 }) }),
      ],
    })
    expect(codesOf(checkInvariants(b))).toContain('screen-id.duplicate')
  })
})

describe('checkInvariants: токены не в обход проверок', () => {
  it('ловит висячий assetId в paintStyles', () => {
    const b = bundle({
      tokens: {
        variables: [], textStyles: [],
        paintStyles: [{
          name: 'brand',
          fill: {
            kind: 'image',
            ref: {
              assetId: 'нет-такого',
              placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
            },
          },
        }],
      },
    })
    expect(codesOf(checkInvariants(b))).toContain('asset.dangling')
  })

  it('ловит шрифт из textStyles, отсутствующий в fonts', () => {
    const b = bundle({
      tokens: {
        variables: [], paintStyles: [],
        textStyles: [{ name: 'h1', run: textRun({ usedFamily: 'Söhne', fontWeight: 700 }) }],
      },
    })
    expect(codesOf(checkInvariants(b))).toContain('font.uncovered')
  })
})

describe('checkInvariants: координаты родителя', () => {
  it('принимает детей, лежащих внутри родителя', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      rect: { x: 0, y: 0, w: 200, h: 100 },
      children: [frameNode({
        id: 'b', paintOrder: 1,
        rect: { x: 10, y: 10, w: 50, h: 20 },
      })],
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  it('принимает ребёнка, выходящего за пределы родителя', () => {
    // Законно: absolute-позиционирование, отрицательные отступы и
    // overflow: visible выносят ребёнка наружу сплошь и рядом. Инвариант
    // проверяет систему координат, а не вложенность геометрии.
    const root = frameNode({
      id: 'a', paintOrder: 0,
      rect: { x: 0, y: 0, w: 100, h: 100 },
      children: [frameNode({
        id: 'b', paintOrder: 1,
        rect: { x: -30, y: 150, w: 50, h: 20 },
      })],
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  it('ловит ребёнка с подозрительно большим смещением', () => {
    // Верный признак бандла прошлой редакции: ребёнок несёт абсолютные
    // координаты документа, поэтому его смещение примерно равно
    // положению родителя на странице. Проверка эвристическая и потому
    // уровня предупреждения — но молчать нельзя: тип не изменился, и
    // ничто другое такую путаницу не поймает.
    const root = frameNode({
      id: 'a', paintOrder: 0,
      rect: { x: 0, y: 0, w: 1440, h: 900 },
      children: [frameNode({
        id: 'b', paintOrder: 1,
        rect: { x: 0, y: 0, w: 100, h: 50 },
        children: [frameNode({
          id: 'c', paintOrder: 2,
          // Ребёнок узла 100×50 не может законно отстоять на 40000px:
          // это абсолютные координаты, попавшие в поле для локальных.
          rect: { x: 40000, y: 40000, w: 10, h: 10 },
        })],
      })],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('rect.suspicious-offset')
  })
})

describe('checkInvariants: согласованность ссылок диагностики', () => {
  it('ловит диагностику, у которой узел и экран из разных экранов', () => {
    const b = bundle({
      screens: [
        screen({ id: 's0', root: frameNode({ id: 'на-нулевом', paintOrder: 0 }) }),
        screen({ id: 's1', root: frameNode({ id: 'на-первом', paintOrder: 0 }) }),
      ],
      report: [{
        level: 'info', code: 'fidelity.grid-flattened', message: 'x',
        nodeId: 'на-нулевом', screenId: 's1', needsPlaceholder: false,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('diagnostic.screen-mismatch')
  })
})
