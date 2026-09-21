# html2design

A tool that will eventually snapshot a page open in someone's browser — with
their auth and current UI state — into an editable Figma layout: five screens
for different breakpoints plus a component library.

**What exists right now is only the fidelity engine, not that tool.** There is
no Chrome extension, no way to capture a real tab at five widths, no `.h2d`
ZIP bundle, and nothing runs inside Figma yet. What you can actually do today:
serialize a static HTML file to an IR document with a real headless Chrome,
validate that IR, render it back to SVG, and diff the two automatically —
now including linear gradients, 2D transforms, blend modes, and layer blur,
none of which existed one plan ago. That engine, and the test harness that
proves it tells the truth, is plans 1 and 2 of 5. Plans 3–5 (an asset
pipeline and the `.h2d` ZIP bundle, the Figma plugin, the Chrome extension)
have not been started. See [What is transferred](#what-is-transferred-and-what-is-deferred)
below for the precise, checked boundary — some fidelity gaps are known and
diagnosed rather than silently wrong, and one of them (group CSS effects on
element subtrees) is a real limitation worth reading before you rely on this.

Design doc: `docs/superpowers/specs/2026-09-19-html2design-design.md`
Knowledge base: `wiki/index.md` (read this before digging through the code —
it has the reasoning behind decisions that aren't obvious from the diff)

## Requirements

Node 20 or newer, pnpm.

## Install

    pnpm install
    pnpm exec playwright install chromium

## Verify

    pnpm build:serializer   # builds the IIFE bundle other steps inject into pages
    pnpm test                # typecheck + typecheck:root + unit tests + e2e

`pnpm test` runs, in order: `tsc -b` over `packages/ir`, `packages/serializer`,
`packages/reference-renderer`; `tsc -p tsconfig.json` over `tests/` (so the
test code is typechecked, not just transpiled); the Vitest unit suite; the
Playwright e2e suite. On a clean checkout it currently passes **215 unit
tests** and **171 e2e tests**, all green.

A from-scratch run — the one that actually exercises `pnpm install` and a
fresh Chromium download, not just cached `dist/` output — is:

    rm -rf node_modules packages/*/dist packages/*/node_modules \
           packages/*/tsconfig.tsbuildinfo test-results out
    pnpm install
    pnpm exec playwright install chromium
    pnpm typecheck
    pnpm build:serializer
    pnpm test

Deleting `packages/*/tsconfig.tsbuildinfo` is not optional — see the note in
the `capture` section below for why skipping it makes `pnpm typecheck` a
silent no-op.

Run pieces individually while iterating:

    pnpm typecheck
    pnpm typecheck:root
    pnpm test:unit
    pnpm build:serializer && pnpm test:e2e

## `capture` — the debugging tool

    pnpm typecheck && pnpm build:serializer
    node scripts/capture.mjs fixtures/boxes/index.html
    node scripts/capture.mjs https://example.com 1440 900

Both build steps matter: `build:serializer` produces the IIFE bundle that
gets injected into the page, and `typecheck` (`tsc -b`) is what actually
emits `packages/ir/dist` and `packages/reference-renderer/dist` — plain Node
can't import `.ts` directly, unlike Vitest/Playwright's tests, which resolve
`@h2d/ir` and `@h2d/reference-renderer` straight to source. If you deleted
`dist/` by hand without also deleting the sibling `*.tsbuildinfo` files,
`tsc -b` will trust the stale cache and skip rebuilding — `capture.mjs` now
fails with a message telling you to remove `packages/*/tsconfig.tsbuildinfo`
and rerun `pnpm typecheck` rather than a bare `ERR_MODULE_NOT_FOUND`.

Opens the target in headless Chrome, injects the built serializer, captures
one screen, renders that same IR back to SVG, and writes to `out/`:

- `ir.json` — the captured `Screen` and diagnostic report
- `page.png` — what the browser actually drew
- `render.svg` / `render.png` — what the reference renderer made of the IR

It also runs the captured bundle through the `@h2d/ir` validator and prints a
report summary (diagnostic codes, counts, node kinds) plus the validator's
verdict. This is the fastest way to see what the serializer saw on any page —
including your own — without going anywhere near Figma. Compare `page.png`
against `render.png` by eye; that comparison is exactly what the pixel-diff
gate below automates for the fixtures.

## How the correctness check works

Two independent layers, run by Playwright against a real Chrome for every
fixture at five widths (1920 / 1440 / 1024 / 768 / 390):

1. **IR snapshot** (`tests/e2e/fidelity.spec.ts`) — the captured IR is
   compared against a committed reference in `fixtures/<name>/ir/<width>.json`.
   Catches regressions in what the serializer produces.
2. **Pixel-diff gate** (`tests/e2e/pixel-diff.spec.ts`) — the IR is rendered
   back to SVG by `@h2d/reference-renderer`, screenshotted, and compared
   pixel-for-pixel against a screenshot of the same page in the browser via
   `pixelmatch`. This is the layer that actually proves something: it shows
   the IR describes what the browser drew, not just that the serializer is
   internally consistent with its own snapshot.

Only 8 of the 17 fixtures (`boxes`, `stacking`, `flex`, `text`, `gradient`,
`transformed`, `blend`, `blur`) go through the pixel-diff gate. The other 9
are deliberately excluded, each for its own reason:

- `radial-gradient`, `blend-isolated`, `transform-nested`, `group-effects` —
  the feature they exercise is either not implemented (radial/conic
  gradients — SVG has no conic gradient at all, so the gate has no way to
  check one) or implemented only on the node itself and not its subtree (see
  [the group-effects gap](#what-is-transferred-and-what-is-deferred) below).
  Their rendered output is *supposed* to be wrong, and a threshold tuned to a
  known-wrong render would be a lie in a checklist. They're asserted at the
  diagnostic level in `tests/e2e/diagnostics.spec.ts` instead — the test
  confirms the discrepancy is explained, not that it's absent.
- `inline-text`, `missing-font`, `text-transform`, `absolute-in-flex` exercise
  the same renderer branches as `text`/`flex` and add nothing the gate would
  catch differently; `dashed-border` exercises a branch the renderer
  deliberately approximates (`border-style: double` collapses to solid).

Six of the eight gated fixtures — `boxes`, `stacking`, `flex`, `gradient`,
`blend`, `blur` — currently match **pixel for pixel** (0 differing pixels at
every width). `text` has a measured maximum of 633 differing pixels, from
single-pixel glyph edges that the same Chromium rasterizes slightly
differently in the page markup versus an `<text>` element. `transformed` is 0
at four of five widths and 94 at the narrowest — measured to be Blink's pixel
snapping on a scaled block, not antialiasing (see
`wiki/pages/entities/gradients-and-transforms.md`).

All four features added by the CSS-paint-completion plan (gradients,
transforms, blend modes, blur) were expected, in the plan that specified
them, to show measurable rasterization differences between the CSS path and
the SVG path — coarse budgets were sketched in advance for exactly that. None
of the four differences materialized: Chromium runs the CSS feature and its
SVG equivalent through the same internal pipeline in every case, so the
actual numbers above are near-zero, and the pre-written budgets would have
been empty gates. The lesson that stuck: **write the budget from a
measurement, not from a guess about where two rendering paths might
diverge** — the guesses were wrong all four times, in the same direction.

Each threshold lives in `fixtures/<name>/threshold.json` and has two numbers,
in priority order:

- `maxDiffPixels` — an **absolute pixel budget**. This is the metric that
  matters. A ratio alone doesn't: 1234 wrong pixels on a roughly-megapixel
  screenshot is about 0.1%, which passes almost any relative threshold you'd
  pick, and measurement during this plan showed a ratio-only gate would have
  missed three of the six real defects found while building it.
- `maxDiffRatio` — a secondary guard for damage smeared across the whole
  image, which an absolute pixel count wouldn't necessarily catch.

Each `threshold.json` also carries a `reason` field explaining, in words,
where the number came from. **Thresholds are not raised to make CI pass.** If
a fixture starts failing, the fix is to find and fix the actual discrepancy;
a threshold only moves when there's a physical reason (rasterization
differences between an SVG filter and a CSS box-shadow, font metrics on the
system running the test, etc.) written into that `reason` field.

To intentionally change behavior and update the committed snapshots:

    UPDATE_SNAPSHOTS=1 pnpm test:e2e

Then read the diff by eye before committing — a snapshot records whatever
behavior it was generated from, wrong or right, forever.

## The project's one rule

**A silent fallback is a bug.** Any construct the serializer doesn't fully
support must produce a `Diagnostic` in the bundle's `report`, and, where the
feature would otherwise disappear, a visible placeholder node instead of an
empty box. This isn't just a convention — `packages/ir/src/invariants.ts`
enforces it mechanically on every bundle: it checks that every `placeholder`
node has a matching diagnostic that names it, that every node carrying a
still-deferred feature (background blur, `kind: 'vector'`) has its matching
`deferred.*` diagnostic, that `paintOrder` is a dense 0..n-1 permutation per
screen, that node/asset/screen ids are unique across the whole bundle (not
just per screen), that every `assetId` and `screenshotId` and diagnostic
`nodeId`/`screenId` actually resolves to something in the bundle, and that a
text node's `runs` and `lines` concatenate to the same string. Diagnostic
codes themselves live in `@h2d/ir` (`packages/ir/src/codes.ts`), not in the
serializer, because the (not-yet-built) Figma plugin needs to know them too
and can't import from the serializer package.

This rule is also why a real, diagnosed limitation is documented below rather
than hidden: transforms, blend modes, blur, and `opacity` all transfer
correctly onto the node they're set on, but not correctly onto that node's
descendants — see [What is transferred](#what-is-transferred-and-what-is-deferred).

The second rule, learned by doing it wrong first: **verify a check by
breaking what it checks.** Every non-trivial guard in this codebase — every
pixel-diff threshold, every invariant, `typecheck:root`, a couple of the e2e
assertions — was at some point disabled or fed a deliberately wrong input to
confirm it actually fails. Several checks turned out to prove nothing on
first write, and every one of them was green when it was found.
`wiki/pages/concepts/correctness-strategy.md` and `wiki/log.md` have the
running list (the internal-shadow, baseline-shift, and stale-`tsbuildinfo`
cases are the sharpest examples).

A related rule, learned twice in the plan that added transforms/blend/blur:
**implementing a deferred feature can retire a diagnostic that happened to
also cover a neighboring, still-unimplemented case.** Both times, correctness
improved and honesty broke at the same time, and it was only caught by asking
directly what the removed diagnostic used to explain. See
`wiki/pages/concepts/group-effects.md`.

## What is transferred and what is deferred

**Transferred and checked by pixel-diff:** geometry; solid fills; linear
gradients; 2D transforms (`rotate`/`scale`/`translate`, decomposed from
`matrix()` — no `skew`); blend modes (`mix-blend-mode`); layer blur
(`filter: blur()`); `opacity`; borders, including per-side width and
`dashed`/`dotted` style; corner radii; drop shadows, outer and inner;
`overflow: hidden` as `clipsContent`; typography (family, size, weight,
line-height, letter-spacing, alignment, decoration, `text-transform`,
`text-shadow`); `display: flex`/`grid` as auto-layout; open shadow DOM;
same-origin iframes, recursively.

**One caveat that applies to four of those entries.** Transform, blur,
blend, and `opacity` are *group effects* in CSS: the browser paints an
element's subtree as a unit, then applies the effect to that unit. This
renderer flattens the node tree into a flat paint list and applies each
effect only to the node it's set on — so a node's own geometry is correct,
but its descendants come out wrong wherever one of these effects sits above
them (rotated children not rotated, blurred children not blurred, opacity
not composited as a group, blended content not respecting an isolating
group's boundary). This is diagnosed — `fidelity.transform-descendant`,
`fidelity.blur-descendant`, `fidelity.blend-isolation`,
`fidelity.opacity-group` — not silently wrong, but it is **not fixed**.
Fixing it means storing each node's `rect` in coordinates local to its
parent and composing effects down the tree at render time, which changes
what `rect` means for every consumer of the format; that's plan 3's work,
alongside the asset/coordinate work it already needs to do. Full writeup:
`wiki/pages/concepts/group-effects.md`.

**Deferred, and every instance is diagnosed rather than dropped:** radial and
conic gradients (SVG has no conic gradient at all, so the pixel-diff gate has
no way to check one — an unverifiable feature ships silently wrong, so it's
excluded on principle, not effort; radial is technically renderable and will
likely land with plan 3's asset work); `backdrop-filter` (the renderer
flattens the tree, so "whatever is behind the element" doesn't exist for it
to sample); images and other binary assets; vector nodes (`kind: 'vector'`);
pseudo-elements; `repeating-*` gradients; `skew` and 3D transforms (Figma has
no equivalent for either).

**Not supported, placeholder + diagnostic, no plan to add:** `<canvas>` and
WebGL; cross-origin iframes; closed shadow DOM; `clip-path` and CSS masks;
SVG filters; any `filter` other than blur; custom scrollbars;
`:hover`/`:focus`/`:active` states; animations and transitions — this tool
captures one frame.

## Fixtures

```
fixtures/<name>/index.html          self-contained, file:// — no network, no web fonts
fixtures/<name>/ir/<width>.json     committed IR snapshot, one per width
fixtures/<name>/threshold.json      pixel-diff budget + reason (only for the 8 gated fixtures)
```

17 fixtures total: `boxes`, `stacking`, `flex`, `text`, `transformed`,
`transform-nested`, `gradient`, `radial-gradient`, `inline-text`,
`absolute-in-flex`, `missing-font`, `dashed-border`, `text-transform`,
`blend`, `blend-isolated`, `group-effects`, `blur`. Each has 5 committed IR
snapshots (one per width), 85 in total. `tests/e2e/diagnostics.spec.ts`
asserts, per fixture, that a specific set of diagnostic codes is present —
phrased positively ("this code must appear") rather than negatively, because
"no unexpected diagnostics" is a weak assertion and "the expected one is
there" is the actual test of the no-silent-fallback rule.

## Repository layout

```
packages/ir                       IR types, zod schema, semantic invariants, diagnostic codes
packages/serializer               DOM → IR, runs inside the captured page, builds to an IIFE
packages/serializer/src/css/      pure parsers: color, length, shadow, gradient, transform
packages/reference-renderer       IR → SVG, used by the pixel-diff gate and by scripts/capture.mjs
fixtures/                         HTML fixtures + committed IR snapshots + pixel-diff thresholds
tests/e2e/                        Playwright: fidelity snapshots, diagnostics, pixel-diff
scripts/capture.mjs               debugging tool, see above
```

`packages/extension` and `packages/figma-plugin`, named in the design doc's
target architecture, do not exist yet — the plugin is plan 4's work, the
Chrome extension plan 5's.

## Type discipline

No `any` anywhere in `packages/` or `tests/`:

    grep -rn ": any\|as any" packages/ tests/

is expected to return nothing. TypeScript strict mode plus
`noUncheckedIndexedAccess` are on project-wide.

## Where to go next

Start at `wiki/index.md` for the reasoning behind the architecture and the
IR contract — it links out to pages on stacking/paint order, why the Figma
REST API forced a two-plugin architecture, font-availability detection
pitfalls, the pixel-diff gate's own history, the geometry behind gradients
and transforms, and the group-effects limitation described above. `wiki/log.md`
has the chronological record of what was tried, what broke, and why.
