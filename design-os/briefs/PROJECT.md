# PROJECT.md — project folder and `project.json`

A Dezign0 design task is a folder, not a chat thread. `PROJECT.md` defines that
folder, the machine-readable `project.json` inside it, and the commands that
create and bundle it. Files are the source of truth; git is the history.

Create one with:

```bash
node .design-os/tools/scaffold.mjs new billing --profile=dashboard
node .design-os/tools/scaffold.mjs list
```

The scaffolder refuses to write outside `<root>/design/` and never overwrites a
folder without `--force`. In a source checkout the tool is
`design-os/tools/scaffold.mjs`.

---

## 1. Folder contract

```text
design/<slug>/
  project.json        profile, system pin, skill pins, constraints, status
  BRIEF.md            numeric brief (copy of .design-os/briefs/BRIEF.md, filled)
  DESIGN-SPEC.md      frozen tokens, type, states, motion, a11y, responsive
  <entry>.html        the artifact (profile entry: index / deck / report / app / email)
  tokens.css          the token layer the artifact consumes
  CRITIQUE.md         five-dimension review with evidence
  HANDOVER.md         implementation contract
  MEMORY.md           index of one-fact design rules
  ANNOTATIONS.json    element-anchored review entries
  decisions/          ADR-0001-<slug>.md decision records
  TOKENS.md           optional token documentation
  review.html         generated review bundle (do not hand-edit)
```

Directories are created on demand; the scaffolder creates the first eight files.
Project artifacts live only here. Never edit `.design-os/`, the optional
`design-languages/` pack or the templates in `.design-os/briefs/`.

## 2. `project.json`

`project.json` is the only machine-readable statement of what the project is. It
is written by `scaffold.mjs`, updated by the agent as the work moves, and read by
`bundle.mjs`. Keep it current; a stale status is worse than no status.

```json
{
  "schema": "dezign0/project/v1",
  "slug": "billing",
  "profile": "dashboard",
  "created": "2026-10-23T18:18:05.238Z",
  "updated": "2026-10-23T18:18:05.238Z",
  "status": "draft",
  "systemPin": { "id": null, "source": null, "version": null },
  "skillPins": ["design-brief", "frontend-design", "state-board", "critique"],
  "constraints": {
    "surface": "dashboard or data surface",
    "entry": "index.html",
    "viewports": ["1440x900", "1024x768", "768x1024", "390x844"],
    "targetSizes": ["145x188"],
    "states": ["default", "hover", "focus-visible", "active", "selected", "disabled", "loading", "empty", "error", "populated", "edge"],
    "breakpoints": ["320", "375", "390", "768", "1024", "1440"],
    "a11y": "WCAG 2.2 AA",
    "dependencies": "none"
  },
  "artifacts": [{ "role": "entry", "path": "index.html", "status": "planned" }],
  "coverage": { "notReviewed": [] }
}
```

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | Always `dezign0/project/v1`. Refuse unknown schemas. |
| `slug` | string | Folder name; lowercase letters, digits, hyphens. |
| `profile` | string | One of the eight profiles in section 3. |
| `created`, `updated` | ISO 8601 | Scaffold time and last meaningful change. |
| `status` | enum | `draft` → `in-progress` → `review` → `approved` → `shipped`; `archived` to retire. |
| `systemPin` | object | The design system or language used: `id`, `source` (catalog slug, package path or `DESIGN.md` path), `version` or commit. Each field is `null` until chosen. |
| `skillPins` | string[] | Skill ids the project was briefed and built with, so a later run can repeat the workflow. |
| `constraints` | object | Hard numbers: surface, entry, viewports, target sizes, states, breakpoints, a11y floor, dependency policy. |
| `artifacts` | array | Planned and delivered files: `role`, `path`, `status` (`planned`, `in-progress`, `done`, `superseded`). |
| `coverage` | object | Honest gaps: `notReviewed` strings and optional notes. |

Rules:

- `constraints` fields are copied into `BRIEF.md` and `DESIGN-SPEC.md`; when the
  brief changes, edit `project.json` too. Disagreement means one of them is stale.
- A `systemPin` is a pin, not a preference: record the slug and the version or
  source commit so the artifact can be reproduced.
- Do not invent keys. Unknown keys are ignored by the tools but break readers.

## 3. Profiles

`scaffold.mjs --profile=<name>` pre-fills entry file, viewports, target sizes,
states and skill pins. The profile is a starting point; the brief decides.

| Profile | Entry | Viewports | Notes |
|---|---|---|---|
| `prototype` | `index.html` | 375 / 768 / 1440 | Runnable flow, real controls |
| `landing` | `index.html` | 375 / 768 / 1440 | Hero, proof, one CTA |
| `dashboard` | `index.html` | 1440 / 1024 / 768 / 390 | Data states, exact cell sizes |
| `deck` | `deck.html` | 1920×1080 | One idea per slide, 16:9 |
| `document` | `report.html` | 1440 / 1024 | Print/PDF behavior |
| `email` | `email.html` | 600 / 375 | Table-safe, inline styles |
| `mobile` | `app.html` | 390 / 375 / 360 | Safe areas, 44×44 targets |
| `component-library` | `index.html` | 1440 | Variants and state matrix |

Each profile also pre-fills the required states. A dashboard gets the five data
states; a deck gets `default` only. Requiring states a profile cannot have is
noise; omitting states it must have is a defect.

## 4. Commands

### `scaffold.mjs new`

```bash
node .design-os/tools/scaffold.mjs new <slug> --profile=<profile> [options]

  --profile=<name>   One of the eight profiles (required).
  --root=<dir>       Project root (default: current directory).
  --force            Rewrite scaffold-owned files in an existing project folder.
  --dry-run          Print the plan; write nothing.
  --json             Print a machine-readable result.
```

Exit codes: `0` created, `1` refused (invalid slug, target outside the project,
existing folder without `--force`, root without a project marker), `2` usage
error. `--force` rewrites the seven scaffold files; `ANNOTATIONS.json` is always
kept because it accumulates review history, and every other file in the folder
(artifacts, notes, decisions) is untouched.

`list` prints the profiles; `list --json` prints them as JSON.

### `bundle.mjs`

```bash
node .design-os/tools/bundle.mjs design/<slug> [--out=review.html] [--json]
```

Writes one self-contained review page: every top-level `*.html` artifact inlined
in a sandboxed iframe, the annotation table, the open P0/P1 findings, the
`HANDOVER.md` contract (exported verbatim when present), and the coverage
manifest (what was reviewed, what was not). It reads `project.json` when present,
warns when it is missing, and never requests the network. `--json` prints the
manifest instead of writing HTML; `--json --out=<file>` does both.
Exit codes: `0` ok, `1` no artifact or invalid annotations, `2` usage error.

The bundle is a review artifact, not a delivery: it names what it could not
verify (rendered measurement, handover, unannotated artifacts) instead of
implying coverage.

## 5. Review artefacts in the folder

- `ANNOTATIONS.json` — element-anchored findings. Contract:
  `.design-os/briefs/ANNOTATIONS.md`. `bundle.mjs` validates it and renders it.
- `decisions/ADR-<n>-<slug>.md` — consequential choices. Template:
  `.design-os/briefs/ADR.md`.
- `MEMORY.md` — the index of durable one-fact rules (convention:
  `.design-os/briefs/MEMORY.md`).

## 6. Honesty rules

- `status` moves forward only when the matching evidence exists: `review` needs a
  critique with scores and counters, `approved` needs a closed critique,
  `shipped` needs a handover.
- `coverage.notReviewed` lists what was not checked. An empty list asserts full
  coverage; do not leave it empty because the section was inconvenient.
- `bundle.mjs` derives findings from annotations; it does not score the design.
  A clean bundle is not a passing critique.

## When not to use

Do not create a project folder for a one-off question or a single image; answer
directly. Do not scaffold inside another project's `design/` folder to avoid the
contract — that is the contract. Do not use `project.json` as a task tracker;
`status` is about the design deliverable, not ticket state.
