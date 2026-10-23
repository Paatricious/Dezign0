# Typography

Typography is the highest-leverage craft decision. It is also the most common
place where generated work looks untrained. The brand decides *which* fonts;
these rules decide how they behave.

## Scale

Use a multiplicative scale (1.2 or 1.25). Cap at 6–8 sizes per artifact.

| Role | Range |
|---|---|
| Display | 48–72 px |
| H1 | 32–48 px |
| H2 | 24–32 px |
| H3 | 20–24 px |
| Body | 15–18 px |
| Small | 13–14 px |
| Caption | 11–12 px |

On dense product surfaces, a smaller scale is legitimate: 20/16/14/12/11.
What matters is that it is a closed set, not ad-hoc values.

**Documentation artifacts** (state boards, specs, handovers) may need a wider
annotation scale than product UI: 10.5–14px for labels, captions and code, plus
the display scale. That is an accepted exception, not a license for arbitrary
sizes. Still: no HTML text below 10.5px on a documentation page, no more than
three adjacent annotation sizes doing the same job, and reproduced widget labels
must not be counted as the board's own type scale.

## Line height

| Text size | Latin | CJK |
|---|---|---|
| Display / H1 (≥32 px) | 1.0–1.2 | **1.3–1.4** |
| Body (15–18 px) | 1.5–1.6 | 1.7–1.8 |
| Small (≤14 px) | 1.5 | 1.6–1.7 |

CJK glyphs fill the em box. Latin display leading makes Chinese headlines
collide. Apply the CJK floor to every heading level, including a multi-line
cover title at 72–96px. Negative tracking is Latin-only; CJK display text gets
`0`. When English and Chinese are mixed, set the Latin treatment on the Latin
element only; do not inherit it onto the CJK block.

## Letter spacing

This is the most reliably skipped rule.

| Context | Tracking |
|---|---|
| Body 14–18 px | 0 |
| Small 11–13 px | 0.01–0.02em |
| UI labels / buttons | 0.02em |
| **ALL CAPS** | **0.06–0.1em, required** |
| Headings 32px+ | −0.01 to −0.02em |
| Display 48px+ | −0.02 to −0.03em |

ALL CAPS without positive tracking looks cramped. Display text without negative
tracking looks loose. Both are immediate tells.

The 0.06em floor applies to uppercase **labels, metadata, buttons and body**.
Large uppercase display headings are the exception: they may use deliberate
negative tracking (an editorial choice) because the size already provides
separation. Do not apply label tracking to a 48px title.

## Font pairing

- Maximum two typefaces per artifact: display + body, or one variable face used
  at multiple weights.
- Always declare a system fallback chain. A webfont that fails must still produce
  a coherent look.
- Never set a heading to `system-ui` alone as the visual idea. Pair it with an
  intentional first choice or use the brand display face.
- Serif display is for editorial, luxury and publication. It is not the default
  for dashboards or dense product UI.

## Weights

Most well-crafted UIs use exactly three weights:

- **Read** 400/450: body.
- **Emphasize** 500/550: labels, navigation, UI.
- **Announce** 600/650: headings, buttons.

Weight 700+ is rarely needed; if everything is bold, nothing is. Check that
emphasis is carried by weight, size or color intentionally, not by default.

## Measure and alignment

- Body line length 50–75 characters. `max-width: 65ch` is a safe default.
- Do not justify body text on the web: it creates rivers.
- Left-align body copy. Centered text is for short headlines and captions only.
- Hyphenation is opt-in; do not hyphenate UI labels or names.
- Use `tabular-nums` for tables, prices, timers and any numbers that change in
  place.

## Text in components

- Every button, link, tab and label needs a visible text name. Icon-only
  controls need an accessible name.
- Labels are persistent. Placeholders are not labels.
- Do not truncate a name where the user needs to distinguish it. Wrap or
  reflow; if truncation is unavoidable, keep a tooltip/title and a stable width.
- Do not set type in uppercase for body copy. Uppercase is for labels, eyebrows
  and short buttons.
- Tighten tracking only after the size and weight are right; tracking cannot fix
  a bad scale.

## Common failures

- More than three type sizes above the fold.
- Eyebrow above every section with identical `uppercase tracking` treatment.
- A four-line hero headline. That is a size problem, not a copy problem.
- Body text in `text-align: justify`.
- CJK headline at Latin line height (lines touch).
- Negative tracking on CJK.
- ALL CAPS at 0 tracking.
- Mixed serif and slab on one screen with no role split.
- A display face that is just the body face at 700.
