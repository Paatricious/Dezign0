# Critique protocol

A design review is an evidence document, not an opinion. Use it before calling
work finished and whenever the user asks for a review.

## Rules

- Read the artifact from disk. Do not review from memory or from a previous
  report.
- Cite evidence for every score: an element, a selector, a `file:line`, a
  measured number.
- The score is the **worst sustained band**, not the best moment. Do not average
  away failures.
- Do not inflate. 0–4 Broken, 5–6 Functional, 7–8 Strong, 9–10 Exceptional.
- State method, scope, viewport/DPR, and whether the artifact was modified.
  A critique report is read-only unless explicitly asked to fix.
- Report what holds, what must be fixed, and quick wins. "Fixes" are ordered by
  visual cost per minute, not by how easy they are to describe.
- Do not grade a design you did not inspect. If a check was impossible (no
  browser, no screenshot, no source access), mark that dimension "not reviewed",
  say why, and exclude it from the mean. List it separately.
- A passing report has no scored dimension below 7 and a composite of at least
  8.0. A single broken dimension cannot be averaged away.

## Measurement

A critique that claims rendered facts must have rendered evidence. If the
harness has a browser:

```bash
node .design-os/tools/measure-artifact.mjs <artifact> --strict
```

Use its output for clipped content, rendered contrast, distinct type sizes and
tab stops. Verify claims about the production source separately: if the artifact
is a mock or state board, diff its geometry, copy and tokens against the real
component or built product when those exist. If it does not exist, mark the
fidelity claim as unverified.

If there is no browser, say "source-only review" at the top and do not claim
overflow, clipping, rendered contrast, font substitution or animation behavior.
`design-lint.mjs` is static; it cannot replace a render.

## Artifact-type notes

- **Product UI / prototype:** the five dimensions apply normally. Measure focus,
  states and responsive behavior.
- **State board / documentation:** score philosophy, hierarchy and detail on the
  board itself, not on the mocked widget; score functionality on whether the
  board's evidence and prototype work; score innovation on the communication
  idea (does the board make the problem legible and the redesign tractable?).
  Say which layer each score refers to.
- **Before/after or reproduced-defect artifacts:** intentionally reproduced flaws
  are evidence, not defects in the presentation. Exclude those regions from
  measured contrast/overflow (e.g. `--exclude='.stage,[inert]'`) and report them
  as findings about the source, not the page.
- **Documentation accent systems:** a board may use the accent systematically for
  wayfinding (section numbers, state tags, pins). That is one accent system, not
  the product's two-uses-per-screen budget. Judge whether it is coherent and
  limited to one role; do not count every pin as a violation.

## The five dimensions

### 1. Philosophy consistency (0–10)

Does the artifact commit to one clear direction and carry it through every
micro-decision?

Evidence: one declared direction; chrome/kicker vocabulary in one register;
accent/serif/mono used by one rule; no drift on interior/edge screens.
Bands: 0–4 three styles fighting; 5–6 one direction but elements drift; 7–8
coherent with occasional edge drift; 9–10 every element argues the same thesis.

### 2. Visual hierarchy (0–10)

Can a stranger know what to read first, second, third without being told?

Evidence: the largest type is the most important thing; roles match type roles
(meta/body/display); one dominant element per region; density is intentional;
nothing competes.
Bands: 0–4 no entry point; 5–6 readable but flat; 7–8 clear with small
competition; 9–10 effortless reading order across every screen.

### 3. Detail (0–10)

Craft at the pixel level: spacing rhythm, alignment, type, color, finishing.

Evidence: consistent 1px/4px/8px logic; no accidental 1–3px drift; optical
alignment; icons consistent; radii/shadows coherent; long strings survive;
states look finished, not stubbed.
Bands: 0–4 visibly unfinished; 5–6 works with rough edges; 7–8 clean; 9–10
nothing to fix on a close read.

### 4. Functionality (0–10)

Does the flow work, and are the states complete?

Evidence: primary flow works end to end; controls are real; every required state
exists; keyboard/focus; errors preserve input; edge data holds; no dead
affordances.
Bands: 0–4 broken flow; 5–6 mostly works, states missing; 7–8 works with
secondary gaps; 9–10 complete and robust.

### 5. Innovation (0–10)

Is there at least one specific, defensible idea worth remembering?

Evidence: a layout, interaction, content treatment or visual move that is not
the default; the idea serves the brief; it is not novelty for its own sake.
Bands: 0–4 template; 5–6 one mild idea; 7–8 a clear idea executed; 9–10 a idea
that could define the product.

## Report schema

```text
CRITIQUE — <artifact title>
Score: X.X / 10 (mean of scored dimensions; no scored dimension below 7)
Verdict: one line.
Method: viewport, DPR, browser/Playwright, source access, what was measured.
Scope: screens/states reviewed; what is out of scope.
Artifact: unchanged / modified (if modified, say why).

Scores
  Philosophy      X — band — evidence
  Visual hierarchy X
  Detail          X
  Functionality   X
  Innovation      X
Measured counters
  - e.g. 0 of 4 arrow keys work
  - e.g. 1146px frame at 7 columns
  - e.g. weakest contrast pair 1.31:1 (decorative)
  - e.g. 3 of 5 required states missing

What holds (3–5)
  - Claim + evidence/measurement

What to fix (3–6, ordered)
  - [P0/P1/P2] Claim — file:line — cause — fix
  - [P0/P1/P2] ...

Quick wins (3–5)
  - one-line change — file:line — expected effect

Method and scope notes
  - what was not reviewed
  - what could not be measured
```

## Optional HTML report

If the harness can render HTML, produce a self-contained report with a radar
chart (inline SVG), five score rows, the counters, and the three action lists.
The report is a design artifact too: apply the same typography and color rules.
Keep it read-only: do not modify the reviewed artifact unless asked.

## State-board checklist

When reviewing a state board, in addition to the five dimensions:

- [ ] The state inventory matches the source/manifest. Count screens, states and
      transitions; list anything missing or duplicated.
- [ ] The manifest parses and agrees with the rendered state list.
- [ ] Every static mock is `inert`; only the live prototype is focusable.
- [ ] The prototype can complete, cancel, fail and retry; success and failure
      paths both work.
- [ ] Focus is visible after every phase change and is restored to the new
      primary action, not dropped to `<body>`.
- [ ] No clipped content at 320–1440. `scrollWidth == viewport` is not enough;
      `overflow-x: clip` can hide the failure.
- [ ] Size claims are verified against the built widget, not only the board's
      own mocks.
- [ ] Documented flaws are labelled as flaws; do not present a reproduction as
      the intended design.
- [ ] The board's own type/contrast rules do not hide the widget's failures (e.g.
      grade numerals measured at 3.36 / 2.93 / 4.37:1).
- [ ] Stable inspect hooks (`data-od-id`) exist for sections and screens.

## Fix pass and re-score

When the user says "fix these":

1. Edit the artifact for every Fix item. Do not edit only the report.
2. Update the report to mark each item applied, with the new line reference.
3. Re-read the artifact from disk.
4. Re-score. If a score did not change, say why.
5. If the user asked for a fix only, do not silently run a full second review
   unless it is needed to verify the claims.

The failure to guard against: "fixed the text in the critique, not the mockup."
