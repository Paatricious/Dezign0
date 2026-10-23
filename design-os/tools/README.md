# Tools

Two complementary checks:

- `design-lint.mjs` — static, dependency-free, catches source patterns.
- `measure-artifact.mjs` — rendered, requires Playwright, catches what only a
  browser can see: clipped content, actual contrast, type-size count, tab stops.

Static lint alone cannot see a 375px layout clipping content behind
`overflow-x: clip`, or a grade numeral failing AA at its rendered size. Use both
when the harness has a browser.

## design-lint

Static checks for HTML design artifacts. It catches the mechanical failures that
are cheap to detect and expensive to ship. It is a floor, not a review.

```bash
node design-lint.mjs path/to/artifact.html
node design-lint.mjs --json path/to/artifact.html
node design-lint.mjs --strict path/to/artifact.html
node design-lint.mjs --quiet path/to/artifact.html   # summary only
```

Exit codes:

- `0` no blocking findings
- `1` P0 findings (or P0+P1 with `--strict`)
- `2` usage or read error

No dependencies. Node 18+.

## What it checks

**P0 (blocking by default)**

- violet/purple gradients, including keyword forms;
- blue→cyan two-stop "trust" gradients;
- hardcoded default indigo hexes (`#6366f1`, `#4f46e5`, `#4338ca`, `#3730a3`,
  `#8b5cf6`, `#7c3aed`, `#a855f7`);
- emoji used as icons in headings, buttons, list items or icon classes;
- rounded cards with a colored left border;
- invented metrics (`10× faster`, `99.9% uptime`, `trusted by 10,000+ teams`);
- filler copy (`lorem ipsum`, `feature one/two/three`, `placeholder text`);
- `scrollIntoView()` in an iframe artifact.

**P1 (advisory; blocking with `--strict`)**

- heading rules using Inter/Roboto/system sans as the display face;
- ALL CAPS without ≥0.06em tracking;
- external placeholder image CDNs;
- more than 12 raw hex values outside custom-property declarations;
- more than 6 `var(--accent)` uses;
- `transition: all`;
- `outline: none` without a focus-visible replacement;
- interactive elements but no `:focus-visible`;
- motion but no `prefers-reduced-motion`;
- `<img>` without `alt`;
- `font-weight` above the loaded `@font-face` range (silently clamped);
- page-level `overflow-x: clip`/`hidden` (can hide broken content).

**P2 (polish)**

- `href="#"` placeholders;
- no token layer at all;
- `<section>` elements without any `data-od-id` inspect hook.

## What it cannot check

- hierarchy, composition, taste, originality;
- actual rendered contrast (parse CSS and measure pairs separately);
- responsive behavior, overflow, clipping (use a browser);
- whether a flow actually works;
- whether copy is appropriate for the domain;
- color-blind safety, screen-reader output beyond the basics.

Use `briefs/CRITIQUE.md` and `measure-artifact.mjs` for those.

## measure-artifact

Browser measurements. Install Playwright in the harness, not in the kit:

```bash
npm i -D playwright
npx playwright install chromium
node measure-artifact.mjs path/to/artifact.html --viewports=1440,768,390,375,360
node measure-artifact.mjs path/to/artifact.html --json --strict
node measure-artifact.mjs path/to/board.html --exclude='.stage,[inert],#pg-host'
```

It reports, per viewport:

- console errors and external requests;
- **clipped content**: elements whose box crosses the viewport but is not inside
  a deliberate horizontal scroll container. This catches the
  `overflow-x: clip` failure that makes `scrollWidth == viewport` look fine while
  content is unreachable;
- **rendered contrast** failures for text leaves, with the nearest opaque
  background and alpha compositing. It handles `oklch()`/`lab()` computed colors
  by normalizing through a 1×1 canvas;
- distinct computed type sizes, and text below 11px;
- focusable controls (excluding `[inert]` and disabled), and `data-od-id` count.

`--exclude` accepts comma-separated selectors. Use it for regions that
intentionally reproduce a flawed source: a state board's inert widget mocks, a
"before" screenshot, a copy of the old UI. Do not exclude the artifact under
review.

`--strict` exits 1 on clipped content, contrast failures, or console errors.
Without it, exit is 0 after a successful measurement.

Caveats: it cannot judge hierarchy or taste; it does not test screen readers,
Firefox/Safari, print, zoom, or forced colors; background images and gradients
are not composited by the background walker; and intentionally reproduced
defects will appear as findings unless excluded.

## Integrating it

**As a harness gate:**

```js
// after writing artifact.html
const { spawnSync } = require("node:child_process");
const r = spawnSync(process.execPath, [".design-os/tools/design-lint.mjs", artifactPath], { encoding: "utf8" });
if (r.status === 1) throw new Error("P0 design-lint findings:\n" + r.stdout);
```

**As a pre-commit / CI step:**

```bash
find design -name '*.html' -print0 | xargs -0 -n1 node .design-os/tools/design-lint.mjs
```

**As a feedback loop:** feed the output back to the agent and ask it to re-emit
the artifact with the P0s fixed. Do not ask it to fix the lint text.

## Heuristic caveats

- A brand may intentionally use an indigo token. The check ignores declared
  custom properties; if the brand really is indigo, declare it as `--accent` and
  use the token.
- A brutalist brief may intentionally use a pattern that looks like "AI slop".
  Document the exception; do not silently pass it.
- The left-accent-card check is a CSS heuristic and may fire on a legitimate
  component. Review the finding, then fix the component or the rule.
- Emoji detection is approximate for exotic sequences.

## Extending

Add a check by appending a block in `lintHtml` and returning a finding with
`{severity, id, line, file, message, fix, snippet}`. Keep the rule mechanical and
explain the fix. Do not add taste-as-script rules that cannot be verified.
