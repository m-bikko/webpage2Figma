/** Окно расширения. Логики здесь нет: кнопка, прогресс, сводка.
 *
 *  Вся работа идёт в воркере — он переживает закрытие этого окна, а
 *  съёмка пяти размеров занимает секунды. Делать её здесь значило бы
 *  терять захват от случайного клика мимо. */

type Progress =
  | { kind: 'progress'; done: number; total: number; label: string }
  | { kind: 'done'; file: string; text: string
      report: { level: string; code: string; message: string }[] }
  | { kind: 'error'; text: string }

const out = document.getElementById('out')
const button = document.getElementById('go')
const sizesBox = document.getElementById('sizes')
const copyButton = document.getElementById('copy')

/** Предел, за которым буфер перестаёт предлагаться как короткий путь.
 *
 *  Ограничивает не Chrome: он кладёт в буфер и больше. Ограничивает та
 *  сторона — окно плагина Figma, где строка проходит через вставку в
 *  поле, границу плагина и разбор base64.
 *
 *  Где именно у Figma край, НЕ ИЗМЕРЕНО, и число это не изображает
 *  измеренное. Оно выведено из измеренного веса захватов.
 *
 *  Замерено на живых страницах, пять размеров: figma.com — 4,97 МБ
 *  архива, то есть 6,6 МБ base64; news.ycombinator.com — 2,5 МБ
 *  base64; tailwindcss.com — 18,4 МБ. Один размер: от 19 КБ
 *  (example.com) до 8,3 МБ (github.com). Разброс по выборке — в 450
 *  раз, и держат его байты картинок, а не дерево узлов.
 *
 *  Предел поставлен выше типичного тяжёлого захвата и ниже тех
 *  восемнадцати мегабайт, на которых поведение окна неизвестно.
 *
 *  Отказ выдаётся ЗДЕСЬ, до ухода в Figma, и называет число: зависшее
 *  окно плагина человеку не объяснит ничего, а файл к этому моменту
 *  уже скачан и остаётся рабочим путём. */
const CLIPBOARD_LIMIT = 12 * 1024 * 1024

/** Текст последнего захвата. Живёт в памяти окна намеренно: буфер —
 *  короткий путь, а не хранилище. Закрыли окно — остаётся файл,
 *  который скачивается всегда. */
let pending: string | null = null

const BREAKPOINTS = [
  { key: '1920', label: 'Desktop XL — 1920×1080' },
  { key: '1440', label: 'Desktop — 1440×900' },
  { key: '1024', label: 'Tablet L — 1024×1366' },
  { key: '768', label: 'Tablet — 768×1024' },
  { key: '390', label: 'Mobile — 390×844' },
]

const BREAKPOINTS_KEY = 'breakpoints'

const chosenKeys = (): string[] => Array.from(
  sizesBox?.querySelectorAll<HTMLInputElement>('input:checked') ?? [],
).map((input) => input.value)

/** Выбор сохраняется сразу при клике, а не по кнопке: отдельная
 *  кнопка «сохранить» в окне из двух элементов — лишний шаг, который
 *  легко забыть, и тогда съёмка пойдёт не с теми размерами. */
const renderSizes = async (): Promise<void> => {
  if (sizesBox === null) return
  const stored = await chrome.storage.sync.get(BREAKPOINTS_KEY)
  const saved = (stored[BREAKPOINTS_KEY] as string[] | undefined) ?? []
  const active = saved.length === 0 ? BREAKPOINTS.map((size) => size.key) : saved

  for (const size of BREAKPOINTS) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = size.key
    input.checked = active.includes(size.key)
    input.addEventListener('change', () => {
      const keys = chosenKeys()
      /** Снятая последняя галочка не сохраняется: снимать нечего, и
       *  пустой экран в ответ на кнопку выглядел бы поломкой.
       *  Галочка возвращается на место, чтобы отказ был виден. */
      if (keys.length === 0) {
        input.checked = true
        return
      }
      void chrome.storage.sync.set({ [BREAKPOINTS_KEY]: keys })
    })
    label.append(input, document.createTextNode(size.label))
    sizesBox.append(label)
  }

  const hint = document.createElement('p')
  hint.className = 'hint'
  hint.textContent = 'Чем меньше размеров, тем быстрее съёмка.'
  sizesBox.append(hint)
}

void renderSizes()

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch))

const show = (html: string): void => {
  if (out !== null) out.innerHTML = html
}

chrome.runtime.onMessage.addListener((message: Progress) => {
  if (message.kind === 'progress') {
    show(`<div class="row"><b>${message.done} из ${message.total}</b>` +
         `<span>${escapeHtml(message.label)}</span></div>`)
    return
  }
  if (button instanceof HTMLButtonElement) button.disabled = false
  if (message.kind === 'error') {
    show(`<div class="row error">${escapeHtml(message.text)}</div>`)
    return
  }
  /** Пустой отчёт показывается ЯВНО, а не пустотой: пустое место
   *  неотличимо от сломанного отчёта. */
  /** Сводка по auto-layout выносится ОТДЕЛЬНО: это не изъяны, а
   *  главный вопрос «пригодно ли для работы», и тонуть в сотне
   *  записей она не должна. */
  const rejected = message.report
    .filter((entry) => entry.code === 'fidelity.auto-layout-rejected').length
  const summary = rejected === 0 ? ''
    : `<div class="row info">Auto-layout не применён к ${rejected} узлам — ` +
      'причины ниже.</div>'

  /** Сообщения о ПЕРЕНОСЕ узлов сворачиваются в одну строку.
   *
   *  Это не изъяны: перенос делается ради верного порядка отрисовки, и
   *  каждая запись лишь объясняет, почему слой лежит не там, где
   *  элемент в разметке. На живой странице их набирается под сотню, и
   *  развёрнутым списком они топят собой всё остальное — то есть
   *  мешают увидеть настоящие потери.
   *
   *  Совсем убрать их нельзя: иерархия действительно изменилась, и
   *  человек, ищущий слой не на своём месте, должен найти этому
   *  объяснение. */
  const hoisted = message.report
    .filter((entry) => entry.code === 'fidelity.paint-order-hoisted').length
  const hoistedRow = hoisted === 0 ? ''
    : `<div class="row info">${hoisted} узлов перенесено к предкам ради ` +
      'верного порядка отрисовки — в Figma порядок слоёв и есть z-порядок.' +
      '</div>'

  const rest = message.report
    .filter((entry) => entry.code !== 'fidelity.paint-order-hoisted')
  const rows = rest.length === 0
    ? '<div class="row info">Расхождений не найдено.</div>'
    : rest.map((entry) =>
        `<div class="row"><span class="lvl ${entry.level}">${entry.level}</span>` +
        `<span>${escapeHtml(entry.message)}</span></div>`).join('')
  /** Кнопка копирования включается ТОЛЬКО когда есть что копировать и
   *  оно пролезает. Включённая кнопка, которая потом отказывает, —
   *  худший из вариантов: человек уже ушёл в Figma и узнаёт об отказе
   *  там, где сделать с ним ничего нельзя. */
  pending = message.text
  if (copyButton instanceof HTMLButtonElement) {
    const size = message.text.length
    const tooBig = size > CLIPBOARD_LIMIT
    copyButton.disabled = tooBig
    copyButton.textContent = tooBig
      ? `Слишком велик для буфера (${Math.round(size / 1024 / 1024)} МБ)`
      : `Скопировать для Figma (${Math.round(size / 1024 / 1024 * 10) / 10} МБ)`
    copyButton.hidden = false
    if (tooBig) pending = null
  }

  show(`<div class="row"><b>Скачано: ${escapeHtml(message.file)}</b></div>` +
       `${summary}${hoistedRow}${rows}`)
})

/** Копирование идёт по нажатию, а не само собой после захвата.
 *
 *  Так требует браузер — запись в буфер разрешена только по действию
 *  человека, — и так правильнее по сути: захват не должен молча
 *  затирать то, что человек скопировал до него. */
copyButton?.addEventListener('click', () => {
  if (pending === null) return
  void navigator.clipboard.writeText(pending).then(
    () => {
      if (copyButton instanceof HTMLButtonElement) {
        copyButton.textContent = 'Скопировано — вставь в окне плагина'
      }
    },
    (error: unknown) => {
      /** Отказ буфера показывается ТЕКСТОМ. Молчащая кнопка
       *  неотличима от сработавшей, и человек уйдёт вставлять пустоту. */
      show('<div class="row error">Не удалось положить в буфер: ' +
           `${escapeHtml(error instanceof Error ? error.message : String(error))}. ` +
           'Файл уже скачан — открой его в плагине.</div>')
    },
  )
})

button?.addEventListener('click', () => {
  if (button instanceof HTMLButtonElement) button.disabled = true
  /** Кнопка копирования прячется на время съёмки: иначе она копирует
   *  ПРЕДЫДУЩИЙ захват, а человек уверен, что копирует этот. */
  if (copyButton instanceof HTMLButtonElement) copyButton.hidden = true
  pending = null
  show('<div class="row info">Снимаю…</div>')
  void chrome.runtime.sendMessage({ kind: 'capture' })
})
