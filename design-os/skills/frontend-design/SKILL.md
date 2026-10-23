---
name: frontend-design
description: Build a production-grade web interface with a clear visual direction, working states, responsive behavior and real content. Use for websites, landing pages, dashboards, app screens and UI components.
---

# Frontend design

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

The goal is not "make it nicer". The goal is a working interface with a point of
view, strong craft and enough product detail that it feels designed for the
user's actual context.

## Before code

1. **Brief.** If one exists, read it fully. If not, run `design-brief` (or do
   its eight steps quickly). Do not start with a hero section.
2. **Design read.** One line: kind, audience, aesthetic family, system. Set the
   three dials.
3. **Direction.** Use the brand `DESIGN.md` or choose one named direction with a
   thesis, palette, type, spacing, radius and motion posture.
4. **Design spec.** Freeze tokens, type scale, spacing, components, states,
   content and motion. Copy `.design-os/briefs/DESIGN-SPEC.md` to
   `design/<slug>/DESIGN-SPEC.md` and fill it.
5. **Existing work.** If a repo/artifact exists, read its tokens, components,
   screenshots and conventions. Preserve them unless explicitly asked to
   redesign.

## Build

- Prefer the existing framework and tokens. For a standalone artifact, ship one
  self-contained HTML file with inline CSS/JS unless asked otherwise.
- Real content by default. No lorem ipsum, no invented metrics, no fake
  screenshots, no emoji icons.
- Token-only color/type/spacing. One accent.
- Semantic markup, keyboard-operable controls, visible focus, persistent labels.
- Every flow works: navigation goes somewhere, buttons mutate state, forms
  validate and preserve input, empty/loading/error states exist.
- Responsive by reflow, not scaling. Test 375, 768, 1024, 1440.
- Motion only for state change/hierarchy, with reduced-motion support.
- Use `data-*` hooks for review targets where the harness has an inspect mode.

## Self-check (gate)

- The page opens with no console errors and no broken assets.
- Every control has a name, hover, focus, active and disabled state where
  relevant.
- All five data states exist for each data surface.
- Longest and shortest content tested; no overlap/clipping/horizontal scroll.
- Contrast measured: 4.5:1 body, 3:1 large/UI.
- Light and dark both intentional.
- No anti-slop P0 patterns.
- One memorable quality a user could describe.
- Run `.design-os/tools/design-lint.mjs <artifact>`; P0 must be clear.
- If a browser is available, run `.design-os/tools/measure-artifact.mjs
  <artifact> --strict`; if not, say "source-only self-check".

## Output

Write the artifact to `design/<slug>/`. Name the files and entry point. State assumptions and known
limits. If a critique is required, run the `critique` skill against the artifact
from disk before handover.

## Failure modes to avoid

- Starting with a template skeleton (hero, three equal cards, pricing).
- Designing only the populated state.
- Leaving placeholder copy because the real copy was inconvenient.
- Using a stock component library in its default state.
- Making the page responsive by shrinking everything.
- Claiming a screenshot/render/validation that did not run.

## When not to use

Do not use for polishing an existing UI; use `redesign` instead.
