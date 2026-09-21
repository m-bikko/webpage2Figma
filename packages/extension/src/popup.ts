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
