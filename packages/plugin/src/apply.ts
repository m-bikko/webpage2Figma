import type { Diagnostic } from '@h2d/ir'
import type {
  AppliedImagePaint, FontRequest, SceneBase, SceneNode, ScenePaint, SceneScreen,
} from './scene.js'

/** Применитель: механический перебор описания сцены.
 *
 *  ЛОГИКИ ЗДЕСЬ НЕТ ПО ПОСТРОЕНИЮ, и это не стиль, а способ свести
 *  непроверяемое к минимуму. Figma не запускается ни в CI, ни у
 *  разработчика; всё, что вычисляется в этом файле, не покрыто ничем.
 *  Поэтому любое вычисление, обнаруженное здесь, — кусок логики,
 *  ускользнувший из проверяемой части, и его надо вернуть в строитель.
 *
 *  Единственное, что имеет смысл проверять на двойнике `figma`, — это
 *  ПОРЯДОК вызовов: шрифты загружены до текста, дети добавлены после
 *  создания родителя. Верность построения двойник не проверяет и
 *  проверять не может. */

/** Поверхность Figma, которой пользуется применитель. Объявлена явно и
 *  узко: так видно, на что именно мы опираемся, и двойник в тесте
 *  обязан реализовать ровно это, а не «весь API». */
export type FigmaSurface = {
  createFrame: () => FigmaLikeNode
  createRectangle: () => FigmaLikeNode
  createText: () => FigmaLikeText
  createImage: (bytes: Uint8Array) => { hash: string }
  loadFontAsync: (font: { family: string; style: string }) => Promise<void>
}

export type FigmaLikeNode = {
  name: string
  x: number
  y: number
  rotation: number
  opacity: number
  blendMode: string
  fills: unknown[]
  strokes: unknown[]
  effects: unknown[]
  clipsContent?: boolean
  resize: (width: number, height: number) => void
  appendChild: (child: FigmaLikeNode) => void
  [key: string]: unknown
}

export type FigmaLikeText = FigmaLikeNode & {
  characters: string
  fontName: { family: string; style: string }
}

export type ApplyResult = {
  root: FigmaLikeNode
  report: Diagnostic[]
}

/** Загружает шрифты ДО построения текста.
 *
 *  `loadFontAsync` обязателен перед любым изменением текстового узла —
 *  это требование API, а не предосторожность. Промах отлавливается
 *  здесь и превращается в запись уровня **error**: метрики строк в IR
 *  сняты с фактического шрифта браузера, и подстановка чужого делает их
 *  ложью, а не приближением. */
export const loadFonts = async (
  figma: FigmaSurface,
  fonts: readonly FontRequest[],
  screenId: string,
): Promise<{ substitutions: Map<string, FontRequest>; report: Diagnostic[] }> => {
  const substitutions = new Map<string, FontRequest>()
  const report: Diagnostic[] = []

  for (const font of fonts) {
    const key = `${font.family}|${font.style}`
    try {
      await figma.loadFontAsync(font)
      substitutions.set(key, font)
      continue
    } catch {
      /** Дальше — лестница подстановок. Каждая ступень вниз получает
       *  свою запись: молчаливая подмена шрифта выглядит нормально и
       *  разрушает раскладку тем вернее, чем она правдоподобнее. */
    }

    const sameFamilyRegular = { family: font.family, style: 'Regular' }
    try {
      await figma.loadFontAsync(sameFamilyRegular)
      substitutions.set(key, sameFamilyRegular)
      report.push({
        level: 'error', code: 'fidelity.font-fallback',
        message:
          `Начертание "${font.style}" семейства "${font.family}" не найдено, ` +
          `взято Regular. Метрики строк сняты с другого начертания.`,
        nodeId: null, screenId, needsPlaceholder: false,
      })
      continue
    } catch { /* следующая ступень */ }

    const inter = { family: 'Inter', style: 'Regular' }
    await figma.loadFontAsync(inter)
    substitutions.set(key, inter)
    report.push({
      level: 'error', code: 'fidelity.font-fallback',
      message:
        `Семейство "${font.family}" не установлено в Figma, подставлен Inter. ` +
        `Метрики строк в бандле сняты с "${font.family}" в браузере и к Inter ` +
        `не относятся — текст почти наверняка разойдётся.`,
      nodeId: null, screenId, needsPlaceholder: false,
    })
  }

  return { substitutions, report }
}

/** Подстановка хешей вместо идентификаторов ассетов.
 *
 *  Поиск в таблице, а не вычисление: `figma.createImage` возвращает
 *  хеш, который известен только внутри Figma, поэтому описание сцены
 *  ссылается на ассет по нашему идентификатору, а перевод делается
 *  здесь — в самом последнем месте, где он возможен. */
const withImageHashes = (
  paints: readonly ScenePaint[],
  images: ReadonlyMap<string, string>,
): unknown[] => paints.map((paint) => {
  if (paint.type !== 'IMAGE') return paint
  const hash = images.get(paint.assetId)
  if (hash === undefined) {
    /** Ассет объявлен, но картинки нет. Отдать краску без хеша значит
     *  получить в Figma пустой прямоугольник без объяснений — ровно
     *  тот молчаливый откат, против которого писан весь проект. */
    throw new Error(
      `Ассет "${paint.assetId}" не загружен в Figma: краску построить нечем.`,
    )
  }
  /** `assetId` СНИМАЕТСЯ, а не остаётся рядом: это наше поле, Figma
   *  его не знает, а лишнее поле в краске отвергается при присваивании.
   *  Результат объявлен как `ImagePaint`, чтобы компилятор сверил
   *  форму с официальными типами, а не с нашим представлением о ней. */
  const { assetId: _dropped, ...rest } = paint
  const built: AppliedImagePaint = { ...rest, imageHash: hash }
  return built
})

const applyBase = (
  target: FigmaLikeNode,
  base: SceneBase,
  images: ReadonlyMap<string, string>,
): void => {
  target.name = base.name
  target.x = base.x
  target.y = base.y
  target.resize(Math.max(0.01, base.width), Math.max(0.01, base.height))
  target.rotation = base.rotation
  target.opacity = base.opacity
  target.blendMode = base.blendMode
  target.fills = withImageHashes(base.fills, images)
  /** `strokes` принимает КРАСКИ, а не нашу структуру обводки: толщина
   *  в краску не входит и живёт отдельными свойствами. Первая редакция
   *  присваивала сюда всю структуру целиком, и Figma отвергала её —
   *  код падал на самом глубоком узле, оставляя созданные фигуры
   *  висеть на странице без родителей. */
  target.strokes = base.stroke === null ? [] : [base.stroke.paint]
  target.effects = [...base.effects]
  /** Углы и толщины по сторонам есть НЕ У ВСЕХ узлов: у текста
   *  скруглений нет вовсе. Присваивание несуществующего свойства в
   *  Figma не молчит, а бросает, поэтому каждое ставится только там,
   *  где оно объявлено. Проверка `in` — по самому узлу, а не по нашему
   *  представлению о том, у кого что бывает. */
  if ('cornerRadius' in target) {
    target['topLeftRadius'] = base.corner.tl
    target['topRightRadius'] = base.corner.tr
    target['bottomRightRadius'] = base.corner.br
    target['bottomLeftRadius'] = base.corner.bl
  }
  if (base.stroke !== null) {
    if ('strokeTopWeight' in target) {
      target['strokeTopWeight'] = base.stroke.weight.top
      target['strokeRightWeight'] = base.stroke.weight.right
      target['strokeBottomWeight'] = base.stroke.weight.bottom
      target['strokeLeftWeight'] = base.stroke.weight.left
    } else if ('strokeWeight' in target) {
      target['strokeWeight'] = Math.max(
        base.stroke.weight.top, base.stroke.weight.right,
        base.stroke.weight.bottom, base.stroke.weight.left,
      )
    }
    if ('dashPattern' in target) target['dashPattern'] = base.stroke.dashPattern
  }
}

export const applyNode = (
  figma: FigmaSurface,
  node: SceneNode,
  substitutions: Map<string, FontRequest>,
  images: ReadonlyMap<string, string> = new Map(),
): FigmaLikeNode => {
  let target: FigmaLikeNode

  if (node.kind === 'text') {
    const text = figma.createText()
    const first = node.text.runs[0]
    const key = `${first?.family ?? 'Inter'}|${first?.style ?? 'Regular'}`
    text.fontName = substitutions.get(key) ?? { family: 'Inter', style: 'Regular' }
    text.characters = node.text.characters
    text['lineHeight'] = { unit: 'PIXELS', value: node.text.lineHeight }
    text['textAlignHorizontal'] = node.text.align.toUpperCase()
    /** Перенос строк Figma делает САМ, и совпадение с браузерным не
     *  гарантируется. Размер задаётся жёстко, чтобы она хотя бы
     *  переносила в тех же границах. */
    text['textAutoResize'] = 'NONE'
    target = text
  } else if (node.kind === 'rect') {
    target = figma.createRectangle()
  } else {
    target = figma.createFrame()
    if (node.kind === 'frame') target.clipsContent = node.clipsContent
    if (node.kind === 'placeholder') {
      /** Имя важнее вида: по нему дизайнер находит место поиском,
       *  а красная рамка теряется среди содержимого. */
      target.name = `⚠ ${node.label}`
    }
  }

  applyBase(target, node.base, images)
  if (node.kind === 'placeholder') target.name = `⚠ ${node.label}`

  /** Дети добавляются В ТОМ ПОРЯДКЕ, в каком лежат в описании, и НЕ
   *  сортируются: порядок детей в Figma — это порядок отрисовки, и он
   *  уже расставлен строителем по `paintOrder`. Сортировка здесь была
   *  бы вторым местом, где решается один и тот же вопрос. */
  for (const child of node.base.children) {
    target.appendChild(applyNode(figma, child, substitutions, images))
  }
  return target
}

export const applyScreen = async (
  figma: FigmaSurface,
  screen: SceneScreen,
  fonts: readonly FontRequest[],
  images: ReadonlyMap<string, string> = new Map(),
): Promise<ApplyResult> => {
  /** Шрифты — ПЕРВЫМИ. `loadFontAsync` обязателен до любого изменения
   *  текста, и нарушение порядка даёт отказ уже в Figma, где
   *  разбираться труднее всего. */
  const { substitutions, report } = await loadFonts(figma, fonts, screen.id)
  return { root: applyNode(figma, screen.root, substitutions, images), report }
}
