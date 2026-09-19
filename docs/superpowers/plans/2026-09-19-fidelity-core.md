# Fidelity Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить движок точности html2design: сериализатор `DOM → IR`, референс-рендерер `IR → SVG` и автоматический тестовый контур, который в настоящем Chrome доказывает pixel-diff'ом, что IR верно описывает нарисованную браузером страницу.

**Architecture:** pnpm-воркспейс из трёх пакетов. `packages/ir` — типы и zod-валидация формата обмена. `packages/serializer` — чистые функции обхода DOM, собираются в IIFE-бандл и инжектятся в страницу. `packages/reference-renderer` — обратное преобразование IR в SVG, служит и инструментом отладки, и эталоном для pixel-diff. Playwright гоняет локальные HTML-фикстуры на пяти ширинах, сравнивает IR со закоммиченными снапшотами и диффит скриншот браузера со скриншотом отрендеренного из IR SVG.

**Tech Stack:** TypeScript strict (без `any`), pnpm workspaces, vitest (юнит), Playwright (E2E в настоящем Chrome), tsup (IIFE-бандл сериализатора), zod (валидация IR), pixelmatch + pngjs (диффы).

**Источник требований:** `docs/superpowers/specs/2026-09-19-html2design-design.md`

**Место в карте планов:** план 1 из 4. Дальше: 2 — extension, 3 — плагин Figma, 4 — компоненты и токены.

**Границы этого плана.** Покрывается вертикальный срез CSS: сплошные заливки, обводки с разной толщиной по сторонам, радиусы по углам, внешние и внутренние тени, `opacity`, `overflow: hidden`, flex-раскладки, абсолютное позиционирование, `z-index`-стекинг, текст с переносами. Градиенты, изображения, псевдоэлементы, shadow DOM, трансформы, блюры и same-origin iframe расширяют покрытие в плане 2 — тестовый контур из этого плана делает их добавление механическим.

**Соглашение по коммитам.** Каждый коммит заканчивается трейлером:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Ниже в командах он опущен ради читаемости — добавляй его всегда.

**Правило TDD.** Тест пишется первым, запускается и обязан упасть по ожидаемой причине, и только потом пишется минимальная реализация. Шаг «убедись, что тест падает» не пропускается: он доказывает, что тест вообще что-то проверяет.

---

## Структура файлов

```
package.json                              воркспейс-корень, скрипты
pnpm-workspace.yaml
tsconfig.base.json                        strict, noUncheckedIndexedAccess
vitest.config.ts
playwright.config.ts

packages/ir/
  package.json
  src/version.ts                          IR_VERSION
  src/types.ts                            все типы IR
  src/schema.ts                           zod-схемы, зеркало types.ts
  src/validate.ts                         parseBundle(): Bundle | ошибка
  src/index.ts
  test/validate.test.ts

packages/serializer/
  package.json
  tsup.config.ts                          IIFE-бандл → dist/serializer.global.js
  src/css/color.ts                        parseColor
  src/css/length.ts                       parsePx
  src/css/corner.ts                       readCorner
  src/css/stroke.ts                       readStroke
  src/css/shadow.ts                       parseBoxShadow
  src/probe.ts                            LayoutProbe, readProbe
  src/stacking.ts                         resolvePaintOrder — чистая, без DOM
  src/layout.ts                           readLayout
  src/text.ts                             readText
  src/diagnostics.ts                      DiagnosticSink
  src/walk.ts                             обход DOM → IrNode
  src/serialize.ts                        serializeScreen
  src/global.ts                           точка входа IIFE: window.__h2d
  src/index.ts
  test/color.test.ts
  test/shadow.test.ts
  test/stacking.test.ts
  test/layout.test.ts

packages/reference-renderer/
  package.json
  src/render.ts                           renderScreenToSvg
  src/html.ts                             wrapSvgInHtml
  src/index.ts
  test/render.test.ts

fixtures/
  boxes/index.html                        сплошные заливки, радиусы, обводки, тени
  stacking/index.html                     z-index, вложенные stacking contexts
  flex/index.html                         flex-row, flex-column, gap, padding
  text/index.html                         переносы, выравнивание, letter-spacing
  <name>/ir/<width>.json                  закоммиченные снапшоты IR
  <name>/threshold.json                   порог pixel-diff на фикстуру

tests/
  e2e/fidelity.spec.ts                    Playwright: IR-снапшоты + pixel-diff
  e2e/helpers/capture.ts                  инжект бандла и вызов сериализатора
  e2e/helpers/diff.ts                     pixelmatch-обёртка
```

Разбиение по ответственности, а не по слоям: каждый парсер CSS — свой файл со своими тестами, потому что именно парсеры ломаются на неожиданном вводе и их надо читать изолированно. `stacking.ts` вынесен отдельно и не знает про DOM — это самый сложный алгоритм плана, и он должен тестироваться на синтетических деревьях без браузера.

---

## Task 1: Воркспейс и конфигурация

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/ir/package.json`, `packages/ir/tsconfig.json`

- [ ] **Step 1: Создать корневой `package.json`**

```json
{
  "name": "html2design",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "tsc -b packages/ir",
    "typecheck:root": "tsc -p tsconfig.json",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test": "pnpm typecheck && pnpm typecheck:root && pnpm test:unit && pnpm test:e2e",
    "build:serializer": "pnpm --filter @h2d/serializer build"
  },
  "devDependencies": {
    "@h2d/ir": "workspace:*",
    "@playwright/test": "^1.48.0",
    "@types/node": "^22.7.0",
    "@types/pixelmatch": "^5.2.6",
    "@types/pngjs": "^6.0.5",
    "pixelmatch": "^6.0.0",
    "pngjs": "^7.0.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`@h2d/ir` объявлен зависимостью корня намеренно: без этого `tests/e2e/` его не разрешит.

**Важно: пакеты подключаются по мере появления.** `workspace:*`-зависимость на несуществующий пакет валит `pnpm install`, а `tsc -b` на несуществующий путь валит typecheck. Поэтому здесь в `typecheck` только `packages/ir`, а `@h2d/reference-renderer` в зависимостях отсутствует. Расширения делают Task 4 (добавляет `packages/serializer` в `typecheck`) и Task 12 (добавляет `packages/reference-renderer` и в `typecheck`, и в корневые `devDependencies` — второе обязательно, иначе `tests/e2e/pixel-diff.spec.ts` из Task 14 не разрешит импорт).

- [ ] **Step 2: Создать `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Создать `tsconfig.base.json`**

`noUncheckedIndexedAccess` включён намеренно: сериализатор постоянно индексирует массивы стилей и детей, и молчаливый `undefined` там — источник ровно тех ошибок, которых проект избегает.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Создать корневой `tsconfig.json`**

Отдельный от `tsconfig.base.json`: базовый наследуют пакеты, а этот обслуживает тесты в корне и проверяется скриптом `typecheck:root`.

**Без `paths` и `baseUrl`.** Разрешение воркспейс-пакетов по именам обеспечивают pnpm-симлинк и поле `exports` в `package.json` пакета, указывающее прямо на `src/index.ts`. При `moduleResolution: bundler` компилятор следует `exports` точно так же, как сборщик, — проверено удалением записи из `paths`: реальный импорт значения `IR_VERSION` из `@h2d/ir` продолжает резолвиться.

`paths` был бы вторым, независимо поддерживаемым утверждением того же факта, причём асимметрично опасным: **tsc предпочитает `paths`**, когда он есть. Если `exports` пакета когда-нибудь переведут на собранный `dist/index.js`, компилятор продолжит проверять исходники, а Vitest и Playwright уедут на новую цель, и никто об этом не узнает. `baseUrl` удалён вместе с `paths`: он существовал только чтобы их якорить, а оставленный сам по себе позволил бы случайно разрешаться импортам вида `packages/ir/src/types`.

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true
  },
  "include": ["tests/**/*.ts", "playwright.config.ts", "vitest.config.ts"]
}
```

`typecheck:root` подключён к составному `test` сразу, в этой же задаче, хотя `tests/` и `playwright.config.ts` появятся только в Task 13. Так можно: `tsc -p` выходит с нулём, когда `include`-глоб ни на что не указывает — проверено. Отложенное подключение не давало бы ничего, кроме риска, что его так и не подключат.

- [ ] **Step 5: Создать `vitest.config.ts`**

Без `resolve.alias`. Алиасы были бы инертной дубликацией: Vitest разрешает `@h2d/ir` через воркспейс-симлинк и `exports` пакета. Проверено удалением блока — тесты продолжают проходить.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 6: Создать `.gitignore`**

`*.tsbuildinfo` обязателен: при `composite: true` компилятор кладёт `tsconfig.tsbuildinfo` в корень пакета, **не** внутрь `dist/`, поэтому правилом `dist/` он не ловится. Без этой строки артефакт сборки уедет в коммит на первом же `git add packages/ir`.

```
node_modules/
dist/
*.tsbuildinfo
.turbo/
test-results/
playwright-report/
*.actual.png
*.diff.png
```

Проверить правилом, а не созданием файла:

Run: `git check-ignore -v packages/ir/tsconfig.tsbuildinfo`
Expected: строка с совпадением на `*.tsbuildinfo`.

- [ ] **Step 7: Создать `packages/ir/package.json`**

```json
{
  "name": "@h2d/ir",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.0" }
}
```

- [ ] **Step 8: Создать `packages/ir/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 9: Установить зависимости**

Run: `pnpm install`
Expected: установка завершается без ошибок, появляется `pnpm-lock.yaml`.

- [ ] **Step 10: Установить браузер для Playwright**

Run: `pnpm exec playwright install chromium`
Expected: `Chromium ... downloaded`.

- [ ] **Step 11: Коммит**

```bash
git add -A
git commit -m "chore: pnpm-воркспейс, strict TypeScript, vitest, playwright"
```

---

## Task 2: Типы IR

**Эта задача переписана после design-ревью контракта.** Первая редакция была посимвольно реализована и закоммичена (`5e09c07`), после чего ревью нашло, что выразительная сила контракта уже́ ниже той поддержки, которую обещает спека, и что в каждой точке нехватки результат получается **тихо неверным**, а не громко упавшим. Разбор и обоснование — в разделе «Ревизия контракта» в конце плана. Реализация этой задачи — правка `types.ts` до формы ниже.

Типы пишутся целиком, включая поля, которые в этом плане не заполняются. Это дешевле, чем менять контракт в планах 2–4, и позволяет плагину Figma сразу писаться против финальной формы. Ревью показало, что в первой редакции этот принцип применили к `assets`, `tokens` и `image`, но забыли про `transform`, `blend`, `blur` и векторы — без причины.

**Ключевое решение ревизии: `IrNode` — настоящее размеченное объединение по `kind`.** Тогда `text` непустой ровно когда `kind === 'text'`, состояние «и текст, и картинка одновременно» невыразимо, исчерпывающий `switch` из §8.5 спеки становится возможным, а заглушка для неподдерживаемого содержимого получает собственный вид узла — сейчас её просто нечем представить.

**Files:**
- Create: `packages/ir/src/version.ts`, `packages/ir/src/codes.ts`, `packages/ir/src/types.ts`, `packages/ir/src/index.ts`

- [ ] **Step 1: Создать `packages/ir/src/version.ts`**

```ts
/** Версия формата IR. Обе половины системы сверяют её и отказываются
 *  работать при несовпадении — молчаливая деградация запрещена. */
export const IR_VERSION = 1
export type IrVersion = typeof IR_VERSION

/** Сырой конверт: читается ДО валидации, чтобы отличить «это не наш файл»
 *  от «наш файл чужой версии» и дать внятное сообщение вместо простыни zod.
 *  Бандл — односверсионный артефакт: миграций нет, есть отказ. */
export type BundleEnvelope = { format?: unknown; version?: unknown }
```

- [ ] **Step 2: Создать `packages/ir/src/codes.ts`**

Коды диагностики живут в `@h2d/ir`, а не в сериализаторе. Причина конкретная: плагин Figma не может импортировать из сериализатора — тот собран как IIFE для контекста страницы. Держать список в сериализаторе означало бы, что плагин его дублирует или сравнивает строки, и первый же новый код из плана 2 провалился бы в плагине в общую ветку без заглушки. Тогда неподдерживаемый элемент приехал бы в Figma обычной пустой коробкой — ровно молчаливо неверный результат.

```ts
/** Коды стабильны: на них ссылается UI отчёта в плагине Figma и тесты.
 *  Живут здесь, а не в сериализаторе, потому что плагин обязан их знать,
 *  а импортировать из сериализатора не может. */
export const DIAGNOSTIC_CODES = {
  unsupportedCanvas: 'unsupported.canvas',
  unsupportedCrossOriginIframe: 'unsupported.cross-origin-iframe',
  unsupportedClosedShadowRoot: 'unsupported.closed-shadow-root',
  unsupportedClipPath: 'unsupported.clip-path',
  unsupportedFilter: 'unsupported.filter',
  unsupportedTransform3d: 'unsupported.transform-3d',
  unsupportedRepeatingGradient: 'unsupported.repeating-gradient',

  /** Признано в плане 1, реализуется в плане 2. Пока обязано
   *  порождать диагностику, а не тихо исчезать. */
  deferredGradient: 'deferred.gradient',
  deferredTransform: 'deferred.transform',
  deferredBlur: 'deferred.blur',
  deferredBlend: 'deferred.blend',
  deferredVector: 'deferred.vector',
  deferredPseudoElement: 'deferred.pseudo-element',

  colorUnparsed: 'fidelity.color-unparsed',
  colorClamped: 'fidelity.color-clamped',
  fontFallback: 'fidelity.font-fallback',
  gridFlattened: 'fidelity.grid-flattened',
  ellipticalCorner: 'fidelity.elliptical-corner',
  mixedBorderColors: 'fidelity.mixed-border-colors',
  strokeStyleFlattened: 'fidelity.stroke-style-flattened',
  stickyFlattened: 'fidelity.sticky-flattened',
  paintOrderInterleaved: 'fidelity.paint-order-interleaved',
} as const

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES]

export const ALL_DIAGNOSTIC_CODES: readonly DiagnosticCode[] =
  Object.values(DIAGNOSTIC_CODES)
```

- [ ] **Step 3: Создать `packages/ir/src/types.ts`**

```ts
import type { DiagnosticCode } from './codes.js'
import type { IrVersion } from './version.js'

/** sRGB, каналы r/g/b — ЦЕЛЫЕ 0..255, альфа — 0..1.
 *  Это НЕ единицы Figma: там все четыре канала 0..1. Конверсия делается
 *  в плагине, потому что источник (`getComputedStyle`) и второй потребитель
 *  (SVG-рендерер) работают в 0..255, и только Figma — нет.
 *  Имя с «8» умышленное: `{r:1,g:1,b:1}` — почти чёрный здесь и белый
 *  в Figma, и эту ошибку легко сделать молча. */
export type Rgba8 = { r: number; g: number; b: number; a: number }

export type Rect = { x: number; y: number; w: number; h: number }

export type Sides = { top: number; right: number; bottom: number; left: number }

export type Corner = { tl: number; tr: number; br: number; bl: number }

/** Разложенная 2D-трансформа в форме, близкой к Figma.
 *  Когда она не null, `rect` — НЕтрансформированный border box.
 *  Иначе два поля противоречат друг другу: `getBoundingClientRect()`
 *  возвращает габарит уже трансформированного элемента, поэтому
 *  повёрнутый на 15° блок 100×20 дал бы ~102×31. */
export type Transform = {
  /** Радианы, против часовой стрелки. */
  angle: number
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
}

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

/** Размещение изображения в боксе. Не keyword: Figma управляет
 *  картинкой через трансформу, а CSS умеет
 *  `right 24px center / 120px auto`, что keyword'ом не выразить. */
export type ImagePlacement = {
  mode: 'fill' | 'fit' | 'tile' | 'crop'
  /** Смещение в пикселях от левого верхнего угла бокса. */
  offsetX: number
  offsetY: number
  /** Масштаб изображения; для `tile` задаёт размер плитки. */
  scaleX: number
  scaleY: number
}

export type ImageRef = { assetId: string; placement: ImagePlacement }

/** Градиенты появятся отдельным членом объединения в плане 2.
 *  Это безопасно именно потому, что `Fill` размечен: неизвестный `kind`
 *  падает громко и в zod, и в исчерпывающем `switch`. */
export type Fill =
  | { kind: 'solid'; color: Rgba8 }
  | { kind: 'image'; ref: ImageRef }

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

export type Stroke = {
  color: Rgba8
  weight: Sides
  style: StrokeStyle
  /** CSS рисует границу внутрь бокса, а Figma по умолчанию по центру —
   *  при значении по умолчанию каждый элемент с границей сдвинулся бы
   *  на половину толщины. Поле существует, чтобы плагин обязан был
   *  выставить `strokeAlign`, а не забыть про него. */
  align: 'inside'
}

export type Shadow = {
  kind: 'outer' | 'inner'
  color: Rgba8
  offsetX: number
  offsetY: number
  blur: number
  spread: number
}

export type Blur = { layer: number; background: number }

export type NodeStyle = {
  fills: Fill[]
  stroke: Stroke | null
  corner: Corner
  shadows: Shadow[]
  /** СОБСТВЕННАЯ непрозрачность узла, не композитная. Ребёнок
   *  полупрозрачного родителя записывает свою, плагин вкладывает узлы,
   *  и Figma перемножает так же, как браузер. Запекать эффективную
   *  непрозрачность вниз по дереву запрещено: Figma применит её дважды. */
  opacity: number
  blend: BlendMode
  blur: Blur | null
  clip: boolean
}

export type LayoutMode = 'row' | 'column' | 'none'
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type LayoutJustify =
  | 'start' | 'center' | 'end'
  | 'space-between' | 'space-around' | 'space-evenly'

/** Описывает раскладку, которую узел навязывает своим детям. */
export type NodeLayout = {
  mode: LayoutMode
  gap: number
  padding: Sides
  align: LayoutAlign
  justify: LayoutJustify
  wrap: boolean
}

export type SelfPositioning = 'flow' | 'absolute' | 'fixed' | 'sticky' | 'float'

/** Описывает, как узел участвует в раскладке РОДИТЕЛЯ.
 *  Без этого плагин не может отличить обычного ребёнка flex-контейнера
 *  от абсолютно позиционированного бейджа и уложит бейдж третьим
 *  элементом auto-layout, сдвинув остальные. */
export type SelfLayout = {
  positioning: SelfPositioning
  /** null — наследуется `align` родителя (`align-self: auto`). */
  align: LayoutAlign | null
  grow: number
  shrink: number
}

export type TextDecoration = 'none' | 'underline' | 'strikethrough'
export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type TextRun = {
  /** ТОЛЬКО собственный текст узла, без текста потомков.
   *  Инвариант: конкатенация `runs[].text` равна собственному тексту узла
   *  и равна конкатенации `lines[].text`. Первая редакция контракта
   *  нарушала это: `run.text` был `el.textContent` (весь подграф), а
   *  `lines` — только прямые текстовые узлы, из-за чего плагин рисовал
   *  вложенный `<b>` дважды. */
  text: string
  /** Весь объявленный `font-family`, по порядку. */
  fontStack: string[]
  /** Семейство, которым браузер РЕАЛЬНО рисовал. Может отличаться от
   *  `fontStack[0]`, и тогда `lines` содержат метрики этого семейства.
   *  Без различения плагин применил бы метрики Helvetica к Söhne и
   *  получил вылезающий текст, считая, что шрифт найден. */
  usedFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  fontSize: number
  letterSpacing: number
  color: Rgba8
  decoration: TextDecoration
  shadows: Shadow[]
}

/** Реальный бокс строки, снятый через `Range.getClientRects()`.
 *  Figma переносит строки сама и почти наверняка иначе, чем браузер,
 *  поэтому места переносов фиксируются явно. */
export type LineBox = { x: number; y: number; w: number; h: number; text: string }

export type NodeText = {
  /** Непустой по построению: текстовый узел без ранов отрендерился бы
   *  в ничто, и это молчаливая потеря. */
  runs: [TextRun, ...TextRun[]]
  lines: LineBox[]
  /** Свойства абзаца, а не отдельного рана: два рана не могут иметь
   *  разное выравнивание, и плагин не должен выбирать произвольно. */
  lineHeight: number
  align: TextAlign
}

export type VectorPath = {
  /** Путь в синтаксисе SVG `d`. */
  data: string
  fill: Rgba8 | null
  stroke: Stroke | null
}

type NodeBase = {
  /** Уникален в пределах БАНДЛА, а не экрана: диагностика ссылается
   *  на узел, и `n42` в пяти экранах сделал бы ссылку неоднозначной. */
  id: string
  sourceTag: string
  name: string
  /** Абсолютные координаты документа, не вьюпорта. Когда `transform`
   *  не null — НЕтрансформированный border box. */
  rect: Rect
  /** Порядок отрисовки браузера, НЕ порядок DOM.
   *  Инвариант, который валидируется: плотный, уникальный, полный
   *  порядок по всем узлам экрана. Плотность важна не сама по себе —
   *  она позволяет плагину обнаружить случай, который дерево Figma
   *  выразить не может: если `paintOrder` узла попадает внутрь
   *  диапазона чужого поддерева, значит потомок красится поверх соседа
   *  родителя, и требуется перестройка либо диагностика. */
  paintOrder: number
  /** Узел создаёт stacking context. Продюсер знает это бесплатно
   *  (он уже вычисляет это для порядка отрисовки), плагин восстановить
   *  не может: ни `transform`, ни `filter`, ни `isolation`, ни
   *  `z-index` в IR по отдельности не лежат. */
  isStackingContext: boolean
  transform: Transform | null
  layout: NodeLayout
  selfLayout: SelfLayout
  style: NodeStyle
  /** В порядке РАСКЛАДКИ: после нормализации `-reverse` и `order`.
   *  Порядок отрисовки живёт только в `paintOrder`. */
  children: IrNode[]
}

/** Размеченное объединение, а не флаги. `kind` делает возможным
 *  исчерпывающий `switch` из §8.5 спеки, исключает представимое
 *  состояние «и текст, и картинка» и даёт заглушке собственный вид. */
export type IrNode =
  | (NodeBase & { kind: 'frame' })
  | (NodeBase & { kind: 'text'; text: NodeText })
  | (NodeBase & { kind: 'image'; image: ImageRef })
  | (NodeBase & { kind: 'vector'; paths: VectorPath[] })
  | (NodeBase & {
      kind: 'placeholder'
      /** Видимая заглушка в Figma. Правило «молчаливый fallback — это баг»
       *  требует, чтобы неподдерживаемое содержимое было ВИДНО, а не
       *  приезжало пустой коробкой. */
      placeholder: { code: DiagnosticCode; label: string }
    })

export type NodeKind = IrNode['kind']

export type DiagnosticLevel = 'info' | 'warning' | 'error'

export type Diagnostic = {
  level: DiagnosticLevel
  code: DiagnosticCode
  message: string
  nodeId: string | null
  /** Стабильный `Screen.id`, не отображаемое имя: имя редактируется
   *  пользователем и не обязано быть уникальным. */
  screenId: string | null
  /** Узел требует видимой заглушки. Иначе плагин, встретив незнакомый
   *  код, нарисовал бы обычную пустую коробку. */
  needsPlaceholder: boolean
}

export type Screen = {
  /** Стабильный идентификатор. На него ссылается диагностика. */
  id: string
  /** Отображаемое имя. Редактируется пользователем, уникальность
   *  не гарантируется. */
  name: string
  /** Эмулированная ширина вьюпорта, то есть брейкпоинт.
   *  Горизонтальное переполнение содержимого здесь НЕ отражается. */
  width: number
  /** Высота фрейма макета: высота содержимого, но не меньше высоты
   *  вьюпорта. Скриншот для pixel-diff приводится к этому числу,
   *  а не наоборот. */
  height: number
  dpr: number
  /** Позиция скролла на момент захвата: `fixed` и `sticky` сняты в ней.
   *  Без этого поля смещение необъяснимо в отчёте, а бандл
   *  из багрепорта невоспроизводим. */
  scroll: { x: number; y: number }
  root: IrNode
  screenshotId: string | null
}

export type Asset = {
  id: string
  mimeType: string
  width: number
  height: number
  path: string
}

export type FontRequirement = {
  family: string
  weight: number
  style: 'normal' | 'italic'
}

export type Tokens = {
  variables: { name: string; value: string }[]
  textStyles: { name: string; run: TextRun }[]
  paintStyles: { name: string; fill: Fill }[]
}

export type Bundle = {
  /** Маркер формата. Позволяет отличить «это не наш файл» от
   *  «наш файл чужой версии» и не сообщать «версия undefined». */
  format: 'h2d'
  version: IrVersion
  capturedAt: string
  url: string
  title: string
  userAgent: string
  screens: Screen[]
  assets: Asset[]
  fonts: FontRequirement[]
  tokens: Tokens
  report: Diagnostic[]
}
```

- [ ] **Step 4: Создать `packages/ir/src/index.ts`**

```ts
export * from './version.js'
export * from './codes.js'
export * from './types.js'
export * from './schema.js'
export * from './validate.js'
```

- [ ] **Step 5: Убедиться, что typecheck падает только на двух отсутствующих модулях**

Run: `pnpm typecheck`
Expected: FAIL — ровно две ошибки `TS2307` про `./schema.js` и `./validate.js`. Схема и валидатор появятся в Task 3, это ожидаемо. Любая ошибка внутри `version.ts`, `codes.ts` или `types.ts` — настоящий дефект, его надо исправить здесь.

- [ ] **Step 6: Проверить, что объединение действительно различает виды**

Проверка в файле вне репозитория (например в `/tmp`), удалить после. Смысл не в том, что это компилируется, а в том, что **невозможное состояние не компилируется**:

```ts
import type { IrNode } from './types.js'

// Должно быть ошибкой: у frame нет поля text
declare const a: IrNode
if (a.kind === 'frame') {
  // @ts-expect-error у kind:'frame' нет text
  a.text
}

// Должно быть ошибкой: text и image одновременно невыразимы
// @ts-expect-error нельзя иметь оба
const bad: IrNode = { kind: 'text', text: {} as never, image: {} as never } as IrNode

// Исчерпывающий switch должен покрывать все пять видов
const kindOf = (n: IrNode): string => {
  switch (n.kind) {
    case 'frame': return 'frame'
    case 'text': return 'text'
    case 'image': return 'image'
    case 'vector': return 'vector'
    case 'placeholder': return 'placeholder'
  }
}
```

Убедиться, что `@ts-expect-error` не «висят зря»: если бы объединение было неверным, TypeScript пожаловался бы на неиспользуемое подавление. Именно это и есть проверка.

- [ ] **Step 7: Коммит**

```bash
git add packages/ir
git commit -m "feat(ir)!: контракт как размеченное объединение после design-ревью"
```

Тело коммита должно перечислить, что именно изменилось и почему — это ревизия контракта, и через полгода причина должна читаться из истории. Затем пустая строка и трейлер.

---

## Task 3: Валидация IR

Валидатор стоит на входе плагина Figma и обязан отклонять плохой бандл **до** начала построения. Половинчатый импорт — худший из возможных исходов: пользователь не понимает, доверять ли результату.

**Files:**
- Create: `packages/ir/src/schema.ts`, `packages/ir/src/validate.ts`
- Test: `packages/ir/test/validate.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// packages/ir/test/validate.test.ts
import { describe, expect, it } from 'vitest'
import { IR_VERSION, parseBundle, type Bundle } from '../src/index.js'

const emptyNode = {
  id: 'n0',
  sourceTag: 'body',
  name: 'body',
  rect: { x: 0, y: 0, w: 100, h: 100 },
  paintOrder: 0,
  layout: {
    mode: 'none',
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    align: 'start',
    justify: 'start',
    wrap: false,
  },
  style: {
    fills: [],
    stroke: null,
    corner: { tl: 0, tr: 0, br: 0, bl: 0 },
    shadows: [],
    opacity: 1,
    clip: false,
  },
  text: null,
  image: null,
  children: [],
}

const validBundle = {
  version: IR_VERSION,
  capturedAt: '2026-09-19T10:00:00.000Z',
  url: 'https://example.com/',
  title: 'Example',
  userAgent: 'Mozilla/5.0',
  screens: [
    { name: 'Desktop', width: 1440, height: 900, dpr: 1, root: emptyNode, screenshotId: null },
  ],
  assets: [],
  fonts: [],
  tokens: { variables: [], textStyles: [], paintStyles: [] },
  report: [],
}

describe('parseBundle', () => {
  it('принимает валидный бандл и возвращает типизированный объект', () => {
    const result = parseBundle(validBundle)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const bundle: Bundle = result.bundle
    expect(bundle.screens[0]?.width).toBe(1440)
  })

  it('отклоняет бандл с чужой версией IR с внятным сообщением', () => {
    const result = parseBundle({ ...validBundle, version: 999 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('версия IR')
  })

  it('отклоняет бандл со сломанной структурой узла, указывая путь', () => {
    const broken = structuredClone(validBundle)
    // @ts-expect-error намеренно ломаем поле для проверки валидатора
    broken.screens[0].root.rect = { x: 0, y: 0 }
    const result = parseBundle(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('rect')
  })

  it('отклоняет не-объект', () => {
    expect(parseBundle('не бандл').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/ir/test/validate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/index.js"` либо `parseBundle is not a function`.

- [ ] **Step 3: Создать `packages/ir/src/schema.ts`**

```ts
import { z } from 'zod'
import { IR_VERSION } from './version.js'

const rgba = z.object({
  r: z.number().min(0).max(255),
  g: z.number().min(0).max(255),
  b: z.number().min(0).max(255),
  a: z.number().min(0).max(1),
})

const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
const sides = z.object({
  top: z.number(), right: z.number(), bottom: z.number(), left: z.number(),
})
const corner = z.object({
  tl: z.number(), tr: z.number(), br: z.number(), bl: z.number(),
})

const imageFit = z.enum(['fill', 'fit', 'tile'])

const fill = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: rgba }),
  z.object({ kind: z.literal('image'), assetId: z.string(), fit: imageFit }),
])

const stroke = z.object({ color: rgba, weight: sides })

const shadow = z.object({
  kind: z.enum(['outer', 'inner']),
  color: rgba,
  offsetX: z.number(),
  offsetY: z.number(),
  blur: z.number().min(0),
  spread: z.number(),
})

const nodeStyle = z.object({
  fills: z.array(fill),
  stroke: stroke.nullable(),
  corner,
  shadows: z.array(shadow),
  opacity: z.number().min(0).max(1),
  clip: z.boolean(),
})

const nodeLayout = z.object({
  mode: z.enum(['row', 'column', 'none']),
  gap: z.number(),
  padding: sides,
  align: z.enum(['start', 'center', 'end', 'stretch', 'baseline']),
  justify: z.enum([
    'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly',
  ]),
  wrap: z.boolean(),
})

const textRun = z.object({
  text: z.string(),
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontStyle: z.enum(['normal', 'italic']),
  fontSize: z.number(),
  lineHeight: z.number(),
  letterSpacing: z.number(),
  color: rgba,
  decoration: z.enum(['none', 'underline', 'strikethrough']),
  align: z.enum(['left', 'center', 'right', 'justify']),
})

const lineBox = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(), text: z.string(),
})

const nodeText = z.object({ runs: z.array(textRun), lines: z.array(lineBox) })

/** Узел рекурсивен, поэтому объявляется через z.lazy с явным типом. */
export const irNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    sourceTag: z.string(),
    name: z.string(),
    rect,
    paintOrder: z.number(),
    layout: nodeLayout,
    style: nodeStyle,
    text: nodeText.nullable(),
    image: z.object({ assetId: z.string(), fit: imageFit }).nullable(),
    children: z.array(irNodeSchema),
  }),
)

const screen = z.object({
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  dpr: z.number().positive(),
  root: irNodeSchema,
  screenshotId: z.string().nullable(),
})

const diagnostic = z.object({
  level: z.enum(['info', 'warning', 'error']),
  code: z.string(),
  message: z.string(),
  nodeId: z.string().nullable(),
  screen: z.string().nullable(),
})

export const bundleSchema = z.object({
  version: z.literal(IR_VERSION),
  capturedAt: z.string(),
  url: z.string(),
  title: z.string(),
  userAgent: z.string(),
  screens: z.array(screen).min(1),
  assets: z.array(z.object({
    id: z.string(),
    mimeType: z.string(),
    width: z.number(),
    height: z.number(),
    path: z.string(),
  })),
  fonts: z.array(z.object({
    family: z.string(),
    weight: z.number(),
    style: z.enum(['normal', 'italic']),
  })),
  tokens: z.object({
    variables: z.array(z.object({ name: z.string(), value: z.string() })),
    textStyles: z.array(z.object({ name: z.string(), run: textRun })),
    paintStyles: z.array(z.object({ name: z.string(), fill })),
  }),
  report: z.array(diagnostic),
})
```

- [ ] **Step 4: Создать `packages/ir/src/validate.ts`**

```ts
import { bundleSchema } from './schema.js'
import type { Bundle } from './types.js'
import { IR_VERSION } from './version.js'

export type ParseResult =
  | { ok: true; bundle: Bundle }
  | { ok: false; error: string }

/** Версия проверяется до схемы, чтобы несовпадение половин системы давало
 *  понятное сообщение вместо простыни ошибок валидации. */
export const parseBundle = (input: unknown): ParseResult => {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Бандл не является объектом.' }
  }

  const version = (input as { version?: unknown }).version
  if (version !== IR_VERSION) {
    return {
      ok: false,
      error:
        `Несовместимая версия IR: в файле ${String(version)}, ` +
        `эта половина ожидает ${IR_VERSION}. ` +
        `Обнови extension и плагин Figma до одной версии.`,
    }
  }

  const parsed = bundleSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first ? first.path.join('.') : '<корень>'
    const message = first ? first.message : 'неизвестная ошибка'
    return { ok: false, error: `Бандл повреждён в поле "${path}": ${message}` }
  }

  return { ok: true, bundle: parsed.data as Bundle }
}
```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/ir/test/validate.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 6: Проверить typecheck**

Run: `pnpm typecheck`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add packages/ir
git commit -m "feat(ir): zod-валидация бандла с проверкой версии"
```

---

## Task 4: Пакет сериализатора и парсер цвета

Цвет разбирается через быстрый путь для `rgb()`/`rgba()` и через `OffscreenCanvas` для всего остального. Причина: Chrome возвращает из `getComputedStyle` не только `rgb()` — авторские `oklch()`, `color-mix()` и `lab()` доезжают в своём синтаксисе. Растеризация браузером даёт точно тот цвет, который он нарисовал, при любом синтаксисе, включая будущие.

**Files:**
- Create: `packages/serializer/package.json`, `packages/serializer/tsconfig.json`, `packages/serializer/src/css/color.ts`, `packages/serializer/src/css/length.ts`
- Test: `packages/serializer/test/color.test.ts`

- [ ] **Step 1: Создать `packages/serializer/package.json`**

```json
{
  "name": "@h2d/serializer",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "build": "tsup" },
  "dependencies": { "@h2d/ir": "workspace:*" }
}
```

- [ ] **Step 2: Создать `packages/serializer/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../ir" }]
}
```

- [ ] **Step 3: Подключить пакет к typecheck**

Task 1 оставил в корневом `package.json` только `packages/ir`, потому что остальных пакетов не существовало. Теперь сериализатор появился — расширить скрипт:

```json
    "typecheck": "tsc -b packages/ir packages/serializer",
```

Run: `pnpm typecheck`
Expected: FAIL — `packages/serializer/src` пуст, `TS18003: No inputs were found`. Это ожидаемо и уйдёт на Step 7. Если ошибка другая — значит сломан `tsconfig`, и это надо починить сейчас.

- [ ] **Step 4: Написать падающий тест**

```ts
// packages/serializer/test/color.test.ts
import { describe, expect, it } from 'vitest'
import { parseColor, TRANSPARENT } from '../src/css/color.js'
import { parsePx } from '../src/css/length.js'

describe('parseColor', () => {
  it('разбирает rgb()', () => {
    expect(parseColor('rgb(255, 128, 0)')).toEqual({ r: 255, g: 128, b: 0, a: 1 })
  })

  it('разбирает rgba() с дробной альфой', () => {
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })

  it('разбирает современный синтаксис rgb() со слэшем', () => {
    expect(parseColor('rgb(10 20 30 / 0.25)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 })
  })

  it('считает transparent полностью прозрачным', () => {
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual(TRANSPARENT)
  })

  it('возвращает null на нераспознанном значении, когда канвас недоступен', () => {
    expect(parseColor('такого-цвета-нет')).toBeNull()
  })
})

describe('parsePx', () => {
  it('разбирает пиксельные значения', () => {
    expect(parsePx('12px')).toBe(12)
    expect(parsePx('0.5px')).toBe(0.5)
    expect(parsePx('-3px')).toBe(-3)
  })

  it('считает none и auto нулём', () => {
    expect(parsePx('none')).toBe(0)
    expect(parsePx('auto')).toBe(0)
  })

  it('не падает на пустой строке', () => {
    expect(parsePx('')).toBe(0)
  })
})
```

- [ ] **Step 5: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/color.test.ts`
Expected: FAIL — `Failed to resolve import "../src/css/color.js"`.

- [ ] **Step 6: Создать `packages/serializer/src/css/length.ts`**

```ts
/** Computed styles всегда отдают длины в пикселях, поэтому достаточно
 *  вытащить число. `none`, `auto` и пустая строка означают отсутствие. */
export const parsePx = (value: string): number => {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim())
  if (match?.[1] === undefined) return 0
  return Number.parseFloat(match[1])
}
```

- [ ] **Step 7: Создать `packages/serializer/src/css/color.ts`**

```ts
import type { Rgba } from '@h2d/ir'

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }

const RGB_FUNCTIONAL =
  /^rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i

const parseAlpha = (raw: string | undefined): number => {
  if (raw === undefined) return 1
  if (raw.endsWith('%')) return Number.parseFloat(raw) / 100
  return Number.parseFloat(raw)
}

/** Резолв через растеризацию браузером: единственный способ уверенно
 *  разобрать oklch(), color-mix(), lab() и всё, что Chrome добавит позже. */
const resolveViaCanvas = (value: string): Rgba | null => {
  if (typeof OffscreenCanvas === 'undefined') return null
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null

    // Валидность проверяется двумя разными сентинелами: невалидное значение
    // Canvas молча игнорирует, и fillStyle сохраняет каждый сентинел, поэтому
    // результаты расходятся. Валидное значение даёт одинаковый резолв в обоих
    // случаях. Проверка «стало ли чёрным» была бы неверна: цвет может
    // законно резолвиться в чёрный.
    const probe = (sentinel: string): string => {
      ctx.fillStyle = sentinel
      ctx.fillStyle = value
      return String(ctx.fillStyle)
    }
    if (probe('#ff00ff') !== probe('#00ff00')) return null

    ctx.fillStyle = value
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    const r = data[0]
    const g = data[1]
    const b = data[2]
    const a = data[3]
    if (r === undefined || g === undefined || b === undefined || a === undefined) {
      return null
    }
    return { r, g, b, a: Math.round((a / 255) * 1000) / 1000 }
  } catch {
    return null
  }
}

/** Возвращает null, если цвет разобрать не удалось. Вызывающий обязан
 *  породить Diagnostic — молчаливая подстановка чёрного запрещена. */
export const parseColor = (value: string): Rgba | null => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return null
  if (trimmed === 'transparent') return TRANSPARENT

  const m = RGB_FUNCTIONAL.exec(trimmed)
  if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
    return {
      r: Number.parseFloat(m[1]),
      g: Number.parseFloat(m[2]),
      b: Number.parseFloat(m[3]),
      a: parseAlpha(m[4]),
    }
  }

  return resolveViaCanvas(trimmed)
}

export const isInvisible = (color: Rgba): boolean => color.a === 0
```

- [ ] **Step 8: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/color.test.ts`
Expected: PASS, 8 тестов. Тест на нераспознанное значение проходит потому, что в окружении `node` `OffscreenCanvas` отсутствует и функция возвращает `null` — именно то поведение, на которое рассчитан вызывающий код.

- [ ] **Step 9: Проверить typecheck**

Run: `pnpm typecheck`
Expected: без ошибок — теперь в `packages/serializer/src` есть входные файлы.

- [ ] **Step 10: Коммит**

```bash
git add packages/serializer package.json
git commit -m "feat(serializer): парсеры цвета и длины"
```

---

## Task 5: Парсер box-shadow

`box-shadow` в computed style приходит одной строкой с несколькими тенями, произвольным порядком `inset` и цветом либо в начале, либо в конце. Это классический источник тихих ошибок, поэтому парсер изолирован и покрыт тестами на все встречающиеся формы.

**Files:**
- Create: `packages/serializer/src/css/shadow.ts`
- Test: `packages/serializer/test/shadow.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// packages/serializer/test/shadow.test.ts
import { describe, expect, it } from 'vitest'
import { parseBoxShadow } from '../src/css/shadow.js'

describe('parseBoxShadow', () => {
  it('возвращает пустой массив для none', () => {
    expect(parseBoxShadow('none')).toEqual([])
    expect(parseBoxShadow('')).toEqual([])
  })

  it('разбирает одну внешнюю тень с цветом впереди', () => {
    expect(parseBoxShadow('rgba(0, 0, 0, 0.25) 0px 4px 8px 1px')).toEqual([
      {
        kind: 'outer',
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offsetX: 0, offsetY: 4, blur: 8, spread: 1,
      },
    ])
  })

  it('разбирает тень без spread', () => {
    expect(parseBoxShadow('rgb(255, 0, 0) 2px 3px 4px')).toEqual([
      {
        kind: 'outer',
        color: { r: 255, g: 0, b: 0, a: 1 },
        offsetX: 2, offsetY: 3, blur: 4, spread: 0,
      },
    ])
  })

  it('распознаёт inset как внутреннюю тень', () => {
    const result = parseBoxShadow('rgb(0, 0, 0) 0px 1px 2px 0px inset')
    expect(result[0]?.kind).toBe('inner')
  })

  it('разбивает несколько теней по запятой, не ломаясь на запятых внутри rgba()', () => {
    const result = parseBoxShadow(
      'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgba(0, 0, 0, 0.2) 0px 4px 8px 0px',
    )
    expect(result).toHaveLength(2)
    expect(result[1]?.offsetY).toBe(4)
  })

  it('отбрасывает тень с неразбираемым цветом вместо подстановки чёрного', () => {
    expect(parseBoxShadow('нечто 0px 1px 2px')).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/shadow.test.ts`
Expected: FAIL — `Failed to resolve import "../src/css/shadow.js"`.

- [ ] **Step 3: Создать `packages/serializer/src/css/shadow.ts`**

```ts
import type { Shadow } from '@h2d/ir'
import { parseColor } from './color.js'
import { parsePx } from './length.js'

/** Разбивает список теней по запятым верхнего уровня.
 *  Наивный split(',') сломался бы на запятых внутри rgba(). */
const splitTopLevel = (value: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

/** Вырезает цветовую функцию или ключевое слово, возвращая остаток строки. */
const extractColor = (input: string): { color: string; rest: string } => {
  const functional = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^)]*\)/i
  const match = functional.exec(input)
  if (match !== null) {
    return {
      color: match[0],
      rest: (input.slice(0, match.index) + input.slice(match.index + match[0].length)),
    }
  }
  const hex = /#[0-9a-f]{3,8}\b/i.exec(input)
  if (hex !== null) {
    return {
      color: hex[0],
      rest: input.slice(0, hex.index) + input.slice(hex.index + hex[0].length),
    }
  }
  return { color: '', rest: input }
}

const parseOne = (raw: string): Shadow | null => {
  let input = raw.trim()
  if (input === '') return null

  const isInset = /\binset\b/i.test(input)
  input = input.replace(/\binset\b/i, ' ')

  const { color: colorText, rest } = extractColor(input)
  const color = parseColor(colorText)
  if (color === null) return null

  const lengths = rest.trim().split(/\s+/).filter((token) => token !== '')
  const offsetXRaw = lengths[0]
  const offsetYRaw = lengths[1]
  if (offsetXRaw === undefined || offsetYRaw === undefined) return null

  return {
    kind: isInset ? 'inner' : 'outer',
    color,
    offsetX: parsePx(offsetXRaw),
    offsetY: parsePx(offsetYRaw),
    blur: lengths[2] === undefined ? 0 : parsePx(lengths[2]),
    spread: lengths[3] === undefined ? 0 : parsePx(lengths[3]),
  }
}

export const parseBoxShadow = (value: string): Shadow[] => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return []
  const shadows: Shadow[] = []
  for (const part of splitTopLevel(trimmed)) {
    const shadow = parseOne(part)
    if (shadow !== null) shadows.push(shadow)
  }
  return shadows
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/shadow.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): парсер box-shadow"
```

---

## Task 6: Обводки и радиусы

**Files:**
- Create: `packages/serializer/src/css/stroke.ts`, `packages/serializer/src/css/corner.ts`
- Test: `packages/serializer/test/stroke.test.ts`

- [ ] **Step 1: Написать падающий тест**

Тесты работают на plain-объектах, имитирующих `CSSStyleDeclaration`, поэтому браузер не нужен. Хелпер обязан отдавать и camelCase-свойства, и `getPropertyValue` с kebab-именами: `readStroke` читает границы вторым способом, потому что имена сторон в нём вычисляются динамически.

```ts
// packages/serializer/test/stroke.test.ts
import { describe, expect, it } from 'vitest'
import { readStroke } from '../src/css/stroke.js'
import { readCorner } from '../src/css/corner.js'

type FakeStyle = Record<string, string>
const style = (overrides: FakeStyle): CSSStyleDeclaration => {
  const base: FakeStyle = {
    borderTopWidth: '0px', borderRightWidth: '0px',
    borderBottomWidth: '0px', borderLeftWidth: '0px',
    borderTopColor: 'rgb(0, 0, 0)', borderRightColor: 'rgb(0, 0, 0)',
    borderBottomColor: 'rgb(0, 0, 0)', borderLeftColor: 'rgb(0, 0, 0)',
    borderTopStyle: 'solid', borderRightStyle: 'solid',
    borderBottomStyle: 'solid', borderLeftStyle: 'solid',
    borderTopLeftRadius: '0px', borderTopRightRadius: '0px',
    borderBottomRightRadius: '0px', borderBottomLeftRadius: '0px',
  }
  const merged: FakeStyle = { ...base, ...overrides }
  const camel = (kebab: string): string =>
    kebab.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
  return {
    ...merged,
    getPropertyValue: (prop: string): string => merged[camel(prop)] ?? '',
  } as unknown as CSSStyleDeclaration
}

describe('readStroke', () => {
  it('возвращает null при отсутствии границ', () => {
    expect(readStroke(style({}))).toBeNull()
  })

  it('читает равномерную границу', () => {
    const result = readStroke(style({
      borderTopWidth: '2px', borderRightWidth: '2px',
      borderBottomWidth: '2px', borderLeftWidth: '2px',
      borderTopColor: 'rgb(255, 0, 0)', borderRightColor: 'rgb(255, 0, 0)',
      borderBottomColor: 'rgb(255, 0, 0)', borderLeftColor: 'rgb(255, 0, 0)',
    }))
    expect(result).toEqual({
      color: { r: 255, g: 0, b: 0, a: 1 },
      weight: { top: 2, right: 2, bottom: 2, left: 2 },
    })
  })

  it('читает разную толщину по сторонам', () => {
    const result = readStroke(style({
      borderTopWidth: '1px', borderBottomWidth: '4px',
    }))
    expect(result?.weight).toEqual({ top: 1, right: 0, bottom: 4, left: 0 })
  })

  it('игнорирует границы со style: none, даже если ширина задана', () => {
    const result = readStroke(style({
      borderTopWidth: '3px', borderTopStyle: 'none',
    }))
    expect(result).toBeNull()
  })

  it('берёт цвет первой видимой стороны', () => {
    const result = readStroke(style({
      borderBottomWidth: '2px', borderBottomColor: 'rgb(0, 0, 255)',
    }))
    expect(result?.color).toEqual({ r: 0, g: 0, b: 255, a: 1 })
  })
})

describe('readCorner', () => {
  it('читает нулевые радиусы', () => {
    expect(readCorner(style({}))).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 })
  })

  it('читает разные радиусы по углам', () => {
    const result = readCorner(style({
      borderTopLeftRadius: '8px', borderBottomRightRadius: '16px',
    }))
    expect(result).toEqual({ tl: 8, tr: 0, br: 16, bl: 0 })
  })

  it('берёт горизонтальный радиус у эллиптического угла', () => {
    expect(readCorner(style({ borderTopLeftRadius: '10px 20px' })).tl).toBe(10)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/stroke.test.ts`
Expected: FAIL — `Failed to resolve import "../src/css/stroke.js"`.

- [ ] **Step 3: Создать `packages/serializer/src/css/corner.ts`**

```ts
import type { Corner } from '@h2d/ir'
import { parsePx } from './length.js'

/** Эллиптический угол задаётся двумя значениями через пробел.
 *  Figma поддерживает только круглый радиус, поэтому берём горизонтальный
 *  и оставляем расхождение на усмотрение отчёта вызывающего. */
const firstRadius = (value: string): number => {
  const first = value.trim().split(/\s+/)[0]
  return first === undefined ? 0 : parsePx(first)
}

export const readCorner = (cs: CSSStyleDeclaration): Corner => ({
  tl: firstRadius(cs.borderTopLeftRadius),
  tr: firstRadius(cs.borderTopRightRadius),
  br: firstRadius(cs.borderBottomRightRadius),
  bl: firstRadius(cs.borderBottomLeftRadius),
})

export const isEllipticalCorner = (cs: CSSStyleDeclaration): boolean =>
  [
    cs.borderTopLeftRadius, cs.borderTopRightRadius,
    cs.borderBottomRightRadius, cs.borderBottomLeftRadius,
  ].some((value) => value.trim().split(/\s+/).length > 1)
```

- [ ] **Step 4: Создать `packages/serializer/src/css/stroke.ts`**

```ts
import type { Stroke } from '@h2d/ir'
import { parseColor } from './color.js'
import { parsePx } from './length.js'

type Side = 'Top' | 'Right' | 'Bottom' | 'Left'
const SIDES: readonly Side[] = ['Top', 'Right', 'Bottom', 'Left']

const widthOf = (cs: CSSStyleDeclaration, side: Side): number => {
  const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`)
  if (style === 'none' || style === 'hidden') return 0
  return parsePx(cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
}

/** Figma поддерживает разную толщину обводки по сторонам, но только один
 *  цвет на узел. Берём цвет первой видимой стороны; расхождение по цветам
 *  сторон фиксирует вызывающий через Diagnostic. */
export const readStroke = (cs: CSSStyleDeclaration): Stroke | null => {
  const weight = {
    top: widthOf(cs, 'Top'),
    right: widthOf(cs, 'Right'),
    bottom: widthOf(cs, 'Bottom'),
    left: widthOf(cs, 'Left'),
  }
  if (weight.top === 0 && weight.right === 0 && weight.bottom === 0 && weight.left === 0) {
    return null
  }

  for (const side of SIDES) {
    if (widthOf(cs, side) === 0) continue
    const color = parseColor(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
    if (color !== null && color.a > 0) return { color, weight }
  }
  return null
}

export const hasMixedBorderColors = (cs: CSSStyleDeclaration): boolean => {
  const visible = SIDES.filter((side) => widthOf(cs, side) > 0)
  const colors = new Set(
    visible.map((side) => cs.getPropertyValue(`border-${side.toLowerCase()}-color`)),
  )
  return colors.size > 1
}
```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/stroke.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 6: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): чтение обводок и радиусов углов"
```

---

## Task 7: Резолвер порядка отрисовки

Самый сложный алгоритм плана и самая частая причина «импортировалось, но всё перекрыто не тем». Порядок слоёв в Figma должен воспроизводить порядок отрисовки браузера, который определяется stacking contexts и `z-index`, а не порядком в DOM.

Функция намеренно не знает про DOM: она принимает дерево структур `LayoutProbe`, что делает её полностью тестируемой без браузера.

**Files:**
- Create: `packages/serializer/src/probe.ts`, `packages/serializer/src/stacking.ts`
- Test: `packages/serializer/test/stacking.test.ts`

- [ ] **Step 1: Создать `packages/serializer/src/probe.ts`**

```ts
/** Минимальный набор свойств, влияющих на участие узла в стекинге.
 *  Отделён от DOM ради тестируемости резолвера. */
export type LayoutProbe = {
  id: string
  position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
  zIndex: number | 'auto'
  opacity: number
  hasTransform: boolean
  hasFilter: boolean
  hasMixBlendMode: boolean
  isIsolated: boolean
  isFloat: boolean
  isInline: boolean
  parentIsFlexOrGrid: boolean
  children: LayoutProbe[]
}

export const readProbe = (
  el: Element,
  cs: CSSStyleDeclaration,
  parentCs: CSSStyleDeclaration | null,
): Omit<LayoutProbe, 'children'> => {
  const zIndexRaw = cs.zIndex
  const parentDisplay = parentCs === null ? '' : parentCs.display
  return {
    id: '',
    position: cs.position as LayoutProbe['position'],
    zIndex: zIndexRaw === 'auto' ? 'auto' : Number.parseInt(zIndexRaw, 10),
    opacity: Number.parseFloat(cs.opacity),
    hasTransform: cs.transform !== 'none',
    hasFilter: cs.filter !== 'none' || cs.backdropFilter !== 'none',
    hasMixBlendMode: cs.mixBlendMode !== 'normal',
    isIsolated: cs.isolation === 'isolate' || cs.contain.includes('paint'),
    isFloat: cs.float !== 'none',
    isInline: cs.display.startsWith('inline'),
    parentIsFlexOrGrid: /flex|grid/.test(parentDisplay),
  }
}
```

- [ ] **Step 2: Написать падающий тест**

```ts
// packages/serializer/test/stacking.test.ts
import { describe, expect, it } from 'vitest'
import { establishesStackingContext, resolvePaintOrder } from '../src/stacking.js'
import type { LayoutProbe } from '../src/probe.js'

const probe = (id: string, overrides: Partial<LayoutProbe> = {}): LayoutProbe => ({
  id,
  position: 'static',
  zIndex: 'auto',
  opacity: 1,
  hasTransform: false,
  hasFilter: false,
  hasMixBlendMode: false,
  isIsolated: false,
  isFloat: false,
  isInline: false,
  parentIsFlexOrGrid: false,
  children: [],
  ...overrides,
})

const orderOf = (root: LayoutProbe): string[] => {
  const map = resolvePaintOrder(root)
  return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
}

describe('establishesStackingContext', () => {
  it('позиционированный узел с числовым z-index — создаёт', () => {
    expect(establishesStackingContext(probe('a', { position: 'relative', zIndex: 0 }))).toBe(true)
  })

  it('позиционированный узел с z-index: auto — не создаёт', () => {
    expect(establishesStackingContext(probe('a', { position: 'relative' }))).toBe(false)
  })

  it('opacity меньше единицы — создаёт', () => {
    expect(establishesStackingContext(probe('a', { opacity: 0.5 }))).toBe(true)
  })

  it('transform — создаёт', () => {
    expect(establishesStackingContext(probe('a', { hasTransform: true }))).toBe(true)
  })

  it('position: fixed — создаёт всегда, даже с auto', () => {
    expect(establishesStackingContext(probe('a', { position: 'fixed' }))).toBe(true)
  })

  it('flex-ребёнок с z-index — создаёт, несмотря на position: static', () => {
    expect(establishesStackingContext(
      probe('a', { zIndex: 1, parentIsFlexOrGrid: true }),
    )).toBe(true)
  })
})

describe('resolvePaintOrder', () => {
  it('сохраняет порядок DOM для обычных потоковых узлов', () => {
    const root = probe('root', { children: [probe('a'), probe('b'), probe('c')] })
    expect(orderOf(root)).toEqual(['root', 'a', 'b', 'c'])
  })

  it('кладёт отрицательный z-index под фон родителя по документу, но после самого родителя', () => {
    const root = probe('root', {
      children: [
        probe('flow'),
        probe('under', { position: 'relative', zIndex: -1 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'under', 'flow'])
  })

  it('кладёт положительный z-index поверх потока, независимо от порядка DOM', () => {
    const root = probe('root', {
      children: [
        probe('over', { position: 'relative', zIndex: 5 }),
        probe('flow'),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'flow', 'over'])
  })

  it('сортирует положительные z-index по возрастанию', () => {
    const root = probe('root', {
      children: [
        probe('high', { position: 'relative', zIndex: 10 }),
        probe('low', { position: 'relative', zIndex: 2 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'low', 'high'])
  })

  it('при равном z-index сохраняет порядок DOM', () => {
    const root = probe('root', {
      children: [
        probe('first', { position: 'relative', zIndex: 3 }),
        probe('second', { position: 'relative', zIndex: 3 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'first', 'second'])
  })

  it('изолирует z-index внутри вложенного stacking context', () => {
    // 'inner' имеет z-index 999, но он внутри контекста 'ctx' с z-index 1,
    // поэтому не может перекрыть 'sibling' с z-index 2.
    const root = probe('root', {
      children: [
        probe('ctx', {
          position: 'relative',
          zIndex: 1,
          children: [probe('inner', { position: 'relative', zIndex: 999 })],
        }),
        probe('sibling', { position: 'relative', zIndex: 2 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'ctx', 'inner', 'sibling'])
  })

  it('позиционированные с auto красятся после потоковых', () => {
    const root = probe('root', {
      children: [
        probe('positioned', { position: 'absolute' }),
        probe('flow'),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'flow', 'positioned'])
  })

  it('присваивает каждому узлу уникальный индекс', () => {
    const root = probe('root', {
      children: [probe('a', { children: [probe('b')] }), probe('c')],
    })
    const values = [...resolvePaintOrder(root).values()]
    expect(new Set(values).size).toBe(values.length)
  })
})
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/stacking.test.ts`
Expected: FAIL — `Failed to resolve import "../src/stacking.js"`.

- [ ] **Step 4: Создать `packages/serializer/src/stacking.ts`**

```ts
import type { LayoutProbe } from './probe.js'

const isPositioned = (p: LayoutProbe): boolean => p.position !== 'static'

/** Условия создания stacking context по CSS Positioned Layout и Compositing.
 *  Реализован практически доминирующий набор триггеров; редкие
 *  (`will-change`, `contain: layout` в сочетаниях, `perspective`)
 *  не учитываются и фиксируются вызывающим как Diagnostic. */
export const establishesStackingContext = (p: LayoutProbe): boolean => {
  if (p.position === 'fixed' || p.position === 'sticky') return true
  if (isPositioned(p) && p.zIndex !== 'auto') return true
  if (p.parentIsFlexOrGrid && p.zIndex !== 'auto') return true
  if (p.opacity < 1) return true
  if (p.hasTransform) return true
  if (p.hasFilter) return true
  if (p.hasMixBlendMode) return true
  if (p.isIsolated) return true
  return false
}

type Bucket = 'negative' | 'flow' | 'float' | 'inline' | 'auto' | 'positive'

const bucketOf = (p: LayoutProbe): Bucket => {
  const z = p.zIndex
  if (typeof z === 'number' && z < 0 && (isPositioned(p) || p.parentIsFlexOrGrid)) {
    return 'negative'
  }
  if (typeof z === 'number' && z > 0 && (isPositioned(p) || p.parentIsFlexOrGrid)) {
    return 'positive'
  }
  if (isPositioned(p)) return 'auto'
  if (typeof z === 'number' && z === 0) return 'auto'
  if (p.isFloat) return 'float'
  if (p.isInline) return 'inline'
  return 'flow'
}

const zValue = (p: LayoutProbe): number => (p.zIndex === 'auto' ? 0 : p.zIndex)

/** Стабильная сортировка по z-index: при равных значениях сохраняется
 *  порядок DOM, как того требует спецификация. */
const byZIndex = (items: LayoutProbe[]): LayoutProbe[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => zValue(a.item) - zValue(b.item) || a.index - b.index)
    .map(({ item }) => item)

/**
 * Порядок отрисовки внутри stacking context, по CSS 2.1 Appendix E:
 * сам элемент → отрицательные контексты → потоковые блоки → флоаты →
 * инлайны → позиционированные с auto/0 → положительные контексты.
 *
 * Возвращает Map id → индекс отрисовки. Индексы плотные и уникальные.
 */
export const resolvePaintOrder = (root: LayoutProbe): Map<string, number> => {
  const order = new Map<string, number>()
  let counter = 0

  const emit = (p: LayoutProbe): void => {
    order.set(p.id, counter)
    counter += 1
  }

  /** Обходит поддерево узла, который НЕ создаёт собственный stacking context:
   *  его дети участвуют в стекинге ближайшего предка-контекста. */
  const collect = (p: LayoutProbe, groups: Record<Bucket, LayoutProbe[]>): void => {
    for (const child of p.children) {
      groups[bucketOf(child)].push(child)
    }
  }

  const paintContext = (context: LayoutProbe): void => {
    emit(context)

    const groups: Record<Bucket, LayoutProbe[]> = {
      negative: [], flow: [], float: [], inline: [], auto: [], positive: [],
    }
    collect(context, groups)

    const paintSubtree = (node: LayoutProbe): void => {
      if (establishesStackingContext(node)) {
        paintContext(node)
        return
      }
      emit(node)
      const nested: Record<Bucket, LayoutProbe[]> = {
        negative: [], flow: [], float: [], inline: [], auto: [], positive: [],
      }
      collect(node, nested)
      for (const child of byZIndex(nested.negative)) paintSubtree(child)
      for (const child of nested.flow) paintSubtree(child)
      for (const child of nested.float) paintSubtree(child)
      for (const child of nested.inline) paintSubtree(child)
      for (const child of byZIndex(nested.auto)) paintSubtree(child)
      for (const child of byZIndex(nested.positive)) paintSubtree(child)
    }

    for (const child of byZIndex(groups.negative)) paintSubtree(child)
    for (const child of groups.flow) paintSubtree(child)
    for (const child of groups.float) paintSubtree(child)
    for (const child of groups.inline) paintSubtree(child)
    for (const child of byZIndex(groups.auto)) paintSubtree(child)
    for (const child of byZIndex(groups.positive)) paintSubtree(child)
  }

  paintContext(root)
  return order
}
```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/stacking.test.ts`
Expected: PASS, 15 тестов.

- [ ] **Step 6: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): резолвер порядка отрисовки по правилам CSS-стекинга"
```

---

## Task 8: Чтение раскладки

**Files:**
- Create: `packages/serializer/src/layout.ts`
- Test: `packages/serializer/test/layout.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// packages/serializer/test/layout.test.ts
import { describe, expect, it } from 'vitest'
import { readLayout } from '../src/layout.js'

type FakeStyle = Record<string, string>
const style = (overrides: FakeStyle): CSSStyleDeclaration => {
  const base: FakeStyle = {
    display: 'block',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    rowGap: 'normal',
    columnGap: 'normal',
    alignItems: 'normal',
    justifyContent: 'normal',
    paddingTop: '0px', paddingRight: '0px',
    paddingBottom: '0px', paddingLeft: '0px',
  }
  return { ...base, ...overrides } as unknown as CSSStyleDeclaration
}

describe('readLayout', () => {
  it('для block возвращает mode none', () => {
    expect(readLayout(style({})).mode).toBe('none')
  })

  it('flex row даёт mode row', () => {
    expect(readLayout(style({ display: 'flex' })).mode).toBe('row')
  })

  it('flex column даёт mode column', () => {
    expect(readLayout(style({ display: 'flex', flexDirection: 'column' })).mode)
      .toBe('column')
  })

  it('обратные направления сводятся к оси, порядок детей меняет обходчик', () => {
    expect(readLayout(style({ display: 'flex', flexDirection: 'row-reverse' })).mode)
      .toBe('row')
    expect(readLayout(style({ display: 'flex', flexDirection: 'column-reverse' })).mode)
      .toBe('column')
  })

  it('grid трактуется как column: Figma не имеет двумерного auto-layout', () => {
    expect(readLayout(style({ display: 'grid' })).mode).toBe('column')
  })

  it('берёт gap по главной оси', () => {
    const row = readLayout(style({ display: 'flex', columnGap: '12px', rowGap: '4px' }))
    expect(row.gap).toBe(12)
    const col = readLayout(style({
      display: 'flex', flexDirection: 'column', columnGap: '12px', rowGap: '4px',
    }))
    expect(col.gap).toBe(4)
  })

  it('normal gap считается нулём', () => {
    expect(readLayout(style({ display: 'flex' })).gap).toBe(0)
  })

  it('читает padding', () => {
    const result = readLayout(style({ paddingTop: '8px', paddingLeft: '16px' }))
    expect(result.padding).toEqual({ top: 8, right: 0, bottom: 0, left: 16 })
  })

  it('маппит align-items и justify-content', () => {
    const result = readLayout(style({
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }))
    expect(result.align).toBe('center')
    expect(result.justify).toBe('space-between')
  })

  it('normal align трактуется как stretch для flex', () => {
    expect(readLayout(style({ display: 'flex' })).align).toBe('stretch')
  })

  it('читает wrap', () => {
    expect(readLayout(style({ display: 'flex', flexWrap: 'wrap' })).wrap).toBe(true)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/layout.test.ts`
Expected: FAIL — `Failed to resolve import "../src/layout.js"`.

- [ ] **Step 3: Создать `packages/serializer/src/layout.ts`**

```ts
import type { LayoutAlign, LayoutJustify, LayoutMode, NodeLayout } from '@h2d/ir'
import { parsePx } from './css/length.js'

const gapValue = (value: string): number => (value === 'normal' ? 0 : parsePx(value))

const ALIGN_MAP: Record<string, LayoutAlign> = {
  'flex-start': 'start',
  start: 'start',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  stretch: 'stretch',
  baseline: 'baseline',
}

const JUSTIFY_MAP: Record<string, LayoutJustify> = {
  'flex-start': 'start',
  start: 'start',
  normal: 'start',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  'space-between': 'space-between',
  'space-around': 'space-around',
  'space-evenly': 'space-evenly',
}

/** Figma не имеет двумерного auto-layout, поэтому grid сводится к колонке.
 *  Расхождение фиксирует вызывающий через Diagnostic. */
const modeOf = (cs: CSSStyleDeclaration): LayoutMode => {
  const display = cs.display
  if (display === 'grid' || display === 'inline-grid') return 'column'
  if (display !== 'flex' && display !== 'inline-flex') return 'none'
  return cs.flexDirection.startsWith('column') ? 'column' : 'row'
}

export const readLayout = (cs: CSSStyleDeclaration): NodeLayout => {
  const mode = modeOf(cs)
  const gap = mode === 'column' ? gapValue(cs.rowGap) : gapValue(cs.columnGap)
  const alignRaw = cs.alignItems
  const align: LayoutAlign =
    alignRaw === 'normal'
      ? (mode === 'none' ? 'start' : 'stretch')
      : (ALIGN_MAP[alignRaw] ?? 'start')

  return {
    mode,
    gap,
    padding: {
      top: parsePx(cs.paddingTop),
      right: parsePx(cs.paddingRight),
      bottom: parsePx(cs.paddingBottom),
      left: parsePx(cs.paddingLeft),
    },
    align,
    justify: JUSTIFY_MAP[cs.justifyContent] ?? 'start',
    wrap: cs.flexWrap.startsWith('wrap'),
  }
}

export const isReversed = (cs: CSSStyleDeclaration): boolean =>
  cs.flexDirection.endsWith('-reverse')
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/layout.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): чтение flex- и grid-раскладки"
```

---

## Task 9: Диагностика

Реализация правила «молчаливый fallback — это баг». Каждое место, где сериализатор чего-то не умеет, обязано позвать сюда.

**Files:**
- Create: `packages/serializer/src/diagnostics.ts`
- Test: `packages/serializer/test/diagnostics.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// packages/serializer/test/diagnostics.test.ts
import { describe, expect, it } from 'vitest'
import { DiagnosticSink, DIAGNOSTIC_CODES } from '../src/diagnostics.js'

describe('DiagnosticSink', () => {
  it('начинается пустым', () => {
    expect(new DiagnosticSink('Desktop').drain()).toEqual([])
  })

  it('записывает диагностику с именем экрана', () => {
    const sink = new DiagnosticSink('Mobile')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'canvas не переносится', 'n7')
    expect(sink.drain()).toEqual([
      {
        level: 'warning',
        code: 'unsupported.canvas',
        message: 'canvas не переносится',
        nodeId: 'n7',
        screen: 'Mobile',
      },
    ])
  })

  it('дедуплицирует одинаковые записи по коду и узлу', () => {
    const sink = new DiagnosticSink('Desktop')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n1')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'два', 'n1')
    expect(sink.drain()).toHaveLength(1)
  })

  it('не дедуплицирует один код на разных узлах', () => {
    const sink = new DiagnosticSink('Desktop')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n1')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n2')
    expect(sink.drain()).toHaveLength(2)
  })

  it('drain не разрушает накопленное — отчёт можно прочитать дважды', () => {
    const sink = new DiagnosticSink('Desktop')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid сведён в колонку', 'n1')
    expect(sink.drain()).toHaveLength(1)
    expect(sink.drain()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/diagnostics.test.ts`
Expected: FAIL — `Failed to resolve import "../src/diagnostics.js"`.

- [ ] **Step 3: Создать `packages/serializer/src/diagnostics.ts`**

```ts
import type { Diagnostic, DiagnosticLevel } from '@h2d/ir'

/** Коды стабильны: на них ссылается UI отчёта в плагине Figma и тесты. */
export const DIAGNOSTIC_CODES = {
  unsupportedCanvas: 'unsupported.canvas',
  unsupportedCrossOriginIframe: 'unsupported.cross-origin-iframe',
  unsupportedClosedShadowRoot: 'unsupported.closed-shadow-root',
  unsupportedClipPath: 'unsupported.clip-path',
  unsupportedFilter: 'unsupported.filter',
  unsupportedTransform3d: 'unsupported.transform-3d',
  unsupportedRepeatingGradient: 'unsupported.repeating-gradient',
  colorUnparsed: 'fidelity.color-unparsed',
  gridFlattened: 'fidelity.grid-flattened',
  ellipticalCorner: 'fidelity.elliptical-corner',
  mixedBorderColors: 'fidelity.mixed-border-colors',
  stickyFlattened: 'fidelity.sticky-flattened',
} as const

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES]

export class DiagnosticSink {
  private readonly items: Diagnostic[] = []
  private readonly seen = new Set<string>()

  constructor(private readonly screen: string) {}

  report(
    level: DiagnosticLevel,
    code: DiagnosticCode,
    message: string,
    nodeId: string | null,
  ): void {
    const key = `${code}|${nodeId ?? ''}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.items.push({ level, code, message, nodeId, screen: this.screen })
  }

  drain(): Diagnostic[] {
    return [...this.items]
  }
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/diagnostics.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): сборщик диагностики с дедупликацией"
```

---

## Task 10: Чтение текста

Текст снимается построчно через `Range.getClientRects()`, потому что Figma переносит строки сама и почти наверняка иначе, чем браузер. Тест требует настоящего DOM, поэтому выполняется в Playwright в Task 13, а здесь пишется только реализация — с явной проверкой на следующем шаге.

**Files:**
- Create: `packages/serializer/src/text.ts`

- [ ] **Step 1: Создать `packages/serializer/src/text.ts`**

```ts
import type { NodeText, TextAlign, TextDecoration, TextRun } from '@h2d/ir'
import { parseColor } from './css/color.js'
import { parsePx } from './css/length.js'

const ALIGN_MAP: Record<string, TextAlign> = {
  left: 'left', start: 'left',
  center: 'center',
  right: 'right', end: 'right',
  justify: 'justify',
}

const decorationOf = (cs: CSSStyleDeclaration): TextDecoration => {
  const line = cs.textDecorationLine
  if (line.includes('underline')) return 'underline'
  if (line.includes('line-through')) return 'strikethrough'
  return 'none'
}

/** `line-height: normal` не имеет численного значения в computed style.
 *  Множитель 1.2 — то, что использует Chrome для большинства шрифтов;
 *  точное значение восстанавливается из боксов строк ниже. */
const lineHeightOf = (cs: CSSStyleDeclaration, fontSize: number): number => {
  if (cs.lineHeight === 'normal') return Math.round(fontSize * 1.2 * 100) / 100
  return parsePx(cs.lineHeight)
}

const firstFamily = (value: string): string => {
  const first = value.split(',')[0]
  if (first === undefined) return 'sans-serif'
  return first.trim().replace(/^["']|["']$/g, '')
}

const weightOf = (cs: CSSStyleDeclaration): number => {
  const parsed = Number.parseInt(cs.fontWeight, 10)
  return Number.isNaN(parsed) ? 400 : parsed
}

/** Собирает боксы строк для всех прямых текстовых детей элемента.
 *  Даёт реальные места переносов, сделанных браузером. */
const readLines = (
  el: Element,
  scrollX: number,
  scrollY: number,
): NodeText['lines'] => {
  const lines: NodeText['lines'] = []
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const content = node.textContent
    if (content === null || content.trim() === '') continue

    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = [...range.getClientRects()].filter(
      (rect) => rect.width > 0 && rect.height > 0,
    )

    // Текст строки восстанавливается посимвольным сопоставлением с боксами:
    // это единственный надёжный способ узнать, где именно лёг перенос.
    let cursor = 0
    for (const rect of rects) {
      const text = sliceForRect(node, rect, cursor)
      cursor += text.length
      lines.push({
        x: rect.left + scrollX,
        y: rect.top + scrollY,
        w: rect.width,
        h: rect.height,
        text,
      })
    }
    range.detach()
  }
  return lines
}

/** Находит подстроку, попадающую в данный бокс строки, двигая границу Range
 *  посимвольно от позиции `from`. */
const sliceForRect = (node: ChildNode, rect: DOMRect, from: number): string => {
  const full = node.textContent ?? ''
  const probe = document.createRange()
  let end = from
  while (end < full.length) {
    probe.setStart(node, from)
    probe.setEnd(node, end + 1)
    const candidate = probe.getBoundingClientRect()
    if (candidate.bottom > rect.bottom + 0.5) break
    end += 1
  }
  probe.detach()
  return full.slice(from, end)
}

export const readText = (
  el: Element,
  cs: CSSStyleDeclaration,
  scrollX: number,
  scrollY: number,
): NodeText | null => {
  const hasDirectText = [...el.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  )
  if (!hasDirectText) return null

  const fontSize = parsePx(cs.fontSize)
  const color = parseColor(cs.color)
  const run: TextRun = {
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    fontFamily: firstFamily(cs.fontFamily),
    fontWeight: weightOf(cs),
    fontStyle: cs.fontStyle === 'italic' ? 'italic' : 'normal',
    fontSize,
    lineHeight: lineHeightOf(cs, fontSize),
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : parsePx(cs.letterSpacing),
    color: color ?? { r: 0, g: 0, b: 0, a: 1 },
    decoration: decorationOf(cs),
    align: ALIGN_MAP[cs.textAlign] ?? 'left',
  }

  const lines = readLines(el, scrollX, scrollY)
  if (lines.length === 0) return null
  return { runs: [run], lines }
}

export const hasUnparsedColor = (cs: CSSStyleDeclaration): boolean =>
  parseColor(cs.color) === null
```

- [ ] **Step 2: Проверить typecheck**

Run: `pnpm typecheck`
Expected: без ошибок. Поведение проверяется в настоящем браузере в Task 13 — юнит-тест здесь был бы тестом на мок `getClientRects`, то есть тестом собственного мока.

- [ ] **Step 3: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): чтение текста с реальными боксами строк"
```

---

## Task 11: Обход DOM и сериализация экрана

**Files:**
- Create: `packages/serializer/src/walk.ts`, `packages/serializer/src/serialize.ts`, `packages/serializer/src/index.ts`, `packages/serializer/src/global.ts`, `packages/serializer/tsup.config.ts`

- [ ] **Step 1: Создать `packages/serializer/src/walk.ts`**

```ts
import type { Fill, IrNode, NodeStyle } from '@h2d/ir'
import { isInvisible, parseColor } from './css/color.js'
import { isEllipticalCorner, readCorner } from './css/corner.js'
import { hasMixedBorderColors, readStroke } from './css/stroke.js'
import { parseBoxShadow } from './css/shadow.js'
import { DIAGNOSTIC_CODES, type DiagnosticSink } from './diagnostics.js'
import { isReversed, readLayout } from './layout.js'
import { readProbe, type LayoutProbe } from './probe.js'
import { resolvePaintOrder } from './stacking.js'
import { readText } from './text.js'

type WalkContext = {
  sink: DiagnosticSink
  scrollX: number
  scrollY: number
  nextId: () => string
}

/** Элементы, которые не рисуются и не должны попадать в макет. */
const SKIPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'BR',
])

const isRendered = (el: Element, cs: CSSStyleDeclaration): boolean => {
  if (SKIPPED_TAGS.has(el.tagName)) return false
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

const readFills = (cs: CSSStyleDeclaration, sink: DiagnosticSink, id: string): Fill[] => {
  const background = parseColor(cs.backgroundColor)
  if (background === null) {
    sink.report(
      'warning',
      DIAGNOSTIC_CODES.colorUnparsed,
      `Не удалось разобрать background-color: "${cs.backgroundColor}"`,
      id,
    )
    return []
  }
  if (isInvisible(background)) return []
  return [{ kind: 'solid', color: background }]
}

const readStyle = (
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): NodeStyle => {
  if (isEllipticalCorner(cs)) {
    sink.report(
      'info',
      DIAGNOSTIC_CODES.ellipticalCorner,
      'Эллиптический радиус угла сведён к горизонтальному: Figma не имеет эллиптических углов.',
      id,
    )
  }
  if (hasMixedBorderColors(cs)) {
    sink.report(
      'warning',
      DIAGNOSTIC_CODES.mixedBorderColors,
      'Границы разных цветов сведены к одному: Figma держит один цвет обводки на узел.',
      id,
    )
  }
  return {
    fills: readFills(cs, sink, id),
    stroke: readStroke(cs),
    corner: readCorner(cs),
    shadows: parseBoxShadow(cs.boxShadow),
    opacity: Number.parseFloat(cs.opacity),
    clip: cs.overflowX === 'hidden' || cs.overflowY === 'hidden'
      || cs.overflowX === 'clip' || cs.overflowY === 'clip',
  }
}

const reportUnsupported = (
  el: Element,
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): void => {
  if (el.tagName === 'CANVAS') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas,
      'Содержимое <canvas> не переносится, вставлена заглушка.', id)
  }
  if (cs.clipPath !== 'none') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedClipPath,
      `clip-path "${cs.clipPath}" не переносится.`, id)
  }
  if (cs.filter !== 'none' && !cs.filter.startsWith('blur')) {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedFilter,
      `filter "${cs.filter}" не переносится: Figma поддерживает только blur.`, id)
  }
  if (cs.transform.startsWith('matrix3d')) {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedTransform3d,
      '3D-трансформа не переносится: в Figma её нет.', id)
  }
  if (cs.position === 'sticky' || cs.position === 'fixed') {
    sink.report('info', DIAGNOSTIC_CODES.stickyFlattened,
      `position: ${cs.position} снят в текущем скролл-положении.`, id)
  }
  if (cs.display === 'grid' || cs.display === 'inline-grid') {
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened,
      'CSS grid сведён к колонке: в Figma нет двумерного auto-layout.', id)
  }
}

type Built = { node: IrNode; probe: LayoutProbe }

const buildNode = (
  el: Element,
  parentCs: CSSStyleDeclaration | null,
  ctx: WalkContext,
): Built | null => {
  const cs = window.getComputedStyle(el)
  if (!isRendered(el, cs)) return null

  const id = ctx.nextId()
  reportUnsupported(el, cs, ctx.sink, id)

  const rect = el.getBoundingClientRect()
  const children: IrNode[] = []
  const childProbes: LayoutProbe[] = []

  const ordered = isReversed(cs) ? [...el.children].reverse() : [...el.children]
  for (const child of ordered) {
    const built = buildNode(child, cs, ctx)
    if (built === null) continue
    children.push(built.node)
    childProbes.push(built.probe)
  }

  const node: IrNode = {
    id,
    sourceTag: el.tagName.toLowerCase(),
    name: el.tagName.toLowerCase(),
    rect: {
      x: rect.left + ctx.scrollX,
      y: rect.top + ctx.scrollY,
      w: rect.width,
      h: rect.height,
    },
    paintOrder: 0,
    layout: readLayout(cs),
    style: readStyle(cs, ctx.sink, id),
    text: readText(el, cs, ctx.scrollX, ctx.scrollY),
    image: null,
    children,
  }

  const probe: LayoutProbe = {
    ...readProbe(el, cs, parentCs),
    id,
    children: childProbes,
  }

  return { node, probe }
}

/** Порядок отрисовки считается вторым проходом: он требует готового дерева. */
const applyPaintOrder = (node: IrNode, order: Map<string, number>): void => {
  node.paintOrder = order.get(node.id) ?? 0
  for (const child of node.children) applyPaintOrder(child, order)
}

export const walkDocument = (sink: DiagnosticSink): IrNode | null => {
  let counter = 0
  const ctx: WalkContext = {
    sink,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    nextId: () => {
      const id = `n${counter}`
      counter += 1
      return id
    },
  }

  const built = buildNode(document.body, null, ctx)
  if (built === null) return null
  applyPaintOrder(built.node, resolvePaintOrder(built.probe))
  return built.node
}
```

- [ ] **Step 2: Создать `packages/serializer/src/serialize.ts`**

```ts
import { IR_VERSION, type Bundle, type Screen } from '@h2d/ir'
import { DiagnosticSink } from './diagnostics.js'
import { walkDocument } from './walk.js'

export type SerializeResult = { screen: Screen; report: Bundle['report'] }

/** Снимает текущее состояние документа как один Screen.
 *  Вызывается по одному разу на каждую ширину — размерами управляет
 *  драйвер в extension, сериализатор про них ничего не знает. */
export const serializeScreen = (name: string): SerializeResult => {
  const sink = new DiagnosticSink(name)
  const root = walkDocument(sink)
  if (root === null) {
    throw new Error('Документ пуст: <body> не отрисован.')
  }
  return {
    screen: {
      name,
      width: window.innerWidth,
      height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
      dpr: window.devicePixelRatio,
      root,
      screenshotId: null,
    },
    report: sink.drain(),
  }
}

export const emptyBundle = (): Bundle => ({
  version: IR_VERSION,
  capturedAt: new Date().toISOString(),
  url: window.location.href,
  title: document.title,
  userAgent: navigator.userAgent,
  screens: [],
  assets: [],
  fonts: [],
  tokens: { variables: [], textStyles: [], paintStyles: [] },
  report: [],
})
```

- [ ] **Step 3: Создать `packages/serializer/src/index.ts`**

```ts
export { serializeScreen, emptyBundle, type SerializeResult } from './serialize.js'
export { DIAGNOSTIC_CODES, DiagnosticSink } from './diagnostics.js'
export { resolvePaintOrder, establishesStackingContext } from './stacking.js'
export { parseColor, TRANSPARENT } from './css/color.js'
export { parseBoxShadow } from './css/shadow.js'
export { readLayout } from './layout.js'
```

- [ ] **Step 4: Создать `packages/serializer/src/global.ts`**

```ts
import { emptyBundle, serializeScreen } from './serialize.js'

/** Точка входа IIFE-бандла: то, что Playwright и extension вызывают
 *  внутри страницы через page.evaluate / executeScript. */
const api = { serializeScreen, emptyBundle }

declare global {
  interface Window {
    __h2d: typeof api
  }
}

window.__h2d = api
```

- [ ] **Step 5: Создать `packages/serializer/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { serializer: 'src/global.ts' },
  format: ['iife'],
  globalName: 'H2DSerializer',
  outExtension: () => ({ js: '.global.js' }),
  target: 'chrome120',
  sourcemap: true,
  clean: true,
  noExternal: ['@h2d/ir'],
})
```

- [ ] **Step 6: Собрать бандл**

Run: `pnpm build:serializer`
Expected: создан `packages/serializer/dist/serializer.global.js`.

- [ ] **Step 7: Проверить typecheck и все юнит-тесты**

Run: `pnpm typecheck && pnpm test:unit`
Expected: без ошибок, все тесты проходят.

- [ ] **Step 8: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): обход DOM, сериализация экрана, IIFE-бандл"
```

---

## Task 12: Референс-рендерер IR → SVG

Замыкает контур проверки и одновременно служит инструментом отладки: открыл бандл, увидел, что сняли, ещё не заходя в Figma.

**Files:**
- Create: `packages/reference-renderer/package.json`, `packages/reference-renderer/tsconfig.json`, `packages/reference-renderer/src/render.ts`, `packages/reference-renderer/src/html.ts`, `packages/reference-renderer/src/index.ts`
- Test: `packages/reference-renderer/test/render.test.ts`

- [ ] **Step 1: Создать `packages/reference-renderer/package.json`**

```json
{
  "name": "@h2d/reference-renderer",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@h2d/ir": "workspace:*" }
}
```

- [ ] **Step 2: Создать `packages/reference-renderer/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../ir" }]
}
```

- [ ] **Step 3: Подключить пакет к корню**

Два изменения в корневом `package.json`. Первое — расширить typecheck до всех трёх пакетов, теперь они все существуют:

```json
    "typecheck": "tsc -b packages/ir packages/serializer packages/reference-renderer",
```

Второе — добавить пакет в корневые `devDependencies`. Это обязательно, иначе `tests/e2e/pixel-diff.spec.ts` из Task 14 не разрешит `@h2d/reference-renderer`:

```json
    "@h2d/reference-renderer": "workspace:*",
```

Run: `pnpm install`
Expected: пакет слинкован, ошибок нет.

- [ ] **Step 4: Написать падающий тест**

```ts
// packages/reference-renderer/test/render.test.ts
import { describe, expect, it } from 'vitest'
import type { IrNode, Screen } from '@h2d/ir'
import { renderScreenToSvg } from '../src/render.js'

const node = (overrides: Partial<IrNode>): IrNode => ({
  id: 'n0',
  sourceTag: 'div',
  name: 'div',
  rect: { x: 0, y: 0, w: 100, h: 50 },
  paintOrder: 0,
  layout: {
    mode: 'none', gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    align: 'start', justify: 'start', wrap: false,
  },
  style: {
    fills: [], stroke: null,
    corner: { tl: 0, tr: 0, br: 0, bl: 0 },
    shadows: [], opacity: 1, clip: false,
  },
  text: null,
  image: null,
  children: [],
  ...overrides,
})

const screen = (root: IrNode): Screen => ({
  name: 'Test', width: 200, height: 100, dpr: 1, root, screenshotId: null,
})

describe('renderScreenToSvg', () => {
  it('задаёт размеры SVG по экрану', () => {
    const svg = renderScreenToSvg(screen(node({})))
    expect(svg).toContain('width="200"')
    expect(svg).toContain('height="100"')
  })

  it('рендерит сплошную заливку как rect с fill', () => {
    const svg = renderScreenToSvg(screen(node({
      style: {
        ...node({}).style,
        fills: [{ kind: 'solid', color: { r: 255, g: 0, b: 0, a: 1 } }],
      },
    })))
    expect(svg).toContain('fill="rgb(255,0,0)"')
    expect(svg).toContain('fill-opacity="1"')
  })

  it('не рендерит rect у узла без заливки, обводки и теней', () => {
    const svg = renderScreenToSvg(screen(node({})))
    expect(svg).not.toContain('<rect')
  })

  it('рендерит радиус углов, когда все углы равны', () => {
    const svg = renderScreenToSvg(screen(node({
      style: {
        ...node({}).style,
        corner: { tl: 8, tr: 8, br: 8, bl: 8 },
        fills: [{ kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }],
      },
    })))
    expect(svg).toContain('rx="8"')
  })

  it('рендерит разные углы через path, а не rect', () => {
    const svg = renderScreenToSvg(screen(node({
      style: {
        ...node({}).style,
        corner: { tl: 8, tr: 0, br: 16, bl: 0 },
        fills: [{ kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }],
      },
    })))
    expect(svg).toContain('<path')
  })

  it('упорядочивает узлы по paintOrder, а не по вложенности', () => {
    const svg = renderScreenToSvg(screen(node({
      id: 'root',
      paintOrder: 0,
      children: [
        node({
          id: 'late', paintOrder: 2,
          style: { ...node({}).style, fills: [{ kind: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } }] },
        }),
        node({
          id: 'early', paintOrder: 1,
          style: { ...node({}).style, fills: [{ kind: 'solid', color: { r: 2, g: 2, b: 2, a: 1 } }] },
        }),
      ],
    })))
    expect(svg.indexOf('rgb(2,2,2)')).toBeLessThan(svg.indexOf('rgb(1,1,1)'))
  })

  it('рендерит каждую строку текста своим элементом text', () => {
    const svg = renderScreenToSvg(screen(node({
      text: {
        runs: [{
          text: 'раз два', fontFamily: 'Inter', fontWeight: 400, fontStyle: 'normal',
          fontSize: 16, lineHeight: 20, letterSpacing: 0,
          color: { r: 0, g: 0, b: 0, a: 1 }, decoration: 'none', align: 'left',
        }],
        lines: [
          { x: 0, y: 0, w: 40, h: 20, text: 'раз' },
          { x: 0, y: 20, w: 40, h: 20, text: 'два' },
        ],
      },
    })))
    expect(svg.match(/<text/g)).toHaveLength(2)
  })

  it('экранирует спецсимволы XML в тексте', () => {
    const svg = renderScreenToSvg(screen(node({
      text: {
        runs: [{
          text: 'a & b', fontFamily: 'Inter', fontWeight: 400, fontStyle: 'normal',
          fontSize: 16, lineHeight: 20, letterSpacing: 0,
          color: { r: 0, g: 0, b: 0, a: 1 }, decoration: 'none', align: 'left',
        }],
        lines: [{ x: 0, y: 0, w: 40, h: 20, text: '<a & b>' }],
      },
    })))
    expect(svg).toContain('&lt;a &amp; b&gt;')
  })
})
```

- [ ] **Step 5: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/reference-renderer/test/render.test.ts`
Expected: FAIL — `Failed to resolve import "../src/render.js"`.

- [ ] **Step 6: Создать `packages/reference-renderer/src/render.ts`**

```ts
import type { Corner, IrNode, Rect, Rgba, Screen, Shadow } from '@h2d/ir'

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const rgb = (color: Rgba): string => `rgb(${color.r},${color.g},${color.b})`

const uniformCorner = (corner: Corner): number | null => {
  if (corner.tl === corner.tr && corner.tr === corner.br && corner.br === corner.bl) {
    return corner.tl
  }
  return null
}

/** Прямоугольник с разными радиусами углов не выражается через <rect rx>,
 *  поэтому строится путь с четырьмя дугами. */
const cornerPath = (rect: Rect, c: Corner): string => {
  const { x, y, w, h } = rect
  return [
    `M ${x + c.tl} ${y}`,
    `H ${x + w - c.tr}`,
    c.tr > 0 ? `A ${c.tr} ${c.tr} 0 0 1 ${x + w} ${y + c.tr}` : '',
    `V ${y + h - c.br}`,
    c.br > 0 ? `A ${c.br} ${c.br} 0 0 1 ${x + w - c.br} ${y + h}` : '',
    `H ${x + c.bl}`,
    c.bl > 0 ? `A ${c.bl} ${c.bl} 0 0 1 ${x} ${y + h - c.bl}` : '',
    `V ${y + c.tl}`,
    c.tl > 0 ? `A ${c.tl} ${c.tl} 0 0 1 ${x + c.tl} ${y}` : '',
    'Z',
  ].filter((segment) => segment !== '').join(' ')
}

const shadowFilter = (id: string, shadows: Shadow[]): string => {
  const outer = shadows.filter((shadow) => shadow.kind === 'outer')
  if (outer.length === 0) return ''
  const parts = outer
    .map((shadow) => {
      const deviation = shadow.blur / 2
      return (
        `<feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" ` +
        `stdDeviation="${deviation}" flood-color="${rgb(shadow.color)}" ` +
        `flood-opacity="${shadow.color.a}"/>`
      )
    })
    .join('')
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts}</filter>`
}

const renderBox = (node: IrNode, defs: string[]): string => {
  const { style, rect } = node
  const solid = style.fills.find((fill) => fill.kind === 'solid')
  const hasShadow = style.shadows.some((shadow) => shadow.kind === 'outer')
  if (solid === undefined && style.stroke === null && !hasShadow) return ''

  const attrs: string[] = []
  if (solid !== undefined && solid.kind === 'solid') {
    attrs.push(`fill="${rgb(solid.color)}"`, `fill-opacity="${solid.color.a}"`)
  } else {
    attrs.push('fill="none"')
  }
  if (style.stroke !== null) {
    // Figma и SVG рисуют обводку по центру пути, CSS — внутрь бокса.
    // Компенсируем половиной толщины, беря максимальную сторону.
    const weight = Math.max(
      style.stroke.weight.top, style.stroke.weight.right,
      style.stroke.weight.bottom, style.stroke.weight.left,
    )
    attrs.push(
      `stroke="${rgb(style.stroke.color)}"`,
      `stroke-opacity="${style.stroke.color.a}"`,
      `stroke-width="${weight}"`,
    )
  }
  if (style.opacity < 1) attrs.push(`opacity="${style.opacity}"`)
  if (hasShadow) {
    const filterId = `shadow-${node.id}`
    defs.push(shadowFilter(filterId, style.shadows))
    attrs.push(`filter="url(#${filterId})"`)
  }

  const uniform = uniformCorner(style.corner)
  if (uniform === null) {
    return `<path d="${cornerPath(rect, style.corner)}" ${attrs.join(' ')}/>`
  }
  const rx = uniform > 0 ? ` rx="${uniform}"` : ''
  return (
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"` +
    `${rx} ${attrs.join(' ')}/>`
  )
}

/** Каждая строка рисуется отдельным <text> по снятому боксу.
 *  Базовая линия ставится через dominant-baseline по низу бокса минус
 *  дескендер, что для одного и того же движка растеризации даёт
 *  совпадение с HTML-рендером. */
const renderText = (node: IrNode): string => {
  if (node.text === null) return ''
  const run = node.text.runs[0]
  if (run === undefined) return ''
  const anchor =
    run.align === 'center' ? 'middle' : run.align === 'right' ? 'end' : 'start'

  return node.text.lines
    .map((line) => {
      const x =
        anchor === 'middle' ? line.x + line.w / 2
        : anchor === 'end' ? line.x + line.w
        : line.x
      return (
        `<text x="${x}" y="${line.y + line.h / 2}" ` +
        `text-anchor="${anchor}" dominant-baseline="central" ` +
        `font-family="${escapeXml(run.fontFamily)}" font-size="${run.fontSize}" ` +
        `font-weight="${run.fontWeight}" font-style="${run.fontStyle}" ` +
        `letter-spacing="${run.letterSpacing}" ` +
        `fill="${rgb(run.color)}" fill-opacity="${run.color.a}" ` +
        `text-rendering="geometricPrecision" ` +
        `xml:space="preserve">${escapeXml(line.text)}</text>`
      )
    })
    .join('')
}

const flatten = (node: IrNode, out: IrNode[]): void => {
  out.push(node)
  for (const child of node.children) flatten(child, out)
}

export const renderScreenToSvg = (screen: Screen): string => {
  const nodes: IrNode[] = []
  flatten(screen.root, nodes)
  nodes.sort((a, b) => a.paintOrder - b.paintOrder)

  const defs: string[] = []
  const body = nodes.map((node) => renderBox(node, defs) + renderText(node)).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" ` +
    `height="${screen.height}" viewBox="0 0 ${screen.width} ${screen.height}">` +
    `<defs>${defs.join('')}</defs>${body}</svg>`
  )
}
```

- [ ] **Step 7: Создать `packages/reference-renderer/src/html.ts`**

```ts
/** Оборачивает SVG в минимальную страницу для скриншота в Playwright.
 *  Обнулённые margin и заданный фон обязательны: иначе диффы поедут
 *  на смещении и на прозрачности. */
export const wrapSvgInHtml = (svg: string, width: number, height: number): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0}
    html,body{width:${width}px;height:${height}px;background:#fff}
    svg{display:block}
  </style></head><body>${svg}</body></html>`
```

- [ ] **Step 8: Создать `packages/reference-renderer/src/index.ts`**

```ts
export { renderScreenToSvg } from './render.js'
export { wrapSvgInHtml } from './html.js'
```

- [ ] **Step 9: Запустить тесты и проверить typecheck**

Run: `pnpm vitest run packages/reference-renderer/test/render.test.ts && pnpm typecheck`
Expected: PASS, 8 тестов, typecheck по трём пакетам без ошибок.

- [ ] **Step 10: Коммит**

```bash
git add packages/reference-renderer package.json pnpm-lock.yaml
git commit -m "feat(reference-renderer): рендер IR в SVG по порядку отрисовки"
```

---

## Task 13: Фикстуры и снапшоты IR в настоящем Chrome

Первый раз, когда сериализатор встречается с настоящим браузером. Тест ходит на `file://` — локальные самодостаточные HTML без внешних ресурсов, поэтому веб-сервер не нужен и на одну точку отказа меньше.

**Files:**
- Create: `fixtures/boxes/index.html`, `fixtures/stacking/index.html`, `fixtures/flex/index.html`, `fixtures/text/index.html`
- Create: `playwright.config.ts`, `tests/e2e/helpers/capture.ts`, `tests/e2e/fidelity.spec.ts`

- [ ] **Step 1: Создать `fixtures/boxes/index.html`**

Шрифт задан системным стеком без внешней загрузки: веб-шрифт сделал бы тест зависимым от сети.

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>boxes</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;font-family:Arial,sans-serif}
  .wrap{padding:24px;display:flex;flex-wrap:wrap;gap:16px;width:100%}
  .plain{width:120px;height:80px;background:#3b82f6}
  .rounded{width:120px;height:80px;background:#ef4444;border-radius:12px}
  .mixed-corner{width:120px;height:80px;background:#22c55e;
    border-radius:20px 0 32px 0}
  .bordered{width:120px;height:80px;background:#fff;border:4px solid #111}
  .uneven-border{width:120px;height:80px;background:#fde68a;
    border-top:2px solid #111;border-bottom:8px solid #111}
  .shadowed{width:120px;height:80px;background:#fff;
    box-shadow:rgba(0,0,0,.35) 0 6px 12px 0}
  .translucent{width:120px;height:80px;background:#000;opacity:.4}
  .clipped{width:120px;height:80px;background:#e2e8f0;overflow:hidden}
  .clipped > i{display:block;width:200px;height:40px;background:#7c3aed}
  /* Chrome отдаёт такой цвет из getComputedStyle в синтаксисе oklch(),
     а не как rgb() — единственный тест канвас-пути в parseColor. */
  .modern-color{width:120px;height:80px;background:oklch(0.62 0.19 29)}
  .inset-shadow{width:120px;height:80px;background:#fff;
    box-shadow:rgba(0,0,0,.45) 0 4px 8px 0 inset}
</style></head>
<body>
  <div class="wrap">
    <div class="plain"></div>
    <div class="rounded"></div>
    <div class="mixed-corner"></div>
    <div class="bordered"></div>
    <div class="uneven-border"></div>
    <div class="shadowed"></div>
    <div class="translucent"></div>
    <div class="clipped"><i></i></div>
    <div class="modern-color"></div>
    <div class="inset-shadow"></div>
  </div>
</body></html>
```

Внутренняя тень добавлена сознательно: рендерер из Task 12 её не рисует (`shadowFilter` берёт только внешние), поэтому pixel-diff на этой фикстуре обязан это обнаружить. Решение о том, реализовать внутренние тени в рендерере или поднять порог с объяснением, принимается в Task 14 Step 6 — но обнаружить расхождение должен тест, а не человек.

- [ ] **Step 2: Создать `fixtures/stacking/index.html`**

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>stacking</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff;font-family:Arial,sans-serif}
  .stage{position:relative;height:320px}
  .b{position:absolute;width:140px;height:140px}
  /* DOM-порядок намеренно противоположен порядку отрисовки */
  .top{left:20px;top:20px;background:#ef4444;z-index:3}
  .mid{left:70px;top:60px;background:#22c55e;z-index:2}
  .bottom{left:120px;top:100px;background:#3b82f6;z-index:1}
  .under{left:170px;top:140px;background:#000;z-index:-1}
  .ctx{position:absolute;left:240px;top:20px;width:160px;height:160px;
    background:#fde68a;z-index:1}
  /* z-index 999 внутри .ctx не может перекрыть .isolated-sibling */
  .inner{position:absolute;left:40px;top:40px;width:160px;height:80px;
    background:#7c3aed;z-index:999}
  .isolated-sibling{position:absolute;left:300px;top:120px;
    width:200px;height:60px;background:#111;z-index:2}
  .flow{width:100%;height:40px;background:#e2e8f0}
</style></head>
<body>
  <div class="stage">
    <div class="b top"></div>
    <div class="b mid"></div>
    <div class="b bottom"></div>
    <div class="b under"></div>
    <div class="ctx"><div class="inner"></div></div>
    <div class="isolated-sibling"></div>
  </div>
  <div class="flow"></div>
</body></html>
```

- [ ] **Step 3: Создать `fixtures/flex/index.html`**

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>flex</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;font-family:Arial,sans-serif}
  .row{display:flex;gap:12px;padding:20px;background:#f1f5f9}
  .col{display:flex;flex-direction:column;gap:8px;padding:16px;background:#e2e8f0}
  .center{display:flex;align-items:center;justify-content:center;
    height:120px;background:#cbd5e1}
  .between{display:flex;justify-content:space-between;padding:12px 24px;
    background:#94a3b8}
  .wrapped{display:flex;flex-wrap:wrap;gap:10px;padding:10px;background:#f8fafc}
  .cell{width:100px;height:60px;background:#0ea5e9}
  .tall{width:80px;height:100px;background:#14b8a6}
  /* при 390px этот блок обязан переехать в колонку */
  @media (max-width:420px){ .row{flex-direction:column} }
</style></head>
<body>
  <div class="row"><div class="cell"></div><div class="cell"></div><div class="cell"></div></div>
  <div class="col"><div class="cell"></div><div class="cell"></div></div>
  <div class="center"><div class="tall"></div></div>
  <div class="between"><div class="cell"></div><div class="cell"></div></div>
  <div class="wrapped">
    <div class="cell"></div><div class="cell"></div><div class="cell"></div>
    <div class="cell"></div><div class="cell"></div><div class="cell"></div>
  </div>
</body></html>
```

- [ ] **Step 4: Создать `fixtures/text/index.html`**

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>text</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff;font-family:Arial,sans-serif;padding:24px}
  p{margin-bottom:16px}
  .narrow{width:260px;font-size:16px;line-height:24px;color:#111}
  .big{font-size:32px;font-weight:700;line-height:40px;color:#0f172a}
  .spaced{font-size:14px;letter-spacing:2px;color:#475569}
  .centered{width:300px;text-align:center;font-size:18px;line-height:28px}
  .right{width:300px;text-align:right;font-size:18px;line-height:28px}
  .underlined{text-decoration:underline;font-size:16px}
</style></head>
<body>
  <p class="big">Заголовок в две строки для проверки переноса</p>
  <p class="narrow">Длинный абзац, который обязан перенестись на несколько
    строк в узкой колонке, чтобы боксы строк были не тривиальными.</p>
  <p class="spaced">РАЗРЯДКА ДВА ПИКСЕЛЯ</p>
  <p class="centered">Текст по центру, тоже в несколько строк для проверки
    привязки анкера</p>
  <p class="right">Текст по правому краю в несколько строк</p>
  <p class="underlined">Подчёркнутая строка</p>
</body></html>
```

- [ ] **Step 5: Создать `playwright.config.ts`**

`deviceScaleFactor: 1` обязателен: при 2 скриншоты браузера и SVG разойдутся по субпиксельному сглаживанию и диффы станут бессмысленными.

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    deviceScaleFactor: 1,
    hasTouch: false,
  },
})
```

- [ ] **Step 6: Создать `tests/e2e/helpers/capture.ts`**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import type { Screen, Diagnostic } from '@h2d/ir'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')

const bundlePath = resolve(
  repoRoot,
  'packages/serializer/dist/serializer.global.js',
)

export const SIZES = [
  { name: 'Desktop XL', width: 1920, height: 1080 },
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Tablet L', width: 1024, height: 1366 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
] as const

export const fixtureUrl = (name: string): string =>
  pathToFileURL(resolve(repoRoot, 'fixtures', name, 'index.html')).href

/** Инжектит собранный сериализатор и вызывает его внутри страницы.
 *  Бандл читается с диска каждый раз, чтобы тест всегда проверял
 *  свежую сборку, а не закешированную. */
export const captureScreen = async (
  page: Page,
  screenName: string,
): Promise<{ screen: Screen; report: Diagnostic[] }> => {
  const source = readFileSync(bundlePath, 'utf8')
  await page.addScriptTag({ content: source })
  await page.evaluate(() => document.fonts.ready)
  return page.evaluate((name) => window.__h2d.serializeScreen(name), screenName)
}
```

- [ ] **Step 7: Написать падающий тест IR-снапшотов**

```ts
// tests/e2e/fidelity.spec.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'

const FIXTURES = ['boxes', 'stacking', 'flex', 'text'] as const

const snapshotPath = (fixture: string, width: number): string =>
  resolve(repoRoot, 'fixtures', fixture, 'ir', `${width}.json`)

/** Снапшот создаётся при первом запуске с UPDATE_SNAPSHOTS=1 и после этого
 *  коммитится. Без флага отсутствие снапшота — провал теста, иначе
 *  регрессия могла бы молча «создать новый эталон». */
const compareSnapshot = (fixture: string, width: number, actual: unknown): void => {
  const file = snapshotPath(fixture, width)
  const serialized = `${JSON.stringify(actual, null, 2)}\n`

  if (process.env['UPDATE_SNAPSHOTS'] === '1') {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, serialized, 'utf8')
    return
  }

  expect(
    existsSync(file),
    `Снапшот IR отсутствует: ${file}. Создай его через UPDATE_SNAPSHOTS=1.`,
  ).toBe(true)
  expect(JSON.parse(serialized)).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}

for (const fixture of FIXTURES) {
  for (const size of SIZES) {
    test(`IR-снапшот: ${fixture} @ ${size.width}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(fixtureUrl(fixture))
      const { screen, report } = await captureScreen(page, size.name)

      expect(screen.width).toBe(size.width)
      expect(screen.root.sourceTag).toBe('body')
      compareSnapshot(fixture, size.width, { screen, report })
    })
  }
}

test('стекинг: порядок отрисовки не совпадает с порядком DOM', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('stacking'))
  const { screen } = await captureScreen(page, 'Desktop')

  const flat: { tag: string; order: number; w: number; h: number }[] = []
  const visit = (node: typeof screen.root): void => {
    flat.push({ tag: node.sourceTag, order: node.paintOrder, w: node.rect.w, h: node.rect.h })
    for (const child of node.children) visit(child)
  }
  visit(screen.root)

  // .under имеет z-index -1 и обязан красится раньше потокового .flow
  const under = flat.find((n) => n.w === 140 && n.h === 140 && n.order > 0)
  expect(under).toBeDefined()

  const orders = flat.map((n) => n.order)
  expect(new Set(orders).size).toBe(orders.length)
})

test('boxes: цвет в синтаксисе oklch() разобран, а не отброшен', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('boxes'))
  const { screen, report } = await captureScreen(page, 'Desktop')

  const wrap = screen.root.children[0]
  expect(wrap).toBeDefined()
  // oklch(0.62 0.19 29) — насыщенный красно-оранжевый: канал r должен
  // заметно преобладать, а сам цвет обязан быть разобран.
  const modern = wrap?.children.find((node) => {
    const fill = node.style.fills[0]
    return fill?.kind === 'solid' && fill.color.r > 180 && fill.color.g < 120
  })
  expect(modern, 'элемент с oklch-цветом должен иметь разобранную заливку').toBeDefined()
  expect(report.filter((item) => item.code === 'fidelity.color-unparsed')).toHaveLength(0)
})

test('flex: на 390px первый ряд превращается в колонку', async ({ page }) => {
  await page.goto(fixtureUrl('flex'))

  await page.setViewportSize({ width: 1440, height: 900 })
  const wide = await captureScreen(page, 'Desktop')
  const wideRow = wide.screen.root.children[0]
  expect(wideRow?.layout.mode).toBe('row')

  await page.setViewportSize({ width: 390, height: 844 })
  const narrow = await captureScreen(page, 'Mobile')
  const narrowRow = narrow.screen.root.children[0]
  expect(narrowRow?.layout.mode).toBe('column')
})

test('text: узкий абзац переносится на несколько строк с разными боксами', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('text'))
  const { screen } = await captureScreen(page, 'Desktop')

  const paragraphs = screen.root.children.filter((node) => node.text !== null)
  expect(paragraphs.length).toBeGreaterThanOrEqual(6)

  const narrow = paragraphs.find((node) => (node.text?.lines.length ?? 0) > 2)
  expect(narrow, 'узкий абзац должен дать больше двух строк').toBeDefined()

  const lines = narrow?.text?.lines ?? []
  const ys = lines.map((line) => line.y)
  expect(new Set(ys).size).toBe(ys.length)
  for (const line of lines) {
    expect(line.text.length).toBeGreaterThan(0)
  }
})
```

- [ ] **Step 8: Запустить тест и убедиться, что он падает по отсутствию снапшотов**

Run: `pnpm build:serializer && pnpm test:e2e`
Expected: FAIL — `Снапшот IR отсутствует: .../fixtures/boxes/ir/1920.json`. Поведенческие тесты стекинга, flex и текста при этом должны пройти: они не зависят от снапшотов.

- [ ] **Step 9: Сгенерировать снапшоты и просмотреть их глазами**

Run: `UPDATE_SNAPSHOTS=1 pnpm test:e2e`
Expected: PASS. Затем открой `fixtures/boxes/ir/1440.json` и проверь вручную: у `.plain` заливка `{r:59,g:130,b:246,a:1}`, у `.rounded` все четыре угла по 12, у `.uneven-border` `weight.top === 2` и `weight.bottom === 8`, у `.translucent` `opacity === 0.4`, у `.clipped` `clip === true`. Это единственная ручная проверка в плане, и она обязательна: снапшот фиксирует поведение, и зафиксировать неверное поведение легко.

- [ ] **Step 10: Перезапустить тесты против закоммиченных снапшотов**

Run: `pnpm test:e2e`
Expected: PASS, все тесты.

- [ ] **Step 11: Убедиться, что проверка типов тестов обрела зубы**

`typecheck:root` подключён к `test` ещё в Task 1, но до этого момента он проверял только `vitest.config.ts` — остальные файлы из его `include` не существовали. Теперь в `tests/` появились настоящие файлы, и проверка впервые что-то значит. Это важно: Vitest и Playwright только стирают типы, они их не проверяют, поэтому без этого шага `any` или обращение к несуществующему полю `IrNode` в тестах прошли бы незамеченными, нарушая правило проекта.

Run: `pnpm typecheck:root`
Expected: без ошибок. Если ошибки есть — это настоящие ошибки типов в тестах, написанных в этой задаче, и их надо исправить, а не обойти.

Дополнительно убедиться, что проверка действительно покрывает новые файлы, а не молча их пропускает: временно добавить в любой файл `tests/e2e/` строку `const probe: number = 'строка'`, запустить `pnpm typecheck:root`, увидеть ошибку, удалить строку. Проверка, которая не падает на заведомой ошибке, — не проверка.

- [ ] **Step 12: Коммит**

```bash
git add fixtures playwright.config.ts tests package.json
git commit -m "test: фикстуры и IR-снапшоты в настоящем Chrome на пяти ширинах"
```

---

## Task 14: Pixel-diff гейт

Замыкание контура. Доказывает, что IR верно описывает то, что нарисовал браузер — а не только то, что IR стабилен между запусками.

**Files:**
- Create: `fixtures/boxes/threshold.json`, `fixtures/stacking/threshold.json`, `fixtures/flex/threshold.json`, `fixtures/text/threshold.json`
- Create: `tests/e2e/helpers/diff.ts`, `tests/e2e/pixel-diff.spec.ts`

- [ ] **Step 1: Создать файлы порогов**

Пороги разные по причине: геометрия должна совпадать почти идеально, а текст растеризуется с сглаживанием и субпиксельным позиционированием, поэтому допуск выше. Порог — это зафиксированное утверждение о точности, а не подгонка под текущий результат.

`fixtures/boxes/threshold.json`:
```json
{ "maxDiffRatio": 0.004, "reason": "только геометрия и сплошные цвета; допуск на сглаживание радиусов и тени" }
```

`fixtures/stacking/threshold.json`:
```json
{ "maxDiffRatio": 0.002, "reason": "сплошные прямоугольники без сглаживания; порядок отрисовки обязан совпадать точно" }
```

`fixtures/flex/threshold.json`:
```json
{ "maxDiffRatio": 0.002, "reason": "сплошные прямоугольники, проверяется корректность геометрии после media query" }
```

`fixtures/text/threshold.json`:
```json
{ "maxDiffRatio": 0.03, "reason": "растеризация текста в SVG и HTML отличается сглаживанием и субпиксельным позиционированием" }
```

- [ ] **Step 2: Создать `tests/e2e/helpers/diff.ts`**

```ts
import { writeFileSync } from 'node:fs'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

export type DiffResult = { diffPixels: number; total: number; ratio: number }

/** Сравнивает два PNG одинакового размера. Разный размер — это провал
 *  сам по себе: значит IR отдал не ту высоту документа. */
export const diffPng = (
  expected: Buffer,
  actual: Buffer,
  diffOutPath: string,
): DiffResult => {
  const a = PNG.sync.read(expected)
  const b = PNG.sync.read(actual)

  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Размеры не совпадают: браузер ${a.width}×${a.height}, ` +
      `рендер из IR ${b.width}×${b.height}.`,
    )
  }

  const diff = new PNG({ width: a.width, height: a.height })
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.12,
    includeAA: false,
  })
  writeFileSync(diffOutPath, PNG.sync.write(diff))

  const total = a.width * a.height
  return { diffPixels, total, ratio: diffPixels / total }
}
```

- [ ] **Step 3: Написать падающий тест**

```ts
// tests/e2e/pixel-diff.spec.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { renderScreenToSvg, wrapSvgInHtml } from '@h2d/reference-renderer'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'
import { diffPng } from './helpers/diff.js'

const FIXTURES = ['boxes', 'stacking', 'flex', 'text'] as const

const thresholdOf = (fixture: string): number => {
  const file = resolve(repoRoot, 'fixtures', fixture, 'threshold.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { maxDiffRatio: number }
  return parsed.maxDiffRatio
}

for (const fixture of FIXTURES) {
  for (const size of SIZES) {
    test(`pixel-diff: ${fixture} @ ${size.width}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(fixtureUrl(fixture))
      const { screen } = await captureScreen(page, size.name)

      const browserShot = await page.screenshot({ fullPage: true })

      const svg = renderScreenToSvg(screen)
      await page.setContent(wrapSvgInHtml(svg, screen.width, screen.height))
      const renderedShot = await page.screenshot({ fullPage: true })

      const out = resolve(
        repoRoot, 'test-results', `${fixture}-${size.width}.diff.png`,
      )
      const result = diffPng(browserShot, renderedShot, out)

      expect(
        result.ratio,
        `Расхождение ${(result.ratio * 100).toFixed(3)}% ` +
        `(${result.diffPixels} из ${result.total} пикселей). ` +
        `Карта различий: ${out}`,
      ).toBeLessThanOrEqual(thresholdOf(fixture))
    })
  }
}
```

- [ ] **Step 4: Создать папку для артефактов диффов**

Run: `mkdir -p test-results`
Expected: папка создана, она уже в `.gitignore`.

- [ ] **Step 5: Запустить тест**

Run: `pnpm test:e2e`
Expected: тесты `pixel-diff` запускаются. На этом шаге часть из них, вероятно, **упадёт** — это нормальная и ожидаемая часть работы: именно здесь обнаруживаются настоящие расхождения сериализатора.

- [ ] **Step 6: Разобрать каждое расхождение по карте диффа**

Для каждого упавшего теста открой `test-results/<fixture>-<width>.diff.png` и определи причину. Известные ожидаемые находки и что с ними делать:

1. **Обводка съехала на половину толщины.** SVG рисует stroke по центру пути, CSS — внутрь бокса. Исправление в `renderBox`: сжать прямоугольник на половину толщины обводки, то есть `x + weight/2`, `y + weight/2`, `w - weight`, `h - weight`.
2. **Тень обрезана по краю.** Область фильтра мала. Расширить `x`/`y`/`width`/`height` у `<filter>` в `shadowFilter`.
3. **Фон `<body>` или `<html>` отсутствует.** Обход начинается с `document.body`, а фон страницы может быть задан на `html`. Исправление в `walkDocument`: если у `documentElement` есть непрозрачный `background-color`, а у `body` нет, перенести его на корневой узел и записать `Diagnostic` уровня `info`.
4. **Высота документа не совпала.** `scrollHeight` у `documentElement` против фактической высоты скриншота `fullPage`. Привести `Screen.height` к `document.documentElement.scrollHeight`.
5. **Текст смещён по вертикали.** `dominant-baseline="central"` даёт приблизительную базовую линию. Исправление: считать базовую линию из бокса строки как `line.y + (line.h + fontSize * 0.72) / 2` и ставить `dominant-baseline="alphabetic"`. Коэффициент подобрать по диффу и зафиксировать константой с комментарием.
6. **Внутренняя тень у `.inset-shadow` не нарисована.** `shadowFilter` обрабатывает только `kind === 'outer'`. Это заложено в фикстуру намеренно, чтобы гейт поймал пробел. Исправление в `shadowFilter`: для внутренней тени собрать фильтр из `feComponentTransfer` с инверсией альфы, `feGaussianBlur`, `feOffset` и `feComposite` с `operator="in"` по исходной альфе. Если реализация выйдет непропорционально сложной — поднять порог `boxes` и вписать в `reason`, что внутренние тени рендерер не воспроизводит; при этом сериализатор обязан продолжать их снимать, потому что Figma их поддерживает через `INNER_SHADOW`.

Правь **сериализатор или рендерер, но не пороги.** Порог поднимается только тогда, когда расхождение объяснено физически неустранимой причиной, и объяснение вписывается в поле `reason` соответствующего `threshold.json`.

- [ ] **Step 7: После каждого исправления перегенерировать снапшоты и перезапустить всё**

Run: `pnpm build:serializer && UPDATE_SNAPSHOTS=1 pnpm test:e2e && pnpm test:e2e`
Expected: PASS, включая все 20 pixel-diff тестов (4 фикстуры × 5 ширин).

- [ ] **Step 8: Коммит**

```bash
git add fixtures tests
git commit -m "test: pixel-diff гейт, доказывающий верность IR"
```

---

## Task 15: README и полный прогон

**Files:**
- Create: `README.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Создать `README.md`**

```markdown
# html2design

Снимает страницу, открытую в браузере, в макет Figma: пять экранов под разные
дисплеи плюс библиотека компонентов.

Дизайн: `docs/superpowers/specs/2026-09-19-html2design-design.md`
База знаний: `wiki/index.md`

## Состояние

План 1 из 4 — движок точности. Готово: формат IR с валидацией, сериализатор
`DOM → IR`, референс-рендерер `IR → SVG`, автоматический контур проверки.

Дальше: план 2 — Chrome-extension, план 3 — плагин Figma, план 4 — компоненты и токены.

## Требования

Node 20 или новее, pnpm.

## Установка

    pnpm install
    pnpm exec playwright install chromium

## Проверка

    pnpm test          # typecheck + юнит-тесты + E2E в настоящем Chrome

Отдельными шагами:

    pnpm typecheck
    pnpm test:unit
    pnpm build:serializer && pnpm test:e2e

## Как устроена проверка точности

Playwright открывает локальную фикстуру на пяти ширинах, инжектит собранный
сериализатор и получает IR. Дальше происходят две независимые проверки:

1. **IR-снапшот** — сравнение с закоммиченным эталоном в `fixtures/<name>/ir/`.
   Ловит регрессии.
2. **Pixel-diff** — IR рендерится обратно в SVG, скриншот SVG сравнивается со
   скриншотом браузера через pixelmatch. Ловит неверность: доказывает, что IR
   описывает именно то, что браузер нарисовал.

Порог расхождения задан на фикстуру в `fixtures/<name>/threshold.json` вместе
с причиной. Порог не поднимается ради зелёного CI — сначала объясняется
расхождение.

При осознанном изменении поведения снапшоты обновляются так:

    UPDATE_SNAPSHOTS=1 pnpm test:e2e

и обязательно просматриваются глазами перед коммитом.

## Правило проекта

Молчаливый fallback — это баг. Любая неподдерживаемая конструкция обязана
породить запись в `report` бандла. Коды диагностики — в
`packages/serializer/src/diagnostics.ts`.
```

- [ ] **Step 2: Прогнать всё от чистого состояния**

```bash
rm -rf node_modules packages/*/dist test-results
pnpm install
pnpm exec playwright install chromium
pnpm build:serializer
pnpm test
```

Expected: PASS целиком. Если что-то падает после чистой установки — это настоящая поломка, а не флак, и её надо починить до следующего шага.

- [ ] **Step 3: Обновить `wiki/log.md`**

Добавить в начало файла, после заголовка `# Хронология операций`:

```markdown
## [2026-09-19] feat | движок точности: IR, сериализатор, референс-рендерер

Выполнен план `docs/superpowers/plans/2026-09-19-fidelity-core.md`.

Появились пакеты `@h2d/ir`, `@h2d/serializer`, `@h2d/reference-renderer`.
Работает автоматический контур: Playwright снимает фикстуры на пяти ширинах,
сравнивает IR со снапшотами и диффит рендер из IR со скриншотом браузера.

Затронутые страницы: [[ir-bundle]], [[correctness-strategy]].
```

- [ ] **Step 4: Обновить страницу вики `wiki/pages/entities/ir-bundle.md`**

Поднять `updated:` на `2026-09-19` и добавить в конец, перед секцией «См. также»:

```markdown
## Реализация

Типы в `packages/ir/src/types.ts`, zod-схемы в `schema.ts`, проверка версии и
структуры в `validate.ts`. Версия проверяется до схемы, чтобы несовпадение
половин системы давало понятное сообщение вместо простыни ошибок валидации.
```

- [ ] **Step 5: Коммит**

```bash
git add README.md wiki
git commit -m "docs: README и запись в базу знаний по итогам плана 1"
```

---

## Ревизия контракта — дельты к задачам 3–14

Design-ревью контракта IR (после реализации первой редакции в `5e09c07`) вернуло **changes required**. Task 2 переписан полностью. Ниже — что именно меняется в остальных задачах. **Исполнитель каждой задачи обязан прочитать свою дельту вместе с телом задачи**: тела задач ниже написаны против первой редакции контракта и в перечисленных местах устарели.

### Почему ревизия, а не версия IR

Ни одного бандла ещё не существует, эталонных фикстур нет, сериализатор не написан. Правка контракта сейчас — это один файл. Та же правка после Task 13 — это переписывание сериализатора, рендерера и двадцати закоммиченных снапшотов. Версия IR остаётся `1`: мигрировать нечего.

Общий диагноз ревью, который стоит держать в голове при всех дельтах: **референс-рендерер разделял слепые пятна контракта** — читал `lines`, а не `runs`, абсолютные `rect`, а не раскладку, и плющил порядок отрисовки. Поэтому pixel-diff, главный инструмент корректности проекта, оставался зелёным почти для всех найденных дефектов. Каждая дельта ниже либо убирает слепое пятно, либо заставляет гейт его видеть.

### Решение по миграциям

Спека §9 обещала «миграции версий» в `packages/ir`. Обещание снимается: бандл — **односверсионный артефакт**, и отказ при несовпадении версий — правильное поведение для двух половин, которые всегда поставляются вместе. `BundleEnvelope` из Task 2 существует не для миграции, а чтобы сообщение об ошибке отличало «это не наш файл» от «наш файл чужой версии». Строгий литерал `IrVersion` на валидированном `Bundle` сохраняется.

### Task 3 — схема и валидация

1. **Связать схему типом.** Было `export const irNodeSchema: z.ZodType<unknown>` и `parsed.data as Bundle`. Становится `z.ZodType<IrNode>` на ленивой схеме, а приведение `as Bundle` удаляется. Причина: с `unknown` и приведением схема и типы расходятся при зелёном typecheck. Добавили поле в `types.ts`, забыли в `schema.ts` — валидация пропускает бандл без него, плагин читает `node.transform.angle`, Figma падает **посреди построения**. Это ровно «половинчатый импорт», который преамбула Task 3 называет худшим исходом.
2. **`z.discriminatedUnion('kind', …)`** для `IrNode`, обёрнутая в `z.lazy` ради рекурсии `children`.
3. **`Rgba8`: `.int()`** на `r`, `g`, `b`. Без этого `{r:1,g:1,b:1}` — валидные единицы Figma и почти чёрный в наших — проходит проверку и рисуется неверно. `getComputedStyle` и канвас-путь дают целые, так что ограничение бесплатно.
4. **Маркер формата**: `format: z.literal('h2d')`, проверяется в `parseBundle` до версии.
5. **Инварианты `paintOrder` валидируются**, а не документируются: по каждому экрану собрать все `paintOrder`, проверить, что их количество равно количеству узлов, что все уникальны и что множество равно `0..n-1`. Инвариант, существующий только в комментарии резолвера, продюсер может нарушить, и тогда сортировка в плагине станет недетерминированной между запусками.
6. **Ссылочная целостность** в `parseBundle`: каждый `assetId` из `Fill` и `ImageRef` существует в `assets`; `screenshotId` существует; `nodeId` каждой диагностики существует; `screenId` существует; каждое `usedFamily` из ранов покрыто `fonts`. Причина: при неудачной загрузке картинки `assetId` повисает, `figma.createImage` не вызывается, узел приезжает пустым прямоугольником, диагностики нет, бандл «валиден». Висячая ссылка — это молчаливый fallback, а проверка стоит двадцать строк в единственном месте, общем для обеих половин.
7. **Уникальность `id` узлов в пределах всего бандла**, а не экрана.
8. Тесты добавляются на каждый новый отказ: чужой `format`, дырявый `paintOrder`, висячий `assetId`, дубль `id`, `runs: []`, дробный канал цвета.

### Task 6 — обводки

1. Читать `border-*-style` и заполнять `Stroke.style`. Было: `widthOf` обнуляет только `none`/`hidden`, поэтому `dashed` и `dotted` молча становились сплошными. В Figma есть `dashPattern`, то есть терялась представимая фича.
2. Всегда выставлять `align: 'inside'`.
3. Пока рендерер плана 1 не рисует штрихи — порождать `strokeStyleFlattened`. Молчание здесь запрещено.

### Task 9 — диагностика

1. `DiagnosticSink` **импортирует коды из `@h2d/ir`**, своего списка не держит. Задача больше не создаёт `DIAGNOSTIC_CODES` — они переехали в Task 2.
2. Конструктор принимает `screenId`, а не отображаемое имя.
3. `report()` получает параметр `needsPlaceholder`.

### Task 10 — текст

1. **`run.text` — только собственный текст узла.** Было `el.textContent`, то есть весь подграф. Это ядро находки C2: для `<p>Hello <b>world</b></p>` абзац получал `runs[0].text = "Hello world"` и строку `"Hello"`, а `<b>` — свой узел со своим «world», и плагин рисовал «world» дважды с наложением.
2. Инвариант, который надо утверждать тестом: конкатенация `runs[].text` равна собственному тексту узла и равна конкатенации `lines[].text`.
3. **`fontStack` и `usedFamily`.** Первое — весь объявленный `font-family`. Второе — семейство, которым браузер реально рисовал: перебрать стек и взять первое, для которого `document.fonts.check(\`\${size}px "\${family}"\`)` истинно, с системным стеком как последним рубежом. При `usedFamily !== fontStack[0]` — диагностика `fontFallback` уровня `error`. Без этого `lines` содержат метрики фактического шрифта, а IR называет объявленный, и плагин применяет чужие метрики, считая, что шрифт найден.
4. `lineHeight` и `align` переезжают из `TextRun` в `NodeText`: это свойства абзаца, и два рана не должны иметь возможность противоречить друг другу.
5. `runs` непустой по построению.

### Task 11 — обход DOM

1. **Присваивать `kind`** и строить соответствующий вариант узла. `<canvas>`, cross-origin iframe и closed shadow root становятся `kind: 'placeholder'` с кодом и подписью, а не пустыми фреймами.
2. **`selfLayout`** из `LayoutProbe`: `positioning`, `align-self`, `flex-grow`, `flex-shrink`. Данные уже читаются для стекинга и сейчас выбрасываются. Без них абсолютно позиционированный бейдж внутри flex попадёт третьим элементом auto-layout и сдвинет остальных.
3. **`isStackingContext`** из резолвера — он это уже вычисляет.
4. **Диагностики на отложенное**, каждая с `needsPlaceholder` где уместно: `background-image` присутствует, но не разбирается → `deferredGradient`; `cs.transform !== 'none'` → `deferredTransform` уровня `error` (было: проверялся только `matrix3d`, поэтому 2D-поворот не порождал ничего); `filter`/`backdrop-filter` blur → `deferredBlur`; `mix-blend-mode !== 'normal'` → `deferredBlend`; узел внутри `<svg>` → `deferredVector`; непустой `content` у `::before`/`::after` → `deferredPseudoElement`.
5. **Счётчик `id` глобальный по бандлу**, не по экрану.
6. `Screen.id` генерируется отдельно от `name`; `scroll` записывается.
7. `Screen.height` — `Math.max(documentElement.scrollHeight, window.innerHeight)`, и это **определение поля**: высота фрейма макета, не меньше вьюпорта. Не менять на чистый `scrollHeight` — это сломало бы короткие страницы, где скриншот `fullPage` выше содержимого.

### Task 12 — референс-рендерер

1. `switch` по `kind`, исчерпывающий.
2. `kind: 'placeholder'` рисуется **видимо**: пунктирная рамка и подпись из `placeholder.label`. Правило проекта требует, чтобы неподдерживаемое было видно.
3. Продолжать плющить и сортировать по `paintOrder` — но **дополнительно обнаруживать переплетение** и печатать предупреждение: если `paintOrder` узла попадает внутрь диапазона `[min, max]` чужого поддерева, значит дерево Figma этот порядок выразить не сможет. Рендерер такой случай переживает, а плагин нет, и без этой проверки гейт остаётся зелёным при заведомо невыразимом макете.
4. Текст рендерится из `lines`, как раньше, но `usedFamily` подставляется в `font-family` — иначе диффится не тот шрифт, которым рисовал браузер.

### Task 13 — фикстуры

Добавить фикстуры, которые заставляют новые поля и диагностики работать, иначе они непроверены:

- `transformed/` — `rotate(15deg)`, `scale(1.5)`, `translate`. Ожидание: `deferredTransform` уровня `error` на каждом. Раздутие осепараллельного габарита достаточно велико, чтобы pixel-diff это громко поймал.
- `gradient/` — `linear-gradient` фон. Ожидание: `deferredGradient`, а не молча прозрачный блок.
- `inline-text/` — `<p>Hello <b>world</b> and <span style="color:red">red</span></p>`. Ожидание: инвариант конкатенации выполняется, «world» не дублируется.
- `absolute-in-flex/` — бейдж `position:absolute` внутри `display:flex`. Ожидание: `selfLayout.positioning === 'absolute'` у бейджа и `'flow'` у соседей.
- `missing-font/` — `font-family: "Заведомо Отсутствующий Шрифт", Arial`. Ожидание: `usedFamily === 'Arial'` и `fontFallback` уровня `error`.
- `dashed-border/` — `border: 2px dashed`. Ожидание: `style === 'dashed'` и `strokeStyleFlattened`.

Тест на диагностики формулируется положительно: для каждой фикстуры перечислен набор кодов, которые **обязаны** присутствовать. Отсутствие ожидаемого кода — провал. Это и есть машинная проверка правила «молчаливый fallback — это баг».

### Task 14 — pixel-diff

1. **Скриншот приводится к `Screen.height`, а не наоборот.** Шаг 6 пункт 4 в теле задачи предписывал обратное — менять `Screen.height` на чистый `scrollHeight`. Это ошибка: она сломала бы короткую страницу, где `fullPage`-скриншот выше содержимого. `Screen.height` — определение, скриншот подгоняется под него.
2. Пороги для новых фикстур: `transformed/` и `gradient/` в плане 1 **обязаны** расходиться — фичи отложены. Поэтому для них pixel-diff не запускается вообще, а проверяется только наличие диагностик. Порог, подогнанный под заведомо неверный рендер, был бы ложью в чеклисте.

---

## Проверка готовности плана

План считается выполненным, когда:

- [ ] `pnpm test` проходит целиком от чистой установки
- [ ] 20 pixel-diff тестов зелёные (4 фикстуры × 5 ширин), пороги не поднимались без объяснённой причины в `threshold.json`
- [ ] IR-снапшоты закоммичены и просмотрены глазами
- [ ] Ни одного `any` в коде: `grep -rn ": any\|as any" packages/ tests/` пусто
- [ ] Все дельты из раздела «Ревизия контракта» применены: схема связана типом `z.ZodType<IrNode>`, приведения `as Bundle` нет, инварианты `paintOrder` и ссылочная целостность валидируются
- [ ] Для каждой новой фикстуры проверено НАЛИЧИЕ ожидаемых кодов диагностики — машинная проверка правила «молчаливый fallback — это баг»
- [ ] `transformed/` и `gradient/` не участвуют в pixel-diff, только в проверке диагностик: подогнанный под заведомо неверный рендер порог был бы ложью
- [ ] `pnpm typecheck:root` проходит и входит в составной скрипт `test` — каталог `tests/` проверяется типами, а не только транспилируется
- [ ] Резолвер стекинга проходит все 15 тестов, включая изоляцию `z-index` во вложенном контексте
- [ ] Цвет в синтаксисе `oklch()` разобран через канвас-путь, диагностика `fidelity.color-unparsed` пуста
- [ ] Внутренняя тень либо отрендерена, либо порог `boxes` поднят с объяснением в `reason`
- [ ] `wiki/log.md` и `wiki/pages/entities/ir-bundle.md` обновлены

## Что этот план сознательно не делает

Изображения и ассеты, градиенты, псевдоэлементы, shadow DOM, трансформы, блюры,
same-origin iframe, извлечение токенов, детекция компонентов, `chrome.debugger`,
сборка ZIP-бандла, что-либо внутри Figma.

Каждое из этого добавляется в последующих планах как новая фикстура плюс новый
модуль — тестовый контур из Task 13 и Task 14 делает такое добавление
механическим и защищённым от регрессий.
