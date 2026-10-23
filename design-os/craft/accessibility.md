# Accessibility baseline

Target **WCAG 2.2 AA** as the working floor. Legal minimums vary (EAA → EN 301
549 → WCAG 2.1 AA; ADA Title II → 2.1 AA; Section 508 → 2.0 AA), but 2.2 AA is
the practical design target.

Accessibility is not a final audit. It is a set of decisions made while
designing the component.

## Contrast

| Pair | Minimum | Notes |
|---|---|---|
| Body text (≤18px regular) | 4.5:1 | Inclusive threshold |
| Large text (>18px, or ~18.5px bold) | 3:1 | 14px bold does **not** qualify |
| UI component boundary | 3:1 | Against adjacent surface |
| Focus indicator | 3:1 | Against adjacent colors |
| Icons conveying meaning | 3:1 | Decorative icons exempt |

- Measure, do not estimate. APCA is useful for design review (body Lc ≥60,
  thin small text ≥75) but it is not the compliance standard.
- Do not use color alone for status, errors, selection or data. Add an icon,
  label, shape, pattern or position.
- Placeholder text is not a label. It is low contrast and disappears on input.
- Disabled controls are exempt from contrast, but any information the user still
  needs must remain readable.

## Targets and pointer

- WCAG 2.2 AA target size: **24×24 CSS px** (SC 2.5.8), with documented
  exceptions for inline links, spacing, etc.
- AAA target: 44×44. Product norm for touch: 44×44 with ≥8px between adjacent
  targets. Material uses 48dp.
- Hover-only actions must have a keyboard/touch path. Hover is never the only
  way to discover an action.
- Drag interactions need a non-drag alternative (SC 2.5.7).
- Do not disable zoom or user scaling.

## Focus

- Every interactive element gets a visible `:focus-visible` indicator.
- Removing the outline is a triple failure (1.4.11 non-text contrast, 2.4.7
  focus visible, 2.4.13 focus appearance) unless an equally visible replacement
  is provided.
- The indicator should be at least 2px, offset from the element, and ≥3:1
  against both the control and the background.
- Do not put `outline: none` on a component without a replacement.
- Do not animate the focus indicator away.
- Logical focus order: DOM order matches visual order. `tabindex` > 0 breaks it.
- Modals trap focus and restore it on close. Returning from a rebuild points at
  the new equivalent control, or the primary action if the item is gone.
- Skip links for long pages are a cheap win.

## Structure and semantics

- `<html lang>` set; `<title>` meaningful.
- One `<h1>` per page; no skipped heading levels.
- Use landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`.
- Use native controls first: `<button>`, `<a>`, `<input>`, `<select>`,
  `<dialog>`. Restyle them rather than recreating them with divs.
- A link navigates; a button acts. Do not use a bare `<a href="#">` as a button.
- Lists are lists; tables are tables; use `<th scope>` and captions for data
  tables.
- Images need alt text. Decorative images use `alt=""`. Icons that convey
  meaning need an accessible name.
- Form controls need a persistent visible label, programmatically associated.
  Group related controls with `<fieldset>`/`<legend>`.
- Error messages are programmatically associated with the field; the summary is
  announced.

## ARIA

Rule: native → restyled native → APG pattern → closest role plus documented
deviation.

- Never invent ARIA. A wrong role is worse than no role.
- Prefer `aria-label`/`aria-labelledby` over title tooltips.
- `aria-describedby` for helper/error text; `aria-errormessage` is less
  consistently supported.
- Use `aria-live` regions for status, with the container present before content
  changes. Polite for status, assertive for errors.
- `aria-expanded` on disclosure triggers, `aria-controls` where useful.
- `aria-current` for the current page/step.
- Do not use `aria-hidden` on focusable elements.

## Motion and time

- `prefers-reduced-motion: reduce` must remove translate/scale/rotate/parallax
  and large movement; keep opacity/color changes. Do not assume a library does
  this for you.
- Flashing: no more than three flashes per second (2.3.1, Level A).
- Any content that moves for >5s needs a pause control.
- Auto-advancing carousels pause after 3–5 cycles and on interaction.
- Auto-dismissing toasts must pause on hover/focus (2.2.1).
- Time limits can be extended or disabled.

## Content and i18n

- Use plain language. Error copy states cause and recovery.
- Do not encode meaning in shape/position alone; pair with text.
- RTL: mirror layout, direction-sensitive icons and alignment; do not apply
  Latin negative tracking to Arabic script.
- Long translations must not break buttons, tabs or cards. Test 30–40% longer
  strings.
- Use `lang` attributes for mixed-language content.

## Testing checklist

- Keyboard only: reach and operate every control; focus always visible.
- Screen reader spot check: landmarks, headings, names, errors, status.
- Zoom to 200% and 400%; no content lost, no horizontal scroll at 400%.
- Forced colors / high contrast mode: boundaries still visible.
- Reduced motion: no large animations.
- Contrast pairs measured and recorded (including deliberate exceptions).
- Tap targets and spacing measured.

## Common failures

- Quoting 44×44 as the AA requirement (24×24 is AA).
- "18px is large text" for contrast (bold thresholds differ).
- Treating ARIA as an accessibility improvement by itself.
- `outline: none`.
- Placeholder-as-label.
- A bare link used as a button.
- A custom div-based select without keyboard support.
- An error message that is only red.
- A live region that is added at the same time as its content.
