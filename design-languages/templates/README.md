# Starter templates

Three self-contained HTML starters for the common design deliverables: a briefing
deck, a live dashboard and a mobile flow. Original work, written for this pack.
No frameworks, no build step, no external requests — open a file in a browser and
it works offline.

| Template | Id | Kind | Path | What it demonstrates |
|---|---|---|---|---|
| Four-slide deck starter | `template-deck` | `deck` | [`deck/deck.html`](deck/deck.html) | 16:9 slides, keyboard navigation, progress + dot controls, print output at one slide per page |
| Live KPI dashboard starter | `template-live-dashboard` | `live` | [`live/dashboard.html`](live/dashboard.html) | KPI tiles, inline SVG chart with a window switch, data-table fallback, deploy log, service bars |
| Three-screen mobile prototype | `template-mobile-prototype` | `prototype` | [`prototype/mobile.html`](prototype/mobile.html) | Three-screen mobile capture flow, state switching, focus management, disabled / selected / success states |

`manifest.json` lists the three templates for tools that need a machine-readable index.
Each entry is `{id, title, kind, path, description}`, where `path` is relative to this
directory. The ids match the pack's addon registry
(`design-languages/addons/index.json`, section `templates`), so a tool can resolve an
addon entry to a file without a second naming scheme.

## Quick start

1. Copy the template you need next to your project work, e.g.
   `cp design-languages/templates/deck/deck.html design/briefing.html`.
2. Change the tokens in `:root` first — that is the cheapest way to make it yours.
3. Replace the content, keeping the structure and the accessibility wiring.
4. Validate before shipping:
   ```bash
   node design-os/tools/design-lint.mjs --strict path/to/artifact.html
   ```
   With Playwright installed, `design-os/tools/measure-artifact.mjs --strict` also
   checks clipping, rendered contrast and tab stops.

## Token contract

All three files use the same small token vocabulary, so a change made in one file can
be carried to the others without renames:

- `--accent` — the one accent colour; use `--mark` for repeated chrome (dots, bars,
  chart marks) so the accent stays rationed.
- `--tint` — the accent's quiet surface (selected chip, badge, area fill).
- `--ink`, `--ink-soft`, `--ink-faint` — text hierarchy; `--paper`, `--surface`,
  `--line` — surfaces and rules.
- `--font-display` (serif, system-resident), `--font-body` (system sans),
  `--font-mono` (system mono). No webfonts are loaded, by design.

Change the accent in one place; if a template needs a second brand colour, add a role
token rather than hardcoding a hex in a component rule.

## What to change per template

**Deck.** Four `<section class="slide">` blocks; `data-layout="title|split|columns|close"`
sets the grid. Navigation lives in the script: arrow keys, Page Up/Down, Space, Home and
End, plus the buttons and dots. Keep every slide a `<section>` with `aria-roledescription="slide"`
and a unique `aria-label`; the script mirrors the slide's `aria-hidden`. The print block
at the end of the stylesheet prints one 16:9 page per slide — verify with print preview
before sending a PDF.

**Dashboard.** The KPI tiles are static markup; the chart is drawn from the `SERIES`
object in the script (`"7"`, `"30"`, `"90"`), so adding a window means adding one entry
and one button. The data table is generated from the same arrays, which keeps the
accessible fallback honest. The deploy table and service bars are plain markup.

**Mobile flow.** Three `<section class="screen">` blocks inside `.stack`; only one is
visible at a time via the `hidden` attribute. `show(name)` in the script owns the switch
and moves focus to the new screen's heading. The preview device frame is presentation
only — below 520px the app is full-bleed. Keep the 44px minimum target size and the
`aria-pressed` / `role="switch"` state mirrors when you swap in real components.

## Constraints (keep these when adapting)

- **One file per screen set.** Inline `<style>` and `<script>`, no imports, no CDNs.
- **No external requests.** No webfonts, images, icon packs or analytics; draw with CSS
  and inline SVG. This is what makes the templates safe in offline harnesses and
  sandboxed previews.
- **Synthetic content, labelled.** Names, dates and figures are illustrative; the
  dashboard and mobile flow say so in the UI. Do not ship sample data as real.
- **Semantic structure.** One `h1` per document, headings in order, `<table>` for tabular
  data, `<button>` for actions (no clickable `div`s), visible `:focus-visible` on
  everything interactive.
- **Motion is optional.** Every transition has a `prefers-reduced-motion` block. If you
  add motion, extend that block.
- **Stable hooks.** Meaningful regions carry `data-od-id` so review and inspect tooling
  can target them. Keep the existing ids when you adapt a template.

## Print

Only the deck has a dedicated print stylesheet: `@page { size: 16in 9in }`, one slide per
page, chrome hidden, all four slides forced visible. The dashboard prints as a normal
document; collapse it to a single column first if you need a paper version. The mobile
prototype is not meant to be printed.

## Notes for maintainers

- These files are not part of the design-language packages under
  `design-languages/design-systems/`; they are starters, not tokens.
- The `design-languages` npm package lists its published files in
  `design-languages/package.json` (`files`). That list does not yet include
  `templates/` — add it there when the pack is next published, so the starters ship with
  the pack. This directory intentionally does not edit that file.
- If you add a template, add it to `manifest.json` and to the table above in the same
  change.
