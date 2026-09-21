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
  /** ИСПРАВЛЕНО в плане 3 (`rect` в координатах родителя, вложенные
   *  группы в референс-рендерере) и с этого момента не порождается.
   *  Код сохранён — не удалён — потому что коды диагностик стабильны:
   *  бандл прошлой редакции IR (версия 1) мог нести этот код, и
   *  читающая сторона обязана уметь его распознать при работе со
   *  старыми бандлами.
   *
   *  Раньше: узел лежал внутри трансформированного предка. Сам предок
   *  переносился верно, а вот потомок — нет: его `rect` снимался как
   *  осепараллельный габарит УЖЕ повёрнутого элемента, потому что
   *  `getBoundingClientRect()` включает трансформы предков.
   *
   *  Код появился как исправление честности, а не геометрии. Пока
   *  трансформы были отложены, родитель нёс `deferred.transform`, и
   *  инвариант заставлял бандл объяснить, что поддерево не
   *  перенесено. Когда родитель стал переноситься верно, объяснение
   *  исчезло, а неверность потомков осталась — то есть улучшение
   *  корректности породило молчаливую потерю. */
  transformDescendant: 'fidelity.transform-descendant',
  /** ИСПРАВЛЕНО в плане 3. Не порождается; сохранён по той же причине,
   *  что и `transformDescendant`.
   *
   *  Раньше: узел с режимом наложения лежал внутри ИЗОЛИРУЮЩЕЙ группы.
   *
   *  В CSS наложение композитит с подложкой в пределах ближайшей
   *  изолирующей группы, а референс-рендерер плющил дерево в плоский
   *  список и границ изоляции не имел вовсе — он смешивал со всем,
   *  что нарисовано раньше. Измерено на зонде: элемент с
   *  `mix-blend-mode: multiply` внутри `isolation: isolate` в браузере
   *  оставался своим цветом, а у нас чернел.
   *
   *  Как и `transformDescendant`, код появился из-за того, что
   *  реализация фичи сняла общую диагностику `deferred.blend`,
   *  прикрывавшую заодно и этот случай. */
  blendIsolation: 'fidelity.blend-isolation',
  /** ИСПРАВЛЕНО в плане 3. Не порождается; сохранён по той же причине,
   *  что и `transformDescendant`.
   *
   *  Раньше: узел лежал внутри размытого предка. `filter: blur()` в
   *  CSS размывает элемент ВМЕСТЕ с поддеревом, а плоский рендерер
   *  вешал фильтр только на сам узел, и потомки оставались резкими.
   *  Измерено зондом: 2362 расходящихся пикселя.
   *
   *  Остаточный случай, который код НЕ покрывает и для которого
   *  диагностика осталась активной: потомок предка с НЕподдерживаемой
   *  трансформой (`skew`, 3D) — она не входит в накопленную матрицу
   *  предков, поэтому `rect` такого потомка снимается от уже искажённого
   *  бокса. См. `fidelity.transform-descendant`-подобный случай,
   *  фикстуру `broken-transform` (вне гейта) и [[group-effects]] в вики. */
  blurDescendant: 'fidelity.blur-descendant',
  /** ИСПРАВЛЕНО в плане 3. Не порождается; сохранён по той же причине,
   *  что и `transformDescendant`.
   *
   *  Раньше: узел лежал внутри полупрозрачного предка. `opacity < 1`
   *  применялась к группе целиком: браузер сначала рисовал поддерево,
   *  затем композитил его как единое целое. Плоский рендерер применял
   *  прозрачность к каждому узлу отдельно, из-за чего перекрывающиеся
   *  потомки просвечивали друг через друга. Измерено зондом: 6000
   *  расходящихся пикселей при пустом отчёте. Дефект молчал с плана 1:
   *  в фикстуре boxes у полупрозрачного блока нет детей. */
  opacityGroup: 'fidelity.opacity-group',
} as const

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES]

export const ALL_DIAGNOSTIC_CODES: readonly DiagnosticCode[] =
  Object.values(DIAGNOSTIC_CODES)
