# AGENTS.md — design work (template)

> **Template, not active for this repository.** Copy this file to a project root
> as `AGENTS.md` (or append it to the existing one). The paths below assume the
> kit was copied to `.design-os/` in that project.

This repo uses a portable design operating system in `.design-os/`. It applies to
any UI, page, deck, document, component, widget, or visual artifact.

## Before any design work

1. Read `.design-os/DESIGN-OS.md`.
2. If the task is a new artifact or a redesign, read
   `.design-os/skills/design-brief/SKILL.md` and produce a brief before code.
3. If an artifact already exists, read it, its tokens and its existing
   conventions. Preserve them unless explicitly asked to redesign.
4. If the project has a `design-systems/<brand>/DESIGN.md`, read it fully and
   treat its token values as authoritative.
5. Write project artifacts under `design/<slug>/`; never edit `.design-os/`.

## The loop

```text
Design Read → Brief → Direction/Design System → Design Spec → Build
→ Self-check → Critique → Fix → Handover → Memory
```

Do not skip from the request to markup. Do not start with a default template.
Do not ship only the populated state.

## Skill routing

Load only the skill that matches the task. Do not preload all thirteen.

| Request | Load |
|---|---|
| New page, screen, component, widget or artifact | `design-os/skills/design-brief/` then `design-os/skills/frontend-design/` |
| Existing UI needs polish, modernization or a redesign | `design-os/skills/redesign/` |
| Review, audit or "what is wrong with this?" | `design-os/skills/critique/` |
| Extract a brand or design system from an existing source | `design-os/skills/design-system-extract/` |
| Documentation board, state board or multi-screen handoff page | `design-os/skills/state-board/` |
| Figma file or frame is the source | `design-os/skills/figma-context/` |
| A prebundled design language is requested | `design-os/skills/design-language/` |
| A deck, dashboard or prototype starter is requested | `design-os/skills/template-start/` |
| Figma frames must become code | `design-os/skills/figma-to-code/` |
| An approved artifact must become React/Next/Vue | `design-os/skills/code-handoff/` |
| Exact-size, selected-element or accessibility review | `design-os/skills/visual-review/` |
| Image or video asset briefs are needed | `design-os/skills/media-brief/` |

If a task spans two rows, start with the intake skill and load the build skill
once the brief exists.

## Files

- `.design-os/briefs/` — brief, spec, critique, handover and token templates.
- `.design-os/craft/` — the rulebooks for anti-slop, typography, color, layout
  and states, accessibility, motion, content and imagery.
- `.design-os/skills/` — workflow skills. Load the one that matches the task.
- `.design-os/tools/design-lint.mjs` — static checks for HTML artifacts.
- `.design-os/tools/measure-artifact.mjs` — rendered checks (Playwright).
- `design-systems/<brand>/` — brand contracts (`DESIGN.md`, `tokens.css`).
- `design-memory/` — durable one-fact design rules. Read the index at the start;
  add or supersede a fact when a decision is made.

## Definition of done

A design task is done when:

- it works end to end, opens from the expected path, and has no broken assets;
- all required screens, data states and interaction states exist;
- visual values come from tokens, not one-off literals;
- contrast, keyboard, focus, labels, targets and reduced motion meet the
  baseline;
- long and edge content do not break the layout;
- a critique with evidence has been run and its must-fix items are closed or
  explicitly accepted;
- the response names files, assumptions and known gaps.

## Commands

```bash
node .design-os/tools/design-lint.mjs path/to/artifact.html
node .design-os/tools/design-lint.mjs --strict path/to/artifact.html
node .design-os/tools/measure-artifact.mjs path/to/artifact.html --strict
```

Lint is a floor, not the review. It cannot judge hierarchy, taste or flow.
`measure-artifact` needs Playwright and catches clipped content, rendered
contrast, type-size count and tab stops. If Playwright is unavailable, say the
review is source-only; do not claim rendered findings.

## Rules

- Do not invent metrics, testimonials, logos or brand assets.
- Do not use lorem ipsum or placeholder copy in a delivered artifact.
- Do not add unrequested deliverables.
- Do not claim screenshots, renders, tests or exports that did not run.
- Do not change token values without explicit owner approval.
- Keep the user's language, files and identifiers intact.
- When the user asks to plan, plan and stop. When they ask to build, build.
