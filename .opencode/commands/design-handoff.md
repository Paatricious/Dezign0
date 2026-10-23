---
description: Turn an approved artifact into an implementation contract and tokens
agent: build
---

Load the code-handoff skill and the design evidence before writing anything.

Kit resolution: use `.design-os/` when it exists (installed project); otherwise
use `design-os/` (source checkout). Read `DESIGN-OS.md`,
`skills/code-handoff/SKILL.md`, `briefs/HANDOVER.md`, `briefs/TOKENS.md` and
`briefs/DESIGN-SPEC.md` from that folder.

Target: $ARGUMENTS

If the target is empty, use the newest `design/<slug>/` folder and say which one.

Preconditions:

- Read `CRITIQUE.md` from the same folder. If must-fix items are still open,
  stop and list them. Do not hand off a design that has not passed its critique.
- Read the brief, design spec, tokens and the artifact from disk. If the artifact
  and the design spec disagree, report the disagreement instead of guessing.

Produce, from the kit templates:

1. `HANDOVER.md` — component tree or section map, props/content contract, states
   and interaction states, responsive behavior, data assumptions, and what is
   intentionally out of scope.
2. `TOKENS.md` and `tokens.css` — the token map the implementation must use.
   Every colour, spacing, radius, type and motion value the artifact uses must
   be either a token here or listed as a deliberate one-off with a reason.
3. Acceptance checks — the lint/measure commands to run after implementation,
   the accessibility floor, and the states a reviewer must click through.

If the user named a framework (React, Next.js, Vue), target it with the matching
addon contract from `design-languages/handoff/` when the optional pack is
installed; otherwise default to React.

Do not write implementation code in this command. It produces the contract the
implementer works from; `/design-fix` is for returning to the artifact.
