import type { Bundle, IrNode, Screen } from './types.js'

export type InvariantError = { code: string; path: string; message: string }

const flatten = (node: IrNode, out: IrNode[]): void => {
  out.push(node)
  for (const child of node.children) flatten(child, out)
}

export const allNodes = (screen: Screen): IrNode[] => {
  const out: IrNode[] = []
  flatten(screen.root, out)
  return out
}

/** `paintOrder` обязан быть плотной перестановкой 0..n-1 по каждому экрану.
 *  Плотность нужна не сама по себе: по ней плагин обнаруживает случай,
 *  который дерево Figma выразить не может — когда потомок красится поверх
 *  соседа родителя, `paintOrder` узла попадает внутрь диапазона чужого
 *  поддерева. Инвариант, живущий только в комментарии резолвера, продюсер
 *  может нарушить, и тогда сортировка в плагине станет недетерминированной
 *  между запусками. */
const checkPaintOrder = (screen: Screen, index: number): InvariantError[] => {
  const errors: InvariantError[] = []
  const nodes = allNodes(screen)
  const seen = new Set<number>()

  for (const node of nodes) {
    if (seen.has(node.paintOrder)) {
      errors.push({
        code: 'paint-order.duplicate',
        path: `screens[${index}].{${node.id}}.paintOrder`,
        message:
          `Повторяющийся paintOrder ${node.paintOrder}. Порядок отрисовки должен ` +
          `быть полным: при совпадении сортировка в плагине недетерминирована.`,
      })
    }
    seen.add(node.paintOrder)
  }

  for (let expected = 0; expected < nodes.length; expected += 1) {
    if (!seen.has(expected)) {
      errors.push({
        code: 'paint-order.not-dense',
        path: `screens[${index}].paintOrder`,
        message:
          `В порядке отрисовки дырка: нет значения ${expected} при ${nodes.length} узлах. ` +
          `Ожидается плотная перестановка 0..${nodes.length - 1}.`,
      })
      break
    }
  }

  return errors
}

/** Id узлов уникальны в пределах БАНДЛА, а не экрана: диагностика ссылается
 *  на узел, и `n42` в пяти экранах сделал бы ссылку неоднозначной. */
const checkNodeIds = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []
  const seen = new Set<string>()
  for (const [index, screen] of bundle.screens.entries()) {
    for (const node of allNodes(screen)) {
      if (seen.has(node.id)) {
        errors.push({
          code: 'node-id.duplicate',
          path: `screens[${index}].{${node.id}}.id`,
          message:
            `Повторяющийся id узла "${node.id}". Id уникальны в пределах бандла: ` +
            `на них ссылается отчёт.`,
        })
      }
      seen.add(node.id)
    }
  }
  return errors
}

const collectAssetRefs = (node: IrNode): string[] => {
  const refs: string[] = []
  if (node.kind === 'image') refs.push(node.image.assetId)
  for (const fill of node.style.fills) {
    if (fill.kind === 'image') refs.push(fill.ref.assetId)
  }
  return refs
}

/** Висячая ссылка — это молчаливый fallback. При неудачной загрузке картинки
 *  в extension `assetId` повисает, `figma.createImage` не вызывается, узел
 *  приезжает пустым прямоугольником, диагностики нет, бандл «валиден». */
const checkReferences = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []
  const assetIds = new Set(bundle.assets.map((asset) => asset.id))
  const screenIds = new Set(bundle.screens.map((screen) => screen.id))
  const nodeIds = new Set<string>()
  const usedFonts = new Set<string>()

  const fontKey = (family: string, weight: number, style: string): string =>
    `${family}|${weight}|${style}`

  for (const [index, screen] of bundle.screens.entries()) {
    if (screen.screenshotId !== null && !assetIds.has(screen.screenshotId)) {
      errors.push({
        code: 'screenshot.dangling',
        path: `screens[${index}].screenshotId`,
        message:
          `screenshotId "${screen.screenshotId}" не найден в assets. Скриншоты ` +
          `регистрируются как ассеты — иначе ссылку нечем проверить.`,
      })
    }

    for (const node of allNodes(screen)) {
      nodeIds.add(node.id)

      for (const assetId of collectAssetRefs(node)) {
        if (!assetIds.has(assetId)) {
          errors.push({
            code: 'asset.dangling',
            path: `screens[${index}].{${node.id}}`,
            message:
              `assetId "${assetId}" не найден в assets. В Figma это дало бы пустой ` +
              `прямоугольник без диагностики.`,
          })
        }
      }

      if (node.kind === 'text') {
        for (const run of node.text.runs) {
          usedFonts.add(fontKey(run.usedFamily, run.fontWeight, run.fontStyle))
        }
      }
    }
  }

  const declaredFonts = new Set(
    bundle.fonts.map((font) => fontKey(font.family, font.weight, font.style)),
  )
  for (const used of usedFonts) {
    if (!declaredFonts.has(used)) {
      errors.push({
        code: 'font.uncovered',
        path: 'fonts',
        message:
          `Шрифт "${used}" использован в тексте, но отсутствует в fonts. Плагин не ` +
          `сможет его предзагрузить, и создание текста упадёт.`,
      })
    }
  }

  for (const [index, diagnostic] of bundle.report.entries()) {
    if (diagnostic.nodeId !== null && !nodeIds.has(diagnostic.nodeId)) {
      errors.push({
        code: 'diagnostic.dangling-node',
        path: `report[${index}].nodeId`,
        message: `Диагностика ссылается на несуществующий узел "${diagnostic.nodeId}".`,
      })
    }
    if (diagnostic.screenId !== null && !screenIds.has(diagnostic.screenId)) {
      errors.push({
        code: 'diagnostic.dangling-screen',
        path: `report[${index}].screenId`,
        message: `Диагностика ссылается на несуществующий экран "${diagnostic.screenId}".`,
      })
    }
  }

  return errors
}

/** Конкатенация `runs[].text` обязана равняться конкатенации `lines[].text`.
 *  Первая редакция контракта это нарушала: `run.text` был `el.textContent`
 *  (весь подграф), а `lines` — только прямые текстовые узлы, из-за чего
 *  плагин рисовал вложенный `<b>` дважды с наложением. */
const checkTextCoherence = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []
  const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim()

  for (const [index, screen] of bundle.screens.entries()) {
    for (const node of allNodes(screen)) {
      if (node.kind !== 'text') continue
      const fromRuns = normalize(node.text.runs.map((run) => run.text).join(''))
      const fromLines = normalize(node.text.lines.map((line) => line.text).join(''))
      if (fromRuns !== fromLines) {
        errors.push({
          code: 'text.concat-mismatch',
          path: `screens[${index}].{${node.id}}.text`,
          message:
            `Конкатенация ранов ("${fromRuns}") не равна конкатенации строк ` +
            `("${fromLines}"). Потребители читают разные половины: рендерер строки, ` +
            `плагин раны — расхождение даёт дублирующийся текст в Figma.`,
        })
      }
    }
  }
  return errors
}

export const checkInvariants = (bundle: Bundle): InvariantError[] => [
  ...bundle.screens.flatMap((screen, index) => checkPaintOrder(screen, index)),
  ...checkNodeIds(bundle),
  ...checkReferences(bundle),
  ...checkTextCoherence(bundle),
]
