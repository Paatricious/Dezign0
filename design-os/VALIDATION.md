# Validation

The kit was tested by a fresh agent that was given only this folder and one task:
critique an existing artifact using the kit's own protocol.

The artifact was a 219 KB single-file state board with 11 screens and a live
prototype, reviewed outside this repository. The reviewer used
Playwright/Chromium because the protocol calls for measured counters.

## Result

**7.4 / 10** — Philosophy 8, Visual hierarchy 8, Detail 7, Functionality 6,
Innovation 8. Verdict: a strong, evidence-first board; below the kit's 8.0 stop
because the board broke its own mobile floor, shipped dead controls and lost
keyboard focus on phase changes.

The protocol was usable without extra instructions **when a browser was
available**. The reviewer produced five scored dimensions, measured counters,
Keep/Fix/Quick-wins lists, method/scope and an explicit "what I could not
review". The linter ran clean: 0 P0 / 2 P1 / 0 P2.

## Gaps the review exposed, and what changed

| Gap | Fix |
|---|---|
| The kit required measured counters but bundled no measurement recipe; the linter cannot see rendered contrast or overflow | Added `tools/measure-artifact.mjs` (Playwright): clipped content, rendered contrast with alpha/oklch handling, type-size count, tab stops, console errors, `--exclude` for intentionally reproduced regions |
| `design-lint`'s raw-hex finding pointed at a token declaration because its match index came from a shortened string | Token declarations are blanked with a same-length mask, so line numbers map to the original file |
| `data-od-id` was the artifact contract but the linter only checked `<section id>` | Linter flags a page with sections but zero `data-od-id` |
| "No page-level horizontal overflow" passed while `overflow-x: clip` hid content | Rule changed to "no clipped or unreachable content"; `measure-artifact` checks every element's rect against the viewport |
| Accent cap is ambiguous on a documentation board that uses the accent for wayfinding | Added a documentation/wayfinding exception: one accent, one navigation role, labelled in the artifact |
| "Innovation" is awkward for a state board | Guidance now says to score the communication idea for documentation artifacts |
| Weight above the loaded face range was silently clamped | Linter detects a declared weight above the loaded `@font-face` range |
| No state-board-specific review checklist | Added a state-board checklist to `briefs/CRITIQUE.md` and the state-board skill |
| Critique did not require verifying mock geometry against the production source | Critique and state-board skills require a source/built-product cross-check or an explicit "unverified" mark |
| Dead controls and focus loss were found only by clicking through | State-board verify list now requires inert static mocks and focus restoration; measurement reports focusable controls |

## What was not validated

- No second fresh-agent run after the fixes. The 7.4 score is for the pre-fix
  board.
- No automated contrast check for background images/gradients; the measurement
  walker handles solid backgrounds and alpha only.
- No screen reader, Firefox/Safari, print, zoom, forced-colors or dark-mode pixel
  diff.
- The measurement tool is optional. A harness without a browser is limited to
  source review, and the critique must say so.

The point of this file is to make the kit falsifiable: a reviewer with no prior
context can use it, produce a scored critique, and expose concrete gaps.
