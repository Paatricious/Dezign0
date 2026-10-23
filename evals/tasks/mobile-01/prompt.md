# Brief: mobile ride receipt screen

Build a self-contained `index.html` screen for a ride-hailing app: the receipt
shown immediately after a trip ends, on a 390px-wide phone. No frameworks, no
external assets.

Required content and structure:

- A `main` with one `h1` ("Trip complete"), a receipt card showing route, driver,
  vehicle, duration, distance and total. Totals are readable and right-aligned.
- A fare breakdown table or definition list with the base fare, distance, time,
  service fee and total; totals use tabular numerals.
- A primary action pinned to the bottom of the viewport ("Done") plus a secondary
  "Get help" action. The pinned bar must sit above `env(safe-area-inset-bottom)`
  and must not cover the last receipt row.
- A rating prompt: five real buttons with accessible names and a visible selected
  state, updatable, announced politely.
- A tip selector (three amounts plus custom) using real radio inputs with labels.
- States: default, submitting (disabled actions with a status message), and a
  thanked state after rating. Only the default state must be rendered initially.

Constraints:

- Touch targets at least 48×48px; primary action reachable with one thumb.
- No font smaller than 12px; body text 16px.
- Page must not scroll horizontally and must respect bottom safe areas.
- Visible `:focus-visible`; reduced motion honoured; no color-only meaning.
- No placeholder copy, no TODO markers, no dead links.

Write the file to the exact output path the harness gave you.
