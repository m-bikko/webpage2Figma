import type { LayoutProbe } from './probe.js'

const isPositioned = (p: LayoutProbe): boolean => p.position !== 'static'

/** Условия создания stacking context по CSS Positioned Layout и Compositing.
 *  Реализован практически доминирующий набор триггеров; редкие
 *  (`will-change`, `perspective`, сочетания `contain`) не учитываются
 *  и фиксируются вызывающим как Diagnostic. */
export const establishesStackingContext = (p: LayoutProbe): boolean => {
  if (p.position === 'fixed' || p.position === 'sticky') return true
  if (isPositioned(p) && p.zIndex !== 'auto') return true
  if (p.parentIsFlexOrGrid && p.zIndex !== 'auto') return true
  if (p.opacity < 1) return true
  if (p.hasTransform) return true
  if (p.hasFilter) return true
  if (p.hasMixBlendMode) return true
  if (p.isIsolated) return true
  return false
}

/** Узел участвует в стекинге контекста как самостоятельная единица,
 *  а не как часть потока. Сюда попадают позиционированные с `z-index: auto`:
 *  контекста они не создают, но красятся атомарно в бакете z=0.
 *
 *  Упрощение зафиксировано сознательно: по спецификации позиционированные
 *  потомки такого узла могут «убежать» в предка-контекст. Случай редкий,
 *  и вместо его моделирования вызывающий обязан породить Diagnostic —
 *  молчаливо неверный порядок недопустим, честное «не умеем» допустимо. */
const isStackingParticipant = (p: LayoutProbe): boolean =>
  isPositioned(p) || (p.parentIsFlexOrGrid && p.zIndex !== 'auto')

/** Тот же предикат под экспортируемым именем: нужен детектору
 *  приближения, а дублировать логику нельзя. */
export const isStackingParticipantExported = isStackingParticipant

type Bucket = 'negative' | 'flow' | 'float' | 'inline' | 'auto' | 'positive'

type Groups = Record<Bucket, LayoutProbe[]>

const emptyGroups = (): Groups => ({
  negative: [], flow: [], float: [], inline: [], auto: [], positive: [],
})

const bucketOf = (p: LayoutProbe): Bucket => {
  const z = p.zIndex
  /** `z-index` осмыслен только у позиционированных и у детей flex/grid.
   *  У статичного элемента `getComputedStyle` вернёт указанное значение,
   *  поэтому случайный `z-index: 0` на статике не должен поднимать его
   *  над потоковыми соседями. */
  const zMatters = isPositioned(p) || p.parentIsFlexOrGrid
  if (zMatters && typeof z === 'number' && z < 0) return 'negative'
  if (zMatters && typeof z === 'number' && z > 0) return 'positive'
  if (isPositioned(p)) return 'auto'
  if (zMatters && typeof z === 'number' && z === 0) return 'auto'
  if (p.isFloat) return 'float'
  if (p.isInline) return 'inline'
  return 'flow'
}

const zValue = (p: LayoutProbe): number => (p.zIndex === 'auto' ? 0 : p.zIndex)

/** Стабильная сортировка по z-index: при равных значениях сохраняется
 *  порядок документа, как того требует спецификация. */
const byZIndex = (items: LayoutProbe[]): LayoutProbe[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => zValue(a.item) - zValue(b.item) || a.index - b.index)
    .map(({ item }) => item)

/**
 * Порядок отрисовки внутри stacking context, по CSS 2.1 Appendix E:
 * сам элемент → отрицательные z-index → потоковые блоки → флоаты →
 * инлайны → позиционированные с auto/0 → положительные z-index.
 *
 * Возвращает Map id → индекс отрисовки. Индексы плотные и уникальные,
 * и это инвариант, который валидируется в `@w2f/ir`.
 */
export const resolvePaintOrder = (root: LayoutProbe): Map<string, number> => {
  const order = new Map<string, number>()
  let counter = 0

  const emit = (p: LayoutProbe): void => {
    order.set(p.id, counter)
    counter += 1
  }

  /** Собирает участников стекинга ОДНОГО контекста, поднимая
   *  позиционированных потомков из обычных потоковых обёрток.
   *
   *  Потоковый ребёнок кладётся в бакет `flow` И его дети продолжают
   *  собираться в ЭТОТ ЖЕ контекст — в этом и состоит подъём. Ребёнок,
   *  который создаёт контекст или участвует в стекинге самостоятельно,
   *  кладётся в свой бакет, а его поддерево красится вместе с ним,
   *  поэтому обход в него не заходит. */
  const collectInto = (node: LayoutProbe, groups: Groups): void => {
    for (const child of node.children) {
      if (establishesStackingContext(child) || isStackingParticipant(child)) {
        groups[bucketOf(child)].push(child)
        continue
      }
      groups[bucketOf(child)].push(child)
      collectInto(child, groups)
    }
  }

  /** Красит узел, который сам не создаёт контекст и не участвует в стекинге
   *  самостоятельно: его собственные дети уже собраны родительским
   *  `collectInto`, поэтому красится только он. */
  const paintFlowNode = (p: LayoutProbe): void => {
    emit(p)
  }

  /** Красит атомарную единицу: контекст или позиционированный узел
   *  с `z-index: auto`. Оба красятся вместе со своим поддеревом. */
  const paintUnit = (p: LayoutProbe): void => {
    emit(p)
    const groups = emptyGroups()
    collectInto(p, groups)
    paintGroups(groups)
  }

  /** Различение «атомарная единица» против «потоковая обёртка» вычисляется
   *  в `collectInto`, но к моменту покраски остаётся только ярлык бакета,
   *  а его недостаточно: stacking context, созданный НЕ позиционированием
   *  (`opacity < 1`, `transform`, `filter`, `mix-blend-mode`, `isolation`),
   *  попадает в `flow`, потому что `zMatters` и `isPositioned` для него
   *  ложны. Поэтому различение восстанавливается здесь.
   *
   *  Без этого `<div style="opacity:.5">` с содержимым терял ВСЁ поддерево:
   *  `collectInto` внутрь не спускался (правильно — узел атомарен), а
   *  `paintFlowNode` только испускал индекс. Ни одна сторона поддерево
   *  не посещала, и инвариант плотности в `@w2f/ir` отверг бы такой бандл.
   *
   *  Размещение в бакете `flow` при этом верное: по CSS 2.1 Appendix E
   *  непозиционированный stacking context красится атомарно на своём
   *  месте в потоке. Неверен был только красильщик. */
  const paintInFlow = (p: LayoutProbe): void => {
    if (establishesStackingContext(p)) paintUnit(p)
    else paintFlowNode(p)
  }

  const paintGroups = (groups: Groups): void => {
    for (const child of byZIndex(groups.negative)) paintUnit(child)
    for (const child of groups.flow) paintInFlow(child)
    for (const child of groups.float) paintInFlow(child)
    for (const child of groups.inline) paintInFlow(child)
    for (const child of byZIndex(groups.auto)) paintUnit(child)
    for (const child of byZIndex(groups.positive)) paintUnit(child)
  }

  paintUnit(root)
  return order
}

/** Находит узлы, для которых порядок отрисовки ПРИБЛИЖЁН.
 *
 *  `isStackingParticipant` считает атомарным любой позиционированный узел,
 *  включая `z-index: auto`. По CSS 2.1 Appendix E шаг 8 такой узел
 *  красится как если бы создавал контекст, **но его позиционированные
 *  потомки и потомки, создающие контекст, принадлежат РОДИТЕЛЬСКОМУ
 *  контексту**, то есть должны подниматься сквозь него. Резолвер этого не
 *  делает — сознательное упрощение, подтверждённое в настоящем Chrome.
 *
 *  Упрощение допустимо, молчание о нём — нет. Функция находит ровно те
 *  случаи, где оно могло сказаться: позиционированный узел с
 *  `z-index: auto`, в поддереве которого есть участник стекинга.
 *  Там, где таких потомков нет, приближение ни на что не влияет и
 *  диагностика была бы шумом.
 *
 *  Замену упрощения настоящим подъёмом ведёт план 2: у этого алгоритма
 *  уже три раунда исправлений, каждый вносил новый дефект, и четвёртый
 *  без падающего pixel-diff в качестве ориентира делать не стоит. */
export const findApproximatedOrder = (root: LayoutProbe): string[] => {
  const approximated: string[] = []

  const hasParticipantInside = (p: LayoutProbe): boolean =>
    p.children.some(
      (child) =>
        establishesStackingContext(child) ||
        isStackingParticipantExported(child) ||
        hasParticipantInside(child),
    )

  const visit = (p: LayoutProbe): void => {
    if (
      p.position !== 'static' &&
      p.zIndex === 'auto' &&
      !establishesStackingContext(p) &&
      hasParticipantInside(p)
    ) {
      approximated.push(p.id)
    }
    for (const child of p.children) visit(child)
  }

  visit(root)
  return approximated
}

/** Позиционированные потомки узла, который сам не создаёт контекст,
 *  подняты в предка-контекст. Это правильно по CSS, но означает, что
 *  дерево Figma такой порядок выразить не сможет: в Figma z-порядок
 *  задаётся порядком среди СИБЛИНГОВ. Функция находит такие случаи,
 *  чтобы плагин мог либо перестроить дерево, либо честно сообщить.
 *
 *  Живёт здесь, а не в рендерере: её нужны и рендерер, и плагин Figma. */
export const findInterleaved = (
  root: LayoutProbe,
  order: Map<string, number>,
): string[] => {
  const interleaved: string[] = []

  const subtreeIds = (p: LayoutProbe, out: Set<string>): Set<string> => {
    out.add(p.id)
    for (const child of p.children) subtreeIds(child, out)
    return out
  }

  const all: LayoutProbe[] = []
  const flatten = (p: LayoutProbe): void => {
    all.push(p)
    for (const child of p.children) flatten(child)
  }
  flatten(root)

  /** Помечается только вклинивание узла, который МОЖЕТ перекрывать —
   *  участника стекинга или создателя контекста.
   *
   *  Ограничение обязательное, иначе диагностика превращается в шум.
   *  По CSS 2.1 Appendix E фоны блоков красятся на шаге 3, а инлайновое
   *  содержимое на шаге 5, поэтому `<b>` внутри первого абзаца красится
   *  ПОСЛЕ второго абзаца, и диапазон первого оказывается разорван.
   *  Порядок при этом верный, а для Figma безразличен: инлайновый текст
   *  не перекрывает соседний блок, и вложенность даёт тот же результат.
   *  Без этого ограничения диагностика срабатывала бы на каждом абзаце со
   *  ссылкой или выделением, за которым идёт другой абзац — то есть почти
   *  на каждой странице. Диагностика, срабатывающая всегда, учит
   *  игнорировать отчёт целиком. */
  const canOverlap = (p: LayoutProbe): boolean =>
    establishesStackingContext(p) || isStackingParticipantExported(p)

  for (const node of all) {
    const own = order.get(node.id)
    if (own === undefined) continue

    const ids = subtreeIds(node, new Set<string>())
    let min = own
    let max = own
    for (const id of ids) {
      const value = order.get(id)
      if (value === undefined) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    if (max - min + 1 === ids.size) continue

    const intruder = all.find((other) => {
      if (ids.has(other.id)) return false
      const value = order.get(other.id)
      if (value === undefined) return false
      return value > min && value < max && canOverlap(other)
    })
    if (intruder !== undefined) interleaved.push(node.id)
  }

  return [...new Set(interleaved)]
}
