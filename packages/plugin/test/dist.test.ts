import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Вывод компилятора обязан пережить сборку IIFE.
 *
 *  `tsup` и `tsc -b` пишут в одну папку, и `clean: true` у первого
 *  стирал вывод второго. Обнаружилось, когда диагностический скрипт не
 *  смог импортировать собранный пакет. Та же ловушка уже случалась с
 *  `@w2f/bundle`, то есть это не случайность, а свойство совмещения
 *  двух сборщиков в одной папке.
 *
 *  Проверка простая и потому надёжная: файлы, которые выпускает
 *  компилятор и на которые ссылаются другие пакеты, существуют. */
const here = dirname(fileURLToPath(import.meta.url))

describe('вывод компилятора в dist', () => {
  it('переживает сборку IIFE', () => {
    for (const file of ['index.js', 'index.d.ts', 'layout/verdict.js']) {
      expect(
        existsSync(resolve(here, '../dist', file)),
        `нет ${file}: вероятно, tsup стёр вывод tsc`,
      ).toBe(true)
    }
  })
})
