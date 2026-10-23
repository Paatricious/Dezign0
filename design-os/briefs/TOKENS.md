# TOKENS.md template

Everything here is measured from the artifact, not estimated. If a value
disagrees with the artifact, the artifact wins and this document is stale.

---

# <Project> — tokens

## 1. Source of truth

1. `<artifact>.html` — authoritative.
2. `tokens.css` — extracted verbatim.
3. This file — description only.
4. `FIGMA.md` — when Figma was the input; record file/node and evidence grade.

### Provenance

For every token, record where it came from: SOURCE (computed/source/Figma
variables), PARTIAL (screenshot or limited sample), or GUESS (proposal). A GUESS
must never be presented as a measured brand token.

## 2. Color roles

| Token | Role | Light | Dark | Not for |
|---|---|---|---|---|
| `--bg` | page ground | | | text |
| `--surface` | card | | | |
| `--fg` | primary ink | | | backgrounds |
| `--muted` | secondary ink | | | primary text |
| `--border` | hairline | | | control boundary |
| `--control-border` | interactive edge | | | decorative dividers |
| `--accent` | one accent | | | body text |
| `--accent-ink` | on accent | | | anything else |
| `--success` / `--warn` / `--danger` | semantic | | | decoration |

- Accent budget: max two visible uses per screen.
- Three ink levels maximum, unless documented.

## 3. Measured contrast

| Pair | Light | Dark | Requirement |
|---|---|---|---|
| fg on bg | __:1 | __:1 | 4.5 |
| fg on surface | __:1 | __:1 | 4.5 |
| muted on surface | __:1 | __:1 | 4.5 |
| accent on surface | __:1 | __:1 | 4.5 |
| border on surface | __:1 | __:1 | decorative |
| control border on surface | __:1 | __:1 | 3.0 |
| focus ring vs adjacent | __:1 | __:1 | 3.0 |

### Deliberate exceptions

List every pair below the floor, why it is allowed, and what carries the meaning
instead. Example: "resting hairline is 1.3:1 and decorative; identity comes from
the icon and label; the focus ring is the compliant affordance."

## 4. Type

| Token | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| | | | | | |

- Families and fallbacks:
- CJK overrides:
- Numerals: tabular where values change.
- Maximum sizes per artifact:

## 5. Space and shape

- Base unit / steps:
- Radius scale and per-component mapping:
- Border logic:
- Shadow scale:
- Container / grid:

## 6. Geometry formulas

Record any formula that must not drift, with the padding folded in:

```text
width  = cols*cw + (cols-1)*cg + (cw+cg)/2 + 12
height = rows*ch + (rows-1)*rg + 12
```

- What the formula prevents:
- Values that must not be replaced with approximations:

## 7. Motion

| Interaction | Duration | Easing | Properties |
|---|---|---|---|
| | | | |

- Reduced motion behavior:
- What never animates:

## 8. Accessibility

- Focus style and contrast:
- Target sizes:
- ARIA/live regions:
- Forced colors:
- Known gaps with reasons:

## 9. Deliberately excluded

List tokens/values that do not exist and why, so nobody goes looking for them.
Example: "no fourth text tier; muted is the floor for text."
