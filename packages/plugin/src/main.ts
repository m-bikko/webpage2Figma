import { unpackBundle } from '@h2d/bundle'
import { buildScene } from './build/index.js'
import { applyScreen, type FigmaSurface } from './apply.js'
import type { Diagnostic } from '@h2d/ir'

/** Точка входа плагина.
 *
 *  Намеренно тонкая. Всё, что здесь происходит, не покрыто ничем:
 *  Figma не запускается ни в CI, ни у разработчика. Поэтому здесь нет
 *  ни одного вычисления — только разбор файла, перебор экранов и
 *  вызовы уже проверенных частей. Появление здесь арифметики означает,
 *  что логика ускользнула из проверяемой половины. */

declare const figma: FigmaSurface & {
  showUI: (html: string, options?: { width: number; height: number }) => void
  ui: { onmessage: ((message: unknown) => void) | null
        postMessage: (message: unknown) => void }
  currentPage: { appendChild: (node: unknown) => void }
  createPage: () => { name: string; appendChild: (node: unknown) => void }
  notify: (text: string) => void
  closePlugin: (message?: string) => void
}
declare const __html__: string

figma.showUI(__html__, { width: 420, height: 320 })

type IncomingMessage = { kind: 'bundle'; bytes: number[] }

const isBundleMessage = (message: unknown): message is IncomingMessage =>
  typeof message === 'object' && message !== null
  && (message as { kind?: unknown }).kind === 'bundle'
  && Array.isArray((message as { bytes?: unknown }).bytes)

figma.ui.onmessage = async (message: unknown): Promise<void> => {
  if (!isBundleMessage(message)) return

  let unpacked
  try {
    unpacked = await unpackBundle(new Uint8Array(message.bytes))
  } catch (error) {
    /** Отказ показывается ПОЛНЫМ текстом. Сообщения `unpackBundle`
     *  написаны так, чтобы человек понял, что делать: «выбран не тот
     *  файл», «файл другой версии». Свернуть их в «ошибка импорта»
     *  значило бы выбросить единственное, что здесь есть полезного. */
    figma.ui.postMessage({ kind: 'error', text: String(error) })
    return
  }

  const { bundle, files } = unpacked
  const scene = buildScene(bundle)

  /** Картинки загружаются ОДИН раз на бандл: один и тот же ассет может
   *  стоять на многих узлах и на всех пяти экранах, а `createImage`
   *  каждый раз клал бы в файл новую копию. */
  const images = new Map<string, string>()
  for (const asset of bundle.assets) {
    const bytes = files.assets[asset.id]
    if (bytes === undefined) continue
    images.set(asset.id, figma.createImage(bytes).hash)
  }

  const report: Diagnostic[] = [...bundle.report, ...scene.report]

  for (const screen of scene.screens) {
    const applied = await applyScreen(figma, screen, scene.fonts, images)
    report.push(...applied.report)
    figma.currentPage.appendChild(applied.root)
  }

  figma.ui.postMessage({
    kind: 'done',
    screens: scene.screens.length,
    report: report.map((entry) => ({
      level: entry.level, code: entry.code, message: entry.message,
    })),
    /** Отдельно от отчёта: это не найденные изъяны, а места, где наша
     *  модель семантики Figma остаётся догадкой и требует, чтобы
     *  человек посмотрел глазами ОДИН раз. Смешать их с диагностикой
     *  значило бы утопить в ней. */
    needsVerification: scene.needsVerification,
  })
}
