# Brief: support queue dashboard

Build a single self-contained `index.html` dashboard for a support team lead who
opens it at 9am to decide what to clear first. No frameworks, no external assets.

Required content and structure:

- A `main` region with one `h1`, a one-line summary of open tickets, and a filter
  bar. The filter bar must include a real search input (`type="search"`) and a
  priority select.
- A data table of 8–12 tickets: one `<table>` with a `<caption>`, `<th scope="col">`
  headers, and columns for ticket, customer, priority, age and status. Status must
  use text plus color, never color alone.
- Row actions: assign and open. Buttons must be real `button` elements with
  accessible names.
- The summary line lives in an `aria-live="polite"` region and reflects the
  current filter.
- A separate empty state with `id="empty-state"`, shown when the filter matches
  nothing. It must be hidden by default, not deleted.
- Loading and error copy may be represented as inert markup, but the table must be
  the populated state.

Constraints:

- Sensible density: 8/16/24/32 spacing tiers; tabular numerals for ages/counts.
- Keyboard navigable; visible `:focus-visible`; reduced-motion respected.
- Responsive: the table scrolls inside its own container on narrow screens; the
  page itself never scrolls horizontally.
- No invented metrics (no "99.9% uptime"), no placeholder copy, no dead links.

Write the file to the exact output path the harness gave you.
