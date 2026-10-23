---
description: Fix critique must-fix findings and re-verify the artifact
agent: build
---

Load the redesign and critique skills. This is a repair round, not a new design.

Kit resolution: use `.design-os/` when it exists (installed project); otherwise
use `design-os/` (source checkout). Read `DESIGN-OS.md`,
`skills/redesign/SKILL.md`, `skills/critique/SKILL.md`, `briefs/CRITIQUE.md` and
`briefs/DESIGN-SPEC.md` from that folder.

Target: $ARGUMENTS

If the target is empty, use the newest `design/<slug>/` folder and say which one.

Rules:

- Read the current `CRITIQUE.md`, brief, design spec, tokens and artifact from
  disk before editing.
- Fix only the must-fix items in the artifact. Do not redesign what the critique
  said was working, and never edit the critique to hide a finding. If a finding
  cannot be fixed in this round, say why and leave it open.
- Preserve the artifact's contract: the same entry point, the same `data-od-id`
  hooks, the same states. If a fix changes the contract, update `DESIGN-SPEC.md`
  and say so.
- Re-verify after the edits, from the same kit folder:
  - `node <kit>/tools/design-lint.mjs <artifact> --strict`
  - `node <kit>/tools/measure-artifact.mjs <artifact> --strict` when Playwright
    is available; otherwise say "source-only re-check".
- Append a "Round N" section to `CRITIQUE.md`: each must-fix item marked closed
  or still open, with before/after evidence (file:line or measured value). Do
  not re-score untouched dimensions without new evidence.
- Stop after the repair round. Handoff belongs in `/design-handoff`; a fresh
  independent review belongs in `/design-critique`.
