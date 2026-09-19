import type { DiagnosticCode } from './codes.js'
import type { Bundle, Fill, IrNode, Screen } from './types.js'

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

/** `Asset.id` и `Screen.id` — тоже пространства идентификаторов бандла,
 *  но независимые от id узлов: их дублирование ловит не `checkNodeIds`.
 *  Дубль `Asset.id` молча подменяет картинку другой с тем же id при поиске
 *  по Map; дубль `Screen.id` делает `screenId` в диагностике неоднозначным
 *  ровно так же, как дубль id узла делает неоднозначным `nodeId`. */
const checkIdUniqueness = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []

  const seenAssets = new Set<string>()
  for (const [index, asset] of bundle.assets.entries()) {
    if (seenAssets.has(asset.id)) {
      errors.push({
        code: 'asset-id.duplicate',
        path: `assets[${index}].id`,
        message:
          `Повторяющийся id ассета "${asset.id}". Поиск по этому id вернёт ` +
          `произвольный из дублей — картинка молча подменяется другой.`,
      })
    }
    seenAssets.add(asset.id)
  }

  const seenScreens = new Set<string>()
  for (const [index, screen] of bundle.screens.entries()) {
    if (seenScreens.has(screen.id)) {
      errors.push({
        code: 'screen-id.duplicate',
        path: `screens[${index}].id`,
        message:
          `Повторяющийся id экрана "${screen.id}". Диагностика ссылается на экран ` +
          `по этому id — дубль делает ссылку неоднозначной.`,
      })
    }
    seenScreens.add(screen.id)
  }

  return errors
}

const fontKey = (family: string, weight: number, style: string): string =>
  `${family}|${weight}|${style}`

const fillAssetRefs = (fill: Fill): string[] => (fill.kind === 'image' ? [fill.ref.assetId] : [])

const collectAssetRefs = (node: IrNode): string[] => {
  const refs: string[] = []
  if (node.kind === 'image') refs.push(node.image.assetId)
  for (const fill of node.style.fills) refs.push(...fillAssetRefs(fill))
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
  /** Экран, которому ФАКТИЧЕСКИ принадлежит узел — для проверки
   *  `diagnostic.screen-mismatch` ниже. */
  const nodeScreenId = new Map<string, string>()

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
      nodeScreenId.set(node.id, screen.id)

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
    /** Оба поля заполнены — узел обязан принадлежать именно этому экрану.
     *  Дырявый узел (несуществующий) уже поймала проверка выше, поэтому
     *  здесь mismatch проверяется только когда узел реально найден. */
    if (
      diagnostic.nodeId !== null &&
      diagnostic.screenId !== null &&
      nodeScreenId.get(diagnostic.nodeId) !== undefined &&
      nodeScreenId.get(diagnostic.nodeId) !== diagnostic.screenId
    ) {
      errors.push({
        code: 'diagnostic.screen-mismatch',
        path: `report[${index}].screenId`,
        message:
          `Диагностика указывает узел "${diagnostic.nodeId}" (экран ` +
          `"${nodeScreenId.get(diagnostic.nodeId)}") и screenId "${diagnostic.screenId}" ` +
          `— это разные экраны. UI отчёта в плагине сгруппирует диагностику ` +
          `под неверным экраном.`,
      })
    }
  }

  return errors
}

/** Токены (`variables`/`textStyles`/`paintStyles`) не принадлежат ни
 *  одному экрану — палитра стилей существует independent от дерева узлов.
 *  Поэтому обход токенов — отдельная функция, а не расширение обхода узлов
 *  внутри `checkReferences`: там для висячей ссылки естественно есть
 *  `screenId`, а здесь взять его неоткуда, и `InvariantError.path`
 *  остаётся описательной строкой без screen/node id, как уже делает
 *  `font.uncovered` в `checkReferences` (путь там — просто `'fonts'`). */
const checkTokenReferences = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []
  const assetIds = new Set(bundle.assets.map((asset) => asset.id))
  const declaredFonts = new Set(
    bundle.fonts.map((font) => fontKey(font.family, font.weight, font.style)),
  )

  for (const [index, paintStyle] of bundle.tokens.paintStyles.entries()) {
    for (const assetId of fillAssetRefs(paintStyle.fill)) {
      if (!assetIds.has(assetId)) {
        errors.push({
          code: 'asset.dangling',
          path: `tokens.paintStyles[${index}].{${paintStyle.name}}`,
          message:
            `assetId "${assetId}" не найден в assets. Стиль заливки "${paintStyle.name}" ` +
            `ссылается на ассет, которого нет в bundle.assets.`,
        })
      }
    }
  }

  for (const [index, textStyle] of bundle.tokens.textStyles.entries()) {
    const key = fontKey(
      textStyle.run.usedFamily, textStyle.run.fontWeight, textStyle.run.fontStyle,
    )
    if (!declaredFonts.has(key)) {
      errors.push({
        code: 'font.uncovered',
        path: `tokens.textStyles[${index}].{${textStyle.name}}`,
        message:
          `Шрифт "${key}" использован в textStyle "${textStyle.name}", но отсутствует ` +
          `в fonts. Плагин не сможет его предзагрузить.`,
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

/** Связь заглушки и диагностики проверяется ТОЧНОЙ парой — `nodeId` узла И
 *  `code` заглушки, а не «этот код где-то встречается в отчёте». Слабая
 *  версия приняла бы бандл, где диагностика одной заглушки прикрывает
 *  отсутствие диагностики у другой: два `kind: 'placeholder'` узла,
 *  одна запись в report с совпадающим `code` — и оба считались бы
 *  объяснёнными.
 *
 *  Симметрично для `needsPlaceholder` (см. `types.ts`): это ТОЛЬКО замена,
 *  поэтому диагностика с этим флагом обязана указывать именно на узел
 *  `kind: 'placeholder'`, а не на обычный узел с содержимым — иначе
 *  неподдерживаемая фича молча приезжает пустой коробкой, что и есть
 *  запрещённый правилом проекта силентный fallback. */
const checkPlaceholders = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []
  const nodeById = new Map<string, IrNode>()

  for (const [screenIndex, screen] of bundle.screens.entries()) {
    for (const node of allNodes(screen)) {
      nodeById.set(node.id, node)

      if (node.kind === 'placeholder') {
        const explained = bundle.report.some(
          (diagnostic) => diagnostic.nodeId === node.id && diagnostic.code === node.placeholder.code,
        )
        if (!explained) {
          errors.push({
            code: 'placeholder.unexplained',
            path: `screens[${screenIndex}].{${node.id}}.placeholder`,
            message:
              `Заглушка с кодом "${node.placeholder.code}" не объяснена диагностикой: ` +
              `в report нет записи с этим nodeId и этим code. Пользователь видит ` +
              `коробку без причины.`,
          })
        }
      }
    }
  }

  for (const [index, diagnostic] of bundle.report.entries()) {
    if (!diagnostic.needsPlaceholder) continue

    if (diagnostic.nodeId === null) {
      errors.push({
        code: 'placeholder.no-host',
        path: `report[${index}].nodeId`,
        message:
          `needsPlaceholder: true без nodeId невыполнимо по построению: заглушку ` +
          `нечем нарисовать — нет узла, который стал бы ею.`,
      })
      continue
    }

    const node = nodeById.get(diagnostic.nodeId)
    if (node !== undefined && node.kind !== 'placeholder') {
      errors.push({
        code: 'placeholder.wrong-host',
        path: `report[${index}].nodeId`,
        message:
          `needsPlaceholder: true указывает на узел "${diagnostic.nodeId}" с kind ` +
          `"${node.kind}", а не "placeholder". Это ровно запрещённый молчаливый ` +
          `fallback: неподдерживаемая фича приезжает обычной пустой коробкой.`,
      })
    }
  }

  return errors
}

/** ОГРАНИЧЕНО ПЛАНОМ 1. `transform`, `blend`, `blur` и `kind: 'vector'`
 *  признаны в контракте IR, но их построение в плагине Figma откладывается
 *  до плана 2 (см. коды `deferred.*` в `codes.ts`). До тех пор любой узел,
 *  несущий одну из этих фич, ОБЯЗАН сопровождаться парной диагностикой —
 *  иначе фича молча теряется, что и обнаружил ревьюер на повёрнутом блоке
 *  с пустым report.
 *
 *  Этот блок — временный костыль ровно под этот пробел и должен удаляться
 *  ПОФИЧНО по мере того, как план 2 реализует построение. Без удаления он
 *  окаменеет: в момент, когда `transform` начнёт реально строиться в Figma,
 *  корректный бандл без диагностики (потому что больше нечего откладывать)
 *  начнёт отвергаться этой же проверкой. Каждую строку `deferred.push(...)`
 *  убирать вместе с фичей, а не всю функцию сразу. */
const checkDeferredDiagnosed = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []

  for (const [screenIndex, screen] of bundle.screens.entries()) {
    for (const node of allNodes(screen)) {
      const deferred: { code: DiagnosticCode; feature: string }[] = []
      if (node.transform !== null) {
        deferred.push({ code: 'deferred.transform', feature: 'transform' })
      }
      if (node.style.blend !== 'normal') {
        deferred.push({ code: 'deferred.blend', feature: 'blend' })
      }
      if (node.style.blur !== null) {
        deferred.push({ code: 'deferred.blur', feature: 'blur' })
      }
      if (node.kind === 'vector') {
        deferred.push({ code: 'deferred.vector', feature: 'vector' })
      }

      for (const { code, feature } of deferred) {
        const explained = bundle.report.some(
          (diagnostic) => diagnostic.nodeId === node.id && diagnostic.code === code,
        )
        if (!explained) {
          errors.push({
            code: 'deferred.undiagnosed',
            path: `screens[${screenIndex}].{${node.id}}.${feature}`,
            message:
              `Узел несёт отложенную фичу "${feature}", ожидалась диагностика ` +
              `"${code}" с этим nodeId, но её нет в report. Фича молча теряется ` +
              `при построении.`,
          })
        }
      }
    }
  }

  return errors
}

export const checkInvariants = (bundle: Bundle): InvariantError[] => [
  ...bundle.screens.flatMap((screen, index) => checkPaintOrder(screen, index)),
  ...checkNodeIds(bundle),
  ...checkIdUniqueness(bundle),
  ...checkReferences(bundle),
  ...checkTokenReferences(bundle),
  ...checkTextCoherence(bundle),
  ...checkPlaceholders(bundle),
  ...checkDeferredDiagnosed(bundle),
]
