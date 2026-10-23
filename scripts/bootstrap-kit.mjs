#!/usr/bin/env node
/**
 * Claude Code SessionStart bootstrap.
 *
 * Claude Code's marketplace path loads the skills from the plugin package but
 * does not run the OpenCode plugin's setup(). Materialise the kit in the
 * project before the first model turn so `.design-os/...` references resolve.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kit = path.join(pluginRoot, "design-os");
const project = process.env.CLAUDE_PROJECT_DIR
  ? path.resolve(process.env.CLAUDE_PROJECT_DIR)
  : process.cwd();
const dest = path.join(project, ".design-os");

function fail(message) {
  console.error(`[dezign0 bootstrap] ${message}`);
  process.exit(1);
}

try {
  if (!fs.existsSync(path.join(kit, "DESIGN-OS.md"))) {
    fail(`package kit is incomplete: ${kit}`);
  }
  if (fs.existsSync(dest)) {
    const stat = fs.lstatSync(dest);
    if (stat.isSymbolicLink()) fail(`${dest} is a symlink; refusing to trust it`);
    if (!stat.isDirectory()) fail(`${dest} exists and is not a directory`);
    process.exit(0);
  }
  const temp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(temp, { recursive: true });
  try {
    fs.cpSync(kit, temp, { recursive: true });
    const version = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version || "unknown";
      } catch {
        return "unknown";
      }
    })();
    fs.writeFileSync(
      path.join(temp, ".dezign0-kit.json"),
      JSON.stringify(
        {
          schema: 1,
          package: "dezign0",
          version,
          source: "claude-code",
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    fs.renameSync(temp, dest);
  } catch (error) {
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {
      // Best effort.
    }
    throw error;
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
