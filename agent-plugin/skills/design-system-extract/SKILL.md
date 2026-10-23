---
name: design-system-extract
description: Extract a usable design system (DESIGN.md + tokens.css) from an existing website, screenshot, codebase or current app. Evidence-graded, no invented values. Use when a brand system does not already exist.
---

# Design system extraction

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

Produce a contract another agent can build with. Every value carries evidence.
When evidence is weak, mark it; never present a guess as measured.

## Input A: live DOM/source

Use computed styles, source files and official brand assets. Use a browser when
available; otherwise label the extraction source-only and say what was skipped.

## Input B: Figma

If Figma is the source of truth, run `figma-context` first and use its
`FIGMA.md` bridge document. Keep the file key, node ID, tool used and
SOURCE/PARTIAL/GUESS grade for every token. Use `get_variable_defs` for token
names and collection modes; do not invent a mapping when a variable is missing.
Figma is optional: if no MCP server is available, continue with screenshots or
pasted context and record the lost evidence.

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

- `design-systems/<brand>/DESIGN.md`
- `design-systems/<brand>/tokens.css`
- `design-systems/<brand>/TOKENS.md` (if the harness/team uses the full token document)
- `evidence.md` or a section in DESIGN.md listing sources and unknowns.

Never write these into `.design-os/`.

Then stop. Do not build the full product unless asked.

## When not to use

Do not use to redesign the product; extract the system first.
