import type {
  AppliedImagePaint, FigmaRgba, ScenePaint, SceneEffect, SceneStroke,
} from './scene.js'

/** Проверка форм КОМПИЛЯТОРОМ против официальных типов Figma.
 *
 *  Файл не содержит кода — только утверждения о типах. Он существует
 *  потому, что применитель непроверяем запуском: Figma не стартует ни
 *  в CI, ни у разработчика, и структуры, «похожие» на нужные,
 *  выглядели правильными до самого запуска у пользователя. Там они и
 *  обрушились — присваивание чужой формы отвергается, и код падал на
 *  самом глубоком узле, оставляя уже созданные фигуры висеть на
 *  странице без родителей.
 *
 *  `@figma/plugin-typings` — внешний источник истины, ровно как
 *  документация. Если наша форма разойдётся с ней, это станет ошибкой
 *  КОМПИЛЯЦИИ, а не сюрпризом в чужой Figma. */

/** Утверждение «A присваивается B». Разворачивается в ошибку типов,
 *  если это не так, и ничего не весит в рантайме. */
type Assert<A extends B, B> = A

/** Краска-изображение несёт НАШ `assetId`: хеш Figma известен только
 *  внутри Figma, и подставляется он в последний момент, в применителе.
 *  Поэтому в утверждение входят краски, уезжающие в Figma как есть, а
 *  форма картинки проверяется отдельно — по тому, во что её переводит
 *  `withImageHashes`. */
type _PaintIsFigmaPaint = Assert<Exclude<ScenePaint, { type: 'IMAGE' }>, Paint>
type _EffectIsFigmaEffect = Assert<SceneEffect, Effect>
type _StrokePaintIsFigmaPaint = Assert<SceneStroke['paint'], Paint>
type _RgbaIsFigmaRgba = Assert<FigmaRgba, RGBA>
/** Краска-изображение после подстановки хеша. */
type _AppliedImageIsFigmaPaint = Assert<AppliedImagePaint, Paint>

/** Обратное направление для цвета: наша форма обязана быть НЕ шире
 *  фигмовской, иначе лишнее поле уедет в присваивание. */
type _FigmaRgbaIsOurs = Assert<RGBA, FigmaRgba>

/** `createNodeFromSvg` существует и принимает строку, отдавая рамку.
 *
 *  Утверждение не косметическое: применитель вызывает её на КАЖДОМ
 *  векторе, а промах по имени или по форме в Figma выглядит как
 *  «not a function» глубоко в рекурсии — ровно та ошибка, из-за
 *  которой этот файл и заведён. Здесь она становится ошибкой
 *  компиляции. */
type _CreateNodeFromSvgExists =
  Assert<typeof figma.createNodeFromSvg, (svg: string) => FrameNode>

/** Возвращённая рамка обязана нести то, что применитель у неё читает
 *  и чем пользуется: размер для сверки и `appendChild` для детей. */
type _SvgFrameHasSize = Assert<FrameNode['width'], number>
type _SvgFrameAppends = Assert<FrameNode['appendChild'], (child: SceneNode) => void>

export type FigmaShapeAssertions = [
  _PaintIsFigmaPaint, _EffectIsFigmaEffect,
  _StrokePaintIsFigmaPaint, _RgbaIsFigmaRgba, _FigmaRgbaIsOurs,
  _AppliedImageIsFigmaPaint,
  _CreateNodeFromSvgExists, _SvgFrameHasSize, _SvgFrameAppends,
]
