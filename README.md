# Dezign0

A portable design capability layer for AI coding agents. It gives an agent a
design operating system, checkable craft rules, review templates and measurement
tools, and packages them as a native OpenCode 2 / OpenChamber plugin plus
installers for other harnesses.

**Status:** alpha. The kit, plugin, installer and review tools are usable today.
The CLI, local studio and additional adapter integrations are next.

## What is inside

- **Design OS** — a design read, brief, direction, design spec, build, critique,
  fix and handover loop.
- **Craft rules** — typography, color, layout, states, accessibility, motion and
  content rules with mechanical checks.
- **Templates** — brief, design spec, critique, handover, tokens and memory.
- **Six skills** — design brief, frontend design, redesign, critique,
  design-system extraction and state boards.
- **Plugin** — zero-dependency OpenCode 2 / OpenChamber integration that installs
  the kit into a project and registers the skills.
- **Tools** — a static linter and a Playwright-based rendered measurement tool.

## Quick start

### OpenChamber / OpenCode 2 (native plugin)

In **Settings → Plugins → Add plugin**:

- **From local path:** the absolute path to this repo directory.
- **From npm:** `dezign0` — live at
  [npmjs.com/package/dezign0](https://www.npmjs.com/package/dezign0). The live
  `0.3.0` release has the six skills; `0.4.0` adds the tools described below and
  is prepared but not published yet.

Choose User or Project scope. On load the plugin copies the kit to `.design-os/`,
registers six `dezign0-*` skills and three read-only tools (`dezign0_lint`,
`dezign0_measure`, `dezign0_doctor`). It needs no npm dependencies; Playwright is
optional for rendered measurement.
Details: [plugin/README.md](plugin/README.md).

### OpenCode 1.x

```bash
node design-os/install.mjs --target=../my-app --harness=opencode --with-agents
```

Then use `/design-new`, `/design-review`, `/design-ship`. Skills are installed at
`.opencode/skills/<name>/SKILL.md`.

### DSH

```bash
node design-os/install.mjs --target=../my-app --harness=dsh --with-agents
```

If your DSH build only discovers global skills, add `--scope=global`.

### Claude Code plugin

```text
/plugin marketplace add Paatricious/Dezign0
/plugin install dezign0@dezign0
```

This uses `.claude-plugin/` and updates through the marketplace.

### Claude Code / Codex (installer fallback)

```bash
node design-os/install.mjs --target=../my-app --harness=claude --with-agents
node design-os/install.mjs --target=../my-app --harness=codex --with-agents
```

The installer never installs Playwright or deletes files. It copies the kit to
`.design-os/`, installs the six skills to the harness's native path and writes an
`AGENTS.md` fragment. Use `--dry-run` to inspect first.

## How it works

The core loop is:

```text
Design Read -> Brief -> Direction/Design System -> Design Spec -> Build
-> Self-check -> Critique -> Fix -> Handover -> Memory
```

A design task starts with a one-line read of the page kind, audience and visual
language. It then becomes a numeric brief, a frozen design spec, a build and a
five-dimension critique with measured evidence. The critique is fixed against the
artifact, not the review text. The handover records the contract another agent
needs to implement it.

Mechanical checks:

```bash
node .design-os/tools/design-lint.mjs path/to/artifact.html
node .design-os/tools/measure-artifact.mjs path/to/artifact.html --strict
```

## Bring your own design systems

Dezign0 does not bundle third-party design systems, templates, fonts, images or
skill bodies. Use the design-system extraction skill to create a `DESIGN.md` and
`tokens.css` for the brand you are working on, or bring your own licensed system.

This keeps the package small and avoids redistributing content whose terms are
unclear.

## Repository map

| Path | What it is |
|---|---|
| [design-os/](design-os/README.md) | The design operating system, craft rules, templates, skills, installer and tools |
| [plugin/](plugin/README.md) | Zero-dependency OpenCode 2 / OpenChamber plugin |
| [server.js](server.js) | Directory plugin entrypoint used by OpenCode |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Product layers, content strategy and roadmap |
| [docs/ADOPTION.md](docs/ADOPTION.md) | Install and daily-loop instructions per harness |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | Publish to npm and install from OpenChamber's "From npm" field |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | What was tested, on which versions, and what is still a limit |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [SECURITY.md](SECURITY.md) | Threat model and reporting |

## Roadmap

1. **Current:** kit, installer, plugin, docs, npm packaging.
2. **Next:** `dezign0` CLI (`init`, `add`, `new`, `measure`) and a local studio
   for preview, library, comments and versions.
3. **Later:** brand extraction, reference browser, multi-agent critic and export.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licensing and credits

The repository is Apache-2.0 (see [LICENSE](LICENSE)). Prior-art credits are in
[ATTRIBUTION.md](ATTRIBUTION.md) and
[design-os/ATTRIBUTION.md](design-os/ATTRIBUTION.md).

No third-party application code, design-system packages, templates or skill
bodies are included.
