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
  z.object({ kind: z.literal('gradient'), gradient }),
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
  mode: z.enum(['row', 'column', 'grid', 'none']),
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
  margin: sides,
  marginAuto: z.object({ horizontal: z.boolean(), vertical: z.boolean() }),
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
