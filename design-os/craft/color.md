# Color

The brand or design system supplies the palette. This file decides how to use
it. If no system exists, define the tokens first; never color by feel.

## Palette structure

Plan four layers before writing CSS.

| Layer | Share of pixels | Tokens |
|---|---:|---|
| Neutrals | 70–90% | background, surface, foreground, muted, border |
| Accent (one) | 5–10% | accent only. Never invent a second accent |
| Semantic | 0–5% | success, warning, danger |
| Effect | <1% | gradients, glows. Rarely justified |

If a screen looks flat, the fix is usually hierarchy and spacing, not more
colors.

## Accent discipline

- At most **two visible uses of the accent per screen**. A typical pair is one
  eyebrow/chip and one primary CTA. Or one accent card and one tab pill.
- Links count as accent. If a CTA shares the screen, demote links to foreground
  with an underline.
- Hover and focus rings count as accent uses. Ration them.
- Semantic colors are not accents. Danger/success/warning may appear only where
  the state requires them.

## Contrast floors

Gates, not goals:

| Pair | Minimum |
|---|---|
| Body text (≤18px regular) | 4.5:1 |
| Large text (>18px, or 14pt/≈18.5px bold) | 3:1 |
| UI control boundary against adjacent surface | 3:1 |
| Focus indicator against adjacent colors | 3:1 |

Measure contrast, do not estimate. If the brand accent fails on a light ground,
use a darker shade for text and the bright variant only for fills. If a
decorative hairline is intentionally below 3:1, say so and make sure it is not
the only thing identifying a control.

## Themes

- Avoid pure black and pure white as page/card values. `#0f0f0f` and `#fafafa`
  are safer starting points; use the brand if it specifies.
- On dark surfaces, semi-transparent white borders (`rgba(255,255,255,0.08)`)
  read as structure without noise.
- Light and dark are designed separately. Do not invert and call it a theme.
- Primary controls must set both foreground and background in every state. Text
  must not disappear into a filled button.
- Supporting text must remain readable in inverse-color sections.
- Test both themes before finishing.

## Token naming

Name by purpose, never by hue:

```css
/* good */
--accent: #2f6feb;
--success: #17a34a;

/* bad */
--blue-500: #2f6feb;
--green-500: #17a34a;
```

Purpose names survive theming and brand swaps. Hue names lock you out.

## Color use rules

- No color-only status. Pair color with an icon, label, shape or position.
- Backgrounds carry hierarchy: page → card → recessed. Do not use three
  competing accent backgrounds.
- Borders are for structure, not decoration. Pick one hairline logic.
- Shadows are elevation, not ornament. One scale, consistent light direction.
- Gradients must separate a hierarchy (header→body, primary→secondary), not
  decorate empty space. No two-stop purple/blue/cyan "trust" gradients.
- No neon outer glows by default. Use an inner border or a tinted shadow.
- In charts, use neutrals for structure, one accent for the primary series,
  semantic colors for states, and label the series directly instead of relying
  on a legend.

## Dark mode traps

- A dark card on a dark canvas needs separation: tonal step, hairline, or both.
- Inverse sections inherit near-white body text; check it.
- Images with light backgrounds can glow; add a subtle boundary or adjust the
  literal.
- Disabled states must remain distinguishable without dropping below 3:1 for
  any information the user still needs.

## Anti-defaults

- Indigo `#6366f1` as a default accent is the most reliable LLM tell.
- The purple→blue or blue→cyan hero gradient is the second.
- A warm beige/cream ground is not neutral; it reads as a style decision. Use it
  only when the brand says so.
- More than two accents, or an accent on every icon, is a failure of nerve, not
  richness.
