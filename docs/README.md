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

## Current pieces

- **Kit:** [`design-os/`](../design-os/README.md)
- **Plugin:** [`plugin/`](../plugin/README.md)
- **Installer:** `design-os/install.mjs`
- **Linter:** `design-os/tools/design-lint.mjs`
- **Measurement:** `design-os/tools/measure-artifact.mjs`

## What is not built yet

The `dezign0` CLI, local studio, content packs and brand-extraction workflow.
[ARCHITECTURE.md](ARCHITECTURE.md) sequences them.
