---
name: critique
description: Run a five-dimension, evidence-backed design review with measured counters and Keep/Fix/Quick-wins lists. Use before shipping, after a redesign, or when the user asks what is wrong with a design.
---

# Critique

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

Produce an evidence document, not an opinion. Read the artifact from disk. Do
not review from memory.

## Workflow

1. **Identify the artifact and scope.** Files, screens, states, viewport, DPR,
   browser/tool available. State what cannot be reviewed.
2. **Read the source and measure the render.** Read the CSS tokens and count
   controls/states. If a browser is available, run
   `.design-os/tools/measure-artifact.mjs <artifact> --strict` for clipped content, rendered contrast,
   type-size count and tab stops. If it is not, write "source-only review" and
   do not claim rendered overflow, contrast or font behavior. Still cite source
   lines. For a state board, use `.design-os/briefs/CRITIQUE.md` -> "State-board
   checklist", and verify size claims against the built widget or source.
3. **Score five dimensions.** Philosophy consistency, visual hierarchy, detail,
   functionality, innovation. Each 0–10, worst sustained band. Cite evidence.
4. **Count measured facts.** At least three, e.g. "0 of 4 arrow keys work",
   "weakest contrast 1.31:1 (decorative)", "3 of 5 states missing", "1146×124 at
   7 columns".
5. **Keep / Fix / Quick wins.** Keep 3–5 with evidence. Fix 3–6 ordered by
   visual cost per minute, each with severity, `file:line`, cause and fix.
   Quick wins 3–5, 5–15 minutes, disproportional effect.
6. **State method and scope.** What was inspected, what was not, whether the
   artifact was modified. Default: read-only.
7. **Output.** Copy the schema in `.design-os/briefs/CRITIQUE.md` into
   `design/<slug>/CRITIQUE.md` and fill it. If an HTML report is useful
   or requested, render one self-contained page with a radar, score rows and the
   three lists, following the same design rules.

## Scoring discipline

- 0–4 broken, 5–6 functional, 7–8 strong, 9–10 exceptional.
- Do not average away failures. The score is the worst sustained band.
- Do not grade-inflate. A 7 means strong. An 8+ requires near-professional
  craft and no obvious must-fix.
- Do not score a dimension you cannot inspect. Mark it "not reviewed", say why,
  and exclude it from the composite mean. List it separately.
- A passing critique has **no scored dimension below 7 and a composite ≥8.0**.
  A single broken dimension cannot be averaged away.

## Fix mode

When the user asks to fix:

- edit the artifact for every Fix item;
- update the report and mark items applied with new line references;
- re-read from disk and re-score;
- never edit only the report prose while leaving the artifact broken.

## Artifact-type notes

- **State board / documentation:** score the board as a communication artifact,
  not as product UI. Name the layer for each score. The board's own wayfinding
  accent is one system, not a violation of the product's two-use cap. Reproduced
  widget defects are evidence about the source; exclude them from rendered
  contrast/overflow findings and report them separately.
- **Product UI / prototype:** apply the dimensions to the product, measure
  states and focus, and do not let a clean source review stand in for a render.

## Stop rules

- If the artifact is too large to inspect fully, sample the key screens and say
  which were not reviewed.
- If a requirement is missing (no brief, no brand system), score philosophy
  against the artifact's own declared direction and name the gap.
- If the user only wants a quick review, keep the same schema but cap the report
  length; never drop dimensions silently.

## Output checklist

- Five scores with evidence.
- Three measured counters.
- Keep / Fix / Quick wins.
- Method, scope, artifact status.
- No unsupported adjectives.

## When not to use

Do not use to implement fixes; use fix mode after the report, or `redesign`.
