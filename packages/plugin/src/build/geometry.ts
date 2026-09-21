import type { IrNode, TextRun, Transform } from '@h2d/ir'

const scaleRun = (run: TextRun, sx: number): TextRun => ({
  ...run,
  fontSize: run.fontSize * sx,
  letterSpacing: run.letterSpacing * sx,
})

/** Поворот в том виде, в каком его понимает Figma.
 *
 *  ЗНАК ПРОТИВОПОЛОЖЕН нашему. Документация определяет `rotation` как
 *  `Math.atan2(-m10, m00)`. CSS `matrix(a, b, c, d, e, f)` раскладывается
 *  в `m00 = a`, `m10 = b`, а наш угол (план 1) — это `atan2(b, a)`,
 *  по часовой стрелке в системе с осью Y вниз. Отсюда
 *
 *      figmaRotation = atan2(-b, a) = -atan2(b, a) = -ourAngle
 *
 *  Перепутать знак — получить зеркальный поворот. Он выглядит
 *  совершенно правдоподобно и не заметен ни на чём симметричном,
 *  поэтому проверяется явным сравнением, а не через `Math.abs`.
 *
 *  ЕДИНИЦЫ ТОЖЕ РАЗНЫЕ. Наш контракт хранит угол в РАДИАНАХ, Figma
 *  отдаёт и принимает `rotation` в ГРАДУСАХ. Первая редакция этой
 *  функции возвращала просто `-angle`, и тест её не поймал, потому что
 *  был написан в тех же единицах, что и код: он проверял согласие
 *  реализации с собой, а не с Figma. Поэтому проверка построена на
 *  значениях, у которых радианы и градусы заведомо не совпадают.
 *
 *  `-0` сворачивается в `0`: он утекает в JSON как `-0` и ломает
 *  сравнение снапшотов. Та же причина, что и при нормализации
 *  градиентов в плане 2. */
export const figmaRotation = (transform: Transform | null): number => {
  if (transform === null) return 0
  const rotation = (-transform.angle * 180) / Math.PI
  return rotation === 0 ? 0 : rotation
}

/** Размеры узла в Figma.
 *
 *  Масштаб уходит СЮДА, а не в матрицу: у `relativeTransform` оси
 *  единичны (`sqrt(m00² + m10²) == 1` по документации), и положить в
 *  неё масштаб нельзя физически.
 *
 *  Поворот размеров не меняет: повёрнутый узел в Figma сохраняет свои
 *  `width`/`height`, поворот живёт отдельным свойством. Подставить сюда
 *  габарит повёрнутого прямоугольника значило бы раздуть узел — ровно
 *  тот дефект, который план 1 диагностировал как `transform-descendant`. */
export const sizeUnderTransform = (
  box: { w: number; h: number },
  transform: Transform | null,
): { width: number; height: number } => {
  if (transform === null) return { width: box.w, height: box.h }
  return { width: box.w * transform.scaleX, height: box.h * transform.scaleY }
}

const scaleStroke = (
  stroke: IrNode['style']['stroke'],
  sx: number,
  sy: number,
): IrNode['style']['stroke'] => {
  if (stroke === null) return null
  /** Горизонтальные стороны масштабируются по Y, вертикальные по X:
   *  толщина верхней границы — это вертикальный размер. Перепутать оси
   *  здесь заметно только при неравномерном масштабе. */
  return {
    ...stroke,
    weight: {
      top: stroke.weight.top * sy,
      bottom: stroke.weight.bottom * sy,
      left: stroke.weight.left * sx,
      right: stroke.weight.right * sx,
    },
  }
}

/** Вписывает масштаб в геометрию поддерева.
 *
 *  Нужно потому, что `resize` в Figma детей НЕ масштабирует, в отличие
 *  от CSS `transform: scale()`, который масштабирует элемент вместе с
 *  поддеревом. Без этого дети приехали бы исходного размера внутри
 *  растянутого родителя.
 *
 *  Результат визуально верен, но дерево перестаёт отражать исходные
 *  размеры: у потомков теперь другие кегли и радиусы. Молчать об этом
 *  нельзя — вызывающий обязан выдать `fidelity.scale-baked`. */
export const scaleSubtree = (
  nodes: readonly IrNode[],
  sx: number,
  sy: number,
): IrNode[] => nodes.map((node): IrNode => {
  /** Общая часть выносится отдельно, а дискриминант приписывается
   *  обратно ниже. Разложить размеченное объединение через `...node`
   *  и присвоить результат типу `IrNode` нельзя: TypeScript теряет
   *  связь дискриминанта с остальными полями и отвергает результат —
   *  и он прав, такая запись допускает узел с `kind: 'image'` без
   *  поля `image`. */
  const geometry = {
    rect: {
      x: node.rect.x * sx, y: node.rect.y * sy,
      w: node.rect.w * sx, h: node.rect.h * sy,
    },
    style: {
      ...node.style,
      corner: {
        tl: node.style.corner.tl * sx, tr: node.style.corner.tr * sx,
        br: node.style.corner.br * sx, bl: node.style.corner.bl * sx,
      },
      stroke: scaleStroke(node.style.stroke, sx, sy),
      shadows: node.style.shadows.map((shadow) => ({
        ...shadow,
        offsetX: shadow.offsetX * sx, offsetY: shadow.offsetY * sy,
        blur: shadow.blur * sx, spread: shadow.spread * sx,
      })),
    },
    children: scaleSubtree(node.children, sx, sy),
  }

  if (node.kind === 'text') {
    return {
      ...node, ...geometry,
      text: {
        ...node.text,
        lineHeight: node.text.lineHeight * sy,
        /** Голова и хвост разведены намеренно: контракт объявляет
         *  `runs` НЕпустым кортежем, а `.map()` эту гарантию теряет.
         *  Ослаблять тип ради удобства записи здесь нельзя — пустой
         *  список прогонов означал бы текст без единого начертания. */
        runs: [scaleRun(node.text.runs[0], sx), ...node.text.runs.slice(1).map(
          (run) => scaleRun(run, sx),
        )] as [TextRun, ...TextRun[]],
        lines: node.text.lines.map((line) => ({
          x: line.x * sx, y: line.y * sy,
          w: line.w * sx, h: line.h * sy, text: line.text,
        })),
      },
    }
  }
  return { ...node, ...geometry }
})
