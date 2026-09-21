import type { IrNode } from '@w2f/ir'

/** ПЕРЕНОС ВСПЛЫВШИХ УЗЛОВ.
 *
 *  Резолвер порядка умеет выражать шаг 8 CSS 2.1 Appendix E: у
 *  позиционированного узла с `z-index: auto` позиционированные потомки
 *  принадлежат родительскому контексту, а не ему, и потому красятся
 *  позже — среди бакетов предка.
 *
 *  Но выразить это ОДНОЙ НУМЕРАЦИЕЙ нельзя, и это главное, что здесь
 *  надо понимать. И эталонный рендерер, и дерево Figma вложенные:
 *  потомок рисуется внутри родителя, сразу за ним, и уйти за его
 *  спину, оставаясь его ребёнком, не может. Номер, который говорит
 *  «покрась меня позже», в таком дереве просто некому исполнить —
 *  измерено: после правки резолвера порядок в IR стал верным, а
 *  расхождение на `fixtures/pseudo-stacking` осталось теми же 9600
 *  пикселями.
 *
 *  Поэтому узел переносится ФИЗИЧЕСКИ: становится ребёнком того
 *  контекста, в который всплыл. Дерево перестаёт повторять DOM — но
 *  оно и не обязано: дерево Figma повторяет не разметку, а то, что
 *  нарисовано. Порядок среди сиблингов там и есть z-порядок, и
 *  единственный способ сказать «этот блок поверх того» — положить их
 *  рядом.
 *
 *  Перенос делается ТОЧЕЧНО, только там, где он меняет картинку. См.
 *  `changesPicture`: у подавляющего большинства всплывших узлов между
 *  ними и родителем нет ничего, с чем они пересекаются, и тогда
 *  перенос — чистая потеря группировки без единого выигранного
 *  пикселя. Дизайнеру нужна карточка с бейджем внутри, а не бейдж,
 *  улетевший на верхний уровень. */

type Box = { x: number; y: number; w: number; h: number }

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Абсолютные боксы всех узлов и путь до каждого.
 *
 *  Координаты в контракте ЛОКАЛЬНЫЕ — относительно родителя, — а
 *  сравнивать на пересечение можно только абсолютные. Заодно
 *  собирается цепочка предков: по ней считается новое смещение при
 *  переносе и проверяется, нет ли на пути трансформы. */
type Placed = {
  node: IrNode
  abs: Box
  path: IrNode[]
}

const index = (root: IrNode): Map<string, Placed> => {
  const map = new Map<string, Placed>()
  const visit = (node: IrNode, at: { x: number; y: number }, path: IrNode[]): void => {
    const abs = {
      x: at.x + node.rect.x, y: at.y + node.rect.y,
      w: node.rect.w, h: node.rect.h,
    }
    map.set(node.id, { node, abs, path })
    const next = [...path, node]
    for (const child of node.children) visit(child, { x: abs.x, y: abs.y }, next)
  }
  visit(root, { x: 0, y: 0 }, [])
  return map
}

const descendantsOf = (node: IrNode): IrNode[] => {
  const out: IrNode[] = []
  const visit = (current: IrNode): void => {
    for (const child of current.children) {
      out.push(child)
      visit(child)
    }
  }
  visit(node)
  return out
}

/** Порядок, в котором узлы нарисует ВЛОЖЕННЫЙ обход.
 *
 *  Так рисует эталонный рендерер и так строит слои Figma: узел, потом
 *  его дети по `paintOrder`, потом следующий сосед. Номер отсюда — то,
 *  что получится НА САМОМ ДЕЛЕ; `paintOrder` — то, что должно быть.
 *  Расхождение между ними и есть предмет переноса.
 *
 *  Без этой величины судить о необходимости переноса нечем. Первая
 *  редакция сравнивала `paintOrder` узла с `paintOrder` его родителя и
 *  переносила всё, что между ними хоть с чем-то пересекается. Критерий
 *  оказался много шире нужного: из флекс-карточки уезжал абсолютный
 *  бейдж, хотя вложенный обход рисовал его правильно, — то есть
 *  ломалась группировка ради ничего. */
const nestedOrder = (root: IrNode): Map<string, number> => {
  const out = new Map<string, number>()
  let counter = 0
  const visit = (node: IrNode): void => {
    out.set(node.id, counter)
    counter += 1
    for (const child of [...node.children].sort(
      (a, b) => a.paintOrder - b.paintOrder,
    )) visit(child)
  }
  visit(root)
  return out
}

/** Нужен ли перенос: рисует ли вложенный обход поверх узла то, что
 *  обязано лежать под ним.
 *
 *  Ищется узел, который во вложенном обходе идёт ПОЗЖЕ (значит
 *  накрывает), а по `paintOrder` обязан идти РАНЬШЕ, и при этом с
 *  нашим узлом пересекается. Нет такого — картинка верна и без
 *  переноса, сколько бы ни было записей в отчёте.
 *
 *  Потомки самого узла исключены: они едут вместе с ним и накрывать
 *  его им положено. */
const needsHoist = (
  subject: Placed,
  nested: Map<string, number>,
  all: Placed[],
): boolean => {
  const mine = nested.get(subject.node.id)
  if (mine === undefined) return false
  const inside = new Set(
    [subject.node, ...descendantsOf(subject.node)].map((node) => node.id),
  )
  return all.some((other) => {
    if (inside.has(other.node.id)) return false
    const theirs = nested.get(other.node.id)
    if (theirs === undefined) return false
    /** Накрывает во вложенном обходе, а должен быть под. */
    if (theirs <= mine) return false
    if (other.node.paintOrder >= subject.node.paintOrder) return false
    return overlaps(other.abs, subject.abs)
  })
}

export type HoistResult = {
  root: IrNode
  /** Перенесённые узлы: о каждом обязан быть отчёт. Перенос меняет
   *  иерархию, и молчать о нём нельзя — дизайнер вправе знать, почему
   *  слой лежит не там, где элемент в разметке. */
  hoisted: { id: string; toId: string }[]
  /** Перенести не удалось: на пути есть трансформа, и сложение
   *  локальных смещений дало бы неверные координаты. Молча оставить
   *  такой узел нельзя — порядок остаётся неверным. */
  blockedByTransform: string[]
  /** Порядок остался неверным и после всех проходов: вложенное дерево
   *  этого расположения не выражает. Это и есть честная мера
   *  «Figma так не умеет» — в отличие от прежней, которая считалась по
   *  дереву ДО переноса и потому сообщала о разрывах, уже устранённых. */
  stillWrong: string[]
}

/** Ближайший предок, создающий настоящий stacking context, — то есть
 *  тот, в чьих бакетах всплывший узел и оказывается. Корень годится
 *  всегда: он контекст по определению. */
const targetFor = (path: IrNode[]): IrNode | null => {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const candidate = path[i]
    if (candidate === undefined) continue
    if (candidate.isStackingContext || i === 0) return candidate
  }
  return null
}

export const hoistEscaped = (root: IrNode): HoistResult => {
  const hoisted: { id: string; toId: string }[] = []
  const blocked = new Set<string>()

  /** Итерации: перенос меняет вложенный порядок, и узел, который до
   *  него был нарисован верно, может стать неверным — и наоборот.
   *  Предел стоит потому, что доказательства сходимости у этого
   *  процесса нет, а зацикливание на живой странице выглядело бы как
   *  повисший захват. Достигнутый предел — не молчаливая сдача:
   *  оставшиеся расхождения ловит проверка ниже и объясняет отчёт. */
  for (let pass = 0; pass < 4; pass += 1) {
    const placed = index(root)
    const all = [...placed.values()]
    const nested = nestedOrder(root)

    type Move = { node: IrNode; from: IrNode; to: IrNode; offset: { x: number; y: number } }
    const moves: Move[] = []

    for (const entry of all) {
      const parent = entry.path[entry.path.length - 1]
      if (parent === undefined) continue
      if (blocked.has(entry.node.id)) continue
      if (!needsHoist(entry, nested, all)) continue

      const target = targetFor(entry.path)
      if (target === null || target.id === parent.id) continue

      const fromIndex = entry.path.findIndex((node) => node.id === target.id)
      if (fromIndex < 0) continue
      const between = entry.path.slice(fromIndex + 1)

      /** Трансформа на пути делает сложение смещений неверным: под
       *  поворотом локальные оси родителя не совпадают с осями цели.
       *  Такой узел не переносится, и об этом обязан быть отчёт —
       *  тихо оставить его значило бы выдать неверный порядок за
       *  верный. */
      if (between.some((node) => node.transform !== null)) {
        blocked.add(entry.node.id)
        continue
      }

      const offset = between.reduce(
        (acc, node) => ({ x: acc.x + node.rect.x, y: acc.y + node.rect.y }),
        { x: 0, y: 0 },
      )
      moves.push({ node: entry.node, from: parent, to: target, offset })
    }

    if (moves.length === 0) break

    for (const move of moves) {
      const at = move.from.children.indexOf(move.node)
      if (at < 0) continue
      move.from.children.splice(at, 1)
      move.node.rect = {
        ...move.node.rect,
        x: move.node.rect.x + move.offset.x,
        y: move.node.rect.y + move.offset.y,
      }
      move.to.children.push(move.node)
      hoisted.push({ id: move.node.id, toId: move.to.id })
    }
  }

  /** Что осталось неверным после всех проходов. Признать это обязано
   *  само перенесение: молчаливо неверный порядок — та самая ошибка,
   *  против которой заведена вся диагностика проекта. */
  const finalPlaced = index(root)
  const finalNested = nestedOrder(root)
  const finalAll = [...finalPlaced.values()]
  const stillWrong: string[] = []
  for (const entry of finalAll) {
    if (blocked.has(entry.node.id)) continue
    if (needsHoist(entry, finalNested, finalAll)) stillWrong.push(entry.node.id)
  }

  return { root, hoisted, blockedByTransform: [...blocked], stillWrong }
}
