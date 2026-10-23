---
name: redesign
description: Audit-first redesign of an existing interface. Preserve what works, fix what measurably fails, and modernize deliberately. Use for "redesign", "polish", "make this look better", or "improve the UI".
---

# Redesign

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

A redesign is not a fresh design with the old text pasted in. Audit first,
decide the mode, preserve what works.

## 1. Detect the mode

- **Preserve**: same product, same users, fix craft and usability. Keep the
  design language unless it is the problem.
- **Evolve**: keep the identity, change layout and/or density.
- **Overhaul**: new direction, but still preserve content, flows and constraints
  unless the user explicitly allows a rewrite.

State the mode in one line before touching pixels.

## 2. Audit before editing

Capture the baseline as an artifact or screenshot, and read
`.design-os/craft/visual-review.md` for the point/annotation protocol. If neither is available,
record DOM/CSS counts, source lines and lint output, and label the baseline
"source-only". Then inspect:

- layout and grid; spacing rhythm; alignment drift;
- type scale, weights, tracking, line length;
- color roles, contrast pairs, accent use;
- states present and missing; keyboard/focus; target sizes;
- long/edge content, overflow, scrollbars;
- motion and reduced motion;
- what the user explicitly asked to keep.

Record findings with evidence (`file:line`, measured px, selector). Do not
"fix" what the brief did not ask to change.

## 3. Preservation rules

Never silently change:

- token values (a token change is a proposal until the owner approves);
- copy, data, routes, flows, component APIs, persistence keys;
- content locks, brand assets, legal text;
- unrelated regions.

If a fix requires one of these, mark it as a proposal and stop or ask.

## 4. Modernization levers (priority order)

1. Fix hierarchy: entry point, reading order, competing focal points.
2. Fix spacing and alignment: grouping, rhythm, gutters.
3. Fix typography: scale, weights, tracking, line length.
4. Fix color roles and contrast; reduce accent overuse.
5. Fix states and interactions; add missing empty/loading/error/edge.
6. Fix responsive behavior; remove horizontal scroll; reflow.
7. Replace default components with intentional ones.
8. Add one distinctive move; then stop.

Do not start at 7 or 8.

## 5. Build

Follow the existing framework and design language. If the baseline is not
responsive, add it. Keep the diff reviewable: one concern per change. Preserve
the old artifact or commit first so the change is reversible.

## 6. Verify and document

- Before/after screenshots at the same size and theme.
- Re-run the audit: every claimed improvement has a measurement.
- List what changed, what was preserved, and what stayed broken with a reason.
- If a critique existed, update it in place against the new artifact.

## Output

A concise report at `design/<slug>/REDESIGN.md`: mode, baseline, findings,
changes, preserved constraints, measurements, known limits. Plus the artifact.

## Failure modes

- Redesigning everything because the tool can.
- Changing tokens without approval.
- Calling it "polish" while changing layout and copy.
- Applying a new aesthetic that ignores the brand.
- Fixing the screenshot but not the source.

## When not to use

Do not use for a brand-new artifact with no existing UI; use `frontend-design` instead.
