import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encodeBundleText, packBundle } from '@w2f/bundle'
import { bundle as makeBundle, frameNode, nodeText, screen as makeScreen } from '@w2f/ir/test-fixtures'

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
      execFileSync('pnpm', ['--filter', '@w2f/plugin', 'build'], {
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

/** Проверка ПУТИ, а не только загрузки: бандл исполняется в контексте
 *  без браузерных глобалей и через него прогоняется настоящая вставка.
 *
 *  Песочница Figma даёт только встроенные объекты ECMAScript — ни
 *  `URL`, ни `atob`, ни `TextDecoder`. Первая проверка выше ловила
 *  лишь то, что падает на верхнем уровне; всё, что обращается к
 *  браузерному API по ходу дела, проходило её и отказывало уже у
 *  человека. Так и случилось дважды: `new URL()` внутри `try` молча
 *  оставлял артборды без хоста, а `atob` внутри `try` называл любую
 *  целую строку повреждённой. Контекст здесь собран из того же
 *  `createContext` — в нём этих глобалей нет по построению, и тест
 *  проверяет это утверждением, чтобы правка Node не сделала его
 *  пустым. */
describe('вставка проходит в контексте без браузерных API', () => {
  type Node = Record<string, unknown> & { name: string; children: Node[] }
  const node = (): Node => {
    const self: Node = {
      name: '', x: 0, y: 0, width: 0, height: 0, rotation: 0, opacity: 1,
      blendMode: 'NORMAL', fills: [], strokes: [], effects: [], children: [],
      resize: (w: number, h: number) => { self['width'] = w; self['height'] = h },
      appendChild: (child: Node) => { self.children.push(child) },
      remove: () => {},
    }
    return self
  }

  it('bundle-text → done, артборд назван по хосту', async () => {
    const code = readFileSync(bundlePath, 'utf8')
    const posted: Record<string, unknown>[] = []
    const page = node()
    const sandbox = {
      figma: {
        showUI: () => {},
        ui: { onmessage: null as ((message: unknown) => Promise<void>) | null,
              postMessage: (message: Record<string, unknown>) => { posted.push(message) } },
        currentPage: page,
        createFrame: node, createRectangle: node, createText: node,
        createNodeFromSvg: node,
        createImage: () => ({ hash: 'h' }),
        loadFontAsync: async () => {},
      },
      __html__: '<!doctype html>',
      console: { log: () => {}, warn: () => {}, error: () => {} },
    }
    const context = createContext(sandbox)
    for (const global of ['URL', 'atob', 'btoa', 'TextDecoder', 'setTimeout', 'fetch']) {
      expect(runInContext(`typeof ${global}`, context), global).toBe('undefined')
    }
    runInContext(code, context, { timeout: 5000 })

    const zip = await packBundle(makeBundle({
      url: 'https://uqr.kz/ru/admin/restaurants',
      screens: [makeScreen({
        name: 'Desktop', width: 1440,
        root: frameNode({ children: [{ ...frameNode({ id: 'n1' }), kind: 'text', text: nodeText(), paintOrder: 1 }] }),
      })],
    }), { assets: {} })
    const onmessage = sandbox.figma.ui.onmessage
    if (onmessage === null) throw new Error('плагин не подписался на сообщения')
    await onmessage({ kind: 'bundle-text', text: encodeBundleText(zip) })

    const error = posted.find((message) => message['kind'] === 'error')
    expect(error, `плагин отказал: ${String(error?.['text'])}`).toBeUndefined()
    const done = posted.find((message) => message['kind'] === 'done')
    expect(done?.['screens']).toBe(1)
    expect(page.children.map((child) => child.name)).toEqual(['uqr.kz — Desktop 1440'])
  })
})
