---
name: design-brief
description: Turn a vague design request into a checkable brief with numeric constraints, deliverables, states and an explicit design read. Use before building a new artifact or starting a redesign.
---

# Design brief

Produce a brief that another person could use to check the result. Do not start
pixels. This skill is done when every unknown is either answered or written down
as an assumption with a risk.

## Workflow

1. **Read the room.** Infer the page kind, audience, vibe words, references,
   existing brand assets and quiet constraints. Write one line:
   "Reading this as: [kind] for [audience], with a [vibe] language, leaning
   toward [system/family]."
2. **Inventory what is missing.** Check: goal, audience, surface, sizes, grid,
   tokens/brand, content, states, accessibility floor, deliverables, format,
   deadline. Do not ask about fields that do not change the artifact.
3. **Ask at most three questions total.** Prefer one. Ask only when the answer
   changes the brief materially (e.g. "is this a dashboard or a marketing page?",
   "is the current layout fixed?"). If context is sufficient, do not ask; state
   the assumption.
4. **Make it numeric.** Enumerate every target size in px. Name grid, columns,
   gutters, cell padding, radius, min/max. If a value is unknown, propose one
   and mark it as a proposal.
5. **Name the visual system.** Existing `DESIGN.md` path or "propose one". Do
   not allow "make it modern" as a system.
6. **Enumerate deliverables.** Numbered files, formats, entry points. Include
   the comparison gallery and standalone files for a direction study. Default
   to no new dependencies.
7. **List assumptions and exclusions.** One line each. Explicitly list what is
   out of scope so the build does not drift.
8. **Check it.** Could a reviewer verify each item? If not, rewrite it until it
   is measurable.

## Output

Fill `briefs/BRIEF.md`. If the harness has no filesystem, output it as a
fenced markdown block titled `BRIEF.md`. Add a one-paragraph summary and the
design read at the top. Stop. Do not build in the same turn unless the user
explicitly asked to plan and build.

## Rules

- Refuse a brief with no numbers. Ask for or propose the sizes.
- Never invent a brand system and call it the user's.
- Do not add unrequested deliverables.
- A shorter brief is better than a vague one. If a section does not apply,
  delete it.
