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
  selfLayout: {
    positioning: 'flow', align: null, grow: 0, shrink: 1,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    marginAuto: { horizontal: false, vertical: false },
  },
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
