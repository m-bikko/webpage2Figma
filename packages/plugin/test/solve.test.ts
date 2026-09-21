import { describe, expect, it } from 'vitest'
import { solveLayout } from '../src/layout/solve.js'
import type { NodeLayout } from '@w2f/ir'

/** Решатель флекса. Его задача — не «разложить», а ПРЕДСКАЗАТЬ, куда
 *  браузер уже положил детей. Совпало предсказание с измеренным —
 *  раскладка объяснима флексом, и auto-layout имеет шанс совпасть.
 *  Не совпало — в CSS есть что-то за пределами нашей модели, и
 *  навязывать auto-layout нельзя.
 *
 *  Поэтому все ожидания здесь выведены из правил флекса вручную, а не
 *  получены прогоном самого решателя. */

const layout = (o: Partial<NodeLayout> = {}): NodeLayout => ({
  mode: 'row', gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  align: 'start', justify: 'start', wrap: false,
  ...o,
})

const kid = (w: number, h: number) => ({ width: w, height: h })

describe('solveLayout: ряд', () => {
  it('складывает детей слева направо с зазором', () => {
    const out = solveLayout(
      layout({ mode: 'row', gap: 10 }),
      { width: 300, height: 100 },
      [kid(50, 20), kid(60, 20), kid(40, 20)],
    )
    expect(out.map((p) => p.x)).toEqual([0, 60, 130])
  })

  /** Отступы сдвигают ВСЁ содержимое, а не только первого ребёнка. */
  it('учитывает отступы', () => {
    const out = solveLayout(
      layout({ mode: 'row', gap: 10, padding: { top: 5, right: 0, bottom: 0, left: 20 } }),
      { width: 300, height: 100 },
      [kid(50, 20), kid(60, 20)],
    )
    expect(out.map((p) => p.x)).toEqual([20, 80])
    expect(out.map((p) => p.y)).toEqual([5, 5])
  })
})

describe('solveLayout: колонка', () => {
  /** Колонка — не «ряд, повёрнутый на бок»: оси меняются местами,
   *  и зазор идёт по Y. Отдельный тест нужен потому, что
   *  перепутанные оси на квадратных детях невидимы. */
  it('складывает детей сверху вниз с зазором', () => {
    const out = solveLayout(
      layout({ mode: 'column', gap: 8 }),
      { width: 100, height: 300 },
      [kid(50, 20), kid(50, 30)],
    )
    expect(out.map((p) => p.y)).toEqual([0, 28])
    expect(out.map((p) => p.x)).toEqual([0, 0])
  })
})

describe('solveLayout: поперечное выравнивание', () => {
  /** Дети РАЗНОЙ высоты: на одинаковых выравнивание не различимо. */
  const row = (align: NodeLayout['align']) => solveLayout(
    layout({ mode: 'row', align }),
    { width: 300, height: 100 },
    [kid(50, 20), kid(50, 40)],
  )

  it('start прижимает к началу', () => {
    expect(row('start').map((p) => p.y)).toEqual([0, 0])
  })

  it('center ставит по центру', () => {
    expect(row('center').map((p) => p.y)).toEqual([40, 30])
  })

  it('end прижимает к концу', () => {
    expect(row('end').map((p) => p.y)).toEqual([80, 60])
  })
})

describe('solveLayout: продольное выравнивание', () => {
  /** Свободное место есть только когда дети уже контейнера. */
  const row = (justify: NodeLayout['justify']) => solveLayout(
    layout({ mode: 'row', justify }),
    { width: 300, height: 100 },
    [kid(50, 20), kid(50, 20)],
  )

  it('start прижимает к началу', () => {
    expect(row('start').map((p) => p.x)).toEqual([0, 50])
  })

  it('center ставит блок по центру', () => {
    expect(row('center').map((p) => p.x)).toEqual([100, 150])
  })

  it('end прижимает к концу', () => {
    expect(row('end').map((p) => p.x)).toEqual([200, 250])
  })

  /** space-between раздвигает детей к краям: первый в начале,
   *  последний в конце, остаток поровну. */
  it('space-between раздвигает к краям', () => {
    expect(row('space-between').map((p) => p.x)).toEqual([0, 250])
  })
})

describe('solveLayout: растяжение', () => {
  /** `stretch` — значение `align-items` по умолчанию, и от того, как
   *  решатель с ним обходится, зависит, применится ли auto-layout
   *  вообще. Он меняет РАЗМЕР ребёнка, а не положение: растянутый
   *  ребёнок начинается у края, как при `start`. Размеры в IR уже
   *  измерены браузером, поэтому предсказывать нечего. */
  it('растяжение ставит детей к началу поперечной оси', () => {
    const out = solveLayout(
      layout({ mode: 'row', align: 'stretch',
               padding: { top: 6, right: 0, bottom: 0, left: 0 } }),
      { width: 300, height: 100 },
      [kid(50, 94), kid(50, 94)],
    )
    expect(out.map((p) => p.y)).toEqual([6, 6])
  })
})
