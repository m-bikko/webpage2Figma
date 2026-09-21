import type { IrNode } from '@w2f/ir'

/** Определяет, вдоль какой оси на самом деле выстроена сетка.
 *
 *  Figma двумерного auto-layout не имеет, но ОДНОМЕРНАЯ сетка — а их
 *  большинство — выражается обычным auto-layout, и отказывать ей
 *  незачем. Ось берётся из ИЗМЕРЕННОГО: браузер уже разложил детей,
 *  и по их прямоугольникам видно, стоят они в ряд или стопкой.
 *
 *  Измерено на живой странице: сведение сетки к колонке было главной
 *  причиной отказов от auto-layout. Двухколоночная сетка
 *  предсказывалась как стопка и расходилась с измеренным на сотни
 *  пикселей.
 *
 *  Двумерная сетка честно возвращает `null`: её вызывающий отвергнет
 *  с понятной причиной, а не с «положение не объясняется флексом». */
export const gridAxis = (node: IrNode): 'row' | 'column' | null => {
  const kids = node.children
  if (kids.length < 2) {
    /** Один ребёнок — ось не определить, но и раскладывать нечего:
     *  любая ось даст то же самое. Берём строку как более частую. */
    return 'row'
  }

  /** Перекрытие по оси означает, что дети НЕ разделены вдоль неё.
   *  Сравниваются интервалы, а не координаты: дети разной высоты в
   *  ряду начинаются в разных местах, но перекрываются по вертикали. */
  const overlapsVertically = kids.some((a, i) => kids.some((b, j) => {
    if (i >= j) return false
    return a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h
  }))
  const overlapsHorizontally = kids.some((a, i) => kids.some((b, j) => {
    if (i >= j) return false
    return a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w
  }))

  /** Ряд: дети перекрываются по вертикали и НЕ перекрываются по
   *  горизонтали. Колонка — наоборот. Если верно и то и другое (или
   *  ни то ни другое), сетка двумерная. */
  if (overlapsVertically && !overlapsHorizontally) return 'row'
  if (overlapsHorizontally && !overlapsVertically) return 'column'
  return null
}
