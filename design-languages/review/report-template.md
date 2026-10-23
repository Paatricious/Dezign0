# Review report template

Copy this file to `design/<slug>/review/<YYYY-MM-DD>/REPORT.md` and replace every
`{{placeholder}}`. Delete rows that do not apply; never delete the section —
write `none` or `not reviewed — {{reason}}` so the absence is explicit.

Placeholders use double braces so they stay visible in a Markdown preview (angle
brackets are consumed as HTML). Path-shaped tokens such as `design/<slug>/` keep
their angle form: they are paths, not fill-ins.

This is the **evidence packet**. If the review also scores the artifact, the
scores go in `CRITIQUE.md` using the schema in `design-os/briefs/CRITIQUE.md`, and
each score cites an item in this packet. Do not invent a second scoring scale
here.

---

# Review — {{artifact title}}

| Field | Value |
|---|---|
| Artifact | `design/<slug>/artifact.html` |
| Deliverable type | product UI / prototype / state board / documentation plate / reproduced "before" |
| Revision | `{{git rev-parse --short HEAD}}` (dirty: yes/no) |
| Reviewer | {{agent or person}} |
| Date | {{YYYY-MM-DD}} |
| Verdict | **pass** / **fail (open P0)** / **conditional (accepted P1s)** |
| Scoring | `CRITIQUE.md` § {{section or path}} / not scored |

## 1. Verdict

{{One paragraph. Lead with the verdict, then the single most important finding,
then the condition for the verdict to change. No adjectives without a number
behind them.}}

## 2. Method and environment

| Item | Value |
|---|---|
| Browser | {{Chromium 141, headless}} / none |
| Playwright | available / `not installed` |
| Viewports | `1440x900,1024x900,768x900,390x844,375x812,360x800,145x188` |
| DPR | {{1}} |
| OS / font stack | {{platform and font stack}} |
| Source access | full / partial / none |
| States rendered | {{list}} |
| States not rendered | {{list}} |
| Artifact modified | no (default) / yes — {{why}} |

Commands actually run (paste verbatim; the report is worthless if these cannot
be re-run):

```bash
node .design-os/tools/design-lint.mjs design/<slug>/artifact.html --strict
node .design-os/tools/measure-artifact.mjs design/<slug>/artifact.html \
  --viewports=1440x900,1024x900,768x900,390x844,375x812,360x800,145x188 \
  --a11y --strict \
  --shots=design/<slug>/review/<YYYY-MM-DD>/shots
```

Exclusions, if any (`--exclude`), with the justification:

- `{{.stage, [inert]}}` — {{intentionally reproduced mock; not the artifact under review}}

## 3. Render results

Copy the numbers from the tool output; do not retype from memory.

| Viewport | `scrollWidth` | Clipped | Contrast fails | Type sizes | Text <11px | Tab stops | `data-od-id` | a11y |
|---|---|---|---|---|---|---|---|---|
| `1440x900` | {{1440}} | {{0}} | {{0}} | {{6}} | {{0}} | {{12}} | {{9}} | {{0}} |
| `1024x900` | | | | | | | | |
| `768x900` | | | | | | | | |
| `390x844` | | | | | | | | |
| `375x812` | | | | | | | | |
| `360x800` | | | | | | | | |
| `145x188` | | | | | | | | |

Console errors: {{0}} · Page errors: {{0}} · External requests: {{0}}

One line per viewport that failed:

- `145x188` — clipped: `{{.widget .footer}}` at `{{left 3 … right 151}}`; cause: `{{fixed min-width 160px}}`.

## 4. Screenshot and element evidence

| Label | Full page | Element shot | Selector | `elementBox` | Note |
|---|---|---|---|---|---|
| `1440x900` | `shots/artifact-1440x900.png` | `shots/artifact-1440x900-element.png` | `.metric-value` | {{96x28}} | {{note}} |
| `145x188` | `shots/artifact-145x188.png` | `shots/artifact-145x188-element.png` | `.metric-value` | {{88x24}} | {{cell clips above 999}} |

Selector sanity: {{resolves to one node / first of N — the intended node}}.

## 5. State matrix

`rendered` = captured at the review viewports · `source-only` = CSS/DOM exists,
not rendered · `missing` = not implemented.

| Surface | Loading | Empty | Error | Populated | Edge | Notes |
|---|---|---|---|---|---|---|
| {{widget: revenue}} | rendered | missing | source-only | rendered | missing | {{error collapses to empty}} |
| {{page: settings}} | | | | | | |

Interaction states:

| State | Rendered | Evidence | Note |
|---|---|---|---|
| Default | yes | `shots/{{file}}.png` | |
| Hover | {{no — static artifact}} | `{{:hover rule at file:line}}` | not proven by screenshot |
| Focus-visible | {{yes}} | `shots/focus-{{file}}.png` | ring 2px, 3.4:1 |
| Active/pressed | | | |
| Selected | | | |
| Disabled | | | |
| Submitting | | | |
| Success/failure | | | |

## 6. Accessibility

Automated (`--a11y`): {{N}} findings across the matrix.

| id | kind | viewport | detail | severity | fix |
|---|---|---|---|---|---|
| A11Y-01 | `{{input-label}}` | `{{145x188}}` | `{{<input id="qty">}}` | P0 | {{visible label, same row}} |
| A11Y-02 | | | | | |

Manual passes (from [a11y.md](a11y.md)):

| Pass | Result | Evidence / reason |
|---|---|---|
| Keyboard only | {{pass / fail — P0 / not reviewed}} | {{unreachable overflow menu}} |
| Zoom 200% / 400% | | |
| Reduced motion | | |
| Forced colors | | |
| Screen reader spot check | | `not reviewed — no screen reader` |
| Non-text contrast | | |
| Target size | | |

## 7. Visual regression

| Baseline | Candidate | Tool | Tolerance | Result |
|---|---|---|---|---|
| `review/baseline/artifact-1440x900.png` | `review/<date>/shots/artifact-1440x900.png` | {{pixelmatch 0.1 / odiff / none}} | {{per-channel 12, <0.1% pixels}} | {{no change / 1 intended / 2 defects}} |

Classified diffs:

- `{{intended}}`: {{spacing token 16→20}} — accepted by {{who}} on {{date}}.
- `{{defect}}`: {{legend box 96→88 wide}} — see FIND-03.

If no diff tool was available:
`visual regression: not run (no diff tool)` — and no claim of "no regression".

## 8. Findings

Ordered by severity, then by visual cost per minute to fix.

### P0 — blocks handover

| id | Finding | Evidence | Cause | Fix |
|---|---|---|---|---|
| FIND-01 | {{Content unreachable at 145x188}} | {{clipped `.footer`, 6px past right edge; `shots/artifact-145x188.png`}} | `{{min-width: 160px}}` at `{{artifact.html:214}}` | {{remove fixed width; test at 145x188}} |

### P1 — must fix before ship

| id | Finding | Evidence | Cause | Fix |
|---|---|---|---|---|
| FIND-02 | {{Empty state missing}} | {{no `[data-state="empty"]`; state matrix}} | {{populated-only render}} | {{compose empty state per `craft/layout-and-states.md`}} |

### P2 — polish

| id | Finding | Evidence | Cause | Fix |
|---|---|---|---|---|
| FIND-03 | {{Legend drifts 1px between 768 and 390}} | {{measured boxes 96 vs 95}} | {{non-integer grid width}} | {{use token spacing}} |

## 9. Accepted risks

| Risk | Accepted by | Date | Note |
|---|---|---|---|
| {{2.5.8 target size exception: inline "Edit" link inside a sentence}} | {{name}} | {{date}} | {{documented exception}} |

An accepted risk is not a pass; it is a decision with a name on it.

## 10. Not reviewed

List, with the reason, everything the reviewer could not check. This section is
why the report can be trusted.

- {{Firefox/Safari rendering — no second engine available}}
- {{reduced motion — no emulation in this run}}
- {{screen-reader output — no screen reader}}
- {{states X, Y — not implemented in the artifact}}

## 11. Evidence index

```text
design/<slug>/review/<YYYY-MM-DD>/
  REPORT.md                 this file
  manifest.json             captured commands, commit, viewport set, tool versions
  shots/                    full-page and -element PNGs
  lint.txt                  design-lint --strict output
  measure.txt               measure-artifact output (human or --json)
  diff/                     optional visual-diff artefacts
```

Attach the raw tool outputs. A claim without its raw output is an opinion; a
review is evidence.

## 12. Handover

- [ ] Packet complete: verdict, method, matrices, findings, not-reviewed.
- [ ] Every finding has severity, evidence, cause and fix.
- [ ] Every rendered claim cites a number, a screenshot or a line.
- [ ] Scores (if any) written in `CRITIQUE.md` and each cites an item here.
- [ ] Artifact left unmodified unless the user asked for fixes.
- [ ] Report linked from `design/<slug>/HANDOVER.md`.
