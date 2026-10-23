# Review checklist

Run top to bottom. Each item is a pass condition you can check, not a prompt to
think about the topic. Copy this list into the review packet and mark every line
`pass`, `fail (P0/P1/P2)`, or `n/a — reason`.

Legend: `[ ]` not yet checked · `[x]` pass · `[!]` fail · `[-]` not applicable.

## 0. Record the target

- [ ] Artifact path recorded exactly (`design/<slug>/artifact.html`).
- [ ] Revision recorded: `git rev-parse --short HEAD`, plus `dirty` if the file
      has uncommitted changes.
- [ ] Deliverable type named: product UI, prototype, state board,
      documentation plate, reproduced "before" frame.
- [ ] Brief / DESIGN-SPEC present and read; if absent, that is a finding, not a
      silent default.
- [ ] Browser available? If not, the report opens with `source-only review` and
      every rendered item below becomes `not reviewed — no browser`.

## 1. Static pass

```bash
node .design-os/tools/design-lint.mjs design/<slug>/artifact.html --strict
```

- [ ] Exit code recorded (0 clean, 1 findings, 2 read/usage error).
- [ ] Zero P0 findings, or each P0 listed with `file:line` and a fix.
- [ ] P1 findings triaged: fixed, or accepted with a reason (brand indigo
      declared as a token, brutalist brief documented, etc.).
- [ ] `data-od-id` inspect hooks exist on meaningful regions (prefer sections,
      cards, widgets — not every `<div>`).
- [ ] No `outline: none` without a `:focus-visible` replacement.
- [ ] Motion rules have a `prefers-reduced-motion: reduce` branch.

## 2. Render matrix

```bash
node .design-os/tools/measure-artifact.mjs design/<slug>/artifact.html \
  --viewports=1440x900,1024x900,768x900,390x844,375x812,360x800,145x188 \
  --a11y --strict \
  --shots=design/<slug>/review/<YYYY-MM-DD>/shots
```

- [ ] Command, browser build, DPR and the full viewport string are in the
      report. Nothing is described as "mobile" without its pixel width.
- [ ] For **every** viewport in the table: `clippedCount == 0`.
      (`scrollWidth == viewport` alone is not evidence.)
- [ ] For every viewport: `contrastCount == 0` on text the user must read. Any
      remaining failure is named with its ratio, size and text.
- [ ] No console errors, no page errors (`console errors: 0`).
- [ ] External request count is intentional. A self-contained artifact should
      report `external requests: 0`; remote fonts/images are a finding.
- [ ] `tiny` list empty, or every entry below 11px is justified in the brief.
- [ ] `typeSizeCount` matches the declared type scale (a count above the scale
      means ad-hoc sizes).
- [ ] `tabStops > 0` for an interactive artifact; count matches the visible
      controls that should be reachable.
- [ ] `odHooks > 0`.
- [ ] Any `--exclude` selector names an intentionally reproduced region, is
      listed in the report, and never covers the artifact under review.

## 3. Per-viewport checks

For each label in the matrix, look at that screenshot before writing a sentence
about it.

- [ ] `1440x900` — composition, density, entry point, navigation complete.
- [ ] `1024x900` — grid still has a readable hierarchy; no header pressure.
- [ ] `768x900` — column collapse intentional; no orphaned card row.
- [ ] `390x844` and `375x812` — primary flow reachable; labels not truncated
      into ambiguity; touch targets ≥24px (44px for a product norm).
- [ ] `360x800` — the practical minimum still works; no horizontal scroll.
- [ ] **`145x188` widget cell** — the cell's own surface holds:
      - [ ] header/title fits without ellipsis that hides meaning;
      - [ ] primary number or metric is still the largest element;
      - [ ] body does not clip and does not rely on an inner scrollbar nobody
            will discover;
      - [ ] empty and error states fit at this size, not only populated;
      - [ ] any control is operably sized, or the cell is read-only by design;
      - [ ] type does not fall below the 11px floor to make it fit.
- [ ] A layout that only works because a screenshot is cropped is marked as
      cropped, with the real box size cited.

## 4. Element-level evidence

```bash
node .design-os/tools/measure-artifact.mjs design/<slug>/artifact.html \
  --viewports=1440x900,145x188 --selector='.widget .metric-value' \
  --shots=design/<slug>/review/<YYYY-MM-DD>/shots
```

- [ ] At least one `--selector` capture per widget or component under review.
- [ ] The selector resolves to exactly one element (the tool uses `.first()`);
      confirm the measured box is the intended node, not an earlier match.
- [ ] `elementBox` width/height recorded where size is part of the claim
      ("the cell is 145 wide and the metric reads 96 wide").
- [ ] `artifact-<label>-element.png` exists for the label being discussed.
- [ ] Element shots taken at the same labels as the full-page shots.

## 5. States

Data states: Loading, Empty, Error, Populated, Edge (long strings, extreme
volume, missing fields, partial data, RTL).

- [ ] All five data states exist for every surface that fetches or accepts data.
- [ ] Each state captured at the same viewport labels (plus `145x188` for a
      widget cell), or explicitly marked `not rendered`.
- [ ] Empty state: headline, plain explanation, primary action. Error is not
      rendered as empty.
- [ ] Error state: says what happened, why if knowable, and the recovery action;
      user input preserved.
- [ ] Loading state: indicator matches the delay table (no spinner under
      300ms; long waits have progress or a 15s notice).
- [ ] Edge state: longest strings, smallest and largest numbers, missing
      optional fields; layout holds.
- [ ] Interaction states across the artifact: default, hover, focus-visible,
      active, selected, disabled, submitting, success/failure feedback.
- [ ] Hover is never the only affordance; every hover-only action has a
      keyboard path.
- [ ] Unrendered states are marked `not rendered; source-only` with the
      selector cited — never described as verified.

## 6. Interaction and keyboard

Run this by hand in the browser, not from a screenshot.

- [ ] Tab from the top: every control is reachable, in visual order.
- [ ] Focus is always visible while tabbing; the ring is not clipped by
      `overflow: hidden` and not removed by an outline reset.
- [ ] Enter/Space activate buttons and links as expected; no dead controls.
- [ ] Escape closes overlays; focus is trapped while open and restored to the
      invoking control on close.
- [ ] Form submit: validation moves focus to the first error; a field error does
      not escalate to a page error.
- [ ] Primary flow completes end to end; a failure path can be retried.
- [ ] No layout shift on state change (the content that matters stays put).
- [ ] Nothing depends on hover for discovery: hidden menus have a click/keyboard
      path.

## 7. Accessibility

Tool pass, then the manual pass in [a11y.md](a11y.md).

- [ ] `--a11y` run; findings listed with `kind` and `detail`.
- [ ] Every `img-alt`, `control-name`, `input-label`, `heading-h1`,
      `heading-order`, `landmark-main`, `tabindex-positive` finding fixed or
      justified.
- [ ] Rendered contrast measured per viewport (tool), plus non-text contrast
      (boundaries, icons, focus ring) checked by hand at 3:1.
- [ ] Keyboard-only pass from §6 repeated at 200% zoom.
- [ ] Reduced-motion pass: no translate/scale/rotate/parallax remains.
- [ ] Screen-reader spot check (or `not reviewed — no screen reader`) recorded.
- [ ] Forced-colors/high-contrast spot check (or `not reviewed`).
- [ ] Target sizes: 24×24 CSS px minimum (AA), 44×44 for touch products.

## 8. Content and data honesty

- [ ] Real content, or clearly labelled placeholder; no lorem ipsum.
- [ ] No invented metrics, logos, customers, testimonials or "trusted by N".
- [ ] Numbers formatted consistently (separators, units, precision).
- [ ] Copy states cause and recovery in errors; CTAs name the action, and the
      same action keeps one name through the flow.
- [ ] Long and short content tested at the narrowest viewport, not only on
      desktop.
- [ ] Dates, currencies and names are not locale-ambiguous.

## 9. Visual regression

- [ ] Baseline exists for the committed revision (or this is the first capture,
      recorded as such).
- [ ] Candidate captures use the same viewport set, browser, DPR, OS/font stack
      as the baseline.
- [ ] Diff run with a named tool and a stated tolerance.
- [ ] Every diff classified: intended change, antialiasing noise, or defect.
      Unexplained geometry/colour/type change is a defect.
- [ ] No re-baseline without an accepted review entry in the same commit.
- [ ] If no diff tool was available: `visual regression: not run (no diff tool)`
      — not "clean".

## 10. Evidence and verdict

- [ ] Every rendered claim cites a measurement, a screenshot file, or a
      `file:line`.
- [ ] At least three measured counters (e.g. `0 clipped at 145x188`,
      `weakest contrast 3.12:1 on 12px meta`, `3 of 5 states missing`).
- [ ] Findings ordered P0 → P1 → P2, each with cause and fix.
- [ ] "Not reviewed" items listed explicitly with the reason.
- [ ] Report states: browser, viewport set, DPR, source access, states rendered,
      exclusions, whether the artifact was modified (default: no).
- [ ] Verdict matches the evidence: any open P0 means fail, regardless of how
      good the other dimensions look.
- [ ] Packet handed over using [report-template.md](report-template.md).
