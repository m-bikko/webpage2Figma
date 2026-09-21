import type { VectorSource } from '@w2f/ir'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Свойства представления, которые в SVG задаются и атрибутом, и CSS.
 *
 *  Вписываются атрибутами, потому что захваченный SVG уезжает из
 *  страницы: там на него уже не подействует ни таблица стилей, ни
 *  наследование. Самое важное — `fill`: иконки сплошь и рядом написаны
 *  как `fill="currentColor"`, а цвет берут из CSS `color`. Без
 *  вписывания такая иконка приедет чёрной или вовсе невидимой. */
const PRESENTATION = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'clip-rule',
] as const

/** У остановки градиента свои свойства, и только они. */
const STOP_PRESENTATION = ['stop-color', 'stop-opacity', 'opacity'] as const

/** Элементы, которые НИЧЕГО не рисуют сами: хранилища и определения.
 *
 *  Вписывать в них вычисленные заливки бессмысленно и вредно. Первая
 *  редакция писала весь набор в каждый элемент подряд, включая `<defs>`
 *  и `<linearGradient>`, и раздувала иконку из двух строк в двадцать —
 *  на странице со 150 иконками это сотни килобайт бандла и нечитаемое
 *  дерево в Figma. Их дети свои атрибуты получают сами. */
const NON_PAINTING = new Set([
  'defs', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'filter',
  'title', 'desc', 'metadata', 'style', 'script', 'symbol', 'marker',
  'pattern', 'switch', 'animate', 'animatetransform', 'animatemotion', 'set',
])

/** Вычисленная длина приходит с единицей: `stroke-width: 2px`. В
 *  атрибуте SVG единица допустима по CSS-грамматике, но импортёры
 *  разбирают атрибут как число, и `2px` у них превращается в ноль —
 *  обводка исчезает молча. Поэтому чистые пиксели снимаются. */
const stripPx = (value: string): string =>
  /^-?[\d.]+px$/.test(value) ? value.slice(0, -2) : value

/** `getComputedStyle().fill` отдаёт ссылку в CSS-форме, с кавычками:
 *  `url("#g")`. Атрибутная грамматика SVG кавычек не знает. */
const unquoteIri = (value: string): string =>
  value.replace(/url\(\s*["']([^"']*)["']\s*\)/g, 'url($1)')

/** Атрибуты, значение которых может ссылаться на идентификатор внутри
 *  того же документа — либо целиком (`href="#a"`), либо через
 *  `url(#a)`. Переименование идентификаторов обязано пройти и по ним,
 *  иначе ссылка осиротеет и градиент пропадёт. */
const REFERENCING = [
  'href', 'xlink:href', 'fill', 'stroke', 'clip-path', 'mask', 'filter',
  'marker-start', 'marker-mid', 'marker-end',
] as const

/** Ссылка `<use>` наружу: `href="#icon-search"`. */
const useTarget = (el: Element): string | null => {
  const raw = el.getAttribute('href') ?? el.getAttribute('xlink:href')
  return raw !== null && raw.startsWith('#') ? raw.slice(1) : null
}

/** `<use>` разрешается ДО переименования: ссылки ещё указывают на
 *  идентификаторы исходного документа. Копии кладутся в `<defs>`
 *  внутри захваченного SVG, и он становится самодостаточным.
 *
 *  Глубина ограничена, а взятое запоминается: ссылки в разметке умеют
 *  указывать друг на друга по кругу, и необорванный обход повесил бы
 *  захват страницы целиком. */
const resolveUses = (clone: SVGElement, source: Element): void => {
  const doc = source.ownerDocument
  const defs = clone.ownerDocument.createElementNS(SVG_NS, 'defs')
  const brought = new Set<string>()
  let pending: Element[] = Array.from(clone.querySelectorAll('use'))
  for (let depth = 0; depth < 4 && pending.length > 0; depth += 1) {
    const next: Element[] = []
    for (const use of pending) {
      const id = useTarget(use)
      if (id === null || brought.has(id)) continue
      /** Цель может уже лежать внутри самого SVG — тогда копировать
       *  нечего, она приехала вместе с клоном. */
      if (clone.querySelector(`#${CSS.escape(id)}`) !== null) {
        brought.add(id)
        continue
      }
      const referenced = doc.getElementById(id)
      if (referenced === null) continue
      brought.add(id)
      const copy = referenced.cloneNode(true) as Element
      defs.appendChild(copy)
      next.push(...Array.from(copy.querySelectorAll('use')))
    }
    pending = next
  }
  if (defs.childNodes.length > 0) clone.insertBefore(defs, clone.firstChild)
}

/** Разводит идентификаторы по своему пространству имён.
 *
 *  Захваченные SVG встраиваются в ОДИН документ — и рендерером, и
 *  Figma. Идентификаторы в документе глобальны, а `id="a"` у градиента
 *  встречается в иконках постоянно. Без разведения вторая иконка
 *  молча покрасится градиентом первой: ошибка, которую не видно в
 *  отчёте и легко принять за «так и было задумано».
 *
 *  `prefix` — идентификатор узла: он уникален в пределах экрана. */
const namespaceIds = (clone: SVGElement, prefix: string): void => {
  const renamed = new Map<string, string>()
  const all = [clone, ...Array.from(clone.querySelectorAll('*'))]
  for (const el of all) {
    const id = el.getAttribute('id')
    if (id === null || id === '') continue
    const fresh = `${prefix}-${id}`
    renamed.set(id, fresh)
    el.setAttribute('id', fresh)
  }
  if (renamed.size === 0) return
  for (const el of all) {
    for (const attribute of REFERENCING) {
      const value = el.getAttribute(attribute)
      if (value === null || !value.includes('#')) continue
      /** Подстановка идёт ПО КАРТЕ переименованных, а не регулярным
       *  выражением по любому `#...`: ссылка наружу документа
       *  (`href="#не-наш"`) обязана остаться как есть, чтобы её
       *  сиротство было видно, а не замаскировано. */
      let next = value
      for (const [from, to] of renamed) {
        next = next
          .split(`url(#${from})`).join(`url(#${to})`)
          .split(`url("#${from}")`).join(`url("#${to}")`)
        if (next === `#${from}`) next = `#${to}`
      }
      if (next !== value) el.setAttribute(attribute, next)
    }
  }
}

/** Итог захвата. Кроме самого SVG несёт список идентификаторов, по
 *  которым страница разрешала ссылки НЕ в наш элемент: см.
 *  `collidingIds` ниже. */
export type VectorCapture = {
  source: VectorSource
  collidingIds: string[]
}

/** Собирает самодостаточный SVG из элемента на странице.
 *
 *  `size` — НЕтрансформированный размер узла, тот же, что поедет в
 *  `rect`. Измерять внутри нельзя: `getBoundingClientRect()` включает
 *  трансформы предков, и иконка внутри `scale(2)` уехала бы вдвое
 *  крупнее собственного бокса.
 *
 *  `null` означает, что собрать не удалось; вызывающий обязан сказать
 *  об этом, а не подставить пустой SVG. */
export const readVector = (
  el: Element,
  size: { w: number; h: number },
  prefix: string,
): VectorCapture | null => {
  if (el.namespaceURI !== SVG_NS || el.tagName.toLowerCase() !== 'svg') return null

  const clone = el.cloneNode(true) as SVGElement
  const originals = [el, ...Array.from(el.querySelectorAll('*'))]
  const clones = [clone, ...Array.from(clone.querySelectorAll('*'))]
  /** Расхождение длин означало бы, что клон не повторяет оригинал, и
   *  стили легли бы не на те элементы. Молча красить наугад хуже, чем
   *  отказаться: отказ вызывающий превратит в диагностику. */
  if (originals.length !== clones.length) return null

  /** Идентификаторы, которые страница разрешала НЕ в наш элемент.
   *
   *  `getElementById` отдаёт ПЕРВЫЙ в порядке документа. Если он не мы,
   *  значит на странице любая ссылка `url(#id)` — включая нашу
   *  собственную — вела к чужому элементу, и браузер рисовал не то, что
   *  написано в этой разметке. Захват делает SVG самодостаточным и
   *  потому рисует написанное: расхождение с увиденным реально, и о нём
   *  обязан быть отчёт, иначе разница выглядит как наша ошибка.
   *
   *  Найдено фикстурой: два `id="g"` на одной странице — браузер красил
   *  обе иконки первым градиентом, захват развёл их по своим, и гейт
   *  показал 2354 расходящихся пикселя. */
  const collisions: string[] = []
  for (const source of originals) {
    const own = source.getAttribute('id')
    if (own === null || own === '') continue
    if (source.ownerDocument.getElementById(own) !== source) collisions.push(own)
  }

  /** Обход парами: у клона нет вычисленных стилей — он не в
   *  документе, — поэтому они берутся у оригинала и пишутся в клон. */
  for (let i = 0; i < originals.length; i += 1) {
    const source = originals[i]
    const target = clones[i]
    if (source === undefined || target === undefined) continue
    const tag = source.tagName.toLowerCase()
    const computed = window.getComputedStyle(source)
    const properties = tag === 'stop'
      ? STOP_PRESENTATION
      : NON_PAINTING.has(tag) ? [] : PRESENTATION
    for (const property of properties) {
      const value = computed.getPropertyValue(property)
      if (value === '') continue
      target.setAttribute(property, unquoteIri(stripPx(value)))
    }
    /** Инлайновый `style` снимается: атрибуты уже несут итог, а
     *  оставленный `style` мог бы его перебить в другую сторону. */
    target.removeAttribute('style')
    target.removeAttribute('class')
  }

  resolveUses(clone, el)
  namespaceIds(clone, prefix)

  /** Размеры обязаны быть явными: без них SVG в отрыве от страницы
   *  растянется по контейнеру или схлопнется. `viewBox` сохраняется —
   *  он задаёт систему координат содержимого; там, где его не было,
   *  координаты и так пользовательские, и рамка совпадает с боксом. */
  clone.setAttribute('width', String(size.w))
  clone.setAttribute('height', String(size.h))
  if (!clone.hasAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`)
  }
  clone.setAttribute('xmlns', SVG_NS)

  const svg = new XMLSerializer().serializeToString(clone)
  return svg.length > 0 ? { source: { svg }, collidingIds: collisions } : null
}
