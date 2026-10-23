# Credits and prior art

The kit's prose and code are original. The design rules are standards and craft
practice restated in original form. The following public resources informed the
work and are credited:

| Resource | License | Influence |
|---|---|---|
| [refero_skill](https://github.com/referodesign/refero_skill) | MIT | Craft-rule tradition behind typography, color, anti-slop and state coverage |
| [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Apache-2.0 | Frontend design workflow concepts |
| [taste-skill](https://github.com/Leonxlnx/taste-skill) | MIT, © 2026 Leonxlnx | Design read, dials and AI-tell concepts |
| [Emil Kowalski skills](https://github.com/emilkowalski/skills) | MIT (see upstream) | Motion and interaction craft |
| [huashu-design critique](https://github.com/alchaincyf/huashu-design) | License not stated | Five-dimension critique concept; verify before reusing its HTML template |
| [refero](https://styles.refero.design/) and other reference sites | Varies | Reference vocabulary only; no assets included |

The rule values in `craft/` are standards and craft facts (WCAG, Material,
Apple HIG, typographic practice, design-engineering norms) restated in original
prose. Where a rule originated in an upstream skill, it is a principle, not a
copied file.

## What is original

- All prose in `README.md`, `DESIGN-OS.md`, `briefs/`, `craft/`, `skills/`,
  `harness/` and `tools/`.
- The `design-lint.mjs` implementation.
- The `measure-artifact.mjs` implementation. It optionally uses Playwright
  (Apache-2.0) as an installed peer; Playwright is not bundled.
- The templates and workflow composition.

## What is not included

- Any third-party application code, daemon, UI, plugin pipeline or database.
- Any design-system packages, skill bodies, templates, fonts, images, logos or
  brand assets.
- Any third-party assets. Harnesses should self-host assets they are licensed to
  use.

## Using this kit

You may copy, adapt and use the kit in your own harness or product. Keep this
credit file with any redistribution. Do not claim the rules as your own
invention; the value is the system, and the system was learned from these
sources.
