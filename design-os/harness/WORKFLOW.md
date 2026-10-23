# Harness workflow

This is the orchestrator recipe for a custom harness. It assumes file read/write
and a shell; a browser/screenshot tool is optional and only strengthens review.

## Roles

| Role | Responsibility | Output |
|---|---|---|
| **Design lead** | Read the room, write the brief, choose direction, freeze spec, decide scope | `BRIEF.md`, `DESIGN-SPEC.md`, final decision |
| **Builder** | Produce the artifact and tokens; run self-check and lint | artifact, `tokens.css` |
| **Critic** | Read from disk, score five dimensions, produce Fix list | `CRITIQUE.md` (read-only) |
| **Builder** | Apply fixes; re-read and re-score | artifact + updated critique |
| **Design lead** | Handover + memory update | `HANDOVER.md`, `TOKENS.md`, memory facts |

One agent can play several roles, but keep the **critic read-only** and make it
re-read the artifact from disk. Self-critique in the same pass is weaker than a
separate pass; use a fresh context when the harness supports it.

## Prompt assembly order

If the harness composes a system prompt, keep this order (the useful part of the
design stack):

```text
1. DESIGN-OS.md                      identity + loop + non-negotiables
2. task profile                      what this deliverable type requires
3. brand DESIGN.md + tokens.css      authoritative token values
4. selected craft rulebooks          how to use the tokens
5. selected skill body               workflow for this job
6. artifact/runtime contract         filenames, inspect IDs, tools
7. user + project instructions       explicit intent last among instructions
```

Rules:

- Brand wins on token values; craft wins on usage; user wins on intent.
- Only load the craft/skill files the task needs. A 20k-token context of
  unrelated rules is noise.
- Put stable content first and per-turn variables last so prompt caching works.
- Never duplicate the same rule in two prompt files; one source per rule.

## Two-phase build

For a new artifact or a large redesign, split planning and production:

```text
Phase 1 (plan):
  read brief/tokens/source
  state design read, direction, design spec
  produce a readable plan + acceptance criteria
  stop; ask for approval only if the harness/product requires it

Phase 2 (build):
  execute the plan
  write files
  self-check + lint
  critique
  fix
  handover
```

A direct edit of a small, bounded change can skip phase 1, not the read.

## Pseudocode

```js
async function designTask(request, env) {
  const os = await read(".design-os/DESIGN-OS.md");
  const brand = await maybeRead(env.brandPath + "/DESIGN.md");
  const tokens = await maybeRead(env.brandPath + "/tokens.css");
  const profile = await selectProfile(request);       // prototype | page | deck | ...
  const craft = await selectCraft(profile, request);  // only the needed rules
  const skill = await selectSkill(profile, request);  // only one primary skill

  const context = composeSystemPrompt({ os, profile, brand, tokens, craft, skill });
  const brief = await designLead(context, request);
  if (brief.needsUserInput) return askOneQuestion(brief.question);

  const spec = await designLead.spec(brief, brand);
  const artifact = await builder.build(context, brief, spec);
  await lintOrThrow(artifact);                         // P0 blocks
  const selfCheck = await builder.selfCheck(artifact, brief, spec);
  if (!selfCheck.pass) await builder.fix(selfCheck);

  const critique = await critic.review({ artifact, brief, spec, brand });
  if (critique.hasMustFix) {
    await builder.fix(critique.fixes);
    const rescored = await critic.rescore({ artifact, critique }); // from disk
    if (rescored.composite < 8 || rescored.mustFix > 0) {
      // return the best version, list accepted tradeoffs
    }
  }

  const handover = await designLead.handover(artifact, tokens, critique);
  await memory.save(critique.rules, decisions);
  return { artifact, handover, critique, gaps: selfCheck.gaps };
}
```

Caps: max 3 critique rounds by default. After that, ship the best version and
list the open items. Do not loop forever.

## Quality gates

A build passes only if:

1. **P0 lint clean.** No indigo default, purple/trust gradient, emoji icons,
   filler copy, invented metrics, `scrollIntoView`, left-border accent cards.
   If a browser is available, also run
   `tools/measure-artifact.mjs <artifact.html> --strict`: no clipped content at
   320–1440, no rendered contrast failure on text the user must read, no console
   errors.
2. **Artifact opens and runs.** No console errors, no broken assets, primary
   flow works.
3. **States complete.** Per `briefs/DESIGN-SPEC.md`: data states and interaction
   states.
4. **Accessibility floor.** 4.5:1 body, 3:1 large/UI, focus visible, labels,
   keyboard, targets, reduced motion.
5. **Responsive floor.** No horizontal scroll at 320/375/390/768/1024/1440; no clipped
   controls; reflow.
6. **Critique.** Composite ≥8.0 and no must-fix, or the user explicitly accepts
   the open items.
7. **Handover exists** when another agent implements.
8. **Honesty.** The response lists files, assumptions and gaps, and claims no
   check that did not run.

## Tooling by capability

| Harness has | Use it for |
|---|---|
| Files + shell | Brief, spec, artifact, lint, critique from source |
| Browser/Playwright | `measure-artifact.mjs`: real boxes, clipping, rendered contrast, type sizes |
| Image generation | Real section assets; never fake screenshots |
| Screenshot tool | Critique evidence; before/after; not a substitute for source reading |
| Git | Versions for review; commit before a redesign |
| Memory/notes | One-fact rules; keep under ~10% of context |
| Multi-agent | Fresh critic context; parallel directions; never parallel edits to one file |

If the harness has no browser, say so in the critique. Do not claim visual
verification.

## Human review loop

The best design projects run many human rounds. Make that cheap:

- produce one artifact per round, not a folder of variants;
- keep a `current` baseline and a scorable critique;
- record user taste rules in memory the moment they are stated;
- keep a before/after gallery at 1:1 for the final review;
- stop when the user accepts the tradeoffs, not when the model is tired.

## Failure handling

- Provider/auth failure mid-run: keep files; report the failed step; resume from
  disk.
- Critique finds a bug: fix the artifact, not the report.
- User changes direction: update the spec, not just the current file; record the
  superseded decision.
- Impossible requirement: state the limitation and deliver the real partial
  result.
- Context bloat: cut memory/project history before cutting the brief or tokens.
