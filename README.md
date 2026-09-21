# html2design

A tool that will eventually snapshot a page open in someone's browser — with
their auth and current UI state — into an editable Figma layout: five screens
for different breakpoints plus a component library.

**What exists right now is only the fidelity engine, not that tool.** There is
no Chrome extension, no way to capture a real tab at five widths, no `.h2d`
ZIP bundle, and nothing runs inside Figma yet. What you can actually do today:
serialize a static HTML file to an IR document with a real headless Chrome,
validate that IR, render it back to SVG, and diff the two automatically —
now including linear gradients, 2D transforms, blend modes, layer blur, and
(new this plan) all four of those applied correctly to an element's entire
subtree, not just the element itself. That engine, and the test harness that
proves it tells the truth, is plans 1–3 of 7. Plans 4–7 (an asset pipeline
and the `.h2d` ZIP bundle, the Figma plugin, the Chrome extension, then
components and tokens, in that order) have not been started. (Earlier
revisions of this file said "of 5" — the coordinate-system plan is explicit
that the roadmap is 7 plans; that count wasn't settled when this file was
first written.) See [What is transferred](#what-is-transferred-and-what-is-deferred)
below for the precise, checked boundary — some fidelity gaps are known and
diagnosed rather than silently wrong.

**`rect` is parent-relative as of this plan, and the IR format version is 2.**
Every node's `rect` used to hold absolute document coordinates; it now holds
an offset from its parent's `rect` (the screen root is still absolute — there
is no parent to be relative to). The field's *type* didn't change, only what
the numbers inside it mean, so a consumer that reads an old bundle without
checking the version will silently place every nested node at its parent's
offset instead of its own. If you have code reading `.h2d` IR from before this
plan, read [What is transferred](#what-is-transferred-and-what-is-deferred)
and `wiki/pages/concepts/coordinate-system.md` before touching it.

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
Playwright e2e suite. On a clean checkout it currently passes **251 unit
tests** and **193 e2e tests**, all green.

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

11 of the 18 fixtures (`boxes`, `stacking`, `flex`, `text`, `gradient`,
`transformed`, `blend`, `blur`, `group-effects`, `transform-nested`,
`blend-isolated`) go through the pixel-diff gate. The other 7 are
deliberately excluded, each for its own reason:

- `radial-gradient` — the feature isn't implemented at all: SVG has no conic
  gradient, so the gate has no way to check one, and radial is deferred
  alongside it (see [what's deferred](#what-is-transferred-and-what-is-deferred)
  below).
- `broken-transform` — exercises `transform: skewX()`, which is unrenderable
  by construction (Figma has no skew) and is *supposed* to diverge; its job
  is to prove the two descendant nodes under the skewed element carry
  `fidelity.transform-descendant`, not to pass a pixel budget.
  Both fixtures are asserted at the diagnostic level in
  `tests/e2e/diagnostics.spec.ts` instead — the test confirms the discrepancy
  is explained, not that it's absent.
- `inline-text`, `missing-font`, `text-transform`, `absolute-in-flex` exercise
  the same renderer branches as `text`/`flex` and add nothing the gate would
  catch differently; `dashed-border` exercises a branch the renderer
  deliberately approximates (`border-style: double` collapses to solid).

Nine of the eleven gated fixtures — `boxes`, `stacking`, `flex`, `gradient`,
`blend`, `blur`, `group-effects`, `transform-nested`, `blend-isolated` —
currently match **pixel for pixel** (0 differing pixels at every width).
`text` has a measured maximum of 633 differing pixels, from single-pixel
glyph edges that the same Chromium rasterizes slightly differently in the
page markup versus an `<text>` element. `transformed` is 0 at four of five
widths and 94 at the narrowest — measured to be Blink's pixel snapping on a
scaled block, not antialiasing (see
`wiki/pages/entities/gradients-and-transforms.md`).

All four features added by the CSS-paint-completion plan (gradients,
transforms, blend modes, blur) were expected, in the plan that specified
them, to show measurable rasterization differences between the CSS path and
the SVG path — coarse budgets were sketched in advance for exactly that. None
of the four differences materialized: Chromium runs the CSS feature and its
SVG equivalent through the same internal pipeline in every case, so the
actual numbers above are near-zero, and the pre-written budgets would have
been empty gates. The coordinate-system plan repeated this a fifth time on
`group-effects`, `transform-nested`, and `blend-isolated`: wrapping a
subtree's effects in an SVG `<g>` was expected to diverge at least slightly
more than a single flat node (a blurred group's edge is wider than a single
shape's), and it didn't — still 0 pixels, with the 150px budgets in those
three `threshold.json` files standing in as headroom, not as a measured
number. The lesson that stuck: **write the budget from a measurement, not
from a guess about where two rendering paths might diverge** — the guesses
were wrong five times running, in the same direction.

**One of the three new pixel-diff fixtures doesn't actually test what it
looks like it tests.** `blend-isolated` passes the gate whether or not group
effects apply to the subtree correctly — verified by breaking the renderer
(reverting to the old flat paint list) and watching all three new fixtures
re-run: `group-effects` and `transform-nested` immediately failed at every
width, `blend-isolated` stayed green. The fixture's blocks don't overlap
spatially (`.backdrop` ends exactly where `.isolated` begins in normal
document flow), so `mix-blend-mode: multiply` composites against plain white
in both the correct and the broken renderer — the pixel-diff for this
fixture can't distinguish them. The diagnostic-level test still confirms
`fidelity.blend-isolation` isn't produced, and the mechanism itself is proven
by the other two fixtures, but pixel-diff coverage for "blend mode inside an
isolating group" specifically is not doing its job today. See
`wiki/pages/entities/pixel-diff-gate.md` for the full writeup — left as a
documented gap rather than silently patched, since fixing it means changing
fixture geometry outside this plan's stated scope.

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
than hidden: a node under an ancestor with an *unsupported* transform (`skew`,
3D) still inherits that ancestor's geometric error — see
[What is transferred](#what-is-transferred-and-what-is-deferred).

The second rule, learned by doing it wrong first: **verify a check by
breaking what it checks.** Every non-trivial guard in this codebase — every
pixel-diff threshold, every invariant, `typecheck:root`, a couple of the e2e
assertions — was at some point disabled or fed a deliberately wrong input to
confirm it actually fails. Several checks turned out to prove nothing on
first write, and every one of them was green when it was found.
`wiki/pages/concepts/correctness-strategy.md` and `wiki/log.md` have the
running list (the internal-shadow, baseline-shift, stale-`tsbuildinfo`, and
`blend-isolated`-doesn't-catch-its-own-regression cases are the sharpest
examples).

A related rule, learned three times in the plan that added
transforms/blend/blur, and a fourth time in the plan that fixed how they
apply to subtrees: **implementing a fix can retire a diagnostic that happened
to also cover a neighboring, still-broken case.** Each time, correctness
improved and honesty broke at the same time, and it was only caught by asking
directly what the removed diagnostic used to explain. The fourth time, the
answer was descendants of an unsupported-transform ancestor — the diagnostic
was narrowed to exactly that case rather than removed. See
`wiki/pages/concepts/group-effects.md`.

## What is transferred and what is deferred

**Transferred and checked by pixel-diff:** geometry (`rect`, **relative to
the parent's `rect`** as of this plan — see the coordinate-system note at the
top of this file and `wiki/pages/concepts/coordinate-system.md`); solid
fills; linear gradients; 2D transforms (`rotate`/`scale`/`translate`,
decomposed from `matrix()` — no `skew`); blend modes (`mix-blend-mode`);
layer blur (`filter: blur()`); `opacity`; borders, including per-side width
and `dashed`/`dotted` style; corner radii; drop shadows, outer and inner;
`overflow: hidden` as `clipsContent`; typography (family, size, weight,
line-height, letter-spacing, alignment, decoration, `text-transform`,
`text-shadow`); `display: flex`/`grid` as auto-layout; open shadow DOM;
same-origin iframes, recursively.

**Transform, blur, blend, and `opacity` now apply correctly to a node's
entire subtree, not just the node itself.** All four are *group effects* in
CSS: the browser paints an element's subtree as a unit, then applies the
effect to that unit. Through plan 2 this renderer flattened the node tree
into a flat paint list and applied each effect only to the node it was set
on, so descendants came out wrong wherever one of these effects sat above
them. This plan fixed the underlying model instead of patching each case:
`rect` became parent-relative, the serializer recovers each node's
untransformed position under the accumulated matrix of its transformed
ancestors, and the reference renderer stopped being a flat list — a node
that creates a stacking context now becomes an SVG `<g>` carrying its
effects, so they apply to its whole subtree, the way CSS does it. Measured
result: the three fixtures this affects (`group-effects`, `transform-nested`,
`blend-isolated`), previously excluded from pixel-diff because their render
was known-wrong, now pass it at 0 differing pixels on all five widths. The
four diagnostics this used to require (`fidelity.transform-descendant`,
`fidelity.blur-descendant`, `fidelity.blend-isolation`,
`fidelity.opacity-group`) no longer fire for this case — the codes are kept
in `@h2d/ir` for reading old bundles, since diagnostic codes are never
removed once published. Full writeup: `wiki/pages/concepts/group-effects.md`
and `wiki/pages/concepts/coordinate-system.md`.

**One case this fix doesn't and can't cover: descendants of an unsupported
transform.** `skew` and 3D transforms aren't representable in Figma, so
they're never folded into the accumulated ancestor matrix — meaning a node
with `skewX()` still has its own `rect` measured as the axis-aligned bounding
box of the already-skewed element (measured: 18.2 instead of the true 40 on
a 20° skew), and its descendants inherit that error the same way they did
before this plan. `fidelity.transform-descendant` is still produced for
exactly this case; see `fixtures/broken-transform/` (deliberately outside
the pixel-diff gate — its render is supposed to be wrong).

**Deferred, and every instance is diagnosed rather than dropped:** radial and
conic gradients (SVG has no conic gradient at all, so the pixel-diff gate has
no way to check one — an unverifiable feature ships silently wrong, so it's
excluded on principle, not effort; radial is technically renderable and will
likely land with the plan 4 asset work); `backdrop-filter` (the renderer
composes subtrees into groups now, but still has no notion of "whatever is
behind this group" to sample from); images and other binary assets; vector
nodes (`kind: 'vector'`); pseudo-elements; `repeating-*` gradients; `skew`
and 3D transforms (Figma has no equivalent for either).

**Not supported, placeholder + diagnostic, no plan to add:** `<canvas>` and
WebGL; cross-origin iframes; closed shadow DOM; `clip-path` and CSS masks;
SVG filters; any `filter` other than blur; custom scrollbars;
`:hover`/`:focus`/`:active` states; animations and transitions — this tool
captures one frame.

## Fixtures

```
fixtures/<name>/index.html          self-contained, file:// — no network, no web fonts
fixtures/<name>/ir/<width>.json     committed IR snapshot, one per width
fixtures/<name>/threshold.json      pixel-diff budget + reason (only for the 11 gated fixtures)
```

18 fixtures total: `boxes`, `stacking`, `flex`, `text`, `transformed`,
`transform-nested`, `broken-transform`, `gradient`, `radial-gradient`,
`inline-text`, `absolute-in-flex`, `missing-font`, `dashed-border`,
`text-transform`, `blend`, `blend-isolated`, `group-effects`, `blur`. Each
has 5 committed IR snapshots (one per width), 90 in total. `tests/e2e/diagnostics.spec.ts`
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
target architecture, do not exist yet — the asset pipeline and `.h2d` bundle
are plan 4's work, the Figma plugin plan 5's, the Chrome extension plan 6's.

## Type discipline

No `any` anywhere in `packages/` or `tests/`:

    grep -rn ": any\|as any" packages/ tests/

is expected to return nothing. TypeScript strict mode plus
`noUncheckedIndexedAccess` are on project-wide.

## Where to go next

Start at `wiki/index.md` for the reasoning behind the architecture and the
IR contract — it links out to pages on stacking/paint order, why the Figma
REST API forced a two-plugin architecture, font-availability detection
pitfalls, the pixel-diff gate's own history (including the known coverage
gap on `blend-isolated` described above), the geometry behind gradients and
transforms, the parent-relative coordinate system, and the group-effects
class this plan closed. `wiki/log.md` has the chronological record of what
was tried, what broke, and why.
