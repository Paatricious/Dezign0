# DESIGN-SPEC.md template

Freeze this before writing markup. If the artifact disagrees with the spec, the
artifact is wrong unless the change is recorded here.

---

# <Project> — design spec

## 1. Intent

- Deliverable type:
- Primary user flow:
- One-line design read:
- Three dials: variance / motion / density
- The one distinctive move:

## 2. Palette

| Token | Role | Light | Dark | Contrast pair |
|---|---|---|---|---|
| `--bg` | page ground | | | — |
| `--surface` | card | | | — |
| `--fg` | primary ink | | | fg on bg: __:1 |
| `--muted` | secondary ink | | | muted on surface: __:1 |
| `--border` | hairline | | | decorative / structural |
| `--control-border` | control edge | | | __:1 on surface |
| `--accent` | single accent | | | accent on surface: __:1 |
| `--accent-ink` | text on accent | | | __:1 |
| `--success` | success | | | |
| `--warn` | warning | | | |
| `--danger` | error | | | |

- Accent budget: at most two visible uses per screen.
- Deliberate contrast exceptions (with reason):

## 3. Type

| Token | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--display` | | | | | |
| `--h1` | | | | | |
| `--h2` | | | | | |
| `--h3` | | | | | |
| `--body` | | | | | |
| `--small` | | | | | |
| `--micro` | | | | | |

- Families: display / body / mono
- Fallback chain:
- CJK overrides (if applicable):

## 4. Space, shape, depth

- Base unit:
- Space steps:
- Radius scale:
- Border logic:
- Shadow scale:
- Container / max width:
- Grid / gutters:

## 5. Components

For each: anatomy, variants, states, token usage.

- Button (primary / secondary / ghost / destructive):
- Input / select / textarea:
- Card:
- Tabs / segmented control:
- Table / list row:
- Dialog / drawer:
- Toast / inline banner:
- Chart:
- Empty state:

## 6. States

| Surface | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |

Interaction states for every control: default / hover / focus-visible / active /
selected / disabled / loading.

## 7. Content

- Real copy inventory:
- Sample-data policy and label:
- Number/date/currency format:
- Empty/error/confirmation copy:
- Names/locales:

## 8. Motion

| Interaction | Duration | Easing | Property |
|---|---|---|---|
| | | | |

- Reduced-motion behavior:
- What never animates:

## 9. Accessibility

- Contrast measured:
- Focus style:
- Keyboard map:
- Live regions:
- Target sizes:
- Forced colors:
- RTL/CJK notes:

## 10. Responsive

| Breakpoint | Layout | What reflows | What drops |
|---|---|---|---|
| 320 | | | |
| 375 | | | |
| 390 | | | |
| 768 | | | |
| 1024 | | | |
| 1440 | | | |

- Fixed headers/bars padding:
- No horizontal scroll at any width.

## 11. Assets

| Asset | Source | License | Size | Placement |
|---|---|---|---|---|
| | | | | |

- Placeholder slots (if any) and their intended real content:
