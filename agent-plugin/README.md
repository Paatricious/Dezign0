# Dezign0 Agent Plugin

Portable package for [Agent Plugins v1.0.0](https://agent-plugins.org/specification)
(working spec, published 2026-08: `$schema` id `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`).
Any conformant client discovers the thirteen skills under `skills/` and connects
to the local stdio MCP server declared in `mcp.json` — no install script, no
network, no shell.

```text
agent-plugin/
  plugin.json      closed Agent Plugins 1.0.0 manifest (name, version, metadata)
  mcp.json         one stdio server: node ./server.mjs
  server.mjs       bootstrap -> ../mcp/server.mjs (single implementation)
  skills/          thirteen skill copies, one immediate child dir per SKILL.md
```

## Install

The plugin root is this folder, but the MCP implementation and the design kit
live beside it in the repository. Install the repository checkout (or npm
package) and point the client at `agent-plugin/` — do not copy `agent-plugin/`
on its own.

```bash
# Claude Code, as a local plugin directory:
claude --plugin-dir /path/to/Dezign0/agent-plugin

# Any MCP client that reads a config file:
{
  "mcpServers": {
    "dezign0": { "command": "node", "args": ["/path/to/Dezign0/mcp/server.mjs"] }
  }
}
```

Agent Plugins clients read `mcp.json` themselves; the `${PLUGIN_ROOT}`
placeholder is expanded by the client per spec §9.2.

## Project directory

The seven tools operate on the current project. When an Agent Plugins client
launches the server, the working directory is the plugin root (spec §7.2.1), so
pass the project explicitly:

```json
{ "env": { "DEZIGN0_PROJECT": "/path/to/your/project" } }
```

`mcp/server.mjs` also accepts `--project <dir>`; otherwise it uses
`DEZIGN0_PROJECT` or the process working directory.

## Tools

`dezign0_lint`, `dezign0_measure`, `dezign0_doctor`, `dezign0_design_systems`,
`dezign0_addons`, `dezign0_content_lint`, `dezign0_token_export`.

`content_lint` and `token_export` report a clear "not shipped in this build"
result until their scripts land in `design-os/tools/`; the other five work
today.

## Guarantees

- No network access and no shell: child checks run through `execFile` with an
  argv array.
- Every path argument is resolved and must stay inside the project, including
  through symlinks.
- `skills/` is a copy of `design-os/skills/`. `scripts/test-mcp.mjs` hashes both
  trees and fails if they drift, so the copy cannot silently rot.
