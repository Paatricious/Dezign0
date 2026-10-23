---
name: code-handoff
description: Convert an approved HTML artifact into React, Next.js or Vue code with a written contract, token mapping and acceptance checks. Use when a design is approved and another agent or engineer will implement it.
---

# Code handoff

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

A handoff is a contract, not a summary. The implementer must be able to build
without guessing, and a reviewer must be able to prove compliance.

## 1. Confirm the input is ready

Read the artifact from disk and its `.design-os/briefs/TOKENS.md` / `tokens.css`.
If the artifact has no frozen spec or no passing critique, stop: run `critique`
first. Note the artifact revision and the exact files that ship.

The freeze rule applies: a port preserves the artifact. It does not improve
spacing, swap fonts, add a library or "clean up" states. Entry condition: the
artifact is final, every critique finding is applied or explicitly accepted, and
`tokens.css` matches the artifact.

## 2. Load the contract

Call `dezign0_addons`:

- `{ "action": "list", "section": "handoff" }` to see the available targets;
- `{ "action": "get", "id": "handoff-contract" }` always;
- `{ "action": "get", "id": "handoff-react" }`, `handoff-next` or `handoff-vue`
  for the chosen framework.

In a source checkout these are `design-languages/handoff/contract.md`,
`react.md`, `next.md` and `vue.md`. If the pack is missing, say so and use
`.design-os/briefs/HANDOVER.md` alone.

## 3. Write the contract

Copy `.design-os/briefs/HANDOVER.md` into `design/<slug>/HANDOVER.md` and fill:

- source-of-truth order: artifact, tokens, docs, critique;
- component tree with DOM/class contract and stable hooks;
- props, state and events per component, including empty/loading/error states;
- token map: CSS variable -> framework theme entry, role names preserved;
- accessibility contract: roles, labels, focus order, keyboard map, live regions;
- file layout, routing and asset policy for the target framework;
- do-not-regress list with the reason for each row;
- numbered acceptance checks with values, not adjectives;
- a handoff record: artifact @ commit, tokens @ commit, token drift, components
  created and deferred, approved deviations and the framework guide used.

State the read order explicitly (artifact, tokens, handover, tokens doc, contract,
framework guide) so the implementer starts at the same file you did.

## 4. Implement or hand off

Implement against the contract, or deliver the contract with the artifact. Do not
rename tokens, flatten the component tree or drop states "while here". If a
framework constraint forces a deviation, record it in the contract with the
reason and the approver.

## 5. Verify

- Build and type-check the target when the project allows it; report the exact
  command and result.
- Re-run `dezign0_lint` on any remaining HTML, and `dezign0_measure` with
  `a11y: true` when a browser is available.
- Check parity at 1440 / 1024 / 768 / 390 / 360: no horizontal scroll, computed
  colors and radii match the tokens, every handover state is reachable, and
  keyboard-only use completes the primary task.
- Walk the acceptance checklist and mark each item pass/fail. Unrun checks are
  listed as unrun, never as pass.

## Evidence

Report: target framework and version, component map, token map count, files
created or changed, commands run with their output, deviations from the artifact,
and every acceptance item that could not be verified.

## Anti-patterns

- Rewriting behavior or content that the artifact locked.
- Re-inventing tokens or inlining colors during the port.
- One giant component that hides the tree.
- Dropping focus, disabled, empty or error states in the port.
- Claiming a build, test or screenshot that did not run.
- A handover without measurable acceptance checks.

## When not to use

Do not use before the artifact is approved; use `critique` first. Do not use when
there is no artifact yet; use `frontend-design` or `template-start`. Do not use
when the target framework is unstated and the user does not care; ask once, then
hand off the artifact with `HANDOVER.md` only.
