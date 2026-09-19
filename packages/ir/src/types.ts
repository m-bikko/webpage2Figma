import type { IrVersion } from './version.js'

export type Rgba = { r: number; g: number; b: number; a: number }

export type Rect = { x: number; y: number; w: number; h: number }

export type Sides = { top: number; right: number; bottom: number; left: number }

export type Corner = { tl: number; tr: number; br: number; bl: number }

export type ImageFit = 'fill' | 'fit' | 'tile'

export type Fill =
  | { kind: 'solid'; color: Rgba }
  | { kind: 'image'; assetId: string; fit: ImageFit }

export type Stroke = { color: Rgba; weight: Sides }

export type Shadow = {
  kind: 'outer' | 'inner'
  color: Rgba
  offsetX: number
  offsetY: number
  blur: number
  spread: number
}

export type NodeStyle = {
  fills: Fill[]
  stroke: Stroke | null
  corner: Corner
  shadows: Shadow[]
  opacity: number
  clip: boolean
}

export type LayoutMode = 'row' | 'column' | 'none'
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type LayoutJustify =
  | 'start' | 'center' | 'end'
  | 'space-between' | 'space-around' | 'space-evenly'

export type NodeLayout = {
  mode: LayoutMode
  gap: number
  padding: Sides
  align: LayoutAlign
  justify: LayoutJustify
  wrap: boolean
}

export type TextDecoration = 'none' | 'underline' | 'strikethrough'
export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type TextRun = {
  text: string
  fontFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  fontSize: number
  lineHeight: number
  letterSpacing: number
  color: Rgba
  decoration: TextDecoration
  align: TextAlign
}

/** Реальный бокс строки, снятый через Range.getClientRects().
 *  Figma переносит строки сама и почти наверняка иначе, чем браузер,
 *  поэтому места переносов фиксируются явно. */
export type LineBox = { x: number; y: number; w: number; h: number; text: string }

export type NodeText = { runs: TextRun[]; lines: LineBox[] }

export type IrNode = {
  id: string
  sourceTag: string
  name: string
  /** Абсолютные координаты документа, не вьюпорта. */
  rect: Rect
  /** Порядок отрисовки браузера, НЕ порядок DOM. */
  paintOrder: number
  layout: NodeLayout
  style: NodeStyle
  text: NodeText | null
  image: { assetId: string; fit: ImageFit } | null
  children: IrNode[]
}

export type DiagnosticLevel = 'info' | 'warning' | 'error'

export type Diagnostic = {
  level: DiagnosticLevel
  code: string
  message: string
  nodeId: string | null
  screen: string | null
}

export type Screen = {
  name: string
  width: number
  height: number
  dpr: number
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
