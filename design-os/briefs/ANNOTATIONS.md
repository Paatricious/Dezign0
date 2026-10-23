# ANNOTATIONS.md — element-anchored review contract

`ANNOTATIONS.json` is where review findings become addresses instead of prose.
A critique emits entries; a build consumes them; `bundle.mjs` renders them into
the review page and derives the open findings. One file per project folder:
`design/<slug>/ANNOTATIONS.json`.

The file is read by machines and written by agents. A finding without a selector
is a wish; a finding without a note is noise. Keep both.

---

## 1. File shape

```json
{
  "schema": "dezign0/annotations/v1",
  "project": "billing",
  "round": 1,
  "updated": "2026-10-23T18:30:00.000Z",
  "items": [
    {
      "id": "ann-001",
      "artifact": "index.html",
      "selector": "[data-od-id='kpi-row']",
      "box": { "x": 24, "y": 96, "width": 145, "height": 188 },
      "viewport": "145x188",
      "note": "The sparkline clips below 145x188; move it under the value and keep the delta visible.",
      "severity": "P0",
      "status": "open",
      "author": "critic",
      "round": 1
    }
  ]
}
```

Top level: `schema`, `project` (slug), `round` (current round, integer ≥ 1),
`updated` (ISO 8601), `items` (array). Extra keys are ignored; unknown `schema`
values are reported by `bundle.mjs`.

## 2. Entry fields

| Field | Required | Type | Contract |
|---|---|---|---|
| `selector` | yes | string | Non-empty CSS selector that identifies the smallest element or region. Prefer `[data-od-id="..."]`; fall back to a stable class or element path. Must be valid for `querySelector`. |
| `box` | yes (may be `null`) | object / null | Measured box in CSS px: `{ x, y, width, height }`, origin at the viewport's top-left. `null` when the finding is page-level or was not measured; do not invent numbers. |
| `note` | yes | string | One finding: what is wrong, why it matters, what to change. Include the measured value when there is one. |
| `severity` | yes | enum | `P0` breaks the deliverable; `P1` is a must-fix before shipping; `P2` is polish; `nit` is optional taste. |
| `status` | yes | enum | `open`, `in-progress`, `resolved`, `wontfix`, `accepted`. |
| `author` | yes | string | Who wrote it: agent name, role or person. |
| `round` | yes | integer ≥ 1 | Critique round. Round 1 is the first review after the build. |
| `artifact` | no | string | File name in the project folder. Defaults to the first inlined artifact when omitted; set it whenever there is more than one. |
| `viewport` | no | string | `WIDTHxHEIGHT` the `box` was measured at (for example `145x188`). |
| `id` | no | string | Stable handle (`ann-001`); useful for status updates and PR comments. |

Allowed values are exact: `bundle.mjs` exits `1` and writes nothing when an entry
violates this table. It reports the item index and the reason.

## 3. Rules

1. **One finding per entry.** Two problems at one selector are two entries.
2. **Anchor to the smallest element.** `main`, `body` or a whole page is not an
   anchor; use the region or control.
3. **Measure, then record.** `box` comes from the browser at a stated
   `viewport`, not from a screenshot thumbnail. If you could not measure it,
   write `null` and say so in the note.
4. **Rounds are append-only history.** Do not delete a resolved entry; set
   `status: "resolved"`. Do not rewrite an old round's note; add a new entry in
   the current round that references it.
5. **Status has one meaning.** `resolved` means the artifact was changed and the
   finding was re-checked. `accepted` means the owner accepted the tradeoff and
   said why. `wontfix` means it will not be addressed; write the reason in the
   note. `in-progress` means a fix is underway.
6. **A closed entry cites evidence.** A `resolved` entry should name the change
   (file:line, selector, measured after-value) so a reviewer can verify it.
7. **No P0 without a repair path.** A P0 whose fix is not stated is a blocker
   with no exit; add the concrete action.
8. **Human and agent entries share the file.** `author` distinguishes them; the
   severity scale does not change with the author.

## 4. Severity

| Value | Meaning | Bundle behaviour |
|---|---|---|
| `P0` | Breaks the deliverable: dead control, broken state, inaccessible primary action | Listed as an open finding while `status` is `open` or `in-progress` |
| `P1` | Must fix before shipping: contrast, focus, overflow, missing state | Listed as an open finding while open |
| `P2` | Polish: rhythm, alignment, copy tone | Counted only |
| `nit` | Optional taste | Counted only |

`bundle.mjs` derives "open findings" from `P0`/`P1` entries whose status is
`open` or `in-progress`. Everything else is counted in the manifest but not
listed as blocking.

## 5. Who writes what

- **Critique** (`.design-os/skills/critique/SKILL.md`) writes entries from disk
  and measurement. Its prose report keeps the five dimensions; each element-level
  fix gets an annotation.
- **Design review / visual review** writes `P2`/`nit` entries during the pointed
  pass; `P0` still goes through the critique protocol.
- **Build/fix** moves statuses: `open` → `in-progress` → `resolved`, and adds the
  evidence line.
- **Owner** sets `accepted` or `wontfix` and is named in `author` or the note.
- **`bundle.mjs`** never writes annotations; it validates, renders and counts.

## 6. Consuming the file

```bash
node .design-os/tools/bundle.mjs design/<slug>
node .design-os/tools/bundle.mjs design/<slug> --json
```

The bundle renders the annotation table, the open findings and a coverage
manifest that lists annotations without a measured box. Invalid JSON or a
contract violation exits `1` before any file is written.

A typical agent loop:

1. read `ANNOTATIONS.json` and take every `open` `P0`/`P1`;
2. fix the artifact, not the note;
3. set `status: "resolved"` with the change reference;
4. re-measure the same viewport and add a new entry only if the fix did not hold;
5. re-run `bundle.mjs` and keep `review.html` with the project.

## 7. Anti-patterns

- A prose list of fixes with no selectors; use the file.
- Selector `body` or `div` for a finding about one control.
- Estimated boxes, or a box recorded at a different viewport than the one stated.
- Deleting entries to make a review look clean.
- Marking `resolved` without touching the artifact.
- Severity inflation: using `P0` for taste. Severity is scope, not emphasis.
- One entry carrying three unrelated fixes.

## When not to use

Do not use `ANNOTATIONS.json` for general design notes or decisions; use
`design-memory/` or an ADR (`.design-os/briefs/ADR.md`). Do not use it as a task
tracker: it records design findings against an artifact, not issue status. Do not
add it to a project with no artifact yet — there is nothing to anchor to.
