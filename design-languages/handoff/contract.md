# Handoff contract

The framework-agnostic agreement between a finished Dezign0 HTML artifact and the
component implementation that replaces it. React, Next and Vue guides inherit
this document; if they disagree with it, this file wins.

Original Dezign0 content. It describes how to preserve a design, not how to
rewrite it.

## 0. Read order and freeze rule

Read in this order and do not skip ahead:

1. `design/<slug>/artifact.html` — the rendered source of truth.
2. `tokens.css` — values copied verbatim from the artifact.
3. `HANDOVER.md` — DOM/class contract, behavior and acceptance checks written by
   the design agent.
4. `TOKENS.md` — roles, measured contrast, motion and exclusions (description,
   never a spec override).
5. This contract, then the framework guide.

**Freeze rule:** a port preserves the artifact. It does not improve spacing, swap
fonts, add a component library, normalise radii, or "clean up" states. Every
deviation is either approved in `HANDOVER.md` or recorded as a known limit. If the
artifact and this contract disagree, the artifact wins and the contract is stale.

**Entry condition:** the artifact is final, the critique is closed, every open
finding is either applied or explicitly accepted, and `tokens.css` matches the
artifact. A port of a moving design is a rewrite.

## 1. From artifact to component tree

### 1.1 Node classes

Classify every meaningful element into one of four levels before naming anything:

| Level | Definition | Becomes |
|---|---|---|
| Page | Document shell, landmark structure, global theme scope | Layout/route file |
| Region | A landmark or a large section with one job (`header`, `main`, `aside`, `section`) | Section component or layout slot |
| Component | Repeated, stateful, or independently testable unit | One component file |
| Primitive | Styling-only leaf used inside components (icon, badge, label) | Inline markup or a tiny component |

### 1.2 Extraction rules

Componentise when at least one is true:

- the same structure appears two or more times with different content;
- the unit owns state or an interaction (expander, tabs, form field, dialog);
- the unit has its own accessibility contract (combobox, menu, dialog);
- the unit is tested or snapshotted on its own.

Do **not** componentise when all are true: it appears once, holds no state, and
exists only to position children. A wrapper `<div>` is cheaper than a component
with no API.

Never collapse a semantic boundary to reduce file count. A `<button>` that becomes
a `<div class="btn">` is a regression even if it looks identical.

### 1.3 Tree notation

Write the tree before the code. Use indentation, element names and component
names; mark slots with `[slot]` and repeated siblings with `×N`.

```text
App
└─ PricingPage
   ├─ SiteHeader
   │  ├─ Brand
   │  └─ Nav [slot: actions]
   ├─ PricingHero
   │  ├─ Eyebrow
   │  ├─ Heading
   │  └─ BillingToggle (stateful: monthly | annual)
   ├─ PlanGrid
   │  └─ PlanCard ×3 (props: name, price, features[], featured)
   │     └─ [slot: action] -> Button variant="primary"
   ├─ FaqList
   │  └─ FaqItem ×5 (stateful: open)
   └─ SiteFooter
```

Rules:

- The tree is the file layout. If the tree has four levels, the folder should not
  have six.
- Name by role, not by appearance: `SiteHeader`, not `BlueStrip`.
- Keep `×N` counts visible; they justify the component boundary and later become
  test fixtures.

### 1.4 DOM and class contract

The artifact's classes are hooks, not a public API. Translate them into one of:

| Artifact pattern | Implementation |
|---|---|
| Structural class (`.card`, `.card__body`) | Component root + named elements; BEM is optional, semantics are not |
| State class (`.is-open`, `.is-active`) | State attribute (`data-state="open"`) or a prop-driven class, not a one-off modifier chain |
| JS hook (`[data-od-id]`, `js-*`) | Preserve as `data-*` attributes during migration; delete only after the behavior moves into the component |
| Utility class | Keep as utilities or fold into the component's own styles; do not mix three naming systems |

Every class that had behaviour in the artifact must map to a prop, a state or a
callback in the component. A class that only carried paint maps to a style rule.

### 1.5 File layout (framework-neutral)

```text
src/
  components/
    <Component>/          # one folder per component with internal styles/tests
  sections/               # regions composed from components
  layouts/                # page shells
  styles/
    tokens.css            # copied from design/<slug>/tokens.css
    base.css              # reset + element defaults only
```

Colocate tests and stories with the component. Global styles stay global: a reset,
tokens and element defaults. Everything else is owned by a component.

## 2. Props and API surface

Derive props from variation, not from markup:

| Variation in the artifact | Prop | Type | Notes |
|---|---|---|---|
| Repeated block with different copy | content props (`title`, `body`) or children | string / node | Children for composition, props for fixed strings |
| Two visual treatments of one structure | `variant` | union (`"primary" \| "ghost"`) | One prop per axis |
| Size classes | `size` | union (`"sm" \| "md" \| "lg"`) | Tied to token scale |
| On/off affordance (icon, badge) | `boolean` | boolean | Default documented |
| Nested icon/avatar | slot or `ReactNode` | node | Never pass raw SVG strings through layers |
| Link vs button | `as`/`asChild` or an element prop | element | Keep semantics selectable |
| Open/closed | controlled + uncontrolled pair where reusable | boolean + callback | Otherwise keep state internal |

API rules:

- Prefer `children` for arbitrary composition and named props for fixed content.
- No `style` prop for design decisions; a component that needs arbitrary styles is
  not finished.
- No prop that merely toggles a class string (`className="is-blue"`). Props express
  intent.
- Document defaults in the component's doc comment or a table in the handover.
- Keep the API smaller than the Figma component set. Variant axes that only exist
  in Figma for authoring convenience do not all deserve props.

## 3. State and behavior

### 3.1 State categories

| Category | Examples | Owner | Test |
|---|---|---|---|
| Visual interaction | hover, focus-visible, active | CSS pseudo-classes | Keyboard and pointer pass |
| Component state | open, selected tab, expanded row | Component | Unit test the transition |
| Form state | value, touched, error, pending | Form layer (component or form lib) | Validation + submit path |
| URL state | filters, pagination, tab deep link | Router | Back/forward restores |
| Server state | data, loading, error, empty | Data layer | Render each branch |
| Persisted preference | theme, density | Storage + root scope | FOUC-free first paint |

### 3.2 Decision rules

- If the artifact has no visible state change, do not invent local state; wire
  only the behavior `HANDOVER.md` documents.
- Lift state only when a sibling or ancestor needs it. Otherwise keep it local.
- Prefer derived values over duplicated state (`isValid = email.length > 0`, not a
  second `useState`).
- Model async as a discriminated state (`idle | loading | success | error`) rather
  than independent booleans; impossible combinations disappear.
- URL state is required when the artifact shows deep-linkable tabs, filters or
  pagination. It is optional otherwise.
- Never let two sources of truth exist for the same control (a prop and a DOM
  attribute, a store and a local copy).

### 3.3 Behavior contract

The port is done when this table, filled from `HANDOVER.md`, passes:

| Input / event | Behavior | Keyboard | Notes |
|---|---|---|---|
| Click trigger | toggles panel | Enter/Space | — |
| Escape | closes topmost layer, returns focus | Esc | Focus restoration is required |
| Arrow keys in menu | moves active item | ↑/↓/Home/End | roving focus or `aria-activedescendant` |
| Submit | validates, then submits | Enter in field | Errors announced |

One row per interaction. "Hover changes color" belongs in the state matrix, not
here; behavior means something happens.

## 4. Token mapping

`tokens.css` is the only design source. Three legal integration strategies:

| Strategy | How | Use when | Cost |
|---|---|---|---|
| CSS custom properties (default) | Import `tokens.css`, consume `var(--bg)` in component CSS | Always | None |
| Framework theme layer | Map tokens into a Tailwind/theme config that emits the same vars | Project already uses a utility system | Duplicate source risk; generate, don't hand-write |
| Preprocessor variables | Sass/Less maps generated from tokens | Legacy build | Rebuild on token change; avoid for new work |

Mapping table to fill once and keep in the handover:

| Artifact token | CSS var | Utility / class (if any) | Used by |
|---|---|---|---|
| `--bg` | `var(--bg)` | `bg-bg` | Page, layout |
| `--surface` | `var(--surface)` | `bg-surface` | Card, panel |
| `--fg` | `var(--fg)` | `text-fg` | Body |
| `--muted` | `var(--muted)` | `text-muted` | Metadata |
| `--accent` | `var(--accent)` | `bg-accent` | Primary action |
| `--space-4` | `var(--space-4)` | `p-4` | Component padding |

Rules:

- No raw hex, `rgb()`, `hsl()` or magic px in component code. The design linter
  enforces the hex half; review enforces the rest.
- Do not add tokens during the port. If something is missing, stop and ask; a new
  token is an owner decision.
- Dark mode is a scope override, not a component branch. Components consume
  semantic vars only.
- Density and brand modes follow the same rule: override at the scope root.
- If the project must support a second design system, namespace tokens
  (`--brand-*`) rather than forking components.

## 5. Styling strategy

- Keep authored CSS and utilities separate by layer: reset/base, tokens, layout,
  components, utilities. CSS `@layer` is the cleanest expression where supported.
- Scope global selectors to the app root. A port must not restyle the host page.
- Specificity budget: one class per rule, no `!important` except documented
  third-party overrides.
- Motion: use the token durations/easings, animate transform/opacity only, and
  wrap every non-essential animation in `prefers-reduced-motion`.
- Responsive: keep the breakpoints chosen in the artifact. Prefer container
  queries for components reused at different widths.
- Never port `transition: all` or `outline: none` without a focus-visible rule;
  both are lint findings and real defects.

## 6. Accessibility contract

Non-negotiable, checked before visual parity:

| Area | Requirement |
|---|---|
| Landmarks | One `main`; `header`/`nav`/`footer` where the artifact has those regions; skip link if the page has nav |
| Headings | Exactly one `h1` per page; no level skipped; heading order follows reading order, not visual size |
| Names | Every control has an accessible name; icon-only buttons use `aria-label`; images have meaningful `alt` or empty `alt` when decorative |
| Semantics | Buttons are `button`, links are `a[href]`, lists are lists, tables are tables; no click handlers on bare `div` |
| Keyboard | Full tab order in visual order; no traps; Escape closes overlays and restores focus |
| Focus | `:focus-visible` visible on every interactive element, contrast ≥ 3:1 against the adjacent surface |
| State | `aria-expanded`, `aria-selected`, `aria-current`, `aria-busy`, `disabled` reflect real state |
| Contrast | Text ≥ 4.5:1, large text ≥ 3:1, control boundaries ≥ 3:1, measured from tokens per mode |
| Motion | `prefers-reduced-motion` honoured; no essential information only in animation |
| Targets | ≥ 24×24 CSS px minimum, 44×44 for primary mobile actions |
| Forced colors | Content remains visible with system colors; do not rely on background images for meaning |

ARIA is a last resort. A native element that already announces the right thing
beats `role` plus handlers.

## 7. Assets, fonts and icons

- Icons: inline SVG, `currentColor`, no fixed dimensions, `aria-hidden` unless
  they carry the only label.
- Images: explicit `width`/`height` or `aspect-ratio`, responsive `srcset` where
  the artifact exports multiple sizes, `loading="lazy"` below the fold.
- Fonts: self-host only with a licence; load the weights used; declare fallbacks;
  avoid layout shift by matching fallback metrics or using `font-display:swap`
  deliberately.
- Every asset keeps the provenance row from the design handover (source, licence,
  node ID). Do not add stock assets during the port.

## 8. Parity acceptance

Measured, not eyeballed:

1. Side-by-side at 1440, 1024, 768, 390 and 360 px; no horizontal scroll at any
   width.
2. Computed styles match tokens for background, text, border and radius on the
   primary components.
3. No raw color literals in component source.
4. Every state in the handover matrix renders and is reachable (keyboard for
   focus, pointer for hover).
5. Keyboard-only pass completes the page's primary task.
6. Contrast re-measured per mode; the numbers match `TOKENS.md`.
7. Reduced motion removes non-essential transitions.
8. No console errors or failed network requests on load.
9. Bundle budget agreed before the port is not exceeded by more than 10%.
10. Visual regression snapshots exist for the page and each stateful component.

## 9. Do not

- Do not regenerate the design from taste; port the artifact.
- Do not add a component library, animation library or CSS-in-JS runtime that the
  project does not already use.
- Do not invent breakpoints, tokens, states or copy.
- Do not flatten semantic elements into styled `div`s.
- Do not drop a state because it is hard to reach in the artifact.
- Do not copy `HANDOVER.md` prose into code comments; link it instead.

## 10. Handoff record

Attach this to the port PR or ticket:

| Field | Value |
|---|---|
| Artifact | `design/<slug>/artifact.html` @ commit |
| Tokens | `tokens.css` @ commit |
| Token drift | none / list |
| Components created | list |
| Components deferred | list + reason |
| States missing/approved | list |
| A11y exceptions | list + reason |
| Visual deltas approved | list + approver |
| Framework guide used | react / next / vue |

A port with no record is not reviewable.
