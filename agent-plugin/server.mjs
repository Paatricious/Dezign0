#!/usr/bin/env node
/**
 * Agent Plugins MCP entrypoint.
 *
 * Agent Plugins (v1.0.0) launches MCP servers from the plugin root, so
 * mcp.json points at this file. The implementation lives in the canonical
 * `mcp/server.mjs` of the dezign0 repository checkout; this bootstrap only
 * resolves it and forwards. Keeping one implementation means the plugin and
 * the standalone MCP entry cannot drift.
 *
 * Node 18+.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverUrl = new URL("../mcp/server.mjs", import.meta.url);

if (!existsSync(fileURLToPath(serverUrl))) {
  process.stderr.write(
    "[dezign0] agent-plugin needs the sibling mcp/ directory from the dezign0 repository checkout.\n" +
      "Install the repository or the npm package, not the agent-plugin/ folder alone.\n",
  );
  process.exit(2);
}

await import(serverUrl.href);
