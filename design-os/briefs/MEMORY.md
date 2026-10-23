# Design memory convention

Memory is how taste survives sessions. Keep it small, specific and current.

## Layout

```text
design-memory/
├─ MEMORY.md                 # short index; one line per fact
├─ feedback_<slug>.md        # durable taste/process rules from the user
├─ project_<slug>.md         # decisions, delivered artifacts, open items
├─ reference_<slug>.md       # brand tokens, tool notes, external facts
└─ user_profile.md           # role, audience, delivery defaults
```

## Fact file format

Keep each file to one fact and answer four questions:

```md
---
name: short-kebab-slug
description: one sentence that makes the rule retrievable
type: feedback | project | reference | profile
updated: YYYY-MM-DD
---

**Rule.** The instruction, in one or two sentences.
**Why.** The bug, decision or constraint that produced it.
**Applies to.** Product/artifact scope.
**Supersedes.** Earlier rule/file, if any.
```

## What belongs

- User taste rules: "no warm cream grounds for corporate documents".
- Product invariants: "the canvas is darker than the card; there is no second
  depth cue".
- Decisions with reasons: "split-flap must fold the whole card, not only the
  digit".
- Recurring critique findings: "flagged component defects must be fixed on every
  instance".
- Brand/token references and their source.
- Workflow corrections: "re-score the critique against disk, never edit only the
  report".

## What does not

- Raw conversation, transcripts, tool logs.
- Secrets, credentials, tokens.
- Unverified claims or guesses.
- Duplicate notes.
- One-off project details that will be stale in a week.

## Index

`MEMORY.md` is a short annotated list, not the memory itself:

```md
# Design memory

- feedback_no_warm_cream_grounds.md
  Neutral near-white for corporate/finance; cream reads as a style choice.
- project_dashboard_depth_model.md
  Canvas darker than card is the only depth cue; no shadow bevel.
```

When a fact conflicts with the current artifact or user instruction, the current
instruction wins. Flag the conflict and update or supersede the note; do not let
stale memory override evidence.

## Budget

Keep the injected memory under ~10% of the context window. If it grows, move
detail to per-project files and keep only the index plus active rules. Delete or
archive superseded facts.
