# Figma → Dezign0 bridge

How to turn a Figma file into Dezign0's `DESIGN.md`, `tokens.css`, component
inventory and implementation notes without inventing values, and how to translate
Figma layout, variants, text styles and assets into CSS that survives contact
with a real browser.

This document is original Dezign0 content. It is not derived from the OpenDesign
packages in `design-languages/design-systems/`. It defines no new runtime code:
the only Figma access path is the user's MCP client through the
`figma-context` skill, as documented in [`docs/figma.md`](../../docs/figma.md).
In the addon pack it is item `figma-bridge` of
[`../addons/index.json`](../addons/index.json); the `figma-to-code` skill loads it
through `dezign0_addons` with `{ "action": "get", "id": "figma-bridge" }`.

## 0. Contract

| Input | Output | Owner |
|---|---|---|
| Figma file / frame / component set, read through MCP | `design/<slug>/FIGMA.md` capture record | `figma-context` skill |
| `FIGMA.md` + raw tool output | `design/<slug>/tokens.css`, `DESIGN.md`, `TOKENS.md` | this bridge + `design-system-extract` |
| Frozen spec + tokens | implementation handover, component tree, API | [`handoff/`](../handoff/README.md) |

Rules that never bend:

1. A token is written only when a Figma variable, style or explicitly labelled
   visual measurement supports it. Missing values are marked, not filled.
2. Figma is a source, not an authority. The rendered artifact wins when the two
   disagree; record the drift.
3. Nothing here needs a paid Figma feature. Variables REST, Code Connect, Dev
   Mode and canvas write stay out of the workflow.
4. Every value carries a grade and a pointer to the node it came from.

## 1. Evidence model

Write one capture record per Figma source. `figma-context` produces the file; this
bridge consumes it. Required fields:

| Field | Example | Why it exists |
|---|---|---|
| `source.url` | `https://www.figma.com/design/<key>?node-id=12-345` | Lets a reviewer re-open the exact frame |
| `source.fileKey` | `aBcD1234...` | Stable identity across renames |
| `source.nodeId` | `12:345` | Points at the node, not the page |
| `source.selection` | `Card / Pricing / Desktop` | Human-checkable name |
| `source.frame` | `1440 × 900` | The coordinate system all px values assume |
| `capture.tool` | `get_design_context` | Some tools return code, some return a tree |
| `capture.client` | `remote` / `desktop` | Explains missing remote-only or desktop-only fields |
| `capture.at` | ISO timestamp | Figma changes; a capture is a snapshot |
| `capture.modes` | `Light`, `Dark` | Modes are evidence, not an afterthought |
| `evidence.grade` | `SOURCE` / `PARTIAL` / `GUESS` | Prevents guesses from becoming brand tokens |
| `unknowns` | free list | The only honest place for what was not read |

Grade rules:

- **SOURCE** — the value came back from a tool: a variable definition, a style
  definition, a node property, an auto-layout field.
- **PARTIAL** — inferred from a screenshot, a cropped export, a codegen dump
  without property names, or a variable used but not defined in the selection.
- **GUESS** — reconstructed from a similar system, memory, or visual estimation.
  Allowed only in a clearly separated "proposed" section, never as a token value.

Additional evidence fields worth capturing when available: `get_variable_defs`
output verbatim, the list of variable collections and modes, component property
definitions, and the export settings of every asset node.

A screenshot alone can never produce a SOURCE grade. It shows appearance, not
measurement, and it hides padding, gaps, constraints and hidden states.

## 2. Variables and styles → `tokens.css`

### 2.1 What Figma exposes

| Figma concept | Types / fields | Maps to |
|---|---|---|
| Variable | `COLOR`, `FLOAT`, `STRING`, `BOOLEAN`; collection, modes, aliases, scopes, description | Semantic CSS custom properties; strings and booleans become documented constants, not CSS vars, unless a component consumes them |
| Paint style | Solid / gradient / image fill | `--accent`, gradients as `--gradient-*`; image fills become assets |
| Text style | family, size, weight, line height, tracking, case, decoration | `--font-*`, `--text-*`, `--leading-*`, `--tracking-*` |
| Effect style | drop shadow, inner shadow, layer blur, background blur | `--elev-*`, `--blur-*` |
| Grid style | columns, rows, baseline | Layout norms, not tokens |

Variables are the preferred source because they are named and typed. Styles are
the fallback when a value has no variable, and styles carry no modes — say so in
`TOKENS.md`.

### 2.2 Semantic role map

Figma variable names are inconsistent across teams (`color/bg/default`,
`surface/raised`, `bg-base`). Do not copy the path; map the *role* to the
Dezign0 token contract and record the original path as provenance.

| Figma role (any naming) | Dezign0 token | Required |
|---|---|---|
| Page / canvas ground | `--bg` | yes |
| Default card or panel | `--surface` | yes |
| Second surface tier (popover, inset) | `--surface-warm` | when used |
| Primary ink | `--fg` | yes |
| Secondary ink | `--fg-2` | when used |
| Tertiary / metadata ink | `--muted` | when used |
| Link / info / focus accent | `--meta` | when used |
| Hairline divider | `--border` | yes |
| Soft divider inside a surface | `--border-soft` | when used |
| Single product accent | `--accent` | yes |
| Ink on accent | `--accent-on` | yes |
| Accent interaction tints | `--accent-hover`, `--accent-active` | when designed |
| Semantic | `--success`, `--warn`, `--danger` | when used |
| Type families | `--font-display`, `--font-body`, `--font-mono` | yes |
| Size scale | `--text-xs` … `--text-4xl` | yes |
| Line height / tracking | `--leading-body`, `--leading-tight`, `--tracking-display` | yes |
| Spacing scale | `--space-1` … `--space-12` and up | yes |
| Section rhythm | `--section-y-desktop/tablet/phone` | when the page has bands |
| Radius | `--radius-sm/md/lg/pill` | yes |
| Elevation | `--elev-flat/ring/raised` | when shadows exist |
| Focus ring | `--focus-ring` | yes |
| Motion | `--motion-fast/base`, `--ease-standard` | when motion exists |
| Container | `--container-max`, `--container-gutter-*` | page-level only |

If a role exists in Figma but not in the contract, propose a token name, mark it
**GUESS**, and add it to `TOKENS.md` "deliberately excluded" or to the contract —
do not silently repurpose `--accent`.

### 2.3 Collections and modes

A collection is a theme axis, not a file. Read the mode names before writing CSS:

| Collection / modes | CSS representation | Notes |
|---|---|---|
| One mode (`Default`) | `:root` only | Most common |
| Theme: `Light`, `Dark` | `:root` + `[data-theme="dark"]` | Pick one switching mechanism and record it in `TOKENS.md`; do not mix a class and a media query in the same artifact |
| Theme + OS preference | `:root`, `[data-theme="dark"]`, plus `@media (prefers-color-scheme: dark)` scoped to `:root:not([data-theme="light"])` | Only when the product actually supports both |
| Density (`Comfortable`, `Compact`) | `[data-density="compact"]` overriding `--space-*` and control sizes | Do not encode density in separate component variants if padding tokens can carry it |
| Brand / sub-brand | `[data-brand="x"]` | Treat as a second design system, not a mode |

Rules:

- Emit every mode that the selection actually defines. A mode you did not read is
  not a mode you may ship.
- Measure contrast per mode. A pair that passes in Light can fail in Dark; the
  `TOKENS.md` contrast table must have a column per shipped mode.
- Do not flatten modes into duplicated rules per component. Override tokens once
  at the scope root.

### 2.4 Aliases, hidden variables and scopes

- **Aliases**: resolve to the final value for `tokens.css`, but keep the alias
  chain in `TOKENS.md`. Emitting `var(--alias)` chains adds indirection without
  adding meaning; emitting a primitive name as a semantic token leaks internals.
- **Hidden from publishing**: still valid to read from the file; note that it may
  disappear from a library consumer's view.
- **Scopes**: a variable scoped to "gap" is evidence of intended use. Record it;
  it tells the implementer whether a spacing value belongs on `gap` or `padding`.
- **Description fields** often contain the only definition of intent ("only on
  dark surfaces"). Keep them verbatim in `TOKENS.md`.
- **Code syntax** (`WEB`, `ANDROID`, `iOS`) is a naming hint for code, not proof
  that the token is used in code. Never treat it as an implemented token.

### 2.5 Styles as a parallel source

When a paint or text style has no variable behind it:

1. Capture the style name and its resolved value.
2. If a variable exists with the same role, prefer the variable and note the
   duplicate.
3. If not, create the token from the style value and grade it SOURCE (the style
   definition is evidence), while noting "style-only, no variable" in `TOKENS.md`.

Unbound raw values (a fill typed directly into a layer) are **PARTIAL** at best:
they prove one usage, not a system rule. Cluster repeated raw values into a
proposed scale and label the proposal.

### 2.6 What cannot become a token

Gradients, images, per-node overrides and one-off effects are not tokens. Record
them as component decoration with their node IDs. Explicitly list them under
"deliberately excluded" so a later reader does not go hunting for a token that
was never meant to exist.

## 3. Auto-layout → CSS

Auto-layout is the most reliable evidence in a Figma file because it is
structural, not visual. Translate properties, not screenshots.

### 3.1 Direction, sizing, wrap

| Figma property | Value | CSS |
|---|---|---|
| `layoutMode` | `HORIZONTAL` | `display:flex; flex-direction:row` |
| | `VERTICAL` | `display:flex; flex-direction:column` |
| | none | Absolute frame; see 3.4 |
| `itemSpacing` | `N` | `gap:Npx` (along the primary axis) |
| `layoutWrap` | `WRAP` | `flex-wrap:wrap` |
| `counterAxisSpacing` | `N` | `row-gap:Npx` when wrapped; otherwise only `column-gap` |
| `padding*` | `N` | `padding` longhands; keep asymmetric padding explicit |
| `layoutSizingHorizontal` | `FIXED` | `width:Npx` |
| | `HUG` | `width:fit-content` (or `max-content` for text) |
| | `FILL` | `flex:1 1 0` in a row; `align-self:stretch` in a column |
| `layoutSizingVertical` | `FIXED` / `HUG` / `FILL` | `height`, `height:fit-content`, `flex:1 1 0` / `align-self:stretch` |
| `minWidth` / `maxWidth` | `N` | `min-width` / `max-width`; never drop them, auto-layout clamps silently |

`FILL` is not the same as `width:100%`. In a row, `FILL` means "take the remaining
space after fixed siblings"; in CSS that is `flex:1 1 0; min-width:0` so long
content can shrink instead of overflowing.

### 3.2 Alignment

| Figma | Value | CSS |
|---|---|---|
| `primaryAxisAlignItems` | `MIN` / `CENTER` / `MAX` | `justify-content:flex-start / center / flex-end` |
| | `SPACE_BETWEEN` | `justify-content:space-between` |
| `counterAxisAlignItems` | `MIN` / `CENTER` / `MAX` | `align-items:flex-start / center / flex-end` |
| | `BASELINE` | `align-items:baseline` |
| `itemReverseZIndex` | true | Change DOM order instead of `z-index`; reading order must stay logical |

If a row uses `SPACE_BETWEEN` with two children, check what happens when a third
appears. Auto-layout distributes; a naive flex row with `space-between` also
distributes. Both are fine — but if the design means "left group + right group",
emit two nested groups, not one spaced row.

### 3.3 Hug / fill / fixed decisions

| Intent | Figma evidence | CSS | Failure mode if skipped |
|---|---|---|---|
| Full-bleed band | FILL, no max | `width:100%` | Band stops at canvas width |
| Centered container | FIXED + centered | `max-width:var(--container-max); margin-inline:auto` | Text runs edge to edge |
| Shrink-wrap chip | HUG | `width:fit-content` | Chip stretches across the row |
| Equal columns | several FILL siblings | `flex:1 1 0` or `grid-template-columns:repeat(n,minmax(0,1fr))` | One column eats the row |
| Sticky footer | Vertical FILL top region | `flex:1` on the scroll region | Footer floats mid-page |

### 3.4 Absolute frames and constraints

A frame without auto-layout is positioned by constraints. Use absolute
positioning only for overlays, decoration and pinned chrome — not for content
flow.

| Horizontal constraint | CSS |
|---|---|
| `LEFT` | `left:Npx` |
| `RIGHT` | `right:Npx` |
| `LEFT_RIGHT` (stretch) | `left:Npx; right:Npx` |
| `CENTER` | `left:50%; translate:-50% 0` |
| `SCALE` | Percentage offsets; treat as PARTIAL and rewrite as flex/grid |

Vertical constraints mirror this with `top` / `bottom` / `translateY`. A
`SCALE`-constrained layout is a resized drawing, not a responsive design: mark it
PARTIAL and rebuild the layout with flow primitives.

### 3.5 Layout grids → CSS grid

Figma layout grids are guides, but when a frame declares a column grid it is
usable evidence:

| Grid field | CSS |
|---|---|
| `COLUMNS`, `count:N` | `display:grid; grid-template-columns:repeat(N,minmax(0,1fr))` |
| `gutterSize:G` | `gap:Gpx` (column-gap) |
| `offset` (margin) | `padding-inline:Opx` |
| `alignment:STRETCH` | Default; `CENTER` maps to `justify-content:center` + fixed track widths |
| `ROWS` | `grid-auto-rows` / vertical rhythm |
| `GRID` (baseline) | No CSS equivalent; approximate with `line-height` tokens and record the approximation |

Do not emit a grid when the frame has no declared grid and the layout is a simple
flex stack. A grid with one implicit column is a flex column with extra steps.

### 3.6 Borders, radius, effects

- `strokeWeight` inside → `box-shadow:inset 0 0 0 Npx var(--border)` is more
  stable than a border when it must not affect layout; outside stroke → `outline`
  or a border plus padding compensation. Record which one was chosen.
- `cornerRadius` / `rectangleCornerRadii` → `border-radius` longhands; keep
  asymmetric radii explicit.
- `dashPattern` → `border-style:dashed` plus a note; CSS cannot reproduce
  arbitrary dash geometry.
- Drop shadow → `box-shadow: x y blur spread rgba(...)`. Figma lists effects
  top-first; CSS paints the first shadow on top. Reverse the order when there are
  several, and verify visually.
- Inner shadow → `inset`. Layer blur → `filter:blur()` (compositing cost; avoid on
  large surfaces). Background blur → `backdrop-filter:blur()` **with** an opaque
  fallback surface; support is not universal and the fallback is part of the
  contract.

### 3.7 Responsive translation

Figma frames are fixed canvases; a set of frames is evidence about breakpoints,
not a breakpoint definition.

1. Collect the frame widths in the set and the content changes between them.
2. Choose breakpoints where the *layout* changes (column count, nav collapse),
   not at device names.
3. Replace fixed section paddings with the `--section-y-*` tokens per breakpoint.
4. Use `minmax()`/`clamp()` only for values that genuinely scale; otherwise step
   at breakpoints.
5. If the component appears at several widths inside one frame set, prefer
   container queries over page media queries.

## 4. Components, variants and states

### 4.1 Inventory before implementation

Produce an inventory table in `DESIGN.md`. One row per component set, not per
instance.

| Node ID | Component | Variants | States shown | States missing | Grade |
|---|---|---|---|---|---|
| `12:90` | Button | Primary / Secondary / Ghost × SM / MD | default, disabled | hover, focus-visible, active, loading | PARTIAL |
| `12:120` | Input | default / error | default, error, disabled | focus-visible, read-only | PARTIAL |

"States missing" is not a defect in the source; it is work the implementer must
design and get approved. Never fabricate state styling and present it as SOURCE.

### 4.2 Property → component API

| Figma property type | React | Vue | Rule |
|---|---|---|---|
| `VARIANT` (e.g. `Size=MD`) | Union prop `size: "sm" \| "md"` | `size` prop with union type | One prop per variant axis; never one prop per combination |
| `BOOLEAN` (`icon=true`) | `boolean` | `boolean` | Default to the more common state and document it |
| `TEXT` (`label`) | `children` for content; explicit `label` for form controls | `slot` or `label` prop | Pick children for composition, props for fixed strings |
| `INSTANCE_SWAP` | `ReactNode` prop or slot | slot | Keeps the component reusable without importing every icon |
| Nested instance | Child component | Child component | Do not flatten a nested component into CSS |
| Interactive component / prototype | Evidence of behavior only | — | Prototypes document intent; they are not an implementation spec |

Rule of thumb: a variant axis becomes a prop; a state becomes a pseudo-class or a
small state enum; a slot becomes children. If a variant exists only to express
`disabled`, `loading` or `error`, it is a state, not a variant — model it as
state and say so in the handover.

### 4.3 State matrix

Every interactive component gets the full table, filled or marked missing:

| State | Trigger | Visual delta | Implementation |
|---|---|---|---|
| default | — | — | Base styles |
| hover | pointer over | background/tint | `:hover` (guard with `@media (hover:hover)`) |
| focus-visible | keyboard focus | `--focus-ring` | `:focus-visible`, never removed |
| active | pressed | darker tint / translate | `:active` |
| disabled | not available | reduced contrast + no pointer | `disabled` attribute or `aria-disabled` |
| loading | async | spinner/label change | state prop + `aria-busy` |
| empty / error | data states | — | separate composition, not a CSS class |

### 4.4 Nested components and slots

If Figma nests an instance (icon inside button, avatar inside row), preserve the
boundary in code: the parent owns layout, the child owns its own internals. Do not
pass raw SVG markup through three layers — pass a node or a named slot.

## 5. Text styles

### 5.1 Field mapping

| Figma field | CSS / token | Note |
|---|---|---|
| `fontName.family` | `--font-display` / `--font-body` / `--font-mono` | Role first, family second |
| `fontSize` | `--text-*` | px at the captured frame; do not scale to rem blindly |
| `fontWeight` / style name | `font-weight` | Read the numeric weight when available; "Book"/"Semi Bold" names vary by family |
| `lineHeight.unit` `PIXELS` | `line-height:Npx` or unitless | Prefer unitless for body text |
| `lineHeight.unit` `PERCENT` | `line-height:N/100` | Unitless |
| `lineHeight.unit` `AUTO` | `line-height:normal` | Flag as PARTIAL; auto depends on metrics |
| `letterSpacing.unit` `PIXELS` | `letter-spacing:Npx` | Cap-height-sensitive; check at rendered size |
| `letterSpacing.unit` `PERCENT` | `letter-spacing:(N/100)em` | Convert to `em`, never to px |
| `textCase` | `text-transform` | Uppercase labels also need tracking; check the craft rules |
| `textDecoration` | `text-decoration` | Underline offset must be set explicitly |
| `paragraphSpacing` | `margin-block-end` | Do not use `<br>` |
| `textAlignHorizontal` | `text-align` | `JUSTIFIED` is rarely acceptable on the web |
| `textAutoResize` | `width`/`overflow` behaviour | `TRUNCATE` → `text-overflow:ellipsis` + `overflow:hidden` + `white-space:nowrap` |

### 5.2 The two conversions that are always wrong when guessed

```text
unitless line-height = lineHeightPx / fontSizePx        (PERCENT: value / 100)
letter-spacing in em = letterSpacingPx / fontSizePx     (PERCENT: value / 100)
```

Write both formulas next to the tokens. A 32/48 heading and a 16/44 quote do not
share a line-height token just because the line heights look similar in px.

### 5.3 Fonts

- Record family, fallback stack, weights actually used, and licence/provenance.
- Never bundle or redistribute a brand font without a licence.
- Load only the weights the artifact uses; `font-weight` above the loaded range is
  silently clamped.
- Record `font-display` behaviour and any FOIT/FOUT decision in the handover.

## 6. Assets and export

### 6.1 Icons

- Export as SVG; keep `viewBox`, drop fixed `width`/`height`, set
  `fill="currentColor"` (or `stroke="currentColor"`), optimise.
- One file per icon, role-based name (`icon-search.svg`), grouped under the
  component that uses it.
- A rasterised icon is a PARTIAL asset: mark it and schedule a vector replacement.

### 6.2 Images and media

- Export at the sizes the artifact actually renders at, plus 2× where a retina
  benefit exists. Do not export a 4000px asset for a 320px slot.
- Emit `width`, `height` and `aspect-ratio` to reserve space; a layout shift is a
  regression, not a polish item.
- Record provenance and licence per asset. Do not copy Community files, stock
  images or licensed photography into the kit.
- Alt text comes from the layer name only when the layer name describes the
  content; otherwise it is an authoring decision flagged in the handover.

### 6.3 Effects that are not portable

| Figma effect | CSS | Constraint |
|---|---|---|
| Drop shadow (multi) | `box-shadow` | Reverse Figma's order; verify |
| Inner shadow | `inset` box-shadow | — |
| Layer blur | `filter:blur()` | Expensive on large areas; not animatable cheaply |
| Background blur | `backdrop-filter:blur()` | Needs a fallback surface; check support |
| Blend modes | `mix-blend-mode` | Some Figma modes have no CSS equivalent |
| Noise/grain fill | CSS gradient or tiled PNG | Asset licence applies |

### 6.4 Asset manifest

Keep a table in `DESIGN.md` or the handover:

| Node ID | Export | File | Used by | Licence |
|---|---|---|---|---|
| `12:34` | SVG | `icon-chevron.svg` | Select, menu | brand-owned |
| `12:56` | PNG 2× | `hero@2x.png` | Landing hero | licensed, source recorded |

## 7. `DESIGN.md` sections from Figma evidence

The extraction skill requires at least seven substantive sections. Map them to
evidence rather than writing mood prose:

| Section | Figma evidence | Could be graded |
|---|---|---|
| Theme / atmosphere | Frame names, collection descriptions, screenshot | PARTIAL if screenshot-only |
| Color roles | `get_variable_defs`, paint styles, modes | SOURCE per variable |
| Typography | Text styles, font metadata | SOURCE per style |
| Components | Component sets, properties, instances | SOURCE for structure; states may be PARTIAL |
| Layout / spacing | Auto-layout, padding, gap, layout grids | SOURCE per property |
| Depth / elevation | Effect styles | SOURCE |
| Motion | Prototypes, interactive components | PARTIAL (intent, not timing curves) |
| Responsive | Frame set widths, constraints | PARTIAL (frame set is a sample) |
| Agent prompt guide | Synthesis | n/a — must cite the sections above |

## 8. Workflow with `figma-context`

Two entry points, one bridge. Use the first for a single implementation task; use
the second when the work continues into a handoff.

```text
A. Direct
   figma-context -> FIGMA.md -> this bridge -> DESIGN-SPEC -> frontend-design

B. Pipeline (figma-to-code skill)
   figma-context -> this bridge (addon id figma-bridge) -> DESIGN-SPEC
   -> build -> code-handoff (handoff/ addon ids) -> implementation
```

Steps that apply to both:

```text
1. Preflight   figma MCP tools present? which client? is the frame link/ID known?
2. Capture     figma-context: get_metadata -> get_design_context -> get_screenshot
               -> get_variable_defs; write design/<slug>/FIGMA.md
3. Translate   this bridge -> tokens.css + DESIGN.md + TOKENS.md + component inventory
4. Validate    build a button/input/card sample; render it; compare to the screenshot
5. Record      unknowns, grades, drift, "deliberately excluded" tokens
6. Hand off    to handoff/ (or back to design-system-extract as Input B)
```

The bridge does not depend on the `figma-to-code` skill. If the skill is missing
or the addon pack is not installed, run the steps directly; the only loss is the
pipeline's index lookup, not the mapping rules.

Failure and degradation:

| Situation | Response |
|---|---|
| No Figma MCP tools | Ask for a screenshot + frame size, or a pasted `get_design_context` / `get_variable_defs` result. Continue; mark every value PARTIAL. |
| Tool returns code, not properties | Parse values, then confirm with the screenshot; grade PARTIAL and say which tool was used. |
| Selection too large or truncated | Re-capture the smallest meaningful node; never extract from a partial dump. |
| Variables not defined (only referenced) | Record the reference and the resolved value with grade PARTIAL; do not invent a name. |
| Figma text differs from the artifact screenshot | Artifact wins for implementation; record the drift in `CRITIQUE.md` or `TOKENS.md`. |

Do not use the Variables REST API, Code Connect or canvas write in this loop. They
are gated and unnecessary; adding them turns an optional bridge into a paid
dependency.

## 9. Acceptance checklist

Evidence

1. `FIGMA.md` has file key, node ID, selection name, frame size, tool, client and
   timestamp.
2. Every token has a grade and a variable/style path or a node ID.
3. Every `GUESS` is in a proposed section, never in `tokens.css`.
4. Unknowns are listed; no value is silently missing.

Tokens

5. `tokens.css` uses only semantic names from the contract.
6. Every variable collection and mode read is represented once, at the correct
   scope; no component duplicates mode overrides.
7. Aliases are resolved for CSS and preserved as provenance in `TOKENS.md`.
8. Contrast is measured for every ink/background pair in every shipped mode; the
   table records deliberate exceptions.
9. No raw hex value appears outside `tokens.css` (the linter enforces this).

Layout

10. Every auto-layout property that changes geometry (direction, gap, padding,
    sizing, wrap) has a CSS counterpart.
11. `FILL` siblings have `min-width:0` or an equivalent shrink guard.
12. Absolute positioning is used only for overlays, decoration or pinned chrome.
13. Layout grids became CSS grid only where the frame declared a grid.
14. Section padding uses the `--section-y-*` tokens at each breakpoint.
15. No horizontal scroll at 1440, 1024, 768, 390 and 360 px.

Type, components, assets

16. Line height and tracking are converted with the formulas in 5.2.
17. Font weights exist in the loaded font set.
18. The component inventory lists every set, its variants, and missing states.
19. Interaction states are implemented as CSS/state, not as duplicated variants.
20. Icons are inline SVG with `currentColor`; images carry dimensions and
    provenance.
21. Background blur has an opaque fallback.

Workflow

22. A sample component built from the tokens matches the screenshot side by side.
23. `design-lint` and, where available, `measure-artifact` pass on the sample.
24. `TOKENS.md` "deliberately excluded" lists non-token decorations.

## 10. Limits

- MCP tool names and payloads vary by client; this bridge depends on the four
  read tools, not on a specific schema.
- Figma has no CSS cascade, so specificity, inheritance and global resets are
  always an implementation decision recorded in the handover.
- Screenshots do not expose hidden states, hover/focus styling, or responsive
  behaviour that is not drawn in a frame.
- Figma's unit system is px at the captured frame; converting to rem/em is a
  separate, recorded decision.
- This document never authorises `.fig` parsing, REST token reads, asset scraping
  or canvas writes.
