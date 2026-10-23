# Brief: landing page for an invoicing tool

Build a single self-contained `index.html` landing page for "Ledgerly", an
invoicing tool for freelancers. No build step, no external assets, no
frameworks.

Required content and structure:

- Hero in the first viewport: one `h1` (maximum two lines on desktop), subtext of
  20 words or fewer, and one primary CTA linking to `#start` ("Start free").
  A secondary CTA may exist but must be visually subordinate.
- `#how-it-works`: three numbered steps with real copy, not filler.
- `#pricing`: three plans with prices, one marked as recommended, and a clear
  per-plan action.
- `#faq`: four real questions and answers, each expandable or readable inline.
- Proof: a short customer quote with an attributable role, plus one inline SVG
  illustration or diagram. No fake logos, no invented metrics, no "trusted by
  thousands" claims.
- Header with a `nav`, footer with legal links.

Constraints:

- Landmarks: `main`, `nav`, `footer`; one accent color declared as `--accent` in
  `:root` and used sparingly.
- Responsive from 360 to 1440 px, no horizontal scroll, mobile reading order
  preserved.
- Every image has `alt`; every link has a destination other than `#`.
- No placeholder copy, no TODO markers, no invented statistics.

Write the file to the exact output path the harness gave you.
