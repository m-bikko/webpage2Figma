# Fidelity Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить движок точности webpage2figma: сериализатор `DOM → IR`, референс-рендерер `IR → SVG` и автоматический тестовый контур, который в настоящем Chrome доказывает pixel-diff'ом, что IR верно описывает нарисованную браузером страницу.

**Architecture:** pnpm-воркспейс из трёх пакетов. `packages/ir` — типы и zod-валидация формата обмена. `packages/serializer` — чистые функции обхода DOM, собираются в IIFE-бандл и инжектятся в страницу. `packages/reference-renderer` — обратное преобразование IR в SVG, служит и инструментом отладки, и эталоном для pixel-diff. Playwright гоняет локальные HTML-фикстуры на пяти ширинах, сравнивает IR со закоммиченными снапшотами и диффит скриншот браузера со скриншотом отрендеренного из IR SVG.

**Tech Stack:** TypeScript strict (без `any`), pnpm workspaces, vitest (юнит), Playwright (E2E в настоящем Chrome), tsup (IIFE-бандл сериализатора), zod (валидация IR), pixelmatch + pngjs (диффы).

**Источник требований:** `docs/superpowers/specs/2026-09-19-webpage2figma-design.md`

**Место в карте планов:** план 1 из 4. Дальше: 2 — extension, 3 — плагин Figma, 4 — компоненты и токены.

**Границы этого плана.** Покрывается вертикальный срез CSS: сплошные заливки, обводки с разной толщиной по сторонам, радиусы по углам, внешние и внутренние тени, `opacity`, `overflow: hidden`, flex-раскладки, абсолютное позиционирование, `z-index`-стекинг, текст с переносами. Градиенты, изображения, псевдоэлементы, shadow DOM, трансформы, блюры и same-origin iframe расширяют покрытие в плане 2 — тестовый контур из этого плана делает их добавление механическим.

**Соглашение по коммитам.** Каждый коммит заканчивается трейлером:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Ниже в командах он опущен ради читаемости — добавляй его всегда.

**Правило TDD.** Тест пишется первым, запускается и обязан упасть по ожидаемой причине, и только потом пишется минимальная реализация. Шаг «убедись, что тест падает» не пропускается: он доказывает, что тест вообще что-то проверяет.

**Правило «проверяй проверки».** За время исполнения этого плана трижды обнаружилось, что проверка ничего не проверяет, и каждый раз она при этом **проходила** и потому не вызывала подозрений:

- контрольная точка «typecheck обязан упасть с `TS18003`» — `tsc` молча выходит с нулём, если у проекта есть `references`;
- тест «все индексы порядка отрисовки уникальны» — пропавший узел делает оставшиеся индексы тривиально уникальными, тест прошёл бы на пустой карте;
- тест «`normal` gap даёт ноль» — `parsePx` возвращает ноль и без обрабатывающей ветки, так что удаление ветки тест не ломает.

Отсюда обязательное требование ко всякой проверке, которая «доказывает» существование поведения: **сломай проверяемое и убедись, что проверка упала.** Удали ветку, испорти вход, подставь заведомо неверный тип. Проверка, не падающая на заведомо сломанном, — не проверка, а украшение, и хуже отсутствия: она создаёт ложную уверенность.

Если сломать проверяемое нельзя, а результат всё равно тот же — значит ветка мёртвая. Удали ветку, а не тест.

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
  src/global.ts                           точка входа IIFE: window.__w2f
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
  "name": "webpage2figma",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "tsc -b packages/ir",
    "typecheck:root": "tsc -p tsconfig.json",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test": "pnpm typecheck && pnpm typecheck:root && pnpm test:unit && pnpm test:e2e",
    "build:serializer": "pnpm --filter @w2f/serializer build"
  },
  "devDependencies": {
    "@w2f/ir": "workspace:*",
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

`@w2f/ir` объявлен зависимостью корня намеренно: без этого `tests/e2e/` его не разрешит.

**Важно: пакеты подключаются по мере появления.** `workspace:*`-зависимость на несуществующий пакет валит `pnpm install`, а `tsc -b` на несуществующий путь валит typecheck. Поэтому здесь в `typecheck` только `packages/ir`, а `@w2f/reference-renderer` в зависимостях отсутствует. Расширения делают Task 4 (добавляет `packages/serializer` в `typecheck`) и Task 12 (добавляет `packages/reference-renderer` и в `typecheck`, и в корневые `devDependencies` — второе обязательно, иначе `tests/e2e/pixel-diff.spec.ts` из Task 14 не разрешит импорт).

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

**Без `paths` и `baseUrl`.** Разрешение воркспейс-пакетов по именам обеспечивают pnpm-симлинк и поле `exports` в `package.json` пакета, указывающее прямо на `src/index.ts`. При `moduleResolution: bundler` компилятор следует `exports` точно так же, как сборщик, — проверено удалением записи из `paths`: реальный импорт значения `IR_VERSION` из `@w2f/ir` продолжает резолвиться.

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

Без `resolve.alias`. Алиасы были бы инертной дубликацией: Vitest разрешает `@w2f/ir` через воркспейс-симлинк и `exports` пакета. Проверено удалением блока — тесты продолжают проходить.

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
  "name": "@w2f/ir",
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

Коды диагностики живут в `@w2f/ir`, а не в сериализаторе. Причина конкретная: плагин Figma не может импортировать из сериализатора — тот собран как IIFE для контекста страницы. Держать список в сериализаторе означало бы, что плагин его дублирует или сравнивает строки, и первый же новый код из плана 2 провалился бы в плагине в общую ветку без заглушки. Тогда неподдерживаемый элемент приехал бы в Figma обычной пустой коробкой — ровно молчаливо неверный результат.

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
  /** Текст есть, но ни одного бокса строки не получено. Отдельный код
   *  нужен потому, что молчаливая потеря текста невидима и для
   *  валидатора, и для pixel-diff: оба сравнивают то, что доехало. */
  textLost: 'fidelity.text-lost',
  /** Фон страницы задан на `<html>`, а обход начинается с `<body>`.
   *  Заливка перенесена на корневой узел. Молчать нельзя: без
   *  переноса тёмная страница приезжала бы на белом фоне, и ни
   *  валидатор, ни pixel-diff этого не увидели бы — обход просто
   *  не дошёл бы до элемента, где фон объявлен. */
  pageBackgroundMoved: 'fidelity.page-background-moved',
  colorClamped: 'fidelity.color-clamped',
  fontFallback: 'fidelity.font-fallback',
  gridFlattened: 'fidelity.grid-flattened',
  ellipticalCorner: 'fidelity.elliptical-corner',
  mixedBorderColors: 'fidelity.mixed-border-colors',
  strokeStyleFlattened: 'fidelity.stroke-style-flattened',
  stickyFlattened: 'fidelity.sticky-flattened',
  paintOrderInterleaved: 'fidelity.paint-order-interleaved',
  /** Порядок отрисовки приближён: позиционированный узел с
   *  `z-index: auto` контекста не создаёт, и его z-индексированные
   *  потомки должны подниматься к предку-контексту, а резолвер
   *  считает такой узел атомарным. Сознательное упрощение, но
   *  молчать о нём нельзя: порядок может отличаться от браузерного. */
  paintOrderApproximated: 'fidelity.paint-order-approximated',
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
  format: 'w2f'
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

**Переписана после design-ревью контракта** вместе с Task 2. Валидатор стоит на входе плагина Figma и обязан отклонять плохой бандл **до** начала построения. Половинчатый импорт — худший из возможных исходов: пользователь не понимает, доверять ли результату.

Ревью добавило к этой задаче два требования, которых в первой редакции не было и без которых валидатор пропускал заведомо сломанные бандлы.

**Первое: схема связывается типом с `types.ts`.** Было `z.ZodType<unknown>` плюс `parsed.data as Bundle`. С таким приведением схема и типы расходятся при зелёном typecheck: добавили поле в `types.ts`, забыли в `schema.ts` — валидация пропускает бандл без него, плагин читает `node.transform.angle`, Figma падает **посреди построения**.

**Второе: проверяются инварианты, которые форма выразить не может.** Схема умеет сказать «`paintOrder` это число» и «`assetId` это строка». Она не умеет сказать «эти числа образуют плотную перестановку» и «эта строка на что-то ссылается». Между тем висячий `assetId` — при неудачной загрузке картинки в extension — даёт пустой прямоугольник без диагностики при формально валидном бандле. Это молчаливый fallback, и стоит он двадцать строк в единственном месте, общем для обеих половин.

Поэтому валидация разделена на два файла: `schema.ts` проверяет форму, `invariants.ts` — смысл. Второй состоит из чистых функций над готовым `Bundle` и тестируется независимо.

**Files:**
- Create: `packages/ir/src/schema.ts`, `packages/ir/src/invariants.ts`, `packages/ir/src/validate.ts`
- Modify: `packages/ir/src/index.ts` (добавить экспорт `./invariants.js`)
- Test: `packages/ir/test/fixtures.ts`, `packages/ir/test/invariants.test.ts`, `packages/ir/test/validate.test.ts`

- [ ] **Step 1: Создать `packages/ir/test/fixtures.ts`**

Конструкторы валидных объектов, чтобы тесты портили ровно одно поле и было видно, что именно проверяется. Не тест сам по себе, поэтому вынесен отдельно.

```ts
import { IR_VERSION } from '../src/version.js'
import type { Bundle, IrNode, NodeText, Screen, TextRun } from '../src/types.js'

export const frameNode = (overrides: Partial<Omit<IrNode, 'kind'>> = {}): IrNode => ({
  kind: 'frame',
  id: 'n0',
  sourceTag: 'div',
  name: 'div',
  rect: { x: 0, y: 0, w: 100, h: 100 },
  paintOrder: 0,
  isStackingContext: false,
  transform: null,
  layout: {
    mode: 'none',
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    align: 'start',
    justify: 'start',
    wrap: false,
  },
  selfLayout: { positioning: 'flow', align: null, grow: 0, shrink: 1 },
  style: {
    fills: [],
    stroke: null,
    corner: { tl: 0, tr: 0, br: 0, bl: 0 },
    shadows: [],
    opacity: 1,
    blend: 'normal',
    blur: null,
    clip: false,
  },
  children: [],
  ...overrides,
})

export const textRun = (overrides: Partial<TextRun> = {}): TextRun => ({
  text: 'привет',
  fontStack: ['Arial', 'sans-serif'],
  usedFamily: 'Arial',
  fontWeight: 400,
  fontStyle: 'normal',
  fontSize: 16,
  letterSpacing: 0,
  color: { r: 0, g: 0, b: 0, a: 1 },
  decoration: 'none',
  shadows: [],
  ...overrides,
})

export const nodeText = (overrides: Partial<NodeText> = {}): NodeText => ({
  runs: [textRun()],
  lines: [{ x: 0, y: 0, w: 50, h: 20, text: 'привет' }],
  lineHeight: 20,
  align: 'left',
  ...overrides,
})

export const screen = (overrides: Partial<Screen> = {}): Screen => ({
  id: 's0',
  name: 'Desktop',
  width: 1440,
  height: 900,
  dpr: 1,
  scroll: { x: 0, y: 0 },
  root: frameNode(),
  screenshotId: null,
  ...overrides,
})

export const bundle = (overrides: Partial<Bundle> = {}): Bundle => ({
  format: 'w2f',
  version: IR_VERSION,
  capturedAt: '2026-09-19T10:00:00.000Z',
  url: 'https://example.com/',
  title: 'Example',
  userAgent: 'Mozilla/5.0',
  screens: [screen()],
  assets: [],
  fonts: [{ family: 'Arial', weight: 400, style: 'normal' }],
  tokens: { variables: [], textStyles: [], paintStyles: [] },
  report: [],
  ...overrides,
})
```

- [ ] **Step 2: Написать падающие тесты инвариантов**

```ts
// packages/ir/test/invariants.test.ts
import { describe, expect, it } from 'vitest'
import { checkInvariants } from '../src/invariants.js'
import { bundle, frameNode, nodeText, screen, textRun } from './fixtures.js'

const codesOf = (errors: { code: string }[]): string[] => errors.map((e) => e.code)

describe('checkInvariants: paintOrder', () => {
  it('пропускает плотную перестановку', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [frameNode({ id: 'b', paintOrder: 1 }), frameNode({ id: 'c', paintOrder: 2 })],
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  it('ловит дубль paintOrder', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [frameNode({ id: 'b', paintOrder: 1 }), frameNode({ id: 'c', paintOrder: 1 })],
    })
    const errors = checkInvariants(bundle({ screens: [screen({ root })] }))
    expect(codesOf(errors)).toContain('paint-order.duplicate')
  })

  it('ловит дырку в перестановке', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [frameNode({ id: 'b', paintOrder: 5 })],
    })
    const errors = checkInvariants(bundle({ screens: [screen({ root })] }))
    expect(codesOf(errors)).toContain('paint-order.not-dense')
  })

  it('считает paintOrder независимо по экранам', () => {
    const root = frameNode({ id: 'a', paintOrder: 0 })
    const b = bundle({
      screens: [
        screen({ id: 's0', root }),
        screen({ id: 's1', root: frameNode({ id: 'z', paintOrder: 0 }) }),
      ],
    })
    expect(checkInvariants(b)).toEqual([])
  })
})

describe('checkInvariants: уникальность id узлов', () => {
  it('ловит дубль id внутри экрана', () => {
    const root = frameNode({
      id: 'dup', paintOrder: 0,
      children: [frameNode({ id: 'dup', paintOrder: 1 })],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('node-id.duplicate')
  })

  it('ловит дубль id МЕЖДУ экранами — id уникальны по бандлу, не по экрану', () => {
    const b = bundle({
      screens: [
        screen({ id: 's0', root: frameNode({ id: 'n0', paintOrder: 0 }) }),
        screen({ id: 's1', root: frameNode({ id: 'n0', paintOrder: 0 }) }),
      ],
    })
    expect(codesOf(checkInvariants(b))).toContain('node-id.duplicate')
  })
})

describe('checkInvariants: ссылочная целостность', () => {
  it('ловит висячий assetId у image-узла', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 'img', paintOrder: 1 }),
        kind: 'image',
        image: {
          assetId: 'нет-такого',
          placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
        },
      }],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('asset.dangling')
  })

  it('ловит висячий assetId в image-заливке', () => {
    const root = frameNode({
      id: 'a',
      paintOrder: 0,
      style: {
        ...frameNode().style,
        fills: [{
          kind: 'image',
          ref: {
            assetId: 'нет-такого',
            placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
          },
        }],
      },
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('asset.dangling')
  })

  it('принимает assetId, который есть в assets', () => {
    const b = bundle({
      assets: [{ id: 'a1', mimeType: 'image/png', width: 10, height: 10, path: 'assets/a1.png' }],
      screens: [screen({
        root: frameNode({
          id: 'a',
          paintOrder: 0,
          style: {
            ...frameNode().style,
            fills: [{
              kind: 'image',
              ref: {
                assetId: 'a1',
                placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
              },
            }],
          },
        }),
      })],
    })
    expect(checkInvariants(b)).toEqual([])
  })

  it('ловит висячий screenshotId', () => {
    const b = bundle({ screens: [screen({ screenshotId: 'нет-такого' })] })
    expect(codesOf(checkInvariants(b))).toContain('screenshot.dangling')
  })

  it('ловит диагностику, ссылающуюся на несуществующий узел', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: 'нет-такого', screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('diagnostic.dangling-node')
  })

  it('ловит диагностику, ссылающуюся на несуществующий экран', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: null, screenId: 'нет-такого', needsPlaceholder: false,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('diagnostic.dangling-screen')
  })

  it('ловит шрифт, использованный в тексте, но отсутствующий в fonts', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 't', paintOrder: 1 }),
        kind: 'text',
        text: nodeText({ runs: [textRun({ usedFamily: 'Söhne', fontWeight: 700 })] }),
      }],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('font.uncovered')
  })
})

describe('checkInvariants: связность текста', () => {
  it('ловит расхождение конкатенации ранов и строк', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [{
        ...frameNode({ id: 't', paintOrder: 1 }),
        kind: 'text',
        text: nodeText({
          runs: [textRun({ text: 'привет мир' })],
          lines: [{ x: 0, y: 0, w: 50, h: 20, text: 'привет' }],
        }),
      }],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('text.concat-mismatch')
  })
})
```

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `pnpm vitest run packages/ir/test/invariants.test.ts`
Expected: FAIL — `Failed to resolve import "../src/invariants.js"`.

- [ ] **Step 4: Создать `packages/ir/src/invariants.ts`**

Чистые функции над готовым `Bundle`. Проверяют то, чего схема выразить не может.

```ts
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
```

- [ ] **Step 5: Запустить тесты инвариантов**

Run: `pnpm vitest run packages/ir/test/invariants.test.ts`
Expected: PASS, 14 тестов.

- [ ] **Step 6: Создать `packages/ir/src/schema.ts`**

Зеркало `types.ts`. Связано типом: `z.ZodType<IrNode>` на ленивой схеме — если зеркало разойдётся с оригиналом, это ошибка компиляции, а не тихий пропуск.

```ts
import { z } from 'zod'
import { ALL_DIAGNOSTIC_CODES, type DiagnosticCode } from './codes.js'
import type { Bundle, IrNode } from './types.js'
import { IR_VERSION } from './version.js'

/** Целые каналы: `getComputedStyle` и канвас-путь дают только целые,
 *  так что ограничение бесплатно и отсекает дробные значения — например
 *  `{r:0.5,…}`, то есть единицы Figma в нецелой форме.
 *
 *  Чего оно НЕ отсекает, и это надо знать: `{r:1,g:1,b:1}` — белый в
 *  единицах Figma и почти чёрный в наших — целое и валидное значение,
 *  и различить замысел по данным невозможно в принципе. Защита от этой
 *  подмены не проверка, а ИМЯ типа `Rgba8`: ошибку должно быть трудно
 *  написать в точке вызова. Не полагайся здесь на валидатор. */
const rgba8 = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().min(0).max(1),
})

const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
const sides = z.object({
  top: z.number(), right: z.number(), bottom: z.number(), left: z.number(),
})
const corner = z.object({
  tl: z.number(), tr: z.number(), br: z.number(), bl: z.number(),
})

const transform = z.object({
  angle: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  translateX: z.number(),
  translateY: z.number(),
})

const blendMode = z.enum([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])

const imagePlacement = z.object({
  mode: z.enum(['fill', 'fit', 'tile', 'crop']),
  offsetX: z.number(),
  offsetY: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
})

const imageRef = z.object({ assetId: z.string().min(1), placement: imagePlacement })

const fill = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: rgba8 }),
  z.object({ kind: z.literal('image'), ref: imageRef }),
])

const stroke = z.object({
  color: rgba8,
  weight: sides,
  style: z.enum(['solid', 'dashed', 'dotted']),
  align: z.literal('inside'),
})

const shadow = z.object({
  kind: z.enum(['outer', 'inner']),
  color: rgba8,
  offsetX: z.number(),
  offsetY: z.number(),
  blur: z.number().min(0),
  spread: z.number(),
})

const blur = z.object({ layer: z.number().min(0), background: z.number().min(0) })

const nodeStyle = z.object({
  fills: z.array(fill),
  stroke: stroke.nullable(),
  corner,
  shadows: z.array(shadow),
  opacity: z.number().min(0).max(1),
  blend: blendMode,
  blur: blur.nullable(),
  clip: z.boolean(),
})

const layoutAlign = z.enum(['start', 'center', 'end', 'stretch', 'baseline'])

const nodeLayout = z.object({
  mode: z.enum(['row', 'column', 'none']),
  gap: z.number(),
  padding: sides,
  align: layoutAlign,
  justify: z.enum([
    'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly',
  ]),
  wrap: z.boolean(),
})

const selfLayout = z.object({
  positioning: z.enum(['flow', 'absolute', 'fixed', 'sticky', 'float']),
  align: layoutAlign.nullable(),
  grow: z.number(),
  shrink: z.number(),
})

const textRun = z.object({
  text: z.string(),
  fontStack: z.array(z.string()).min(1),
  usedFamily: z.string().min(1),
  fontWeight: z.number(),
  fontStyle: z.enum(['normal', 'italic']),
  fontSize: z.number(),
  letterSpacing: z.number(),
  color: rgba8,
  decoration: z.enum(['none', 'underline', 'strikethrough']),
  shadows: z.array(shadow),
})

const lineBox = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(), text: z.string(),
})

/** `runs` непустой: текстовый узел без ранов отрендерился бы в ничто,
 *  и это молчаливая потеря. */
const nodeText = z.object({
  runs: z.array(textRun).nonempty(),
  lines: z.array(lineBox),
  lineHeight: z.number(),
  align: z.enum(['left', 'center', 'right', 'justify']),
})

const vectorPath = z.object({
  data: z.string(),
  fill: rgba8.nullable(),
  stroke: stroke.nullable(),
})

/** Приведение к непустому кортежу — единственное допущенное здесь,
 *  и оно безопасно: `ALL_DIAGNOSTIC_CODES` собран из `Object.values`
 *  непустого литерала. Альтернатива — дублировать список строк в схеме,
 *  то есть завести второй источник истины. */
const diagnosticCode = z.enum(
  ALL_DIAGNOSTIC_CODES as readonly [DiagnosticCode, ...DiagnosticCode[]],
)

/** Аннотация `z.ZodType<IrNode>` — несущая, а не декоративная: если схема
 *  разойдётся с типом, это ошибка компиляции здесь, а не пропущенный
 *  бандл и падение Figma посреди построения. */
export const irNodeSchema: z.ZodType<IrNode> = z.lazy(() => {
  const base = z.object({
    id: z.string().min(1),
    sourceTag: z.string(),
    name: z.string(),
    rect,
    paintOrder: z.number().int().min(0),
    isStackingContext: z.boolean(),
    transform: transform.nullable(),
    layout: nodeLayout,
    selfLayout,
    style: nodeStyle,
    children: z.array(irNodeSchema),
  })

  return z.discriminatedUnion('kind', [
    base.extend({ kind: z.literal('frame') }),
    base.extend({ kind: z.literal('text'), text: nodeText }),
    base.extend({ kind: z.literal('image'), image: imageRef }),
    base.extend({ kind: z.literal('vector'), paths: z.array(vectorPath) }),
    base.extend({
      kind: z.literal('placeholder'),
      placeholder: z.object({ code: diagnosticCode, label: z.string().min(1) }),
    }),
  ])
})

const screen = z.object({
  id: z.string().min(1),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  dpr: z.number().positive(),
  scroll: z.object({ x: z.number(), y: z.number() }),
  root: irNodeSchema,
  screenshotId: z.string().nullable(),
})

const diagnostic = z.object({
  level: z.enum(['info', 'warning', 'error']),
  code: diagnosticCode,
  message: z.string(),
  nodeId: z.string().nullable(),
  screenId: z.string().nullable(),
  needsPlaceholder: z.boolean(),
})

export const bundleSchema: z.ZodType<Bundle> = z.object({
  format: z.literal('w2f'),
  version: z.literal(IR_VERSION),
  capturedAt: z.string(),
  url: z.string(),
  title: z.string(),
  userAgent: z.string(),
  screens: z.array(screen).min(1),
  assets: z.array(z.object({
    id: z.string().min(1),
    mimeType: z.string(),
    width: z.number(),
    height: z.number(),
    path: z.string(),
  })),
  fonts: z.array(z.object({
    family: z.string().min(1),
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

- [ ] **Step 7: Написать падающие тесты валидатора**

```ts
// packages/ir/test/validate.test.ts
import { describe, expect, it } from 'vitest'
import { IR_VERSION } from '../src/version.js'
import { parseBundle } from '../src/validate.js'
import { bundle, frameNode, screen } from './fixtures.js'

describe('parseBundle: конверт', () => {
  it('принимает валидный бандл и возвращает типизированный объект', () => {
    const result = parseBundle(bundle())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.screens[0]?.width).toBe(1440)
  })

  it('отклоняет не-объект', () => {
    expect(parseBundle('не бандл').ok).toBe(false)
  })

  it('отличает чужой файл от чужой версии', () => {
    const result = parseBundle({ foo: 'bar' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('не похож на бандл webpage2figma')
    expect(result.error).not.toContain('undefined')
  })

  it('отклоняет чужую версию с внятным сообщением', () => {
    const result = parseBundle({ ...bundle(), version: 999 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('версия IR')
    expect(result.error).toContain(String(IR_VERSION))
  })
})

describe('parseBundle: схема', () => {
  it('отклоняет сломанный rect, указывая путь', () => {
    const broken = structuredClone(bundle()) as Record<string, unknown>
    const screens = broken['screens'] as { root: { rect: unknown } }[]
    const first = screens[0]
    if (first === undefined) throw new Error('фикстура без экранов')
    first.root.rect = { x: 0, y: 0 }
    const result = parseBundle(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('rect')
  })

  it('отклоняет дробный канал цвета — это единицы Figma, а не наши', () => {
    const b = bundle({
      screens: [screen({
        root: frameNode({
          style: {
            ...frameNode().style,
            fills: [{ kind: 'solid', color: { r: 0.5, g: 1, b: 1, a: 1 } }],
          },
        }),
      })],
    })
    expect(parseBundle(b).ok).toBe(false)
  })

  it('отклоняет неизвестный kind узла', () => {
    const b = bundle({
      screens: [screen({ root: { ...frameNode(), kind: 'нечто' } as never })],
    })
    expect(parseBundle(b).ok).toBe(false)
  })

  it('отклоняет неизвестный код диагностики', () => {
    const b = bundle({
      report: [{
        level: 'info', code: 'нет.такого', message: 'x',
        nodeId: null, screenId: null, needsPlaceholder: false,
      } as never],
    })
    expect(parseBundle(b).ok).toBe(false)
  })
})

describe('parseBundle: инварианты', () => {
  it('отклоняет бандл, валидный по форме, но с дыркой в paintOrder', () => {
    const b = bundle({
      screens: [screen({
        root: frameNode({
          id: 'a', paintOrder: 0,
          children: [frameNode({ id: 'b', paintOrder: 7 })],
        }),
      })],
    })
    const result = parseBundle(b)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('порядке отрисовки')
  })

  it('сообщает обо всех нарушенных инвариантах, а не только о первом', () => {
    const b = bundle({
      screens: [screen({
        screenshotId: 'нет-такого',
        root: frameNode({
          id: 'dup', paintOrder: 0,
          children: [frameNode({ id: 'dup', paintOrder: 1 })],
        }),
      })],
    })
    const result = parseBundle(b)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('screenshotId')
    expect(result.error).toContain('id узла')
  })
})
```

- [ ] **Step 8: Запустить тесты и убедиться, что они падают**

Run: `pnpm vitest run packages/ir/test/validate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/validate.js"`.

- [ ] **Step 9: Создать `packages/ir/src/validate.ts`**

```ts
import { checkInvariants } from './invariants.js'
import { bundleSchema } from './schema.js'
import type { Bundle } from './types.js'
import { IR_VERSION, type BundleEnvelope } from './version.js'

export type ParseResult =
  | { ok: true; bundle: Bundle }
  | { ok: false; error: string }

/** Порядок проверок продуман: конверт, потом версия, потом форма, потом смысл.
 *  Каждая ступень даёт сообщение, которое человек может прочитать, вместо
 *  простыни zod поверх файла, который вообще не наш. */
export const parseBundle = (input: unknown): ParseResult => {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Бандл не является объектом.' }
  }

  const envelope = input as BundleEnvelope

  if (envelope.format !== 'w2f') {
    return {
      ok: false,
      error:
        'Файл не похож на бандл webpage2figma: отсутствует маркер формата. ' +
        'Выбери файл .w2f, созданный расширением.',
    }
  }

  if (envelope.version !== IR_VERSION) {
    return {
      ok: false,
      error:
        `Несовместимая версия IR: в файле ${String(envelope.version)}, ` +
        `эта половина ожидает ${IR_VERSION}. ` +
        `Обнови extension и плагин Figma до одной версии — бандл ` +
        `односверсионный артефакт, миграции не предусмотрены.`,
    }
  }

  const parsed = bundleSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first === undefined ? '<корень>' : first.path.join('.')
    const message = first === undefined ? 'неизвестная ошибка' : first.message
    return { ok: false, error: `Бандл повреждён в поле "${path}": ${message}` }
  }

  /** Инварианты сообщаются ВСЕ, а не до первого: они обычно следствие одной
   *  причины, и полный список экономит цикл «починил — снова упало». */
  const violations = checkInvariants(parsed.data)
  if (violations.length > 0) {
    const lines = violations.map((v) => `  • ${v.path}: ${v.message}`).join('\n')
    return {
      ok: false,
      error: `Бандл валиден по форме, но нарушает инварианты:\n${lines}`,
    }
  }

  return { ok: true, bundle: parsed.data }
}
```

- [ ] **Step 10: Обновить `packages/ir/src/index.ts`**

```ts
export * from './version.js'
export * from './codes.js'
export * from './types.js'
export * from './schema.js'
export * from './invariants.js'
export * from './validate.js'
```

- [ ] **Step 11: Запустить всё и проверить typecheck**

Run: `pnpm typecheck && pnpm vitest run packages/ir`
Expected: typecheck без ошибок — впервые с Task 2, потому что отсутствующие модули появились. Тесты: PASS, 14 + 10 тестов.

**Если аннотация `z.ZodType<IrNode>` или `z.ZodType<Bundle>` не проходит проверку типов — это сигнал, а не помеха.** Он означает, что зеркало разошлось с оригиналом. Найти расхождение и исправить схему. Убрать аннотацию или добавить приведение **запрещено**: именно она делает расхождение ошибкой компиляции вместо пропущенного бандла.

- [ ] **Step 12: Коммит**

```bash
git add packages/ir
git commit -m "feat(ir): валидация формы и инвариантов бандла"
```

---

## Task 3b: Инварианты, делающие правило проекта машинно-проверяемым

Появилась после второго раунда ревью. Ревьюер собрал бандлы и прогнал их через **настоящий** валидатор из Task 3 — приняты все четыре:

| бандл | результат |
|---|---|
| узел `kind:'placeholder'` при `report: []` | **принят** |
| `needsPlaceholder: true`, `nodeId` → обычный `frame` | **принят** |
| `needsPlaceholder: true`, `nodeId: null` — невыполнимо по построению | **принят** |
| повёрнутый блок с `transform` при `report: []` | **принят** |

Третий случай — ровно запрещённый молчаливый fallback: неподдерживаемая фича приезжает обычной пустой коробкой. Четвёртый шире: спека §7.1b требует диагностировать каждую отложенную фичу, но единственной защитой были шесть рукописных фикстур Task 13, а на живой странице не проверяло ничто. Данные для проверки уже лежат в бандле.

### Решение по семантике `needsPlaceholder`

Ревью указало на настоящий пробел в контракте: у флага не определено, означает он **замену** узла или **пометку** на нём. `unsupported.canvas` заменяет узел целиком; `deferred.gradient` висит на узле с реальными детьми и текстом, который заменять нельзя. Без решения проверка «`needsPlaceholder` ⟹ узел является заглушкой» отвергала бы легитимные бандлы.

**Решение: только замена.** `needsPlaceholder: true` означает «узел, на который я ссылаюсь, обязан быть `kind: 'placeholder'`». Коды класса пометки (`deferred.*` на узле с содержимым) выставляют `false`. Это проверяемо и не требует вводить понятие «дополнительный дочерний узел-аннотация».

**Files:**
- Modify: `packages/ir/src/types.ts` (док-комментарий `needsPlaceholder`)
- Modify: `packages/ir/src/invariants.ts`, `packages/ir/src/validate.ts`
- Modify: `packages/ir/test/invariants.test.ts`, `packages/ir/test/validate.test.ts`

- [ ] **Step 1: Зафиксировать семантику в контракте**

В `types.ts`, у поля `needsPlaceholder`, заменить док-комментарий на:

```ts
  /** Только ЗАМЕНА, не пометка: `true` означает, что узел по `nodeId`
   *  обязан быть `kind: 'placeholder'`. Коды, которые лишь помечают узел
   *  с реальным содержимым (`deferred.*` на блоке с детьми и текстом),
   *  выставляют `false` — заменять такой узел заглушкой нельзя.
   *  Без этого различения проверка связи «диагностика ↔ заглушка»
   *  отвергала бы легитимные бандлы. */
  needsPlaceholder: boolean
```

- [ ] **Step 2: Написать падающие тесты новых инвариантов**

Добавить в `packages/ir/test/invariants.test.ts`. Существующие тесты не менять.

```ts
describe('checkInvariants: связь заглушки и диагностики', () => {
  const placeholderNode = (id: string, code: string, paintOrder: number): IrNode => ({
    ...frameNode({ id, paintOrder }),
    kind: 'placeholder',
    placeholder: { code: code as DiagnosticCode, label: 'canvas' },
  })

  it('ловит заглушку, которую отчёт не объясняет', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [placeholderNode('ph', 'unsupported.canvas', 1)],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('placeholder.unexplained')
  })

  it('принимает заглушку с парной диагностикой', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      children: [placeholderNode('ph', 'unsupported.canvas', 1)],
    })
    const b = bundle({
      screens: [screen({ root })],
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'canvas',
        nodeId: 'ph', screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(checkInvariants(b)).toEqual([])
  })

  it('ловит needsPlaceholder: true с nodeId: null — невыполнимо по построению', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: null, screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('placeholder.no-host')
  })

  it('ловит needsPlaceholder: true, указывающий на обычный фрейм', () => {
    const b = bundle({
      report: [{
        level: 'warning', code: 'unsupported.canvas', message: 'x',
        nodeId: 'n0', screenId: 's0', needsPlaceholder: true,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('placeholder.wrong-host')
  })
})

describe('checkInvariants: отложенные фичи обязаны диагностироваться', () => {
  it('ловит transform без diagnostic', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      transform: { angle: 0.26, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('deferred.undiagnosed')
  })

  it('принимает transform с парной диагностикой deferred.transform', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      transform: { angle: 0.26, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
    })
    const b = bundle({
      screens: [screen({ root })],
      report: [{
        level: 'error', code: 'deferred.transform', message: 'x',
        nodeId: 'a', screenId: 's0', needsPlaceholder: false,
      }],
    })
    expect(checkInvariants(b)).toEqual([])
  })

  it('ловит blend без diagnostic', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      style: { ...frameNode().style, blend: 'multiply' },
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('deferred.undiagnosed')
  })

  it('ловит blur без diagnostic', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      style: { ...frameNode().style, blur: { layer: 4, background: 0 } },
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('deferred.undiagnosed')
  })
})

describe('checkInvariants: уникальность идентификаторов', () => {
  it('ловит дубль Asset.id — иначе картинка молча подменяется другой', () => {
    const b = bundle({
      assets: [
        { id: 'a1', mimeType: 'image/png', width: 1, height: 1, path: 'assets/logo.png' },
        { id: 'a1', mimeType: 'image/png', width: 2, height: 2, path: 'assets/hero.png' },
      ],
    })
    expect(codesOf(checkInvariants(b))).toContain('asset-id.duplicate')
  })

  it('ловит дубль Screen.id — иначе screenId в диагностике неоднозначен', () => {
    const b = bundle({
      screens: [
        screen({ id: 'same', root: frameNode({ id: 'x', paintOrder: 0 }) }),
        screen({ id: 'same', root: frameNode({ id: 'y', paintOrder: 0 }) }),
      ],
    })
    expect(codesOf(checkInvariants(b))).toContain('screen-id.duplicate')
  })
})

describe('checkInvariants: токены не в обход проверок', () => {
  it('ловит висячий assetId в paintStyles', () => {
    const b = bundle({
      tokens: {
        variables: [], textStyles: [],
        paintStyles: [{
          name: 'brand',
          fill: {
            kind: 'image',
            ref: {
              assetId: 'нет-такого',
              placement: { mode: 'fill', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
            },
          },
        }],
      },
    })
    expect(codesOf(checkInvariants(b))).toContain('asset.dangling')
  })

  it('ловит шрифт из textStyles, отсутствующий в fonts', () => {
    const b = bundle({
      tokens: {
        variables: [], paintStyles: [],
        textStyles: [{ name: 'h1', run: textRun({ usedFamily: 'Söhne', fontWeight: 700 }) }],
      },
    })
    expect(codesOf(checkInvariants(b))).toContain('font.uncovered')
  })
})

describe('checkInvariants: согласованность ссылок диагностики', () => {
  it('ловит диагностику, у которой узел и экран из разных экранов', () => {
    const b = bundle({
      screens: [
        screen({ id: 's0', root: frameNode({ id: 'на-нулевом', paintOrder: 0 }) }),
        screen({ id: 's1', root: frameNode({ id: 'на-первом', paintOrder: 0 }) }),
      ],
      report: [{
        level: 'info', code: 'fidelity.grid-flattened', message: 'x',
        nodeId: 'на-нулевом', screenId: 's1', needsPlaceholder: false,
      }],
    })
    expect(codesOf(checkInvariants(b))).toContain('diagnostic.screen-mismatch')
  })
})
```

Импорты теста дополнить: `import type { DiagnosticCode } from '../src/codes.js'` и `import type { IrNode } from '../src/types.js'`.

- [ ] **Step 3: Запустить и убедиться, что падает**

Run: `pnpm vitest run packages/ir/test/invariants.test.ts`
Expected: FAIL — новые коды не порождаются. Существующие 14 тестов обязаны остаться зелёными.

- [ ] **Step 4: Реализовать новые проверки в `invariants.ts`**

Добавить функции и включить их в `checkInvariants`. Требования к реализации:

1. `checkPlaceholders(bundle)` — три проверки. Для каждого узла `kind: 'placeholder'` обязана существовать диагностика с `nodeId === node.id` **и** `code === node.placeholder.code` (точная пара, а не «код встречается где-то в отчёте») → иначе `placeholder.unexplained`. Для каждой диагностики с `needsPlaceholder: true`: `nodeId === null` → `placeholder.no-host`; `nodeId` указывает на узел, у которого `kind !== 'placeholder'` → `placeholder.wrong-host`.

2. `checkDeferredDiagnosed(bundle)` — для каждого узла: `transform !== null` требует диагностику `deferred.transform` с этим `nodeId`; `style.blend !== 'normal'` → `deferred.blend`; `style.blur !== null` → `deferred.blur`; `kind === 'vector'` → `deferred.vector`. Отсутствие → `deferred.undiagnosed` с указанием, какая именно фича не объяснена.

   **Обязательный комментарий над функцией:** этот блок ограничен планом 1 и удаляется по фиче по мере их реализации в плане 2. Без такой пометки он превратится в окаменелость, которая начнёт отвергать корректные бандлы, как только фичи заработают.

3. `checkIdUniqueness` — дубли `Asset.id` и `Screen.id`.

4. Расширить `collectAssetRefs` и сбор `usedFonts` на `tokens.paintStyles` и `tokens.textStyles`. Обход токенов делать отдельной функцией, а не внутри обхода узлов: токены не принадлежат экрану.

5. `diagnostic.screen-mismatch`: если у диагностики заполнены и `nodeId`, и `screenId`, узел обязан принадлежать именно этому экрану.

- [ ] **Step 5: Ограничить объём сообщения об ошибке**

В `validate.ts`. Измеренная проблема: при 50 000 узлов с одинаковым `paintOrder` сообщение составляет **7,84 МБ** — пятьдесят тысяч почти одинаковых строк, отправляемых в UI плагина Figma.

Группировать нарушения по `code`, печатать первые десять каждого вида и добавлять `…и ещё N того же вида`. Политика «сообщать обо всех» правильная, но без ограничения она опровергает себя именно на том бандле, где нужна больше всего.

Тест: бандл с 200 узлами, у всех `paintOrder: 0`; итоговая строка короче 8000 символов и содержит `и ещё`.

- [ ] **Step 6: Прогнать всё**

Run: `pnpm typecheck && pnpm typecheck:root && pnpm vitest run packages/ir`
Expected: PASS. Существующие 24 теста плюс новые.

- [ ] **Step 7: Коммит**

```bash
git add packages/ir
git commit -m "feat(ir): инварианты связи заглушек и диагностик, отложенных фич, уникальности id"
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
  "name": "@w2f/serializer",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "build": "tsup" },
  "dependencies": { "@w2f/ir": "workspace:*" }
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
Expected: **exit 0 и полная тишина.** Не `TS18003`, как можно было бы ожидать.

Это проверено отдельно и стоит понимать, потому что шаблон обманчив: `tsc` поднимает `TS18003: No inputs were found` на пустом `include` только если у проекта **нет** `references`. С непустым `references` — а он здесь есть, `[{ "path": "../ir" }]` — компилятор молча ничего не делает. Проверка на воспроизведение:

```
пустой src, есть references:  exit 0, тишина
пустой src, БЕЗ references:   error TS18003: No inputs were found
```

Следствие, которое надо принять: **эта контрольная точка ничего не доказывает.** Тишина здесь совместима и с рабочим конфигом, и со сломанным. Поэтому вместо неё — проверка заведомой ошибкой, единственная форма, которая отличает работающую проверку от молчащей:

1. Создать `packages/serializer/src/_probe.ts` с содержимым `export const probe: number = 'строка'`.
2. Run: `pnpm typecheck` → обязана появиться ошибка о несовместимости типов в `_probe.ts`.
3. Удалить `_probe.ts` и убедиться, что `git status --short` его не показывает.

Если на шаге 2 ошибки нет — сломан `tsconfig`, и это надо починить до продолжения. То же касается всех задач, где `src` пакета ещё пуст: тишина `tsc` при `references` не является подтверждением.

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
import type { Rgba8 } from '@w2f/ir'

export const TRANSPARENT: Rgba8 = { r: 0, g: 0, b: 0, a: 0 }

const RGB_FUNCTIONAL =
  /^rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i

const parseAlpha = (raw: string | undefined): number => {
  if (raw === undefined) return 1
  if (raw.endsWith('%')) return Number.parseFloat(raw) / 100
  return Number.parseFloat(raw)
}

/** Резолв через растеризацию браузером: единственный способ уверенно
 *  разобрать oklch(), color-mix(), lab() и всё, что Chrome добавит позже. */
const resolveViaCanvas = (value: string): Rgba8 | null => {
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
export const parseColor = (value: string): Rgba8 | null => {
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

export const isInvisible = (color: Rgba8): boolean => color.a === 0
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
import type { Shadow } from '@w2f/ir'
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
import { hasNonSolidStroke, readStroke } from '../src/css/stroke.js'
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
    // Сравнение объекта ЦЕЛИКОМ, а не частичное: так тест поймает поле,
    // которое добавят в Stroke и забудут здесь. Именно поэтому style и
    // align перечислены явно, хотя ниже есть и отдельные тесты на них.
    expect(result).toEqual({
      color: { r: 255, g: 0, b: 0, a: 1 },
      weight: { top: 2, right: 2, bottom: 2, left: 2 },
      style: 'solid',
      align: 'inside',
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

  it('всегда выставляет align: inside', () => {
    const result = readStroke(style({ borderTopWidth: '1px' }))
    // CSS рисует границу внутрь бокса, а Figma по умолчанию по центру.
    // При значении по умолчанию каждый элемент с границей сдвинулся бы
    // на половину толщины — поле существует, чтобы плагин обязан был
    // выставить strokeAlign, а не забыть про него.
    expect(result?.align).toBe('inside')
  })

  it('читает solid по умолчанию', () => {
    expect(readStroke(style({ borderTopWidth: '1px' }))?.style).toBe('solid')
  })

  it('читает dashed и dotted вместо молчаливого приведения к solid', () => {
    expect(readStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'dashed',
    }))?.style).toBe('dashed')
    expect(readStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'dotted',
    }))?.style).toBe('dotted')
  })

  it('берёт стиль первой видимой стороны', () => {
    const result = readStroke(style({
      borderBottomWidth: '3px', borderBottomStyle: 'dotted',
    }))
    expect(result?.style).toBe('dotted')
  })

  it('сводит редкие стили CSS к solid — Figma их не имеет', () => {
    // double, groove, ridge, inset, outset в Figma невыразимы.
    // Приведение к solid допустимо только вместе с диагностикой,
    // которую порождает вызывающий через hasNonSolidStroke.
    expect(readStroke(style({
      borderTopWidth: '4px', borderTopStyle: 'double',
    }))?.style).toBe('solid')
  })
})

describe('hasNonSolidStroke', () => {
  it('false при отсутствии границ', () => {
    expect(hasNonSolidStroke(style({}))).toBe(false)
  })

  it('false для solid', () => {
    expect(hasNonSolidStroke(style({ borderTopWidth: '1px' }))).toBe(false)
  })

  it('true для dashed — рендерер плана 1 штрихи не рисует', () => {
    expect(hasNonSolidStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'dashed',
    }))).toBe(true)
  })

  it('true для стиля, невыразимого в Figma', () => {
    expect(hasNonSolidStroke(style({
      borderTopWidth: '2px', borderTopStyle: 'groove',
    }))).toBe(true)
  })

  it('не срабатывает на невидимой границе нулевой толщины', () => {
    expect(hasNonSolidStroke(style({ borderTopStyle: 'dashed' }))).toBe(false)
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
import type { Corner } from '@w2f/ir'
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
import type { Stroke, StrokeStyle } from '@w2f/ir'
import { parseColor } from './color.js'
import { parsePx } from './length.js'

type Side = 'Top' | 'Right' | 'Bottom' | 'Left'
const SIDES: readonly Side[] = ['Top', 'Right', 'Bottom', 'Left']

const widthOf = (cs: CSSStyleDeclaration, side: Side): number => {
  const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`)
  if (style === 'none' || style === 'hidden') return 0
  return parsePx(cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
}

const styleOf = (cs: CSSStyleDeclaration, side: Side): string =>
  cs.getPropertyValue(`border-${side.toLowerCase()}-style`)

/** Из стилей границ CSS у Figma есть только сплошная и пунктир через
 *  `dashPattern`. `double`, `groove`, `ridge`, `inset`, `outset`
 *  невыразимы и сводятся к `solid` — но только вместе с диагностикой,
 *  которую порождает вызывающий через `hasNonSolidStroke`. */
const strokeStyleOf = (value: string): StrokeStyle => {
  if (value === 'dashed') return 'dashed'
  if (value === 'dotted') return 'dotted'
  return 'solid'
}

/** Figma поддерживает разную толщину обводки по сторонам, но только один
 *  цвет и один стиль на узел. Берём цвет и стиль первой видимой стороны;
 *  расхождение по сторонам фиксирует вызывающий через Diagnostic. */
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
    if (color !== null && color.a > 0) {
      return {
        color,
        weight,
        style: strokeStyleOf(styleOf(cs, side)),
        // Всегда 'inside': CSS рисует границу внутрь бокса. Значение
        // по умолчанию Figma ('CENTER') сдвинуло бы каждый элемент
        // с границей на половину толщины.
        align: 'inside',
      }
    }
  }
  return null
}

/** Видимая граница имеет стиль, который рендерер плана 1 не воспроизводит
 *  либо Figma не имеет вовсе. Вызывающий обязан породить `strokeStyleFlattened`:
 *  пунктирный разделитель, приехавший сплошным, — молчаливая потеря. */
export const hasNonSolidStroke = (cs: CSSStyleDeclaration): boolean =>
  SIDES.some((side) => widthOf(cs, side) > 0 && styleOf(cs, side) !== 'solid')

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
Expected: PASS, 18 тестов.

- [ ] **Step 6: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): чтение обводок со стилем и радиусов углов"
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
import {
  establishesStackingContext,
  findInterleaved,
  resolvePaintOrder,
} from '../src/stacking.js'
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

  // Считать узлы дерева обязательно. Проверка «все индексы уникальны»
  // сама по себе бесполезна: ПРОПАВШИЙ узел делает оставшиеся индексы
  // тривиально уникальными, и такой тест прошёл бы даже на пустой карте.
  // Ровно так и была пропущена потеря поддеревьев у непозиционированных
  // stacking context.
  const countNodes = (p: LayoutProbe): number =>
    1 + p.children.reduce((sum, child) => sum + countNodes(child), 0)

  const expectDensePermutation = (root: LayoutProbe): void => {
    const order = resolvePaintOrder(root)
    const total = countNodes(root)
    expect(order.size, 'испущен индекс не для каждого узла').toBe(total)
    const values = [...order.values()].sort((a, b) => a - b)
    expect(values).toEqual([...Array(total).keys()])
  }

  it('испускает плотную перестановку 0..n-1 по всем узлам', () => {
    expectDensePermutation(probe('root', {
      children: [probe('a', { children: [probe('b')] }), probe('c')],
    }))
  })

  it('не теряет поддерево у stacking context из opacity', () => {
    expectDensePermutation(probe('root', {
      children: [probe('ctx', { opacity: 0.5, children: [probe('kid')] })],
    }))
  })

  it('не теряет поддерево у stacking context из transform, filter, blend и isolation', () => {
    for (const trigger of [
      { hasTransform: true },
      { hasFilter: true },
      { hasMixBlendMode: true },
      { isIsolated: true },
    ]) {
      expectDensePermutation(probe('root', {
        children: [probe('ctx', { ...trigger, children: [probe('kid')] })],
      }))
    }
  })

  it('держит плотность на дереве со всеми видами участников разом', () => {
    expectDensePermutation(probe('root', {
      children: [
        probe('flow', { children: [probe('deep', { children: [probe('deeper')] })] }),
        probe('faded', { opacity: 0.4, children: [probe('in-faded')] }),
        probe('abs', { position: 'absolute', children: [probe('in-abs')] }),
        probe('over', { position: 'relative', zIndex: 4, children: [probe('in-over')] }),
        probe('under', { position: 'relative', zIndex: -2 }),
        probe('floated', { isFloat: true }),
        probe('inl', { isInline: true }),
        probe('flex-kid', { parentIsFlexOrGrid: true, zIndex: 2 }),
      ],
    }))
  })

  // Два теста ниже — ядро задачи. Первая редакция резолвера их не проходила:
  // она бакетировала только ПРЯМЫХ детей контекста, из-за чего
  // позиционированный потомок, спрятанный за обычной потоковой обёрткой,
  // не сравнивался по z-index с соседями обёртки. Остальные тесты этого не
  // ловили, потому что в каждом z-индексированный узел — прямой ребёнок
  // контекста.

  it('поднимает позиционированного потомка из потоковой обёртки в предка-контекст', () => {
    // wrapper не создаёт контекст, поэтому P (z=5) обязан сравниваться
    // с B (z=3) в корневом контексте и красится ПОВЕРХ него.
    const root = probe('root', {
      children: [
        probe('wrapper', {
          children: [probe('P', { position: 'relative', zIndex: 5 })],
        }),
        probe('B', { position: 'relative', zIndex: 3 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'wrapper', 'B', 'P'])
  })

  it('поднимает потомка с отрицательным z-index под фон потоковой обёртки', () => {
    const root = probe('root', {
      children: [
        probe('wrapper', {
          children: [probe('under', { position: 'relative', zIndex: -1 })],
        }),
        probe('sibling'),
      ],
    })
    // under уходит в отрицательный бакет КОРНЕВОГО контекста, то есть
    // красится раньше и обёртки, и её потокового соседа.
    expect(orderOf(root)).toEqual(['root', 'under', 'wrapper', 'sibling'])
  })

  it('не поднимает потомка сквозь узел, который сам создаёт контекст', () => {
    // ctx создаёт контекст (позиционирован и имеет z-index), поэтому
    // inner заперт внутри и не может перекрыть sibling с z-index 2.
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

  it('не считает z-index у статичного элемента: случайный z-index: 0 не поднимает его', () => {
    // getComputedStyle возвращает указанное значение и для статики,
    // поэтому копипастный `z-index: 0` не должен менять порядок.
    const root = probe('root', {
      children: [
        probe('static-with-z', { zIndex: 0 }),
        probe('plain'),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'static-with-z', 'plain'])
  })

  it('поднимает flex-ребёнка с z-index сквозь потоковую обёртку — осознанно', () => {
    // По тому же правилу «ближайший предок-КОНТЕКСТ»: flex-ребёнок с
    // числовым z-index создаёт контекст, поэтому участвует в стекинге
    // предка, а не обёртки. Поведение зафиксировано тестом, потому что
    // оно неочевидно и проверять его больше нечем.
    const root = probe('root', {
      children: [
        probe('wrapper', {
          children: [probe('fc', { parentIsFlexOrGrid: true, zIndex: 5 })],
        }),
        probe('sib', { position: 'relative', zIndex: 3 }),
      ],
    })
    expect(orderOf(root)).toEqual(['root', 'wrapper', 'sib', 'fc'])
  })
})

describe('findInterleaved', () => {
  it('на непереплетённом дереве не находит ничего', () => {
    const root = probe('root', {
      children: [probe('a', { children: [probe('b')] }), probe('c')],
    })
    expect(findInterleaved(root, resolvePaintOrder(root))).toEqual([])
  })

  it('находит поддерево, чей диапазон влез внутрь чужого', () => {
    // P поднят из wrapper и красится после B, из-за чего диапазон
    // поддерева wrapper разрывается диапазоном B. Дерево Figma такой
    // порядок выразить не может: там z-порядок задаётся порядком
    // среди сиблингов.
    const root = probe('root', {
      children: [
        probe('wrapper', {
          children: [probe('P', { position: 'relative', zIndex: 5 })],
        }),
        probe('B', { position: 'relative', zIndex: 3 }),
      ],
    })
    const found = findInterleaved(root, resolvePaintOrder(root))
    expect(found.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/stacking.test.ts`
Expected: FAIL — `Failed to resolve import "../src/stacking.js"`.

- [ ] **Step 4: Создать `packages/serializer/src/stacking.ts`**

**Ядро задачи — подъём позиционированных потомков.** Правило CSS: позиционированный элемент участвует в стекинге ближайшего предка-**контекста**, а не своего родителя. Первая редакция этого не делала — бакетировала только прямых детей — и давала классическую ошибку: выпадающее меню с `z-index: 5` внутри непозиционированной обёртки уезжало под соседа обёртки с `z-index: 3`.

```ts
import type { LayoutProbe } from './probe.js'

const isPositioned = (p: LayoutProbe): boolean => p.position !== 'static'

/** Условия создания stacking context по CSS Positioned Layout и Compositing.
 *  Реализован практически доминирующий набор триггеров; редкие
 *  (`will-change`, `perspective`, сочетания `contain`) не учитываются
 *  и фиксируются вызывающим как Diagnostic. */
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

/** Узел участвует в стекинге контекста как самостоятельная единица,
 *  а не как часть потока. Сюда попадают позиционированные с `z-index: auto`:
 *  контекста они не создают, но красятся атомарно в бакете z=0.
 *
 *  Упрощение зафиксировано сознательно: по спецификации позиционированные
 *  потомки такого узла могут «убежать» в предка-контекст. Случай редкий,
 *  и вместо его моделирования вызывающий обязан породить Diagnostic —
 *  молчаливо неверный порядок недопустим, честное «не умеем» допустимо. */
const isStackingParticipant = (p: LayoutProbe): boolean =>
  isPositioned(p) || (p.parentIsFlexOrGrid && p.zIndex !== 'auto')

/** Тот же предикат под экспортируемым именем: нужен детектору
 *  приближения, а дублировать логику нельзя. */
export const isStackingParticipantExported = isStackingParticipant

type Bucket = 'negative' | 'flow' | 'float' | 'inline' | 'auto' | 'positive'

type Groups = Record<Bucket, LayoutProbe[]>

const emptyGroups = (): Groups => ({
  negative: [], flow: [], float: [], inline: [], auto: [], positive: [],
})

const bucketOf = (p: LayoutProbe): Bucket => {
  const z = p.zIndex
  /** `z-index` осмыслен только у позиционированных и у детей flex/grid.
   *  У статичного элемента `getComputedStyle` вернёт указанное значение,
   *  поэтому случайный `z-index: 0` на статике не должен поднимать его
   *  над потоковыми соседями. */
  const zMatters = isPositioned(p) || p.parentIsFlexOrGrid
  if (zMatters && typeof z === 'number' && z < 0) return 'negative'
  if (zMatters && typeof z === 'number' && z > 0) return 'positive'
  if (isPositioned(p)) return 'auto'
  if (zMatters && typeof z === 'number' && z === 0) return 'auto'
  if (p.isFloat) return 'float'
  if (p.isInline) return 'inline'
  return 'flow'
}

const zValue = (p: LayoutProbe): number => (p.zIndex === 'auto' ? 0 : p.zIndex)

/** Стабильная сортировка по z-index: при равных значениях сохраняется
 *  порядок документа, как того требует спецификация. */
const byZIndex = (items: LayoutProbe[]): LayoutProbe[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => zValue(a.item) - zValue(b.item) || a.index - b.index)
    .map(({ item }) => item)

/**
 * Порядок отрисовки внутри stacking context, по CSS 2.1 Appendix E:
 * сам элемент → отрицательные z-index → потоковые блоки → флоаты →
 * инлайны → позиционированные с auto/0 → положительные z-index.
 *
 * Возвращает Map id → индекс отрисовки. Индексы плотные и уникальные,
 * и это инвариант, который валидируется в `@w2f/ir`.
 */
export const resolvePaintOrder = (root: LayoutProbe): Map<string, number> => {
  const order = new Map<string, number>()
  let counter = 0

  const emit = (p: LayoutProbe): void => {
    order.set(p.id, counter)
    counter += 1
  }

  /** Собирает участников стекинга ОДНОГО контекста, поднимая
   *  позиционированных потомков из обычных потоковых обёрток.
   *
   *  Потоковый ребёнок кладётся в бакет `flow` И его дети продолжают
   *  собираться в ЭТОТ ЖЕ контекст — в этом и состоит подъём. Ребёнок,
   *  который создаёт контекст или участвует в стекинге самостоятельно,
   *  кладётся в свой бакет, а его поддерево красится вместе с ним,
   *  поэтому обход в него не заходит. */
  const collectInto = (node: LayoutProbe, groups: Groups): void => {
    for (const child of node.children) {
      if (establishesStackingContext(child) || isStackingParticipant(child)) {
        groups[bucketOf(child)].push(child)
        continue
      }
      groups[bucketOf(child)].push(child)
      collectInto(child, groups)
    }
  }

  /** Красит узел, который сам не создаёт контекст и не участвует в стекинге
   *  самостоятельно: его собственные дети уже собраны родительским
   *  `collectInto`, поэтому красится только он. */
  const paintFlowNode = (p: LayoutProbe): void => {
    emit(p)
  }

  /** Красит атомарную единицу: контекст или позиционированный узел
   *  с `z-index: auto`. Оба красятся вместе со своим поддеревом. */
  const paintUnit = (p: LayoutProbe): void => {
    emit(p)
    const groups = emptyGroups()
    collectInto(p, groups)
    paintGroups(groups)
  }

  /** Различение «атомарная единица» против «потоковая обёртка» вычисляется
   *  в `collectInto`, но к моменту покраски остаётся только ярлык бакета,
   *  а его недостаточно: stacking context, созданный НЕ позиционированием
   *  (`opacity < 1`, `transform`, `filter`, `mix-blend-mode`, `isolation`),
   *  попадает в `flow`, потому что `zMatters` и `isPositioned` для него
   *  ложны. Поэтому различение восстанавливается здесь.
   *
   *  Без этого `<div style="opacity:.5">` с содержимым терял ВСЁ поддерево:
   *  `collectInto` внутрь не спускался (правильно — узел атомарен), а
   *  `paintFlowNode` только испускал индекс. Ни одна сторона поддерево
   *  не посещала, и инвариант плотности в `@w2f/ir` отверг бы такой бандл.
   *
   *  Размещение в бакете `flow` при этом верное: по CSS 2.1 Appendix E
   *  непозиционированный stacking context красится атомарно на своём
   *  месте в потоке. Неверен был только красильщик. */
  const paintInFlow = (p: LayoutProbe): void => {
    if (establishesStackingContext(p)) paintUnit(p)
    else paintFlowNode(p)
  }

  const paintGroups = (groups: Groups): void => {
    for (const child of byZIndex(groups.negative)) paintUnit(child)
    for (const child of groups.flow) paintInFlow(child)
    for (const child of groups.float) paintInFlow(child)
    for (const child of groups.inline) paintInFlow(child)
    for (const child of byZIndex(groups.auto)) paintUnit(child)
    for (const child of byZIndex(groups.positive)) paintUnit(child)
  }

  paintUnit(root)
  return order
}

/** Находит узлы, для которых порядок отрисовки ПРИБЛИЖЁН.
 *
 *  `isStackingParticipant` считает атомарным любой позиционированный узел,
 *  включая `z-index: auto`. По CSS 2.1 Appendix E шаг 8 такой узел
 *  красится как если бы создавал контекст, **но его позиционированные
 *  потомки и потомки, создающие контекст, принадлежат РОДИТЕЛЬСКОМУ
 *  контексту**, то есть должны подниматься сквозь него. Резолвер этого не
 *  делает — сознательное упрощение, подтверждённое в настоящем Chrome.
 *
 *  Упрощение допустимо, молчание о нём — нет. Функция находит ровно те
 *  случаи, где оно могло сказаться: позиционированный узел с
 *  `z-index: auto`, в поддереве которого есть участник стекинга.
 *  Там, где таких потомков нет, приближение ни на что не влияет и
 *  диагностика была бы шумом.
 *
 *  Замену упрощения настоящим подъёмом ведёт план 2: у этого алгоритма
 *  уже три раунда исправлений, каждый вносил новый дефект, и четвёртый
 *  без падающего pixel-diff в качестве ориентира делать не стоит. */
export const findApproximatedOrder = (root: LayoutProbe): string[] => {
  const approximated: string[] = []

  const hasParticipantInside = (p: LayoutProbe): boolean =>
    p.children.some(
      (child) =>
        establishesStackingContext(child) ||
        isStackingParticipantExported(child) ||
        hasParticipantInside(child),
    )

  const visit = (p: LayoutProbe): void => {
    if (
      p.position !== 'static' &&
      p.zIndex === 'auto' &&
      !establishesStackingContext(p) &&
      hasParticipantInside(p)
    ) {
      approximated.push(p.id)
    }
    for (const child of p.children) visit(child)
  }

  visit(root)
  return approximated
}

/** Позиционированные потомки узла, который сам не создаёт контекст,
 *  подняты в предка-контекст. Это правильно по CSS, но означает, что
 *  дерево Figma такой порядок выразить не сможет: в Figma z-порядок
 *  задаётся порядком среди СИБЛИНГОВ. Функция находит такие случаи,
 *  чтобы плагин мог либо перестроить дерево, либо честно сообщить.
 *
 *  Живёт здесь, а не в рендерере: её нужны и рендерер, и плагин Figma. */
export const findInterleaved = (
  root: LayoutProbe,
  order: Map<string, number>,
): string[] => {
  const interleaved: string[] = []

  const subtreeIds = (p: LayoutProbe, out: Set<string>): Set<string> => {
    out.add(p.id)
    for (const child of p.children) subtreeIds(child, out)
    return out
  }

  const all: LayoutProbe[] = []
  const flatten = (p: LayoutProbe): void => {
    all.push(p)
    for (const child of p.children) flatten(child)
  }
  flatten(root)

  /** Помечается только вклинивание узла, который МОЖЕТ перекрывать —
   *  участника стекинга или создателя контекста.
   *
   *  Ограничение обязательное, иначе диагностика превращается в шум.
   *  По CSS 2.1 Appendix E фоны блоков красятся на шаге 3, а инлайновое
   *  содержимое на шаге 5, поэтому `<b>` внутри первого абзаца красится
   *  ПОСЛЕ второго абзаца, и диапазон первого оказывается разорван.
   *  Порядок при этом верный, а для Figma безразличен: инлайновый текст
   *  не перекрывает соседний блок, и вложенность даёт тот же результат.
   *  Без этого ограничения диагностика срабатывала бы на каждом абзаце со
   *  ссылкой или выделением, за которым идёт другой абзац — то есть почти
   *  на каждой странице. Диагностика, срабатывающая всегда, учит
   *  игнорировать отчёт целиком. */
  const canOverlap = (p: LayoutProbe): boolean =>
    establishesStackingContext(p) || isStackingParticipantExported(p)

  for (const node of all) {
    const own = order.get(node.id)
    if (own === undefined) continue

    const ids = subtreeIds(node, new Set<string>())
    let min = own
    let max = own
    for (const id of ids) {
      const value = order.get(id)
      if (value === undefined) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    if (max - min + 1 === ids.size) continue

    const intruder = all.find((other) => {
      if (ids.has(other.id)) return false
      const value = order.get(other.id)
      if (value === undefined) return false
      return value > min && value < max && canOverlap(other)
    })
    if (intruder !== undefined) interleaved.push(node.id)
  }

  return [...new Set(interleaved)]
}
```

Обрати внимание на `collectInto`: обе ветки кладут узел в бакет, и различаются только тем, спускается ли обход внутрь. Это не дублирование, которое надо свернуть — это и есть смысловая развилка между «атомарная единица» и «потоковая обёртка, чьи позиционированные потомки поднимаются выше».

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/stacking.test.ts`
Expected: PASS, 24 теста.

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

  it('normal gap даёт ноль — проверка результата, не ветки', () => {
    // Намеренно отмечено: эта проверка НЕ доказывает существование
    // отдельной обработки 'normal'. parsePx возвращает ноль на любом
    // неразбираемом значении, поэтому результат тот же и без неё.
    // Ветка удалена как мёртвая; тест оставлен, потому что сам
    // результат важен.
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
import type { LayoutAlign, LayoutJustify, LayoutMode, NodeLayout } from '@w2f/ir'
import { parsePx } from './css/length.js'

/** `column-gap: normal` для flex и grid означает ноль, и `parsePx` уже
 *  возвращает ноль на любом неразбираемом значении — это его
 *  задокументированный и протестированный контракт. Отдельная ветка на
 *  'normal' была бы мёртвым кодом: её удаление не смогло бы сломать ни
 *  один тест, то есть проверить её существование нечем. */
const gapValue = (value: string): number => parsePx(value)

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

**Тело переписано после ревизии контракта.** Реализация правила «молчаливый fallback — это баг»: каждое место, где сериализатор чего-то не умеет, обязано позвать сюда.

Два изменения против первой редакции, каждое по конкретной причине.

**Коды больше не определяются здесь.** Они живут в `@w2f/ir` (файл `codes.ts`), и задача их импортирует. Причина: плагин Figma обязан знать коды, чтобы отрисовать отчёт, но импортировать из сериализатора не может — тот собирается как IIFE для контекста страницы. Держать список здесь означало бы, что плагин его дублирует или сравнивает строки, и первый же новый код провалился бы в плагине в общую ветку без заглушки.

**`needsPlaceholder` — обязательный параметр, а не со значением по умолчанию.** Решение осознанное: значение по умолчанию приглашает забыть, а забытая заглушка означает, что неподдерживаемая фича приедет обычной пустой коробкой. Пусть каждый вызов решает явно. Инвариант в `@w2f/ir` проверяет согласованность, но лучше не доводить до отказа валидатора.

**Files:**
- Create: `packages/serializer/src/diagnostics.ts`
- Test: `packages/serializer/test/diagnostics.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES } from '@w2f/ir'
import { DiagnosticSink } from '../src/diagnostics.js'

describe('DiagnosticSink', () => {
  it('начинается пустым', () => {
    expect(new DiagnosticSink('s0').drain()).toEqual([])
  })

  it('записывает диагностику со стабильным screenId, а не с именем экрана', () => {
    const sink = new DiagnosticSink('s3')
    sink.report(
      'warning', DIAGNOSTIC_CODES.unsupportedCanvas,
      'canvas не переносится', 'n7', true,
    )
    expect(sink.drain()).toEqual([
      {
        level: 'warning',
        code: 'unsupported.canvas',
        message: 'canvas не переносится',
        nodeId: 'n7',
        screenId: 's3',
        needsPlaceholder: true,
      },
    ])
  })

  it('пишет needsPlaceholder: false для кодов класса пометки', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid сведён', 'n1', false)
    expect(sink.drain()[0]?.needsPlaceholder).toBe(false)
  })

  it('дедуплицирует одинаковые записи по коду и узлу', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n1', true)
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'два', 'n1', true)
    expect(sink.drain()).toHaveLength(1)
  })

  it('не дедуплицирует один код на разных узлах', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n1', true)
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas, 'раз', 'n2', true)
    expect(sink.drain()).toHaveLength(2)
  })

  it('не дедуплицирует разные коды на одном узле', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid', 'n1', false)
    sink.report('info', DIAGNOSTIC_CODES.stickyFlattened, 'sticky', 'n1', false)
    expect(sink.drain()).toHaveLength(2)
  })

  it('различает записи с nodeId: null и с узлом', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'без узла', null, false)
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'с узлом', 'n1', false)
    expect(sink.drain()).toHaveLength(2)
  })

  it('различает nodeId: null и узел с id "null" — за это и нужен сентинел', () => {
    // Без сентинела `${code}|${nodeId}` даёт одинаковый ключ для null и
    // для строки "null": интерполяция превращает null в "null". Сегодня
    // идентификаторы генерируются как n0, n1, и коллизия недостижима — но
    // сток общего назначения обязан различать «узла нет» от любой строки,
    // а защита без теста есть украшение. Этот тест делает сентинел
    // проверяемым: убери его из ключа, и тест упадёт.
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'без узла', null, false)
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'узел с таким id', 'null', false)
    expect(sink.drain()).toHaveLength(2)
  })

  it('drain не разрушает накопленное — отчёт можно прочитать дважды', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid', 'n1', false)
    expect(sink.drain()).toHaveLength(1)
    expect(sink.drain()).toHaveLength(1)
  })

  it('drain отдаёт копию: правка результата не портит накопленное', () => {
    const sink = new DiagnosticSink('s0')
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened, 'grid', 'n1', false)
    const first = sink.drain()
    first.pop()
    expect(sink.drain()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/diagnostics.test.ts`
Expected: FAIL — `Failed to resolve import "../src/diagnostics.js"`.

- [ ] **Step 3: Создать `packages/serializer/src/diagnostics.ts`**

```ts
import type { Diagnostic, DiagnosticCode, DiagnosticLevel } from '@w2f/ir'

/** Собирает диагностику одного экрана.
 *
 *  Коды не определяются здесь: они живут в `@w2f/ir`, потому что их обязан
 *  знать плагин Figma, а импортировать из сериализатора он не может —
 *  тот собирается как IIFE для контекста страницы. */
export class DiagnosticSink {
  private readonly items: Diagnostic[] = []
  private readonly seen = new Set<string>()

  constructor(private readonly screenId: string) {}

  /** `needsPlaceholder` обязателен намеренно: значение по умолчанию
   *  приглашает забыть, а забытая заглушка означает, что неподдерживаемая
   *  фича приедет в Figma обычной пустой коробкой. Пусть каждый вызов
   *  решает явно.
   *
   *  Семантика — только ЗАМЕНА: `true` означает, что узел по `nodeId`
   *  обязан быть `kind: 'placeholder'`. Коды, которые лишь помечают узел
   *  с реальным содержимым, передают `false`. */
  report(
    level: DiagnosticLevel,
    code: DiagnosticCode,
    message: string,
    nodeId: string | null,
    needsPlaceholder: boolean,
  ): void {
    /** Дедупликация по паре код + узел. Один и тот же изъян на одном узле
     *  не должен попадать в отчёт дважды, но тот же изъян на другом узле —
     *  отдельная запись: пользователю нужно знать, сколько мест затронуто. */
    const key = `${code}|${nodeId ?? '<null>'}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.items.push({
      level, code, message, nodeId, screenId: this.screenId, needsPlaceholder,
    })
  }

  /** Отдаёт копию: вызывающий не должен иметь возможности испортить
   *  накопленное, и читать отчёт можно многократно. */
  drain(): Diagnostic[] {
    return [...this.items]
  }
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `pnpm vitest run packages/serializer/test/diagnostics.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): сборщик диагностики с кодами из @w2f/ir"
```

---

## Task 10: Чтение текста

**Тело переписано после ревизии контракта.** Текст снимается построчно через `Range.getClientRects()`, потому что Figma переносит строки сама и почти наверняка иначе, чем браузер.

Четыре изменения против первой редакции, каждое закрывает найденную ревью молчаливую потерю.

**`run.text` — только собственный текст узла.** Было `el.textContent`, то есть весь подграф, при том что `readLines` обходит только прямые текстовые узлы. Для `<p>Hello <b>world</b></p>` абзац получал `runs[0].text = "Hello world"` и одну строку `"Hello"`, а `<b>` — свой узел со своим «world». Референс-рендерер читает только `lines` и оставался зелёным; плагин Figma взял бы `runs[0].text` и нарисовал «world» дважды с наложением. Инвариант в `@w2f/ir` теперь требует, чтобы конкатенация ранов равнялась конкатенации строк.

**`fontStack` и `usedFamily` вместо `fontFamily`.** Было: берётся первое семейство из объявленного списка. Но если его нет в системе, браузер рисует следующим, и `lines` содержат метрики **фактического** шрифта, а IR называет объявленный. В Figma, где объявленный шрифт может быть установлен, плагин применил бы чужие метрики и получил вылезающий из боксов текст, считая, что шрифт найден. Спека требует, чтобы этот отчёт «кричал» — теперь он может.

**`lineHeight` и `align` переехали в `NodeText`.** Это свойства абзаца: два рана не должны иметь возможности противоречить друг другу, заставляя плагин выбирать произвольно.

**`text-transform` применяется к строке.** В Figma этого свойства нет, поэтому спека §7.1 обещает применять его к содержимому. Первая редакция не применяла, и текст приезжал не тем регистром при зелёном гейте: рендерер сравнивал бы одну и ту же непреобразованную строку с обеих сторон. Ни валидатор, ни pixel-diff такую потерю увидеть не могут — оба ловят несогласованные бандлы, а не потерявшие данные.

**Files:**
- Create: `packages/serializer/src/text.ts`

- [ ] **Step 1: Создать `packages/serializer/src/text.ts`**

```ts
import type { NodeText, TextAlign, TextDecoration, TextRun } from '@w2f/ir'
import { parseColor } from './css/color.js'
import { parsePx } from './css/length.js'
import { parseBoxShadow } from './css/shadow.js'

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
 *  точная величина восстанавливается из боксов строк. */
const lineHeightOf = (cs: CSSStyleDeclaration, fontSize: number): number => {
  if (cs.lineHeight === 'normal') return Math.round(fontSize * 1.2 * 100) / 100
  return parsePx(cs.lineHeight)
}

/** Разбирает объявленный `font-family` в список семейств.
 *  Кавычки снимаются, generic-семейства остаются: они значимы для отчёта. */
export const parseFontStack = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter((part) => part !== '')

/** Находит семейство, которым браузер РЕАЛЬНО рисовал.
 *
 *  Это не педантизм: если объявлено `"Söhne", Helvetica` и Söhne в системе
 *  нет, браузер рисует Helvetica, и `lines` содержат метрики Helvetica.
 *  Записав в IR «Söhne», мы заставили бы плагин применить метрики Helvetica
 *  к настоящему Söhne (который в Figma может быть установлен) и получить
 *  вылезающий текст — причём с точки зрения IR шрифт был бы «найден»,
 *  и диагностика бы не сработала.
 *
 *  `document.fonts.check` отвечает на вопрос «доступно ли это семейство
 *  для рисования». Первое доступное из стека и есть использованное. */
export const findUsedFamily = (stack: string[], fontSize: number): string => {
  if (typeof document === 'undefined' || document.fonts === undefined) {
    return stack[0] ?? 'sans-serif'
  }
  for (const family of stack) {
    try {
      if (document.fonts.check(`${fontSize}px "${family}"`)) return family
    } catch {
      // Некорректное для CSS имя семейства: пропускаем, не роняя захват.
      continue
    }
  }
  return stack[0] ?? 'sans-serif'
}

/** Применяет `text-transform` к самой строке.
 *
 *  В Figma этого свойства нет, поэтому преобразование обязано произойти
 *  здесь. Потеря невидима для обоих нижних слоёв: валидатор ловит
 *  несогласованные бандлы, а pixel-diff сравнивал бы одну и ту же
 *  непреобразованную строку с обеих сторон и остался бы зелёным. */
export const applyTextTransform = (text: string, cs: CSSStyleDeclaration): string => {
  switch (cs.textTransform) {
    case 'uppercase': return text.toLocaleUpperCase()
    case 'lowercase': return text.toLocaleLowerCase()
    case 'capitalize':
      return text.replace(
        /(^|\s)(\p{L})/gu,
        (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase(),
      )
    default: return text
  }
}

const weightOf = (cs: CSSStyleDeclaration): number => {
  const parsed = Number.parseInt(cs.fontWeight, 10)
  return Number.isNaN(parsed) ? 400 : parsed
}

/** Собственный текст узла: только ПРЯМЫЕ текстовые дети, без подграфа.
 *  Инвариант контракта требует, чтобы это равнялось конкатенации `lines`. */
const ownText = (el: Element): string => {
  let out = ''
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    out += node.textContent ?? ''
  }
  return out
}

/** Находит подстроку, попадающую в данный бокс строки, двигая границу
 *  Range посимвольно от позиции `from`. Единственный надёжный способ
 *  узнать, где именно браузер поставил перенос. */
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

/** Собирает боксы строк для прямых текстовых детей элемента. */
const readLines = (
  el: Element,
  cs: CSSStyleDeclaration,
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

    let cursor = 0
    for (const rect of rects) {
      const raw = sliceForRect(node, rect, cursor)
      cursor += raw.length
      lines.push({
        x: rect.left + scrollX,
        y: rect.top + scrollY,
        w: rect.width,
        h: rect.height,
        // Преобразование применяется и к строкам, и к рану — инвариант
        // контракта сверяет их конкатенации между собой.
        text: applyTextTransform(raw, cs),
      })
    }
    range.detach()
  }
  return lines
}

export type ReadTextResult =
  | { kind: 'text'; text: NodeText }
  | { kind: 'none' }
  /** Текст есть, но боксов строк нет. Молча вернуть «нет текста» означало бы,
   *  что он исчезает, не оставив в бандле следа, по которому это можно
   *  обнаружить ниже по конвейеру. Вызывающий обязан породить Diagnostic. */
  | { kind: 'lost'; sample: string }

export const readText = (
  el: Element,
  cs: CSSStyleDeclaration,
  scrollX: number,
  scrollY: number,
): ReadTextResult => {
  const own = ownText(el)
  if (own.trim() === '') return { kind: 'none' }

  const fontSize = parsePx(cs.fontSize)
  const stack = parseFontStack(cs.fontFamily)
  const color = parseColor(cs.color)

  const run: TextRun = {
    text: applyTextTransform(own, cs),
    fontStack: stack.length > 0 ? stack : ['sans-serif'],
    usedFamily: findUsedFamily(stack, fontSize),
    fontWeight: weightOf(cs),
    fontStyle: cs.fontStyle === 'italic' ? 'italic' : 'normal',
    fontSize,
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : parsePx(cs.letterSpacing),
    color: color ?? { r: 0, g: 0, b: 0, a: 1 },
    decoration: decorationOf(cs),
    shadows: parseBoxShadow(cs.textShadow),
  }

  const lines = readLines(el, cs, scrollX, scrollY)
  if (lines.length === 0) return { kind: 'lost', sample: own.slice(0, 40) }

  return {
    kind: 'text',
    text: {
      runs: [run],
      lines,
      lineHeight: lineHeightOf(cs, fontSize),
      align: ALIGN_MAP[cs.textAlign] ?? 'left',
    },
  }
}

/** Цвет текста не разобран. Вызывающий обязан породить Diagnostic:
 *  подстановка чёрного в `readText` — молчаливый fallback, допущенный
 *  только чтобы не терять сам текст. */
export const hasUnparsedColor = (cs: CSSStyleDeclaration): boolean =>
  parseColor(cs.color) === null

/** Фактический шрифт отличается от объявленного. Вызывающий обязан
 *  породить `fontFallback` уровня error: это главный убийца точности. */
export const hasFontFallback = (cs: CSSStyleDeclaration): boolean => {
  const stack = parseFontStack(cs.fontFamily)
  const first = stack[0]
  if (first === undefined) return false
  return findUsedFamily(stack, parsePx(cs.fontSize)) !== first
}
```

- [ ] **Step 2: Проверить чистые функции юнит-тестами**

Часть модуля чистая и проверяется без браузера. Создать `packages/serializer/test/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyTextTransform, parseFontStack } from '../src/text.js'

const cs = (textTransform: string): CSSStyleDeclaration =>
  ({ textTransform }) as unknown as CSSStyleDeclaration

describe('parseFontStack', () => {
  it('разбирает список и снимает кавычки', () => {
    expect(parseFontStack('"Söhne", Helvetica, sans-serif'))
      .toEqual(['Söhne', 'Helvetica', 'sans-serif'])
  })

  it('оставляет generic-семейства: они значимы для отчёта', () => {
    expect(parseFontStack('system-ui')).toEqual(['system-ui'])
  })

  it('снимает одинарные кавычки', () => {
    expect(parseFontStack("'Times New Roman', serif"))
      .toEqual(['Times New Roman', 'serif'])
  })

  it('не возвращает пустых элементов', () => {
    expect(parseFontStack('Arial,,')).toEqual(['Arial'])
  })
})

describe('applyTextTransform', () => {
  it('none оставляет строку как есть', () => {
    expect(applyTextTransform('Привет Мир', cs('none'))).toBe('Привет Мир')
  })

  it('uppercase поднимает регистр, включая кириллицу', () => {
    expect(applyTextTransform('привет мир', cs('uppercase'))).toBe('ПРИВЕТ МИР')
  })

  it('lowercase опускает регистр', () => {
    expect(applyTextTransform('ПРИВЕТ МИР', cs('lowercase'))).toBe('привет мир')
  })

  it('capitalize поднимает первую букву каждого слова', () => {
    expect(applyTextTransform('привет мир', cs('capitalize'))).toBe('Привет Мир')
  })

  it('capitalize не ломает слова после переноса строки', () => {
    expect(applyTextTransform('раз\nдва', cs('capitalize'))).toBe('Раз\nДва')
  })

  it('capitalize не трогает буквы внутри слова', () => {
    expect(applyTextTransform('iPhone', cs('capitalize'))).toBe('IPhone')
  })
})
```

Run: `pnpm vitest run packages/serializer/test/text.test.ts`
Expected: сначала FAIL на отсутствии модуля, затем PASS, 10 тестов.

Остальное — `readText`, `readLines`, `findUsedFamily` — требует настоящего DOM и проверяется в Task 13 в браузере. Мокать `getClientRects` здесь означало бы тестировать собственный мок.

- [ ] **Step 3: Проверить typecheck**

Run: `pnpm typecheck`
Expected: без ошибок.

- [ ] **Step 4: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): чтение текста с фактическим шрифтом и text-transform"
```

---

## Task 11: Обход DOM и сериализация экрана

**Тело переписано после ревизии контракта.** Это точка сборки: здесь сходятся все парсеры, резолвер, диагностика и текст, и здесь же рождается каждое требование контракта, которое `@w2f/ir` потом проверяет.

Изменения против первой редакции: присвоение `kind`, `selfLayout`, `isStackingContext`, диагностики отложенных фич, узлы-заглушки вместо пустых фреймов, глобальные по бандлу идентификаторы, `Screen.id` и `scroll`, падение вместо `?? 0` в порядке отрисовки, обработка варианта `lost` у текста, запись переплетения.

**Files:**
- Create: `packages/serializer/src/walk.ts`, `src/serialize.ts`, `src/index.ts`, `src/global.ts`, `tsup.config.ts`

- [ ] **Step 1: Создать `packages/serializer/src/walk.ts`**

```ts
import {
  DIAGNOSTIC_CODES,
  type Fill, type IrNode, type LayoutAlign, type NodeStyle,
  type SelfLayout, type SelfPositioning,
} from '@w2f/ir'
import { isInvisible, parseColor } from './css/color.js'
import { isEllipticalCorner, readCorner } from './css/corner.js'
import { hasMixedBorderColors, hasNonSolidStroke, readStroke } from './css/stroke.js'
import { parseBoxShadow } from './css/shadow.js'
import type { DiagnosticSink } from './diagnostics.js'
import { isReversed, readLayout } from './layout.js'
import { readProbe, type LayoutProbe } from './probe.js'
import {
  establishesStackingContext, findApproximatedOrder, findInterleaved,
  resolvePaintOrder,
} from './stacking.js'
import { hasFontFallback, parseFontStack, readText } from './text.js'

export type IdAllocator = () => string

/** Идентификаторы уникальны в пределах БАНДЛА, а не экрана: на них
 *  ссылается отчёт, и `n42` в пяти экранах сделал бы ссылку неоднозначной.
 *  Поэтому аллокатор создаётся один раз на захват и передаётся снаружи. */
export const createIdAllocator = (): IdAllocator => {
  let counter = 0
  return () => {
    const id = `n${counter}`
    counter += 1
    return id
  }
}

type WalkContext = {
  sink: DiagnosticSink
  scrollX: number
  scrollY: number
  allocId: IdAllocator
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

const ALIGN_SELF: Record<string, LayoutAlign> = {
  'flex-start': 'start', start: 'start',
  center: 'center',
  'flex-end': 'end', end: 'end',
  stretch: 'stretch',
  baseline: 'baseline',
}

/** Как узел участвует в раскладке РОДИТЕЛЯ. Без этого плагин не отличит
 *  обычного ребёнка flex-контейнера от абсолютно позиционированного
 *  бейджа и уложит бейдж третьим элементом auto-layout, сдвинув
 *  остальных. Данные читаются здесь и больше нигде не восстановимы. */
const readSelfLayout = (cs: CSSStyleDeclaration): SelfLayout => {
  const positioning: SelfPositioning =
    cs.position === 'absolute' ? 'absolute'
    : cs.position === 'fixed' ? 'fixed'
    : cs.position === 'sticky' ? 'sticky'
    : cs.float !== 'none' ? 'float'
    : 'flow'

  const rawAlign = cs.alignSelf
  return {
    positioning,
    align: rawAlign === 'auto' ? null : (ALIGN_SELF[rawAlign] ?? null),
    grow: Number.parseFloat(cs.flexGrow) || 0,
    shrink: Number.isNaN(Number.parseFloat(cs.flexShrink))
      ? 1
      : Number.parseFloat(cs.flexShrink),
  }
}

const readFills = (
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): Fill[] => {
  const background = parseColor(cs.backgroundColor)
  if (background === null) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.colorUnparsed,
      `Не удалось разобрать background-color: "${cs.backgroundColor}"`, id, false,
    )
    return []
  }
  if (isInvisible(background)) return []
  return [{ kind: 'solid', color: background }]
}

const BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])

const readStyle = (
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): NodeStyle => {
  if (isEllipticalCorner(cs)) {
    sink.report(
      'info', DIAGNOSTIC_CODES.ellipticalCorner,
      'Эллиптический радиус угла сведён к горизонтальному: в Figma эллиптических углов нет.',
      id, false,
    )
  }
  if (hasMixedBorderColors(cs)) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.mixedBorderColors,
      'Границы разных цветов сведены к одному: Figma держит один цвет обводки на узел.',
      id, false,
    )
  }
  if (hasNonSolidStroke(cs)) {
    sink.report(
      'info', DIAGNOSTIC_CODES.strokeStyleFlattened,
      'Стиль границы не воспроизводится рендерером плана 1 либо невыразим в Figma.',
      id, false,
    )
  }

  const rawBlend = cs.mixBlendMode
  const blend = BLEND_MODES.has(rawBlend)
    ? (rawBlend as NodeStyle['blend'])
    : 'normal'

  return {
    fills: readFills(cs, sink, id),
    stroke: readStroke(cs),
    corner: readCorner(cs),
    shadows: parseBoxShadow(cs.boxShadow),
    // СОБСТВЕННАЯ непрозрачность, не композитная: плагин вкладывает узлы,
    // и Figma перемножает так же, как браузер. Запекать вниз запрещено.
    opacity: Number.parseFloat(cs.opacity),
    blend,
    blur: null,
    clip: cs.overflowX === 'hidden' || cs.overflowY === 'hidden'
      || cs.overflowX === 'clip' || cs.overflowY === 'clip',
  }
}

const blurRadius = (value: string): number => {
  const match = /blur\(\s*([\d.]+)px\s*\)/.exec(value)
  if (match?.[1] === undefined) return 0
  return Number.parseFloat(match[1])
}

/** Диагностирует всё, что этот план не переносит.
 *
 *  Разделение обязательное: `unsupported.*` — то, что невозможно в Figma
 *  в принципе, `deferred.*` — то, что реализуется в плане 2. Второе
 *  проверяется инвариантом в `@w2f/ir`: узел с непустым `transform` без
 *  парной диагностики `deferred.transform` отвергается на входе плагина.
 *  Именно так правило «молчаливый fallback — это баг» стало машинным. */
const reportGaps = (
  el: Element,
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): void => {
  if (cs.backgroundImage !== 'none') {
    const repeating = cs.backgroundImage.includes('repeating-')
    sink.report(
      repeating ? 'warning' : 'info',
      repeating ? DIAGNOSTIC_CODES.unsupportedRepeatingGradient
                : DIAGNOSTIC_CODES.deferredGradient,
      `background-image "${cs.backgroundImage.slice(0, 60)}" не переносится в этом плане.`,
      id, false,
    )
  }
  if (cs.transform !== 'none') {
    sink.report(
      'error',
      cs.transform.startsWith('matrix3d')
        ? DIAGNOSTIC_CODES.unsupportedTransform3d
        : DIAGNOSTIC_CODES.deferredTransform,
      `transform "${cs.transform}" не переносится: прямоугольник снят как ` +
      `осепараллельный габарит повёрнутого элемента и потому больше исходного.`,
      id, false,
    )
  }
  const layerBlur = blurRadius(cs.filter)
  const bgBlur = blurRadius(cs.backdropFilter)
  if (layerBlur > 0 || bgBlur > 0) {
    sink.report('info', DIAGNOSTIC_CODES.deferredBlur,
      `Размытие ${layerBlur || bgBlur}px не переносится в этом плане.`, id, false)
  }
  if (cs.filter !== 'none' && layerBlur === 0) {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedFilter,
      `filter "${cs.filter}" не переносится: Figma поддерживает только размытие.`,
      id, false)
  }
  if (cs.mixBlendMode !== 'normal') {
    sink.report('info', DIAGNOSTIC_CODES.deferredBlend,
      `mix-blend-mode "${cs.mixBlendMode}" не переносится в этом плане.`, id, false)
  }
  if (cs.clipPath !== 'none') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedClipPath,
      `clip-path "${cs.clipPath}" не переносится.`, id, false)
  }
  if (cs.position === 'sticky' || cs.position === 'fixed') {
    sink.report('info', DIAGNOSTIC_CODES.stickyFlattened,
      `position: ${cs.position} снят в текущем скролл-положении.`, id, false)
  }
  if (cs.display === 'grid' || cs.display === 'inline-grid') {
    sink.report('info', DIAGNOSTIC_CODES.gridFlattened,
      'CSS grid сведён к колонке: в Figma нет двумерного auto-layout.', id, false)
  }
  if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
    sink.report('info', DIAGNOSTIC_CODES.deferredVector,
      'Векторное содержимое не переносится в этом плане.', id, false)
  }
  for (const pseudo of ['::before', '::after']) {
    const content = window.getComputedStyle(el, pseudo).content
    if (content !== 'none' && content !== 'normal' && content !== '') {
      sink.report('info', DIAGNOSTIC_CODES.deferredPseudoElement,
        `Псевдоэлемент ${pseudo} с содержимым ${content} не переносится.`, id, false)
    }
  }
}

/** Содержимое, которое невозможно перенести в принципе, становится
 *  ВИДИМОЙ заглушкой, а не пустым фреймом. Парная диагностика с тем же
 *  кодом и `needsPlaceholder: true` обязательна: инвариант в `@w2f/ir`
 *  отвергнет заглушку, которую отчёт не объясняет. */
const placeholderFor = (
  el: Element,
  sink: DiagnosticSink,
  id: string,
): { code: typeof DIAGNOSTIC_CODES[keyof typeof DIAGNOSTIC_CODES]; label: string } | null => {
  if (el.tagName === 'CANVAS') {
    sink.report('warning', DIAGNOSTIC_CODES.unsupportedCanvas,
      'Содержимое <canvas> не переносится.', id, true)
    return { code: DIAGNOSTIC_CODES.unsupportedCanvas, label: 'canvas' }
  }
  if (el.tagName === 'IFRAME') {
    const frame = el as HTMLIFrameElement
    let sameOrigin = false
    try {
      sameOrigin = frame.contentDocument !== null
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) {
      sink.report('warning', DIAGNOSTIC_CODES.unsupportedCrossOriginIframe,
        'Содержимое iframe с другого источника недоступно.', id, true)
      return { code: DIAGNOSTIC_CODES.unsupportedCrossOriginIframe, label: 'iframe' }
    }
  }
  return null
}

type Built = { node: IrNode; probe: LayoutProbe }

const buildNode = (
  el: Element,
  parentCs: CSSStyleDeclaration | null,
  ctx: WalkContext,
): Built | null => {
  const cs = window.getComputedStyle(el)
  if (!isRendered(el, cs)) return null

  const id = ctx.allocId()
  reportGaps(el, cs, ctx.sink, id)

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

  const base = {
    id,
    sourceTag: el.tagName.toLowerCase(),
    name: el.tagName.toLowerCase(),
    rect: {
      x: rect.left + ctx.scrollX,
      y: rect.top + ctx.scrollY,
      w: rect.width,
      h: rect.height,
    },
    // Заполняется вторым проходом: требует готового дерева.
    paintOrder: -1,
    isStackingContext: false,
    transform: null,
    layout: readLayout(cs),
    selfLayout: readSelfLayout(cs),
    style: readStyle(cs, ctx.sink, id),
    children,
  }

  const placeholder = placeholderFor(el, ctx.sink, id)
  let node: IrNode
  if (placeholder !== null) {
    node = { ...base, kind: 'placeholder', placeholder }
  } else {
    const text = readText(el, cs, ctx.scrollX, ctx.scrollY)
    if (text.kind === 'text') {
      /** Фактический шрифт отличается от объявленного — главный убийца
       *  точности. Уровень error намеренно: `lines` содержат метрики
       *  фактического шрифта, и если в Figma объявленный шрифт установлен,
       *  плагин применит к нему чужие метрики и получит вылезающий текст,
       *  считая при этом, что шрифт найден. */
      if (hasFontFallback(cs)) {
        const stack = parseFontStack(cs.fontFamily)
        ctx.sink.report(
          'error', DIAGNOSTIC_CODES.fontFallback,
          `Объявлен "${stack[0] ?? '?'}", браузер рисовал ` +
          `"${text.text.runs[0]?.usedFamily ?? '?'}". Метрики строк — от ` +
          `фактического шрифта.`,
          id, false,
        )
      }
      node = { ...base, kind: 'text', text: text.text }
    } else {
      if (text.kind === 'lost') {
        ctx.sink.report('warning', DIAGNOSTIC_CODES.textLost,
          `Текст "${text.sample}" не дал ни одного бокса строки и потерян.`, id, false)
      }
      node = { ...base, kind: 'frame' }
    }
  }

  const probe: LayoutProbe = {
    ...readProbe(el, cs, parentCs),
    id,
    children: childProbes,
  }

  return { node, probe }
}

/** Порядок отрисовки считается вторым проходом: он требует готового дерева.
 *
 *  Промах по карте — НЕ данные, которые надо продиагностировать, а
 *  рассинхрон дерева узлов и дерева проб, то есть баг продюсера. Он обязан
 *  убить захват здесь, в расширении. Мягкий вариант `?? 0` присвоил бы
 *  нулевой порядок всем непопавшим узлам, а на 50 000 узлов это даёт
 *  сообщение об ошибке на 7,8 МБ в UI плагина Figma — измерено. */
const applyPaintOrder = (
  node: IrNode,
  order: Map<string, number>,
  contexts: Set<string>,
): void => {
  const resolved = order.get(node.id)
  if (resolved === undefined) {
    throw new Error(
      `Порядок отрисовки не содержит узла ${node.id} (${node.sourceTag}). ` +
      `Дерево узлов и дерево проб рассинхронизированы — это баг сериализатора.`,
    )
  }
  node.paintOrder = resolved
  node.isStackingContext = contexts.has(node.id)
  for (const child of node.children) applyPaintOrder(child, order, contexts)
}

/** Собирает идентификаторы узлов, создающих stacking context.
 *  Признак вычисляется тем же предикатом, что использует резолвер, —
 *  дублировать его логику нельзя, иначе два места разойдутся. Плагин
 *  восстановить признак не может: ни `transform`, ни `filter`, ни
 *  `isolation` по отдельности в IR не лежат. */
const collectStackingContexts = (probe: LayoutProbe, out: Set<string>): void => {
  if (establishesStackingContext(probe)) out.add(probe.id)
  for (const child of probe.children) collectStackingContexts(child, out)
}

export const walkDocument = (
  sink: DiagnosticSink,
  allocId: IdAllocator,
): IrNode | null => {
  const ctx: WalkContext = {
    sink,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    allocId,
  }

  const built = buildNode(document.body, null, ctx)
  if (built === null) return null

  /** Фон страницы часто объявлен на `<html>`, а обход начинается с `<body>`.
   *  Браузер красит им весь холст, поэтому без переноса тёмная страница
   *  приехала бы на белом фоне. Поймать это ниже по конвейеру нечем:
   *  обход просто не доходит до элемента, где фон объявлен, и в бандле не
   *  остаётся следа — ни валидатору, ни pixel-diff не за что зацепиться. */
  const htmlStyle = window.getComputedStyle(document.documentElement)
  const htmlBackground = parseColor(htmlStyle.backgroundColor)
  if (
    htmlBackground !== null &&
    !isInvisible(htmlBackground) &&
    built.node.style.fills.length === 0
  ) {
    built.node.style.fills = [{ kind: 'solid', color: htmlBackground }]
    sink.report(
      'info', DIAGNOSTIC_CODES.pageBackgroundMoved,
      `Фон страницы объявлен на <html> и перенесён на корневой узел: ` +
      `rgb(${htmlBackground.r},${htmlBackground.g},${htmlBackground.b}).`,
      built.node.id, false,
    )
  }

  const order = resolvePaintOrder(built.probe)
  const contexts = new Set<string>()
  collectStackingContexts(built.probe, contexts)
  applyPaintOrder(built.node, order, contexts)

  for (const id of findApproximatedOrder(built.probe)) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.paintOrderApproximated,
      'Порядок отрисовки приближён: у этого узла position задан, а ' +
      'z-index равен auto, поэтому по CSS его позиционированные потомки ' +
      'должны участвовать в стекинге предка, а не его собственном. ' +
      'Резолвер считает узел атомарным — порядок может отличаться.',
      id, false,
    )
  }

  for (const id of findInterleaved(built.probe, order)) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.paintOrderInterleaved,
      'Поддерево красится с разрывом: дерево Figma такой порядок выразить ' +
      'не может, потому что там z-порядок задаётся порядком среди сиблингов.',
      id, false,
    )
  }

  return built.node
}
```

- [ ] **Step 2: Создать `packages/serializer/src/serialize.ts`**

```ts
import { IR_VERSION, type Bundle, type Diagnostic, type Screen } from '@w2f/ir'
import { DiagnosticSink } from './diagnostics.js'
import { createIdAllocator, walkDocument, type IdAllocator } from './walk.js'

export type SerializeResult = { screen: Screen; report: Diagnostic[] }

export type SerializeOptions = {
  /** Стабильный идентификатор экрана. На него ссылается отчёт. */
  id: string
  /** Отображаемое имя. Редактируется пользователем, уникальность не нужна. */
  name: string
  /** Общий на весь захват аллокатор: идентификаторы узлов уникальны
   *  в пределах бандла, а не экрана. */
  allocId: IdAllocator
}

/** Снимает текущее состояние документа как один Screen.
 *  Размерами управляет драйвер в extension — сериализатор про них
 *  ничего не знает и ничего не эмулирует. */
export const serializeScreen = (options: SerializeOptions): SerializeResult => {
  const sink = new DiagnosticSink(options.id)
  const root = walkDocument(sink, options.allocId)
  if (root === null) {
    throw new Error('Документ пуст: <body> не отрисован.')
  }
  return {
    screen: {
      id: options.id,
      name: options.name,
      width: window.innerWidth,
      /** Высота фрейма макета: высота содержимого, но не меньше высоты
       *  вьюпорта. Скриншот для pixel-diff приводится к этому числу,
       *  а не наоборот — иначе короткая страница, где скриншот выше
       *  содержимого, давала бы ложное расхождение. */
      height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
      dpr: window.devicePixelRatio,
      scroll: { x: window.scrollX, y: window.scrollY },
      root,
      screenshotId: null,
    },
    report: sink.drain(),
  }
}

export const emptyBundle = (): Bundle => ({
  format: 'w2f',
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

export { createIdAllocator }
```

- [ ] **Step 3: Создать `packages/serializer/src/index.ts`**

```ts
export { serializeScreen, emptyBundle, createIdAllocator } from './serialize.js'
export type { SerializeResult, SerializeOptions } from './serialize.js'
export { DiagnosticSink } from './diagnostics.js'
export { establishesStackingContext, findInterleaved, resolvePaintOrder } from './stacking.js'
export { parseColor, TRANSPARENT, isInvisible } from './css/color.js'
export { parseBoxShadow } from './css/shadow.js'
export { readStroke, hasNonSolidStroke } from './css/stroke.js'
export { readCorner } from './css/corner.js'
export { readLayout, isReversed } from './layout.js'
export { applyTextTransform, parseFontStack, readText } from './text.js'
export { walkDocument, createIdAllocator as createIds } from './walk.js'
```

- [ ] **Step 4: Создать `packages/serializer/src/global.ts`**

```ts
import {
  createIdAllocator, emptyBundle, serializeScreen, type SerializeResult,
} from './serialize.js'
import type { IdAllocator } from './walk.js'

/** Аллокатор идентификаторов живёт ВНУТРИ страницы и переживает несколько
 *  вызовов. Это не деталь реализации, а требование двух сторон сразу.
 *
 *  Контракт требует, чтобы идентификаторы узлов были уникальны в пределах
 *  бандла, а не экрана: на них ссылается отчёт. Пять экранов снимаются
 *  пятью вызовами по одной и той же вкладке, поэтому счётчик обязан
 *  сохраняться между ними.
 *
 *  Передать аллокатор снаружи нельзя: функции не пересекают границу
 *  `page.evaluate` и `chrome.scripting.executeScript`. Поэтому внешний API
 *  принимает только строки, а состояние держит здесь. */
let allocator: IdAllocator | null = null

/** Начинает новый захват: сбрасывает нумерацию узлов.
 *  Вызывается один раз перед серией экранов, а не перед каждым. */
const beginCapture = (): void => {
  allocator = createIdAllocator()
}

/** Снимает один экран. Принимает только строки — см. комментарий выше.
 *  Если захват не был начат явно, аллокатор создаётся лениво: так
 *  одиночный снимок в тесте не требует лишнего вызова. */
const captureScreen = (id: string, name: string): SerializeResult => {
  if (allocator === null) allocator = createIdAllocator()
  return serializeScreen({ id, name, allocId: allocator })
}

/** Точка входа IIFE-бандла: то, что Playwright и extension вызывают
 *  внутри страницы. */
const api = { beginCapture, captureScreen, emptyBundle }

declare global {
  interface Window {
    __w2f: typeof api
  }
}

window.__w2f = api
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
  noExternal: ['@w2f/ir'],
})
```

- [ ] **Step 6: Собрать бандл**

Run: `pnpm build:serializer`
Expected: создан `packages/serializer/dist/serializer.global.js`.

Проверить, что бандл действительно самодостаточен: в нём не должно остаться `require(` или `from "@w2f/ir"`. Если остались, бандл упадёт в контексте страницы.

**Но знай, что именно доказывает эта проверка, а что нет.** Проверено экспериментом: `noExternal` под tsup для воркспейс-зависимости — no-op, бандл выходит **байт в байт тем же** и без него, и даже с `external`. Греп-шаблон при этом верный: прямой запуск esbuild с `--external:@w2f/ir` даёт `__require("@w2f/ir")`, который шаблон ловит. То есть шаблон сработает на настоящей утечке, но зелёный греп не подтверждает, что `noExternal` что-то сделал.

Положительное свидетельство самодостаточности — **наличие вшитого содержимого**: `grep -c "unsupported.canvas"` должен вернуть не ноль. И отдельно проверь размер: он обязан быть около 38 КБ. Если внезапно 170 КБ — значит значения импортируются из барреля `@w2f/ir`, а он тянет `schema.ts` вместе с zod, и вся эта масса впрыскивается в каждую захватываемую страницу. Значения берутся из подпутей `@w2f/ir/codes` и `@w2f/ir/version` именно поэтому.

- [ ] **Step 7: Проверить typecheck и все тесты**

Run: `pnpm typecheck && pnpm typecheck:root && pnpm vitest run`
Expected: без ошибок, все существующие тесты проходят.

- [ ] **Step 8: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): обход DOM, сериализация экрана, IIFE-бандл"
```

---

## Task 12: Референс-рендерер IR → SVG

**Тело переписано после ревизии контракта.** Замыкает контур проверки и одновременно служит инструментом отладки: открыл бандл, увидел, что сняли, ещё не заходя в Figma.

Изменения против первой редакции:

**Исчерпывающий `switch` по `kind`.** Контракт стал размеченным объединением, и §8.5 спеки требует исчерпывающих переключений. Отсутствующая ветка теперь ошибка компиляции, а не тихо не нарисованный узел.

**`kind: 'placeholder'` рисуется ВИДИМО** — пунктирная рамка и подпись. Правило проекта требует, чтобы неподдерживаемое было видно; заглушка, нарисованная как обычный прямоугольник, нарушала бы его в самом наглядном месте.

**`usedFamily` вместо `fontFamily`.** Диффить надо тем шрифтом, которым рисовал браузер, иначе расхождение будет ложным.

**`lineHeight` и `align` читаются из `NodeText`**, а не из рана.

**Компенсация обводки внутрь бокса.** SVG рисует обводку по центру пути, CSS — внутрь. Без сжатия прямоугольника на половину толщины каждый элемент с границей давал бы расхождение. Это одна из пяти известных находок, перечисленных в Task 14 — исправляется здесь, а не там.

**Пунктир рисуется пунктиром.** `Stroke.style` теперь есть в контракте, и `stroke-dasharray` убирает расхождение, которое иначе пришлось бы прятать порогом.

**Files:**
- Create: `packages/reference-renderer/package.json`, `tsconfig.json`, `src/render.ts`, `src/html.ts`, `src/index.ts`
- Test: `packages/reference-renderer/test/render.test.ts`

- [ ] **Step 1: Создать `packages/reference-renderer/package.json`**

```json
{
  "name": "@w2f/reference-renderer",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@w2f/ir": "workspace:*" }
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

В корневом `package.json` расширить typecheck до всех трёх пакетов и добавить пакет в `devDependencies` — второе обязательно, иначе `tests/e2e/pixel-diff.spec.ts` из Task 14 не разрешит импорт:

```json
    "typecheck": "tsc -b packages/ir packages/serializer packages/reference-renderer",
```
```json
    "@w2f/reference-renderer": "workspace:*",
```

Run: `pnpm install`
Expected: пакет слинкован, ошибок нет.

- [ ] **Step 4: Написать падающий тест**

```ts
// packages/reference-renderer/test/render.test.ts
import { describe, expect, it } from 'vitest'
import type { IrNode, NodeText, Screen } from '@w2f/ir'
import { renderScreenToSvg } from '../src/render.js'

const frame = (o: Partial<Omit<IrNode, 'kind'>> = {}): IrNode => ({
  kind: 'frame',
  id: 'n0', sourceTag: 'div', name: 'div',
  rect: { x: 0, y: 0, w: 100, h: 50 },
  paintOrder: 0, isStackingContext: false, transform: null,
  layout: { mode: 'none', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 },
            align: 'start', justify: 'start', wrap: false },
  selfLayout: { positioning: 'flow', align: null, grow: 0, shrink: 1 },
  style: { fills: [], stroke: null, corner: { tl: 0, tr: 0, br: 0, bl: 0 },
           shadows: [], opacity: 1, blend: 'normal', blur: null, clip: false },
  children: [],
  ...o,
})

const filled = (color: { r: number; g: number; b: number; a: number },
                o: Partial<Omit<IrNode, 'kind'>> = {}): IrNode =>
  frame({ ...o, style: { ...frame().style, fills: [{ kind: 'solid', color }] } })

const text = (o: Partial<NodeText> = {}): NodeText => ({
  runs: [{
    text: 'раз два', fontStack: ['Inter', 'sans-serif'], usedFamily: 'Inter',
    fontWeight: 400, fontStyle: 'normal', fontSize: 16, letterSpacing: 0,
    color: { r: 0, g: 0, b: 0, a: 1 }, decoration: 'none', shadows: [],
  }],
  lines: [{ x: 0, y: 0, w: 40, h: 20, text: 'раз два' }],
  lineHeight: 20, align: 'left',
  ...o,
})

const screen = (root: IrNode): Screen => ({
  id: 's0', name: 'Test', width: 200, height: 100, dpr: 1,
  scroll: { x: 0, y: 0 }, root, screenshotId: null,
})

describe('renderScreenToSvg: геометрия и заливки', () => {
  it('задаёт размеры SVG по экрану', () => {
    const svg = renderScreenToSvg(screen(frame()))
    expect(svg).toContain('width="200"')
    expect(svg).toContain('height="100"')
  })

  it('рендерит сплошную заливку', () => {
    const svg = renderScreenToSvg(screen(filled({ r: 255, g: 0, b: 0, a: 1 })))
    expect(svg).toContain('fill="rgb(255,0,0)"')
    expect(svg).toContain('fill-opacity="1"')
  })

  it('не рендерит rect у пустого фрейма', () => {
    expect(renderScreenToSvg(screen(frame()))).not.toContain('<rect')
  })

  it('рендерит равный радиус через rx', () => {
    const node = filled({ r: 0, g: 0, b: 0, a: 1 })
    node.style.corner = { tl: 8, tr: 8, br: 8, bl: 8 }
    expect(renderScreenToSvg(screen(node))).toContain('rx="8"')
  })

  it('рендерит разные углы через path, а не rect', () => {
    const node = filled({ r: 0, g: 0, b: 0, a: 1 })
    node.style.corner = { tl: 8, tr: 0, br: 16, bl: 0 }
    expect(renderScreenToSvg(screen(node))).toContain('<path')
  })

  it('упорядочивает узлы по paintOrder, а не по вложенности', () => {
    const root = filled({ r: 9, g: 9, b: 9, a: 1 }, {
      id: 'root', paintOrder: 0,
      children: [
        filled({ r: 1, g: 1, b: 1, a: 1 }, { id: 'late', paintOrder: 2 }),
        filled({ r: 2, g: 2, b: 2, a: 1 }, { id: 'early', paintOrder: 1 }),
      ],
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.indexOf('rgb(2,2,2)')).toBeLessThan(svg.indexOf('rgb(1,1,1)'))
  })
})

describe('renderScreenToSvg: обводка', () => {
  const stroked = (style: 'solid' | 'dashed' | 'dotted'): IrNode => {
    const node = frame()
    node.style.stroke = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: { top: 4, right: 4, bottom: 4, left: 4 },
      style, align: 'inside',
    }
    return node
  }

  it('сжимает прямоугольник на половину толщины: CSS рисует внутрь, SVG по центру', () => {
    const svg = renderScreenToSvg(screen(stroked('solid')))
    // Бокс 100×50 с обводкой 4 даёт путь 2,2 96×46.
    expect(svg).toContain('x="2"')
    expect(svg).toContain('y="2"')
    expect(svg).toContain('width="96"')
    expect(svg).toContain('height="46"')
  })

  it('рисует пунктир пунктиром, а не сплошной линией', () => {
    expect(renderScreenToSvg(screen(stroked('dashed')))).toContain('stroke-dasharray')
  })

  it('точечный пунктир отличается от штрихового', () => {
    const dashed = renderScreenToSvg(screen(stroked('dashed')))
    const dotted = renderScreenToSvg(screen(stroked('dotted')))
    expect(dashed).not.toBe(dotted)
  })

  it('сплошная обводка без dasharray', () => {
    expect(renderScreenToSvg(screen(stroked('solid')))).not.toContain('stroke-dasharray')
  })
})

describe('renderScreenToSvg: текст', () => {
  const withText = (t: NodeText): IrNode => ({ ...frame(), kind: 'text', text: t })

  it('рендерит каждую строку своим элементом text', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      lines: [
        { x: 0, y: 0, w: 40, h: 20, text: 'раз' },
        { x: 0, y: 20, w: 40, h: 20, text: 'два' },
      ],
    }))))
    expect(svg.match(/<text/g)).toHaveLength(2)
  })

  it('подставляет usedFamily, а не первое объявленное семейство', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      runs: [{ ...text().runs[0], fontStack: ['Söhne', 'Arial'], usedFamily: 'Arial' }],
    }))))
    expect(svg).toContain('font-family="Arial"')
    expect(svg).not.toContain('font-family="Söhne"')
  })

  it('берёт выравнивание из NodeText', () => {
    const svg = renderScreenToSvg(screen(withText(text({ align: 'center' }))))
    expect(svg).toContain('text-anchor="middle"')
  })

  it('экранирует спецсимволы XML', () => {
    const svg = renderScreenToSvg(screen(withText(text({
      lines: [{ x: 0, y: 0, w: 40, h: 20, text: '<a & b>' }],
    }))))
    expect(svg).toContain('&lt;a &amp; b&gt;')
  })
})

describe('renderScreenToSvg: заглушка видна', () => {
  const placeholder = (): IrNode => ({
    ...frame(),
    kind: 'placeholder',
    placeholder: { code: 'unsupported.canvas', label: 'canvas' },
  })

  it('рисует пунктирную рамку', () => {
    const svg = renderScreenToSvg(screen(placeholder()))
    expect(svg).toContain('stroke-dasharray')
  })

  it('пишет подпись, чтобы причина была видна', () => {
    expect(renderScreenToSvg(screen(placeholder()))).toContain('canvas')
  })

  it('заглушка не невидима: у неё есть и рамка, и текст', () => {
    const svg = renderScreenToSvg(screen(placeholder()))
    expect(svg).toContain('<rect')
    expect(svg).toContain('<text')
  })
})
```

- [ ] **Step 5: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/reference-renderer/test/render.test.ts`
Expected: FAIL — `Failed to resolve import "../src/render.js"`.

- [ ] **Step 6: Создать `packages/reference-renderer/src/render.ts`**

```ts
import type {
  Corner, IrNode, Rect, Rgba8, Screen, Shadow, Stroke, TextRun,
} from '@w2f/ir'

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const rgb = (color: Rgba8): string => `rgb(${color.r},${color.g},${color.b})`

const uniformCorner = (corner: Corner): number | null =>
  corner.tl === corner.tr && corner.tr === corner.br && corner.br === corner.bl
    ? corner.tl
    : null

/** Прямоугольник с разными радиусами углов не выражается через `<rect rx>`,
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

const maxWeight = (stroke: Stroke): number => Math.max(
  stroke.weight.top, stroke.weight.right, stroke.weight.bottom, stroke.weight.left,
)

/** SVG рисует обводку ПО ЦЕНТРУ пути, CSS — ВНУТРЬ бокса, и контракт
 *  фиксирует это как `align: 'inside'`. Без сжатия на половину толщины
 *  каждый элемент с границей давал бы расхождение в pixel-diff. */
const insetRect = (rect: Rect, stroke: Stroke | null): Rect => {
  if (stroke === null) return rect
  const half = maxWeight(stroke) / 2
  return {
    x: rect.x + half, y: rect.y + half,
    w: Math.max(0, rect.w - half * 2), h: Math.max(0, rect.h - half * 2),
  }
}

const dashArray = (stroke: Stroke): string => {
  const w = maxWeight(stroke)
  if (stroke.style === 'dashed') return ` stroke-dasharray="${w * 3} ${w * 2}"`
  if (stroke.style === 'dotted') return ` stroke-dasharray="${w} ${w}"`
  return ''
}

const shadowFilter = (id: string, shadows: Shadow[]): string => {
  const outer = shadows.filter((shadow) => shadow.kind === 'outer')
  if (outer.length === 0) return ''
  const parts = outer.map((shadow) =>
    `<feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" ` +
    `stdDeviation="${shadow.blur / 2}" flood-color="${rgb(shadow.color)}" ` +
    `flood-opacity="${shadow.color.a}"/>`,
  ).join('')
  return `<filter id="${id}" x="-75%" y="-75%" width="250%" height="250%">${parts}</filter>`
}

const renderBox = (node: IrNode, defs: string[]): string => {
  const { style } = node
  const solid = style.fills.find((fill) => fill.kind === 'solid')
  const hasShadow = style.shadows.some((shadow) => shadow.kind === 'outer')
  if (solid === undefined && style.stroke === null && !hasShadow) return ''

  const rect = insetRect(node.rect, style.stroke)
  const attrs: string[] = []

  if (solid !== undefined && solid.kind === 'solid') {
    attrs.push(`fill="${rgb(solid.color)}"`, `fill-opacity="${solid.color.a}"`)
  } else {
    attrs.push('fill="none"')
  }
  if (style.stroke !== null) {
    attrs.push(
      `stroke="${rgb(style.stroke.color)}"`,
      `stroke-opacity="${style.stroke.color.a}"`,
      `stroke-width="${maxWeight(style.stroke)}"`,
    )
  }
  if (style.opacity < 1) attrs.push(`opacity="${style.opacity}"`)
  if (hasShadow) {
    const filterId = `shadow-${node.id}`
    defs.push(shadowFilter(filterId, style.shadows))
    attrs.push(`filter="url(#${filterId})"`)
  }

  const dash = style.stroke === null ? '' : dashArray(style.stroke)
  const uniform = uniformCorner(style.corner)
  if (uniform === null) {
    return `<path d="${cornerPath(rect, style.corner)}" ${attrs.join(' ')}${dash}/>`
  }
  const rx = uniform > 0 ? ` rx="${uniform}"` : ''
  return (
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"` +
    `${rx} ${attrs.join(' ')}${dash}/>`
  )
}

/** Базовая линия ставится из бокса строки. Коэффициент 0.72 от кегля —
 *  подобранная доля высоты до базовой линии для латиницы и кириллицы;
 *  зафиксирован константой, чтобы расхождение было объяснимо, а не
 *  подкручивалось в разных местах по-разному. */
const BASELINE_RATIO = 0.72

const renderTextLines = (node: IrNode & { kind: 'text' }): string => {
  const run: TextRun | undefined = node.text.runs[0]
  if (run === undefined) return ''
  const anchor =
    node.text.align === 'center' ? 'middle'
    : node.text.align === 'right' ? 'end'
    : 'start'

  return node.text.lines.map((line) => {
    const x =
      anchor === 'middle' ? line.x + line.w / 2
      : anchor === 'end' ? line.x + line.w
      : line.x
    const baseline = line.y + (line.h + run.fontSize * BASELINE_RATIO) / 2
    return (
      `<text x="${x}" y="${baseline}" text-anchor="${anchor}" ` +
      `dominant-baseline="alphabetic" ` +
      `font-family="${escapeXml(run.usedFamily)}" font-size="${run.fontSize}" ` +
      `font-weight="${run.fontWeight}" font-style="${run.fontStyle}" ` +
      `letter-spacing="${run.letterSpacing}" ` +
      `fill="${rgb(run.color)}" fill-opacity="${run.color.a}" ` +
      `text-rendering="geometricPrecision" ` +
      `xml:space="preserve">${escapeXml(line.text)}</text>`
    )
  }).join('')
}

/** Заглушка обязана быть ВИДНА: правило проекта запрещает, чтобы
 *  неподдерживаемое содержимое приезжало неотличимо от пустого блока. */
const renderPlaceholder = (node: IrNode & { kind: 'placeholder' }): string => {
  const { x, y, w, h } = node.rect
  return (
    `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, w - 2)}" ` +
    `height="${Math.max(0, h - 2)}" fill="none" stroke="rgb(220,38,38)" ` +
    `stroke-width="2" stroke-dasharray="6 4"/>` +
    `<text x="${x + 6}" y="${y + 18}" font-family="monospace" font-size="12" ` +
    `fill="rgb(220,38,38)" xml:space="preserve">` +
    `${escapeXml(`⚠ ${node.placeholder.label}`)}</text>`
  )
}

/** Исчерпывающий по `kind`: отсутствующая ветка — ошибка компиляции,
 *  а не тихо не нарисованный узел. */
const renderNode = (node: IrNode, defs: string[]): string => {
  switch (node.kind) {
    case 'frame':
      return renderBox(node, defs)
    case 'text':
      return renderBox(node, defs) + renderTextLines(node)
    case 'image':
      // Ассеты в плане 1 не снимаются, поэтому рисуется только бокс.
      // Ветка существует ради исчерпывающего переключения.
      return renderBox(node, defs)
    case 'vector':
      return node.paths.map((path) =>
        `<path d="${path.data}" ` +
        `fill="${path.fill === null ? 'none' : rgb(path.fill)}" ` +
        `${path.stroke === null ? '' : `stroke="${rgb(path.stroke.color)}" ` +
          `stroke-width="${maxWeight(path.stroke)}"`}/>`,
      ).join('')
    case 'placeholder':
      return renderPlaceholder(node)
  }
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
  const body = nodes.map((node) => renderNode(node, defs)).join('')

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

Run: `pnpm vitest run packages/reference-renderer && pnpm typecheck`
Expected: PASS, 17 тестов; typecheck по трём пакетам без ошибок.

- [ ] **Step 10: Коммит**

```bash
git add packages/reference-renderer package.json pnpm-lock.yaml
git commit -m "feat(reference-renderer): рендер IR в SVG с видимыми заглушками"
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

- [ ] **Step 4b: Создать семь фикстур, проверяющих диагностики и новые поля**

Эти фикстуры существуют не для красоты картинки, а чтобы правило «молчаливый fallback — это баг» перестало быть словами. Без них диагностики отложенных фич не покрыты ничем.

`fixtures/transformed/index.html`:
```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>transformed</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;font-family:Arial,sans-serif;padding:40px}
  .row{display:flex;gap:40px}
  .b{width:120px;height:60px;background:#3b82f6}
  .rot{transform:rotate(15deg)}
  .scl{transform:scale(1.5)}
  .tr{transform:translate(20px,10px)}
</style></head>
<body><div class="row">
  <div class="b rot"></div><div class="b scl"></div><div class="b tr"></div>
</div></body></html>
```

`fixtures/gradient/index.html`:
```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>gradient</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff}
  .hero{height:160px;background:linear-gradient(135deg,#6366f1,#ec4899)}
  .radial{height:120px;background:radial-gradient(circle,#22c55e,#0f766e)}
</style></head>
<body><div class="hero"></div><div class="radial"></div></body></html>
```

`fixtures/inline-text/index.html`:
```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>inline-text</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff;font-family:Arial,sans-serif;padding:24px;font-size:16px}
  p{width:320px;line-height:24px;margin-bottom:12px}
</style></head>
<body>
  <p id="mixed">Hello <b>world</b> and <span style="color:red">red</span></p>
  <p id="plain">Просто абзац без вложенных элементов</p>
</body></html>
```

`fixtures/absolute-in-flex/index.html`:
```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>absolute-in-flex</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;padding:24px}
  .card{position:relative;display:flex;gap:12px;padding:16px;background:#f1f5f9}
  .cell{width:100px;height:60px;background:#0ea5e9}
  .badge{position:absolute;top:4px;right:4px;width:40px;height:20px;background:#ef4444}
  .grower{flex-grow:2;height:60px;background:#14b8a6}
</style></head>
<body><div class="card">
  <div class="cell"></div><div class="grower"></div><div class="badge"></div>
</div></body></html>
```

`fixtures/missing-font/index.html`:
```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>missing-font</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff;padding:24px}
  /* Первое семейство заведомо отсутствует: браузер нарисует Arial,
     и боксы строк будут содержать метрики Arial, а не выдуманного шрифта. */
  .missing{font-family:"Заведомо Отсутствующий Шрифт XYZ",Arial,sans-serif;
    font-size:18px;line-height:26px}
  .present{font-family:Arial,sans-serif;font-size:18px;line-height:26px}
</style></head>
<body>
  <p class="missing">Текст семейством, которого нет в системе</p>
  <p class="present">Текст существующим семейством</p>
</body></html>
```

`fixtures/dashed-border/index.html`:
```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>dashed-border</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;padding:24px;display:flex;gap:16px}
  .b{width:120px;height:80px;background:#fff}
  .dashed{border:2px dashed #111}
  .dotted{border:3px dotted #111}
  /* double в Figma невыразим вовсе — обязан свестись к solid и диагностике */
  .double{border:6px double #111}
</style></head>
<body>
  <div class="b dashed"></div><div class="b dotted"></div><div class="b double"></div>
</body></html>
```

`fixtures/text-transform/index.html`:
```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>text-transform</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff;font-family:Arial,sans-serif;padding:24px;font-size:18px}
  p{line-height:26px;margin-bottom:8px}
  .up{text-transform:uppercase}
  .cap{text-transform:capitalize}
  .low{text-transform:lowercase}
</style></head>
<body>
  <p class="up">строчный исходник станет прописным</p>
  <p class="cap">каждое слово с большой буквы</p>
  <p class="low">ПРОПИСНОЙ ИСХОДНИК СТАНЕТ СТРОЧНЫМ</p>
</body></html>
```

- [ ] **Step 4c: Написать проверку диагностик и новых полей**

Создать `tests/e2e/diagnostics.spec.ts`. Формулировка **положительная**: для каждой фикстуры перечислены коды, которые **обязаны** присутствовать. Отсутствие ожидаемого — провал. Это и есть машинная проверка правила проекта.

```ts
import { expect, test } from '@playwright/test'
import { captureScreen, fixtureUrl } from './helpers/capture.js'

/** Коды, обязанные появиться на каждой фикстуре. Список положительный
 *  намеренно: «нет лишних диагностик» — слабое утверждение, а «есть
 *  ожидаемая» — сильное, и именно оно ловит молчаливую потерю. */
const EXPECTED: Record<string, readonly string[]> = {
  transformed: ['deferred.transform'],
  gradient: ['deferred.gradient'],
  'missing-font': ['fidelity.font-fallback'],
  'dashed-border': ['fidelity.stroke-style-flattened'],
  /** Признанное упрощение резолвера: позиционированный узел с
   *  `z-index: auto` считается атомарным, хотя по CSS его
   *  z-индексированные потомки должны подниматься к предку. Молчать
   *  о нём нельзя, поэтому диагностика обязана присутствовать —
   *  и эта проверка не даст ей потеряться при будущих правках. */
  stacking: ['fidelity.paint-order-approximated'],
  'absolute-in-flex': ['fidelity.paint-order-approximated'],
}

for (const [fixture, codes] of Object.entries(EXPECTED)) {
  test(`диагностики: ${fixture}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(fixtureUrl(fixture))
    const { report } = await captureScreen(page, 's0', 'Desktop')
    const present = new Set(report.map((item) => item.code))
    for (const code of codes) {
      expect(
        present.has(code),
        `фикстура ${fixture} обязана породить "${code}", а в отчёте: ` +
        `${[...present].join(', ') || '(пусто)'}`,
      ).toBe(true)
    }
  })
}

test('фон <html> переносится на корневой узел и об этом сообщается', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  // Фикстура не нужна: setContent достаточно, а фон на <html> — единственное,
  // что здесь проверяется.
  await page.setContent(
    '<!doctype html><html style="background:#1e293b"><body>' +
    '<div style="width:100px;height:50px;background:#fff"></div>' +
    '</body></html>',
  )
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  // Без переноса тёмная страница приехала бы на белом фоне, и поймать это
  // было бы нечем: обход начинается с <body> и до <html> не доходит.
  expect(screen.root.style.fills).toEqual([
    { kind: 'solid', color: { r: 30, g: 41, b: 59, a: 1 } },
  ])
  const explained = report.some(
    (item) => item.code === 'fidelity.page-background-moved',
  )
  expect(explained, 'перенос фона обязан быть объяснён в отчёте').toBe(true)
})

test('фон <body> не подменяется фоном <html>', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await page.setContent(
    '<!doctype html><html style="background:#1e293b">' +
    '<body style="background:#f8fafc"></body></html>',
  )
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')
  // У body свой фон — переносить нечего, и диагностики быть не должно.
  expect(screen.root.style.fills).toEqual([
    { kind: 'solid', color: { r: 248, g: 250, b: 252, a: 1 } },
  ])
  expect(report.some((i) => i.code === 'fidelity.page-background-moved')).toBe(false)
})

test('transformed: диагностика уровня error на каждом трансформированном узле', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('transformed'))
  const { report } = await captureScreen(page, 's0', 'Desktop')
  const transforms = report.filter((item) => item.code === 'deferred.transform')
  expect(transforms.length).toBe(3)
  for (const item of transforms) {
    expect(item.level).toBe('error')
    expect(item.nodeId).not.toBeNull()
  }
})

test('gradient: блок с градиентом НЕ приезжает молча прозрачным', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('gradient'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')
  // Заливки у него действительно нет — градиенты в этом плане не
  // переносятся. Но это обязано быть СКАЗАНО, а не умолчано.
  const hero = screen.root.children[0]
  expect(hero?.style.fills).toEqual([])
  const explained = report.some(
    (item) => item.code === 'deferred.gradient' && item.nodeId === hero?.id,
  )
  expect(explained, 'градиент без диагностики — молчаливая потеря').toBe(true)
})

test('inline-text: конкатенация ранов равна конкатенации строк', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('inline-text'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const collect = (node: typeof screen.root, out: typeof screen.root[]): void => {
    out.push(node)
    for (const child of node.children) collect(child, out)
  }
  const all: typeof screen.root[] = []
  collect(screen.root, all)

  const norm = (v: string): string => v.replace(/\s+/g, ' ').trim()
  let checked = 0
  for (const node of all) {
    if (node.kind !== 'text') continue
    checked += 1
    const fromRuns = norm(node.text.runs.map((r) => r.text).join(''))
    const fromLines = norm(node.text.lines.map((l) => l.text).join(''))
    expect(fromRuns, `узел ${node.id} (${node.sourceTag})`).toBe(fromLines)
  }
  expect(checked, 'текстовых узлов не найдено — фикстура не сработала')
    .toBeGreaterThan(1)
})

test('inline-text: "world" не дублируется между абзацем и вложенным b', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('inline-text'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const texts: string[] = []
  const walk = (node: typeof screen.root): void => {
    if (node.kind === 'text') texts.push(node.text.runs.map((r) => r.text).join(''))
    for (const child of node.children) walk(child)
  }
  walk(screen.root)

  const occurrences = texts.filter((t) => t.includes('world')).length
  // Ровно один узел несёт "world" — сам <b>. Абзац несёт только
  // собственный текст, без подграфа. Два вхождения означали бы, что
  // плагин Figma нарисует слово дважды с наложением.
  expect(occurrences, `"world" встретился в ${occurrences} узлах: ${texts.join(' | ')}`)
    .toBe(1)
})

test('absolute-in-flex: участие в раскладке родителя различается по детям', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('absolute-in-flex'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const card = screen.root.children[0]
  expect(card?.layout.mode).toBe('row')
  const kids = card?.children ?? []
  expect(kids).toHaveLength(3)

  const positioning = kids.map((k) => k.selfLayout.positioning)
  expect(positioning).toContain('absolute')
  expect(positioning.filter((p) => p === 'flow')).toHaveLength(2)

  const grower = kids.find((k) => k.selfLayout.grow === 2)
  expect(grower, 'flex-grow: 2 должен доехать в selfLayout').toBeDefined()
})

test('missing-font: usedFamily — фактический шрифт, а не объявленный', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('missing-font'))
  const { screen, fonts } = await captureScreen(page, 's0', 'Desktop')

  const paragraphs = screen.root.children.filter((n) => n.kind === 'text')
  expect(paragraphs).toHaveLength(2)

  const first = paragraphs[0]
  if (first === undefined || first.kind !== 'text') throw new Error('нет абзаца')
  const run = first.text.runs[0]
  expect(run?.fontStack[0]).toBe('Заведомо Отсутствующий Шрифт XYZ')
  expect(run?.usedFamily).not.toBe('Заведомо Отсутствующий Шрифт XYZ')
  expect(run?.usedFamily).toBe('Arial')

  // collectFonts обязан отдать фактический шрифт: по нему плагин будет
  // предзагружать, и объявленный там бесполезен.
  expect(fonts.map((f) => f.family)).toContain('Arial')
  expect(fonts.map((f) => f.family)).not.toContain('Заведомо Отсутствующий Шрифт XYZ')
})

test('dashed-border: стиль обводки доезжает, невыразимый сводится к solid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('dashed-border'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const styles = screen.root.children.map((n) => n.style.stroke?.style)
  expect(styles).toEqual(['dashed', 'dotted', 'solid'])
  for (const child of screen.root.children) {
    expect(child.style.stroke?.align).toBe('inside')
  }
})

test('text-transform: преобразование применено к самой строке', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('text-transform'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

  const paragraphs = screen.root.children.filter((n) => n.kind === 'text')
  expect(paragraphs).toHaveLength(3)

  const textOf = (index: number): string => {
    const node = paragraphs[index]
    if (node === undefined || node.kind !== 'text') throw new Error('нет абзаца')
    return node.text.runs.map((r) => r.text).join('')
  }

  // Эту потерю pixel-diff увидеть не может: рендерер сравнивал бы одну и
  // ту же непреобразованную строку с обеих сторон и остался бы зелёным.
  expect(textOf(0)).toBe('СТРОЧНЫЙ ИСХОДНИК СТАНЕТ ПРОПИСНЫМ')
  expect(textOf(1)).toBe('Каждое Слово С Большой Буквы')
  expect(textOf(2)).toBe('прописной исходник станет строчным')

  // И строки тоже: инвариант контракта сверяет их конкатенации.
  const first = paragraphs[0]
  if (first === undefined || first.kind !== 'text') throw new Error('нет абзаца')
  expect(first.text.lines.map((l) => l.text).join('')).toContain('ПРОПИСНЫМ')
})
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
import type { Diagnostic, FontRequirement, Screen } from '@w2f/ir'

/** То же, что отдаёт сериализатор. Объявлено здесь, потому что тесты
 *  не импортируют сам сериализатор: он читается с диска как текст. */
export type CaptureResult = {
  screen: Screen
  report: Diagnostic[]
  fonts: FontRequirement[]
}

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
 *
 *  Бандл читается с диска каждый раз, чтобы тест всегда проверял свежую
 *  сборку, а не закешированную.
 *
 *  Аллокатор идентификаторов живёт внутри страницы и передаётся через
 *  `beginCapture`, а не аргументом: функции не пересекают границу
 *  `page.evaluate`, поэтому внешний API принимает только строки.
 *  `beginCapture` вызывается здесь на каждый снимок, потому что каждый
 *  тест снимает один экран; серию из пяти экранов с общей нумерацией
 *  собирает extension в плане 2. */
export const captureScreen = async (
  page: Page,
  screenId: string,
  screenName: string,
): Promise<CaptureResult> => {
  const source = readFileSync(bundlePath, 'utf8')
  await page.addScriptTag({ content: source })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => { window.__w2f.beginCapture() })
  return page.evaluate(
    ([id, name]) => window.__w2f.captureScreen(id ?? '', name ?? ''),
    [screenId, screenName],
  )
}
```

- [ ] **Step 7: Написать падающий тест IR-снапшотов**

```ts
// tests/e2e/fidelity.spec.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { captureScreen, fixtureUrl, repoRoot, SIZES } from './helpers/capture.js'

const FIXTURES = [
  'boxes', 'stacking', 'flex', 'text',
  'transformed', 'gradient', 'inline-text', 'absolute-in-flex',
  'missing-font', 'dashed-border', 'text-transform',
] as const

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
      const { screen, report } = await captureScreen(page, `s-${size.width}`, size.name)

      expect(screen.width).toBe(size.width)
      expect(screen.root.sourceTag).toBe('body')
      compareSnapshot(fixture, size.width, { screen, report })
    })
  }
}

test('стекинг: порядок отрисовки не совпадает с порядком DOM', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('stacking'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

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
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

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
  const wide = await captureScreen(page, 's0', 'Desktop')
  const wideRow = wide.screen.root.children[0]
  expect(wideRow?.layout.mode).toBe('row')

  await page.setViewportSize({ width: 390, height: 844 })
  const narrow = await captureScreen(page, 's1', 'Mobile')
  const narrowRow = narrow.screen.root.children[0]
  expect(narrowRow?.layout.mode).toBe('column')
})

test('text: узкий абзац переносится на несколько строк с разными боксами', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('text'))
  const { screen } = await captureScreen(page, 's0', 'Desktop')

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
import { renderScreenToSvg, wrapSvgInHtml } from '@w2f/reference-renderer'
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
      const { screen } = await captureScreen(page, `s-${size.width}`, size.name)

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
# webpage2figma

Снимает страницу, открытую в браузере, в макет Figma: пять экранов под разные
дисплеи плюс библиотека компонентов.

Дизайн: `docs/superpowers/specs/2026-09-19-webpage2figma-design.md`
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

Появились пакеты `@w2f/ir`, `@w2f/serializer`, `@w2f/reference-renderer`.
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

> **Все тела задач синхронизированы с контрактом.** Блоки кода в телах этих задач написаны против ПЕРВОЙ редакции контракта и содержат устаревшие конструкции, которые не скомпилируются:
>
> - ~~Task 9~~ — **переписана, тело актуально.**
> - ~~Task 10~~ — **переписана, тело актуально.**
> - ~~Task 12~~ — **переписана, тело актуально.**
>
> Задачи 2, 3, 6, 9, 10 и 12 переписаны под текущий контракт. Если в каком-то теле всё же встретится конструкция, не сходящаяся с `@w2f/ir`, — **останови работу и сообщи**, не пытайся согласовать сам: расхождений может быть больше, чем видно из одного файла.


Design-ревью контракта IR (после реализации первой редакции в `5e09c07`) вернуло **changes required**. Task 2 переписан полностью. Ниже — что именно меняется в остальных задачах. **Исполнитель каждой задачи обязан прочитать свою дельту вместе с телом задачи**: тела задач ниже написаны против первой редакции контракта и в перечисленных местах устарели.

### Почему ревизия, а не версия IR

Ни одного бандла ещё не существует, эталонных фикстур нет, сериализатор не написан. Правка контракта сейчас — это один файл. Та же правка после Task 13 — это переписывание сериализатора, рендерера и двадцати закоммиченных снапшотов. Версия IR остаётся `1`: мигрировать нечего.

Общий диагноз ревью, который стоит держать в голове при всех дельтах: **референс-рендерер разделял слепые пятна контракта** — читал `lines`, а не `runs`, абсолютные `rect`, а не раскладку, и плющил порядок отрисовки. Поэтому pixel-diff, главный инструмент корректности проекта, оставался зелёным почти для всех найденных дефектов. Каждая дельта ниже либо убирает слепое пятно, либо заставляет гейт его видеть.

### Решение по миграциям

Спека §9 обещала «миграции версий» в `packages/ir`. Обещание снимается: бандл — **односверсионный артефакт**, и отказ при несовпадении версий — правильное поведение для двух половин, которые всегда поставляются вместе. `BundleEnvelope` из Task 2 существует не для миграции, а чтобы сообщение об ошибке отличало «это не наш файл» от «наш файл чужой версии». Строгий литерал `IrVersion` на валидированном `Bundle` сохраняется.

### Task 3 — схема и валидация

**Тело задачи переписано полностью, дельта применена в нём.** Оставлено здесь для истории: перечисление того, что именно ревью потребовало.

1. **Связать схему типом.** Было `export const irNodeSchema: z.ZodType<unknown>` и `parsed.data as Bundle`. Становится `z.ZodType<IrNode>` на ленивой схеме, а приведение `as Bundle` удаляется. Причина: с `unknown` и приведением схема и типы расходятся при зелёном typecheck. Добавили поле в `types.ts`, забыли в `schema.ts` — валидация пропускает бандл без него, плагин читает `node.transform.angle`, Figma падает **посреди построения**. Это ровно «половинчатый импорт», который преамбула Task 3 называет худшим исходом.
2. **`z.discriminatedUnion('kind', …)`** для `IrNode`, обёрнутая в `z.lazy` ради рекурсии `children`.
3. **`Rgba8`: `.int()`** на `r`, `g`, `b`. Без этого `{r:1,g:1,b:1}` — валидные единицы Figma и почти чёрный в наших — проходит проверку и рисуется неверно. `getComputedStyle` и канвас-путь дают целые, так что ограничение бесплатно.
4. **Маркер формата**: `format: z.literal('w2f')`, проверяется в `parseBundle` до версии.
5. **Инварианты `paintOrder` валидируются**, а не документируются: по каждому экрану собрать все `paintOrder`, проверить, что их количество равно количеству узлов, что все уникальны и что множество равно `0..n-1`. Инвариант, существующий только в комментарии резолвера, продюсер может нарушить, и тогда сортировка в плагине станет недетерминированной между запусками.
6. **Ссылочная целостность** в `parseBundle`: каждый `assetId` из `Fill` и `ImageRef` существует в `assets`; `screenshotId` существует; `nodeId` каждой диагностики существует; `screenId` существует; каждое `usedFamily` из ранов покрыто `fonts`. Причина: при неудачной загрузке картинки `assetId` повисает, `figma.createImage` не вызывается, узел приезжает пустым прямоугольником, диагностики нет, бандл «валиден». Висячая ссылка — это молчаливый fallback, а проверка стоит двадцать строк в единственном месте, общем для обеих половин.
7. **Уникальность `id` узлов в пределах всего бандла**, а не экрана.
8. Тесты добавляются на каждый новый отказ: чужой `format`, дырявый `paintOrder`, висячий `assetId`, дубль `id`, `runs: []`, дробный канал цвета.

### Task 6 — обводки

1. Читать `border-*-style` и заполнять `Stroke.style`. Было: `widthOf` обнуляет только `none`/`hidden`, поэтому `dashed` и `dotted` молча становились сплошными. В Figma есть `dashPattern`, то есть терялась представимая фича.
2. Всегда выставлять `align: 'inside'`.
3. Пока рендерер плана 1 не рисует штрихи — порождать `strokeStyleFlattened`. Молчание здесь запрещено.

### Task 9 — диагностика

**Тело задачи переписано полностью, дельта применена в нём.** Оставлено здесь для истории.

1. `DiagnosticSink` **импортирует коды из `@w2f/ir`**, своего списка не держит. Задача больше не создаёт `DIAGNOSTIC_CODES` — они переехали в Task 2.
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
3. Продолжать плющить и сортировать по `paintOrder`. Обнаруживать переплетение рендереру **не нужно** — и это решение стоит объяснить, потому что ревью предлагало иначе.

   Ревью предлагало вынести детектор в `@w2f/ir`, поскольку он нужен и рендереру, и плагину. Но если продюсер **записывает** переплетение диагностикой в бандл, вычислять его заново не нужно никому: плагин читает отчёт. Поэтому `findInterleaved` живёт в сериализаторе, где дерево проб уже под рукой, а Task 11 обязан породить `paintOrderInterleaved`. Так убирается дубликат, которого предложение ревью потребовало бы.

   Рендерер переплетение переживает — он плющит и сортирует. Не переживает плагин, и именно поэтому знание нужно в бандле, а не в рендерере.
4. Текст рендерится из `lines`, как раньше, но `usedFamily` подставляется в `font-family` — иначе диффится не тот шрифт, которым рисовал браузер.

### Task 13 — фикстуры

Добавить фикстуры, которые заставляют новые поля и диагностики работать, иначе они непроверены:

- `transformed/` — `rotate(15deg)`, `scale(1.5)`, `translate`. Ожидание: `deferredTransform` уровня `error` на каждом. Раздутие осепараллельного габарита достаточно велико, чтобы pixel-diff это громко поймал.
- `gradient/` — `linear-gradient` фон. Ожидание: `deferredGradient`, а не молча прозрачный блок.
- `inline-text/` — `<p>Hello <b>world</b> and <span style="color:red">red</span></p>`. Ожидание: инвариант конкатенации выполняется, «world» не дублируется.
- `absolute-in-flex/` — бейдж `position:absolute` внутри `display:flex`. Ожидание: `selfLayout.positioning === 'absolute'` у бейджа и `'flow'` у соседей.
- `missing-font/` — `font-family: "Заведомо Отсутствующий Шрифт", Arial`. Ожидание: `usedFamily === 'Arial'` и `fontFallback` уровня `error`.
- `dashed-border/` — `border: 2px dashed`. Ожидание: `style === 'dashed'` и `strokeStyleFlattened`.
- `text-transform/` — `text-transform: uppercase` и `capitalize` на абзацах со строчным исходником. Ожидание: `runs[0].text` и `lines[].text` содержат ПРЕОБРАЗОВАННЫЙ регистр. Фикстура нужна именно потому, что pixel-diff эту потерю увидеть не может: рендерер сравнивал бы одну и ту же непреобразованную строку с обеих сторон и остался бы зелёным.

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
