import type { NodeLayout, Sides } from '@w2f/ir'

export type Size = { width: number; height: number }
export type Placement = { x: number; y: number }

/** Предсказывает, куда флекс поставит детей.
 *
 *  Задача решателя — НЕ разложить, а предсказать то, что браузер уже
 *  сделал. Совпало предсказание с измеренными `rect` — раскладка
 *  объяснима флексом, и auto-layout имеет шанс совпасть. Не совпало —
 *  в CSS есть что-то за пределами нашей модели, и навязывать
 *  auto-layout нельзя.
 *
 *  Поддерживается ровно то, что Figma выражает точно: направление,
 *  зазор, отступы, выравнивание по обеим осям. Перенос строк,
 *  `order`, `margin: auto`, дробный `flex-grow` — сознательно нет, и
 *  узел с ними останется абсолютным. Расширять этот список можно
 *  только с доказательством: решатель обязан совпасть с браузером на
 *  фикстуре. */
export const solveLayout = (
  layout: NodeLayout,
  container: Size,
  children: readonly Size[],
  /** Толщина рамки контейнера по сторонам.
   *
   *  Нужна потому, что флекс раскладывает детей в CONTENT BOX — то
   *  есть после рамки И отступов, — а `rect` узла это border box.
   *  Забыть рамку значит промахнуться ровно на её толщину: на живой
   *  странице это давало расхождение в один пиксель и отказ от
   *  auto-layout там, где он верен.
   *
   *  Тот же класс ошибки, что и с `background-origin` в плане 4:
   *  координаты считаются не от того бокса. */
  border: Sides = { top: 0, right: 0, bottom: 0, left: 0 },
): Placement[] => {
  if (children.length === 0) return []

  const horizontal = layout.mode === 'row'
  const padding = {
    top: layout.padding.top + border.top,
    right: layout.padding.right + border.right,
    bottom: layout.padding.bottom + border.bottom,
    left: layout.padding.left + border.left,
  }

  /** Продольная ось — та, вдоль которой складываются дети.
   *  Разведение на «главную» и «поперечную» вместо x/y нужно ровно
   *  затем, чтобы колонка не оказалась рядом, повёрнутым на бок:
   *  на квадратных детях перепутанные оси невидимы. */
  const mainStart = horizontal ? padding.left : padding.top
  const mainEnd = horizontal ? padding.right : padding.bottom
  const crossStart = horizontal ? padding.top : padding.left
  const crossEnd = horizontal ? padding.bottom : padding.right

  const mainSpace = (horizontal ? container.width : container.height)
    - mainStart - mainEnd
  const crossSpace = (horizontal ? container.height : container.width)
    - crossStart - crossEnd

  const mainOf = (size: Size): number => (horizontal ? size.width : size.height)
  const crossOf = (size: Size): number => (horizontal ? size.height : size.width)

  const used = children.reduce((sum, child) => sum + mainOf(child), 0)
    + layout.gap * (children.length - 1)
  const free = mainSpace - used

  /** Начальное смещение и добавка между детьми — две разные величины,
   *  и путать их нельзя: `center` двигает блок целиком, а
   *  `space-between` раздвигает детей внутри него. */
  let offset = mainStart
  let extraBetween = 0
  if (layout.justify === 'center') offset += free / 2
  else if (layout.justify === 'end') offset += free
  else if (layout.justify === 'space-between') {
    extraBetween = children.length > 1 ? free / (children.length - 1) : 0
  } else if (layout.justify === 'space-around') {
    const each = children.length > 0 ? free / children.length : 0
    offset += each / 2
    extraBetween = each
  }

  const crossOffsetFor = (size: Size): number => {
    const room = crossSpace - crossOf(size)
    if (layout.align === 'center') return crossStart + room / 2
    if (layout.align === 'end') return crossStart + room
    /** `stretch` попадает сюда и ведёт себя как `start` — и это не
     *  упрощение, а точность.
     *
     *  Растяжение меняет РАЗМЕР ребёнка, а не его положение по
     *  поперечной оси: растянутый ребёнок всё равно начинается у
     *  края. А размеры в IR уже измерены браузером — растягивать
     *  нечего, они пришли готовыми.
     *
     *  Это важно практически: `stretch` — значение `align-items` по
     *  умолчанию, и отвергать его значило бы не применять auto-layout
     *  почти никогда.
     *
     *  Цена названа честно: рамка перестаёт быть отзывчивой — при
     *  изменении её размера дети не перетянутся, потому что у них
     *  фиксированные размеры. Импорт и так снимок, а не живая
     *  раскладка.
     *
     *  `baseline` сюда не доходит: вердикт объявляет такие узлы
     *  небезопасными, потому что положение по базовой линии зависит
     *  от метрик шрифта, которых у нас нет. */
    return crossStart
  }

  const out: Placement[] = []
  for (const child of children) {
    const cross = crossOffsetFor(child)
    out.push(horizontal ? { x: offset, y: cross } : { x: cross, y: offset })
    offset += mainOf(child) + layout.gap + extraBetween
  }
  return out
}
