# Architecture

Dezign0 is a design capability layer, not a desktop application. It has three
layers and an optional fourth.

```text
Design OS          the rules, process, templates, skills and tools
Adapters           installers and native plugins for agent harnesses
Projects           a standard folder per design deliverable
Studio (planned)   local browser UI for preview, library, comments and versions
```

## 1. Design OS

The core is harness-agnostic. It owns:

- `DESIGN-OS.md`: identity, priority order, the design loop, self-check and
  critique protocol.
- `craft/`: checkable rules for typography, color, layout and states,
  accessibility, motion, content and anti-slop.
- `briefs/`: brief, design spec, critique, handover, tokens and memory templates.
- `skills/`: seven workflow skills for intake, build, redesign, review,
  extraction, state boards and Figma context.
- `tools/`: a static linter and an optional Playwright measurement tool.

The OS never depends on a specific model or UI. Any harness with file access can
use it.

## 2. Adapters

Adapters are thin. They install the same core into a harness and map its native
surfaces:

| Capability | DSH | OpenChamber / OpenCode 2 | OpenCode 1.x | Claude Code | Codex |
|---|---|---|---|---|---|
| Instructions | `AGENTS.md` | plugin config | `AGENTS.md` | `CLAUDE.md` | `AGENTS.md` |
| Skills | `.agents/skills` or global | plugin registration | `.opencode/skills` | `.claude/skills` | `.agents/skills` |
| Commands | prompts | skills | `/design-*` | prompts | prompts |
| Hooks | workflow/subagents | plugin `setup` | none | hooks | none |
| Browser checks | shell + Playwright | shell + Playwright | shell + Playwright | shell + Playwright | shell + Playwright |

The repo root is a zero-dependency OpenCode 2 package. `server.js` is the
directory entrypoint; `plugin/index.js` installs the kit into the project and
registers the skills.

## 3. Projects

Each deliverable uses one folder:

```text
design/<slug>/
  project.json          profile, system pin, skill pins, constraints
  BRIEF.md
  DESIGN-SPEC.md
  artifact.html
  TOKENS.md
  tokens.css
  CRITIQUE.md
  HANDOVER.md
  design-memory/
```

Files are the source of truth; git is the version history. No database is needed
for the early product.

## 4. Content strategy

The package does not bundle third-party design systems, templates, fonts,
images or skill bodies. Three reasons:

1. licensing and attribution are unclear for most bundled corpora;
2. prompt quality depends on selecting a few relevant systems, not loading a
   library;
3. a small package is easier to install and audit.

Bring a licensed design system, or use the design-system extraction skill to
create an original `DESIGN.md` and `tokens.css`. A future content-pack system can
add licensed packs with explicit provenance, but it is not required for the
core loop.

## 5. Studio (planned)

A local browser UI for the parts a chat harness cannot do well:

- project list and artifact preview at real size;
- library of the user's own design systems;
- review panel with comments anchored to `data-od-id`;
- git version timeline and restore;
- measurement/lint results;
- export and handover.

No Electron. `dezign0 studio` would start a localhost server and open the
browser. A first version can be a single-page app over the project folder.

## 6. Roadmap

| Phase | Scope | Effort |
|---|---|---|
| Current | Kit, installer, plugin, docs, npm packaging | done |
| 1 | `dezign0` CLI (`init`, `add`, `new`, `measure`) | 3–5 days |
| 2 | Studio v1: preview, library, comments, versions | 1–2 weeks |
| 3 | Brand extraction, reference browser, multi-agent critic, export | 2–4 weeks |

## 7. What not to build

- A second Electron app or a daemon that wraps a CLI.
- A model adapter for every runtime. Four adapters plus a generic shell path is
  enough.
- A plugin/atom pipeline or artifact database. Files and git cover it.
- A prompt containing every skill and design system.
- A "design jury" panel protocol. The scored critique is enough.

## 8. Quality gates

The product is only useful if it enforces the loop:

1. P0 lint clean.
2. Rendered measurement clean when a browser is available: no clipped content,
   no contrast failures on text the user must read, no console errors.
3. All required states and interaction states exist.
4. Accessibility floor met.
5. A scored critique with evidence, and must-fix items closed or accepted.
6. Handover when another agent implements.

Those gates live in the kit and the review templates, not in the adapter. The
adapter only makes them cheap to run.
