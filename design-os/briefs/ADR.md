# ADR.md — design decision record

A design decision record (ADR) is one page that explains a consequential design
choice, the alternatives, and why this one won. It is written when the choice is
made, not reconstructed later. It is not a changelog and not a tutorial.

Copy the block beginning `# ADR-<number>: <decision title>` below into
`design/<slug>/decisions/ADR-<number>-<slug>.md`. The guidance above the `---`
line stays with the kit and is not part of the record:

```text
design/<slug>/decisions/
  ADR-0001-type-pairing.md
  ADR-0002-grid-and-density.md
  ADR-0003-motion-posture.md
```

Number sequentially, never reuse a number. Keep the file under one screen.

---

## When to write one

Write an ADR when the decision:

- sets the **direction** (editorial / utilitarian / premium / brutalist / …);
- chooses **type pairing**, scale and tracking strategy;
- defines **spacing, radius and density** as a system;
- chooses **motion posture** or an interaction model;
- changes **token semantics** or role names;
- makes a **documented exception** to a craft ban (indigo brand, brutalist
  pattern, systematic accent for wayfinding);
- will be expensive to reverse after the build starts.

Do not write one for a single spacing value, a bug fix, or a preference that
lives in `MEMORY.md`. Facts and taste rules go to design memory; decisions with
alternatives go here.

## Rules

1. **One decision per record.** If the title needs "and", split it.
2. **Status is explicit.** `proposed`, `accepted`, `superseded` or `deprecated`.
3. **Accepted records are immutable.** Change your mind by writing a new ADR that
   supersedes the old one; do not rewrite history.
4. **Alternatives must be real.** At least two options that were seriously
   considered, with the reason each lost.
5. **Consequences include the cost.** What becomes harder, what is now locked,
   what a future change must revisit.
6. **Evidence, not adjectives.** Cite the brief constraint, the measured value,
   the source line, or the reference that settled it.
7. **Link, do not duplicate.** Point at `DESIGN-SPEC.md`, `tokens.css`,
   `CRITIQUE.md` or a Figma node; the record explains the choice.

---

# ADR-<number>: <decision title>

- **Status:** proposed | accepted | superseded | deprecated
- **Date:** YYYY-MM-DD
- **Owner:** <person or agent role>
- **Scope:** <artifact, component or whole project>
- **Supersedes:** <ADR link or "none">
- **Superseded by:** <ADR link or "—">

## Context

What forced the decision. The brief constraint, the audit finding, the user
requirement, the platform limit. Two to five sentences; no history lesson.

## Decision

The choice, in one paragraph, stated as a rule someone can apply. Name the exact
values or roles when there are any.

## Alternatives considered

| Option | Why it was considered | Why it lost |
|---|---|---|
| <option A> | | |
| <option B> | | |

## Consequences

- **Positive:** what gets better.
- **Negative:** what gets worse or is now locked.
- **Neutral / follow-ups:** what a later round must revisit.

## Evidence

- Brief constraint: `<file:line or quote>`
- Measurement: `<command, value>`
- Reference: `<URL, screenshot, Figma node>`
- Code: `<file:line>`

## Links

- Spec: `design/<slug>/DESIGN-SPEC.md`
- Tokens: `design/<slug>/tokens.css`
- Critique: `design/<slug>/CRITIQUE.md`
- Related memory: `design-memory/<fact>.md`

---

## Filled example (abbreviated)

```markdown
# ADR-0002: Split-flap numerals for the KPI row

- Status: accepted
- Date: 2026-10-20
- Owner: design lead
- Scope: dashboard KPI row

## Context
The dashboard is read at a glance from three metres in an operations room. The
brief requires a 145x188 cell and says values must be comparable across rows.
The current UI uses proportional numerals, which shift while values update.

## Decision
KPI values use tabular numerals and a one-line split-flap style flip on change.
The flip animates transform only, 150ms, and is skipped under reduced motion. The
label and delta do not animate.

## Alternatives considered
| Option | Why it was considered | Why it lost |
|---|---|---|
| Static tabular numerals | Cheapest, no motion risk | Values change every 5s; no signal that a number updated |
| Full-card flip | Distinctive | Breaks row comparison and doubles motion cost |

## Consequences
- Positive: stable columns and a visible update cue.
- Negative: more CSS; the flip must be re-tested when the grid changes.
- Follow-up: confirm reduced-motion path in the next critique round.

## Evidence
- Brief: `project.json` constraints.targetSizes = ["145x188"]
- Measurement: `measure-artifact --viewports=145x188` element box 145x188
- Code: index.html:214
```

## Anti-patterns

- ADRs written after the fact to justify a screenshot.
- A "decision" with no alternatives; that is an announcement.
- Restating the whole spec inside the record.
- Editing an accepted ADR to match the current artifact.
- Using an ADR for a bug fix or a one-off value.

## When not to use

Do not use an ADR for reversible, local choices (a padding step, a label word) or
for durable facts ("the canvas is darker than the card") — those belong in
`design-memory/` per `.design-os/briefs/MEMORY.md`. Do not use it to record what
the design looks like; that is `DESIGN-SPEC.md`. Do not write one per component;
write one per system-level choice.
