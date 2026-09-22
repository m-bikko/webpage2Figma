/** ИМЕНА СЛОЁВ.
 *
 *  В панели Figma имя — единственное, по чему слой находят. Пока им
 *  служило имя тега, дерево выглядело сотней одинаковых строк «div»:
 *  найти в такой панели нельзя ничего, и жалоба «везде фреймы внутри
 *  фреймов» была в равной мере про имена.
 *
 *  Правила ниже расставлены по НАДЁЖНОСТИ: сначала то, что автор
 *  страницы написал для людей (`aria-label`, `alt`, `title`), потом
 *  семантика тега, потом собственный текст. Классы не используются
 *  вовсе — в нынешней вёрстке это `flex items-center gap-2`, то есть
 *  описание стиля, а не смысла. */

const SEMANTIC = new Set([
  'header', 'footer', 'nav', 'main', 'aside', 'section', 'article',
  'form', 'button', 'label', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'input', 'select',
  'textarea', 'video', 'canvas', 'iframe', 'svg', 'img',
])

/** Длина, после которой имя перестаёт помещаться в панель и начинает
 *  мешать. Обрезка с многоточием честнее молчаливого усечения. */
const MAX = 40

const clean = (value: string): string =>
  value.replace(/\s+/g, ' ').trim()

const shorten = (value: string): string =>
  value.length <= MAX ? value : `${value.slice(0, MAX - 1)}…`

/** Имя файла из URL — без пути, без строки запроса, без расширения. */
const fileNameOf = (url: string): string | null => {
  const withoutQuery = url.split(/[?#]/)[0] ?? ''
  const last = withoutQuery.split('/').filter((part) => part !== '').pop()
  if (last === undefined || last === '') return null
  const withoutExtension = last.replace(/\.[a-z0-9]+$/i, '')
  return withoutExtension === '' ? null : decodeURIComponent(withoutExtension)
}

export const nameFor = (el: Element, ownText: string): string => {
  const tag = el.tagName.toLowerCase()

  /** Написанное для людей — самое надёжное, что есть: автор страницы
   *  сам объяснил, что это. */
  for (const attribute of ['aria-label', 'alt', 'title']) {
    const value = el.getAttribute(attribute)
    if (value !== null && clean(value) !== '') {
      return shorten(clean(value))
    }
  }

  /** У картинки — имя файла: «logo» говорит больше, чем «img». */
  if (tag === 'img') {
    const source = (el as HTMLImageElement).currentSrc
      || el.getAttribute('src') || ''
    const file = fileNameOf(source)
    if (file !== null) return shorten(file)
  }

  /** Собственный текст узла — то, что видно на экране. Берётся раньше
   *  семантики тега: «Войти» полезнее, чем «button». */
  const text = clean(ownText)
  if (text !== '') return shorten(text)

  if (SEMANTIC.has(tag)) return tag

  /** Собственного текста нет, но внутри лежит КОРОТКАЯ надпись —
   *  значит узел и есть эта надпись, просто обёрнутая: `<div><span>
   *  Войти</span></div>` встречается чаще, чем текст напрямую.
   *
   *  Ограничение по длине обязательно: без него имя корня стало бы
   *  текстом всей страницы. Порог тот же, что у обрезки, — всё, что
   *  длиннее, в панели всё равно не поместится, а значит и смысла
   *  брать его нет. */
  const inner = clean(el.textContent ?? '')
  if (inner !== '' && inner.length <= MAX) return inner

  /** Ссылка без текста и подписи — обычно иконка; адрес хоть что-то
   *  говорит. */
  if (tag === 'a') {
    const href = el.getAttribute('href')
    if (href !== null && clean(href) !== '') return shorten(clean(href))
  }

  return tag
}
