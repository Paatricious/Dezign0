# Dezign0 MCP server

Local stdio MCP server for the seven Dezign0 tools. No dependencies, no
network, no shell. Node 18+.

```bash
# any MCP client (Claude Code, Codex, Cursor, Cline, OpenChamber, custom)
node mcp/server.mjs --project /path/to/project
```

```json
{
  "mcpServers": {
    "dezign0": {
      "command": "node",
      "args": ["/path/to/Dezign0/mcp/server.mjs"],
      "env": { "DEZIGN0_PROJECT": "/path/to/project" }
    }
  }
}
```

Project resolution order: `--project <dir>`, then `DEZIGN0_PROJECT`, then the
process working directory. The path must exist; it is resolved through
`realpath` once at startup.

## Tools

| Tool | What it returns |
|---|---|
| `dezign0_lint` | Static craft findings with file:line and fix text. `--strict` semantics via `strict: true`. |
| `dezign0_measure` | Rendered measurement when Playwright is installed in the project: clipping, contrast, type sizes, focusables, console errors, optional a11y and screenshot baseline diff. |
| `dezign0_doctor` | Server/kit versions, 13 skills, 7 tools, agent-plugin manifest, optional packs, Node and Playwright. |
| `dezign0_design_systems` | `list`, `search`, `get` over the optional design-language pack (152 packages). |
| `dezign0_addons` | `list`, `search`, `get` over the optional addon pack (templates, Figma bridge, handoff, review, media). |
| `dezign0_content_lint` | Copy/AI-tell lint; reports "not shipped in this build" until `design-os/tools/content-lint.mjs` exists. |
| `dezign0_token_export` | DTCG/Tailwind/shadcn/platform token export; same availability rule for `token-export.mjs`. |

`dezign0_lint` and `dezign0_measure` report findings in the text and leave
`isError` unset: a P0 is a successful check with a bad artifact. `isError: true`
means the tool could not run (missing script, bad path, spawn failure).

## Protocol

- Transport: stdio, newline-delimited JSON-RPC 2.0 (the MCP stdio framing).
- Lifecycle: `initialize` (protocols `2025-06-18`, `2025-03-26`, `2024-11-05`)
  → `notifications/initialized` → `tools/list` / `tools/call` / `ping`.
- Errors: `-32700` parse, `-32600` invalid request, `-32601` unknown method,
  `-32602` unknown tool or bad arguments, `-32603` internal. Unknown
  notifications are ignored; requests before `initialize` get `-32002`.
- `tools/call` errors that are part of normal operation (bad path, missing
  script) are returned as tool results with `isError: true`, not protocol
  errors, so agents can read the fix.

## Safety

- Child checks are spawned with `execFile` and an argv array; `shell: false`.
- The source imports no HTTP/net module and calls no `fetch`.
- Every path argument is project-relative, resolved, and refused if it escapes
  the project, including through symlinks. `source`/`out` for token export get
  the same containment check.
- stdout is reserved for JSON-RPC. Diagnostics go to stderr only when
  `DEZIGN0_MCP_DEBUG=1`.

## Test

```bash
node scripts/test-mcp.mjs
```

Spawns the server against a temp project, initializes, lists tools, runs
doctor/lint (defect + clean + escape fixtures), checks protocol errors, and
verifies the process exits 0 with clean JSON-RPC stdout. It also validates
`agent-plugin/` against Agent Plugins 1.0.0 and hashes the skill copies.
