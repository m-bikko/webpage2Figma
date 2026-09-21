# Coordinate System and Group Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести `rect` в координаты родителя и научить референс-рендерер применять групповые эффекты ко всему поддереву, закрыв четыре продиагностированных дефекта: потомков трансформированных, размытых и полупрозрачных узлов и наложение внутри изолирующей группы.

**Architecture:** Сериализатор ведёт накопленную матрицу предков и восстанавливает нетрансформированное положение узла в этой системе, после чего выражает `rect` относительно родителя. Рендерер перестаёт быть плоским: узел, создающий stacking context, становится группой `<g>` со своим эффектом, а его поддерево рисуется внутри. Это возможно потому, что поддерево такого узла занимает **непрерывный** диапазон порядка отрисовки — проверено на всех фикстурах.

**Tech Stack:** тот же воркспейс; SVG `<g>` с `transform`, `opacity`, `filter`, `isolation`.

**Место в карте планов:** план 3 из 7. Дальше: 4 — ассеты и ZIP-бандл, 5 — плагин Figma, 6 — расширение Chrome, 7 — компоненты и токены.

---

## Почему это раньше ассетов

Изначально ассеты стояли третьими. Порядок изменён по причине, которая выяснилась при разборе четвёртого дефекта с групповыми эффектами: **Figma позиционирует детей относительно родителя.** Локальные координаты нужны не только чтобы починить то, что сейчас продиагностировано, — это ровно та форма, в которой плагин из плана 5 будет строить дерево. Сделав их сейчас, мы снимаем риск с самой трудной части проекта.

Обратный довод столь же прост: изображения, добавленные сегодня, легли бы на модель, заведомо неверную для вложенного содержимого.

## Что чинится и чем это измерено

Четыре случая одной формы, найденные в плане 2. Общая причина: **групповые эффекты CSS действуют на элемент вместе с поддеревом, а плоский рендерер применяет их только к узлу.**

| случай | измерено | диагностика сейчас |
|---|---|---|
| потомки трансформированного узла | блок 60×30 внутри `rotate(20deg)` приезжает как 66.64 × 48.71 | `fidelity.transform-descendant` |
| потомки размытого узла | 2362 расходящихся пикселя | `fidelity.blur-descendant` |
| потомки полупрозрачного узла | 6000 расходящихся пикселей | `fidelity.opacity-group` |
| наложение в изолирующей группе | элемент чернеет вместо сохранения цвета | `fidelity.blend-isolation` |

Четвёртый из них — `opacity` — был дефектом **плана 1** и молчал с самого начала: ни одна фикстура не помещала детей внутрь полупрозрачного блока.

**Когда эти четыре фичи заработают, соответствующие диагностики удаляются.** И здесь действует правило, выведенное в плане 2 трижды: **при удалении проверки спрашивай, что именно она прикрывала.** Каждый раз, когда реализация фичи снимала общую диагностику, оказывалось, что та заодно объясняла соседний, ещё не реализованный случай.

## Допущение, на котором держится вложенный рендеринг

Поддерево узла, создающего stacking context, занимает **непрерывный** диапазон `paintOrder`. Это следствие устройства резолвера: `paintUnit` испускает индекс контекста, затем полностью обходит его бакеты, и ничто извне внутрь не вклинивается.

Проверено измерением на фикстурах `group-effects`, `stacking`, `flex`, `boxes`, `transform-nested`: **ни одного разрыва**. Непрерывность и позволяет обернуть диапазон в `<g>`, не разрушив порядок отрисовки.

Обратный случай — когда диапазон разорван — уже отлавливается функцией `findInterleaved` и порождает `fidelity.paint-order-interleaved`. Он возникает у узлов, которые **не** создают контекст, и именно поэтому оборачивать надо по признаку `isStackingContext`, а не по любому узлу с эффектом.

## Правила, унаследованные от планов 1 и 2

**TDD.** Тест первым, запуск, падение по ожидаемой причине, потом реализация.

**Проверяй проверки.** За два плана девять проверок оказались пустыми, и все девять **проходили**. Сломай проверяемое и убедись, что проверка упала. Если сломать нельзя, а результат тот же, ветка мёртвая: удаляй ветку, а не тест.

Отдельный подвид, встреченный дважды: **проверка может не воспроизводить условие.** Тест про ложный сдвиг брал `Math.cos` напрямую и проходил при заведомо неверном допуске, потому что условие возникает только на компонентах, округлённых как их сериализует Chrome. Тест про накопление эффектов ничего не ловил, потому что в фикстуре не было вложенных эффектов. Спрашивай не только «падает ли», но и «а то ли я воспроизвёл».

**Пороги не подгоняются.** Главная метрика — абсолютный бюджет пикселей. Измерено в плане 2: размытие вдвое слабее даёт 508 пикселей, то есть 0.03%, и относительный порог его пропускает.

**Мои оценки порогов systematically неверны.** Четыре раза подряд в плане 2 я предсказывал расхождение растеризации, и четыре раза фичи совпали с браузером пиксель в пиксель. Оценки в этом плане — ориентир, а не факт; измеряй и вписывай измеренное.

**Коммиты** заканчиваются трейлером:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## Структура файлов

```
packages/ir/src/types.ts           смысл rect меняется: координаты РОДИТЕЛЯ
packages/ir/src/invariants.ts      − четыре проверки группового эффекта
                                   + проверка вложенности координат

packages/serializer/src/css/transform.ts  накопленная матрица предков
packages/serializer/src/walk.ts           rect в локальных координатах,
                                          снятие диагностик

packages/reference-renderer/src/render.ts  вложенные группы вместо плоского
                                           списка; эффекты на группе

fixtures/group-effects/    входит в pixel-diff
fixtures/transform-nested/ входит в pixel-diff
fixtures/blend-isolated/   входит в pixel-diff
```

**Все 85 снапшотов IR изменятся**: `rect` меняет смысл у каждого узла глубже корня. Это ожидаемо и является самой заметной частью диффа. Регенерация допустима только после того, как понята причина — и причина здесь одна и известна заранее.

---

---

## Task 1: Контракт — `rect` в координатах родителя

Смысл поля меняется, сам тип нет. Это делает изменение особенно опасным: **ничто не сломается при компиляции**, а неверно понявший потребитель нарисует всё не в тех местах. Поэтому док-комментарий здесь несёт больше, чем обычно, а инвариант получает проверку, которой раньше не было.

**Files:**
- Modify: `packages/ir/src/types.ts`, `packages/ir/src/invariants.ts`
- Test: `packages/ir/test/invariants.test.ts`

- [ ] **Step 1: Переписать док-комментарий `rect` в `packages/ir/src/types.ts`**

```ts
  /** Координаты ОТНОСИТЕЛЬНО родительского узла, а не документа.
   *
   *  У корня экрана — абсолютные координаты документа; у всех остальных —
   *  смещение от левого верхнего угла `rect` родителя.
   *
   *  Так устроено по двум причинам. Первая: Figma позиционирует детей
   *  относительно родительского фрейма, поэтому абсолютные координаты
   *  плагину пришлось бы пересчитывать обратно. Вторая важнее — групповые
   *  эффекты CSS (трансформа, прозрачность, размытие) применяются к
   *  элементу ВМЕСТЕ с поддеревом, и применить их к группе можно только
   *  если координаты внутри группы заданы в её собственной системе.
   *
   *  Когда `transform` узла не null, `rect` — его НЕтрансформированный
   *  border box в системе родителя, а дети выражены относительно этого
   *  бокса. То есть трансформа применяется к узлу и его поддереву как к
   *  целому, ровно как в CSS.
   *
   *  ВНИМАНИЕ при чтении старых бандлов: до плана 3 поле содержало
   *  абсолютные координаты документа. Тип не изменился, поэтому
   *  компилятор такую путаницу не поймает — различить редакции можно
   *  только по версии IR. */
  rect: Rect
```

- [ ] **Step 2: Поднять версию IR**

В `packages/ir/src/version.ts`:

```ts
/** Версия формата IR. Обе половины системы сверяют её и отказываются
 *  работать при несовпадении — молчаливая деградация запрещена.
 *
 *  2: `rect` стал координатами родителя вместо абсолютных. Смена версии
 *  здесь обязательна и не косметическая: тип поля не изменился, поэтому
 *  бандл прошлой редакции пройдёт проверку схемы целиком и будет
 *  построен неверно — каждый вложенный узел уедет на смещение родителя.
 *  Версия — единственное, что эти редакции различает. */
export const IR_VERSION = 2
```

- [ ] **Step 3: Написать падающие тесты нового инварианта**

Добавить в `packages/ir/test/invariants.test.ts`:

```ts
describe('checkInvariants: координаты родителя', () => {
  it('принимает детей, лежащих внутри родителя', () => {
    const root = frameNode({
      id: 'a', paintOrder: 0,
      rect: { x: 0, y: 0, w: 200, h: 100 },
      children: [frameNode({
        id: 'b', paintOrder: 1,
        rect: { x: 10, y: 10, w: 50, h: 20 },
      })],
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  it('принимает ребёнка, выходящего за пределы родителя', () => {
    // Законно: absolute-позиционирование, отрицательные отступы и
    // overflow: visible выносят ребёнка наружу сплошь и рядом. Инвариант
    // проверяет систему координат, а не вложенность геометрии.
    const root = frameNode({
      id: 'a', paintOrder: 0,
      rect: { x: 0, y: 0, w: 100, h: 100 },
      children: [frameNode({
        id: 'b', paintOrder: 1,
        rect: { x: -30, y: 150, w: 50, h: 20 },
      })],
    })
    expect(checkInvariants(bundle({ screens: [screen({ root })] }))).toEqual([])
  })

  it('ловит ребёнка с подозрительно большим смещением', () => {
    // Верный признак бандла прошлой редакции: ребёнок несёт абсолютные
    // координаты документа, поэтому его смещение примерно равно
    // положению родителя на странице. Проверка эвристическая и потому
    // уровня предупреждения — но молчать нельзя: тип не изменился, и
    // ничто другое такую путаницу не поймает.
    const root = frameNode({
      id: 'a', paintOrder: 0,
      rect: { x: 0, y: 0, w: 1440, h: 900 },
      children: [frameNode({
        id: 'b', paintOrder: 1,
        rect: { x: 0, y: 0, w: 100, h: 50 },
        children: [frameNode({
          id: 'c', paintOrder: 2,
          // Ребёнок узла 100×50 не может законно отстоять на 40000px:
          // это абсолютные координаты, попавшие в поле для локальных.
          rect: { x: 40000, y: 40000, w: 10, h: 10 },
        })],
      })],
    })
    expect(codesOf(checkInvariants(bundle({ screens: [screen({ root })] }))))
      .toContain('rect.suspicious-offset')
  })
})
```

- [ ] **Step 4: Запустить и убедиться, что падает**

Run: `pnpm vitest run packages/ir/test/invariants.test.ts`
Expected: FAIL — третий тест не находит кода `rect.suspicious-offset`. Первые два обязаны пройти сразу: они не требуют новой логики.

- [ ] **Step 5: Добавить проверку в `packages/ir/src/invariants.ts`**

```ts
/** Ловит бандл прошлой редакции, где `rect` нёс абсолютные координаты.
 *
 *  Проверка нужна именно потому, что тип поля не изменился: схема такой
 *  бандл пропустит целиком, а плагин построит макет, в котором каждый
 *  вложенный узел уехал на смещение родителя. Версия IR отличает
 *  редакции формально, но бандл могли собрать вручную или склеить из
 *  кусков, и тогда версия соврёт.
 *
 *  Порог заведомо щедрый: ребёнок законно выходит далеко за пределы
 *  родителя при `position: absolute`, отрицательных отступах и
 *  `overflow: visible`. Ловится не «вышел за границы», а «отстоит на
 *  величину, сопоставимую с размером экрана, будучи ребёнком мелкого
 *  узла» — признак именно перепутанной системы координат.
 *
 *  Уровень предупреждения, а не отказа: эвристика не должна отвергать
 *  бандл, она должна его объяснить. */
const SUSPICIOUS_OFFSET_FACTOR = 50

const checkLocalCoordinates = (bundle: Bundle): InvariantError[] => {
  const errors: InvariantError[] = []

  for (const [index, screen] of bundle.screens.entries()) {
    const visit = (node: IrNode): void => {
      for (const child of node.children) {
        const parentSpan = Math.max(node.rect.w, node.rect.h, 1)
        const offset = Math.max(Math.abs(child.rect.x), Math.abs(child.rect.y))
        if (offset > parentSpan * SUSPICIOUS_OFFSET_FACTOR) {
          errors.push({
            code: 'rect.suspicious-offset',
            path: `screens[${index}].{${child.id}}.rect`,
            message:
              `Смещение ${Math.round(offset)}px у ребёнка узла размером ` +
              `${Math.round(node.rect.w)}×${Math.round(node.rect.h)}. Похоже на ` +
              `абсолютные координаты в поле для координат родителя: с плана 3 ` +
              `rect задаётся относительно родителя.`,
          })
        }
        visit(child)
      }
    }
    visit(screen.root)
  }

  return errors
}
```

И включить в `checkInvariants` рядом с остальными.

- [ ] **Step 6: Прогнать тесты**

Run: `pnpm typecheck && pnpm vitest run packages/ir`
Expected: PASS. Тестов в `@h2d/ir` станет на три больше.

- [ ] **Step 7: Проверить проверку**

Поднять `SUSPICIOUS_OFFSET_FACTOR` до `100000`, прогнать. Третий тест обязан упасть. Вернуть.

Затем опустить до `2` и прогнать снова: обязан упасть **второй** тест — тот, где ребёнок законно вынесен наружу. Это доказывает, что порог не задушил легитимный случай, а не только что он ловит нелегитимный. Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add packages/ir
git commit -m "feat(ir)!: rect в координатах родителя, версия 2"
```

---

## Task 2: Сериализатор — накопленная матрица и локальные координаты

Здесь живёт вся сложность плана. Задача: выразить положение узла в системе координат родителя, зная только экранную геометрию.

**Почему нельзя просто вычесть.** Для узла вне трансформаций достаточно вычесть абсолютное положение родителя. Но `getBoundingClientRect()` у потомка трансформированного предка возвращает габарит уже повёрнутого элемента в экранных координатах, и вычитание дало бы величину в повёрнутой системе, а не в локальной.

**Как восстанавливается.** У узла известен нетрансформированный размер из вычисленного стиля. Если взять накопленную матрицу предков, умножить на собственную матрицу узла и применить произведение к четырём углам бокса, получится четырёхугольник, чей габарит равен тому, что вернул `getBoundingClientRect()`. Разница между габаритом в локальных координатах и экранным даёт положение — тот же приём, что уже применён в `untransformedOrigin`, но с полной матрицей вместо собственной.

**Files:**
- Modify: `packages/serializer/src/css/transform.ts`, `packages/serializer/src/walk.ts`
- Test: `packages/serializer/test/transform.test.ts`

- [ ] **Step 1: Написать падающие тесты умножения матриц**

Добавить в `packages/serializer/test/transform.test.ts`:

```ts
describe('multiplyMatrix', () => {
  const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

  it('единичная матрица ничего не меняет', () => {
    const m: Matrix = { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }
    expect(multiplyMatrix(identity, m)).toEqual(m)
    expect(multiplyMatrix(m, identity)).toEqual(m)
  })

  it('перенос складывается', () => {
    const a: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 }
    const b: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 3, f: 7 }
    expect(multiplyMatrix(a, b)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 13, f: 12 })
  })

  it('масштаб умножается', () => {
    const a: Matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    const b: Matrix = { a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 }
    expect(multiplyMatrix(a, b)).toEqual({ a: 6, b: 0, c: 0, d: 6, e: 0, f: 0 })
  })

  it('порядок множителей значим: масштаб предка масштабирует перенос потомка', () => {
    // Предок увеличивает вдвое, потомок сдвинут на 10. В экранных
    // координатах сдвиг тоже удваивается — это и есть смысл вложенности,
    // и перестановка множителей его теряет.
    const ancestor: Matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    const own: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 }
    expect(multiplyMatrix(ancestor, own).e).toBe(20)
    expect(multiplyMatrix(own, ancestor).e).toBe(10)
  })

  it('поворот предка разворачивает перенос потомка', () => {
    // Предок повёрнут на 90°, потомок сдвинут вправо на 10. На экране
    // сдвиг идёт ВНИЗ, а не вправо.
    const ancestor: Matrix = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }
    const own: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 }
    const result = multiplyMatrix(ancestor, own)
    expect(Math.round(result.e)).toBe(0)
    expect(Math.round(result.f)).toBe(10)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm vitest run packages/serializer/test/transform.test.ts`
Expected: FAIL — `multiplyMatrix is not a function`.

- [ ] **Step 3: Добавить умножение в `packages/serializer/src/css/transform.ts`**

```ts
/** Произведение аффинных матриц: сначала применяется `inner`, затем `outer`.
 *
 *  Порядок значим и легко перепутать. Матрица предка стоит СЛЕВА, потому
 *  что точка сначала преобразуется собственной матрицей узла, а затем
 *  матрицей предка — как при вложенности в DOM. Перестановка даёт
 *  правдоподобный, но неверный результат: перенос потомка перестаёт
 *  масштабироваться и поворачиваться вместе с предком. */
export const multiplyMatrix = (outer: Matrix, inner: Matrix): Matrix => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
  e: outer.a * inner.e + outer.c * inner.f + outer.e,
  f: outer.b * inner.e + outer.d * inner.f + outer.f,
})

export const IDENTITY_MATRIX: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Матрица узла вокруг его точки отсчёта, приведённая к обычной
 *  аффинной форме. CSS применяет трансформу вокруг `transform-origin`,
 *  то есть `T(o) · M · T(−o)`, и без этого приведения произведение
 *  матриц по дереву считалось бы неверно. */
export const matrixAboutOrigin = (
  m: Matrix,
  origin: { x: number; y: number },
): Matrix => multiplyMatrix(
  multiplyMatrix(
    { a: 1, b: 0, c: 0, d: 1, e: origin.x, f: origin.y },
    m,
  ),
  { a: 1, b: 0, c: 0, d: 1, e: -origin.x, f: -origin.y },
)

/** Левый верхний угол НЕтрансформированного бокса в экранных координатах,
 *  с учётом накопленных трансформ предков.
 *
 *  Обобщение `untransformedOrigin`: вместо собственной матрицы узла
 *  берётся произведение матрицы предков на собственную. Габарит
 *  четырёхугольника, полученного применением произведения к углам бокса,
 *  равен тому, что вернул `getBoundingClientRect()`, и разница даёт
 *  положение. */
export const originUnderMatrix = (
  el: Element,
  total: Matrix,
  size: { w: number; h: number },
): { x: number; y: number } => {
  const corners: [number, number][] = [
    [0, 0], [size.w, 0], [size.w, size.h], [0, size.h],
  ]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const [cx, cy] of corners) {
    minX = Math.min(minX, total.a * cx + total.c * cy)
    minY = Math.min(minY, total.b * cx + total.d * cy)
  }
  const rect = el.getBoundingClientRect()
  return { x: rect.left - minX, y: rect.top - minY }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `pnpm vitest run packages/serializer/test/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверить проверку**

Поменять местами `outer` и `inner` в теле `multiplyMatrix`, прогнать. Обязаны упасть два теста — про порядок множителей и про поворот предка, — а тесты про единичную матрицу, сложение переносов и умножение масштабов **остаться зелёными**. Это показывает, что коммутирующие случаи как страховка бесполезны, и ловят именно некоммутирующие. Вернуть.

- [ ] **Step 6: Вести накопленную матрицу в `packages/serializer/src/walk.ts`**

В `WalkContext` добавить поле:

```ts
  /** Произведение матриц всех трансформированных предков. Ведётся сверху
   *  вниз: снизу его не восстановить, потому что `getBoundingClientRect()`
   *  отдаёт результат их применения, но не сами матрицы. */
  ancestorMatrix: Matrix
  /** Экранное положение левого верхнего угла нетрансформированного бокса
   *  родителя. Вычитается, чтобы получить координаты относительно него. */
  parentOrigin: { x: number; y: number }
```

Инициализация в `walkDocument`: `ancestorMatrix: IDENTITY_MATRIX`, `parentOrigin: { x: 0, y: 0 }`.

- [ ] **Step 7: Считать `rect` в системе родителя**

В `buildNode` заменить блок вычисления `box`:

```ts
  const ownMatrixRaw = parseMatrix(cs.transform)
  const skewed = ownMatrixRaw !== null && hasSkew(ownMatrixRaw)
  const usable = ownMatrixRaw !== null && !skewed && appliesTransform(el, cs)

  const origin = readOrigin(cs)
  const ownMatrix = usable && ownMatrixRaw !== null
    ? matrixAboutOrigin(ownMatrixRaw, origin)
    : IDENTITY_MATRIX

  const size = untransformedSize(cs)
  const total = multiplyMatrix(ctx.ancestorMatrix, ownMatrix)
  const screenOrigin = originUnderMatrix(el, total, size)

  /** Положение выражается относительно родителя. Вычитается ЭКРАННОЕ
   *  положение родителя, а не локальное: обе величины получены одним и
   *  тем же способом в одной системе, и их разность и есть смещение в
   *  системе родителя. */
  const box = {
    x: screenOrigin.x - ctx.parentOrigin.x,
    y: screenOrigin.y - ctx.parentOrigin.y,
    w: size.w,
    h: size.h,
  }

  const transform: Transform | null = usable && ownMatrixRaw !== null
    ? { ...decomposeMatrix(ownMatrixRaw), originX: origin.x, originY: origin.y }
    : null
```

Прокрутка больше не прибавляется к координатам детей: она входит в положение корня и наследуется вложенностью. В литерале `base` поле становится просто `rect: box`, а у корня к нему добавляется прокрутка — это делает `walkDocument` после обхода:

```ts
  built.node.rect = {
    ...built.node.rect,
    x: built.node.rect.x + window.scrollX,
    y: built.node.rect.y + window.scrollY,
  }
```

- [ ] **Step 8: Передавать контекст детям**

```ts
  const childCtx: WalkContext = {
    ...ctx,
    ancestorMatrix: total,
    parentOrigin: screenOrigin,
    groupEffects: /* как было */,
    insideIsolation: /* как было */,
  }
```

Контекст теперь создаётся для каждого узла, а не условно: `parentOrigin` меняется всегда.

- [ ] **Step 9: Прогнать и посмотреть, что стало**

Run: `pnpm build:serializer && pnpm capture fixtures/transform-nested/index.html`

Ожидание: у вложенного блока `rect` теперь 60×30, а не 66.64 × 48.71, и его `x`/`y` — небольшое смещение внутри родителя, а не экранная позиция. Посмотреть `out/ir.json` глазами и сверить числа с CSS фикстуры.

- [ ] **Step 10: Коммит**

```bash
git add packages/serializer
git commit -m "feat(serializer): rect в координатах родителя с учётом матриц предков"
```

---

## Task 3: Рендерер — вложенные группы вместо плоского списка

Самая крупная перестройка рендерера с момента его появления. До сих пор он плющил дерево в список, сортировал по `paintOrder` и рисовал каждый узел по абсолютным координатам. Теперь координаты локальные, а групповые эффекты обязаны действовать на поддерево — значит нужна вложенность.

**Что делает вложенность возможной.** Поддерево узла, создающего stacking context, занимает непрерывный диапазон `paintOrder` — измерено на всех фикстурах, ни одного разрыва. Значит такой диапазон можно обернуть в `<g>`, не разрушив порядок.

**Почему оборачивать надо по `isStackingContext`, а не по «есть эффект».** Узел с эффектом всегда создаёт контекст, но обратное неверно: `position: relative; z-index: 1` создаёт контекст без эффекта. Обёртка по признаку контекста совпадает с непрерывностью диапазона, обёртка по эффекту — нет.

**Files:**
- Modify: `packages/reference-renderer/src/render.ts`
- Test: `packages/reference-renderer/test/render.test.ts`

- [ ] **Step 1: Написать падающие тесты структуры**

Добавить в `packages/reference-renderer/test/render.test.ts`:

```ts
describe('renderScreenToSvg: вложенность и групповые эффекты', () => {
  const withChild = (
    parentOverrides: Partial<Omit<IrNode, 'kind'>>,
    childOverrides: Partial<Omit<IrNode, 'kind'>> = {},
  ): IrNode => filled({ r: 1, g: 1, b: 1, a: 1 }, {
    id: 'parent', paintOrder: 1,
    rect: { x: 0, y: 0, w: 100, h: 100 },
    ...parentOverrides,
    children: [filled({ r: 2, g: 2, b: 2, a: 1 }, {
      id: 'child', paintOrder: 2,
      rect: { x: 10, y: 10, w: 20, h: 20 },
      ...childOverrides,
    })],
  })

  it('координаты ребёнка складываются с родительскими', () => {
    const root = filled({ r: 9, g: 9, b: 9, a: 1 }, {
      id: 'root', paintOrder: 0,
      rect: { x: 5, y: 7, w: 200, h: 200 },
      children: [withChild({ rect: { x: 20, y: 30, w: 100, h: 100 } })],
    })
    const svg = renderScreenToSvg(screen(root))
    // Ребёнок: 5 + 20 + 10 = 35 по x, 7 + 30 + 10 = 47 по y.
    expect(svg).toContain('x="35"')
    expect(svg).toContain('y="47"')
  })

  it('узел с прозрачностью оборачивается в группу', () => {
    const root = withChild({
      isStackingContext: true,
      style: { ...filled({ r: 1, g: 1, b: 1, a: 1 }).style, opacity: 0.5 },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg).toContain('<g opacity="0.5"')
  })

  it('прозрачность применяется к ГРУППЕ, а не к каждому узлу', () => {
    // Ключевое отличие от плоского рендера. Если прозрачность стоит на
    // каждой фигуре отдельно, перекрывающиеся потомки просвечивают друг
    // через друга — измерено как 6000 расходящихся пикселей.
    const root = withChild({
      isStackingContext: true,
      style: { ...filled({ r: 1, g: 1, b: 1, a: 1 }).style, opacity: 0.5 },
    })
    const svg = renderScreenToSvg(screen(root))
    const shapeOpacities = svg.match(/<rect[^>]*opacity="0\\.5"/g) ?? []
    expect(shapeOpacities, 'прозрачность не должна дублироваться на фигурах')
      .toHaveLength(0)
  })

  it('размытие применяется к группе целиком', () => {
    const root = withChild({
      isStackingContext: true,
      style: {
        ...filled({ r: 1, g: 1, b: 1, a: 1 }).style,
        blur: { layer: 4, background: 0 },
      },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg).toMatch(/<g[^>]*filter="url\\(#/)
  })

  it('трансформа группы не применяется к детям повторно', () => {
    // Дети выражены в системе родителя, поэтому трансформа на группе
    // действует на них автоматически. Отдельной трансформы у ребёнка
    // быть не должно.
    const root = withChild({
      isStackingContext: true,
      transform: {
        angle: 0.2, scaleX: 1, scaleY: 1,
        translateX: 0, translateY: 0, originX: 50, originY: 50,
      },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.match(/rotate\\(/g) ?? []).toHaveLength(1)
  })

  it('размытие не применяется дважды — на группе и на фигуре', () => {
    // Оставить эффект на обоих означало бы наложить размытие поверх
    // размытия: визуально правдоподобно и вдвое сильнее нужного.
    const root = withChild({
      isStackingContext: true,
      style: {
        ...filled({ r: 1, g: 1, b: 1, a: 1 }).style,
        blur: { layer: 4, background: 0 },
      },
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.match(/filter="url\(#blur-/g) ?? [],
      'фильтр размытия должен встретиться ровно один раз').toHaveLength(1)
  })

  it('изолирующая группа получает isolation', () => {
    const root = withChild({
      isStackingContext: true,
      style: { ...filled({ r: 1, g: 1, b: 1, a: 1 }).style, opacity: 0.5 },
    })
    expect(renderScreenToSvg(screen(root))).toContain('isolation:isolate')
  })

  it('узел БЕЗ эффектов не создаёт лишней группы', () => {
    const root = withChild({})
    const svg = renderScreenToSvg(screen(root))
    expect(svg.match(/<g/g) ?? [], 'плоские узлы не должны обрастать группами')
      .toHaveLength(0)
  })

  it('порядок отрисовки внутри группы сохраняется', () => {
    const root = filled({ r: 9, g: 9, b: 9, a: 1 }, {
      id: 'root', paintOrder: 0,
      isStackingContext: true,
      style: { ...filled({ r: 9, g: 9, b: 9, a: 1 }).style, opacity: 0.5 },
      children: [
        filled({ r: 1, g: 1, b: 1, a: 1 }, { id: 'late', paintOrder: 2 }),
        filled({ r: 2, g: 2, b: 2, a: 1 }, { id: 'early', paintOrder: 1 }),
      ],
    })
    const svg = renderScreenToSvg(screen(root))
    expect(svg.indexOf('rgb(2,2,2)')).toBeLessThan(svg.indexOf('rgb(1,1,1)'))
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm vitest run packages/reference-renderer`
Expected: FAIL на тестах вложенности. Тесты, унаследованные от плана 1 и 2, тоже упадут — координаты стали локальными, и их фикстуры этого не учитывают. **Это часть задачи, а не неожиданность:** поправь фикстуры унаследованных тестов, добавив родителю нулевое смещение там, где раньше подразумевались абсолютные координаты. Сколько таких тестов — посчитай и сообщи.

- [ ] **Step 3: Переписать сборку SVG в `packages/reference-renderer/src/render.ts`**

Заменить `renderScreenToSvg` и добавить рекурсивную сборку:

```ts
/** Абсолютное положение узла в системе экрана.
 *  Координаты локальные, поэтому смещения складываются по пути от корня. */
type Offset = { x: number; y: number }

const shift = (rect: Rect, by: Offset): Rect => ({
  ...rect, x: rect.x + by.x, y: rect.y + by.y,
})

/** Групповые эффекты узла, вынесенные на обёртку `<g>`.
 *
 *  Возвращает пустую строку, если оборачивать нечего. Лишняя группа не
 *  ломает картинку, но засоряет вывод и мешает читать его глазами —
 *  а рендерер служит ещё и инструментом отладки. */
const groupAttrs = (node: IrNode, defs: string[], at: Offset): string => {
  const parts: string[] = []
  const style: string[] = []

  if (node.transform !== null) {
    const t = node.transform
    const ox = node.rect.x + at.x + t.originX
    const oy = node.rect.y + at.y + t.originY
    const deg = (t.angle * 180) / Math.PI
    parts.push(
      `transform="translate(${ox} ${oy}) translate(${t.translateX} ${t.translateY})` +
      ` rotate(${deg}) scale(${t.scaleX} ${t.scaleY}) translate(${-ox} ${-oy})"`,
    )
  }
  if (node.style.opacity < 1) parts.push(`opacity="${node.style.opacity}"`)
  if (node.style.blur !== null && node.style.blur.layer > 0) {
    const id = `blur-${node.id}`
    defs.push(
      `<filter id="${id}" x="-75%" y="-75%" width="250%" height="250%" ` +
      `color-interpolation-filters="sRGB">` +
      `<feGaussianBlur stdDeviation="${node.style.blur.layer}"/></filter>`,
    )
    parts.push(`filter="url(#${id})"`)
  }
  if (node.style.blend !== 'normal') style.push(`mix-blend-mode:${node.style.blend}`)

  /** Изоляция обязательна на любой группе с собственным эффектом: иначе
   *  наложение внутри неё композитит со всем холстом, как это делал
   *  плоский рендерер, и защита теряется. */
  if (parts.length > 0 || style.length > 0) style.push('isolation:isolate')
  if (style.length > 0) parts.push(`style="${style.join(';')}"`)

  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

/** Рисует узел и его поддерево.
 *
 *  Узел, создающий stacking context, становится группой: его эффекты
 *  висят на `<g>` и потому действуют на всё поддерево, как в CSS.
 *  Остальные узлы рисуются плоско, а их дети продолжают общий порядок
 *  отрисовки — иначе обёртка вокруг каждого узла разрушила бы
 *  возможность перекрывать соседа. */
const renderSubtree = (node: IrNode, at: Offset, defs: string[]): string => {
  const absolute = shift(node.rect, at)
  const inner: Offset = { x: absolute.x, y: absolute.y }

  const descendants = [...node.children]
    .sort((a, b) => a.paintOrder - b.paintOrder)
    .map((child) => renderSubtree(child, inner, defs))
    .join('')

  const attrs = node.isStackingContext ? groupAttrs(node, defs, at) : ''

  if (attrs === '') {
    return renderNodeBody({ ...node, rect: absolute }, defs) + descendants
  }

  /** Эффекты сняты с самой фигуры, потому что они уже висят на группе.
   *  Оставить их на обоих — значит применить дважды: полупрозрачная
   *  группа с полупрозрачной фигурой внутри даёт квадрат прозрачности,
   *  а размытие накладывается поверх размытия. */
  const bare = renderNodeBody(
    {
      ...node,
      rect: absolute,
      style: { ...node.style, opacity: 1, blend: 'normal', blur: null },
    },
    defs,
  )
  return `<g${attrs}>${bare}${descendants}</g>`
}

export const renderScreenToSvg = (screen: Screen): string => {
  const defs: string[] = []
  const body = renderSubtree(screen.root, { x: 0, y: 0 }, defs)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" ` +
    `height="${screen.height}" viewBox="0 0 ${screen.width} ${screen.height}">` +
    `<defs>${defs.join('')}</defs>${body}</svg>`
  )
}
```

`renderNodeBody` и `transformAttr` из плана 2 больше не применяют трансформу к одиночному узлу — она ушла на группу. Удали `transformAttr` и его вызов.

- [ ] **Step 4: Прогнать тесты рендерера**

Run: `pnpm vitest run packages/reference-renderer && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Проверить проверку тремя сломами**

Каждый обязан уронить свой тест и только его:

1. Снять `isolation:isolate` из `groupAttrs` — падает тест про изоляцию.
2. Оставить `opacity` на самом узле, не обнуляя его в `bare` — падает тест про недублирование прозрачности.
3. Не складывать смещение в `shift`, вернув `rect` как есть — падает тест про сложение координат.

Если какой-то слом роняет больше тестов, чем ожидалось, разберись почему: возможно, тесты пересекаются и один из них лишний.

- [ ] **Step 6: Коммит**

```bash
git add packages/reference-renderer
git commit -m "feat(reference-renderer): вложенные группы и эффекты на поддереве"
```

---

## Task 4: Фикстуры в гейт, диагностики сняты

Четыре продиагностированных дефекта становятся исправленными, и соответствующие диагностики обязаны исчезнуть в том же коммите — иначе инвариант начнёт требовать объяснения для того, что больше не теряется.

**Перед удалением каждой спроси, что она прикрывала.** В плане 2 это правило сработало трижды: реализация фичи снимала общую диагностику, а та заодно объясняла соседний нереализованный случай. Здесь снимаются сразу четыре, и вопрос тем более уместен.

**Files:**
- Modify: `packages/serializer/src/walk.ts`, `packages/ir/src/{codes,invariants}.ts`
- Modify: `tests/e2e/{pixel-diff,diagnostics}.spec.ts`
- Create: `fixtures/{group-effects,transform-nested,blend-isolated}/threshold.json`

- [ ] **Step 1: Снять диагностики групповых эффектов из обходчика**

В `packages/serializer/src/walk.ts` удалить цикл `for (const effect of ctx.groupEffects)` и блок `if (ctx.insideIsolation && cs.mixBlendMode !== 'normal')`. Поля `groupEffects` и `insideIsolation` в `WalkContext` больше не нужны — удалить их вместе с вычислением `ownEffects` и `isolates`.

`ancestorMatrix` и `parentOrigin` остаются: они несут координаты, а не диагностику.

- [ ] **Step 2: Снять проверки из инвариантов**

В `packages/ir/src/invariants.ts` удалить из `checkDeferredDiagnosed` всё, что осталось от групповых эффектов. Коды в `codes.ts` **не удалять**: коды стабильны и никогда не удаляются после публикации — так же поступили с `deferredTransform` и `deferredBlend` в плане 2. Дописать к каждому из четырёх комментарий, что случай исправлен в плане 3 и код сохранён для совместимости чтения старых бандлов.

- [ ] **Step 3: Обновить тесты инвариантов**

Тесты, утверждавшие наличие этих диагностик, заменить на утверждения обратного: бандл с трансформированным поддеревом принимается без диагностики. Так снятое требование нельзя вернуть незаметно.

- [ ] **Step 4: Ввести три фикстуры в pixel-diff**

`fixtures/group-effects/threshold.json`:

```json
{
  "maxDiffPixels": 300,
  "maxDiffRatio": 0.003,
  "reason": "Три групповых эффекта и вложенный случай. Расхождение ожидается на кромках размытой группы: размытие группы и размытие одиночной фигуры растеризуются одинаково, но границы группы шире. Уточнить после первого прогона фактическим числом."
}
```

`fixtures/transform-nested/threshold.json`:

```json
{
  "maxDiffPixels": 300,
  "maxDiffRatio": 0.003,
  "reason": "Поворот группы с содержимым на двух уровнях вложенности. Расхождение ожидается на наклонных кромках. Уточнить после первого прогона фактическим числом."
}
```

`fixtures/blend-isolated/threshold.json`:

```json
{
  "maxDiffPixels": 200,
  "maxDiffRatio": 0.002,
  "reason": "Наложение внутри изолирующей группы. Расхождение ожидается только на кромках. Уточнить после первого прогона фактическим числом."
}
```

Добавить все три в `FIXTURES` в `tests/e2e/pixel-diff.spec.ts`.

- [ ] **Step 5: Переписать тесты диагностик**

Тесты `group-effects`, `transform-nested` и `blend-isolated` в `tests/e2e/diagnostics.spec.ts` утверждали наличие диагностик. Теперь они обязаны утверждать **отсутствие** — и это не формальная замена: если диагностика осталась, значит обходчик всё ещё считает случай непереносимым, а гейт при этом зелёный, и одно из двух утверждений лжёт.

- [ ] **Step 6: Регенерировать снапшоты и разобрать диффы**

Run: `pnpm build:serializer && UPDATE_SNAPSHOTS=1 pnpm test:e2e && pnpm test:e2e`

**Изменятся все 85 снапшотов** — `rect` сменил смысл у каждого узла глубже корня. Это единственная ожидаемая причина; если в диффе окажется что-то ещё, разберись до того, как коммитить.

Если фикстура не проходит бюджет, смотри карту диффа, а не число. Вероятные причины: содержимое группы уехало вдвое — смещение сложено дважды; группа повернулась вокруг не той точки — `groupAttrs` считает точку отсчёта от уже смещённого прямоугольника; потомки полупрозрачной группы просвечивают — прозрачность не снята с самого узла.

- [ ] **Step 7: Вписать измеренные числа в пороги**

Заменить «уточнить после первого прогона» измеренным максимумом по пяти ширинам в каждом из трёх файлов. Порог не поднимать.

- [ ] **Step 8: Проверить, что гейт видит регрессию**

Вернуть плоскую отрисовку: в `renderSubtree` отдавать `own + descendants` всегда, игнорируя `isStackingContext`. Все три новые фикстуры обязаны упасть. Вернуть.

- [ ] **Step 9: Коммит**

```bash
git add packages/ir packages/serializer tests fixtures
git commit -m "feat: групповые эффекты действуют на поддерево, четыре диагностики сняты"
```

---

## Task 5: Полный прогон, документация, база знаний

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

Удаление `*.tsbuildinfo` обязательно: `tsc -b` доверяет кешу и не проверяет наличие `dist`, из-за чего без удаления `pnpm typecheck` молча ничего не делает. Найдено финальным прогоном плана 1.

- [ ] **Step 2: Снять фикстуры глазами**

```bash
pnpm capture fixtures/group-effects/index.html
pnpm capture fixtures/transform-nested/index.html
```

Сравнить `out/page.png` и `out/render.png`. Числа говорят «сколько», картинка — «что именно». Если расхождение в бюджете, но размазано по площади, а не лежит на кромках — перенос неверен, а бюджет велик.

- [ ] **Step 3: Обновить README**

Четыре случая переезжают из «диагностируется» в «переносится». Обновить числа тестов и фикстур фактическими. Явно сказать, что `rect` теперь в координатах родителя и версия IR стала 2.

- [ ] **Step 4: Обновить базу знаний**

Страница `wiki/pages/concepts/group-effects.md` описывает класс дефекта как открытый — переписать: класс закрыт, вот чем. Добавить страницу о системе координат: почему локальные, как восстанавливаются под трансформами предков, почему вложенный рендеринг возможен только благодаря непрерывности диапазонов `paintOrder`.

Обновить `support-boundaries.md`, `pixel-diff-gate.md`, `fixture-suite.md`, `ir-bundle.md` (версия 2 и смысл `rect`), запись в `log.md`.

- [ ] **Step 5: Коммит**

```bash
git add README.md wiki
git commit -m "docs: система координат родителя, класс групповых эффектов закрыт"
```

---

## Проверка готовности плана

- [ ] `pnpm test` проходит от чистой установки, включая удаление `*.tsbuildinfo`
- [ ] Версия IR поднята до 2, и в `types.ts` записано, чем редакции различаются
- [ ] `fixtures/group-effects`, `transform-nested`, `blend-isolated` входят в pixel-diff с **измеренными** порогами
- [ ] Диагностики `transform-descendant`, `blur-descendant`, `opacity-group`, `blend-isolation` больше не порождаются, а их коды сохранены с пометкой
- [ ] Для каждой снятой диагностики отвечено, что она прикрывала, и ничего не осталось необъяснённым
- [ ] Плоская отрисовка возвращена сломом, и все три фикстуры упали
- [ ] Ни одного `any`: `grep -rn ": any\|as any" packages/ tests/ scripts/` пусто
- [ ] Обе фикстуры просмотрены глазами через `pnpm capture`

## Что этот план сознательно не делает

Изображения и ассеты, ZIP-бандл, радиальные и конические градиенты, фоновое размытие, векторы, псевдоэлементы, сдвиг, трёхмерные трансформы, что-либо внутри Figma, расширение Chrome, компоненты и токены.
