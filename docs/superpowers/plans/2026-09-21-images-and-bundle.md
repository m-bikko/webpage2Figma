# Images, Assets and Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести растровые изображения — `<img>` и `background-image: url()` — в IR вместе с байтами, научить референс-рендерер их рисовать и собрать всё в файл-бандл `.w2f`, который примет плагин.

**Architecture:** Обход DOM остаётся **синхронным** и лишь регистрирует заявки на ассеты, получая взамен `assetId`. Отдельная асинхронная фаза забирает байты через `fetch`, нормализует формат и размер и отдаёт `Asset[]` вместе с содержимым. Бандл пакуется `fflate` в ZIP: `ir.json` + `assets/` + `screenshots/`.

**Tech Stack:** тот же воркспейс; `fflate` для ZIP, `OffscreenCanvas` для нормализации, `node:http` для тестового сервера фикстур.

**Место в карте планов:** план 4 из 7. Дальше: 5 — плагин Figma, 6 — расширение Chrome, 7 — компоненты и токены.


## Статус: выполнен (2026-09-21)

Все десять задач исполнены. Отмечено по существу, а не по галочкам.

| обещано | подтверждено |
|---|---|
| фикстуры по HTTP | `scripts/fixture-server.mjs`, два порта; тест среды падает под `file://` |
| честные коды | растровый фон больше не зовётся градиентом; 6 новых кодов |
| синхронные заявки | `AssetRequests` на уровне захвата, дедупликация по URL |
| `<img>` → `kind:'image'` | 4 картинки, 1 заявка; битая — заглушка с диагностикой |
| растровый фон | заливка с боксом начала отсчёта; ячейка с рамкой в фикстуре |
| байты | `fetch`, побайтовое совпадение с файлом на диске |
| рендерер | `<image>` и `<pattern>`, обрезка, отказ по имени на пропавший ассет |
| гейт | `image-fit` и `image-bg` — 0 пикселей на пяти ширинах |
| `.w2f` | ZIP, круговой обход, отказ с обеих сторон на оборванную ссылку |
| скриншоты | обычный ассет; проверено, что в дерево не просочился |

**Сверх плана.** Гейт нашёл два дефекта, которых план не предвидел: двойной
сдвиг на половину рамки у заливки-изображения и несведённые концы двухфазной
модели — узел без доехавших байтов ссылался в никуда. Добавлена
`reconcileAssets`, которой в плане не было.

**План ошибся дважды, и оба раза в сторону осторожности.**

1. Task 8 предупреждал ждать настоящего расхождения растеризации. Его нет:
   0 пикселей. Причина структурная — гейт растеризует SVG ТЕМ ЖЕ Chromium, в
   котором снята страница. Это объясняет и шесть предыдущих несбывшихся
   предсказаний подряд.
2. План держал `image-broken` в pixel-diff. Это категориальная ошибка: заглушка
   нарочно не похожа на браузер. Туда же ушла `image-cors` — браузер
   кросс-доменную картинку показывает, а байты не отдаёт, поэтому у нас на её
   месте законно стоит заглушка. Пиксельно сверять можно только воспроизводимое.

**Долг, записанный и не закрытый:** `<video>` и его `poster` остаются
молчаливой потерей без диагностики.

---

## Что измерено до написания плана

Три замера, и каждый меняет устройство плана. Ни один не взят из рассуждения.

### 1. Изображения теряются молча

Зонд: страница с `<img src="dot.png">` и `<div>` с `background: url(dot.png)`.

```
узлы:  frame <body> → frame <div> → frame <img>, frame <div>
отчёт: 1 × deferred.gradient
```

`<img>` приезжает обычным пустым фреймом. **Диагностики нет ни одной.** Расхождение с браузером — 27628 пикселей из 320000, то есть 8.6% изображения, и ни валидатор, ни гейт об этом не говорят, потому что ни одна фикстура изображений не содержит.

Это прямое нарушение правила «молчаливый откат — это баг», прожившее три плана незамеченным ровно потому, что проверять было нечем.

### 2. Код диагностики для растра — неверный

`background-image: url(...)` отчитывается кодом **`deferred.gradient`**. Растр градиентом не является; сообщение ведёт читателя не туда. Ветка в `readFills` не различает `url()` и `linear-gradient()`, а просто сообщает обо всём, что не разобралось как градиент.

### 3. Под `file://` рабочий путь физически непроверяем

Фикстуры открываются через `file://`. Замер в том же Chromium, что и гейт:

| источник | `OffscreenCanvas.convertToBlob` | `fetch(url)` |
|---|---|---|
| `file://` | `SecurityError: A tainted OffscreenCanvas may not be exported` | `TypeError: Failed to fetch` |
| `http://` тот же источник | ok, 449 байт | ok, **241 байт**, `image/png` |

Под `file://` Chrome считает документ непрозрачным источником: канва отравлена, `fetch` запрещён. То есть **гейт в нынешнем виде проверял бы только путь отказа**, а успешный путь не выполнялся бы ни разу. Поэтому переезд фикстур на HTTP — не удобство, а условие проверяемости, и он идёт первой задачей.

Второе следствие той же таблицы: `fetch` отдаёт **исходные** 241 байт, канва — переупакованные 449. Значит основной путь получения байтов — `fetch`, а канва нужна только для нормализации формата и масштаба. Брать байты канвой по умолчанию означало бы раздувать бандл и терять исходное качество без причины.

## Почему обход DOM остаётся синхронным

Заманчиво сделать `buildNode` асинхронным и забирать байты прямо на узле. Это было бы ошибкой, и не из-за стиля.

`await` внутри обхода отдаёт управление циклу событий. За это время раскладка может измениться: дочитается ленивое изображение и сдвинет поток, доработает анимация, сработает `IntersectionObserver`. Узлы, снятые до паузы, и узлы, снятые после, описывали бы **разные состояния страницы**, а IR утверждал бы, что это один кадр. Такая порча не ловится ни валидатором, ни pixel-diff — оба сравнивают то, что доехало, и внутренняя противоречивость для них невидима.

Поэтому две фазы:

1. **Синхронная.** Обход регистрирует заявку `request(url, natural, nodeId)` и немедленно получает `assetId`. Никаких `await`. Состояние страницы читается одним непрерывным проходом, как и сейчас.
2. **Асинхронная.** `resolveAssets(requests)` забирает байты, нормализует, отдаёт `Asset[]` + содержимое + диагностики отказов.

Побочная выгода: вторая фаза не зависит от DOM, поэтому в плане 6 она целиком переедет в background-воркер расширения, где `fetch` имеет host-разрешения и не упирается в CORS страницы. Граница проведена там, где она всё равно понадобится.

## Идентификаторы ассетов живут на уровне захвата, а не экрана

Та же причина, что и у идентификаторов узлов (см. комментарий в `global.ts`): инвариант `asset.dangling` проверяет ссылки в пределах **бандла**. Пять экранов снимаются пятью вызовами по одной вкладке, и один и тот же логотип обязан получить один `assetId` на всех пяти — иначе бандл несёт пять копий одних байтов.

Значит `AssetRequests` создаётся в `beginCapture()` рядом с аллокатором узлов и переживает серию экранов. Дедупликация по разрешённому URL — не оптимизация, а требование инварианта.

## Чего этот план сознательно НЕ делает

Каждый пункт обязан порождать диагностику, а не исчезать:

| что | почему отложено | код |
|---|---|---|
| inline `<svg>` и `<svg>` по `url()` | вектор — отдельная тема, у гейта нет способа сверить кривые | `deferred.vector` |
| `mask-image`, `border-image` | Figma выражает маску иначе, чем CSS; перенос без проверки был бы догадкой | `deferred.mask` (новый) |
| несколько слоёв `background-image` | контракт держит список `fills`, но порядок и смешение слоёв не измерены | `deferred.gradient` по существующей ветке |
| `<video>`, его `poster` | кадр видео — не изображение страницы | `unsupported.canvas`-подобный новый код не заводится: элемент и сейчас даёт пустой фрейм, и это надо закрыть отдельной задачей плана 6 |

Последняя строка — честная запись долга, а не его закрытие. `<video>` остаётся молчаливой потерей после этого плана; он вынесен сюда, чтобы не потеряться.

## Правила, унаследованные от планов 1–3

**TDD.** Тест первым, запуск, падение по ожидаемой причине, потом реализация.

**Проверяй проверки.** За три плана одиннадцать проверок оказались негодными, и все одиннадцать **проходили**. Сломай проверяемое и убедись, что проверка упала.

Случай 11 добавил подвид, встреченный впервые: **проходящий тест может быть не пустым, а неверным** — закреплять утверждение, противоположное поведению браузера. Отличить это от настоящей проверки нельзя рассуждением, только замером. В этом плане такой риск максимален у `ImagePlacement.mode` — см. Task 4.

**Пороги не подгоняются.** Главная метрика — абсолютный бюджет пикселей.

**Мои оценки systematically неверны.** Пять раз подряд я предсказывал расхождение растеризации, и пять раз результат совпадал пиксель в пиксель. Здесь впервые есть основание ждать настоящего расхождения — пересэмплинг изображения браузером и `resvg` реализованы разными фильтрами. Но это тоже оценка, а не факт: измеряй и вписывай измеренное.

**Коммиты** заканчиваются трейлером:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## Структура файлов

```
tests/e2e/helpers/server.ts        НОВЫЙ: статический сервер фикстур
tests/e2e/helpers/capture.ts       fixtureUrl теперь http://127.0.0.1:PORT/...
playwright.config.ts               webServer
scripts/capture.mjs                поднимает тот же сервер

packages/ir/src/codes.ts           + коды изображений и deferred.mask
packages/ir/src/types.ts           уточнение комментария к ImagePlacement

packages/serializer/src/assets.ts  НОВЫЙ: AssetRequests (синхронная фаза)
packages/serializer/src/resolve-assets.ts  НОВЫЙ: асинхронная фаза
packages/serializer/src/css/image.ts       НОВЫЙ: placement из CSS
packages/serializer/src/walk.ts            <img> → kind:'image', url() → Fill
packages/serializer/src/global.ts          AssetRequests в beginCapture
packages/serializer/src/serialize.ts       заявки в SerializeResult

packages/reference-renderer/src/render.ts  <image> и <pattern>

packages/bundle/                   НОВЫЙ ПАКЕТ: упаковка и распаковка .w2f

fixtures/image-fit/       object-fit: fill|contain|cover|none
fixtures/image-bg/        background-size/position/repeat
fixtures/image-broken/    недоступный и битый источник — путь отказа
```

**Все снапшоты IR изменятся** у фикстур с изображениями; у остальных — нет. Если изменился снапшот фикстуры без изображений, это регрессия, а не ожидаемый диff.

---

### Task 1: Фикстуры переезжают на HTTP

Первой задачей, потому что без неё все остальные непроверяемы: под `file://` успешный путь получения байтов не выполняется ни разу (см. замер 3).

**Files:**
- Create: `scripts/fixture-server.mjs`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/helpers/capture.ts:45-46`
- Modify: `scripts/capture.mjs`
- Test: `tests/e2e/assets.spec.ts`

- [ ] **Step 1: Написать падающий тест — среда обязана отдавать байты изображения**

Создай `tests/e2e/assets.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { fixtureUrl } from './helpers/capture.js'

/** Проверка не про наш код, а про СРЕДУ. Она существует потому, что под
 *  `file://` Chrome считает документ непрозрачным источником: канва
 *  отравлена, `fetch` запрещён, и весь успешный путь работы с ассетами
 *  не выполняется ни разу. Тест на самом сериализаторе этого не покажет —
 *  он покажет ровно то же самое, что показал бы при полностью сломанном
 *  захвате: отказ. Поэтому условие среды проверяется отдельно и первым. */
test('среда фикстур отдаёт байты изображения', async ({ page }) => {
  await page.goto(fixtureUrl('image-fit'))
  const verdict = await page.evaluate(async () => {
    const img = document.querySelector('img')
    if (img === null) return 'в фикстуре нет <img>'
    try {
      const response = await fetch(img.currentSrc)
      const bytes = await response.arrayBuffer()
      return bytes.byteLength > 0 ? 'ok' : 'нулевая длина'
    } catch (error) {
      return `ОТКАЗ: ${String(error)}`
    }
  })
  expect(verdict).toBe('ok')
})
```

- [ ] **Step 2: Создать фикстуру, на которой тест может выполниться**

```bash
mkdir -p fixtures/image-fit
```

Изображение генерируется скриптом, а не кладётся бинарником: содержимое обязано быть воспроизводимым и объяснимым.

Создай `fixtures/image-fit/make-asset.mjs`:

```js
/** Генератор тестового изображения. Существует вместо закоммиченного
 *  бинарника, чтобы содержимое можно было прочитать и воспроизвести:
 *  непрозрачный PNG в репозитории невозможно отревьюить.
 *
 *  Картинка намеренно НЕквадратная (64×32) и с градиентом по обеим осям:
 *  на квадратной невозможно отличить `contain` от `cover`, а на
 *  однотонной — заметить зеркальное отражение или поворот. */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const W = 64
const H = 32
const png = new PNG({ width: W, height: H })
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = (W * y + x) << 2
    png.data[i] = Math.round((x / (W - 1)) * 255)
    png.data[i + 1] = Math.round((y / (H - 1)) * 255)
    png.data[i + 2] = 64
    png.data[i + 3] = 255
  }
}
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(resolve(here, 'asset.png'), PNG.sync.write(png))
console.log('fixtures/image-fit/asset.png записан')
```

Запусти: `node fixtures/image-fit/make-asset.mjs`

Создай `fixtures/image-fit/index.html`:

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>image-fit</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;padding:24px}
  /* Бокс намеренно другого соотношения сторон, чем картинка (64×32):
     на совпадающем object-fit не различим вовсе. */
  .row{display:flex;gap:16px}
  img{width:120px;height:90px;background:#eee}
  .fill{object-fit:fill}
  .contain{object-fit:contain}
  .cover{object-fit:cover}
  .none{object-fit:none}
</style></head>
<body>
  <div class="row">
    <img class="fill" src="asset.png" alt="fill">
    <img class="contain" src="asset.png" alt="contain">
    <img class="cover" src="asset.png" alt="cover">
    <img class="none" src="asset.png" alt="none">
  </div>
</body></html>
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает по ожидаемой причине**

Run: `npx playwright test tests/e2e/assets.spec.ts`

Expected: FAIL, `expected "ОТКАЗ: TypeError: Failed to fetch" to be "ok"`.

Если он падает с чем-то другим — остановись и разберись: причина обязана быть именно `file://`, иначе дальше чинится не то.

- [ ] **Step 4: Написать сервер фикстур**

Создай `scripts/fixture-server.mjs`:

```js
/** Статический сервер фикстур.
 *
 *  Нужен не для удобства. Под `file://` Chrome считает документ
 *  непрозрачным источником: `OffscreenCanvas` отравлена, `fetch`
 *  запрещён — то есть весь успешный путь работы с изображениями не
 *  выполняется ни разу, и гейт проверял бы только путь отказа.
 *  Измерено в том же Chromium, что и тесты.
 *
 *  Порт фиксирован: его знают и `playwright.config.ts`, и
 *  `scripts/capture.mjs`, а согласовывать динамический между
 *  отдельными процессами нечем.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURE_PORT = 4317

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

export const createFixtureServer = () => createServer(async (req, res) => {
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0])
  /** Защита от выхода за корень. Сервер локальный и живёт секунды, но
   *  путь приходит из строки, а «локальный и ненадолго» — не свойство
   *  кода, а обстоятельство, которое может перестать быть верным. */
  const target = normalize(join(root, requested))
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  try {
    const body = await readFile(target)
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      /** Кеш выключен: тест обязан видеть текущий файл, а не тот,
       *  что лежал здесь на прошлом прогоне. */
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})

/** Запуск как самостоятельного процесса — так его поднимает Playwright. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createFixtureServer().listen(FIXTURE_PORT, '127.0.0.1', () => {
    console.log(`фикстуры на http://127.0.0.1:${FIXTURE_PORT}/`)
  })
}
```

- [ ] **Step 5: Подключить сервер к Playwright и переписать `fixtureUrl`**

В `playwright.config.ts` добавь в объект конфигурации:

```ts
  webServer: {
    command: 'node scripts/fixture-server.mjs',
    url: 'http://127.0.0.1:4317/boxes/index.html',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
```

В `tests/e2e/helpers/capture.ts` замени `fixtureUrl` (строки 45-46):

```ts
/** Фикстуры отдаются по HTTP, а не `file://`. Причина — в
 *  `scripts/fixture-server.mjs`: под `file://` канва отравлена и `fetch`
 *  запрещён, поэтому успешный путь работы с ассетами не выполняется. */
export const FIXTURE_ORIGIN = 'http://127.0.0.1:4317'

export const fixtureUrl = (name: string): string =>
  `${FIXTURE_ORIGIN}/${name}/index.html`
```

Импорт `pathToFileURL` в этом файле станет неиспользуемым — удали его из строки 2, иначе `pnpm typecheck:root` упадёт на `noUnusedLocals`.

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

Run: `npx playwright test tests/e2e/assets.spec.ts`
Expected: PASS.

- [ ] **Step 7: Убедиться, что переезд ничего не сломал**

Run: `pnpm test`
Expected: всё зелёное, снапшоты IR **не изменились**.

Снапшоты не содержат URL — это проверено: в `ir.json` лежат ключи `screen`, `report`, `fonts`. Если какой-то снапшот всё же разошёлся, **не перегенерируй его**: разберись, что именно зависело от схемы URL. Молчаливая перегенерация здесь скрыла бы настоящее различие между `file://` и HTTP.

- [ ] **Step 8: Научить `scripts/capture.mjs` тому же**

В `scripts/capture.mjs` путь к фикстуре сейчас превращается в `file://` через `pathToFileURL`. Замени так, чтобы локальный путь внутри `fixtures/` отдавался через сервер:

```js
import { createFixtureServer, FIXTURE_PORT } from './fixture-server.mjs'

/** Локальный путь внутри `fixtures/` отдаётся через HTTP по той же
 *  причине, что и в тестах: под `file://` изображения не читаются.
 *  Внешний URL передаётся как есть. Сервер поднимается на время
 *  захвата и закрывается после — отдельный процесс здесь не нужен. */
const serveTarget = async (target) => {
  if (/^https?:\/\//.test(target)) return { url: target, close: () => {} }
  const abs = resolve(process.cwd(), target)
  const fixtures = resolve(process.cwd(), 'fixtures')
  if (!abs.startsWith(fixtures + sep)) {
    return { url: pathToFileURL(abs).href, close: () => {} }
  }
  const server = createFixtureServer()
  await new Promise((done) => server.listen(FIXTURE_PORT, '127.0.0.1', done))
  const rel = abs.slice(fixtures.length).split(sep).join('/')
  return {
    url: `http://127.0.0.1:${FIXTURE_PORT}${rel}`,
    close: () => new Promise((done) => server.close(done)),
  }
}
```

Вызови её вместо текущего `pathToFileURL(...)` и закрой сервер в `finally` рядом с закрытием браузера. Добавь `sep` в импорт из `node:path`.

Файл вне `fixtures/` по-прежнему отдаётся через `file://` — там изображения не прочитаются, и это **правильно**: так поведёт себя и настоящая страница с недоступными байтами, а путь отказа тоже должен быть выполнимым руками.

- [ ] **Step 9: Проверить руками**

Run: `pnpm capture fixtures/image-fit/index.html 800 400`
Expected: захват проходит, в отчёте — диагностика об изображениях (их ещё не умеем переносить), `out/page.png` содержит четыре картинки.

- [ ] **Step 10: Коммит**

```bash
git add scripts/fixture-server.mjs scripts/capture.mjs playwright.config.ts \
        tests/e2e/helpers/capture.ts tests/e2e/assets.spec.ts fixtures/image-fit
git commit -m "test(e2e): фикстуры отдаются по HTTP, иначе путь ассетов непроверяем

Под file:// Chrome считает документ непрозрачным источником: OffscreenCanvas
отравлена (SecurityError при convertToBlob), fetch запрещён (Failed to fetch).
Измерено в том же Chromium, что и гейт. Значит успешный путь получения байтов
изображения не выполнялся бы ни разу, а проверялся бы только путь отказа.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Коды диагностик и честное сообщение про `url()`

Отдельной задачей, потому что коды — стабильный контракт: на них ссылается плагин. Заводить их по ходу реализации значит менять контракт задним числом.

**Files:**
- Modify: `packages/ir/src/codes.ts`
- Modify: `packages/serializer/src/walk.ts` (ветка `readFills`, строки около 263)
- Test: `packages/serializer/test/image-codes.test.ts`

- [ ] **Step 1: Написать падающий тест на неверный код**

Создай `packages/serializer/test/image-codes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import { classifyBackgroundImage } from '../src/css/image.js'

describe('classifyBackgroundImage', () => {
  it('растр по url() не называется градиентом', () => {
    const verdict = classifyBackgroundImage('url("https://example.test/a.png")')
    expect(verdict.kind).toBe('raster')
    if (verdict.kind !== 'raster') return
    expect(verdict.url).toBe('https://example.test/a.png')
  })

  it('линейный градиент остаётся градиентом', () => {
    expect(classifyBackgroundImage('linear-gradient(red, blue)').kind)
      .toBe('gradient')
  })

  /** SVG по url() — вектор, а не растр: переносить его как пиксели
   *  значило бы терять масштабируемость молча. Отдельная ветка нужна
   *  именно поэтому, а не ради аккуратности. */
  it('svg по url() отправляется в вектор, а не в растр', () => {
    const verdict = classifyBackgroundImage('url("/icon.svg")')
    expect(verdict.kind).toBe('vector')
    if (verdict.kind !== 'vector') return
    expect(verdict.code).toBe(DIAGNOSTIC_CODES.deferredVector)
  })

  /** Несколько слоёв фона контракт представить может (`fills` — список),
   *  но их порядок и смешение не измерены. Пока это отложенный случай,
   *  и он обязан отличаться от «не разобрали одиночный градиент». */
  it('несколько слоёв — отдельный вердикт, а не первый слой молча', () => {
    expect(classifyBackgroundImage('url(a.png), linear-gradient(red, blue)').kind)
      .toBe('multi-layer')
  })

  it('маска отличается от фона', () => {
    expect(classifyBackgroundImage('none').kind).toBe('none')
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm vitest run packages/serializer/test/image-codes.test.ts`
Expected: FAIL, `Cannot find module '../src/css/image.js'`.

- [ ] **Step 3: Добавить коды**

В `packages/ir/src/codes.ts` добавь в объект `DIAGNOSTIC_CODES`:

```ts
  /** Байты изображения недоступны: CORS, отравленная канва, сетевой
   *  отказ или битый источник. Узел обязан стать заглушкой, а не
   *  пустым фреймом. До плана 4 `<img>` молча приезжал пустым фреймом
   *  без единой записи в отчёте — 27628 расходящихся пикселей из
   *  320000 на зонде, невидимых и для валидатора, и для pixel-diff. */
  imageUnreadable: 'fidelity.image-unreadable',
  /** Изображение ужато: `figma.createImage` ограничен 4096px по стороне.
   *  Факт масштабирования обязан быть в отчёте — он необратим. */
  imageRescaled: 'fidelity.image-rescaled',
  /** Формат переупакован в PNG: Figma принимает PNG/JPG/GIF, а страница
   *  могла отдать WebP или AVIF. Переупаковка меняет байты и может
   *  менять качество, поэтому молчать о ней нельзя. */
  imageRecoded: 'fidelity.image-recoded',
  /** `mask-image` или `border-image`. Figma выражает маску иначе, чем
   *  CSS, и перенос без способа сверить результат был бы догадкой. */
  deferredMask: 'deferred.mask',
  /** Несколько слоёв `background-image` в одном объявлении. Контракт
   *  их представляет (`fills` — список), но порядок и смешение слоёв
   *  не измерены, поэтому перенесён только случай одного слоя. */
  deferredMultiLayerBackground: 'deferred.multi-layer-background',
```

- [ ] **Step 4: Написать классификатор**

Создай `packages/serializer/src/css/image.ts`:

```ts
import { DIAGNOSTIC_CODES, type DiagnosticCode } from '@w2f/ir/codes'

export type BackgroundImageVerdict =
  | { kind: 'none' }
  | { kind: 'raster'; url: string }
  | { kind: 'gradient' }
  | { kind: 'vector'; code: DiagnosticCode }
  | { kind: 'multi-layer'; code: DiagnosticCode }
  | { kind: 'unknown'; raw: string }

/** Верхнеуровневые запятые — границы слоёв фона. Простой `split(',')`
 *  не годится: запятые есть внутри `rgb(...)` и внутри самих градиентов,
 *  то есть разрезал бы один слой на несколько и объявлял многослойным
 *  обычный `linear-gradient(red, blue)`. */
const splitLayers = (value: string): string[] => {
  const layers: string[] = []
  let depth = 0
  let start = 0
  let quote: string | null = null
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      layers.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  layers.push(value.slice(start).trim())
  return layers.filter((layer) => layer.length > 0)
}

const URL_PATTERN = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)$/

export const parseUrlToken = (layer: string): string | null => {
  const match = URL_PATTERN.exec(layer)
  if (match === null) return null
  const raw = match[1] ?? match[2] ?? match[3] ?? ''
  return raw.trim().length > 0 ? raw.trim() : null
}

/** SVG распознаётся по расширению пути, а не по типу содержимого: тип
 *  известен только после загрузки, а решение нужно на синхронном обходе.
 *  Ошибка возможна в обе стороны (`.svg`, отдающий PNG; `.php`, отдающий
 *  SVG) — поэтому вторая проверка по настоящему MIME живёт в фазе
 *  разрешения ассетов, где содержимое уже в руках. */
const looksLikeSvg = (url: string): boolean => {
  const path = url.split('?')[0]?.split('#')[0] ?? ''
  return path.toLowerCase().endsWith('.svg')
}

export const classifyBackgroundImage = (value: string): BackgroundImageVerdict => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'none') return { kind: 'none' }

  const layers = splitLayers(trimmed)
  if (layers.length > 1) {
    return {
      kind: 'multi-layer',
      code: DIAGNOSTIC_CODES.deferredMultiLayerBackground,
    }
  }

  const layer = layers[0] ?? ''
  const url = parseUrlToken(layer)
  if (url !== null) {
    return looksLikeSvg(url)
      ? { kind: 'vector', code: DIAGNOSTIC_CODES.deferredVector }
      : { kind: 'raster', url }
  }
  if (layer.includes('gradient(')) return { kind: 'gradient' }
  return { kind: 'unknown', raw: layer }
}
```

- [ ] **Step 5: Запустить тест**

Run: `pnpm vitest run packages/serializer/test/image-codes.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 6: Сломать проверяемое и убедиться, что тест ловит**

Замени в `splitLayers` разбор на наивный `value.split(',')` и запусти тест снова.

Expected: FAIL на градиенте — `linear-gradient(red, blue)` будет объявлен многослойным.

Верни как было. Если тест при наивном разборе **проходит**, значит он не воспроизводит условие: добавь в него градиент с запятой внутри и начни заново.

- [ ] **Step 7: Подключить классификатор в `readFills`**

В `packages/serializer/src/walk.ts` ветка на строке около 263 сейчас сообщает `deferred.gradient` обо всём, что не разобралось. Замени её на разбор по вердикту:

```ts
  if (cs.backgroundImage !== 'none') {
    const verdict = classifyBackgroundImage(cs.backgroundImage)
    switch (verdict.kind) {
      case 'gradient': {
        const gradient = parseLinearGradient(cs.backgroundImage, box)
        if (gradient !== null) fills.push({ kind: 'gradient', gradient })
        else sink.report(
          'info', DIAGNOSTIC_CODES.deferredGradient,
          `Градиент "${cs.backgroundImage.slice(0, 60)}" не разобран.`, id, false,
        )
        break
      }
      case 'vector':
        sink.report('info', verdict.code,
          'Векторный фон (SVG) не переносится растром.', id, false)
        break
      case 'multi-layer':
        sink.report('info', verdict.code,
          'Несколько слоёв фона: перенесён только одиночный слой.', id, false)
        break
      case 'unknown':
        sink.report('warning', DIAGNOSTIC_CODES.deferredGradient,
          `Фоновое изображение "${verdict.raw.slice(0, 60)}" не распознано.`,
          id, false)
        break
      case 'raster':
        /** Растр обрабатывается в Task 5, где есть заявки на ассеты.
         *  Пока — явная диагностика, а НЕ тишина: до плана 4 этот
         *  случай отчитывался кодом `deferred.gradient`, уводя
         *  читателя отчёта не туда. */
        sink.report('warning', DIAGNOSTIC_CODES.imageUnreadable,
          'Растровый фон ещё не переносится.', id, false)
        break
      case 'none':
        break
    }
  }
```

Добавь импорт `classifyBackgroundImage` из `./css/image.js`.

- [ ] **Step 8: Проверить на зонде**

Run: `pnpm capture fixtures/image-fit/index.html 800 400`
Expected: в отчёте больше **нет** `deferred.gradient` от растрового фона.

- [ ] **Step 9: Полный прогон и коммит**

Run: `pnpm test` — всё зелёное.

```bash
git add packages/ir/src/codes.ts packages/serializer/src/css/image.ts \
        packages/serializer/src/walk.ts packages/serializer/test/image-codes.test.ts
git commit -m "feat(ir): коды изображений; растровый фон больше не зовётся градиентом

background-image: url(...) отчитывался кодом deferred.gradient — растр
градиентом не является, и сообщение вело читателя отчёта не туда. Ветка
readFills не различала url() и linear-gradient(), а сообщала обо всём, что
не разобралось как градиент.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Заявки на ассеты — синхронная фаза

**Files:**
- Create: `packages/serializer/src/assets.ts`
- Test: `packages/serializer/test/assets.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создай `packages/serializer/test/assets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AssetRequests } from '../src/assets.js'

describe('AssetRequests', () => {
  it('выдаёт идентификатор на заявку', () => {
    const requests = new AssetRequests()
    expect(requests.request('https://a.test/x.png', 10, 20, 'n1')).toBe('a0')
  })

  /** Дедупликация по URL — не оптимизация, а требование инварианта
   *  `asset.dangling`: он проверяет ссылки в пределах БАНДЛА. Пять
   *  экранов снимаются пятью вызовами по одной вкладке, и один и тот же
   *  логотип обязан получить один идентификатор на всех пяти, иначе
   *  бандл несёт пять копий одних байтов. */
  it('один URL даёт один идентификатор', () => {
    const requests = new AssetRequests()
    const first = requests.request('https://a.test/x.png', 10, 20, 'n1')
    const second = requests.request('https://a.test/x.png', 10, 20, 'n2')
    expect(second).toBe(first)
    expect(requests.drain()).toHaveLength(1)
  })

  it('разные URL дают разные идентификаторы', () => {
    const requests = new AssetRequests()
    const first = requests.request('https://a.test/x.png', 10, 20, 'n1')
    const second = requests.request('https://a.test/y.png', 10, 20, 'n2')
    expect(second).not.toBe(first)
  })

  /** `drain` отдаёт копию по той же причине, что и `DiagnosticSink.drain`:
   *  вызывающий не должен иметь возможности испортить накопленное. */
  it('drain отдаёт копию, а не внутренний массив', () => {
    const requests = new AssetRequests()
    requests.request('https://a.test/x.png', 10, 20, 'n1')
    requests.drain().length = 0
    expect(requests.drain()).toHaveLength(1)
  })

  /** Первый узел запоминается намеренно: сообщение «байты недоступны»
   *  без указания узла не говорит, куда смотреть. */
  it('заявка помнит узел, из-за которого понадобилась', () => {
    const requests = new AssetRequests()
    requests.request('https://a.test/x.png', 64, 32, 'n7')
    const [first] = requests.drain()
    expect(first).toEqual({
      id: 'a0', url: 'https://a.test/x.png',
      naturalWidth: 64, naturalHeight: 32, nodeId: 'n7',
    })
  })
})
```

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `pnpm vitest run packages/serializer/test/assets.test.ts`
Expected: FAIL, `Cannot find module '../src/assets.js'`.

- [ ] **Step 3: Реализовать**

Создай `packages/serializer/src/assets.ts`:

```ts
/** Заявка на байты изображения, поданная СИНХРОННЫМ обходом DOM.
 *
 *  Обход не забирает байты сам и не может: `await` внутри него отдаёт
 *  управление циклу событий, за это время раскладка меняется
 *  (дочитывается ленивое изображение, доигрывает анимация), и узлы,
 *  снятые до паузы и после, описывают РАЗНЫЕ состояния страницы. IR при
 *  этом утверждает, что это один кадр. Такая порча невидима и для
 *  валидатора, и для pixel-diff: оба сравнивают то, что доехало. */
export type AssetRequest = {
  id: string
  url: string
  /** Собственный размер источника. Нужен фазе разрешения, чтобы решить
   *  про масштабирование, не дожидаясь декодирования. */
  naturalWidth: number
  naturalHeight: number
  /** Первый узел, которому ассет понадобился. Сообщение об отказе без
   *  узла не говорит, куда смотреть; при дедупликации остаётся первый. */
  nodeId: string
}

/** Живёт на уровне ЗАХВАТА, а не экрана — так же, как аллокатор узлов
 *  (см. комментарий в `global.ts`). Инвариант `asset.dangling` проверяет
 *  ссылки в пределах бандла, и один логотип на пяти экранах обязан быть
 *  одним ассетом. */
export class AssetRequests {
  private readonly byUrl = new Map<string, string>()
  private readonly items: AssetRequest[] = []
  private counter = 0

  request(
    url: string,
    naturalWidth: number,
    naturalHeight: number,
    nodeId: string,
  ): string {
    const existing = this.byUrl.get(url)
    if (existing !== undefined) return existing

    const id = `a${this.counter}`
    this.counter += 1
    this.byUrl.set(url, id)
    this.items.push({ id, url, naturalWidth, naturalHeight, nodeId })
    return id
  }

  drain(): AssetRequest[] {
    return [...this.items]
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `pnpm vitest run packages/serializer/test/assets.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Сломать дедупликацию и убедиться, что тест ловит**

Убери `if (existing !== undefined) return existing`.

Expected: FAIL на «один URL даёт один идентификатор».

Верни как было.

- [ ] **Step 6: Провести заявки через захват**

В `packages/serializer/src/serialize.ts`:

- добавь в `SerializeOptions` поле `requests: AssetRequests`;
- передай его в `walkDocument`;
- добавь в `SerializeResult` поле `assetRequests: AssetRequest[]` со значением `options.requests.drain()`.

Комментарий к полю:

```ts
  /** Заявки на байты, поданные этим экраном. Отдаются наружу по той же
   *  причине, что и `fonts`: `Bundle.assets` — уровень бандла, а данные
   *  есть только у обходчика. Накопитель общий на весь захват, поэтому
   *  на пятом экране здесь будут и заявки первых четырёх — это верно:
   *  сборщику бандла нужен полный список, а не приращение. */
  assetRequests: AssetRequest[]
```

В `packages/serializer/src/global.ts` создавай накопитель в `beginCapture` рядом с аллокатором:

```ts
let requests: AssetRequests | null = null

const beginCapture = (): void => {
  allocator = createIdAllocator()
  requests = new AssetRequests()
}

const captureScreen = (id: string, name: string): SerializeResult => {
  if (allocator === null) allocator = createIdAllocator()
  if (requests === null) requests = new AssetRequests()
  return serializeScreen({ id, name, allocId: allocator, requests })
}
```

В `WalkContext` (`walk.ts`) добавь поле `requests: AssetRequests` и протащи его через `buildNode`.

- [ ] **Step 7: Полный прогон и коммит**

Run: `pnpm test` — зелёное; снапшоты не изменились (заявок пока никто не подаёт).

```bash
git add packages/serializer/src/assets.ts packages/serializer/src/serialize.ts \
        packages/serializer/src/global.ts packages/serializer/src/walk.ts \
        packages/serializer/test/assets.test.ts
git commit -m "feat(serializer): заявки на ассеты, синхронная фаза

Обход DOM остаётся синхронным: await внутри него позволил бы раскладке
измениться на полпути, и узлы до паузы и после описывали бы разные состояния
страницы, тогда как IR утверждает, что это один кадр. Накопитель живёт на
уровне захвата, а не экрана — инвариант asset.dangling проверяет ссылки в
пределах бандла.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Размещение изображения и `<img>` → `kind: 'image'`

**Ловушка имён, которую надо держать в голове всю задачу.** CSS `object-fit: fill` означает «растянуть по обеим осям, соотношение не сохранять». Режим `'fill'` нашего контракта означает то же, что `FILL` в Figma: «заполнить бокс, сохранив пропорции, лишнее обрезать» — то есть CSS `cover`. **Слово одно, смысл разный.** Отображение такое:

| CSS | режим контракта | почему |
|---|---|---|
| `object-fit: cover` | `fill` | Figma `FILL` — это именно заполнение с обрезкой |
| `object-fit: contain` | `fit` | Figma `FIT` |
| `object-fit: fill` | `crop` | растяжение без сохранения пропорций Figma режимом не выражает — только явной трансформой |
| `object-fit: none`, `scale-down` | `crop` | то же: нужна явная трансформа |
| `background-repeat: repeat` | `tile` | |

**Files:**
- Modify: `packages/ir/src/types.ts` (уточнение комментария к `ImagePlacement`)
- Modify: `packages/serializer/src/css/image.ts`
- Modify: `packages/serializer/src/walk.ts`
- Test: `packages/serializer/test/image-placement.test.ts`
- Test: `tests/e2e/assets.spec.ts`

- [ ] **Step 1: Измерить, что Chrome отдаёт в вычисленном стиле**

Не угадывать. Прогони разово:

```bash
cat > /tmp/probe-fit.mjs <<'JS'
import { chromium } from '@playwright/test'
const b = await chromium.launch(); const p = await b.newPage()
await p.goto('http://127.0.0.1:4317/image-fit/index.html')
console.log(await p.evaluate(() => [...document.querySelectorAll('img')].map((el) => {
  const cs = getComputedStyle(el)
  return { cls: el.className, fit: cs.objectFit, pos: cs.objectPosition }
})))
await b.close()
JS
node scripts/fixture-server.mjs & sleep 1; node /tmp/probe-fit.mjs; kill %1
```

Запиши полученное в комментарий к парсеру. Ожидание: ключевые слова (`left`, `center`) приведены к процентам, значения всегда парные. **Если это не так — парсер пишется под то, что вернулось, а не под ожидание.**

- [ ] **Step 2: Написать падающие тесты на арифметику размещения**

Создай `packages/serializer/test/image-placement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { placementFor } from '../src/css/image.js'

const box = { w: 120, h: 90 }
const natural = { w: 64, h: 32 }

describe('placementFor: object-fit', () => {
  /** Растяжение по обеим осям: масштабы РАЗНЫЕ. Это единственный
   *  случай, где scaleX !== scaleY, и именно он ловит подмену
   *  «посчитать один масштаб и положить в оба поля». */
  it('fill растягивает по обеим осям независимо', () => {
    const p = placementFor('fill', '50% 50%', box, natural)
    expect(p.scaleX).toBeCloseTo(120 / 64, 6)
    expect(p.scaleY).toBeCloseTo(90 / 32, 6)
    expect(p.offsetX).toBeCloseTo(0, 6)
    expect(p.offsetY).toBeCloseTo(0, 6)
    expect(p.mode).toBe('crop')
  })

  /** contain: масштаб по МЕНЬШЕЙ стороне, картинка целиком видна.
   *  120/64 = 1.875, 90/32 = 2.8125 → берётся 1.875. */
  it('contain берёт меньший масштаб и центрирует остаток', () => {
    const p = placementFor('contain', '50% 50%', box, natural)
    expect(p.scaleX).toBeCloseTo(1.875, 6)
    expect(p.scaleY).toBeCloseTo(1.875, 6)
    expect(p.offsetX).toBeCloseTo(0, 6)
    expect(p.offsetY).toBeCloseTo((90 - 32 * 1.875) / 2, 6)
    expect(p.mode).toBe('fit')
  })

  /** cover: масштаб по БОЛЬШЕЙ стороне, бокс заполнен, лишнее уходит
   *  за края — поэтому смещение ОТРИЦАТЕЛЬНОЕ. Проверка существует
   *  именно ради знака: `Math.abs` где-нибудь в формуле прошёл бы
   *  все остальные случаи. */
  it('cover берёт больший масштаб и даёт отрицательное смещение', () => {
    const p = placementFor('cover', '50% 50%', box, natural)
    expect(p.scaleX).toBeCloseTo(2.8125, 6)
    expect(p.offsetX).toBeCloseTo((120 - 64 * 2.8125) / 2, 6)
    expect(p.offsetX).toBeLessThan(0)
    expect(p.mode).toBe('fill')
  })

  it('none оставляет натуральный размер', () => {
    const p = placementFor('none', '50% 50%', box, natural)
    expect(p.scaleX).toBe(1)
    expect(p.scaleY).toBe(1)
    expect(p.offsetX).toBeCloseTo((120 - 64) / 2, 6)
  })

  /** scale-down — это min(none, contain). На нашем боксе картинка
   *  МЕНЬШЕ бокса, поэтому побеждает none, а не contain. Случай
   *  выбран так, чтобы отличать реализацию от «просто contain». */
  it('scale-down не увеличивает картинку', () => {
    const p = placementFor('scale-down', '50% 50%', box, natural)
    expect(p.scaleX).toBe(1)
  })
})

describe('placementFor: object-position', () => {
  it('проценты считаются от свободного места, а не от бокса', () => {
    const p = placementFor('none', '100% 0%', box, natural)
    expect(p.offsetX).toBeCloseTo(120 - 64, 6)
    expect(p.offsetY).toBeCloseTo(0, 6)
  })

  it('пиксели кладутся смещением напрямую', () => {
    const p = placementFor('none', '10px 4px', box, natural)
    expect(p.offsetX).toBeCloseTo(10, 6)
    expect(p.offsetY).toBeCloseTo(4, 6)
  })

  /** Неразобранная позиция обязана дать центр, а не ноль: центр — это
   *  начальное значение CSS, и молчаливый ноль сдвинул бы картинку. */
  it('неразобранная позиция даёт центр', () => {
    const p = placementFor('none', 'какая-то ерунда', box, natural)
    expect(p.offsetX).toBeCloseTo((120 - 64) / 2, 6)
  })
})
```

- [ ] **Step 3: Запустить, убедиться в падении**

Run: `pnpm vitest run packages/serializer/test/image-placement.test.ts`
Expected: FAIL, `placementFor is not a function`.

- [ ] **Step 4: Реализовать арифметику**

Добавь в `packages/serializer/src/css/image.ts`:

```ts
import type { ImagePlacement } from '@w2f/ir'

type Size = { w: number; h: number }

/** Одна компонента `object-position` / `background-position`.
 *  `null` — не разобрана: вызывающий обязан подставить НАЧАЛЬНОЕ
 *  значение CSS (центр), а не ноль. Ноль сдвинул бы картинку влево
 *  и вверх, и это выглядело бы как настоящая раскладка. */
const parsePositionPart = (
  part: string,
  free: number,
): number | null => {
  const percent = /^(-?[\d.]+)%$/.exec(part)
  if (percent !== null) {
    const value = Number.parseFloat(percent[1] ?? '')
    return Number.isNaN(value) ? null : (free * value) / 100
  }
  const px = /^(-?[\d.]+)px$/.exec(part)
  if (px !== null) {
    const value = Number.parseFloat(px[1] ?? '')
    return Number.isNaN(value) ? null : value
  }
  return null
}

/** Масштабы по осям для заданного `object-fit`.
 *
 *  Разведены именно как пара, а не как одно число: при `fill` они
 *  различаются, и единственное число молча растеряло бы растяжение. */
const scaleFor = (fit: string, box: Size, natural: Size): { x: number; y: number } => {
  const byWidth = box.w / natural.w
  const byHeight = box.h / natural.h
  switch (fit) {
    case 'contain': {
      const s = Math.min(byWidth, byHeight)
      return { x: s, y: s }
    }
    case 'cover': {
      const s = Math.max(byWidth, byHeight)
      return { x: s, y: s }
    }
    case 'none':
      return { x: 1, y: 1 }
    case 'scale-down': {
      const s = Math.min(1, Math.min(byWidth, byHeight))
      return { x: s, y: s }
    }
    /** `fill` — начальное значение CSS и наш случай по умолчанию.
     *  Сюда же попадает всё нераспознанное: это совпадает с тем, как
     *  повёл бы себя браузер с неизвестным ключевым словом. */
    default:
      return { x: byWidth, y: byHeight }
  }
}

/** Режим для Figma.
 *
 *  ВНИМАНИЕ на имена: CSS `fill` означает «растянуть», а режим `fill`
 *  контракта — «заполнить с обрезкой», то есть CSS `cover`. Слово одно,
 *  смысл разный.
 *
 *  Поле НЕ проверяется pixel-diff: рендерер рисует по `scale`/`offset`,
 *  а режим нужен только плагину. Поэтому единственная его проверка —
 *  таблица в юнит-тесте, а настоящая сверка приходит в плане 5. Это
 *  записано здесь, чтобы поле не считалось проверенным гейтом. */
const modeFor = (fit: string): ImagePlacement['mode'] => {
  switch (fit) {
    case 'cover': return 'fill'
    case 'contain': return 'fit'
    default: return 'crop'
  }
}

export const placementFor = (
  fit: string,
  position: string,
  box: Size,
  natural: Size,
): ImagePlacement => {
  const scale = scaleFor(fit, box, natural)
  const drawn = { w: natural.w * scale.x, h: natural.h * scale.y }
  const freeX = box.w - drawn.w
  const freeY = box.h - drawn.h

  const parts = position.trim().split(/\s+/)
  const rawX = parts[0] ?? ''
  const rawY = parts[1] ?? parts[0] ?? ''

  const offsetX = parsePositionPart(rawX, freeX) ?? freeX / 2
  const offsetY = parsePositionPart(rawY, freeY) ?? freeY / 2

  return {
    mode: modeFor(fit),
    offsetX, offsetY,
    scaleX: scale.x, scaleY: scale.y,
  }
}
```

- [ ] **Step 5: Запустить тесты**

Run: `pnpm vitest run packages/serializer/test/image-placement.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 6: Сломать проверяемое — три слома, каждый обязан уронить свой тест**

1. В `scaleFor` для `fill` верни `{ x: byWidth, y: byWidth }` — обязан упасть тест про растяжение по двум осям.
2. В `placementFor` оберни смещения в `Math.abs` — обязан упасть тест про отрицательное смещение у `cover`.
3. В `placementFor` замени `?? freeX / 2` на `?? 0` — обязан упасть тест про неразобранную позицию.

Если какой-то слом **не** роняет свой тест, тест не воспроизводит условие: чини тест, а не слом.

Верни всё как было.

- [ ] **Step 7: Уточнить комментарий к `ImagePlacement` в контракте**

В `packages/ir/src/types.ts` замени комментарий к `ImagePlacement` на:

```ts
/** Размещение изображения в боксе. Не keyword: Figma управляет
 *  картинкой через трансформу, а CSS умеет
 *  `right 24px center / 120px auto`, что keyword'ом не выразить.
 *
 *  ИМЕНА РЕЖИМОВ СОВПАДАЮТ С FIGMA, А НЕ С CSS. `fill` здесь —
 *  «заполнить бокс, сохранив пропорции, лишнее обрезать», то есть
 *  CSS `object-fit: cover`. CSS `object-fit: fill` (растянуть, пропорции
 *  не сохранять) режимом Figma не выражается вовсе и приезжает как
 *  `crop` с разными `scaleX` и `scaleY`.
 *
 *  `scaleX`/`scaleY` — отношение нарисованного размера к собственному
 *  размеру источника; для `tile` тем же отношением задаётся размер
 *  одной плитки. Они, а не `mode`, определяют картинку: референс-
 *  рендерер читает именно их, и `mode` гейтом НЕ проверяется. */
```

- [ ] **Step 8: Написать `<img>` как `kind: 'image'`**

В `packages/serializer/src/walk.ts`, в `buildNode`, перед проверкой заглушки:

```ts
/** `<img>` без доехавших байтов — не изображение, а дыра. До плана 4
 *  такой элемент приезжал обычным пустым фреймом БЕЗ диагностики:
 *  27628 расходящихся пикселей из 320000 на зонде, невидимых и для
 *  валидатора, и для pixel-diff, потому что ни одна фикстура
 *  изображений не содержала.
 *
 *  `currentSrc`, а не `src`: при `srcset`/`<picture>` браузер уже
 *  выбрал источник, и снимать надо выбранный. Пустая строка означает,
 *  что выбор не состоялся — источник не загружен. */
const imageRefFor = (
  el: Element,
  cs: CSSStyleDeclaration,
  box: { w: number; h: number },
  ctx: WalkContext,
  id: string,
): ImageRef | null => {
  if (el.tagName !== 'IMG') return null
  const img = el as HTMLImageElement
  if (img.currentSrc === '' || img.naturalWidth === 0 || img.naturalHeight === 0) {
    ctx.sink.report(
      'warning', DIAGNOSTIC_CODES.imageUnreadable,
      `Источник <img> не загружен: "${img.getAttribute('src') ?? ''}".`,
      id, true,
    )
    return null
  }
  const natural = { w: img.naturalWidth, h: img.naturalHeight }
  return {
    assetId: ctx.requests.request(img.currentSrc, natural.w, natural.h, id),
    placement: placementFor(cs.objectFit, cs.objectPosition, box, natural),
  }
}
```

Вызови её и построй узел:

```ts
  const imageRef = imageRefFor(el, cs, box, ctx, id)
  if (imageRef !== null) {
    node = { ...base, kind: 'image', image: imageRef }
  } else if (placeholder !== null) {
    node = { ...base, kind: 'placeholder', placeholder }
  } else { /* как сейчас */ }
```

Порядок важен: если байты не читаются, `imageRefFor` уже сообщил с `needsPlaceholder: true`, и узел обязан стать заглушкой — иначе инвариант отвергнет бандл. Убедись, что `placeholderFor` возвращает заглушку для `<img>` с этим кодом; если нет — добавь туда ветку.

- [ ] **Step 9: e2e — узлы изображений появляются**

Добавь в `tests/e2e/assets.spec.ts`:

```ts
test('<img> становится узлом изображения, а не пустым фреймом', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 400 })
  await page.goto(fixtureUrl('image-fit'))
  const { screen, assetRequests } = await captureScreen(page, 's-800', 'Probe')

  const kinds: string[] = []
  const visit = (node: IrNode): void => {
    if (node.sourceTag === 'img') kinds.push(node.kind)
    node.children.forEach(visit)
  }
  visit(screen.root)

  expect(kinds).toEqual(['image', 'image', 'image', 'image'])
  /** Четыре <img> с одним src — ОДНА заявка: дедупликация по URL. */
  expect(assetRequests).toHaveLength(1)
})
```

Расширь `CaptureResult` в `tests/e2e/helpers/capture.ts` полем `assetRequests`.

- [ ] **Step 10: Полный прогон и коммит**

Run: `pnpm test`

Снапшоты фикстуры `image-fit` изменятся (её узлы стали изображениями) — перегенерируй `UPDATE_SNAPSHOTS=1`. Снапшоты фикстур **без** изображений измениться не должны; если изменились — это регрессия.

```bash
git add -A
git commit -m "feat(serializer): <img> переносится как kind:'image' с размещением

До этого <img> приезжал обычным пустым фреймом без единой диагностики:
27628 расходящихся пикселей из 320000 на зонде, невидимых и для валидатора,
и для pixel-diff, потому что ни одна фикстура изображений не содержала.

Осторожно с именами: CSS object-fit:fill (растянуть) и режим 'fill'
контракта (заполнить с обрезкой, как FILL в Figma) — разные вещи.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Растровый `background-image` как заливка

**Files:**
- Modify: `packages/serializer/src/css/image.ts`
- Modify: `packages/serializer/src/walk.ts` (`readFills`)
- Test: `packages/serializer/test/image-placement.test.ts`
- Create: `fixtures/image-bg/index.html`

Фон отличается от `<img>` тремя вещами, и каждая — отдельный источник ошибки: размер задаёт `background-size` (со своими `cover`/`contain`/`auto`/парой значений), повтор задаёт `background-repeat`, и начало отсчёта — не бокс границы, а **origin box**.

- [ ] **Step 1: Измерить, что отдаёт Chrome**

Тем же приёмом, что в Task 4 Step 1, сними `backgroundSize`, `backgroundPosition`, `backgroundRepeat`, `backgroundOrigin` для фикстуры `image-bg`. Запиши результат в комментарий к парсеру. Особенно: во что превращается `cover` (остаётся словом или разворачивается в пиксели) — от этого зависит, нужна ли нам собственная арифметика или достаточно прочитать готовое.

- [ ] **Step 2: Написать падающие тесты**

Добавь в `packages/serializer/test/image-placement.test.ts`:

```ts
import { backgroundPlacementFor } from '../src/css/image.js'

describe('backgroundPlacementFor', () => {
  const box = { w: 120, h: 90 }
  const natural = { w: 64, h: 32 }

  it('cover ведёт себя как object-fit: cover', () => {
    const p = backgroundPlacementFor('cover', '50% 50%', 'no-repeat', box, natural)
    expect(p.scaleX).toBeCloseTo(2.8125, 6)
    expect(p.mode).toBe('fill')
  })

  it('contain ведёт себя как object-fit: contain', () => {
    const p = backgroundPlacementFor('contain', '50% 50%', 'no-repeat', box, natural)
    expect(p.scaleX).toBeCloseTo(1.875, 6)
    expect(p.mode).toBe('fit')
  })

  /** `auto` — начальное значение: натуральный размер, БЕЗ подгонки
   *  под бокс. Отличие от `contain` принципиально: `contain` увеличил
   *  бы картинку до 1.875, `auto` оставляет 1. */
  it('auto оставляет натуральный размер', () => {
    const p = backgroundPlacementFor('auto', '0% 0%', 'no-repeat', box, natural)
    expect(p.scaleX).toBe(1)
    expect(p.scaleY).toBe(1)
  })

  /** Пара значений задаёт размер напрямую. `auto` во второй позиции
   *  означает «сохрани пропорцию», а не «натуральная высота». */
  it('пара значений задаёт размер, auto держит пропорцию', () => {
    const p = backgroundPlacementFor('96px auto', '0% 0%', 'no-repeat', box, natural)
    expect(p.scaleX).toBeCloseTo(96 / 64, 6)
    expect(p.scaleY).toBeCloseTo(96 / 64, 6)
  })

  it('repeat даёт режим плитки', () => {
    expect(backgroundPlacementFor('auto', '0% 0%', 'repeat', box, natural).mode)
      .toBe('tile')
  })

  /** repeat-x повторяет ТОЛЬКО по горизонтали. Контракт одного режима
   *  на обе оси это не выражает, и молча объявить его обычной плиткой
   *  значило бы залить весь бокс вместо одной полосы. */
  it('repeat-x не выдаётся за полную плитку', () => {
    expect(backgroundPlacementFor('auto', '0% 0%', 'repeat-x', box, natural).mode)
      .not.toBe('tile')
  })
})
```

- [ ] **Step 3: Запустить, убедиться в падении.** Run: `pnpm vitest run packages/serializer/test/image-placement.test.ts`

- [ ] **Step 4: Реализовать**

Добавь в `css/image.ts` функцию `backgroundPlacementFor(size, position, repeat, box, natural)`. Переиспользуй `parsePositionPart` и общую часть `placementFor` — арифметика смещения та же, различается только вычисление масштаба:

- `cover` / `contain` — как в `scaleFor`;
- `auto` — `{ x: 1, y: 1 }`;
- пара значений: каждое либо `<n>px`, либо `<n>%` (от соответствующей стороны бокса), либо `auto`; если одно из них `auto`, оно вычисляется из второго по пропорции источника; если оба `auto` — `{ x: 1, y: 1 }`;
- режим: `repeat` → `tile`; `no-repeat` → как у `object-fit`; **`repeat-x`, `repeat-y`, `round`, `space` → `crop` плюс диагностика** `deferredMultiLayerBackground`? Нет — заведи для них отдельную ветку и сообщи кодом `imageUnreadable`… **Нет.** Для них нужен честный отдельный код: добавь в `codes.ts`

```ts
  /** `repeat-x`, `repeat-y`, `round`, `space`: повтор по одной оси или
   *  с подгонкой шага. Контракт держит один режим на обе оси и этого
   *  не выражает. Молча выдать за обычную плитку нельзя — залило бы
   *  весь бокс вместо одной полосы. */
  deferredRepeatMode: 'deferred.repeat-mode',
```

и сообщай им.

- [ ] **Step 5: Прогнать тесты, затем сломать**

Слом: в ветке `auto` верни `contain`-масштаб. Обязан упасть тест про натуральный размер. Слом: для `repeat-x` верни `'tile'`. Обязан упасть соответствующий тест.

- [ ] **Step 6: Подключить в `readFills`**

Ветка `case 'raster'` из Task 2 заменяется на настоящую заливку:

```ts
      case 'raster': {
        const resolved = new URL(verdict.url, document.baseURI).href
        const natural = ctx.naturalSizeOf(resolved)
        if (natural === null) {
          /** Размер источника фона неизвестен: в отличие от <img>, у
           *  фона нет элемента с `naturalWidth`. Изображение могло не
           *  загрузиться, и молча подставить размер бокса нельзя —
           *  это выдало бы догадку за факт. */
          sink.report('warning', DIAGNOSTIC_CODES.imageUnreadable,
            `Размер фонового изображения неизвестен: ${resolved}`, id, false)
          break
        }
        fills.push({
          kind: 'image',
          ref: {
            assetId: ctx.requests.request(resolved, natural.w, natural.h, id),
            placement: backgroundPlacementFor(
              cs.backgroundSize, cs.backgroundPosition, cs.backgroundRepeat,
              box, natural,
            ),
          },
        })
        break
      }
```

`naturalSizeOf` — синхронный запрос размера уже загруженного фона. Реализуй его через кеш `new Image()` с `img.complete`: браузер держит фон в том же кеше изображений, и для уже отрисованного фона размер доступен немедленно. **Если измерение покажет, что `complete` для фонов не наступает — не подставляй бокс:** отправь заявку с нулевым натуральным размером и уточни его в фазе разрешения, где байты уже декодированы. Решение принимается по замеру, записанному в Step 1.

- [ ] **Step 7: Фикстура**

`fixtures/image-bg/index.html` — блоки 120×90 с `background:url(../image-fit/asset.png)` и вариантами `cover`, `contain`, `auto`, `96px auto`, `repeat`. Фон на непрозрачной подложке, чтобы было видно незакрытое место.

- [ ] **Step 8: Прогон и коммит.** `pnpm test`, перегенерировать снапшоты новых фикстур.

---

### Task 6: Разрешение ассетов — асинхронная фаза

**Files:**
- Create: `packages/serializer/src/resolve-assets.ts`
- Test: `tests/e2e/assets.spec.ts`

Почему это e2e, а не юнит: проверяется взаимодействие с `fetch`, CORS и `OffscreenCanvas` — то есть ровно то, что в имитации всегда работает. Юнит-тест с подменённым `fetch` проверил бы нашу имитацию.

- [ ] **Step 1: Написать падающие e2e-тесты**

```ts
test('байты ассета доезжают и совпадают с исходником', async ({ page }) => {
  await page.goto(fixtureUrl('image-fit'))
  const { assetRequests } = await captureScreen(page, 's', 'Probe')
  const resolved = await resolveAssetsInPage(page, assetRequests)

  expect(resolved.assets).toHaveLength(1)
  const [asset] = resolved.assets
  expect(asset.mimeType).toBe('image/png')
  expect(asset.width).toBe(64)
  expect(asset.height).toBe(32)
  /** Байт в байт с файлом на диске: `fetch` отдаёт исходник, и
   *  переупаковки быть не должно. Канва вернула бы другой размер —
   *  измерено: 449 байт против 241. */
  const onDisk = readFileSync(resolve(repoRoot, 'fixtures/image-fit/asset.png'))
  expect(Buffer.from(resolved.bytes[asset.id])).toEqual(onDisk)
  expect(resolved.report).toHaveLength(0)
})

test('недоступный источник даёт диагностику, а не тишину', async ({ page }) => {
  await page.goto(fixtureUrl('image-broken'))
  const { screen, assetRequests } = await captureScreen(page, 's', 'Probe')
  const resolved = await resolveAssetsInPage(page, assetRequests)

  const codes = [...screen ? [] : [], ...resolved.report].map((d) => d.code)
  expect(codes).toContain('fidelity.image-unreadable')
})
```

- [ ] **Step 2: Реализовать `resolveAssets`**

```ts
import { DIAGNOSTIC_CODES } from '@w2f/ir/codes'
import type { Asset, Diagnostic } from '@w2f/ir'
import type { AssetRequest } from './assets.js'

/** Предел `figma.createImage`. Длинная сторона больше — изображение
 *  не примется вовсе, поэтому ужатие обязательно; но оно необратимо,
 *  и факт обязан попасть в отчёт. */
const MAX_SIDE = 4096

/** Форматы, которые Figma принимает без переупаковки. Всё остальное
 *  (WebP, AVIF) переводится в PNG через канву. */
const NATIVE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])

export type ResolvedAssets = {
  assets: Asset[]
  bytes: Record<string, Uint8Array>
  report: Diagnostic[]
}

export const resolveAssets = async (
  requests: AssetRequest[],
  screenId: string,
): Promise<ResolvedAssets> => { /* см. шаги ниже */ }
```

Тело на каждую заявку:

1. `fetch(request.url)` в `try`. Отказ — диагностика `imageUnreadable` на `request.nodeId`, ассет пропускается. **Никакого молчаливого пропуска: ассет, на который ссылается узел, но которого нет в бандле, отвергнет инвариант `asset.dangling` — и это правильно, потому что узел обязан стать заглушкой.**
2. Тип берётся из `Content-Type` ответа, а не из расширения: расширение врёт.
3. Если тип `image/svg+xml` — диагностика `deferredVector`, пропуск.
4. Декодирование через `createImageBitmap(blob)` — даёт настоящие размеры.
5. Если тип не в `NATIVE_TYPES` **или** сторона больше `MAX_SIDE` — перерисовать в `OffscreenCanvas` нужного размера и `convertToBlob({ type: 'image/png' })`; сообщить `imageRecoded` и/или `imageRescaled`.
6. Иначе — отдать **исходные** байты ответа без переупаковки.

- [ ] **Step 3: Сломать и проверить**

Слом: отдавать байты канвы всегда, без условия. Обязан упасть тест про побайтовое совпадение.
Слом: при отказе `fetch` пропускать заявку молча. Обязан упасть тест про диагностику.

- [ ] **Step 4: Фикстура отказа**

`fixtures/image-broken/index.html`: `<img src="нет-такого.png">` и `<img src="https://127.0.0.1:1/x.png">`. Вторая проверяет сетевой отказ, первая — отсутствующий файл.

- [ ] **Step 5: Прогон и коммит.**

---

### Task 7: Референс-рендерер рисует изображения

**Files:**
- Modify: `packages/reference-renderer/src/render.ts`
- Test: `packages/reference-renderer/test/render.test.ts`

Рендерер сейчас принимает только `Screen`. Байты ассетов в нём взять неоткуда, поэтому сигнатура расширяется вторым аргументом. Это осознанное изменение контракта функции, а не побочный эффект.

- [ ] **Step 1: Падающие тесты**

```ts
const IMAGES = new Map([['a0', {
  dataUri: 'data:image/png;base64,iVBORw0KGgo=', width: 64, height: 32,
}]])

it('узел изображения рисуется как <image>', () => {
  const node = frame({ kind: 'image', image: {
    assetId: 'a0',
    placement: { mode: 'fit', offsetX: 10, offsetY: 4, scaleX: 2, scaleY: 2 },
  } } as Partial<IrNode>)
  const svg = renderScreenToSvg(screen(node), IMAGES)
  expect(svg).toContain('<image')
  /** Размер — НАТУРАЛЬНЫЙ, умноженный на масштаб, а не размер бокса:
   *  иначе `contain` растянулся бы на весь бокс и стал неотличим
   *  от `fill`. Именно эту подмену тест и ловит. */
  expect(svg).toContain('width="128"')
  expect(svg).toContain('height="64"')
  expect(svg).toContain('preserveAspectRatio="none"')
})

/** Изображение, вышедшее за бокс (`cover`), обязано быть обрезано.
 *  Без обрезки `cover` рисовал бы поверх соседей, и это заметил бы
 *  pixel-diff — но только если соседи есть. Проверка здесь, чтобы
 *  не зависеть от раскладки фикстуры. */
it('изображение обрезается по боксу узла', () => {
  const svg = renderScreenToSvg(screen(coverNode()), IMAGES)
  expect(svg).toContain('clip-path="url(#')
})

/** Отсутствующий ассет НЕ пропускается молча: дыра в картинке без
 *  следа в SVG неотличима от прозрачного пикселя, и pixel-diff
 *  показал бы расхождение без объяснения. */
it('неизвестный assetId бросает, а не рисует пустоту', () => {
  expect(() => renderScreenToSvg(screen(imageNode('нет-такого')), IMAGES))
    .toThrow(/нет-такого/)
})
```

- [ ] **Step 2: Запустить, убедиться в падении.**

- [ ] **Step 3: Реализовать**

```ts
export type RenderImage = { dataUri: string; width: number; height: number }

export const renderScreenToSvg = (
  screen: Screen,
  images: ReadonlyMap<string, RenderImage> = new Map(),
): string => { /* ... */ }
```

Отрисовка узла `kind: 'image'`:

```ts
/** Обрезка по боксу узла обязательна: при `cover` нарисованный размер
 *  БОЛЬШЕ бокса, и без clip изображение залезло бы на соседей. */
const clipId = `clip-${node.id}`
defs.push(`<clipPath id="${clipId}"><rect x="${x}" y="${y}" ` +
          `width="${node.rect.w}" height="${node.rect.h}"/></clipPath>`)
body.push(
  `<g clip-path="url(#${clipId})">` +
  `<image href="${image.dataUri}" ` +
  `x="${x + p.offsetX}" y="${y + p.offsetY}" ` +
  `width="${image.width * p.scaleX}" height="${image.height * p.scaleY}" ` +
  /** Пропорции уже учтены в scaleX/scaleY. Дефолтный
   *  `preserveAspectRatio` подогнал бы картинку ВТОРОЙ раз и
   *  перечеркнул бы всю арифметику размещения. */
  `preserveAspectRatio="none"/></g>`,
)
```

Для `mode: 'tile'` — `<pattern>` с шагом `image.width * scaleX` × `image.height * scaleY` и `<rect>` бокса с этой заливкой.

Заливка `kind: 'image'` рисуется тем же кодом, что и узел изображения: разница только в том, откуда берётся `ref`. Вынеси общую функцию, чтобы плитка и обрезка не разошлись между двумя путями.

- [ ] **Step 4: Пробросить ассеты до вызывающих**

`scripts/capture.mjs` и `tests/e2e/pixel-diff.spec.ts` собирают `Map` из разрешённых ассетов: `dataUri` через base64 от байтов. Оба места уже имеют доступ к бандлу.

- [ ] **Step 5: Слом**

Убери `preserveAspectRatio="none"`. Обязан упасть pixel-diff фикстуры `image-fit` на варианте `fill` — именно там подгонка вторым проходом меняет картинку.

- [ ] **Step 6: Прогон и коммит.**

---

### Task 8: Фикстуры изображений в гейте

**Files:**
- Modify: `tests/e2e/pixel-diff.spec.ts` (список фикстур)
- Create: `fixtures/image-*/threshold.json`

- [ ] **Step 1: Добавить `image-fit`, `image-bg`, `image-broken` в список pixel-diff**

- [ ] **Step 2: Измерить расхождение и вписать измеренное**

Run: `npx playwright test tests/e2e/pixel-diff.spec.ts`

**Здесь впервые есть основание ждать настоящего расхождения:** браузер и `resvg` пересэмплируют изображение разными фильтрами, и при `contain`/`cover` картинка масштабируется. Пять предыдущих раз мои предсказания расхождения не сбылись, поэтому предсказание здесь тоже не в счёт — **вписывай измеренное**.

Если расхождение окажется большим (тысячи пикселей), не поднимай порог. Сначала выясни причину:

- расхождение по всей площади картинки ровным слоем — разные фильтры масштабирования, это допустимая разница растеризации;
- расхождение по **краю** картинки — скорее всего разъехалось размещение, то есть дефект в `placementFor`;
- расхождение в **половине** бокса — перепутаны `contain` и `cover` либо потерян знак смещения.

Порог принимается только для первого случая, и в `threshold.json` рядом с числом пишется, чем оно измерено.

- [ ] **Step 3: Слом — гейт обязан ловить порчу размещения**

В `placementFor` поменяй местами `Math.min` и `Math.max`. Ожидание: падают фикстуры `image-fit` и `image-bg` на всех пяти ширинах.

**Если не падают — порог завышен или фикстура не различает `contain` и `cover`.** Это тот самый случай 10/11: чинится фикстура, а не порог.

- [ ] **Step 4: Коммит.**

---

### Task 9: Файл-бандл `.w2f`

**Files:**
- Create: `packages/bundle/` (новый пакет: `package.json`, `tsconfig.json`, `src/pack.ts`, `src/unpack.ts`, `src/index.ts`)
- Test: `packages/bundle/test/roundtrip.test.ts`

Формат: ZIP с `ir.json` в корне, `assets/<id>.<ext>`, `screenshots/<screenId>.png`.

Почему файл, а не REST: Figma REST API не умеет создавать содержимое файла — только плагин внутри Figma. Это ограничение платформы, оно зафиксировано в спеке и определяет всю архитектуру из двух половин.

- [ ] **Step 1: Падающие тесты на круговой обход**

```ts
it('распакованное равно упакованному', async () => {
  const bundle = sampleBundle()
  const bytes = { a0: new Uint8Array([1, 2, 3]) }
  const packed = await packBundle(bundle, bytes)
  const back = await unpackBundle(packed)
  expect(back.bundle).toEqual(bundle)
  expect(back.bytes.a0).toEqual(bytes.a0)
})

/** Чужой ZIP обязан быть отвергнут внятно, а не упасть на разборе
 *  JSON. Пользователь мог выбрать не тот файл — это обычная ошибка,
 *  а не исключительная ситуация. */
it('ZIP без ir.json отвергается с внятным сообщением', async () => {
  await expect(unpackBundle(zipWithout('ir.json')))
    .rejects.toThrow(/ir\.json/)
})

/** Версия сверяется ДО валидации схемы: иначе пользователь получит
 *  простыню zod вместо «файл другой версии». Ровно та причина, по
 *  которой в контракте есть BundleEnvelope. */
it('бандл чужой версии отвергается по версии, а не по схеме', async () => {
  const packed = await packRaw({ format: 'w2f', version: 1 })
  await expect(unpackBundle(packed)).rejects.toThrow(/версии/)
})

/** Ассет, который лежит в ZIP, но на который никто не ссылается, —
 *  не ошибка, а вес. Ассет, на который ссылаются, но которого нет, —
 *  ошибка: в Figma это пустой прямоугольник без объяснения. */
it('ссылка на отсутствующий в архиве ассет отвергается', async () => {
  await expect(unpackBundle(packedWithDanglingAsset()))
    .rejects.toThrow(/a0/)
})
```

- [ ] **Step 2: Реализовать через `fflate`**

`packBundle(bundle, bytes, screenshots)` → `Uint8Array`; `unpackBundle(zip)` → `{ bundle, bytes, screenshots }`, внутри: достать `ir.json` → прочитать конверт (`format`, `version`) → сверить версию → провалидировать схемой → сверить ссылки на ассеты с содержимым архива.

Расширение файла берётся из `asset.mimeType`, а не наоборот: `mimeType` — источник истины, он пришёл из `Content-Type` ответа.

- [ ] **Step 3: Слом — убрать сверку версии до схемы.** Обязан упасть тест про внятное сообщение.

- [ ] **Step 4: Коммит.**

---

### Task 10: Скриншоты экранов в бандле

**Files:**
- Modify: `packages/bundle/src/pack.ts`
- Modify: `scripts/capture.mjs`
- Test: `packages/bundle/test/roundtrip.test.ts`

`Screen.screenshotId` в контракте есть и сейчас всегда `null`. Инвариант уже требует, чтобы непустой `screenshotId` находился среди `assets` — то есть скриншот хранится как обычный ассет.

- [ ] **Step 1: Падающий тест:** бандл со скриншотом проходит валидатор, бандл с `screenshotId`, которого нет в `assets`, — отвергается.

- [ ] **Step 2: Реализовать.** Скриншот кладётся в `screenshots/<screenId>.png` и одновременно регистрируется как `Asset` с тем же id, что и `screenshotId`.

- [ ] **Step 3: Проверить, что скриншот не попал в дерево.** Отдельный тест: ни один узел не ссылается на `screenshotId`. Иначе картинка страницы приедет ещё и заливкой какого-нибудь фрейма.

- [ ] **Step 4: `pnpm capture` пишет `out/bundle.w2f`** и печатает его размер. Это первый артефакт, который можно отдать плагину в плане 5.

- [ ] **Step 5: Полный прогон, обновление вики, коммит.**

Обнови: `wiki/pages/entities/ir-bundle.md` (формат файла), `wiki/pages/concepts/support-boundaries.md` (что переносится, что отложено), `wiki/index.md`, `wiki/log.md`. Создай `wiki/pages/entities/assets.md` — двухфазная модель и почему обход синхронный.

---

## Что останется незакрытым после плана 4

Записано, чтобы не потерялось:

- `<video>` и его `poster` — по-прежнему молчаливая потеря, диагностики нет. Первый кандидат в план 6.
- Несколько слоёв фона — отложено с кодом.
- `repeat-x`/`repeat-y`/`round`/`space` — отложены с кодом.
- inline `<svg>` — отложен с кодом, ждёт векторов.
- `mask-image`, `border-image` — отложены с кодом.
- `ImagePlacement.mode` не проверяется гейтом: рендерер читает `scale`/`offset`. Настоящая сверка — в плане 5, на живом плагине.
