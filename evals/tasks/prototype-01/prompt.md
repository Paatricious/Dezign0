# Brief: single-screen habit tracker

Build one self-contained HTML file (`index.html`) for a habit tracker used on a
phone at 390 px and on a desktop at 1440 px. No build step, no external assets,
no frameworks.

Content and behavior:

- Four seeded habits (drink water, walk 20 minutes, read 10 pages, stretch).
- Each row shows the habit name, a seven-day streak strip, and a real toggle
  button to mark it done today. Toggling must update the streak and the summary
  count immediately.
- An inline form adds a habit (text input plus submit). Adding must work with the
  submit button and with Enter. Persist habits and today's completion in
  `localStorage`; restore them on reload.
- An empty state appears when there are no habits, with a single call to action
  back to the form.
- Announce changes in a live region so a screen reader user hears the new count.

Constraints:

- Semantic HTML: `main`, one `h1`, a real `form`, real `button` elements.
- Keyboard reachable in reading order; visible `:focus-visible` styling.
- Honour `prefers-reduced-motion`.
- Use CSS custom properties for color, spacing and type; do not hardcode a second
  palette.
- Responsive without horizontal scroll.
- No placeholder copy, no TODO markers, no dead `href="#"` links, no invented
  statistics.

Write the file to the exact output path the harness gave you.
