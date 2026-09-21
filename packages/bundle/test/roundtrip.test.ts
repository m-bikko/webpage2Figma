import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { IR_VERSION } from '@h2d/ir/version'
import { packBundle, unpackBundle } from '../src/index.js'
import { bundle as makeBundle, frameNode, screen as makeScreen } from '@h2d/ir/test-fixtures'
import type { Bundle, IrNode } from '@h2d/ir'

const sample = (): Bundle => makeBundle({
  screens: [makeScreen({ root: frameNode() })],
  assets: [{ id: 'a0', mimeType: 'image/png', width: 2, height: 1, path: 'assets/a0.png' }],
})

describe('packBundle / unpackBundle', () => {
  it('распакованное равно упакованному', async () => {
    const source = sample()
    const bytes = { a0: new Uint8Array([1, 2, 3]) }
    const back = await unpackBundle(await packBundle(source, { assets: bytes }))
    expect(back.bundle).toEqual(source)
    expect(back.files.assets['a0']).toEqual(bytes.a0)
  })

  /** Чужой ZIP обязан быть отвергнут ВНЯТНО, а не упасть на разборе
   *  JSON. Пользователь мог выбрать не тот файл — это обычная ошибка,
   *  а не исключительная ситуация. */
  it('архив без ir.json отвергается с внятным сообщением', async () => {
    const foreign = zipSync({ 'readme.txt': strToU8('не наш файл') })
    await expect(unpackBundle(foreign)).rejects.toThrow(/ir\.json/)
  })

  /** Версия сверяется ДО схемы: иначе пользователь получит простыню
   *  zod вместо «файл другой версии». Ровно та причина, по которой в
   *  контракте есть BundleEnvelope. */
  it('бандл чужой версии отвергается по версии, а не по схеме', async () => {
    const foreign = zipSync({
      'ir.json': strToU8(JSON.stringify({ format: 'h2d', version: IR_VERSION + 1 })),
    })
    await expect(unpackBundle(foreign)).rejects.toThrow(/верси/i)
  })

  it('не наш формат отвергается по маркеру', async () => {
    const foreign = zipSync({ 'ir.json': strToU8(JSON.stringify({ hello: 1 })) })
    await expect(unpackBundle(foreign)).rejects.toThrow(/маркер формата/)
  })

  /** Ассет, объявленный в IR, но отсутствующий в архиве, — это пустой
   *  прямоугольник в Figma без всяких объяснений. Отвергать обязательно,
   *  и обязательно с именем: иначе непонятно, какой именно потерялся.
   *
   *  Проверяются ОБЕ стороны. Запись отказывает раньше, и это лучше:
   *  испорченный бандл не успевает появиться. Но чтение обязано
   *  отказывать тоже — архив мог прийти откуда угодно, в том числе от
   *  редакции, где записывающая проверка ещё не стояла. */
  it('при записи: объявленный без байтов ассет отвергается по имени', async () => {
    await expect(packBundle(sample(), { assets: {} })).rejects.toThrow(/a0/)
  })

  it('при чтении: архив с оборванной ссылкой на ассет отвергается по имени', async () => {
    const handmade = zipSync({
      'ir.json': strToU8(JSON.stringify(sample())),
    })
    await expect(unpackBundle(handmade)).rejects.toThrow(/a0/)
  })

  /** Обратное — не ошибка, а лишний вес: файл в архиве, на который
   *  никто не ссылается, просто игнорируется. */
  it('лишний файл в архиве не мешает', async () => {
    const source = sample()
    const packed = await packBundle(source, { assets: { a0: new Uint8Array([7]) } })
    const withExtra = zipSync({
      ...Object.fromEntries(Object.entries(await entriesOf(packed))),
      'заметка.txt': strToU8('мусор'),
    })
    const back = await unpackBundle(withExtra)
    expect(back.bundle.assets).toHaveLength(1)
  })
})

/** Разбор архива в записи — только для теста про лишний файл. */
const entriesOf = async (zip: Uint8Array): Promise<Record<string, Uint8Array>> => {
  const { unzipSync } = await import('fflate')
  return unzipSync(zip)
}

describe('скриншоты', () => {
  const withShot = (): Bundle => {
    const base = sample()
    return {
      ...base,
      screens: base.screens.map((s) => ({ ...s, screenshotId: 'shot-s0' })),
      assets: [
        ...base.assets,
        { id: 'shot-s0', mimeType: 'image/png', width: 8, height: 4,
          path: 'screenshots/s0.png' },
      ],
    }
  }

  /** Скриншот — обычный ассет с путём в `screenshots/`. Отдельного
   *  механизма он не требует: инвариант уже настаивает, чтобы
   *  `screenshotId` находился среди `assets`, а упаковка кладёт ассет
   *  по его собственному `path`. */
  it('скриншот переживает круговой обход', async () => {
    const source = withShot()
    const packed = await packBundle(source, {
      assets: { a0: new Uint8Array([1]), 'shot-s0': new Uint8Array([9, 9]) },
    })
    const back = await unpackBundle(packed)
    expect(back.bundle.screens[0]?.screenshotId).toBe('shot-s0')
    expect(back.files.assets['shot-s0']).toEqual(new Uint8Array([9, 9]))
  })

  /** Скриншот НЕ должен оказаться заливкой какого-нибудь фрейма: тогда
   *  картинка всей страницы приехала бы фоном одного узла, и выглядело
   *  бы это правдоподобно. Проверка существует ровно потому, что такая
   *  ошибка не бросается в глаза. */
  it('ни один узел не ссылается на скриншот', async () => {
    const back = await unpackBundle(await packBundle(withShot(), {
      assets: { a0: new Uint8Array([1]), 'shot-s0': new Uint8Array([9, 9]) },
    }))
    const referenced = new Set<string>()
    const visit = (node: IrNode): void => {
      if (node.kind === 'image') referenced.add(node.image.assetId)
      for (const fill of node.style.fills) {
        if (fill.kind === 'image') referenced.add(fill.ref.assetId)
      }
      node.children.forEach(visit)
    }
    for (const s of back.bundle.screens) visit(s.root)
    for (const s of back.bundle.screens) {
      if (s.screenshotId !== null) expect(referenced.has(s.screenshotId)).toBe(false)
    }
  })
})
