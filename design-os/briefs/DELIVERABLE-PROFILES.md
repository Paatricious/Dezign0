# Deliverable profiles

The same Design OS applies to every artifact, but each deliverable type has a
different quality floor. Pick one profile and read its "required" list before
building. These are defaults; explicit user requirements outrank them.

---

## Prototype / web app

**Resolve:** surface, device, audience, primary flow, screens, interaction
states, fidelity, content locks, brand references, output format.

**Required**
- A stable runnable entry (usually `index.html` or a semantic filename).
- Every step of the core flow implemented. Controls are real, not decoration.
- Interaction states: default, hover, focus-visible, active, selected, disabled,
  loading, empty, error, success. Overlays have enter/exit/return.
- Focus management: dialogs focus after visible; return focus on every close;
  list rebuilds point at the new equivalent control.
- Real local state; button actions do not depend on hash/navigation. Local add/
  save uses a click handler plus Enter, not only form submit.
- Keyboard path, semantic controls, accessible names, non-color status cues.
- Responsive at 320/375/390/768/1024/1440; reflow not scale; no horizontal scroll; fixed
  bars reserve padding.
- Quality floor: no overflow/clip; image geometry; icon geometry; contrast
  ≥4.5:1 body; dark mode chosen independently; locked content untouched.

**Fails when:** it is a poster, only the populated state exists, controls do
nothing, or the mobile layout hides the primary action.

---

## Marketing / landing page

**Resolve:** product, audience, one value proposition, primary CTA, proof,
reference/brand, tone, sections, output format.

**Required**
- The hero fits the first viewport: headline max two lines on desktop; subtext
  ≤20 words and ≤4 lines; CTA visible without scroll.
- One primary CTA per section group; secondary CTAs are visually subordinate.
- A clear narrative order: value → proof → detail → objection handling → final
  CTA. Not a generic hero/features/pricing/FAQ skeleton by default.
- Real content: no invented metrics, no fake logos, no placeholder copy. Sample
  data labelled.
- At least 2–3 real visual assets, or labelled slots. No div-based fake product
  screenshots.
- Type and color follow the brand; display/body roles are distinct; one accent.
- Responsive: no horizontal scroll; mobile reading order preserved; navigation
  single line on desktop.
- SEO/structure basics: one h1, landmarks, alt text, meta title/description if
  the harness can set them.

**Fails when:** hero overflows, text is filler, three equal feature cards are the
only structure, or the page has no real image.

---

## Dashboard / data UI

**Resolve:** operator and job, data sources, refresh model, primary decisions,
key metrics, density, permissions, empty/error behavior.

**Required**
- The primary operational question is answerable at a glance. One dominant
  region; not twelve equal cards.
- Data states: loading, empty, error, populated, edge (10k+ rows, long strings,
  missing fields, negative/zero values). No stale totals.
- Numbers: consistent formatting, units, locale, tabular numerals. Zero is not
  positive growth.
- Charts: real SVG/canvas, axes and units labeled, no invented series, no
  truncated axes that distort. Legend or direct labels.
- Tables: sortable/filterable only if real; sticky headers; row actions clear;
  empty and no-results are distinct.
- Density: 8/16/24/32 spacing tiers; dense does not mean small type.
- Status: color plus icon/text; no color-only state.
- Keyboard navigation and focus; modals for destructive actions with explicit
  confirm; undo where possible.
- Performance: virtualize long lists; avoid per-row timers; no layout thrash.

**Fails when:** the only state is a populated grid, metrics are fake, or charts
are decorative.

---

## Presentation / deck

**Resolve:** audience, setting, duration, narrative, key asks, brand, aspect
ratio, export format.

**Required**
- One idea per slide; the slide title states the takeaway.
- A through-line: opening, context, evidence, proposal, ask. No random section
  order.
- Type scale readable at presentation size; body never below ~18–20px equivalent;
  max 5–7 lines per slide.
- Charts and diagrams real; no screenshot-of-a-table when a table is clearer.
- Consistent margins, grid, page numbers, footer/attribution.
- Keyboard navigation and a presenter path if interactive; print/PDF fallback.
- Images real or labelled; no fake logos.
- No decorative section-numbering or eyebrow on every slide.
- Export: verify the actual exported PDF/PPTX if the harness can; else say not
  verified.

**Fails when:** slides are paragraphs, the deck has no narrative, or it only
works on one screen size.

---

## Document / report

**Resolve:** reader, decision, length, structure, brand, output format (HTML,
DOCX, PDF), citations.

**Required**
- Executive summary first; the reader can stop after it.
- One section, one job; headings form a readable outline.
- Body measure 50–75ch; type scale; generous but consistent spacing.
- Tables and figures numbered/labeled; sources cited; no invented figures.
- Print/PDF behavior: page breaks, widows/orphans, clickable TOC, headers/
  footers.
- Accessibility: headings, alt text, table headers, language, reading order.
- Real content or labelled placeholders; no lorem ipsum.
- Version/date/owner visible if it is a working document.

**Fails when:** it is a wall of text, numbers are unsourced, or the print output
breaks.

---

## Cross-profile quality floor

Every deliverable:

- opens at the requested path/format and has no broken assets;
- has one clear design direction;
- uses the brand tokens, or a declared direction if no brand exists;
- has no overlap, clipping, horizontal scroll or dead controls;
- meets contrast, focus, labels and reduced-motion basics;
- has real or labelled content, never invented claims;
- names its assumptions and known gaps in the response.

When a profile and the Design OS disagree, follow the user first, then the brand
tokens, then the Design OS/craft rules, then the profile. `DESIGN-OS.md` is
canonical.
