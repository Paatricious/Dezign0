---
description: Run an evidence-backed design critique on an artifact
agent: build
---

Load the critique skill and the Design OS before reviewing anything.

Kit resolution: use `.design-os/` when it exists (installed project); otherwise
use `design-os/` (source checkout). Read `DESIGN-OS.md`,
`skills/critique/SKILL.md` and `briefs/CRITIQUE.md` from that folder.

Target: $ARGUMENTS

If the target is empty, pick the newest artifact under `design/<slug>/` and say
which file you are reviewing.

Rules:

- Read the artifact from disk. Do not review from memory, screenshots alone or
  an earlier summary.
- Run the mechanical checks from the same kit folder, when Node is available:
  - `node <kit>/tools/design-lint.mjs <artifact> --json`
  - `node <kit>/tools/measure-artifact.mjs <artifact> --strict` only when the
    project has Playwright installed; otherwise say "source-only review".
  - If the artifact sits in a design-system package, also try
    `<kit>/tools/token-lint.mjs` and `<kit>/tools/content-lint.mjs` when present.
- The artifact is read-only in this command. Do not edit it, do not "fix while
  reviewing", and never rewrite the critique text to soften a finding.
- Score the five dimensions with evidence: cite `file:line` for source findings
  and measured values (contrast ratio, viewport, pixel counts) for rendered
  findings.
- Produce Keep / Fix / Quick wins, mark must-fix items explicitly, and state
  what could not be reviewed.
- Write the review to `design/<slug>/CRITIQUE.md` as a new round. If the file
  exists, append a dated round instead of replacing earlier evidence.

Stop after the critique. Fixing belongs in `/design-fix`.
