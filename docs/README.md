# Dezign0 docs

A design capability layer for AI coding agents: a design OS, a native
OpenChamber/OpenCode plugin, installers for other harnesses, and review tools.

## Read in this order

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — product layers, content strategy,
   roadmap and what not to build.
2. **[ADOPTION.md](ADOPTION.md)** — install and daily-loop instructions for DSH,
   OpenChamber, OpenCode 1.x, Claude Code and Codex.
3. **[PUBLISHING.md](PUBLISHING.md)** — publish `dezign0` to npm and install it
   from OpenChamber's "From npm" field.
4. **[VERIFICATION.md](VERIFICATION.md)** — what was tested and what remains a
   limit.
5. **[figma.md](figma.md)** — optional Figma MCP bridge; no token storage or paid
   dependency.
6. **[ENHANCEMENT-RESEARCH.md](ENHANCEMENT-RESEARCH.md)** — researched feature and
   integration options, prioritized, with sources and non-goals.

## Current pieces

- **Kit:** [`design-os/`](../design-os/README.md)
- **Plugin:** [`plugin/`](../plugin/README.md)
- **Installer:** `design-os/install.mjs`
- **Linter:** `design-os/tools/design-lint.mjs`
- **Measurement:** `design-os/tools/measure-artifact.mjs`

## Interfaces

- **CLI:** `bin/dezign0.mjs` — lint, measure, audit, doctor, systems, addons,
  new, export.
- **MCP server:** `mcp/server.mjs` — seven stdio tools.
- **GitHub Action:** `.github/actions/dezign0-review`.
- **Evals:** `evals/run.mjs` — WITH/WITHOUT delta.

## Content packs and addons

- **Design languages:** 152 packages in the optional `design-languages` pack.
- **Templates, Figma bridge, handoff, review and media:** 13 addon entries.
- **Brand extraction:** `design-system-extract` skill plus `ds-validate`.

## What is not built yet

The `dezign0` CLI and local studio. [ARCHITECTURE.md](ARCHITECTURE.md) sequences
them.
