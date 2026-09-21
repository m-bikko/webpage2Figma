import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Проверка СРЕДЫ выполнения, а не логики.
 *
 *  Песочница плагина Figma — это движок без `require`, без `module`,
 *  без Node-глобалей. Бандл, собранный под платформу Node, падает там
 *  на первой строке, и увидеть это можно только запустив.
 *
 *  Так и вышло: `fflate` в ESM-сборке начинается с `require("module")`
 *  ради воркеров, tsup по умолчанию собирает под Node, и плагин
 *  сломался у пользователя в Figma с «Dynamic require of "module" is
 *  not supported». Ни типы, ни сборка, ни круговой обход этого не
 *  видели — они проверяют, ЧТО код делает, а не ГДЕ он может
 *  выполниться.
 *
 *  Проверка честная, а не имитация Figma: здесь не подменяется её API
 *  и не проверяется семантика. Проверяется ровно одно свойство,
 *  которое у Figma настоящее и у нас воспроизводимо, — что модуль
 *  вычисляется в контексте БЕЗ `require`. */

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '../dist/code.global.js')

describe('собранный плагин выполняется в песочнице без require', () => {
  it('бандл собран', () => {
    if (!existsSync(bundlePath)) {
      execFileSync('pnpm', ['--filter', '@h2d/plugin', 'build'], {
        cwd: resolve(here, '../../..'), stdio: 'ignore',
      })
    }
    expect(existsSync(bundlePath)).toBe(true)
  })

  it('вычисляется без require, module и Node-глобалей', () => {
    const code = readFileSync(bundlePath, 'utf8')

    /** Минимальные заглушки — ровно те, к которым бандл обращается на
     *  верхнем уровне. Это НЕ модель Figma: они ничего не возвращают и
     *  ничего не проверяют, а существуют потому, что без них падение
     *  было бы про отсутствие `figma`, а не про окружение. */
    const calls: string[] = []
    const sandbox = {
      figma: {
        showUI: () => { calls.push('showUI') },
        ui: { onmessage: null, postMessage: () => {} },
      },
      __html__: '<!doctype html>',
      console: { log: () => {}, warn: () => {}, error: () => {} },
    }

    /** `require` и `module` в контекст НЕ кладутся намеренно: их
     *  отсутствие и есть предмет проверки. */
    const context = createContext(sandbox)
    expect(() => { runInContext(code, context, { timeout: 5000 }) }).not.toThrow()
    expect(calls).toContain('showUI')
  })

  /** Отдельно и грубо: строка `Dynamic require` в бандле означает, что
   *  esbuild вставил шим — то есть что-то втянулось под платформу Node.
   *  Проверка дублирует предыдущую, но называет причину сразу, а не
   *  через стек внутри песочницы. */
  it('в бандле нет шима динамического require', () => {
    expect(readFileSync(bundlePath, 'utf8')).not.toContain('Dynamic require of')
  })
})
