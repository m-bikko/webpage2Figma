# CSS Paint Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести четыре красочных свойства CSS — линейные градиенты, 2D-трансформы, режимы наложения и размытие — от «диагностируется как отложенное» до «переносится и проверено pixel-diff», чтобы снятая страница перестала выглядеть вайрфреймом.

**Architecture:** Каждая фича проходит один и тот же путь: поле в контракте `@h2d/ir` (три из четырёх уже есть) → парсер computed style в сериализаторе → отрисовка в референс-рендерере → фикстура входит в pixel-diff → соответствующая проверка `deferred.*` удаляется из инвариантов. Гейт точности из плана 1 уже стоит, поэтому каждая фича добавляется под защитой: если перенос неверен, диффы упадут.

**Tech Stack:** TypeScript strict без `any`, тот же воркспейс; SVG `linearGradient`, `<g transform>`, `mix-blend-mode`, `feGaussianBlur` в референс-рендерере.

**Источник требований:** `docs/superpowers/specs/2026-09-19-html2design-design.md`, раздел 7.1b.

**Место в карте планов:** план 2 из 5. Дальше: 3 — ассеты и ZIP-бандл, 4 — плагин Figma, 5 — расширение Chrome.

---

## Что этот план НЕ делает, и почему это решение, а не упущение

**Радиальные и конические градиенты остаются отложенными.** У SVG нет конического градиента вовсе, поэтому референс-рендерер его не воспроизведёт, а значит **гейт не сможет его проверить**. Фича, которую нечем проверить, в план не входит: план 1 научил, что непроверяемая фича приезжает молча неверной. Радиальные добавляются вместе с ассетами в плане 3, где всё равно придётся трогать заливки.

Для обоих остаются диагностики, и это обязательно: `deferredGradient` продолжает порождаться для всего, что не `linear-gradient`.

**Изображения — план 3.** Бинарные ассеты, выборка с cookies, нормализация форматов и ZIP-контейнер образуют отдельную подсистему; с красочными свойствами их объединяет только слово «заливка».

**Векторы и псевдоэлементы — план 3.** `kind: 'vector'` требует разбора SVG-геометрии, псевдоэлементы — синтетических узлов без DOM-элемента, что ломает соответствие дерева узлов дереву проб и потребует переделки аллокатора идентификаторов.

---

## Правила, унаследованные от плана 1

Они не формальность: каждое появилось из конкретного провала, и каждое сэкономило больше, чем стоило.

**TDD.** Тест первым, запуск, падение по ожидаемой причине, потом реализация. Шаг «убедись, что падает» не пропускается.

**Проверяй проверки.** За план 1 шесть проверок оказались пустыми, и все шесть **проходили**. Поэтому: сломай проверяемое и убедись, что проверка упала. Не падающая на заведомо сломанном проверка хуже отсутствующей — она создаёт ложную уверенность. Если сломать нельзя, а результат тот же, значит ветка мёртвая: удаляй ветку, а не тест.

**Пороги не подгоняются.** Изменение порога требует физической причины, вписанной в поле `reason` файла `threshold.json`. Главная метрика гейта — **абсолютный бюджет пикселей**, а не доля площади: 1234 неверных пикселя в изображении на миллион точек это 0.1%, и любой относительный порог их пропустит — измерено.

**При удалении проверки `deferred.*` спрашивай, что она прикрывала.** Дважды за этот план реализация фичи снимала общую диагностику, которая заодно объясняла соседний, ещё не реализованный случай: трансформы сняли объяснение для своих потомков, наложение — для наложения внутри изолирующей группы. Оба раза корректность улучшалась, а честность ломалась, и ловилось это только прямым вопросом «что именно эта диагностика объясняла».

**Молчаливый fallback — это баг.** Всё, что не переносится, обязано породить `Diagnostic`. Двадцать инвариантов в `@h2d/ir` проверяют это машинно, включая требование: узел с непустым `transform` обязан иметь парную диагностику `deferred.transform`. **Поэтому удаление проверки из инвариантов и реализация фичи — один коммит.** Разъедутся — бандл начнёт отвергаться.

**Коммиты** заканчиваются трейлером:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Структура файлов

```
packages/ir/src/types.ts              + Gradient, GradientStop; Fill получает градиентный член;
                                        Transform получает точку отсчёта
packages/ir/src/schema.ts             зеркало новых типов
packages/ir/src/invariants.ts         − проверки deferred.transform/blend/blur по мере реализации

packages/serializer/src/css/gradient.ts   CSS linear-gradient → Gradient        ← новый, чистый
packages/serializer/src/css/transform.ts  matrix() → Transform, нетрансформированный бокс ← новый
packages/serializer/src/walk.ts           заполняет fills, transform, blur; правит диагностики

packages/reference-renderer/src/render.ts  <linearGradient>, <g transform>,
                                           mix-blend-mode, feGaussianBlur

fixtures/gradient/       входит в pixel-diff
fixtures/transformed/    входит в pixel-diff
fixtures/blend/          новая
fixtures/blur/           новая
```

Парсеры градиента и трансформы — отдельные файлы и чистые функции по той же причине, по которой ими стали парсеры цвета и теней: они ломаются на неожиданном вводе, и их надо читать и тестировать изолированно.

---

---

## Task 1: Контракт — градиенты и точка отсчёта трансформы

Две добавки, и обе выяснились при продумывании отрисовки, а не при чтении спеки.

**Градиент как член размеченного объединения `Fill`.** Именно для этого `Fill` и был размечен в плане 1: расширение безопасно, потому что неизвестный `kind` падает громко и в zod, и в исчерпывающем `switch`.

**`Transform` получает точку отсчёта.** Без неё поворот невоспроизводим: CSS вращает вокруг `transform-origin`, по умолчанию центра, и повёрнутый вокруг центра блок стоит не там же, где повёрнутый вокруг угла. Поля не было — то есть контракт плана 1 нёс трансформу, которую нельзя отрисовать.

**Ручки градиента нормализованы, а не в градусах.** Угол CSS нельзя перенести в SVG напрямую: `objectBoundingBox` масштабируется неравномерно и искажает углы на неквадратном боксе. Нормализованные концы отрезка переводятся в абсолютные координаты и там точны, а Figma всё равно задаёт градиент матрицей, не углом.

**Files:**
- Modify: `packages/ir/src/types.ts`, `packages/ir/src/schema.ts`
- Test: `packages/ir/test/invariants.test.ts` (обновить фикстуры под новое поле)

- [ ] **Step 1: Добавить типы градиента в `packages/ir/src/types.ts`**

Вставить перед объявлением `Fill`:

```ts
export type GradientStop = {
  /** Положение на отрезке градиента, 0..1. */
  offset: number
  color: Rgba8
}

/** Линейный градиент, заданный концами отрезка.
 *
 *  Координаты НОРМАЛИЗОВАНЫ по боксу узла (0..1 по каждой оси), а не
 *  заданы углом. Угол CSS перенести напрямую нельзя: SVG с
 *  `objectBoundingBox` масштабирует систему координат неравномерно и
 *  искажает угол на неквадратном боксе, а Figma задаёт градиент матрицей
 *  преобразования, а не углом. Концы отрезка однозначны в обеих системах.
 *
 *  Радиальные и конические градиенты появятся отдельными членами
 *  объединения. Конический не раньше, чем у гейта появится способ его
 *  проверить: в SVG конического градиента нет. */
export type Gradient = {
  kind: 'linear'
  from: { x: number; y: number }
  to: { x: number; y: number }
  stops: GradientStop[]
}
```

- [ ] **Step 2: Добавить член в `Fill`**

```ts
export type Fill =
  | { kind: 'solid'; color: Rgba8 }
  | { kind: 'image'; ref: ImageRef }
  | { kind: 'gradient'; gradient: Gradient }
```

- [ ] **Step 3: Добавить точку отсчёта в `Transform`**

Заменить объявление `Transform` целиком:

```ts
/** Разложенная 2D-трансформа в форме, близкой к Figma.
 *
 *  Когда она не null, `rect` — НЕтрансформированный border box.
 *  Иначе два поля противоречат друг другу: `getBoundingClientRect()`
 *  возвращает габарит уже трансформированного элемента, поэтому
 *  повёрнутый на 15° блок 100×20 дал бы ~102×31.
 *
 *  `originX`/`originY` — в пикселях от левого верхнего угла `rect`.
 *  Без них поворот невоспроизводим: CSS вращает вокруг `transform-origin`,
 *  и блок, повёрнутый вокруг центра, стоит не там, где повёрнутый вокруг
 *  угла. В первой редакции контракта этого поля не было, то есть
 *  трансформа была записана, но неотрисовываема. */
export type Transform = {
  /** Радианы, ПО часовой стрелке в экранных координатах — то же
   *  направление, что у `rotate()` в CSS.
   *
   *  Знак важен и легко ошибиться: разложение матрицы CSS даёт
   *  `atan2(b, a)`, где ось `y` растёт вниз, поэтому положительное
   *  значение визуально поворачивает по часовой. Первая редакция
   *  контракта утверждала «против часовой» — неверно. */
  angle: number
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
  originX: number
  originY: number
}
```

- [ ] **Step 4: Обновить схему в `packages/ir/src/schema.ts`**

Заменить `transform` и добавить градиент:

```ts
const transform = z.object({
  angle: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  translateX: z.number(),
  translateY: z.number(),
  originX: z.number(),
  originY: z.number(),
})

const gradientStop = z.object({
  offset: z.number().min(0).max(1),
  color: rgba8,
})

const gradient = z.object({
  kind: z.literal('linear'),
  from: z.object({ x: z.number(), y: z.number() }),
  to: z.object({ x: z.number(), y: z.number() }),
  /** Минимум две остановки: градиент из одной — это сплошная заливка,
   *  и такой Fill обязан быть solid, иначе потребители разойдутся в том,
   *  что рисовать. */
  stops: z.array(gradientStop).min(2),
})
```

И расширить `fill`:

```ts
const fill = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: rgba8 }),
  z.object({ kind: z.literal('image'), ref: imageRef }),
  z.object({ kind: z.literal('gradient'), gradient }),
])
```

- [ ] **Step 5: Прогнать тесты и увидеть, что падает ровно на трансформе**

Run: `pnpm typecheck && pnpm vitest run packages/ir`
Expected: FAIL. Ошибки типов в `packages/ir/test/invariants.test.ts` на объектах `transform` без `originX`/`originY` — фикстура в тесте `ловит transform без diagnostic` и в парном к нему. Это ожидаемо: контракт стал строже, и тест обязан это заметить.

- [ ] **Step 6: Обновить фикстуры теста**

В `packages/ir/test/invariants.test.ts` во всех объектах `transform` добавить точку отсчёта:

```ts
      transform: {
        angle: 0.26, scaleX: 1, scaleY: 1,
        translateX: 0, translateY: 0, originX: 50, originY: 25,
      },
```

- [ ] **Step 7: Добавить тест на новый инвариант формы градиента**

В `packages/ir/test/validate.test.ts`, в блок `describe('parseBundle: схема')`:

```ts
  it('принимает градиентную заливку', () => {
    const b = bundle({
      screens: [screen({
        root: frameNode({
          style: {
            ...frameNode().style,
            fills: [{
              kind: 'gradient',
              gradient: {
                kind: 'linear',
                from: { x: 0, y: 0 },
                to: { x: 1, y: 1 },
                stops: [
                  { offset: 0, color: { r: 99, g: 102, b: 241, a: 1 } },
                  { offset: 1, color: { r: 236, g: 72, b: 153, a: 1 } },
                ],
              },
            }],
          },
        }),
      })],
    })
    expect(parseBundle(b).ok).toBe(true)
  })

  it('отклоняет градиент из одной остановки — это сплошная заливка', () => {
    const b = bundle({
      screens: [screen({
        root: frameNode({
          style: {
            ...frameNode().style,
            fills: [{
              kind: 'gradient',
              gradient: {
                kind: 'linear',
                from: { x: 0, y: 0 },
                to: { x: 1, y: 1 },
                stops: [{ offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } }],
              },
            }],
          },
        }),
      })],
    })
    // Градиент из одной остановки — сплошной цвет. Разрешить его значило бы
    // допустить два представления одного и того же, а потребители выбрали
    // бы разные.
    expect(parseBundle(b).ok).toBe(false)
  })
```

- [ ] **Step 8: Прогнать и убедиться, что зелено**

Run: `pnpm typecheck && pnpm vitest run packages/ir`
Expected: PASS. Тестов в `@h2d/ir` станет 42.

- [ ] **Step 9: Проверить проверку**

Убрать `.min(2)` из схемы `stops`, прогнать `pnpm vitest run packages/ir`. Тест «отклоняет градиент из одной остановки» обязан упасть. Вернуть `.min(2)`.

Если тест продолжает проходить — значит отказ происходит по другой причине, и это надо выяснить, а не оставлять.

- [ ] **Step 10: Коммит**

```bash
git add packages/ir
git commit -m "feat(ir): градиентная заливка и точка отсчёта трансформы"
```

---

## Task 2: Парсер линейного градиента

Самый трудный модуль плана. Два места, где ошибка незаметна: перевод направления CSS в концы отрезка и восстановление неявных положений остановок. Формулы выведены здесь, чтобы исполнитель не подбирал их по картинке.

**Направление → концы отрезка.** Угол CSS отсчитывается от «вверх» по часовой стрелке, а ось `y` в экранных координатах растёт вниз, поэтому единичный вектор направления это `d = (sin θ, −cos θ)`. Длина отрезка градиента по спецификации `L = |w·sin θ| + |h·cos θ|`, отрезок проходит через центр бокса, откуда концы: `center ∓ d·L/2`.

Проверка на понятных случаях: при θ=180° (`to bottom`) получается `d=(0,1)`, `L=h`, концы `(w/2,0)` и `(w/2,h)`. При θ=90° (`to right`) — `d=(1,0)`, `L=w`, концы `(0,h/2)` и `(w,h/2)`.

**Угловые ключевые слова зависят от пропорций бокса.** По спецификации отрезок перпендикулярен диагонали между двумя соседними углами. Для `to top right` соседние углы — верхний левый и нижний правый, их диагональ направлена как `(w,h)`, перпендикуляр вверх-вправо как `(h,−w)`. Из `d = (sin θ, −cos θ) ∝ (h, −w)` следует `tan θ = h/w`, то есть `θ = atan2(h, w)`.

Легко взять `atan2(w, h)` вместо `atan2(h, w)` — на квадратном боксе оба дают 45° и ошибка не видна. На широком боксе 200×100 правильный ответ 26.6° (отрезок ближе к вертикали, потому что диагональ пологая), неправильный — 63.4°. Тест на неквадратный бокс поэтому обязателен.

**Неявные положения остановок.** Первая без положения — это 0, последняя — 1, промежуточные распределяются равномерно между ближайшими заданными, а положения принудительно не убывают. Положение может быть задано в пикселях — тогда оно делится на `L`, поэтому направление разбирается раньше остановок.

**Files:**
- Create: `packages/serializer/src/css/gradient.ts`
- Test: `packages/serializer/test/gradient.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// packages/serializer/test/gradient.test.ts
import { describe, expect, it } from 'vitest'
import { parseLinearGradient } from '../src/css/gradient.js'

const box = { w: 100, h: 100 }
const wide = { w: 200, h: 100 }

const round = (value: number): number => Math.round(value * 1000) / 1000

describe('parseLinearGradient: направление', () => {
  it('без направления берёт to bottom', () => {
    const g = parseLinearGradient(
      'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))', box,
    )
    expect(g).not.toBeNull()
    expect(g?.from).toEqual({ x: 0.5, y: 0 })
    expect(g?.to).toEqual({ x: 0.5, y: 1 })
  })

  it('to right даёт горизонтальный отрезок', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(g?.from).toEqual({ x: 0, y: 0.5 })
    expect(g?.to).toEqual({ x: 1, y: 0.5 })
  })

  it('to top даёт отрезок снизу вверх', () => {
    const g = parseLinearGradient(
      'linear-gradient(to top, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(g?.from).toEqual({ x: 0.5, y: 1 })
    expect(g?.to).toEqual({ x: 0.5, y: 0 })
  })

  it('90deg равен to right', () => {
    const byAngle = parseLinearGradient(
      'linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    const byKeyword = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(byAngle).toEqual(byKeyword)
  })

  it('135deg на квадрате идёт из верхнего левого в нижний правый', () => {
    const g = parseLinearGradient(
      'linear-gradient(135deg, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(round(g?.from.x ?? -1)).toBe(0)
    expect(round(g?.from.y ?? -1)).toBe(0)
    expect(round(g?.to.x ?? -1)).toBe(1)
    expect(round(g?.to.y ?? -1)).toBe(1)
  })

  it('to top right на КВАДРАТЕ равен 45deg', () => {
    const byKeyword = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    const byAngle = parseLinearGradient(
      'linear-gradient(45deg, rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )
    expect(byKeyword).toEqual(byAngle)
  })

  it('to top right на ШИРОКОМ боксе даёт ТОЧНО ожидаемые концы', () => {
    // Здесь ловится перепутанный atan2. На квадрате оба варианта дают 45°,
    // и ошибка невидима — поэтому проверять надо на неквадратном боксе.
    //
    // Утверждение намеренно о ТОЧНЫХ значениях, а не о соотношении сторон.
    // Первая редакция этого теста сравнивала |dy| > |dx| и оказалась
    // бесполезной: при перепутанном atan2 угол выходит 63.435°, его
    // направление (0.894, −0.447) параллельно диагонали бокса, отрезок
    // ложится РОВНО на диагональ, концы попадают в углы (0,1) и (1,0), и
    // тогда |dx| = |dy| = 1 в точности. Неравенство садилось на лезвие и
    // проходило на шуме плавающей точки.
    //
    // Правильный угол atan2(100,200) = 26.565°: L = 178.9, концы уходят
    // за пределы бокса по вертикали, что нормально — отрезок градиента не
    // обязан лежать внутри.
    const g = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    expect(g?.from).toEqual({ x: 0.3, y: 1.3 })
    expect(g?.to).toEqual({ x: 0.7, y: -0.3 })
  })

  it('to top right на широком боксе совпадает с явным 26.565deg', () => {
    const byKeyword = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    const byAngle = parseLinearGradient(
      'linear-gradient(26.565deg, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    expect(byKeyword).toEqual(byAngle)
  })

  it('to bottom left зеркалит to top right', () => {
    const a = parseLinearGradient(
      'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    const b = parseLinearGradient(
      'linear-gradient(to bottom left, rgb(0, 0, 0), rgb(255, 255, 255))', wide,
    )
    expect(round(a?.from.x ?? -1)).toBe(round(b?.to.x ?? -2))
    expect(round(a?.from.y ?? -1)).toBe(round(b?.to.y ?? -2))
  })
})

describe('parseLinearGradient: остановки', () => {
  it('две остановки без положений получают 0 и 1', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))', box,
    )
    expect(g?.stops).toEqual([
      { offset: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { offset: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ])
  })

  it('три остановки без положений распределяются равномерно', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(1, 1, 1), rgb(2, 2, 2), rgb(3, 3, 3))', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
  })

  it('читает положения в процентах', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0) 20%, rgb(255, 255, 255) 80%)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0.2, 0.8])
  })

  it('переводит положения в пикселях через длину отрезка', () => {
    // to right на боксе шириной 100: длина отрезка 100, значит 25px = 0.25.
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0) 25px, rgb(255, 255, 255) 75px)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0.25, 0.75])
  })

  it('распределяет неявные положения между заданными', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(1, 1, 1) 0%, rgb(2, 2, 2), ' +
      'rgb(3, 3, 3), rgb(4, 4, 4) 60%)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0, 0.2, 0.4, 0.6])
  })

  it('не допускает убывания положений', () => {
    // По спецификации положение, меньшее предыдущего, поднимается до него.
    const g = parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0) 60%, rgb(255, 255, 255) 20%)', box,
    )
    expect(g?.stops.map((s) => s.offset)).toEqual([0.6, 0.6])
  })

  it('читает альфу остановки', () => {
    const g = parseLinearGradient(
      'linear-gradient(to right, rgba(0, 0, 0, 0.5), rgb(255, 255, 255))', box,
    )
    expect(g?.stops[0]?.color.a).toBe(0.5)
  })
})

describe('parseLinearGradient: отказы', () => {
  it('возвращает null на радиальном градиенте', () => {
    expect(parseLinearGradient(
      'radial-gradient(rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )).toBeNull()
  })

  it('возвращает null на коническом', () => {
    expect(parseLinearGradient(
      'conic-gradient(rgb(0, 0, 0), rgb(255, 255, 255))', box,
    )).toBeNull()
  })

  it('возвращает null на repeating-linear-gradient', () => {
    expect(parseLinearGradient(
      'repeating-linear-gradient(to right, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 10%)',
      box,
    )).toBeNull()
  })

  it('возвращает null на url()', () => {
    expect(parseLinearGradient('url("a.png")', box)).toBeNull()
  })

  it('возвращает null на none', () => {
    expect(parseLinearGradient('none', box)).toBeNull()
  })

  it('возвращает null при единственной остановке', () => {
    // Градиент из одного цвета — это сплошная заливка, и схема контракта
    // такой Fill отвергает. Значит парсер обязан отказаться здесь.
    expect(parseLinearGradient('linear-gradient(rgb(0, 0, 0))', box)).toBeNull()
  })

  it('возвращает null на нулевом боксе', () => {
    // Делить положения в пикселях на нулевую длину отрезка нельзя.
    expect(parseLinearGradient(
      'linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))',
      { w: 0, h: 0 },
    )).toBeNull()
  })

  it('возвращает null, если цвет остановки не разобрался', () => {
    // Подстановка чёрного была бы молчаливой потерей.
    expect(parseLinearGradient(
      'linear-gradient(to right, нечто, rgb(255, 255, 255))', box,
    )).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm vitest run packages/serializer/test/gradient.test.ts`
Expected: FAIL — `Failed to resolve import "../src/css/gradient.js"`.

- [ ] **Step 3: Создать `packages/serializer/src/css/gradient.ts`**

```ts
import type { Gradient, GradientStop } from '@h2d/ir'
import { parseColor } from './color.js'

export type BoxSize = { w: number; h: number }

/** Разбивает список аргументов по запятым верхнего уровня.
 *  Наивный `split(',')` сломался бы на запятых внутри `rgba()`. */
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

const SIDE_ANGLES: Record<string, number> = {
  top: 0, right: 90, bottom: 180, left: 270,
}

/** Угол для угловых ключевых слов зависит от пропорций бокса.
 *
 *  По спецификации отрезок перпендикулярен диагонали между двумя соседними
 *  углами. Для `to top right` соседние — верхний левый и нижний правый,
 *  их диагональ направлена как `(w, h)`, перпендикуляр вверх-вправо как
 *  `(h, −w)`. Из `d = (sin θ, −cos θ) ∝ (h, −w)` следует `θ = atan2(h, w)`.
 *
 *  Именно здесь легко перепутать аргументы: на квадратном боксе `atan2(h,w)`
 *  и `atan2(w,h)` оба дают 45°, и ошибка невидима. На боксе 200×100
 *  правильный ответ 26.6°, перепутанный — 63.4°. */
const cornerAngle = (box: BoxSize): number =>
  (Math.atan2(box.h, box.w) * 180) / Math.PI

const directionAngle = (raw: string, box: BoxSize): number | null => {
  const text = raw.trim().toLowerCase()

  const deg = /^(-?[\d.]+)deg$/.exec(text)
  if (deg?.[1] !== undefined) return Number.parseFloat(deg[1])

  const turn = /^(-?[\d.]+)turn$/.exec(text)
  if (turn?.[1] !== undefined) return Number.parseFloat(turn[1]) * 360

  const rad = /^(-?[\d.]+)rad$/.exec(text)
  if (rad?.[1] !== undefined) return (Number.parseFloat(rad[1]) * 180) / Math.PI

  if (!text.startsWith('to ')) return null
  const sides = text.slice(3).trim().split(/\s+/).sort().join(' ')
  const corner = cornerAngle(box)
  switch (sides) {
    case 'top': return SIDE_ANGLES['top'] ?? 0
    case 'right': return SIDE_ANGLES['right'] ?? 90
    case 'bottom': return SIDE_ANGLES['bottom'] ?? 180
    case 'left': return SIDE_ANGLES['left'] ?? 270
    case 'right top': return corner
    case 'bottom right': return 180 - corner
    case 'bottom left': return 180 + corner
    case 'left top': return 360 - corner
    default: return null
  }
}

/** Концы отрезка градиента в НОРМАЛИЗОВАННЫХ координатах бокса.
 *
 *  Ось `y` растёт вниз, а угол CSS отсчитывается от «вверх» по часовой,
 *  поэтому направление `d = (sin θ, −cos θ)`. Длина отрезка по
 *  спецификации `L = |w·sin θ| + |h·cos θ|`, и он проходит через центр. */
const endpoints = (
  angleDeg: number,
  box: BoxSize,
): { from: { x: number; y: number }; to: { x: number; y: number }; length: number } => {
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const length = Math.abs(box.w * dx) + Math.abs(box.h * dy)

  const cx = box.w / 2
  const cy = box.h / 2
  const half = length / 2

  /** Округление до шести знаков и складывание отрицательного нуля.
   *
   *  Это не косметика. `Math.sin(Math.PI)` равен 1.22e-16, а не нулю,
   *  поэтому при θ=180° длина отрезка выходит 100.00000000000001, а
   *  `from.x` уезжает на один ulp ниже 0.5. При θ=135° появляется `-0`,
   *  который `Object.is` отличает от `+0`.
   *
   *  Главный довод не в тестах: IR едет как JSON, а `JSON.stringify(-0)`
   *  даёт `"0"`. Значит отрицательный ноль в транспорте не представим, и
   *  его наличие в памяти создаёт расхождение между значением до и после
   *  round-trip. Шесть знаков при ширине 1920 это 0.002 пикселя — ниже
   *  всякой различимости, зато значения становятся сравнимыми. */
  const norm = (value: number): number => Math.round(value * 1e6) / 1e6 + 0

  return {
    from: { x: norm((cx - dx * half) / box.w), y: norm((cy - dy * half) / box.h) },
    to: { x: norm((cx + dx * half) / box.w), y: norm((cy + dy * half) / box.h) },
    length,
  }
}

type RawStop = { color: GradientStop['color']; offset: number | null }

/** Вырезает цветовую функцию или ключевое слово из начала описания
 *  остановки, возвращая остаток — положение, если оно задано. */
const splitStop = (raw: string): { color: string; position: string } => {
  const text = raw.trim()
  const functional = /^(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^)]*\)/i
  const fn = functional.exec(text)
  if (fn !== null) {
    return { color: fn[0], position: text.slice(fn[0].length).trim() }
  }
  const space = text.indexOf(' ')
  if (space === -1) return { color: text, position: '' }
  return { color: text.slice(0, space), position: text.slice(space + 1).trim() }
}

const parsePosition = (text: string, length: number): number | null => {
  if (text === '') return null
  const pct = /^(-?[\d.]+)%$/.exec(text)
  if (pct?.[1] !== undefined) return Number.parseFloat(pct[1]) / 100
  const px = /^(-?[\d.]+)px$/.exec(text)
  if (px?.[1] !== undefined) return Number.parseFloat(px[1]) / length
  return null
}

/** Восстанавливает неявные положения по правилам спецификации:
 *  первая остановка без положения — 0, последняя — 1, промежуточные
 *  распределяются равномерно между ближайшими заданными, и положения
 *  принудительно не убывают. */
const resolveOffsets = (raws: RawStop[]): GradientStop[] => {
  const offsets: (number | null)[] = raws.map((stop) => stop.offset)
  if (offsets[0] === null) offsets[0] = 0
  const last = offsets.length - 1
  if (offsets[last] === null) offsets[last] = 1

  let index = 0
  while (index < offsets.length) {
    if (offsets[index] !== null) {
      index += 1
      continue
    }
    let end = index
    while (end < offsets.length && offsets[end] === null) end += 1
    const before = offsets[index - 1] ?? 0
    const after = offsets[end] ?? 1
    const gapCount = end - index + 1
    for (let step = 0; step < end - index; step += 1) {
      offsets[index + step] = before + ((after - before) * (step + 1)) / gapCount
    }
    index = end
  }

  const result: GradientStop[] = []
  let previous = 0
  for (let i = 0; i < raws.length; i += 1) {
    const stop = raws[i]
    const offset = offsets[i]
    if (stop === undefined || offset === null || offset === undefined) continue
    const clamped = Math.min(1, Math.max(previous, Math.max(0, offset)))
    previous = clamped
    result.push({ offset: Math.round(clamped * 10000) / 10000, color: stop.color })
  }
  return result
}

/** Разбирает `linear-gradient(...)` из computed style.
 *
 *  Возвращает `null` на всём, что не линейный градиент — включая
 *  `radial-`, `conic-` и `repeating-`. Вызывающий обязан породить
 *  `Diagnostic`: подстановка чего-либо вместо неразобранного градиента
 *  была бы молчаливой потерей. */
export const parseLinearGradient = (
  value: string,
  box: BoxSize,
): Gradient | null => {
  const text = value.trim()
  if (!/^linear-gradient\(/i.test(text)) return null
  if (box.w <= 0 || box.h <= 0) return null

  const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
  const args = splitTopLevel(inner)
  if (args.length === 0) return null

  const firstArg = args[0]
  if (firstArg === undefined) return null

  let angle = 180
  let stopArgs = args
  const asDirection = directionAngle(firstArg, box)
  if (asDirection !== null) {
    angle = asDirection
    stopArgs = args.slice(1)
  }
  if (stopArgs.length < 2) return null

  const geometry = endpoints(angle, box)
  if (geometry.length <= 0) return null

  const raws: RawStop[] = []
  for (const arg of stopArgs) {
    const { color: colorText, position } = splitStop(arg)
    const color = parseColor(colorText)
    if (color === null) return null
    raws.push({ color, offset: parsePosition(position, geometry.length) })
  }

  return {
    kind: 'linear',
    from: geometry.from,
    to: geometry.to,
    stops: resolveOffsets(raws),
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `pnpm vitest run packages/serializer/test/gradient.test.ts`
Expected: PASS, 24 теста.

- [ ] **Step 5: Проверить проверку — перепутать atan2**

Заменить в `cornerAngle` выражение на `Math.atan2(box.w, box.h)`, прогнать тесты.

Обязаны упасть **два** теста: «to top right на ШИРОКОМ боксе даёт ТОЧНО ожидаемые концы» и «совпадает с явным 26.565deg». Тест на квадрате обязан **остаться зелёным** — это и есть доказательство, что квадратная проверка как страховка бесполезна.

Если упал только один или ни одного — останови работу и сообщи: значит тест снова не ловит то, ради чего написан. Первая редакция этого теста сравнивала соотношение сторон отрезка и проходила при перепутанном `atan2`, потому что неверный угол укладывает отрезок ровно на диагональ бокса и обе разности выходят равными единице.

Вернуть как было.

- [ ] **Step 6: Проверить проверку — убрать отказ при одной остановке**

Убрать `if (stopArgs.length < 2) return null`, прогнать. Обязан упасть тест «возвращает null при единственной остановке». Вернуть.

- [ ] **Step 7: Прогнать всё**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): парсер линейного градиента"
```

---

## Task 3: Градиент доезжает до рендера и входит в гейт

Первая фича, доехавшая целиком. Порядок шагов важен: проверка `deferredGradient` перестаёт порождаться для линейных градиентов **в том же коммите**, где градиент начинает рисоваться. Разъедутся — бандл начнёт отвергаться инвариантом, который требует парную диагностику.

**Files:**
- Modify: `packages/serializer/src/walk.ts`, `packages/reference-renderer/src/render.ts`
- Modify: `tests/e2e/pixel-diff.spec.ts`, `tests/e2e/diagnostics.spec.ts`
- Create: `fixtures/gradient/threshold.json`

- [ ] **Step 1: Читать градиент в `readFills`**

В `packages/serializer/src/walk.ts` заменить `readFills` целиком:

```ts
const readFills = (
  el: Element,
  cs: CSSStyleDeclaration,
  sink: DiagnosticSink,
  id: string,
): Fill[] => {
  const fills: Fill[] = []

  const background = parseColor(cs.backgroundColor)
  if (background === null) {
    sink.report(
      'warning', DIAGNOSTIC_CODES.colorUnparsed,
      `Не удалось разобрать background-color: "${cs.backgroundColor}"`, id, false,
    )
  } else if (!isInvisible(background)) {
    fills.push({ kind: 'solid', color: background })
  }

  /** Градиент кладётся ПОВЕРХ цвета фона — так же, как красит браузер:
   *  `background-image` рисуется над `background-color`. Порядок в массиве
   *  `fills` и есть порядок отрисовки. */
  if (cs.backgroundImage !== 'none') {
    const rect = el.getBoundingClientRect()
    const gradient = parseLinearGradient(cs.backgroundImage, {
      w: rect.width, h: rect.height,
    })
    if (gradient !== null) {
      fills.push({ kind: 'gradient', gradient })
    }
  }

  return fills
}
```

Добавить импорт:

```ts
import { parseLinearGradient } from './css/gradient.js'
```

И заменить вызов в `readStyle`: было `readFills(cs, sink, id)`, стало `readFills(el, cs, sink, id)`. Для этого `readStyle` тоже получает `el` первым параметром, а вызов в `buildNode` — `readStyle(el, cs, ctx.sink, id)`.

- [ ] **Step 2: Диагностировать только НЕразобранное**

В `reportGaps` заменить блок про `backgroundImage`:

```ts
  if (cs.backgroundImage !== 'none') {
    const rect = el.getBoundingClientRect()
    const linear = parseLinearGradient(cs.backgroundImage, {
      w: rect.width, h: rect.height,
    })
    /** Диагностика только на то, что НЕ разобрали. Линейные градиенты
     *  теперь переносятся, и сообщать о них было бы шумом, а шум учит
     *  игнорировать отчёт целиком. Радиальные, конические и repeating
     *  по-прежнему не переносятся и обязаны быть названы. */
    if (linear === null) {
      const repeating = cs.backgroundImage.includes('repeating-')
      sink.report(
        repeating ? 'warning' : 'info',
        repeating ? DIAGNOSTIC_CODES.unsupportedRepeatingGradient
                  : DIAGNOSTIC_CODES.deferredGradient,
        `background-image "${cs.backgroundImage.slice(0, 60)}" не переносится: ` +
        `в этом плане поддержан только linear-gradient.`,
        id, false,
      )
    }
  }
```

- [ ] **Step 3: Рисовать градиент в рендерере**

В `packages/reference-renderer/src/render.ts` добавить перед `renderBox`:

```ts
/** Градиент в АБСОЛЮТНЫХ координатах, а не в `objectBoundingBox`.
 *
 *  `objectBoundingBox` масштабирует систему координат неравномерно и
 *  искажает угол на неквадратном боксе: градиент под 45° на широком блоке
 *  наклонился бы не так, как в браузере. `userSpaceOnUse` от этого свободен,
 *  поэтому нормализованные ручки контракта переводятся здесь в пиксели. */
const gradientDef = (id: string, gradient: Gradient, rect: Rect): string => {
  const x1 = rect.x + gradient.from.x * rect.w
  const y1 = rect.y + gradient.from.y * rect.h
  const x2 = rect.x + gradient.to.x * rect.w
  const y2 = rect.y + gradient.to.y * rect.h
  const stops = gradient.stops
    .map((stop) =>
      `<stop offset="${stop.offset}" stop-color="${rgb(stop.color)}" ` +
      `stop-opacity="${stop.color.a}"/>`,
    )
    .join('')
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`
  )
}
```

Импорт типа `Gradient` добавить к существующему списку из `@h2d/ir`.

- [ ] **Step 4: Применять градиент как заливку**

В `renderBox` заменить выбор заливки. Было: ищется `solid`, иначе `fill="none"`. Становится:

```ts
  const solid = style.fills.find((fill) => fill.kind === 'solid')
  const gradientFill = style.fills.find((fill) => fill.kind === 'gradient')

  // ... дальше в сборке attrs:
  /** Когда есть и цвет, и градиент, рисуются ОБА — стопкой, как красит
   *  браузер: `background-image` ложится поверх `background-color`.
   *  Геометрия у обеих фигур одна, поэтому построение вынесено в `shapeFor`.
   *
   *  Первая редакция отбрасывала цвет, и это измерено как расхождение 30%
   *  (36409 из 120000 пикселей) на полупрозрачном градиенте поверх цвета.
   *  Ни одна фикстура случай не видела, поэтому в фикстуру `gradient`
   *  добавлен блок `.layered` с раздельными `background-color` и
   *  `background-image` — сокращение `background:` сбросило бы цвет. */
  const underlay = gradientFill !== undefined && solid !== undefined
      && solid.kind === 'solid'
    ? shapeFor(node, rect, style.corner,
        [`fill="${rgb(solid.color)}"`, `fill-opacity="${solid.color.a}"`], '')
    : ''

  if (gradientFill !== undefined && gradientFill.kind === 'gradient') {
    const gradientId = `grad-${node.id}`
    defs.push(gradientDef(gradientId, gradientFill.gradient, rect))
    attrs.push(`fill="url(#${gradientId})"`)
  } else if (solid !== undefined && solid.kind === 'solid') {
    attrs.push(`fill="${rgb(solid.color)}"`, `fill-opacity="${solid.color.a}"`)
  } else {
    attrs.push('fill="none"')
  }
```

И условие раннего выхода расширить: `if (solid === undefined && gradientFill === undefined && style.stroke === null && !hasShadow) return ''`.

- [ ] **Step 5: Убрать градиент из списка отложенных в диагностиках**

В `tests/e2e/diagnostics.spec.ts` удалить строку `gradient: ['deferred.gradient'],` из `EXPECTED` и удалить тест `gradient: блок с градиентом НЕ приезжает молча прозрачным` — он утверждал обратное тому, что теперь верно.

Вместо него добавить:

```ts
test('gradient: линейный градиент переносится и НЕ диагностируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('gradient'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const hero = screen.root.children[0]
  const fill = hero?.style.fills.find((f) => f.kind === 'gradient')
  expect(fill, 'линейный градиент обязан доехать заливкой').toBeDefined()
  if (fill?.kind !== 'gradient') throw new Error('не градиент')
  expect(fill.gradient.stops.length).toBeGreaterThanOrEqual(2)

  // Разобранный градиент диагностировать не нужно: это был бы шум.
  expect(report.some((i) => i.nodeId === hero?.id && i.code === 'deferred.gradient'))
    .toBe(false)
})

test('gradient: радиальный по-прежнему диагностируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('gradient'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  // Вторая секция фикстуры — radial-gradient. Этот план его не переносит,
  // и молчать о нём нельзя.
  const radial = screen.root.children[1]
  expect(report.some((i) => i.nodeId === radial?.id && i.code === 'deferred.gradient'))
    .toBe(true)
})
```

- [ ] **Step 6: Ввести фикстуру в pixel-diff**

Фикстура `gradient/index.html` содержит и линейный, и радиальный градиент, поэтому целиком в гейт войти не может: радиальный не рисуется. Разделить её — линейный остаётся в `gradient/`, радиальный переезжает в новую `radial-gradient/`.

Заменить `fixtures/gradient/index.html`:

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>gradient</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff}
  .hero{height:160px;background:linear-gradient(135deg,#6366f1,#ec4899)}
  .vertical{height:80px;background:linear-gradient(#22c55e,#0f766e)}
  .horizontal{height:80px;background:linear-gradient(to right,#f59e0b,#b45309)}
  /* Неквадратный бокс с угловым ключевым словом — здесь ловится
     перепутанный atan2, невидимый на квадрате. */
  .corner{height:100px;background:linear-gradient(to top right,#0ea5e9,#312e81)}
  .stops{height:80px;
    background:linear-gradient(to right,#ef4444 0%,#fbbf24 30%,#22c55e 100%)}
</style></head>
<body>
  <div class="hero"></div><div class="vertical"></div>
  <div class="horizontal"></div><div class="corner"></div><div class="stops"></div>
</body></html>
```

Создать `fixtures/radial-gradient/index.html`:

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>radial-gradient</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff}
  .r{height:120px;background:radial-gradient(circle,#22c55e,#0f766e)}
</style></head>
<body><div class="r"></div></body></html>
```

Создать `fixtures/gradient/threshold.json`:

```json
{
  "maxDiffPixels": 400,
  "maxDiffRatio": 0.004,
  "reason": "Градиенты растеризуются по-разному в CSS и в SVG: браузер интерполирует background-image в своём пайплайне, linearGradient — в пайплайне фильтров, и на длинной плавной растяжке это даёт однопиксельные расхождения по границам цветовых полос. Бюджет 400 пикселей — измеренный факт плюс запас; уточнить после первого прогона фактическим числом."
}
```

В `tests/e2e/pixel-diff.spec.ts` добавить `'gradient'` в `FIXTURES`. В `tests/e2e/fidelity.spec.ts` и `bundle.spec.ts` добавить `'radial-gradient'` в их списки фикстур. В `diagnostics.spec.ts` тест про радиальный переписать на фикстуру `radial-gradient` — в `gradient/` радиального больше нет:

```ts
test('radial-gradient: радиальный диагностируется, а не теряется молча', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('radial-gradient'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')
  const node = screen.root.children[0]
  expect(node?.style.fills.some((f) => f.kind === 'gradient')).toBe(false)
  expect(report.some((i) => i.nodeId === node?.id && i.code === 'deferred.gradient'))
    .toBe(true)
})
```

- [ ] **Step 7: Сгенерировать снапшоты и прогнать гейт**

Run: `pnpm build:serializer && UPDATE_SNAPSHOTS=1 pnpm test:e2e && pnpm test:e2e`
Expected: PASS. Если `gradient` не проходит бюджет — **смотреть карту диффа в `test-results/`, а не поднимать порог.** Вероятные причины: перепутанные концы отрезка (диффом видно как зеркальный градиент) или неверные положения остановок (видно как сдвинутые цветовые полосы).

- [ ] **Step 8: Вписать фактическое число в порог**

Заменить в `fixtures/gradient/threshold.json` слова «уточнить после первого прогона фактическим числом» на измеренный максимум по пяти ширинам, как это сделано для остальных фикстур. Порог не поднимать — если факт выше бюджета, причина ищется в рендерере.

- [ ] **Step 9: Проверить проверку**

Заменить в `gradientDef` значение `gradientUnits` на `objectBoundingBox`, прогнать `pnpm test:e2e`. Фикстура `gradient` обязана упасть.

**Прогноз «упадут именно `.corner` и `.hero`, где бокс неквадратный» был неверен** — исправлено по результатам исполнения. Падают все блоки, и причина не в пропорциях: замена только атрибута заставляет читать абсолютные пиксельные координаты как доли бокса, а это несоответствие единиц ломает и осепараллельные блоки тоже. Проверка остаётся полезной, но доказывает она не то, что заявлялось.

Ошибку, из-за которой ручки сделаны нормализованными, ловит **другой** слом: перепутать `Math.atan2(box.h, box.w)` на `atan2(box.w, box.h)` в парсере. Измерено при исполнении: падают все пять ширин, и расхождение лежит **целиком внутри полосы `.corner`**, а вне неё ноль. Вот этим сломом и надо проверять ценность `.corner`.

Отдельно измерено, что семантически корректный вариант подмены — `objectBoundingBox` вместе с нормализованными координатами — роняет только `.hero`, а `.corner` остаётся на нуле: его цвета `#0ea5e9` и `#312e81` слишком близки по YIQ, чтобы сдвиг превысил порог pixelmatch. То есть `.corner` бесполезен против искажения углов и незаменим против перепутанного `atan2`.

Вернуть обе правки.

- [ ] **Step 10: Коммит**

```bash
git add packages/serializer packages/reference-renderer tests fixtures
git commit -m "feat: линейные градиенты переносятся и проверяются pixel-diff"
```

---

## Task 4: Парсер трансформы

Два места, где ошибка незаметна: разложение матрицы и восстановление нетрансформированного бокса.

**Разложение.** `getComputedStyle().transform` отдаёт `matrix(a, b, c, d, e, f)`, что означает отображение `(x,y) → (a·x + c·y + e, b·x + d·y + f)`. Отсюда: `translateX = e`, `translateY = f`, `scaleX = hypot(a, b)`, `angle = atan2(b, a)`, определитель `det = a·d − b·c`, `scaleY = det / scaleX`. Сдвиг (`skew`) присутствует, когда `a·c + b·d ≠ 0`; в Figma его нет, поэтому он обязан диагностироваться, а не теряться.

**Нетрансформированный бокс.** Контракт требует, чтобы при непустом `transform` поле `rect` содержало бокс ДО трансформации, а `getBoundingClientRect()` отдаёт габарит уже трансформированного. Восстанавливается так:

1. Размер нетрансформированного border box берётся из computed style: `width` в Chrome — это ширина content box, поэтому border box = `width + paddingLeft + paddingRight + borderLeftWidth + borderRightWidth`, аналогично по вертикали. Это точнее `offsetWidth`, который округлён до целого.
2. Четыре угла бокса `(0,0)–(bw,bh)` в локальных координатах отображаются матрицей вокруг точки отсчёта.
3. Габарит полученного четырёхугольника считается в локальных координатах.
4. Тот же габарит в координатах страницы даёт `getBoundingClientRect()`.
5. Значит левый верхний угол нетрансформированного бокса на странице равен `(gBCR.left − локальныйМинX, gBCR.top − локальныйМинY)`.

**Files:**
- Create: `packages/serializer/src/css/transform.ts`
- Test: `packages/serializer/test/transform.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// packages/serializer/test/transform.test.ts
import { describe, expect, it } from 'vitest'
import {
  decomposeMatrix, hasSkew, parseMatrix, type Matrix,
} from '../src/css/transform.js'

const round = (value: number): number => Math.round(value * 10000) / 10000

describe('parseMatrix', () => {
  it('разбирает matrix()', () => {
    expect(parseMatrix('matrix(1, 0, 0, 1, 10, 20)'))
      .toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 })
  })

  it('возвращает null на none', () => {
    expect(parseMatrix('none')).toBeNull()
  })

  it('возвращает null на matrix3d — в Figma 3D нет', () => {
    expect(parseMatrix('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)')).toBeNull()
  })
})

describe('decomposeMatrix', () => {
  it('чистый сдвиг', () => {
    const t = decomposeMatrix({ a: 1, b: 0, c: 0, d: 1, e: 10, f: -5 })
    expect(t.translateX).toBe(10)
    expect(t.translateY).toBe(-5)
    expect(round(t.angle)).toBe(0)
    expect(round(t.scaleX)).toBe(1)
    expect(round(t.scaleY)).toBe(1)
  })

  it('чистое масштабирование', () => {
    const t = decomposeMatrix({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 })
    expect(round(t.scaleX)).toBe(2)
    expect(round(t.scaleY)).toBe(3)
    expect(round(t.angle)).toBe(0)
  })

  it('поворот на 90 градусов ПО часовой даёт положительный угол', () => {
    // rotate(90deg) в CSS: matrix(0, 1, -1, 0, 0, 0).
    // Знак здесь и проверяется: отрицательный означал бы перепутанное
    // направление, и повёрнутый блок уехал бы зеркально.
    const t = decomposeMatrix({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 })
    expect(round(t.angle)).toBe(round(Math.PI / 2))
    expect(round(t.scaleX)).toBe(1)
    expect(round(t.scaleY)).toBe(1)
  })

  it('поворот на -45 градусов даёт отрицательный угол', () => {
    const k = Math.SQRT1_2
    const t = decomposeMatrix({ a: k, b: -k, c: k, d: k, e: 0, f: 0 })
    expect(round(t.angle)).toBe(round(-Math.PI / 4))
  })

  it('поворот вместе с масштабом', () => {
    const k = Math.SQRT1_2
    const t = decomposeMatrix({ a: 2 * k, b: 2 * k, c: -2 * k, d: 2 * k, e: 0, f: 0 })
    expect(round(t.angle)).toBe(round(Math.PI / 4))
    expect(round(t.scaleX)).toBe(2)
    expect(round(t.scaleY)).toBe(2)
  })

  it('отрицательный масштаб по вертикали не превращается в поворот', () => {
    const t = decomposeMatrix({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 })
    expect(round(t.angle)).toBe(0)
    expect(round(t.scaleY)).toBe(-1)
  })
})

describe('hasSkew', () => {
  it('false для поворота с масштабом', () => {
    const k = Math.SQRT1_2
    expect(hasSkew({ a: 2 * k, b: 2 * k, c: -2 * k, d: 2 * k, e: 0, f: 0 })).toBe(false)
  })

  it('true для skewX', () => {
    // skewX(20deg) = matrix(1, 0, 0.364, 1, 0, 0)
    expect(hasSkew({ a: 1, b: 0, c: 0.364, d: 1, e: 0, f: 0 })).toBe(true)
  })

  /** Компоненты округляются до шести знаков, потому что именно так их
   *  сериализует Chrome в `getComputedStyle().transform`. Без округления
   *  тест бесполезен: при полной точности `c = −b` и `d = a` дают побитово
   *  точное сокращение, скалярное произведение равно ровно нулю, и
   *  проблема не воспроизводится. Первая редакция этих тестов брала
   *  `Math.cos`/`Math.sin` напрямую и проходила при заведомо неверном
   *  абсолютном допуске. */
  const chromeMatrix = (deg: number, sx: number, sy: number): Matrix => {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const round = (value: number): number => Math.round(value * 1e6) / 1e6
    return {
      a: round(sx * cos), b: round(sx * sin),
      c: round(-sy * sin), d: round(sy * cos),
      e: 0, f: 0,
    }
  }

  it('false для поворота с НЕРАВНОМЕРНЫМ масштабом', () => {
    // Измерено: с абсолютным допуском скалярное произведение здесь равно
    // 1.20e-6 и элемент объявлялся сдвинутым, то есть корректная
    // трансформа отвергалась. После нормировки — 6.02e-8.
    expect(hasSkew(chromeMatrix(37, 5, 4))).toBe(false)
  })

  it('false при большом неравномерном масштабе', () => {
    // Абсолютное произведение 2.41e-5 — в двадцать четыре раза выше
    // допуска. Нормированное 2.51e-9.
    expect(hasSkew(chromeMatrix(37, 120, 80))).toBe(false)
  })

  it('false при повороте с масштабом на другом угле', () => {
    // 23° scale(50,20): абсолютное 3.15e-5, нормированное 3.15e-8.
    expect(hasSkew(chromeMatrix(23, 50, 20))).toBe(false)
  })

  it('true для сдвига даже при большом масштабе — нормировка не глушит сигнал', () => {
    // skewX(20deg) вместе со scale(100): нормировка обязана сохранить
    // чувствительность, а не списать сдвиг на масштаб.
    expect(hasSkew({
      a: 100, b: 0, c: 100 * 0.364, d: 100, e: 0, f: 0,
    })).toBe(true)
  })

  it('false для единичной матрицы', () => {
    expect(hasSkew({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm vitest run packages/serializer/test/transform.test.ts`
Expected: FAIL — `Failed to resolve import "../src/css/transform.js"`.

- [ ] **Step 3: Создать `packages/serializer/src/css/transform.ts`**

```ts
import type { Transform } from '@h2d/ir'
import { parsePx } from './length.js'

/** Коэффициенты `matrix(a, b, c, d, e, f)` из CSS.
 *  Отображение: `(x,y) → (a·x + c·y + e, b·x + d·y + f)`. */
export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }

/** Возвращает `null` на `none` и на `matrix3d`. Трёхмерные трансформы в
 *  Figma отсутствуют физически, поэтому сводить их к двумерным нельзя —
 *  вызывающий обязан породить диагностику. */
export const parseMatrix = (value: string): Matrix | null => {
  const match = /^matrix\(([^)]+)\)$/.exec(value.trim())
  if (match?.[1] === undefined) return null
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null
  const [a, b, c, d, e, f] = parts as [number, number, number, number, number, number]
  return { a, b, c, d, e, f }
}

/** Сдвиг присутствует, когда оси перестают быть перпендикулярными.
 *  В Figma сдвига нет, поэтому его нельзя молча потерять.
 *
 *  Скалярное произведение столбцов НОРМИРУЕТСЯ на их длины, то есть
 *  сравнивается косинус угла между осями, а не само произведение.
 *  Абсолютный допуск здесь неверен, и это измерено: при чистом повороте
 *  произведение равно точно нулю (`c = −b`, `d = a`, и слагаемые
 *  сокращаются побитово), но при повороте с НЕРАВНОМЕРНЫМ масштабом
 *  сокращение перестаёт быть точным и растёт вместе с масштабом —
 *  `rotate(37deg) scale(5,4)` даёт 1.2e-6, `scale(120,80)` даёт 2.4e-5.
 *  С абсолютным допуском корректная трансформа была бы объявлена
 *  сдвинутой и отвергнута, а выглядело бы это как «трансформы не
 *  работают». После нормировки 1e-6 соответствует сдвигу около
 *  0.00006 градуса — ниже всякой различимости. */
export const hasSkew = (m: Matrix): boolean => {
  const lengthX = Math.hypot(m.a, m.b)
  const lengthY = Math.hypot(m.c, m.d)
  if (lengthX === 0 || lengthY === 0) return false
  return Math.abs((m.a * m.c + m.b * m.d) / (lengthX * lengthY)) > 1e-6
}

/** Разложение аффинной матрицы.
 *
 *  `angle = atan2(b, a)` — ось `x` отображается в `(a, b)`. Ось `y` в
 *  экранных координатах растёт вниз, поэтому положительный угол визуально
 *  поворачивает ПО часовой, как `rotate()` в CSS.
 *
 *  `scaleY` считается через определитель, а не как `hypot(c, d)`: иначе
 *  отражение по вертикали (`scaleY: -1`) превратилось бы в поворот на 180°
 *  с положительным масштабом — визуально другое преобразование. */
export const decomposeMatrix = (m: Matrix): Omit<Transform, 'originX' | 'originY'> => {
  const scaleX = Math.hypot(m.a, m.b)
  const determinant = m.a * m.d - m.b * m.c
  return {
    angle: Math.atan2(m.b, m.a),
    scaleX,
    scaleY: scaleX === 0 ? 0 : determinant / scaleX,
    translateX: m.e,
    translateY: m.f,
  }
}

/** Точка отсчёта в пикселях от левого верхнего угла border box. */
export const readOrigin = (cs: CSSStyleDeclaration): { x: number; y: number } => {
  const parts = cs.transformOrigin.trim().split(/\s+/)
  return { x: parsePx(parts[0] ?? '0px'), y: parsePx(parts[1] ?? '0px') }
}

/** Размер НЕтрансформированного border box.
 *
 *  `cs.width` в Chrome — ширина content box, поэтому границы и отступы
 *  добавляются вручную. Это точнее `offsetWidth`, который округлён до
 *  целого, а округление на трансформированном элементе даёт видимое
 *  расхождение в pixel-diff. */
export const untransformedSize = (
  cs: CSSStyleDeclaration,
): { w: number; h: number } => ({
  w: parsePx(cs.width) + parsePx(cs.paddingLeft) + parsePx(cs.paddingRight) +
     parsePx(cs.borderLeftWidth) + parsePx(cs.borderRightWidth),
  h: parsePx(cs.height) + parsePx(cs.paddingTop) + parsePx(cs.paddingBottom) +
     parsePx(cs.borderTopWidth) + parsePx(cs.borderBottomWidth),
})

/** Левый верхний угол НЕтрансформированного бокса в координатах вьюпорта.
 *
 *  `getBoundingClientRect()` отдаёт габарит уже трансформированного
 *  элемента, поэтому положение восстанавливается через сравнение: тот же
 *  габарит считается в локальных координатах, и разница даёт смещение. */
export const untransformedOrigin = (
  el: Element,
  m: Matrix,
  size: { w: number; h: number },
  origin: { x: number; y: number },
): { x: number; y: number } => {
  const corners: [number, number][] = [
    [0, 0], [size.w, 0], [size.w, size.h], [0, size.h],
  ]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const [cx, cy] of corners) {
    const lx = cx - origin.x
    const ly = cy - origin.y
    const tx = m.a * lx + m.c * ly + m.e + origin.x
    const ty = m.b * lx + m.d * ly + m.f + origin.y
    minX = Math.min(minX, tx)
    minY = Math.min(minY, ty)
  }
  const rect = el.getBoundingClientRect()
  return { x: rect.left - minX, y: rect.top - minY }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `pnpm vitest run packages/serializer/test/transform.test.ts`
Expected: PASS, 16 тестов.

- [ ] **Step 5: Проверить проверку — считать scaleY как hypot**

Заменить в `decomposeMatrix` вычисление `scaleY` на `Math.hypot(m.c, m.d)`, прогнать. Обязан упасть тест «отрицательный масштаб по вертикали не превращается в поворот». Вернуть.

- [ ] **Step 6: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): разложение матрицы трансформы"
```

---

## Task 5: Трансформа доезжает до рендера и входит в гейт

**Files:**
- Modify: `packages/serializer/src/walk.ts`, `packages/reference-renderer/src/render.ts`, `packages/ir/src/invariants.ts`
- Modify: `tests/e2e/pixel-diff.spec.ts`, `tests/e2e/diagnostics.spec.ts`
- Create: `fixtures/transformed/threshold.json`

- [ ] **Step 1: Заполнять трансформу и нетрансформированный бокс в обходчике**

В `buildNode`, где сейчас `rect` считается из `getBoundingClientRect()` и `transform: null`, заменить оба:

```ts
  const matrix = parseMatrix(cs.transform)
  const rawRect = el.getBoundingClientRect()

  let transform: Transform | null = null
  let box = { x: rawRect.left, y: rawRect.top, w: rawRect.width, h: rawRect.height }

  if (matrix !== null && !hasSkew(matrix)) {
    const origin = readOrigin(cs)
    const size = untransformedSize(cs)
    const corner = untransformedOrigin(el, matrix, size, origin)
    transform = { ...decomposeMatrix(matrix), originX: origin.x, originY: origin.y }
    /** rect становится НЕтрансформированным боксом — так требует контракт.
     *  Иначе поля противоречат друг другу: рендерер применил бы трансформу
     *  к габариту уже трансформированного элемента и получил двойное
     *  преобразование. */
    box = { x: corner.x, y: corner.y, w: size.w, h: size.h }
  }
```

И в литерале `base` использовать `box` вместо `rect`, плюс передавать `transform`:

```ts
    rect: {
      x: box.x + ctx.scrollX,
      y: box.y + ctx.scrollY,
      w: box.w,
      h: box.h,
    },
    paintOrder: -1,
    isStackingContext: false,
    transform,
```

Импорт:

```ts
import {
  decomposeMatrix, hasSkew, parseMatrix, readOrigin,
  untransformedOrigin, untransformedSize,
} from './css/transform.js'
```

- [ ] **Step 2: Диагностировать только то, что не переносится**

В `reportGaps` заменить блок про `transform`:

```ts
  if (cs.transform !== 'none') {
    const matrix = parseMatrix(cs.transform)
    if (matrix === null) {
      sink.report('error', DIAGNOSTIC_CODES.unsupportedTransform3d,
        `transform "${cs.transform}" не переносится: трёхмерных трансформ в ` +
        `Figma нет физически.`, id, false)
    } else if (hasSkew(matrix)) {
      /** Сдвиг в Figma отсутствует. Узел при этом приезжает без трансформы
       *  вообще, а не со сдвигом, приведённым к повороту: приближение
       *  выглядело бы правдоподобно и потому хуже честного отказа. */
      sink.report('error', DIAGNOSTIC_CODES.unsupportedTransform3d,
        `transform "${cs.transform}" содержит сдвиг, которого в Figma нет.`,
        id, false)
    }
  }
```

- [ ] **Step 3: Применять трансформу в рендерере**

В `render.ts` добавить перед `renderNode`:

```ts
/** Трансформа применяется ВОКРУГ точки отсчёта, а не вокруг начала
 *  координат: CSS вращает вокруг `transform-origin`, по умолчанию центра.
 *  Отсюда классическая тройка — перенос в точку отсчёта, преобразование,
 *  перенос назад. Угол в градусах, потому что SVG принимает градусы. */
const transformAttr = (node: IrNode): string => {
  if (node.transform === null) return ''
  const t = node.transform
  const ox = node.rect.x + t.originX
  const oy = node.rect.y + t.originY
  const deg = (t.angle * 180) / Math.PI
  return (
    ` transform="translate(${ox} ${oy}) translate(${t.translateX} ${t.translateY})` +
    ` rotate(${deg}) scale(${t.scaleX} ${t.scaleY}) translate(${-ox} ${-oy})"`
  )
}
```

И в `renderNode` обернуть результат каждой ветки:

```ts
const renderNode = (node: IrNode, defs: string[]): string => {
  const body = renderNodeBody(node, defs)
  if (body === '') return ''
  const transform = transformAttr(node)
  return transform === '' ? body : `<g${transform}>${body}</g>`
}
```

Существующий `switch` переименовать в `renderNodeBody` без других изменений.

- [ ] **Step 4: Удалить проверку deferred.transform из инвариантов**

В `packages/ir/src/invariants.ts`, в `checkDeferredDiagnosed`, удалить строки:

```ts
      if (node.transform !== null) {
        deferred.push({ code: 'deferred.transform', feature: 'transform' })
      }
```

Это ровно то удаление «по фиче», которое предписывает комментарий над функцией. Без него бандл с перенесённой трансформой начнёт отвергаться за отсутствие диагностики, которой больше не должно быть.

- [ ] **Step 5: Обновить тесты инвариантов**

В `packages/ir/test/invariants.test.ts` удалить тесты `ловит transform без diagnostic` и `принимает transform с парной диагностикой deferred.transform` — оба утверждают снятое требование. Тесты на `blend` и `blur` не трогать.

- [ ] **Step 6: Обновить e2e-диагностики**

В `tests/e2e/diagnostics.spec.ts` удалить `transformed: ['deferred.transform'],` из `EXPECTED` и удалить тест `transformed: диагностика уровня error на каждом трансформированном узле`. Добавить:

```ts
test('transformed: трансформа переносится, rect — НЕтрансформированный бокс', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('transformed'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const row = screen.root.children[0]
  const kids = row?.children ?? []
  expect(kids).toHaveLength(3)

  for (const kid of kids) {
    expect(kid.transform, `у ${kid.id} обязана быть трансформа`).not.toBeNull()
  }

  // Повёрнутый блок: rect обязан остаться 120×60, а не раздуться до габарита
  // повёрнутого. Именно это раздутие было симптомом в плане 1.
  const rotated = kids[0]
  expect(rotated?.rect.w).toBeCloseTo(120, 1)
  expect(rotated?.rect.h).toBeCloseTo(60, 1)
  expect(rotated?.transform?.angle).toBeGreaterThan(0)

  expect(report.some((i) => i.code === 'deferred.transform')).toBe(false)
})
```

- [ ] **Step 7: Ввести фикстуру в гейт**

Создать `fixtures/transformed/threshold.json`:

```json
{
  "maxDiffPixels": 500,
  "maxDiffRatio": 0.004,
  "reason": "Повёрнутые кромки сглаживаются по-разному: браузер растеризует трансформированный слой, SVG — содержимое группы с transform, и на наклонных границах это даёт однопиксельные расхождения. Бюджет 500 пикселей; уточнить после первого прогона фактическим числом."
}
```

Добавить `'transformed'` в `FIXTURES` в `tests/e2e/pixel-diff.spec.ts`.

- [ ] **Step 8: Прогнать, разобрать расхождения, вписать факт**

Run: `pnpm build:serializer && UPDATE_SNAPSHOTS=1 pnpm test:e2e && pnpm test:e2e`

Вероятные причины провала и что смотреть в карте диффа: блок уехал вдвое дальше нужного — трансформа применилась к уже трансформированному `rect`, то есть Step 1 не заменил `box`; блок повернулся в другую сторону — перепутан знак угла; блок повернулся вокруг угла вместо центра — не применена точка отсчёта.

Затем вписать измеренный максимум в `reason`.

- [ ] **Step 9: Проверить проверку**

Убрать `translate(${ox} ${oy})` и парный обратный перенос из `transformAttr`, прогнать. Фикстура `transformed` обязана упасть: поворот вокруг начала координат уводит блок далеко. Вернуть.

- [ ] **Step 10: Коммит**

```bash
git add packages/ir packages/serializer packages/reference-renderer tests fixtures
git commit -m "feat: 2D-трансформы переносятся и проверяются pixel-diff"
```

---

## Task 5b: Честность про потомков трансформированных узлов

Появилась по итогам Task 5. Исполнитель обнаружил, что задача улучшила корректность **ценой честности**, и это надо было закрыть немедленно.

**Что произошло.** Потомок внутри трансформированного родителя переносится неверно: его `rect` снят как осепараллельный габарит уже повёрнутого элемента, потому что `getBoundingClientRect()` включает трансформы предков, а рендерер рисует его неповёрнутым. Проверено живым захватом: блок 60×30 внутри `rotate(20deg)` приезжает как 66.64 × 48.71.

Геометрия была неверна и **до** Task 5. Но до неё родитель нёс `deferred.transform`, и инвариант в `@h2d/ir` заставлял бандл объяснить, что трансформированное поддерево не перенесено. Когда родитель стал переноситься верно, объяснение исчезло вместе с диагностикой — а неверность потомков осталась. Отчёт стал пустым при неверном результате, то есть ровно молчаливым fallback'ом, который правило проекта запрещает.

Это стоит запомнить как отдельный класс регрессии: **реализация отложенной фичи снимает диагностику, которая прикрывала соседний, ещё не реализованный случай.** При каждом удалении проверки `deferred.*` надо спрашивать, что именно она объясняла, и не остаётся ли часть этого необъяснённой.

**Геометрия здесь не чинится.** Правильное решение — хранить `rect` в локальных координатах родителя и композировать трансформы вниз по дереву, что меняет смысл поля для всех потребителей. Это работа плана 3, где всё равно придётся трогать систему координат ради ассетов.

- [ ] **Step 1: Код диагностики в `packages/ir/src/codes.ts`**

```ts
  /** Узел лежит внутри трансформированного предка. Сам предок
   *  переносится верно, а вот потомок — нет: его `rect` снят как
   *  осепараллельный габарит УЖЕ повёрнутого элемента, потому что
   *  `getBoundingClientRect()` включает трансформы предков.
   *
   *  Код появился как исправление честности, а не геометрии. */
  transformDescendant: 'fidelity.transform-descendant',
```

- [ ] **Step 2: Флаг в контексте обхода**

`WalkContext` получает `insideTransform: boolean`. Флаг ведётся **сверху вниз**, потому что снизу его не восстановить: `getBoundingClientRect()` уже включает трансформы предков и не говорит, откуда они взялись.

В `buildNode` дети обходятся с производным контекстом:

```ts
  const childCtx: WalkContext = transform === null
    ? ctx
    : { ...ctx, insideTransform: true }
```

Переиспользование того же объекта при `transform === null` намеренно: копия на каждый узел дерева из десятков тысяч элементов — лишняя работа без выигрыша.

- [ ] **Step 3: Диагностика перед выбором вида узла**

```ts
  if (ctx.insideTransform) {
    ctx.sink.report(
      'warning', DIAGNOSTIC_CODES.transformDescendant,
      'Узел лежит внутри трансформированного предка: его прямоугольник снят ' +
      'как габарит уже трансформированного элемента, и трансформа предка к ' +
      'нему не применяется.',
      id, false,
    )
  }
```

- [ ] **Step 4: Фикстура `fixtures/transform-nested/index.html`**

Содержимое внутри `rotate(20deg)`, на двух уровнях вложенности — ребёнок и внук. **В pixel-diff не входит:** рендер заведомо разойдётся, и порог, подогнанный под заведомо неверный результат, был бы ложью. Входит в снапшоты и в проверку бандла.

- [ ] **Step 5: Тест в `tests/e2e/diagnostics.spec.ts`**

Проверяет три вещи: родитель переносится верно, ребёнок и внук объяснены диагностикой, а на самом родителе её нет — он не потомок. Внук важен отдельно: он доказывает, что флаг наследуется вглубь, а не ставится только на прямых детей.

- [ ] **Step 6: Проверить проверку**

Убрать блок диагностики, прогнать `pnpm test:e2e`. Обязаны упасть тест диагностик и пять снапшотов `transform-nested`. Вернуть.

- [ ] **Step 7: Коммит**

```bash
git add packages/ir packages/serializer tests fixtures
git commit -m "fix: объяснять потомков трансформированных узлов вместо молчания"
```

---

## Task 6: Режимы наложения

Самая короткая фича: сериализатор `blend` уже снимает с плана 1, поэтому работы ровно на отрисовку и снятие проверки.

**Files:**
- Modify: `packages/reference-renderer/src/render.ts`, `packages/ir/src/invariants.ts`
- Modify: `packages/serializer/src/walk.ts`, `tests/e2e/diagnostics.spec.ts`, `tests/e2e/pixel-diff.spec.ts`
- Create: `fixtures/blend/index.html`, `fixtures/blend/threshold.json`

- [ ] **Step 1: Создать фикстуру `fixtures/blend/index.html`**

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>blend</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff}
  .stack{position:relative;height:140px;background:#f59e0b}
  .over{position:absolute;inset:20px;background:#3b82f6}
  .multiply{mix-blend-mode:multiply}
  .screen{mix-blend-mode:screen}
  .overlay{mix-blend-mode:overlay}
</style></head>
<body>
  <div class="stack"><div class="over multiply"></div></div>
  <div class="stack"><div class="over screen"></div></div>
  <div class="stack"><div class="over overlay"></div></div>
</body></html>
```

- [ ] **Step 2: Применять режим наложения в рендерере**

В `renderBox`, в сборке `attrs`:

```ts
  /** SVG принимает режим наложения как свойство стиля, не как атрибут
   *  презентации, поэтому он идёт через `style=`. Значения CSS и SVG
   *  совпадают по написанию, так что перевод не нужен. */
  if (style.blend !== 'normal') {
    attrs.push(`style="mix-blend-mode:${style.blend}"`)
  }
```

- [ ] **Step 3: Убрать диагностику и проверку**

В `packages/serializer/src/walk.ts` удалить из `reportGaps` блок:

```ts
  if (cs.mixBlendMode !== 'normal') {
    sink.report('info', DIAGNOSTIC_CODES.deferredBlend,
      `mix-blend-mode "${cs.mixBlendMode}" не переносится в этом плане.`, id, false)
  }
```

В `packages/ir/src/invariants.ts`, в `checkDeferredDiagnosed`, удалить:

```ts
      if (node.style.blend !== 'normal') {
        deferred.push({ code: 'deferred.blend', feature: 'blend' })
      }
```

В `packages/ir/test/invariants.test.ts` удалить тест `ловит blend без diagnostic`.

- [ ] **Step 4: Добавить e2e-проверку**

В `tests/e2e/diagnostics.spec.ts`:

```ts
test('blend: режим наложения доезжает и не диагностируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fixtureUrl('blend'))
  const { screen, report } = await captureScreen(page, 's0', 'Desktop')

  const modes = screen.root.children.map((s) => s.children[0]?.style.blend)
  expect(modes).toEqual(['multiply', 'screen', 'overlay'])
  expect(report.some((i) => i.code === 'deferred.blend')).toBe(false)
})
```

- [ ] **Step 5: Ввести в гейт**

Создать `fixtures/blend/threshold.json`:

```json
{
  "maxDiffPixels": 200,
  "maxDiffRatio": 0.002,
  "reason": "Наложение считается в одной и той же цветовой модели браузером и SVG, поэтому расхождение ожидается только на кромках вложенного блока. Бюджет 200 пикселей; уточнить после первого прогона фактическим числом."
}
```

Добавить `'blend'` в `FIXTURES` в `pixel-diff.spec.ts`, `fidelity.spec.ts`, `bundle.spec.ts`.

- [ ] **Step 6: Прогнать и вписать факт**

Run: `pnpm build:serializer && UPDATE_SNAPSHOTS=1 pnpm test:e2e && pnpm test:e2e`

Если расхождение велико — вероятная причина в том, что в SVG режим наложения действует относительно группы-родителя, а не всего холста. Тогда смотреть, нужна ли `isolation` на родительском элементе, и решать это правкой рендерера, а не порогом.

- [ ] **Step 7: Проверить проверку**

Убрать применение `mix-blend-mode` из `renderBox`, прогнать. Фикстура `blend` обязана упасть. Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add packages/ir packages/serializer packages/reference-renderer tests fixtures
git commit -m "feat: режимы наложения переносятся и проверяются pixel-diff"
```

---

## Task 6b: Честность про наложение в изолирующей группе

Второй случай того же класса, что Task 5b, и теперь это закономерность, а не совпадение: **реализация отложенной фичи снимает общую диагностику, которая заодно прикрывала соседний нереализованный случай.**

Исполнитель Task 6 проверил гипотезу зондом, а не рассуждением — построил две страницы и прогнал через настоящий конвейер:

| | браузер | референс-рендерер |
|---|---|---|
| с `isolation: isolate` | зелёный остаётся зелёным | **чёрный** |
| без изоляции | зелёный умножается с красным → чёрный | чёрный |

В CSS наложение композитит с подложкой в пределах ближайшей изолирующей группы. Референс-рендерер плющит дерево в плоский список и границ изоляции не имеет вовсе — он смешивает со всем, что нарисовано раньше.

Отдельно проверено и важно: подложка из **чужого поддерева** без изоляции воспроизводится верно **по построению**, потому что плоский рендерер сохраняет глобальный `paintOrder`. Значит дефект именно в области изоляции, а не в происхождении подложки.

**Изолируют не все stacking context.** `position: relative; z-index: 1` не изолирует. Изолируют `isolation: isolate`, `opacity < 1`, фильтр, маска и собственный режим наложения. Различение существенно: если считать изолирующим любой позиционированный элемент, диагностика начнёт срабатывать почти везде и превратится в шум.

- [ ] **Step 1: Код `blendIsolation: 'fidelity.blend-isolation'` в `packages/ir/src/codes.ts`**

- [ ] **Step 2: Флаг `insideIsolation` в `WalkContext`**

Ведётся сверху вниз рядом с `insideTransform`. Производный контекст создаётся только когда узел что-то меняет — копия на каждый узел дерева из десятков тысяч элементов была бы лишней работой:

```ts
  const isolates =
    cs.isolation === 'isolate' ||
    Number.parseFloat(cs.opacity) < 1 ||
    cs.filter !== 'none' ||
    cs.clipPath !== 'none' ||
    cs.mixBlendMode !== 'normal'

  const needsChildCtx = transform !== null || isolates
```

- [ ] **Step 3: Диагностика при наложении внутри изолирующей группы**

Условие двойное: `ctx.insideIsolation && cs.mixBlendMode !== 'normal'`. Узел без наложения внутри изоляции переносится верно, и сообщать о нём было бы шумом.

- [ ] **Step 4: Фикстура `fixtures/blend-isolated/index.html`**

Красная подложка, затем наложение внутри `isolation: isolate` и отдельно внутри `opacity: 0.99`. Второй случай нужен потому, что изоляция через прозрачность неочевидна. **В pixel-diff не входит:** рендер заведомо разойдётся.

- [ ] **Step 5: Два теста в `diagnostics.spec.ts`**

Первый — оба случая объяснены. Второй, не менее важный, — на фикстуре `blend`, где изолирующего предка нет, диагностики быть **не должно**.

- [ ] **Step 6: Проверить проверку обоими сломами**

Убрать диагностику — упадут тест и снапшоты `blend-isolated`. Затем расширить условие изоляции на `cs.position !== 'static'` — обязан упасть тест про отсутствие ложных срабатываний на фикстуре `blend`. Второй слом важнее первого: он проверяет, что диагностика не шумит.

- [ ] **Step 7: Коммит**

```bash
git add packages/ir packages/serializer tests fixtures
git commit -m "fix: объяснять наложение в изолирующей группе вместо молчания"
```

---

## Task 7: Размытие

**Files:**
- Modify: `packages/serializer/src/walk.ts`, `packages/reference-renderer/src/render.ts`, `packages/ir/src/invariants.ts`
- Create: `fixtures/blur/index.html`, `fixtures/blur/threshold.json`

- [ ] **Step 1: Создать фикстуру `fixtures/blur/index.html`**

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>blur</title>
<style>
  *{margin:0;padding:0}
  body{background:#fff;padding:24px;display:flex;gap:24px}
  .b{width:140px;height:100px;background:#6366f1}
  .soft{filter:blur(4px)}
  .softer{filter:blur(10px)}
</style></head>
<body>
  <div class="b"></div><div class="b soft"></div><div class="b softer"></div>
</body></html>
```

Фикстура намеренно без `backdrop-filter`: он размывает то, что ЗА элементом, а рендерер плющит дерево и «за элементом» у него нет. Это остаётся отложенным, и диагностика на него сохраняется.

- [ ] **Step 2: Заполнять размытие в обходчике**

В `readStyle` заменить `blur: null` на:

```ts
    blur: (() => {
      const layer = blurRadius(cs.filter)
      const background = blurRadius(cs.backdropFilter)
      return layer > 0 || background > 0 ? { layer, background } : null
    })(),
```

- [ ] **Step 3: Диагностировать только фоновое размытие**

В `reportGaps` заменить блок про размытие:

```ts
  const layerBlur = blurRadius(cs.filter)
  const bgBlur = blurRadius(cs.backdropFilter)
  if (bgBlur > 0) {
    /** Размытие слоя переносится, фоновое — нет. Причина не в Figma, где
     *  Background Blur есть, а в рендерере: он плющит дерево в плоский
     *  список, и «того, что за элементом» у него не существует. Проверить
     *  перенос нечем, поэтому фича остаётся отложенной. */
    sink.report('info', DIAGNOSTIC_CODES.deferredBlur,
      `backdrop-filter: blur(${bgBlur}px) не переносится: рендерер плющит ` +
      `дерево, и фона за элементом у него нет.`, id, false)
  }
```

- [ ] **Step 4: Рисовать размытие в рендерере**

**Не заменяй существующий фильтр целиком.** План 1 реализовал внутренние тени вручную — инверсия альфы, блюр, смещение, композиция по исходной альфе — и фикстура `boxes` проверяет их с нулём расходящихся пикселей. Функция, написанная с нуля «под размытие», выбросила бы эти примитивы, и `boxes` упал бы.

Поэтому порядок такой:

1. Прочитать текущую реализацию фильтра в `packages/reference-renderer/src/render.ts` — функцию, собирающую `<filter>` из теней, вместе с примитивами внутренней тени.
2. **Добавить** в начало её цепочки примитив размытия слоя, ничего не удаляя:

```ts
  if (blur !== null && blur.layer > 0) {
    /** CSS `blur(Npx)` задаёт стандартное отклонение НАПРЯМУЮ, в отличие
     *  от `box-shadow`, где радиус вдвое больше отклонения. Перепутать
     *  легко, и ошибка выглядит как «размытие вдвое сильнее нужного». */
    parts.push(`<feGaussianBlur stdDeviation="${blur.layer}"/>`)
  }
```

3. Расширить подпись функции третьим параметром `blur: Blur | null` и условие её вызова: фильтр нужен, если есть тень **или** размытие.

```ts
  const needsFilter = hasShadow || style.blur !== null
```

4. Убедиться, что `color-interpolation-filters="sRGB"` на элементе `<filter>` остался. Он обязателен: по умолчанию SVG считает фильтры в linearRGB, а CSS композитит в sRGB, и в плане 1 это стоило 470 расходящихся пикселей — нашёл только pixel-diff.

Импорт типа `Blur` добавить к существующему списку из `@h2d/ir`.

- [ ] **Step 4b: Убедиться, что внутренние тени не пострадали**

Run: `pnpm build:serializer && pnpm test:e2e`
Expected: фикстура `boxes` по-прежнему даёт **0 расходящихся пикселей** на всех пяти ширинах.

Это не формальность: `boxes` содержит `.inset-shadow`, и если примитивы внутренней тени выпали из цепочки при добавлении размытия, бюджет 60 пикселей будет превышен немедленно. Проверять до того, как появится фикстура `blur`, — иначе два изменения смешаются и причина провала будет неясна.

- [ ] **Step 5: Удалить проверку deferred.blur для размытия слоя**

В `packages/ir/src/invariants.ts` заменить проверку:

```ts
      if (node.style.blur !== null && node.style.blur.background > 0) {
        deferred.push({ code: 'deferred.blur', feature: 'blur' })
      }
```

Требование остаётся только для фонового размытия, потому что только оно не переносится.

В `packages/ir/test/invariants.test.ts` тест `ловит blur без diagnostic` переписать так, чтобы он ставил `{ layer: 0, background: 4 }`.

- [ ] **Step 6: Ввести в гейт**

Создать `fixtures/blur/threshold.json`:

```json
{
  "maxDiffPixels": 1200,
  "maxDiffRatio": 0.006,
  "reason": "Гауссово размытие браузер и SVG считают приближённо и разными ядрами: CSS filter использует трёхпроходное приближение, SVG feGaussianBlur — своё. На радиусе 10px это даёт расхождение по всей площади размытой области, а не только по кромке, поэтому бюджет выше остальных. Уточнить после первого прогона фактическим числом."
}
```

Добавить `'blur'` в `FIXTURES` в `pixel-diff.spec.ts`, `fidelity.spec.ts`, `bundle.spec.ts`.

- [ ] **Step 7: Прогнать и вписать факт**

Run: `pnpm build:serializer && UPDATE_SNAPSHOTS=1 pnpm test:e2e && pnpm test:e2e`

**Если расхождение окажется выше бюджета — это законный повод оставить размытие отложенным**, а не поднимать порог. Приближения гауссова ядра в CSS и SVG различаются принципиально, и если разница велика, честнее вернуть диагностику и записать причину, чем выдавать неточный перенос за точный. Решение принять по карте диффа и записать в `reason` либо факт, либо причину отката.

- [ ] **Step 8: Проверить проверку**

Убрать `feGaussianBlur` из `effectsFilter`, прогнать. Фикстура `blur` обязана упасть. Вернуть.

- [ ] **Step 9: Коммит**

```bash
git add packages/ir packages/serializer packages/reference-renderer tests fixtures
git commit -m "feat: размытие слоя переносится и проверяется pixel-diff"
```

---

## Task 8: Полный прогон, документация, база знаний

**Files:**
- Modify: `README.md`, `wiki/log.md`, `wiki/pages/concepts/support-boundaries.md`
- Create: `wiki/pages/entities/gradients-and-transforms.md`

- [ ] **Step 1: Прогон от чистого состояния**

```bash
rm -rf node_modules packages/*/dist packages/*/node_modules \
       packages/*/tsconfig.tsbuildinfo test-results out
pnpm install
pnpm exec playwright install chromium
pnpm typecheck
pnpm build:serializer
pnpm test
```

Удаление `*.tsbuildinfo` обязательно, и это не перестраховка: `tsc -b` доверяет кешу и **не проверяет, существует ли `dist`**. Без удаления кеша `pnpm typecheck` молча ничего не делает, пакеты не пересобираются, и `pnpm capture` падает с невнятным `ERR_MODULE_NOT_FOUND`. Найдено в плане 1.

- [ ] **Step 2: Снять реальную страницу и посмотреть глазами**

```bash
pnpm capture fixtures/gradient/index.html
pnpm capture fixtures/transformed/index.html
```

Сравнить `out/page.png` и `out/render.png` в каждом случае. Это не формальность: pixel-diff говорит «сколько», а картинка — «что именно». Если расхождение есть, но в бюджете, глаз покажет, сосредоточено оно на кромках (нормально) или размазано по площади (значит перенос неверен, а бюджет великоват).

- [ ] **Step 3: Обновить README**

В разделе о состоянии проекта заменить перечень непереносимого. Было: градиенты, трансформы, наложение, размытие не переносятся. Стало: переносятся линейные градиенты, 2D-трансформы, режимы наложения, размытие слоя; не переносятся радиальные и конические градиенты, фоновое размытие, изображения, векторы, псевдоэлементы — и для каждого есть диагностика.

Обновить число фикстур и тестов фактическими значениями из Step 1.

- [ ] **Step 4: Создать `wiki/pages/entities/gradients-and-transforms.md`**

Страница должна объяснить три вещи, которые иначе придётся выводить заново: почему ручки градиента нормализованы, а не заданы углом; почему угловые ключевые слова зависят от пропорций бокса и как выводится `atan2(h, w)`; почему `rect` при непустой трансформе — нетрансформированный бокс и как он восстанавливается. Связать wikilink'ами с `[[ir-bundle]]` и `[[support-boundaries]]`.

- [ ] **Step 5: Обновить `wiki/pages/concepts/support-boundaries.md`**

Перенести линейные градиенты, 2D-трансформы, наложение и размытие слоя из раздела «переносим в плане 2» в «переносим уверенно». В разделе отложенного оставить радиальные и конические градиенты, фоновое размытие, изображения, векторы, псевдоэлементы — с причиной для каждого. Для конических причина техническая: гейту нечем их проверить, в SVG конического градиента нет.

- [ ] **Step 6: Запись в `wiki/log.md`**

Добавить запись с датой, перечнем реализованных фич и, главное, тем, что нашёл pixel-diff при их добавлении. Это ценнее списка фич: в плане 1 именно такие записи оказались самыми полезными при возврате к теме.

- [ ] **Step 7: Коммит**

```bash
git add README.md wiki
git commit -m "docs: красочные свойства перенесены, база знаний обновлена"
```

---

## Проверка готовности плана

- [ ] `pnpm test` проходит от чистой установки, включая удаление `*.tsbuildinfo`
- [ ] Фикстуры `gradient`, `transformed`, `blend`, `blur` входят в pixel-diff, и в каждом `threshold.json` записан **измеренный** факт, а не оценка
- [ ] Ни один порог не поднят без физической причины в поле `reason`
- [ ] Проверки `deferred.transform` и `deferred.blend` удалены из инвариантов; `deferred.blur` сужена до фонового размытия; `deferredGradient` порождается только для нелинейных
- [ ] Для каждой реализованной фичи проделан слом и подтверждено падение гейта
- [ ] `radial-gradient` остаётся с диагностикой, и на это есть тест
- [ ] Ни одного `any`: `grep -rn ": any\|as any" packages/ tests/ scripts/` пусто
- [ ] `pnpm capture` на фикстурах `gradient` и `transformed` просмотрен глазами

## Что этот план сознательно не делает

Радиальные и конические градиенты, фоновое размытие, изображения и ассеты, ZIP-бандл, векторы, псевдоэлементы, сдвиг (`skew`), трёхмерные трансформы, что-либо внутри Figma, расширение Chrome.
