import type { Corner, DiagnosticCode, Sides } from '@w2f/ir'

/** Описание сцены Figma.
 *
 *  Намеренно ОПИСАНИЕ, а не набор команд или замыканий. Описание можно
 *  сравнить в тесте, собрать обратно в IR для кругового обхода и
 *  прочитать глазами в багрепорте; набор замыканий не даёт ничего из
 *  этого. Вся логика живёт в строителе, который его порождает, а
 *  применитель обязан быть механическим перебором — любое вычисление
 *  в нём означает, что кусок логики ускользнул из проверяемой части. */

/** Цвет краски: доли `0..1`, альфа ОТДЕЛЬНО.
 *
 *  Разведение не косметическое и не наше: `SolidPaint.color` в Figma
 *  действительно не имеет альфы, она живёт в `opacity` краски. Сложить
 *  их обратно нельзя — у узла есть ещё собственная непрозрачность,
 *  которая на неё домножается.
 *
 *  А вот у ТЕНЕЙ и у остановок градиента альфа входит В ЦВЕТ (`RGBA`).
 *  Формы разные, и держать одну на всё нельзя: применитель присваивает
 *  их напрямую, и Figma отвергает чужую форму. Так и случилось при
 *  первом запуске — код падал на присваивании, оставляя созданные узлы
 *  висеть на странице без родителей. */
export type FigmaColor = { r: number; g: number; b: number }

/** Цвет с альфой внутри — форма `RGBA` из Figma. */
export type FigmaRgba = { r: number; g: number; b: number; a: number }

export type ScenePaint =
  | { type: 'SOLID'; color: FigmaColor; opacity: number }
  | {
      type: 'GRADIENT_LINEAR'
      /** Матрица, а не пара концов: Figma задаёт градиент именно так.
       *  Наш контракт держит концы (план 2 выбрал их ровно потому, что
       *  «Figma задаёт градиент матрицей, а не углом»), и перевод
       *  делается здесь. */
      /** Изменяемый кортеж, а не `readonly`: `Transform` в Figma
       *  объявлен изменяемым, и readonly-версия туда не присваивается.
       *  Мелочь, которую видит только компилятор. */
      gradientTransform: [[number, number, number], [number, number, number]]
      /** Альфа входит В ЦВЕТ: `ColorStop.color` — это `RGBA`. */
      gradientStops: { position: number; color: FigmaRgba }[]
    }
  | {
      /** Радиальный. Форма та же, что у линейного, и это не совпадение:
       *  Figma задаёт оба одной матрицей, отличается лишь то, что она
       *  размещает — отрезок или единичный круг. */
      type: 'GRADIENT_RADIAL'
      gradientTransform: [[number, number, number], [number, number, number]]
      gradientStops: { position: number; color: FigmaRgba }[]
    }
  | {
      type: 'IMAGE'
      assetId: string
      scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
      /** Только для `TILE`. Для остальных режимов размещение выражено
       *  ГЕОМЕТРИЕЙ прямоугольника — см. `paint.ts`. */
      scalingFactor?: number
    }

export type SceneStroke = {
  /** Краска обводки — обычный `SolidPaint`, а не наша выдумка: в Figma
   *  `strokes` принимает массив красок, и толщина в краску не входит. */
  paint: { type: 'SOLID'; color: FigmaColor; opacity: number }
  /** Толщина ПО СТОРОНАМ, а не одним числом. Figma это умеет
   *  (`IndividualStrokesMixin`), в отличие от SVG, где одиночная
   *  обводка имеет одну ширину на весь путь и референс-рендереру
   *  приходится рисовать кольцо. Сводить к максимуму здесь было бы
   *  потерей, а не вынужденным упрощением. */
  weight: Sides
  /** Пустой массив — сплошная линия. Шаги согласованы с тем, что
   *  рисует референс-рендерер: иначе круговой обход поймает
   *  расхождение, и будет прав. */
  dashPattern: number[]
}

/** Формы взяты из официальных типов Figma, а не придуманы похожими:
 *  тень несёт `offset` вектором и цвет с альфой внутри, и обязана
 *  объявлять `visible` и `blendMode`. */
export type SceneEffect =
  | { type: 'DROP_SHADOW' | 'INNER_SHADOW'
      color: FigmaRgba; offset: { x: number; y: number }
      radius: number; spread: number
      visible: boolean; blendMode: 'NORMAL' }
  /** `blurType` обязателен в текущем API и угадать его было нельзя —
   *  нашёл компилятор, сверяя с официальными типами. */
  | { type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'
      blurType: 'NORMAL'; radius: number; visible: boolean }

export type SceneText = {
  characters: string
  /** Прогоны применяются диапазонами символов. Границы считаются
   *  строителем, потому что применитель не вычисляет. */
  runs: {
    start: number; end: number
    family: string; style: string
    fontSize: number; letterSpacing: number
    /** Цвет прогона В ВИДЕ ЗАЛИВОК. У текста в Figma нет отдельного
     *  свойства цвета: он задаётся заливкой, и для части строки — через
     *  диапазон символов. Один цвет на весь узел потерял бы выделенные
     *  слова. */
    fills: ScenePaint[]
    decoration: 'none' | 'underline' | 'strikethrough'
  }[]
  lineHeight: number
  align: 'left' | 'center' | 'right' | 'justify'
}

/** Auto-layout, который применитель обязан включить.
 *
 *  Несёт с собой ОЖИДАЕМЫЕ положения детей. Это не избыточность: после
 *  включения auto-layout Figma раскладывает детей сама, и применитель
 *  сверяет её ответ с этими числами. Разошлось — откатывает.
 *
 *  Так снимается последнее допущение: мы не верим, что модель флекса
 *  у Figma совпадает с CSS, мы проверяем это на месте. */
export type SceneAutoLayout = {
  mode: 'HORIZONTAL' | 'VERTICAL'
  itemSpacing: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
  primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX'
  /** Куда обязаны встать дети. Порядок тот же, что у `children`. */
  expected: { x: number; y: number }[]
}

export type SceneBase = {
  /** Идентификатор исходного узла IR. Нужен, чтобы отчёт мог указать
   *  на конкретное место, а круговой обход — сопоставить деревья. */
  id: string
  name: string
  /** Координаты РОДИТЕЛЯ. Совпадает с `relativeTransform` в Figma,
   *  который задаётся относительно родителя-контейнера, поэтому
   *  преобразования координат не требуется вовсе. Это же подтверждает
   *  задним числом решение плана 3 хранить `rect` так. */
  x: number
  y: number
  width: number
  height: number
  /** Градусы. ЗНАК ПРОТИВОПОЛОЖЕН нашему углу: документация Figma
   *  определяет `rotation` как `atan2(-m10, m00)`, а наш угол —
   *  `atan2(b, a)`, где `m10 = b`. Перепутать знак значит получить
   *  зеркальный поворот, который выглядит правдоподобно и не заметен
   *  ни на чём симметричном. */
  rotation: number
  opacity: number
  blendMode: string
  fills: ScenePaint[]
  stroke: SceneStroke | null
  corner: Corner
  effects: SceneEffect[]
  /** `null` означает, что auto-layout навязывать нельзя: либо узел не
   *  флекс-контейнер, либо его раскладка не объясняется флексом.
   *  Причина в таком случае уже в отчёте. */
  autoLayout: SceneAutoLayout | null
  children: SceneNode[]
}

export type SceneNode =
  | { kind: 'frame'; base: SceneBase; clipsContent: boolean }
  | { kind: 'rect'; base: SceneBase }
  | { kind: 'text'; base: SceneBase; text: SceneText }
  /** Вектор едет ИСХОДНЫМ SVG, а не разобранными кривыми: в Figma его
   *  разбирает `figma.createNodeFromSvg` — тот же импортёр, что при
   *  ручной вставке. Свой разборщик пришлось бы сверять с ним, а
   *  сверять нечем. */
  | { kind: 'vector'; base: SceneBase; svg: string }
  | { kind: 'placeholder'; base: SceneBase; label: string; code: DiagnosticCode }

export type SceneScreen = {
  id: string
  name: string
  width: number
  height: number
  root: SceneNode
}

/** Шрифт, который применитель обязан загрузить ДО построения текста.
 *  `loadFontAsync` асинхронен, а строитель чист — поэтому список
 *  извлекается отдельно и грузится заранее. */
export type FontRequest = { family: string; style: string }

export type Scene = {
  screens: SceneScreen[]
  fonts: FontRequest[]
  /** Что осталось догадкой и требует сверки человеком в Figma. Не
   *  украшение: без этого списка непроверяемое выдавалось бы за
   *  проверенное. */
  needsVerification: { code: DiagnosticCode; nodeId: string; message: string }[]
}

/** Краска-изображение В ТОМ ВИДЕ, в каком она уезжает в Figma: наш
 *  `assetId` уже заменён на хеш. Объявлена здесь, чтобы применитель не
 *  зависел от глобальных типов Figma — их видит только файл утверждений
 *  `figma-shapes.ts`, и именно он сверяет эту форму с настоящей. */
export type AppliedImagePaint = {
  type: 'IMAGE'
  imageHash: string
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
  scalingFactor?: number
}
