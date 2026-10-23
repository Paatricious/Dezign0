# Figma bridge

Dezign0 does not ship a Figma client, token, or REST integration. The supported
path is the Figma MCP server that your harness already has, plus the
`figma-context` skill.

## Why MCP

Figma lists OpenCode in its MCP catalog with remote and local servers. The
remote server is available on the Starter plan (beta); the desktop server at
`http://127.0.0.1:3845/mcp` is the client-agnostic fallback and requires a paid
Dev/Full seat in the Figma desktop app.

The free read tools cover what the kit needs:

- `get_metadata`
- `get_design_context`
- `get_screenshot`
- `get_variable_defs`

The Variables REST API is Enterprise-only, Code Connect is component-to-code,
and write-to-canvas needs a paid seat outside drafts. Do not make any of them a
requirement.

## Configure

Use your MCP client's normal configuration. For an MCP-capable harness:

```json
{
  "mcp": {
    "figma": {
      "type": "remote",
      "url": "https://mcp.figma.com/mcp"
    }
  }
}
```

For the desktop server:

```json
{
  "mcp": {
    "figma": {
      "type": "remote",
      "url": "http://127.0.0.1:3845/mcp"
    }
  }
}
```

The exact key varies by harness. OpenChamber/OpenCode uses its own MCP settings;
Claude Code uses `.mcp.json`; Codex uses `config.toml`. This repository does not
write those files for you.

## Use

```text
Use the figma-context skill on this frame: <Figma URL or node ID>.
Extract the layout, type, color roles and component inventory. Grade every
value SOURCE / PARTIAL / GUESS and write design/<slug>/FIGMA.md.
```

Then either build against `DESIGN-SPEC.md` or feed `FIGMA.md` to
`design-system-extract` as Input B.

## Limits

- Auth, plan limits and seat checks belong to Figma and the MCP client.
- A screenshot is not a rendered artifact; it does not replace
  `measure-artifact`.
- Do not proxy Figma through Dezign0's tools or store a Figma token in the kit.
- Do not parse `.fig` files or scrape assets.
