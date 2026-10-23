# Brief: component library fixture page

Build a self-contained `components.html` fixture page that documents the
primitive components of a small design system: buttons, inputs and cards. It
should look like a real documentation page, not a swatch dump. No frameworks, no
external assets.

Required content and structure:

- Sections with `id="buttons"`, `id="inputs"`, `id="cards"`.
- A token layer declared once in `:root`: at least background, surface, text,
  muted, border, accent, success, danger, two radii, one shadow. Everything else
  consumes `var(--…)`.
- Buttons: primary, secondary, ghost, destructive; sizes sm/md/lg; states
  default, hover, focus-visible, active, disabled, loading. Disabled uses a real
  `disabled` attribute. At least eight `button` elements.
- Inputs: text, email, search, textarea, select; default, focus, disabled,
  invalid (with `aria-invalid="true"` and an error message linked by
  `aria-describedby`), and a fieldset with a legend.
- Cards: default, with media slot, and with a footer action. Cards use consistent
  padding, radius and border from tokens.
- A short usage note per component describing when to use it and what not to do.

Constraints:

- Every interactive element has an accessible name; keyboard focus is visible;
  `prefers-reduced-motion` is honoured.
- No color-only state: disabled and invalid states also use text or icons.
- A single accent color; contrast ≥ 4.5:1 for body text.
- No placeholder copy, no TODO markers, no dead links, no raw color literals
  outside the `:root` token block.

Write the file to the exact output path the harness gave you.
