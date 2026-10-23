# Design OS

A harness-agnostic design operating system: a design charter, checkable craft
rules, a falsifiable review process, templates and portable skills. It runs in
Claude Code, Codex, DSH, OpenCode, Cursor, a plain chat loop or a custom
orchestrator.

The kit is:

- a design operating system you can paste into a system prompt or `AGENTS.md`;
- checkable craft rules;
- a process that makes design claims falsifiable (brief -> spec -> build ->
  critique -> fix -> handover);
- templates for every artifact in that process;
- eight portable skills for the recurring jobs;
- static lint and optional rendered measurement tools.

**Start here:** [DESIGN-OS.md](DESIGN-OS.md), then
[briefs/BRIEF.md](briefs/BRIEF.md) and [briefs/CRITIQUE.md](briefs/CRITIQUE.md).

Project artifacts go under `design/<slug>/`; the files in `briefs/` are templates.
Never edit the installed kit. Copy a template into the project folder first.

---

## 1. The 60-second version

Design quality comes from a stack, not a single prompt:

1. **An always-on design charter** plus a task profile plus craft rulebooks,
   composed in a fixed order.
2. **A curated library** of brand systems or a design-system extraction pass, of
   which only the selected system enters the prompt.
3. **A process that makes claims checkable**: exact constraints, live artifacts,
   a scored critique that cites `file:line` or measured values, a fix pass and a
   handover document for the implementing agent.
4. **Harness ergonomics** that keep humans and agents in a review loop: preview,
   element-level comments, version history and persistent memory where available.

The kit supplies 1, 3 and the portable half of 4. Bring your own brand systems or
use the extraction skill.

---

## 2. Install it in any harness

### Option A: a coding agent with repo instructions

```text
your-project/
├─ AGENTS.md                  # copy from harness/AGENTS.md or append
├─ .design-os/
│  ├─ DESIGN-OS.md            # copy the whole kit here
│  ├─ briefs/
│  ├─ craft/
│  └─ skills/
└─ design-memory/             # starts empty; see briefs/MEMORY.md
```

The installer copies the kit, puts the eight skills where the harness looks for
them, and writes an `AGENTS.md` fragment:

```bash
# OpenCode: .design-os + .opencode/skills + /design-new, /design-review, /design-ship
node design-os/install.mjs --target=../my-app --harness=opencode

# DSH: .design-os + .agents/skills (project) or --scope=global for ~/.agents/skills
node design-os/install.mjs --target=../my-app --harness=dsh

# Claude Code / Codex / files only
node design-os/install.mjs --target=../my-app --harness=claude
node design-os/install.mjs --target=../my-app --harness=codex
node design-os/install.mjs --target=../my-app --harness=files
```

**OpenChamber / OpenCode 2:** install the repo as a plugin instead; it copies the
kit and registers the skills automatically. See the root
[plugin/README.md](../plugin/README.md).

### Option B: a chat-only harness

Paste [DESIGN-OS.md](DESIGN-OS.md) into the system prompt and attach
[briefs/](briefs/) as files. Use [harness/SYSTEM-PROMPT.md](harness/SYSTEM-PROMPT.md)
for a shorter variant.

### Option C: a custom orchestrator

Use [harness/WORKFLOW.md](harness/WORKFLOW.md): roles, prompt assembly order and
two-phase pseudocode.

---

## 3. The operating loop

```text
request
  -> Read the room (one-line Design Read)
  -> Brief (numbers, constraints, deliverables, a11y floor)
  -> Direction (brand system or one named aesthetic)
  -> Design Spec (freeze tokens, type, spacing, states, motion, content)
  -> Build (real states, real behavior, tokens only)
  -> Self-check
  -> Critique (five dimensions, evidence, measured counters)
  -> Fix (artifact first, then re-score)
  -> Handover
  -> Memory
```

The order matters. Most bad AI design skips the first four steps and starts at
"build", which is why it reaches for default aesthetics and only designs the
populated state.

---

## 4. File map

| Path | What it is | Use it when |
|---|---|---|
| [DESIGN-OS.md](DESIGN-OS.md) | The core operating manual | Always |
| [briefs/BRIEF.md](briefs/BRIEF.md) | Checkable brief template | Start of a new deliverable |
| [briefs/DESIGN-SPEC.md](briefs/DESIGN-SPEC.md) | Pre-build spec template | After direction is chosen |
| [briefs/DELIVERABLE-PROFILES.md](briefs/DELIVERABLE-PROFILES.md) | Quality floors per deliverable type | Before building a prototype, page, dashboard, deck or document |
| [briefs/CRITIQUE.md](briefs/CRITIQUE.md) | Five-dimension review protocol | Before calling work done |
| [briefs/HANDOVER.md](briefs/HANDOVER.md) | Cross-agent handoff template | When another agent implements |
| [briefs/TOKENS.md](briefs/TOKENS.md) | Token and contrast documentation | Any design-system work |
| [briefs/MEMORY.md](briefs/MEMORY.md) | One-fact design memory convention | Persistent harnesses |
| [craft/](craft/) | Anti-slop, typography, color, layout, states, accessibility, motion, content, visual review | Every artifact |
| [skills/](skills/) | Eight workflow skills | Intake, build, redesign, review, extraction, state boards, Figma context, design-language selection |
| [harness/](harness/) | AGENTS.md, compact system prompt, orchestrator workflow | Harness setup |
| [install.mjs](install.mjs) | One-command installer | First install |
| [tools/](tools/) | Static linter and rendered measurement | Every artifact |
| [VALIDATION.md](VALIDATION.md) | How the kit was tested | Evaluating the kit |

---

## 5. Where the quality comes from

- **Context, not a library.** Load the design system, task profile and craft
  rules the task needs; do not dump a library into the prompt.
- **Specificity.** Pixel-exact sizes, token roles, measured contrast and
  acceptance tests with numbers.
- **Falsifiability.** Claims must be checkable by another agent or a script. A
  critique that cannot cite `file:line` or a measurement is not a critique.
- **Human review loops.** Multiple rounds, not one prompt.
- **Memory and handoff.** Feedback becomes a rule; a decision becomes a handover
  section.

---

## 6. What this kit deliberately does not do

- Reproduce a desktop app: no daemon, no Electron shell, no plugin pipeline.
- Bundle third-party design systems in the core. Install the optional
  `design-languages` pack, or create your own with the extraction skill.
- Claim that a prompt makes a weak model design like a strong one. The model
  still has to be capable; the kit removes avoidable failures.
- Include a "design jury" or panel protocol. Use the scored critique.

---

## 7. Licensing

The kit is Apache-2.0. Prior-art credits are in [ATTRIBUTION.md](ATTRIBUTION.md).
The rules are standards and craft facts restated in original prose; no
third-party code or assets are included.
