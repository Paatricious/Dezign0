# Review playbook

Operational procedure for reviewing a **rendered** design artifact: what to
capture, at which sizes, with which commands, and what evidence a review must
carry so its claims can be checked.

This directory is about **evidence collection**. It is not the scoring rubric:

| Need | Read |
|---|---|
| How to score an artifact (five dimensions, bands, report schema) | `design-os/briefs/CRITIQUE.md` |
| How to point at a region from a screenshot or annotation | `design-os/craft/visual-review.md` |
| Accessibility rules a design must meet | `design-os/craft/accessibility.md` |
| How to run the accessibility review | [a11y.md](a11y.md) |
| How the `visual-review` skill runs the pass | `design-os/skills/visual-review/SKILL.md` |
| What to check, in order, before a verdict | [checklist.md](checklist.md) |
| The packet to hand over | [report-template.md](report-template.md) |

Scope: HTML artifacts produced under `design/<slug>/`, state boards, component
galleries, documentation plates, and reproduced "before" frames. The same
procedure applies when a review is asked for by a user ("is this page good?"),
by an agent before handover, or by CI.

The rule behind everything here: **a rendered claim needs a render.** If the
harness has no browser, say `source-only review` at the top of the report and
stop making rendered claims (overflow, clipping, contrast, font substitution,
animation). State what you could not measure instead of guessing.

---

## 1. Prerequisites

- Node.js 18 or newer.
- Playwright installed **in the project**, not in the Dezign0 kit:

  ```bash
  npm i -D playwright
  npx playwright install chromium
  ```

- Run the measurement from the project root. The tool resolves Playwright from
  `DEZIGN0_PROJECT_DIR` when set, otherwise from the current working directory.

```bash
# from the project root
node .design-os/tools/measure-artifact.mjs design/<slug>/artifact.html --help
```

`--help` prints the current option list. With a target it exits 0; with no target
(arguments only) it prints the same help and exits 2, so pass a path when you
want a zero exit. Treat that output as authoritative if this document and the
tool ever disagree.

## 2. The review loop

1. **Freeze the target.** Record file, git commit (`git rev-parse --short HEAD`),
   and whether the file is tracked or dirty. A review of an unrecorded revision
   is not reproducible.
2. **Static pass.** `design-lint.mjs` catches cheap source-level failures before
   spending a render.

   ```bash
   node .design-os/tools/design-lint.mjs design/<slug>/artifact.html --strict
   ```

3. **Render matrix.** One command produces the per-viewport measurements and,
   with `--shots`, the screenshots.

   ```bash
   node .design-os/tools/measure-artifact.mjs design/<slug>/artifact.html \
     --viewports=1440x900,1024x900,768x900,390x844,375x812,360x800,145x188 \
     --a11y --strict \
     --shots=design/<slug>/review/<YYYY-MM-DD>/shots
   ```

4. **States and interactions.** Screenshots cannot prove a hover, focus ring or
   error path. Capture the states the artifact exposes and operate the ones it
   implements (keyboard first, then pointer). See §6.
5. **Accessibility procedure.** Follow [a11y.md](a11y.md): tool checks first,
   then the manual passes the tool cannot do.
6. **Write the packet.** [checklist.md](checklist.md) for the pass conditions,
   [report-template.md](report-template.md) for the output. Scores, if any, use
   the `CRITIQUE.md` schema and cite this packet's evidence.

## 3. Viewport matrix

All values are **CSS pixels**, exactly as passed. The tool takes
`WIDTH` or `WIDTHxHEIGHT`; a bare width gets height `900`.

| Label | Size (CSS px) | Represents | What it can settle |
|---|---|---|---|
| Desktop | `1440x900` | Common laptop viewport | Composition, density, hero framing, full navigation |
| Small laptop | `1024x900` | 13" laptop / tablet landscape | Column collapse, header pressure, table overflow |
| Tablet | `768x900` | Tablet portrait | Two-to-one column transition, touch-size targets |
| Large phone | `390x844` | 390-wide phone (iPhone 12–15 class) | Primary mobile layout, one-handed reach |
| Small phone | `375x812` | 375-wide phone (iPhone X/11 Pro class) | Tight mobile, long labels, 44px targets |
| Narrow Android | `360x800` | 360-wide Android class | The practical minimum before redesign |
| **Widget cell** | **`145x188`** | One exact widget grid cell | Everything inside the cell: clipping, type floor, control size, truncation |

`145x188` is deliberately not a device size. It is the exact cell box a dashboard
widget is laid out into, so it must be passed as `--viewports=145x188` — never
approximated by "a narrow window". At that size you are reviewing the cell as a
product surface: does the header survive, does the body scroll or clip, is the
primary number still the largest thing, does the empty state fit, can a touch
target exist at all. Page-level questions (navigation, footer) are out of scope
there.

Add sizes only for a stated reason: `320x568` when the brief claims 320 support,
`1920x1080` when a large-screen composition is part of the deliverable, a
product's own supported minimum when it is documented. Every extra viewport is
another row that must be read; do not pad the matrix.

Per viewport the tool reports:

| Field | Meaning |
|---|---|
| `scrollWidth` | `document.documentElement.scrollWidth` at that viewport |
| `clippedCount` / `clipped` | Visible, non-fixed elements whose box crosses the viewport edge and is **not** inside a horizontal scroll container |
| `contrastCount` / `contrast` | Text leaves failing the rendered contrast ratio (4.5:1 body, 3:1 large) |
| `typeSizeCount` | Distinct computed type sizes among visible text |
| `tiny` | Text below 11px |
| `tabStops` | Focusable, enabled, non-`[inert]` controls |
| `odHooks` | Count of `[data-od-id]` inspect hooks |
| `a11yCount` / `a11y` | Accessibility findings (see [a11y.md](a11y.md)) |
| `elementBox` | `x/y/width/height` of the `--selector` element, when given |

`scrollWidth == viewport` is **not** proof of no overflow: `overflow-x: clip`
hides content while keeping the page width correct. `clippedCount` is the
measurement that answers that question.

## 4. Screenshots

```bash
# full-page PNG per viewport
node .design-os/tools/measure-artifact.mjs design/<slug>/artifact.html \
  --viewports=1440x900,768x900,390x844,145x188 \
  --shots=design/<slug>/review/<YYYY-MM-DD>/shots
```

File names are derived from the viewport label, with any character outside
`a-z0-9x-` replaced by `-`:

```text
shots/
  artifact-1440x900.png
  artifact-768x900.png
  artifact-390x844.png
  artifact-145x188.png
```

Notes that matter when reading or quoting them:

- Screenshots are **full-page** (`fullPage: true`), so a tall page's image is
  taller than the viewport. For a fixed-size surface such as a widget cell, the
  page is the cell and the image is the cell's box.
- Fonts are awaited (`document.fonts.ready`) before measuring and shooting, so a
  fallback-font flash is not captured. A font that fails to load *is* captured;
  compare against the intended face before judging type.
- A screenshot is evidence of one render, not proof of the current source. Name
  the file and commit in the report.

### Element selector screenshots

Add `--selector=<css>` to capture and report one element. This is how you
answer "the tooltip is 12px off" or "the chart legend clips" with a picture and
a number instead of a paragraph.

```bash
node .design-os/tools/measure-artifact.mjs design/<slug>/artifact.html \
  --viewports=1440x900,145x188 \
  --selector='.widget .metric-value' \
  --shots=design/<slug>/review/<YYYY-MM-DD>/shots
```

Behaviour, exactly:

- `--selector=.x` matches **the first** element only (`locator(...).first()`).
  A selector matching several nodes yields one element and one box; choose a
  selector that is unique, or add `:nth-of-type()`.
- The **element box** (`elementBox`: x, y, width, height, rounded) is reported at
  every viewport even without `--shots`, and prints as `element=WxH` in the
  human output. That is the number to cite for "the cell is 145 wide and the
  metric is 96 wide".
- With `--shots` **and** `--selector`, a cropped element PNG is written per
  viewport: `artifact-<label>-element.png`. Cropping is best-effort; a selector
  that does not resolve writes no element image and no box.
- The element is measured at the viewport it was shot at, so a `145x188`
  element screenshot is the only one that proves the widget cell layout.
- `--shots` writes the base directory recursively; keep each review's shots in
  its own dated folder so a later baseline is never overwritten by accident.

Use element shots for: one widget in a dense dashboard, a chart's legend, a
form row, a table cell at long-content, a focus ring on a single control. Keep
full-page shots for composition and regression.

## 5. Visual regression

There is no pixel-diff in the kit; the deterministic part is the capture. Diff
with whatever image tool the project already has (`pixelmatch`, `odiff`,
ImageMagick `compare`, or a CI service) — the contract below is what makes a
diff meaningful.

```text
design/<slug>/review/
  baseline/                    committed PNGs for the last accepted revision
    artifact-1440x900.png
    artifact-390x844.png
  <YYYY-MM-DD>/shots/          this review's captures
  <YYYY-MM-DD>/manifest.json
```

`manifest.json` for the run:

```json
{
  "artifact": "design/<slug>/artifact.html",
  "commit": "<git rev-parse --short HEAD>",
  "date": "<YYYY-MM-DD>",
  "browser": "chromium <version>, headless",
  "viewport": "1440x900,1024x900,768x900,390x844,375x812,360x800,145x188",
  "dpr": 1,
  "selector": null,
  "command": "node .design-os/tools/measure-artifact.mjs ...",
  "excludes": [],
  "notes": "what changed since the baseline"
}
```

Rules for a valid comparison:

- Same viewport set, same browser build, same DPR, same OS/font stack. A diff
  across operating systems, browsers or DPR measures antialiasing and font
  rasterisation, not the design.
- Compare like with like: full-page to full-page, element to element, at the
  same label.
- Ignore a documented antialiasing tolerance (a per-pixel channel threshold or
  a small changed-pixel budget) and say which one you used. A zero-tolerance
  diff on text will always show drift.
- Treat these as defects without tolerance: a moved or resized box, clipped
  content, a vanished control, a colour shift in a token, a type-size change, a
  breakpoint firing at the wrong width.
- Re-baseline only after a review accepts the change, in the same commit as the
  fix, and say so in the report. Never re-baseline to make a diff disappear.
- A "before/after" pair is not a regression test: it is two renders of different
  code. Diff baseline→candidate for regression; present before→after for intent.

If no image tool is available, record the capture and write
`visual regression: not run (no diff tool)` in the report. Do not describe an
unrun diff as clean.

## 6. States to capture

A populated-only surface is not designed. Capture, per surface, both the data
states and the interaction states that apply.

**Data states** (`design-os/craft/layout-and-states.md`): Loading, Empty, Error,
Populated, Edge (long strings, extreme volume, missing fields, partial data,
RTL).

**Interaction states**: default, hover, focus-visible, active/pressed, selected,
disabled, submitting, success/failure feedback.

Most static artifacts do not contain all of these. The honest options, in order:

1. **Artifact exposes states** (the recommended shape): a state switcher, URL
   query (`?state=empty`), or a state-board page that renders each state at real
   size. Capture each with the same viewport set and the same `--shots` folder.
2. **Force the state in a fixture copy**: a throwaway copy of the artifact with
   the state class applied (`data-state="error"`), reviewed as the same
   artifact; record the fixture path and that it is a fixture.
3. **Source-only claim**: the state exists only as CSS (`:hover`, `:focus-visible`,
   `[disabled]`). Then say `state not rendered; source-only` and cite the
   selector and line. Never describe an unrendered state as verified.

Capture rules:

- Hover/focus shots need a pointer or keyboard, so a static screenshot cannot
  prove them. Use the harness's browser automation for the interaction, or mark
  the state unrendered.
- Focus rings are a keyboard concern: capture focus-visible via a `Tab`-driven
  script, not by forcing `:focus`.
- Every captured state gets the same viewport labels as the base review, plus
  `145x188` for anything that is a widget cell.
- Record the state list and the missing ones in the report's state matrix. A
  missing state is a finding (usually P1), not a footnote.

## 7. Severity and verdict

Use the kit's scale so a review and a critique agree:

- **P0 — blocks handover.** Lost or unreachable content, broken primary flow,
  contrast below the floor on text the user must read, a control that cannot be
  reached by keyboard, a rendered console error, fabricated data presented as
  real.
- **P1 — must fix before ship.** Missing required state, hidden overflow outside
  a scroll container, sub-11px text, ambiguous control name, heading/landmark
  failure, a11y finding that hides information from assistive tech, a regression
  with no accepted change.
- **P2 — polish.** Alignment drift, inconsistent radii or spacing, an unused
  token, a hover-only nicety without a keyboard path.

`--strict` maps to the mechanical part of P0: clipped content, contrast
failures, console or page errors, and (with `--a11y`) accessibility findings.
Taste, hierarchy and copy quality are never `--strict` failures; they are
judgement calls with evidence.

A passing packet has no open P0, every P1 either fixed or explicitly accepted
with a name attached, and every "not reviewed" item listed rather than omitted.

## 8. Limitations to state in every report

The tool cannot see: vertical clipping, background images or gradients as
contrast backdrops, real screen-reader output, Firefox/Safari rendering, print,
zoom/reflow, forced-colors mode, reduced-motion behaviour, or whether an
interaction actually works. `--a11y` is a heuristic subset of WCAG — see
[a11y.md](a11y.md) for exactly what it does and does not cover.

State the browser, viewport set, DPR, whether Playwright was available, which
states were rendered, and what was excluded via `--exclude`. An exclusion is a
claim that a region is evidence, not a defect — justify it (`--exclude='.stage,
[inert]'` for intentionally reproduced mocks), and never exclude the artifact
under review.

## 9. Packaging and discovery

These files ship in the optional `dezign0-design-languages` content pack: the
pack's `package.json` lists `review/` in `files`, and `addons/index.json` catalogs
`review/checklist.md`, `review/a11y.md` and `review/report-template.md` as
`review-checklist`, `review-a11y` and `review-report-template`. The plugin's
`dezign0_addons` tool serves them (`action=list|search|get`), and the
`visual-review` skill runs the pass this directory describes.

Nothing here is loaded by the core `dezign0` plugin, which stays small.
