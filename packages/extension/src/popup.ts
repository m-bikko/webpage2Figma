/** Окно расширения. Логики здесь нет: кнопка, прогресс, сводка.
 *
 *  Вся работа идёт в воркере — он переживает закрытие этого окна, а
 *  съёмка пяти размеров занимает секунды. Делать её здесь значило бы
 *  терять захват от случайного клика мимо. */

type Progress =
  | { kind: 'progress'; done: number; total: number; label: string }
  | { kind: 'done'; file: string; report: { level: string; code: string; message: string }[] }
  | { kind: 'error'; text: string }

const out = document.getElementById('out')
const button = document.getElementById('go')
const sizesBox = document.getElementById('sizes')

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
  const rows = message.report.length === 0
    ? '<div class="row info">Расхождений не найдено.</div>'
    : message.report.map((entry) =>
        `<div class="row"><span class="lvl ${entry.level}">${entry.level}</span>` +
        `<span>${escapeHtml(entry.message)}</span></div>`).join('')
  show(`<div class="row"><b>Скачано: ${escapeHtml(message.file)}</b></div>${rows}`)
})

button?.addEventListener('click', () => {
  if (button instanceof HTMLButtonElement) button.disabled = true
  show('<div class="row info">Снимаю…</div>')
  void chrome.runtime.sendMessage({ kind: 'capture' })
})
