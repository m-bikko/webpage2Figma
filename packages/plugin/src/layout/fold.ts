import type { IrNode, NodeLayout, Sides } from '@w2f/ir'

/** Сворачивает внешние отступы детей в параметры, которые Figma
 *  выражает.
 *
 *  Зачем. У auto-layout нет отступов на ребёнке: есть отступы
 *  контейнера и один зазор на всех. Но в вёрстке отступы у детей —
 *  обычное дело, и без учёта они дают расхождение в сотни пикселей.
 *  Измерено на живой странице: 20 отказов из 22 были именно про это.
 *
 *  Свернуть можно не всё, и это принципиально: сворачивается ровно то,
 *  что даёт ТУ ЖЕ картину. Разные отступы у разных детей одинаковым
 *  зазором не выражаются, и такой узел честно отвергается.
 *
 *  Три правила:
 *  - отступ первого ребёнка со стороны начала прибавляется к отступу
 *    контейнера;
 *  - отступ последнего со стороны конца — тоже;
 *  - между соседями отступы складываются (в CSS-флексе они НЕ
 *    схлопываются, в отличие от блочной раскладки) и дают зазор, но
 *    только если у всех пар получилось одинаково. */

export type Folded = {
  gap: number
  padding: Sides
  /** Поперечное выравнивание с учётом `margin: auto`. */
  align: NodeLayout['align']
}

export type FoldFailure = { reason: string }

const startOf = (margin: Sides, horizontal: boolean): number =>
  horizontal ? margin.left : margin.top
const endOf = (margin: Sides, horizontal: boolean): number =>
  horizontal ? margin.right : margin.bottom

export const foldMargins = (
  node: IrNode,
  /** Ось раскладки. Для сетки выводится из измеренного и может не
   *  совпадать с `layout.mode`. */
  mode: 'row' | 'column',
): Folded | FoldFailure => {
  const horizontal = mode === 'row'
  const kids = node.children
  const first = kids[0]
  const last = kids[kids.length - 1]
  if (first === undefined || last === undefined) {
    return { reason: 'детей нет' }
  }

  /** Зазоры между соседями обязаны получиться одинаковыми: Figma
   *  держит один `itemSpacing` на весь контейнер. */
  const gaps: number[] = []
  for (let i = 1; i < kids.length; i += 1) {
    const previous = kids[i - 1]
    const current = kids[i]
    if (previous === undefined || current === undefined) continue
    gaps.push(
      node.layout.gap
      + endOf(previous.selfLayout.margin, horizontal)
      + startOf(current.selfLayout.margin, horizontal),
    )
  }
  const gap = gaps[0] ?? node.layout.gap
  if (gaps.some((value) => Math.abs(value - gap) > 0.5)) {
    return {
      reason: 'у детей разные внешние отступы, а Figma держит один зазор '
        + 'на весь контейнер',
    }
  }

  /** Поперечные отступы обязаны быть одинаковыми у всех: они станут
   *  отступом контейнера. */
  const crossStarts = kids.map((kid) =>
    horizontal ? kid.selfLayout.margin.top : kid.selfLayout.margin.left)
  const crossEnds = kids.map((kid) =>
    horizontal ? kid.selfLayout.margin.bottom : kid.selfLayout.margin.right)
  const crossStart = crossStarts[0] ?? 0
  const crossEnd = crossEnds[0] ?? 0
  const crossUniform = crossStarts.every((v) => Math.abs(v - crossStart) <= 0.5)
    && crossEnds.every((v) => Math.abs(v - crossEnd) <= 0.5)

  /** `margin: auto` по поперечной оси у ВСЕХ детей — это центрирование.
   *  Самая частая раскладка, которую флекс сам по себе не объясняет:
   *  блок с `margin: 0 auto` внутри колонки.
   *
   *  Признак выводится из симметрии вычисленных отступов и потому
   *  приблизителен; ошибка в любую сторону безопасна — предсказание
   *  просто не сойдётся, и узел останется абсолютным. */
  const allAuto = kids.every((kid) => horizontal
    ? kid.selfLayout.marginAuto.vertical
    : kid.selfLayout.marginAuto.horizontal)

  if (!crossUniform && !allAuto) {
    return {
      reason: 'поперечные отступы у детей разные: одним отступом контейнера '
        + 'их не выразить',
    }
  }

  const mainStart = startOf(first.selfLayout.margin, horizontal)
  const mainEnd = endOf(last.selfLayout.margin, horizontal)

  return {
    gap,
    padding: horizontal
      ? {
          top: node.layout.padding.top + (allAuto ? 0 : crossStart),
          bottom: node.layout.padding.bottom + (allAuto ? 0 : crossEnd),
          left: node.layout.padding.left + mainStart,
          right: node.layout.padding.right + mainEnd,
        }
      : {
          top: node.layout.padding.top + mainStart,
          bottom: node.layout.padding.bottom + mainEnd,
          left: node.layout.padding.left + (allAuto ? 0 : crossStart),
          right: node.layout.padding.right + (allAuto ? 0 : crossEnd),
        },
    align: allAuto ? 'center' : node.layout.align,
  }
}
