import type { IrNode } from '@w2f/ir'
import { solveLayout, type Placement } from './solve.js'

/** Допуск на совпадение, в пикселях.
 *
 *  Не назначен, а вынужден: браузер отдаёт дробные размеры, и зазор
 *  на нескольких детях накапливает доли пикселя. Требовать точного
 *  совпадения значило бы отвергать раскладки, которые флекс
 *  воспроизводит верно.
 *
 *  Полпикселя — граница, за которой расхождение перестаёт быть
 *  округлением и становится сдвигом: `margin: 1px` уже не пройдёт. */
const TOLERANCE = 0.5

export type AutoLayoutVerdict =
  | { safe: true; expected: Placement[] }
  | { safe: false; reason: string }

/** Безопасно ли навязывать узлу auto-layout.
 *
 *  Осторожность НЕСИММЕТРИЧНА намеренно. Ложное «безопасно» ломает
 *  геометрию, ради которой писались шесть планов; ложное
 *  «небезопасно» оставляет абсолютные координаты — то, что было до
 *  этого плана. Поэтому при любом сомнении вердикт отрицательный, и
 *  расширять список допустимого можно только с доказательством на
 *  фикстуре. */
export const autoLayoutVerdict = (node: IrNode): AutoLayoutVerdict => {
  if (node.layout.mode === 'none') {
    return { safe: false, reason: 'узел не является флекс-контейнером' }
  }
  if (node.children.length === 0) {
    return { safe: false, reason: 'детей нет — раскладывать нечего' }
  }
  if (node.layout.wrap) {
    return {
      safe: false,
      reason: 'включён перенос строк: Figma переносит по своим правилам, '
        + 'и совпадение надо доказывать отдельно',
    }
  }
  /** `space-around` и `space-evenly` Figma не выражает: у неё есть
   *  только `SPACE_BETWEEN`. Свести их к «в начало» значило бы молча
   *  подменить раскладку — узел остаётся абсолютным. */
  if (node.layout.justify === 'space-around'
      || node.layout.justify === 'space-evenly') {
    return {
      safe: false,
      reason: `распределение "${node.layout.justify}" Figma не выражает: `
        + 'у неё есть только space-between',
    }
  }
  /** `stretch` НЕ отвергается: он меняет размер ребёнка, а не его
   *  положение, и размеры в IR уже измерены браузером. Отвергать его
   *  значило бы не применять auto-layout почти никогда — это значение
   *  `align-items` по умолчанию. Проверено на живой раскладке.
   *
   *  `baseline` отвергается: положение по базовой линии зависит от
   *  метрик шрифта, которых у нас нет. */
  if (node.layout.align === 'baseline') {
    return {
      safe: false,
      reason: 'выравнивание по базовой линии предсказать нельзя: '
        + 'оно зависит от метрик шрифта',
    }
  }

  for (const child of node.children) {
    if (child.selfLayout.positioning !== 'flow') {
      return {
        safe: false,
        reason: `ребёнок с position: ${child.selfLayout.positioning} — `
          + 'в auto-layout он встал бы в очередь и сдвинул остальных',
      }
    }
    if (child.selfLayout.grow > 0) {
      return {
        safe: false,
        reason: 'ребёнок растягивается (flex-grow): распределение свободного '
          + 'места повторить нельзя',
      }
    }
    if (child.selfLayout.align !== null) {
      return {
        safe: false,
        reason: 'у ребёнка своё align-self: Figma задаёт выравнивание на '
          + 'контейнере, а не поштучно',
      }
    }
  }

  const expected = solveLayout(
    node.layout,
    { width: node.rect.w, height: node.rect.h },
    node.children.map((child) => ({ width: child.rect.w, height: child.rect.h })),
  )

  for (const [index, child] of node.children.entries()) {
    const place = expected[index]
    if (place === undefined) {
      return { safe: false, reason: 'решатель не дал положения для всех детей' }
    }
    if (Math.abs(place.x - child.rect.x) > TOLERANCE
        || Math.abs(place.y - child.rect.y) > TOLERANCE) {
      return {
        safe: false,
        reason: `положение ребёнка ${index + 1} не объясняется флексом: `
          + `флекс даёт (${place.x.toFixed(1)}, ${place.y.toFixed(1)}), `
          + `браузер намерил (${child.rect.x.toFixed(1)}, ${child.rect.y.toFixed(1)})`,
      }
    }
  }

  return { safe: true, expected }
}
