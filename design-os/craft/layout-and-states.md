# Layout, states and interaction

Two failures account for most "AI UI": layouts that drift and surfaces that only
design the happy path. Fix both structurally.

## Layout mechanics

### Hierarchy

- Make the page goal, main content and primary action visible at first glance.
- Build hierarchy with size, weight, color, whitespace, alignment, contrast and
  position before borders, cards or decoration.
- One dominant element per region. Two competing focal points means neither is
  dominant.
- Give every section one job. A section with two unrelated jobs becomes two
  sections.
- Keep a stable reading order and stable anchors across pages and states.

### Spacing

- Pick a base unit (4 or 8px) and use a closed set of steps.
- Proximity: 8–12px within a group, 32–48px between groups. The gap must be
  larger between groups than within them, or the grouping is invisible.
- Common region: a card grouping items needs ≥16px padding and a visible
  boundary (border, tint or shadow), or items will not read as one unit.
- Related controls sit closer together than unrelated ones. Do not use equal
  spacing everywhere; equal spacing removes hierarchy.
- Reserve padding for fixed headers, bars and floating controls. Content must
  not hide beneath them.

### Grid and alignment

- Align to a grid. Intentional asymmetry is fine; accidental 1–3px drift is not.
- Use a consistent container width and gutters. Full-bleed is a deliberate
  exception, not a way to escape alignment.
- Cards in a row share height and internal rhythm unless the content genuinely
  differs.
- Do not center long body copy. Do not justify it.
- Reflow, do not scale. Text and controls keep readable sizes at every width.
- Responsive breakpoints are 375 / 768 / 1024 / 1440 by default. Each breakpoint
  reorganizes content; it does not scale the page. Mobile never scrolls
  horizontally and never disables zoom.
- "No horizontal scroll" is not enough: no content may be clipped or unreachable.
  `overflow-x: clip` on `html`/`body` makes the overflow test pass while hiding
  the bug. Check every element's right edge against the viewport in a browser;
  only deliberate horizontal rails may scroll.

### Integrity

- Nothing may overlap, clip or overflow unintentionally. Test the longest
  strings, largest numbers, empty fields and the narrowest width.
- Truncation is a decision: if a name must be distinguishable, wrap or reflow;
  if it truncates, keep a way to reveal the full value.
- Keep content in normal flow. Absolute positioning is for overlays, not page
  structure.
- Icon geometry is owned by an icon class/token, not by scattered parent
  selectors. Charts need a real viewport and bounds.

## The five data states

Every surface that fetches, transforms or accepts data must render all five.

| State | Trigger | Must contain |
|---|---|---|
| Loading | Data in flight | Skeleton/spinner/shell; a "taking longer than expected" fallback at 15s |
| Empty | No records / no results | Headline, plain explanation, primary action |
| Error | Fetch/validation failure | What happened, why if knowable, recovery action, preserved input |
| Populated | Primary case | The real design |
| Edge | Extreme volume, long strings, missing fields, RTL, partial network | Layout that holds |

A populated-only surface is not designed. Missing states are the most common
silent failure.

### Empty state composition

- First use: illustration or mark + headline + value sentence + primary CTA.
- No results: echo the query, suggest alternatives, do not show a blank.
- Cleared: celebratory or calm phrasing, optional next action.
- Error is not empty. Never collapse an error into an empty state.

### Error composition

Answer three questions in order:

1. What happened. "Card declined", not "Something went wrong".
2. Why, if knowable. "Insufficient funds", "Network unreachable".
3. What can the user do. Retry, alternative path, support.

Preserve user input on failure. Match severity to scope: field-level, form-level,
section-level, page-level, app-level. A field error does not justify a page error.

Retry behavior: foreground retry immediate; subsequent retries back off 2s, 4s,
8s; after three failures replace Retry with "Contact support" plus a copyable
error ID. Show "last attempted Xs ago".

### Loading thresholds

| Expected duration | Indicator |
|---|---|
| 0–300ms | None; render synchronously |
| 300ms–2s | Subtle spinner or skeleton |
| 2–10s | Skeleton matched to layout, or labelled spinner |
| 10–30s | Determinate progress + cancel |
| 30–60s | Progress + explicit cancel; 15s notice already shown |
| 60s+ | Stop animation; error with retry/cancel |

Never leave a spinner running indefinitely. Start a timeout on every request.

## Interaction states

Design all that apply:

- **Default**: resting state.
- **Hover**: only where a pointer exists; must not be the only affordance.
- **Focus-visible**: visible, ≥3:1, not removed, not animated away. Keyboard
  users must always know where they are.
- **Active/pressed**: a small physical response (translate 1–2px, shadow
  change), not a layout shift.
- **Selected**: persistent state, not just a hover color. Use a shape or icon in
  addition to color when selection matters.
- **Disabled**: visibly unavailable and not focusable; must still be readable if
  the user needs to know why.
- **Loading**: control locks against double submit; spinner or label change.
- **Success/failure**: feedback adjacent to the action, announced appropriately.

### Forms

- Persistent visible label; placeholder is never the label.
- Required fields marked; optional fields marked too when most are required.
- Validate on blur. For password/live fields, validate on keystroke only after
  first blur.
- Show a loading state during submit; keep fields locked until resolution.
- Do not clear fields on validation failure.
- Inline error has text + icon, not color alone. Move focus to the first error.
- Keep feedback IDs consistent with the rendered input IDs; null-safe optional
  nodes.

### Overlays

- Use a native `<dialog>` with `showModal()` where possible.
- Enter and exit have explicit paths; return focus on every close path.
- Do not reveal a stale review after closing an editor; use current values.
- A hidden dialog must stay hidden even if its class uses flex/grid. Do not
  override the native hidden state.
- Escape closes; a visible close control exists; focus is trapped while open.

### Navigation

- Single line on desktop; condense or move secondary items before wrapping.
- Current location has an obvious selected state.
- Preserve scroll position and entered content when returning.
- Do not use a modal for navigation.

## ARIA and announcements

| Change | ARIA | Focus |
|---|---|---|
| Inline error on submit | `role="alert"` | Move to first error field |
| Toast/confirmation | `role="status"` (polite) | Do not move focus |
| Critical/destructive | `role="alertdialog"` | Move into dialog |
| Loading begins | `role="status"` ("Loading…") | Do not focus spinner |
| Loading ends | — | Move to loaded content if user-initiated |

Live region containers must exist in the DOM before content is injected.
`aria-live` added at the same moment as content often does not announce.

## Common failures to lint

- Only the populated state exists.
- Empty is a blank or "No data" with no action.
- Error says "Something went wrong" with no cause or recovery.
- Spinner has no timeout.
- Submit clears fields on failure.
- Inline validation fires on first keystroke.
- Full-page loading for one section.
- Color-only error.
- Toast auto-dismisses without pause on hover/focus.
- Focus lost after a list rebuild, delete or dialog close.
