# Using Dezign0

Dezign0 ships as a design OS plus a native OpenChamber/OpenCode 2 plugin and a
generic installer. Pick the host you already use.

## 1. OpenChamber / OpenCode 2 (recommended)

The repo root is a zero-dependency OpenCode 2 plugin. On load it copies the kit
to `<project>/.design-os` (if missing) and registers six `dezign0-*` skills.

### From local path

1. Download the repo somewhere permanent.
2. **Settings → Plugins → Add plugin → From local path**.
3. Spec: the absolute path to the **repo root directory** (not
   `plugin/index.js`).
4. Scope: **User** or **Project**.
5. Add, then reload OpenChamber.

### From npm

After publishing (see [PUBLISHING.md](PUBLISHING.md)):

1. **Settings → Plugins → Add plugin → From npm**.
2. Spec: `dezign0`, or pin a version: `dezign0@0.4.0`.
3. Scope: **User** or **Project**.
4. Add, then reload.

Verified on OpenCode 2.1.3 with both scopes: the kit is copied, six skills are
registered, and the three `dezign0_*` tools appear. `dezign0_doctor` reports the
install state; `dezign0_lint` and `dezign0_measure` run the mechanical checks. Local installs must point at the repo directory; single files are
rejected by OpenCode 2's config loader.

## 2. DSH

DSH already has `AGENTS.md`, skills, subagents/workflow, file tools and
Playwright. No new runtime is needed.

```bash
node design-os/install.mjs --target=../my-app --harness=dsh --with-agents
```

If this DSH build only discovers global skills:

```bash
node design-os/install.mjs --target=../my-app --harness=dsh --scope=global
```

Then:

```text
Read .design-os/DESIGN-OS.md. Use the design-brief skill for:
"Redesign the settings empty state."

Then build it, run the critique skill against the artifact, fix the must-fix
items, and write HANDOVER.md + TOKENS.md.
```

For a stronger loop, use two contexts:

1. **Builder** reads the brief/spec and writes the artifact.
2. **Critic** gets a fresh context, reads the artifact from disk and the
   critique skill, and writes `CRITIQUE.md`; it does not edit the artifact.

Mechanical checks:

```bash
node .design-os/tools/design-lint.mjs path/to/artifact.html
node .design-os/tools/measure-artifact.mjs path/to/artifact.html --strict
```

## 3. OpenCode 1.x

```bash
node design-os/install.mjs --target=../my-app --harness=opencode --with-agents
```

This creates `.design-os/`, `.opencode/skills/` and three commands:

```text
/design-new "Billing settings page with plan changes and invoices"
/design-review design/billing-settings/artifact.html
/design-ship design/billing-settings/artifact.html
```

OpenCode 2 users should use the plugin above instead.

## 4. Claude Code

As a plugin:

```text
/plugin marketplace add Paatricious/Dezign0
/plugin install dezign0@dezign0
```

Or with the installer:

```bash
node design-os/install.mjs --target=../my-app --harness=claude --with-agents
```

Skills go to `.claude/skills/<name>/SKILL.md`; instructions go to `CLAUDE.md` or
the appended `AGENTS.md` block.

## 5. Codex / generic agents

Codex and other agent-compatible harnesses can use `.agents/skills/` and
`AGENTS.md`:

```bash
node design-os/install.mjs --target=../my-app --harness=codex --with-agents
```

If the harness has no native skill system, use `--harness=files`, paste
`design-os/harness/SYSTEM-PROMPT.md` into its system prompt, and attach the kit
files as context.

## 6. The daily loop

```text
Design Read -> BRIEF.md -> DESIGN-SPEC.md -> artifact
-> lint + measure -> CRITIQUE.md -> fix -> re-score -> HANDOVER.md + TOKENS.md
```

Minimum commands after a build:

```bash
node .design-os/tools/design-lint.mjs design/<project>/artifact.html
node .design-os/tools/measure-artifact.mjs design/<project>/artifact.html --strict
```

Minimum prompt:

```text
Follow .design-os/DESIGN-OS.md for design/<project>.
Read the existing brief, tokens and artifact before changing anything.
Run the critique skill before handover; fix the artifact, not the critique text.
```

## 7. What the kit does not do

- It does not bundle third-party design systems, templates or skill bodies.
- It does not install Playwright. Measurement is optional; lint works without it.
- It does not replace the harness. It gives the agent rules, templates, skills
  and checks.

## 8. Next steps

Build on the kit with a project, not a rewrite: run one real design task through
the loop, then add the CLI and studio described in
[ARCHITECTURE.md](ARCHITECTURE.md).
