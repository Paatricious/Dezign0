# HANDOVER.md template

Written for the implementing agent or engineer, not for the designer. It must
make silent deviation hard. Read order is part of the contract.

---

# <Project> — handover

**Read this file first.** It is the single entry point.

## 0. Source-of-truth order

1. `<artifact>.html` — authoritative. Every value below was read from it.
2. `tokens.css` — extracted verbatim from the artifact.
3. `TOKENS.md` — description only; if it disagrees with the artifact, the
   artifact wins and this doc is stale.
4. `CRITIQUE.md` / `*-critique.html` — historical review, not a spec. Findings
   already applied are not open work.

State clearly what must not be ported between artifacts or design systems.

## 1. What ships

| Output | Source | Notes |
|---|---|---|
| `<file>` | `<line range>` | |
| `tokens.css` | `<line range>` | |
| assets | `<folder>` | |

## 2. Platform / build blockers

List what will break before the first build: CSP restrictions, inline handlers,
remote dependencies, extension APIs, storage limits, iframe sandbox, framework
mismatches, font loading.

## 3. Scoping

- Included:
- Explicitly excluded:
- Not to change:

## 4. DOM / class contract

```text
.root
├─ .region
│  ├─ .title
│  └─ .control
└─ ...
```

- Non-negotiable structural rules:
- Stable IDs / hooks:
- What may change without breaking behavior:

## 5. Behavior contract

| Input / event | Behavior | Notes |
|---|---|---|
| | | |

- One row per interaction. Include keyboard, pointer, focus, escape, resize.
- Include anti-instructions: "Do not improve this into X; it changes the layout
  contract."

## 6. State matrix

| State | Trigger | Rendered as | Notes |
|---|---|---|---|
| default | | | |
| hover | | | |
| focus-visible | | | |
| active | | | |
| disabled | | | |
| loading | | | |
| empty | | | |
| error | | | |
| edge | | | |

## 7. Storage / data

- Schema:
- Key names:
- Migration:
- What is not persisted:
- Failure mode when storage is unavailable:

## 8. Do not regress

| Do not | Why |
|---|---|
| | |

Every row carries the mechanism or the past bug, not just "looks wrong".

## 9. Acceptance checklist

Numbered, measurable assertions:

1. `<selector>` measures `<value>` at `<condition>`.
2. Keyboard: ...
3. Contrast: ...
4. All states exist and do not overlap.
5. No horizontal scroll at `<widths>`.
6. Reduced motion: ...
7. Forced colors: ...

## 10. Known limits

- Limit:
- Why accepted:
- What to do if it becomes a requirement:

## 11. Optional: paste-ready implementation prompt

A short prompt the next agent can use, including the read order, the build
order, and a stop rule: "Stop and ask before changing any token value or adding
hue; both are owner decisions."
