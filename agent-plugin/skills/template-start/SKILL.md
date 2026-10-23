---
name: template-start
description: Start a deck, live dashboard or mobile prototype from an addon template, then adapt it to a numeric brief. Use when the user wants a running starting point quickly instead of a blank file.
---

# Template start

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

A starter is scaffolding, not the design. The brief decides the artifact; the
template only saves the first hour.

## 1. Brief before template

Fill `.design-os/briefs/BRIEF.md` (use the `design-brief` skill for a full run)
and name the deliverable type and exact sizes: slide pixels for a deck, container
and cell sizes for a dashboard, viewport sizes for a prototype. A template chosen
before the brief is a guess.

## 2. Load the catalog

Call `dezign0_addons`:

- `{ "action": "list", "section": "templates" }` to see every starter;
- `{ "action": "search", "section": "templates", "query": "deck" }` when the kind
  is known (deck, dashboard, mobile, prototype);
- `{ "action": "get", "id": "template-deck" }` to read a file. Ids and shapes:
  `template-deck` (16:9, four slides plus slide controls),
  `template-live-dashboard` (KPI row, inline SVG chart, data table),
  `template-mobile-prototype` (three screens, tab bar, safe areas).

If no addon pack is installed, say so and build from the brief without a
starter; never invent a template. In a source checkout the same content is at
`design-languages/templates/`: `deck/deck.html`, `live/dashboard.html`,
`prototype/mobile.html`.

## 3. Copy, do not edit in place

Copy the returned file to `design/<slug>/<name>.html`. Keep the pack and the kit
pristine. The copy is now yours to change.

## 4. Adapt it

- Replace the starter's tokens with the brief's brand `DESIGN.md`/tokens or a
  declared direction; change every token, not only the accent.
- Replace sample content with real or labelled content. No lorem, no fake metrics.
- Add the states the template lacks; keep every control real. Keep the
  `data-od-id` hooks: they are the review and handoff contract.
- Test 320 / 375 / 390 / 768 / 1024 / 1440. Remove remote requests and inline
  what you add.
- For a deck, keep 16:9 and readable type at presentation size. For a mobile
  prototype, keep safe areas, tab bar and focus states.

## 5. Verify

- `dezign0_lint` on the artifact; fix P0 findings.
- If Playwright is available, `dezign0_measure` with the brief's `viewports`,
  `a11y: true`, and `strict: true` before shipping.
- Open the file from disk: no console errors, no external requests.

## Evidence

Report: addon id and path used; what was kept from the starter; what changed
(tokens, copy, states, sizes); token source; measurement command and counters;
what could not be verified. Label any starter data still present as sample.

## Anti-patterns

- Shipping the starter unchanged, or with its example brand and copy.
- Picking the template by looks before the brief.
- Editing the addon pack or the installed `.design-os/` copy.
- Adding a CDN, icon script or framework to make the starter "nicer".
- Claiming a render, state or measurement that did not run.

## When not to use

Do not use when the task needs an original direction rather than a starting
point; use `frontend-design` with `design-brief`. Do not use for an existing
interface to improve (`redesign`) or a state inventory (`state-board`). Do not
use when no addon pack is installed and the user does not want one.
