import type { Diagnostic } from '@w2f/ir'
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
  /** Разбор SVG отдан Figma намеренно: это ТОТ ЖЕ импортёр, который
   *  работает при ручной вставке SVG на холст. Свой разборщик кривых
   *  пришлось бы сверять с этим — а сверять нечем, и расхождение
   *  вылезло бы уже у дизайнера. */
  createNodeFromSvg: (svg: string) => FigmaLikeNode
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
  /** Диапазонные операции. Необязательные, потому что двойник в тесте
   *  их не реализует: он проверяет ПОРЯДОК действий, а не поведение
   *  Figma, и заставлять его изображать разметку текста значило бы
   *  усложнять имитацию ради ничего. */
  setRangeFontName?: (start: number, end: number,
                      font: { family: string; style: string }) => void
  setRangeFontSize?: (start: number, end: number, size: number) => void
  setRangeLetterSpacing?: (start: number, end: number,
                           spacing: { unit: 'PIXELS'; value: number }) => void
  setRangeFills?: (start: number, end: number, fills: unknown[]) => void
  setRangeTextDecoration?: (start: number, end: number, decoration: string) => void
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
  /** ОБВОДКА ВНУТРЬ. CSS рисует границу внутри бокса, Figma по
   *  умолчанию — по центру, и без этой строки каждая рамка вылезала на
   *  половину толщины наружу, а её содержимое оказывалось ужато на ту
   *  же половину внутрь. Контракт несёт поле `align: 'inside'` именно
   *  чтобы применитель не забыл, — и применитель забыл: строки не было
   *  вовсе. Нашлось на живом импорте как «рамки криво». */
  if (base.stroke !== null && 'strokeAlign' in target) {
    target['strokeAlign'] = 'INSIDE'
  }
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
  report: Diagnostic[] = [],
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
    /** Текст прижат к ВЕРХУ бокса: бокс и есть строки, и его верх —
     *  верх первой строки. Значение по умолчанию то же, но выставлено
     *  явно: на нём держится всё вертикальное положение текста. */
    text['textAlignVertical'] = 'TOP'

    /** Прогоны применяются ДИАПАЗОНАМИ. Без этого весь текст получал
     *  начертание, кегль и цвет ПЕРВОГО прогона, и выделенные слова
     *  теряли и цвет, и жирность.
     *
     *  Каждый диапазон требует своего загруженного шрифта — иначе
     *  Figma откажет; подстановки уже посчитаны выше. */
    for (const run of node.text.runs) {
      if (run.end <= run.start) continue
      const key = `${run.family}|${run.style}`
      const font = substitutions.get(key) ?? { family: 'Inter', style: 'Regular' }
      text.setRangeFontName?.(run.start, run.end, font)
      text.setRangeFontSize?.(run.start, run.end, run.fontSize)
      text.setRangeLetterSpacing?.(run.start, run.end, {
        unit: 'PIXELS', value: run.letterSpacing,
      })
      text.setRangeFills?.(run.start, run.end, run.fills)
      if (run.decoration !== 'none') {
        text.setRangeTextDecoration?.(
          run.start, run.end,
          run.decoration === 'underline' ? 'UNDERLINE' : 'STRIKETHROUGH',
        )
      }
    }
    target = text
  } else if (node.kind === 'vector') {
    target = figma.createNodeFromSvg(node.svg)

    /** Размер, с которым Figma разобрала SVG, СВЕРЯЕТСЯ, а не
     *  принимается на веру.
     *
     *  Захват вписывает в SVG явные `width`/`height`, равные боксу
     *  узла, поэтому размеры обязаны совпасть. Если они разошлись —
     *  импортёр понял разметку иначе, чем мы, и `resize` дела не
     *  поправит: в Figma изменение размера рамки НЕ масштабирует её
     *  содержимое, то есть рисунок остался бы прежним внутри коробки
     *  другого размера. Честный ответ — сказать об этом, а не
     *  подогнать коробку и выдать за совпадение.
     *
     *  Та же схема, что у auto-layout: применить, перечитать у Figma,
     *  отчитаться при расхождении. Зона между нашей моделью и живым
     *  API не покрыта ни рендером, ни имитацией — только такими
     *  утверждениями о ФОРМЕ результата. */
    const got = { w: target.width, h: target.height }
    const want = { w: node.base.width, h: node.base.height }
    const off = typeof got.w === 'number' && typeof got.h === 'number'
      ? Math.abs(got.w - want.w) > 0.5 || Math.abs(got.h - want.h) > 0.5
      : true
    if (off) {
      report.push({
        level: 'warning', code: 'fidelity.vector-resized',
        message:
          `Figma разобрала SVG в ${String(got.w)} × ${String(got.h)}, ` +
          `а бокс узла — ${want.w} × ${want.h}. Рисунок внутри рамки не ` +
          `масштабируется вслед за ней, поэтому размер оставлен как есть.`,
        nodeId: node.base.id, screenId: null, needsPlaceholder: false,
      })
    }
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

  if (node.kind === 'text') {
    /** Авторазмер выставляется ПОСЛЕ `resize` в `applyBase`: порядок
     *  здесь и есть смысл. Документация не обещает, что `resize`
     *  сохранит авторазмер, и выставленный раньше он мог бы молча
     *  сброситься в NONE — с тем самым переносом «Rece / nts», ради
     *  которого всё и делается. */
    if (node.text.sizing === 'auto-width') {
      target['textAutoResize'] = 'WIDTH_AND_HEIGHT'
      /** Бокс вырос или ужался по метрикам Figma — а край, к которому
       *  текст был прижат, обязан остаться на месте. Для текста справа
       *  это правый край, для центрированного — середина; левый и так
       *  не двигается. Ширина ПЕРЕЧИТЫВАЕТСЯ у Figma, а не берётся из
       *  нашей: в этом вся суть авторазмера. */
      const grown = typeof target.width === 'number' ? target.width : node.base.width
      const shift = grown - node.base.width
      if (node.text.align === 'right') target.x = node.base.x - shift
      else if (node.text.align === 'center') target.x = node.base.x - shift / 2
    } else {
      target['textAutoResize'] = 'HEIGHT'
    }
  }

  /** Дети добавляются В ТОМ ПОРЯДКЕ, в каком лежат в описании, и НЕ
   *  сортируются: порядок детей в Figma — это порядок отрисовки, и он
   *  уже расставлен строителем по `paintOrder`. Сортировка здесь была
   *  бы вторым местом, где решается один и тот же вопрос. */
  const placed: FigmaLikeNode[] = []
  for (const child of node.base.children) {
    /** Сбой ОДНОГО ребёнка — запись в отчёте, а не конец импорта.
     *
     *  Figma проверяет присваивания и бросает на любом значении, которое
     *  ей не нравится; до этого места такое исключение поднималось до
     *  самого верха, и экран приезжал наполовину — созданные узлы
     *  висели, остальных не было, а причина одна на всех. Теперь
     *  сломавшийся ребёнок пропускается вместе со своим поддеревом,
     *  причина записывается с адресом, и остальные братья строятся. */
    try {
      const built = applyNode(figma, child, substitutions, images, report)
      target.appendChild(built)
      placed.push(built)
    } catch (error) {
      report.push({
        level: 'error', code: 'fidelity.node-failed',
        message: `Узел «${child.base.name}» не построен: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        nodeId: child.base.id, screenId: '', needsPlaceholder: false,
      })
    }
  }

  applyAutoLayout(target, node.base, placed, report)
  return target
}

/** Допуск тот же, что у вердикта: источник дробности один — браузер. */
const LAYOUT_TOLERANCE = 0.5

/** Включает auto-layout и ПРОВЕРЯЕТ, что Figma разложила так же.
 *
 *  Это единственное место, где применителю позволено сравнивать, и
 *  позволено намеренно: только здесь доступен ответ настоящей Figma.
 *  Логики тут всё равно нет — и ожидаемые положения, и параметры
 *  раскладки пришли из сцены.
 *
 *  Зачем перечитывать. Вердикт доказал, что раскладку воспроизводит
 *  ФЛЕКС CSS. Что её воспроизведёт флекс FIGMA — отдельное
 *  утверждение, и проверить его иначе нельзя: её модель своя и
 *  документацией не описана настолько, чтобы полагаться.
 *
 *  Разошлось — откат к абсолютным координатам. Это не деградация, а
 *  возврат к тому, что было до этого плана и что доказанно верно. */
const applyAutoLayout = (
  target: FigmaLikeNode,
  base: SceneBase,
  children: readonly FigmaLikeNode[],
  report: Diagnostic[],
): void => {
  const layout = base.autoLayout
  if (layout === null || children.length === 0) return

  /** Положения запоминаются ДО включения: auto-layout их перепишет, и
   *  вернуть будет неоткуда. */
  const before = children.map((child) => ({ x: child.x, y: child.y }))

  target['layoutMode'] = layout.mode
  target['itemSpacing'] = layout.itemSpacing
  target['paddingTop'] = layout.paddingTop
  target['paddingRight'] = layout.paddingRight
  target['paddingBottom'] = layout.paddingBottom
  target['paddingLeft'] = layout.paddingLeft
  target['primaryAxisAlignItems'] = layout.primaryAxisAlignItems
  target['counterAxisAlignItems'] = layout.counterAxisAlignItems
  /** Размеры узла фиксируются: иначе auto-layout сожмёт рамку по
   *  содержимому и сломает геометрию, которую мы измеряли. */
  target['primaryAxisSizingMode'] = 'FIXED'
  target['counterAxisSizingMode'] = 'FIXED'

  /** Абсолютные дети выводятся из очереди СРАЗУ после включения режима
   *  и ставятся на прежнее место. Порядок по документации: режим на
   *  родителе, потом `layoutPositioning` на ребёнке, потом координаты —
   *  до переключения Figma их игнорирует. */
  children.forEach((child, index) => {
    if (layout.positioning[index] !== 'ABSOLUTE') return
    child['layoutPositioning'] = 'ABSOLUTE'
    const was = before[index]
    if (was === undefined) return
    child.x = was.x
    child.y = was.y
  })

  const drifted = children.findIndex((child, index) => {
    const want = layout.expected[index]
    if (want === undefined) return true
    return Math.abs(child.x - want.x) > LAYOUT_TOLERANCE
      || Math.abs(child.y - want.y) > LAYOUT_TOLERANCE
  })

  if (drifted === -1) return

  /** Откат. Порядок важен: сначала снимается режим, потом
   *  возвращаются координаты — пока режим включён, Figma их
   *  игнорирует. */
  target['layoutMode'] = 'NONE'
  children.forEach((child, index) => {
    const was = before[index]
    if (was === undefined) return
    child.x = was.x
    child.y = was.y
  })

  report.push({
    level: 'info', code: 'fidelity.auto-layout-rejected',
    message:
      `Auto-layout снят: Figma разложила ребёнка ${drifted + 1} не туда, `
      + 'куда его кладёт флекс браузера. Возвращены абсолютные координаты.',
    nodeId: base.id, screenId: '', needsPlaceholder: false,
  })
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
  const root = applyNode(figma, screen.root, substitutions, images, report)
  /** Экран у записей об откате проставляется здесь: применитель узла
   *  его не знает, а запись без адреса бесполезна. */
  for (const entry of report) {
    if (entry.screenId === '') entry.screenId = screen.id
  }
  return { root, report }
}
