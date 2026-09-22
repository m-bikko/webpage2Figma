import type { IrNode } from '@w2f/ir'
import { solveLayout, type Placement } from './solve.js'
import { foldMargins } from './fold.js'
import { gridAxis } from './grid.js'
import type { NodeLayout, Sides } from '@w2f/ir'

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
  | {
      safe: true
      expected: Placement[]
      /** Кто из детей в очереди auto-layout, а кто стоит абсолютно.
       *  Порядок тот же, что у `children` и `expected`. */
      positioning: ('AUTO' | 'ABSOLUTE')[]
      /** Ось, по которой раскладывать. Для сетки выведена из
       *  измеренного и может не совпадать с `layout.mode`. */
      mode: 'row' | 'column'
      /** Параметры, СВЁРНУТЫЕ из внешних отступов детей. Отдаются
       *  наружу потому, что в Figma поедут именно они, а не исходные:
       *  у auto-layout нет отступов на ребёнке. */
      gap: number
      padding: Sides
      align: NodeLayout['align']
    }
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
    return { safe: false, reason: 'узел не является контейнером раскладки' }
  }
  if (node.children.length === 0) {
    return { safe: false, reason: 'детей нет — раскладывать нечего' }
  }

  /** Сетка выражается auto-layout, если она ОДНОМЕРНАЯ. Ось берётся
   *  из измеренного: браузер уже разложил детей. Двумерную отвергаем
   *  с понятной причиной — «в Figma нет двумерного auto-layout», а не
   *  «положение не объясняется флексом». */
  const axis = node.layout.mode === 'grid' ? gridAxis(node) : node.layout.mode
  if (axis === null) {
    return {
      safe: false,
      reason: 'двумерная сетка: в Figma нет двумерного auto-layout',
    }
  }
  if (axis !== 'row' && axis !== 'column') {
    return { safe: false, reason: 'узел не является контейнером раскладки' }
  }
  const mode: 'row' | 'column' = axis
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

  /** АБСОЛЮТНЫЕ дети из флекса ИСКЛЮЧАЮТСЯ, а не отвергают его.
   *
   *  Так устроен и CSS: `position: absolute` выводит элемент из потока,
   *  и флекс раскладывает остальных без него. И так устроена Figma:
   *  у ребёнка auto-layout есть `layoutPositioning: 'ABSOLUTE'`, с
   *  которым он остаётся внутри рамки, но в очередь не встаёт.
   *  Прежний отказ «ребёнок с position: absolute сдвинул бы остальных»
   *  описывал поведение по умолчанию, а не единственно возможное; на
   *  бандле пользователя он давал 24 отказа, и каждый — бейдж или
   *  иконка в углу карточки, ради которой карточка и лишалась
   *  раскладки.
   *
   *  `sticky` и `float` остаются отказом: первый в потоке, но
   *  смещён, второй раскладывается вовсе не флексом. */
  for (const child of node.children) {
    if (isAbsolute(child)) continue
    if (child.selfLayout.positioning !== 'flow') {
      return {
        safe: false,
        reason: `ребёнок с position: ${child.selfLayout.positioning} — `
          + 'в auto-layout он встал бы в очередь и сдвинул остальных',
      }
    }
    /** `flex-grow` и свой `align-self` БОЛЬШЕ НЕ отвергаются.
     *
     *  Оба влияют на РАЗМЕР и на положение внутри поперечной оси — а
     *  размеры в IR уже измерены браузером, и положение проверяется
     *  сравнением ниже. Если положение сошлось, значит auto-layout с
     *  фиксированными размерами даёт ту же картину, и отвергать её
     *  незачем.
     *
     *  Измерено на живой странице: `flex-grow` давал 39 отказов из
     *  125 — вторая причина по частоте, и вся она была
     *  перестраховкой.
     *
     *  Цена та же, что у `stretch`: рамка не отзывчива, дети не
     *  перетянутся при изменении размера. Импорт — снимок.
     *
     *  Предварительные проверки остаются только там, где сравнение
     *  положений бессильно или где отдельное сообщение полезнее
     *  общего «положение не сошлось». */
  }

  /** Рамка контейнера сдвигает содержимое: флекс раскладывает детей
   *  в content box, а `rect` — это border box. */
  const border = node.style.stroke?.weight
    ?? { top: 0, right: 0, bottom: 0, left: 0 }

  /** Внешние отступы детей сворачиваются в отступы контейнера и
   *  зазор: у auto-layout нет отступов на ребёнке. Не свернулось —
   *  честный отказ с причиной. */
  const flow = node.children.filter((child) => !isAbsolute(child))
  if (flow.length === 0) {
    return { safe: false, reason: 'все дети позиционированы абсолютно — раскладывать нечего' }
  }
  const folded = foldMargins({ ...node, children: flow }, mode)
  if ('reason' in folded) return { safe: false, reason: folded.reason }

  const effective: NodeLayout = {
    ...node.layout,
    mode,
    gap: folded.gap,
    padding: folded.padding,
    align: folded.align,
  }

  const solved = solveLayout(
    effective,
    { width: node.rect.w, height: node.rect.h },
    flow.map((child) => ({ width: child.rect.w, height: child.rect.h })),
    border,
  )

  /** `expected` — по ВСЕМ детям, в их порядке: применитель сверяет
   *  каждого. Абсолютному ожидается его собственное место — Figma с
   *  `ABSOLUTE` его не трогает, и сверка это подтвердит. */
  const expected: Placement[] = []
  const positioning: ('AUTO' | 'ABSOLUTE')[] = []
  let cursor = 0
  for (const [index, child] of node.children.entries()) {
    if (isAbsolute(child)) {
      expected.push({ x: child.rect.x, y: child.rect.y })
      positioning.push('ABSOLUTE')
      continue
    }
    const place = solved[cursor]
    cursor += 1
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
    expected.push(place)
    positioning.push('AUTO')
  }

  return {
    safe: true, expected, positioning, mode,
    gap: folded.gap, padding: folded.padding, align: folded.align,
  }
}

const isAbsolute = (child: IrNode): boolean =>
  child.selfLayout.positioning === 'absolute'
  || child.selfLayout.positioning === 'fixed'
