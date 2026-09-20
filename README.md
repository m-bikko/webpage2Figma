# html2design

A tool that will eventually snapshot a page open in someone's browser — with
their auth and current UI state — into an editable Figma layout: five screens
for different breakpoints plus a component library.

**What exists right now is only the fidelity engine, not that tool.** There is
no Chrome extension, no way to capture a real tab at five widths, no `.h2d`
ZIP bundle, and nothing runs inside Figma yet. What you can actually do today:
serialize a static HTML file to an IR document with a real headless Chrome,
validate that IR, render it back to SVG, and diff the two automatically. That
engine — and the test harness that proves it tells the truth — is plan 1 of 4.
Plans 2–4 (Chrome extension, Figma plugin, component/token extraction) have
not been started.

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
Playwright e2e suite. On a clean checkout it currently passes **162 unit
tests** and **95 e2e tests**, all green.

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

Only 4 of the 11 fixtures (`boxes`, `stacking`, `flex`, `text`) go through the
pixel-diff gate. `transformed` and `gradient` are deliberately excluded —
transforms and gradients are not implemented in this plan, so their rendered
output is *supposed* to be wrong, and a threshold tuned to a known-wrong
render would be a lie in a checklist. Those two, and the rest of the eleven,
are asserted at the IR/diagnostic level instead (see below). Three of the
four diffed fixtures — `boxes`, `stacking`, `flex` — currently match **pixel
for pixel** (0 differing pixels at every width). `text` has a measured
maximum of 633 differing pixels, from single-pixel glyph edges that the same
Chromium rasterizes slightly differently in the page markup versus an
`<text>` element.

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
still-deferred feature (`transform`, `blend`, `blur`, `kind: 'vector'`) has
its matching `deferred.*` diagnostic, that `paintOrder` is a dense 0..n-1
permutation per screen, that node/asset/screen ids are unique across the
whole bundle (not just per screen), that every `assetId` and `screenshotId`
and diagnostic `nodeId`/`screenId` actually resolves to something in the
bundle, and that a text node's `runs` and `lines` concatenate to the same
string. Diagnostic codes themselves live in `@h2d/ir` (`packages/ir/src/codes.ts`),
not in the serializer, because the (not-yet-built) Figma plugin needs to know
them too and can't import from the serializer package.

The second rule, learned by doing it wrong first: **verify a check by
breaking what it checks.** Every non-trivial guard in this codebase — every
pixel-diff threshold, every invariant, `typecheck:root`, a couple of the e2e
assertions — was at some point disabled or fed a deliberately wrong input to
confirm it actually fails. Several checks in this plan turned out to prove
nothing on first write, and every one of them was green when it was found.
`wiki/pages/entities/pixel-diff-gate.md` and `wiki/log.md` have the specifics
(the internal-shadow and baseline-shift cases are the sharpest examples).

## Fixtures

```
fixtures/<name>/index.html          self-contained, file:// — no network, no web fonts
fixtures/<name>/ir/<width>.json     committed IR snapshot, one per width
fixtures/<name>/threshold.json      pixel-diff budget + reason (only for the 4 diffed fixtures)
```

11 fixtures total: `boxes`, `stacking`, `flex`, `text`, `transformed`,
`gradient`, `inline-text`, `absolute-in-flex`, `missing-font`,
`dashed-border`, `text-transform`. Each has 5 committed IR snapshots (one per
width), 55 in total. `tests/e2e/diagnostics.spec.ts` asserts, per fixture,
that a specific set of diagnostic codes is present — phrased positively
("this code must appear") rather than negatively, because "no unexpected
diagnostics" is a weak assertion and "the expected one is there" is the
actual test of the no-silent-fallback rule.

## Repository layout

```
packages/ir                  IR types, zod schema, semantic invariants, diagnostic codes
packages/serializer          DOM → IR, runs inside the captured page, builds to an IIFE
packages/reference-renderer  IR → SVG, used by the pixel-diff gate and by scripts/capture.mjs
fixtures/                    HTML fixtures + committed IR snapshots + pixel-diff thresholds
tests/e2e/                   Playwright: fidelity snapshots, diagnostics, pixel-diff
scripts/capture.mjs          debugging tool, see above
```

`packages/extension` and `packages/figma-plugin`, named in the design doc's
target architecture, do not exist yet — they belong to plans 2 and 3.

## Type discipline

No `any` anywhere in `packages/` or `tests/`:

    grep -rn ": any\|as any" packages/ tests/

is expected to return nothing. TypeScript strict mode plus
`noUncheckedIndexedAccess` are on project-wide.

## Where to go next

Start at `wiki/index.md` for the reasoning behind the architecture and the
IR contract — it links out to pages on stacking/paint order, why the Figma
REST API forced a two-plugin architecture, font-availability detection
pitfalls, and the pixel-diff gate's own history. `wiki/log.md` has the
chronological record of what was tried, what broke, and why.
