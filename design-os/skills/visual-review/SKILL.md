---
name: visual-review
description: Review a rendered artifact at exact sizes with accessibility checks, optionally scoped to one selector, and report measured findings. Use when the user points at a screenshot, region or element and asks whether it holds up.
---

# Visual review

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

This is the pointed review: one artifact, named sizes, optional selector,
measured evidence. A scored five-dimension review is `critique`, not this skill.

## 1. Pin the target

Get five things before measuring: artifact path, exact size(s), optional
selector or region, the intent, and whether the artifact may be modified. Follow
`.design-os/craft/visual-review.md`. If the target is only "the page", ask one
narrowing question; do not review a whole page from a thumbnail.

Exact sizes are mandatory, not defaults. A fixed widget cell is measured as
`145x188` (or the brief's real cell); the review matrix is
`1440x900,1024x900,768x900,390x844,375x812,360x800,145x188`. Do not use a vague
width or a device name. In a source checkout the pack's procedure is
`design-languages/review/a11y.md`.

## 2. Measure

Call `dezign0_measure` with:

- `path`: the artifact, relative to the project;
- `viewports: "145x188"` for an exact cell, or a comma list of `WIDTHxHEIGHT`;
- `a11y: true`, always;
- `selector: ".widget"` (or a `[data-od-id="..."]` hook) when a specific element
  is named;
- `strict: true` when this is a shipping gate.

Equivalent CLI: `node .design-os/tools/measure-artifact.mjs <artifact>
--viewports=145x188 --a11y --selector=.widget --strict`. Add
`--shots=design/<slug>/shots` for images.

If Playwright is unavailable, say "source-only review", run `dezign0_lint`, and
do not claim rendered overflow, contrast, focus or a11y results.

## 3. Read the report

Per viewport, quote the numbers:

- `scrollWidth` and clipped elements (a passing `scrollWidth` does not prove no
  clipping; `overflow-x: clip` can hide content);
- contrast failures with ratio, required ratio, size and text;
- `typeSizes` count and text below 11px;
- `tabStops` and `data-od-id` hooks;
- a11y kinds: `img-alt`, `control-name`, `input-label`, `heading-h1`,
  `heading-order`, `landmark-main`, `tabindex-positive`;
- `element=WxH` when a selector was given; compare with the expected size.

Two semantics that are easy to misstate: findings are per instance (one bad
control repeated ten times counts ten), and only the first 12 per viewport are
printed even when `a11yCount` is higher. `--a11y` controls printing and blocking:
with `--a11y --strict` any finding exits 1, without `--strict` exit stays 0.
The tool does not prove keyboard operability, focus appearance, non-text
contrast, screen-reader output, zoom or colour-only signals; mark those manual
checks "not reviewed" rather than passing them.

Map each finding to the smallest element and cite selector, `file:line` or the
measured box. Then fix or report; never describe a screenshot you did not take.

## 4. Re-measure

After changes, run the same command with the same sizes and selector, and report
before/after counters. If nothing changed, say so rather than implying success.

## Evidence

Report: artifact and revision, viewport(s) with exact sizes, selector, element
box versus expected, a11y counts, console errors, before/after counters, and what
was not reviewed. If the addon pack is installed, the playbooks are available
through `dezign0_addons` (`review-checklist`, `review-a11y`, and the
`review/report-template.md` shape under `design-languages/review/`).

## Anti-patterns

- Reviewing at one width and calling it responsive.
- Skipping `a11y: true` when the review is a shipping gate.
- Reporting "looks fine" with no measured number.
- Claiming a visual check from reading source.
- Comparing screenshots at different sizes, DPR or browsers as a regression.
- Ignoring inverted or dark themes when the artifact ships both.

## When not to use

Do not use for a full scored review with five dimensions and a verdict; use
`critique`. Do not use for editing the design; use `redesign` after the review.
Do not use when no artifact exists yet; build it with `frontend-design`.
