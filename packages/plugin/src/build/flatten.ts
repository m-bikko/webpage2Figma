import type { SceneNode } from '../scene.js'

/** СХЛОПЫВАНИЕ НЕВИДИМЫХ ОБЁРТОК.
 *
 *  Дерево IR повторяет DOM, и это правильно: оно описывает страницу.
 *  Но панель слоёв Figma — не DOM, и вёрстка нынче такова, что больше
 *  половины узлов не рисуют НИЧЕГО: измерено на figma.com — 412
 *  невидимых обёрток из 762 узлов при глубине 15. Дизайнер получает
 *  лестницу из `div` внутри `div`, по которой невозможно найти ничего.
 *
 *  Схлопывание происходит ЗДЕСЬ, в сцене, а не в IR. Разделение
 *  существенное: IR обязан оставаться точным описанием страницы —
 *  на нём стоят пиксельный гейт и круговой обход, — а сцена есть то,
 *  что удобно человеку в Figma. Смешав их, мы потеряли бы способ
 *  проверить, что схлопывание ничего не сломало.
 *
 *  Проверяется схлопывание тем же круговым обходом: он сравнивает
 *  картинку СЦЕНЫ с браузером, и если поднятый узел уехал хоть на
 *  пиксель, гейт это увидит. */

/** Вносит ли узел что-нибудь ВИДИМОЕ.
 *
 *  Список намеренно широкий: дешевле оставить лишнюю обёртку, чем
 *  потерять фон или обрезку. Каждая строка здесь — то, что узел
 *  рисует или как он влияет на рисование детей. */
const isVisible = (node: SceneNode): boolean => {
  const { base } = node
  if (node.kind !== 'frame') return true
  if (base.fills.length > 0) return true
  if (base.stroke !== null) return true
  if (base.effects.length > 0) return true
  if (base.opacity < 1) return true
  if (base.blendMode !== 'NORMAL') return true
  if (base.rotation !== 0) return true
  if (node.clipsContent) return true
  /** Узел, создававший в CSS stacking context, ИЗОЛИРУЕТ смешение
   *  своих детей от того, что под ним. Заливки у него может не быть
   *  вовсе — `isolation: isolate` создаёт контекст сам по себе, — но
   *  убрать его значит выпустить детей смешиваться с чужим фоном.
   *  Поймал это круговой обход на фикстуре `blend-isolated`. */
  if (base.isolates) return true
  const { tl, tr, br, bl } = base.corner
  if (tl > 0 || tr > 0 || br > 0 || bl > 0) return true
  return false
}

/** Можно ли поднять детей узла к его родителю.
 *
 *  `parentHasLayout` — единственное условие, которое смотрит наружу, и
 *  без него схлопывание ломало бы auto-layout: дети обёртки стали бы
 *  элементами чужой раскладки и встали бы в ряд вместо своего места.
 *  Сама обёртка с auto-layout не схлопывается по той же причине — её
 *  раскладка держит детей. */
const canCollapse = (node: SceneNode, parentHasLayout: boolean): boolean => {
  if (isVisible(node)) return false
  if (node.base.autoLayout !== null) return false
  if (parentHasLayout) return fillsExactly(node)
  return true
}

/** Внутри auto-layout схлопывается ТОЛЬКО обёртка, которую единственный
 *  ребёнок занимает целиком.
 *
 *  Общий запрет схлопывать внутри auto-layout верен: дети обёртки
 *  стали бы элементами чужой раскладки и встали бы не туда. Но если
 *  ребёнок один и его бокс совпадает с боксом обёртки, замена одного
 *  на другой ничего в раскладке не меняет — элемент того же размера
 *  на том же месте. Это единственный случай, где безопасность следует
 *  из построения, а не из надежды.
 *
 *  Именно такие обёртки и дают глубину: на живом figma.com глубина 29
 *  оставалась 20 после первого схлопывания, потому что почти всё
 *  дерево там лежит внутри auto-layout. */
const fillsExactly = (node: SceneNode): boolean => {
  const [only, ...rest] = node.base.children
  if (only === undefined || rest.length > 0) return false
  const { base } = only
  return base.x === 0 && base.y === 0
    && base.width === node.base.width && base.height === node.base.height
}

/** Схлопывает поддерево, возвращая узлы, которые займут место
 *  исходного: сам узел (если он нужен), либо его поднятых детей, либо
 *  ничего.
 *
 *  Пустой невидимый узел исчезает целиком — он не рисует ничего и не
 *  содержит ничего. На figma.com таких 17. */
const collapseInto = (
  node: SceneNode,
  parentHasLayout: boolean,
): SceneNode[] => {
  const children = node.base.children.flatMap(
    (child) => collapseInto(child, node.base.autoLayout !== null),
  )
  const kept: SceneNode = { ...node, base: { ...node.base, children } }

  if (!canCollapse(node, parentHasLayout)) return [kept]
  if (children.length === 0) return []

  /** Дети поднимаются НА МЕСТО узла, поэтому их координаты, до сих пор
   *  отсчитанные от него, сдвигаются на его положение. Забыть об этом
   *  значит собрать макет, где каждый поднятый узел уехал на смещение
   *  исчезнувшей обёртки — и чем глубже вложенность, тем дальше. */
  return children.map((child) => ({
    ...child,
    base: {
      ...child.base,
      x: child.base.x + node.base.x,
      y: child.base.y + node.base.y,
    },
  }))
}

/** Корень НЕ схлопывается никогда: он держит экран целиком, и его
 *  размер — размер макета. */
export const flattenScene = (root: SceneNode): SceneNode => {
  const children = root.base.children.flatMap(
    (child) => collapseInto(child, root.base.autoLayout !== null),
  )
  return { ...root, base: { ...root.base, children } }
}
