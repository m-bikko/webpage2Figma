/**
 * Сверяет ИМПОРТИРОВАННЫЙ в Figma макет с бандлом — поузлово, через
 * REST API Figma, без глаз.
 *
 * Зачем. Пиксельный гейт и круговой обход сверяют наш SVG-рендер с
 * браузером — оба в Chromium. Что сделала с деревом настоящая Figma,
 * они не видят: только человек, глазами, по скриншоту. Этот скрипт
 * читает дерево из файла Figma и сравнивает с деревом сцены, которое
 * плагин туда отправлял: где узел, какого размера, что за текст, есть
 * ли обводка внутрь, включён ли auto-layout. Расхождение выходит
 * списком с именами узлов, а не «что-то не так».
 *
 *   FIGMA_TOKEN=... pnpm verify-figma-nodes <файл.w2f> <ключ файла> [id корня экрана]
 *
 * Ключ файла — из адреса: figma.com/design/<КЛЮЧ>/...  Токен —
 * персональный, Settings → Security → Personal access tokens, с правом
 * file_content:read. Он нигде не сохраняется и никуда, кроме
 * api.figma.com, не уходит.
 *
 * Сопоставление узлов — ПО ИМЕНАМ И ПОРЯДКУ: у Figma свои
 * идентификаторы, а имена плагин выставляет из сцены, и на пути
 * «сцена → applyNode → appendChild» порядок детей сохраняется.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Собранные dist, как и в `capture.mjs`: обычный node не разрешает
 *  `.ts` через поле exports, а собрать их всё равно нужно — это делает
 *  `pnpm build`. */
const here = dirname(fileURLToPath(import.meta.url))
const { unpackBundle } = await import(pathToFileURL(resolve(here, '../packages/bundle/dist/bundled.js')).href)
const { buildScene } = await import(pathToFileURL(resolve(here, '../packages/plugin/dist/bundled.js')).href)

const [, , bundleArg, fileKey, rootId] = process.argv
const token = process.env['FIGMA_TOKEN']
if (bundleArg === undefined || fileKey === undefined || token === undefined) {
  console.error('FIGMA_TOKEN=... pnpm verify-figma-nodes <файл.w2f> <ключ файла> [id корня]')
  process.exit(1)
}

const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), bundleArg)))
const { bundle, files } = await unpackBundle(bytes)
const svgTexts = new Map()
for (const asset of bundle.assets) {
  if (asset.mimeType !== 'image/svg+xml') continue
  const raw = files.assets[asset.id]
  if (raw !== undefined) svgTexts.set(asset.id, new TextDecoder().decode(raw))
}
const scene = buildScene(bundle, svgTexts)

/** Лимит запросов Figma отдаёт как 429, и он не ошибка данных, а
 *  просьба подождать. Скрипт ждёт и повторяет, а не падает: иначе
 *  сверка срывалась бы на второй попытке подряд. */
const api = async (path, attempt = 0) => {
  const response = await fetch(`https://api.figma.com/v1${path}`, {
    headers: { 'X-Figma-Token': token },
  })
  if (response.status === 429 && attempt < 5) {
    const wait = Number(response.headers.get('retry-after') ?? 0) * 1000 || 30_000 * (attempt + 1)
    console.log(`Figma просит подождать: ${Math.round(wait / 1000)} с`)
    await new Promise((done) => { setTimeout(done, wait) })
    return api(path, attempt + 1)
  }
  if (!response.ok) {
    throw new Error(`Figma ответила ${response.status} на ${path}: ${await response.text()}`)
  }
  return response.json()
}

/** Экраны в файле ищутся ПО ИМЕНИ КОРНЯ сцены среди детей первой
 *  страницы: плагин кладёт их туда как есть. */
const file = await api(`/files/${fileKey}?depth=2`)
const pages = file.document.children ?? []
const top = pages.flatMap((page) => (page.children ?? []).map((n) => ({ ...n, page: page.name })))

const problems = []
const note = (path, what) => problems.push(`${path}: ${what}`)
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

/** Сравнение поддерева. `origin` — абсолютное положение родителя в
 *  Figma: у неё координаты в ответе абсолютные, у сцены — от родителя. */
const compare = (sceneNode, figmaNode, origin, path) => {
  const box = figmaNode.absoluteBoundingBox
  if (box === undefined) { note(path, 'у узла Figma нет границ (невидим?)'); return }
  const expectX = origin.x + sceneNode.base.x
  const expectY = origin.y + sceneNode.base.y
  /** Допуск в пиксель: у Figma в ответе дробные координаты округляются
   *  по-своему. Расхождение больше пикселя — уже не округление. */
  if (!near(box.x, expectX, 1) || !near(box.y, expectY, 1)) {
    note(path, `положение: сцена (${expectX.toFixed(1)}, ${expectY.toFixed(1)}), Figma (${box.x.toFixed(1)}, ${box.y.toFixed(1)})`)
  }
  /** Размер текста с авторазмером сверять нельзя — он и должен
   *  отличаться, Figma меряет своим шрифтом. Остальное обязано
   *  совпасть. */
  const autoText = sceneNode.kind === 'text' && sceneNode.text.sizing === 'auto-width'
  if (!autoText && (!near(box.width, sceneNode.base.width, 1) || !near(box.height, sceneNode.base.height, 1))) {
    note(path, `размер: сцена ${sceneNode.base.width.toFixed(1)}×${sceneNode.base.height.toFixed(1)}, Figma ${box.width.toFixed(1)}×${box.height.toFixed(1)}`)
  }
  if (sceneNode.kind === 'text') {
    if (figmaNode.type !== 'TEXT') note(path, `ожидался TEXT, в Figma ${figmaNode.type}`)
    else if (figmaNode.characters !== sceneNode.text.characters) {
      note(path, `текст: «${sceneNode.text.characters.slice(0, 30)}» → «${String(figmaNode.characters).slice(0, 30)}»`)
    }
    /** Число строк — то единственное, что круговой обход о тексте не
     *  проверяет; здесь оно видно по высоте относительно lineHeight. */
    if (autoText && box.height > sceneNode.text.lineHeight * 1.5) {
      note(path, `однострочный текст перенёсся: высота ${box.height.toFixed(0)} при строке ${sceneNode.text.lineHeight}`)
    }
  }
  if (sceneNode.kind === 'vector' && !['VECTOR', 'FRAME', 'GROUP', 'BOOLEAN_OPERATION'].includes(figmaNode.type)) {
    note(path, `ожидался вектор, в Figma ${figmaNode.type}`)
  }
  if (sceneNode.base.stroke !== null && figmaNode.strokeAlign !== undefined && figmaNode.strokeAlign !== 'INSIDE') {
    note(path, `обводка ${figmaNode.strokeAlign}, ожидалась INSIDE`)
  }
  if (sceneNode.base.autoLayout !== null) {
    const mode = figmaNode.layoutMode ?? 'NONE'
    if (mode === 'NONE') note(path, 'auto-layout откатился в Figma')
  }
  const figmaKids = figmaNode.children ?? []
  const sceneKids = sceneNode.base.children
  if (figmaKids.length !== sceneKids.length) {
    note(path, `детей: сцена ${sceneKids.length}, Figma ${figmaKids.length}`)
  }
  const count = Math.min(figmaKids.length, sceneKids.length)
  for (let i = 0; i < count; i += 1) {
    compare(sceneKids[i], figmaKids[i], { x: box.x, y: box.y }, `${path}/${sceneKids[i].base.name.slice(0, 20)}`)
  }
}

let matched = 0
for (const screen of scene.screens) {
  /** Плагин кладёт на страницу АРТБОРД с именем экрана и холстом в
   *  заливке, а корень сцены (`body`) — первым ребёнком в нём. Ищется
   *  артборд; берётся последний из одноимённых — последний импорт. */
  const candidates = rootId !== undefined
    ? top.filter((n) => n.id === rootId)
    : top.filter((n) => n.name === screen.artboard)
  const artboard = candidates[candidates.length - 1]
  if (artboard === undefined) {
    console.log(`экран «${screen.name}»: артборда «${screen.artboard}» на страницах нет`)
    continue
  }
  const full = await api(`/files/${fileKey}/nodes?ids=${encodeURIComponent(artboard.id)}`)
  const board = full.nodes[artboard.id]?.document
  if (board === undefined) { console.log(`экран «${screen.name}»: узел ${artboard.id} не отдан`); continue }
  const before = problems.length
  const size = board.absoluteBoundingBox
  if (Math.round(size.width) !== screen.width || Math.round(size.height) !== screen.height) {
    problems.push(`${screen.name}: артборд ${Math.round(size.width)}×${Math.round(size.height)}, ожидалось ${screen.width}×${screen.height}`)
  }
  const fill = (board.fills ?? [])[0]
  const expected = screen.canvas.color
  const same = fill !== undefined && fill.type === 'SOLID' &&
    ['r', 'g', 'b'].every((k) => Math.abs(fill.color[k] - expected[k]) < 0.002)
  if (!same) {
    problems.push(`${screen.name}: холст артборда ${JSON.stringify(fill?.color ?? null)}, ожидалось ${JSON.stringify(expected)}`)
  }
  const doc = (board.children ?? [])[0]
  if (doc === undefined) { console.log(`экран «${screen.name}»: артборд пуст`); continue }
  compare(screen.root, doc, { x: doc.absoluteBoundingBox.x - screen.root.base.x, y: doc.absoluteBoundingBox.y - screen.root.base.y }, screen.name)
  matched += 1
  console.log(`экран «${screen.name}» (${figmaRoot.id}): расхождений ${problems.length - before}`)
  if (rootId !== undefined) break
}

if (matched === 0) process.exit(2)
const groups = new Map()
for (const problem of problems) {
  const kind = problem.split(': ')[1]?.split(':')[0] ?? problem
  groups.set(kind, (groups.get(kind) ?? 0) + 1)
}
console.log('\nПо видам:')
for (const [kind, n] of [...groups].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${kind}`)
console.log('\nПервые тридцать:')
for (const problem of problems.slice(0, 30)) console.log('  ' + problem)
