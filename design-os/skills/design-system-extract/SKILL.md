---
name: design-system-extract
description: Extract a usable design system (DESIGN.md + tokens.css) from an existing website, screenshot, codebase or current app. Evidence-graded, no invented values. Use when a brand system does not already exist.
---

# Design system extraction

Produce a contract another agent can build with. Every value carries evidence.
When evidence is weak, mark it; never present a guess as measured.

## Evidence grades

For every token, component or rule:

- **SOURCE**: measured from the live DOM/computed style, source file or official
  brand guide.
- **PARTIAL**: inferred from a screenshot or a limited sample; state the gap.
- **GUESS**: a proposal for a missing decision. Clearly labelled.

A design system with 40 SOURCE values beats 200 invented ones.

## Workflow

1. **Define scope.** One product surface, one brand. List URLs, screenshots, code
   paths and assets available. Note what is not accessible.
2. **Measure before judging.** With a browser:
   - capture computed styles for body, headings, links, buttons, inputs, cards,
     nav, tables;
   - sample real colors (background, surface, fg, muted, border, accent,
     semantic);
   - measure type sizes/weights/line-heights/tracking and font families;
   - measure spacing between actual elements, radii, border widths, shadows;
   - collect component state styles (hover, focus, active, disabled);
   - capture light/dark if both exist.
   If no browser: use screenshots, but grade tokens PARTIAL.
3. **Cluster into a scale.** Resolve observations into a closed token set. Do not
   copy every one-off value. Identify the scale (4/8px, type scale, radius scale).
4. **Check contrast.** Compute pairs; record failures and decide whether they are
   deliberate (decorative) or a fix proposal. Do not silently "fix" brand colors;
   propose and mark.
5. **Write `DESIGN.md`.** At least seven substantive sections: theme/atmosphere;
   color roles; typography; components; layout/spacing; depth/elevation;
   motion; do's and don'ts; responsive; agent prompt guide. Use exact values and
   roles, not mood adjectives.
6. **Write `tokens.css`.** Semantic names only (`--bg`, `--surface`, `--fg`,
   `--muted`, `--border`, `--accent`, etc.). Include light/dark scopes.
7. **List unknowns.** What could not be measured, what was inferred, what must
   be confirmed by the owner. This is required.
8. **Validate.** Build one small sample (button, input, card) with the tokens and
   compare it side by side with the source. If it does not look like the source,
   the tokens are wrong.

## Rules

- Never invent a brand asset (logo, font) that was not provided or measurable.
- Do not redistribute brand fonts or images without license; record provenance.
- Do not turn a single screenshot into a religion. State the sample size.
- If the brand uses a serif display face, the system must record it; do not let
  generic craft rules overwrite brand decisions.
- Preserve deliberate quirks (an unusual radius, a mono label). A design system
  that sandpapers off the identity is not useful.

## Output

- `DESIGN.md`
- `tokens.css`
- `TOKENS.md` (if the harness/team uses the full token document)
- `evidence.md` or a section in DESIGN.md listing sources and unknowns.

Then stop. Do not build the full product unless asked.
