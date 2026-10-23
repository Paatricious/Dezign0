---
name: state-board
description: Build a single-file board that shows every screen and state of a component or flow at real sizes, with annotations and an optional live prototype. Use when a designer agent needs the full state inventory before a redesign.
---

# State board

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

A state board is a design deliverable, not documentation. It must render real
DOM at real sizes, not screenshots, and it must be honest about what the current
implementation does.

## 1. Inventory the states from source

Do not invent a state list from imagination. Read the component, hook, store or
API:

- lifecycle/phase states;
- interaction states (default, hover, focus, active, selected, disabled,
  loading, error, success);
- data states (loading, empty, error, populated, edge);
- permission/auth states;
- responsive/size variants;
- theme variants (light, dark, brand/accent);
- transition states and error paths.

Record the trigger for each state: what causes it, what the user can do, what
happens next. If the source has a quirk or a dead end, show it and annotate it.

## 2. Measure the real container

Get the actual size(s) from the code or the built product:

- card/container width and height ranges;
- min, default and max grid cells;
- dynamic height behavior;
- actual type scale at the real root size;
- padding, radius, shadows, state colors.

Do not use a nominal size if the built product renders smaller. Measure.

## 3. Build the board

One self-contained HTML file, no network dependencies:

- **Header:** what this is, source paths/commit, how to use, theme switch.
- **State map:** phases and transitions, including cancel/error/retry.
- **Interactive prototype:** a simulated or real flow with timers, cancel,
  error triggers, size presets, and a transition log.
- **State gallery:** every state as live DOM at real size, grouped by lifecycle
  and errors. Each with a trigger, annotations, and the exact action labels.
- **Data variants:** grades, thresholds, history lengths, edge values, copy
  inventory, timestamps.
- **Sizes and surfaces:** real sizes at multiple viewports, light/dark/accent.
- **Anatomy:** measured regions, token values, do/don't.
- **Brief:** what to keep, what to fix, constraints, open questions.
- **Machine-readable manifest:** a JSON script with states, transitions, copy,
  data contract, tokens and constraints for a downstream design agent.

Use the real component's markup and CSS values where possible. If you recreate
the UI, diff it against the built product at the same size; fix until the idle,
loading and error screens match.

## 4. Rules

- Real sizes, no scaling. A 198px card is 198px, even if the page needs a scroll
  rail.
- Every state has a trigger and an action list.
- Annotate quirks; do not polish them away.
- Include the unglamorous states: no history, one item, long error copy, empty
  results, cancelled, permission denied, dark mode, accent theme.
- The board must work from `file://`: embed fonts, inline icons, no fetch.
- The board is for a designer to redesign from; it is not the production
  implementation. Say so.

## 5. Verify

- All states present against the inventory; the manifest parses and agrees.
- Every screen opens; no console errors; no network requests for a self-contained
  board.
- **No clipped content at 320–1440.** `scrollWidth == viewport` is not proof:
  `overflow-x: clip` can hide elements that are wider than the viewport. Run
  `.design-os/tools/measure-artifact.mjs <artifact> --viewports=1440,1024,768,390,375,360,320 --exclude='.stage,[inert]'`
  and fix every clip. Local rails may scroll, but nothing may be unreachable.
- Every static mock is inside `inert`; only the prototype is focusable. Tab
  through the page and confirm no mock control takes focus.
- Focus is visible and lands on the new primary action after every phase change,
  not on `<body>`.
- Theme switch works and persists.
- Fonts cover every glyph used; declared weights do not exceed the loaded face.
- The interactive prototype can complete, cancel, and fail.
- Size and geometry claims are checked against the built widget or source, not
  only against the board's own mocks.
- Board type/contrast exceptions are labelled; they do not hide the widget's
  measured failures.

## 6. Critique yourself

Review the board with `.design-os/briefs/CRITIQUE.md` -> "State-board checklist" before
calling it done. Score the board as a communication artifact, not as the product
UI, and name the layer.

## Output

The HTML file is the deliverable. Write it to `design/<slug>/` and state its
path, what is real vs simulated, and the measured sizes. Do not add a second copy of the same board as screenshots.

## When not to use

Do not use for product UI screens; use `frontend-design` or `redesign`.
