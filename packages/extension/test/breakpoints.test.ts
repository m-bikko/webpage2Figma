import { describe, expect, it } from 'vitest'
import { BREAKPOINTS, keyOf, selectedBreakpoints } from '../src/breakpoints.js'

describe('выбор брейкпоинтов', () => {
  it('без настройки снимаются все пять', () => {
    expect(selectedBreakpoints(undefined)).toHaveLength(5)
  })

  /** Пустой выбор — это «ещё не настраивал», а не «не снимать
   *  ничего». Пустой экран в ответ на кнопку выглядел бы поломкой. */
  it('пустой выбор — тоже все пять', () => {
    expect(selectedBreakpoints([])).toHaveLength(5)
  })

  it('снимаются ровно выбранные', () => {
    const chosen = selectedBreakpoints(['1440', '390'])
    expect(chosen.map((size) => size.width)).toEqual([1440, 390])
  })

  /** Порядок задан от широкого к узкому и НЕ зависит от того, в каком
   *  порядке пользователь отмечал галочки: иначе экраны легли бы на
   *  холсте вперемешку. */
  it('порядок не зависит от порядка выбора', () => {
    expect(selectedBreakpoints(['390', '1920']).map((size) => size.width))
      .toEqual([1920, 390])
  })

  /** Сохранённый мусор от старой редакции не должен приводить к
   *  пустому захвату. */
  it('неизвестные ключи не оставляют пользователя ни с чем', () => {
    expect(selectedBreakpoints(['нет-такого'])).toHaveLength(5)
  })

  it('ключ — это ширина', () => {
    expect(BREAKPOINTS.map(keyOf)).toEqual(['1920', '1440', '1024', '768', '390'])
  })
})
