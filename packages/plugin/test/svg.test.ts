import { describe, expect, it } from 'vitest'
import { resizeSvg } from '../src/build/svg.js'

/** Размер векторного ассета подставляется в корневой тег.
 *
 *  Проверяется здесь, а не только круговым обходом, потому что
 *  ошибиться легко в обе стороны: не подставить — иконка приедет
 *  своего исходного размера; подставить не туда — `viewBox` потеряется
 *  и рисунок обрежется вместо масштабирования. Пиксели поймают только
 *  первое и только там, где размеры различаются. */

describe('resizeSvg', () => {
  it('заменяет существующие размеры', () => {
    const out = resizeSvg('<svg width="48" height="48" viewBox="0 0 24 24"/>', 70, 90)
    expect(out).toContain('width="70"')
    expect(out).toContain('height="90"')
    expect(out).not.toContain('width="48"')
  })

  it('добавляет размеры, когда их не было', () => {
    const out = resizeSvg('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>', 10, 20)
    expect(out).toContain('width="10"')
    expect(out).toContain('height="20"')
  })

  /** `viewBox` — то, благодаря чему замена масштабирует, а не
   *  обрезает. Потерять его значило бы превратить одно в другое, и
   *  выглядело бы это правдоподобно. */
  it('не трогает viewBox и содержимое', () => {
    const out = resizeSvg(
      '<svg width="1" height="1" viewBox="0 0 24 24"><circle r="5"/></svg>', 48, 48,
    )
    expect(out).toContain('viewBox="0 0 24 24"')
    expect(out).toContain('<circle r="5"/>')
  })

  it('переживает объявление xml и комментарий перед корнем', () => {
    const out = resizeSvg(
      '<?xml version="1.0"?><!-- иконка --><svg width="9"><path/></svg>', 30, 30,
    )
    expect(out).toContain('width="30"')
    expect(out.startsWith('<?xml')).toBe(true)
  })

  /** Правится ТОЛЬКО корневой тег: вложенный `<svg>` — законная
   *  конструкция со своей системой координат, и менять ему размеры
   *  значило бы ломать рисунок. */
  it('не трогает вложенный svg', () => {
    const out = resizeSvg(
      '<svg width="1" height="1"><svg width="5" height="5"><path/></svg></svg>',
      40, 40,
    )
    expect(out).toContain('width="40"')
    expect(out).toContain('<svg width="5" height="5">')
  })

  it('строку без корневого тега возвращает как есть', () => {
    expect(resizeSvg('не svg вовсе', 10, 10)).toBe('не svg вовсе')
  })
})
