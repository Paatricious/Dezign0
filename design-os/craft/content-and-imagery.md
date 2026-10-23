# Content and imagery

Design is made of content. Placeholder text and stock decoration are not neutral;
they hide whether the design works.

## Copy

- Use real, brief-derived copy. If the brief does not provide it, write plausible
  copy for the domain and label it as proposed.
- Never ship `lorem ipsum`, "Feature one / two / three", "Placeholder text",
  "Sample content", or "Your headline here".
- Do not invent numbers, testimonials, logos, customer names, uptime, ratings or
  claims. Use a real source, a labelled placeholder, or omit the element.
- Use specific nouns and verbs. "Start tracking", "Review the invoice", "Invite
  a teammate" beat "Get started", "Learn more", "Elevate".
- Avoid filler verbs: elevate, seamless, unleash, next-gen, revolutionize,
  empower, supercharge.
- Microcopy is design: labels, empty states, errors, confirmations and helper
  text must be written with the same care as the headline.
- Error copy: what happened, why if knowable, what to do next. Preserve input.
- Keep one voice. Formal/playful/technical should be consistent across buttons,
  headers and errors.
- Use sentence case for body and controls unless the brand says otherwise.
  Uppercase is for short labels and eyebrows only.
- Do not use the em dash as a decorative separator in UI copy. Use a period,
  comma, colon or parentheses. (This is a style policy; a brand may override it.)

## Numbers and data

- Use realistic distributions, not perfect numbers. `47.2%`, `€1,284`, `+1 (312)
  847-1928`, `14–18ms` read as real; `99.99%`, `50%`, `1234567` read as filler.
- Label sample data on the artifact or in a nearby note ("Sample data for layout
  review").
- Format numbers consistently: locale, currency, decimals, units. Use tabular
  numerals for changing values.
- A zero is not a positive balance or growth. Distinguish no records, zero net,
  positive and negative.
- Charts must use the same values as the numbers beside them. No stale series.
- Do not invent a comparison ("3× faster") unless the brief supplies the
  measurement.

## Names and identities

- Use locale-appropriate, plausible names, not "John Doe", "Jane Smith",
  "Sarah Chan".
- Do not use real people's names, photos or brands without permission.
- Invented brands need invented marks; a plain text wordmark is acceptable only
  when it is intentionally typographic.
- No fake logos. If a logo wall represents a real product, use the real mark
  (with permission and correct asset) or skip the wall.

## Imagery

Priority:

1. Real brand/product imagery supplied by the user.
2. A generated image made for the section (if the harness has image generation).
3. A real, licensed stock/local image.
4. A clearly labelled placeholder slot.

Never:

- pull random hotlinked images from a placeholder CDN in a shipped artifact;
- build fake product screenshots from `<div>` rectangles;
- use hand-rolled decorative SVG illustrations as the hero when a real image is
  available;
- crop or distort a content-bearing image to fit a box.

Image geometry:

- Take the aspect ratio from the intrinsic dimensions of the chosen image.
- A content image renders its full frame; crop only for a deliberate, uniform
  decorative treatment, and say so.
- Cover-crop must be intentional. A product shot, cover art, logo or document
  scan must not be cropped into a strip.
- Check images after downscaling. A square file with black padding above/below
  is not a square image.
- Images need alt text; decorative means `alt=""`.
- Keep image weight reasonable; do not ship 4K assets into a 320px card.

## Icons

- Use one icon family. Monoline SVG, consistent stroke (1.6–1.8px) and corner
  treatment. `currentColor` so icons inherit state colors.
- Do not mix filled and outlined icons without a role split.
- Do not use emoji as UI icons.
- Do not hand-roll complex icons if a complete local set exists.
- Icon-only controls need an accessible name and a visible focus state.
- Size icons with one token/class, not scattered parent selectors.
- Decorative icons are hidden from assistive tech.

## Assets and fonts

- Self-host fonts when the artifact must be offline/CSP-safe. Subset if size
  matters, and record the license.
- No remote runtime dependencies (CDNs, icon scripts, chart libraries) unless the
  user allows them. If allowed, pin the version and state the dependency.
- Every asset has a license and a source. Record both in the artifact or handover.
- Prefer local, deterministic assets over network fetches that can 404.

## Logo walls

- Logos only. No category labels under each logo.
- Use real SVG marks with correct clear space and color treatment.
- Ensure light/dark treatment is intentional.
- If the brand is invented, make an invented mark; do not use a plain text word
  in a row and call it a logo wall.

## Visual honesty test

A reviewer should be able to tell:

- what the product does;
- who it is for;
- what state they are looking at;
- whether the data is sample or real;
- what they can do next.

If any of those depends on inventing content, the design is not finished.
