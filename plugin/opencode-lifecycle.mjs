/**
 * OpenCode lifecycle observer.
 *
 * OpenCode's native plugin API exports functions that return hooks. This
 * observer is deliberately non-blocking: tool writes cannot be vetoed from
 * `tool.execute.after`, so P0 findings are surfaced when the session goes idle.
 * Claude Code gets the blocking gate through hooks/hooks.json.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "bin", "dezign0.mjs");

function fileFromEvent(event) {
  const props = event?.properties || {};
  return props.file || props.path || props.filePath || props.filename || null;
}

async function lint(file, cwd) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, "lint", "--json", file], {
      cwd,
      timeout: 20_000,
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.stdout) {
      try {
        return JSON.parse(String(error.stdout));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export const Dezign0OpenCodePlugin = async ({ directory, client } = {}) => {
  const cwd = path.resolve(directory || process.cwd());
  const alerts = new Map();

  return {
    event: async ({ event } = {}) => {
      if (event?.type === "file.edited") {
        const raw = fileFromEvent(event);
        if (!raw || !/\.(html?|xhtml)$/i.test(raw)) return;
        const file = path.resolve(cwd, raw);
        if (!file.startsWith(cwd + path.sep) || file.includes(`${path.sep}.design-os${path.sep}`)) return;
        const result = await lint(file, cwd);
        const p0 = result?.findings?.filter((finding) => finding.severity === "P0") || [];
        if (p0.length) alerts.set(file, p0);
        return;
      }

      if (event?.type === "session.idle" && alerts.size > 0) {
        const total = [...alerts.values()].reduce((sum, findings) => sum + findings.length, 0);
        const files = [...alerts.keys()].map((file) => path.relative(cwd, file)).slice(0, 5);
        const body = `Dezign0: ${total} P0 finding(s) in ${files.join(", ")}. Run dezign0 lint --strict before handover.`;
        try {
          await client?.tui?.showToast?.({ body, variant: "warning" });
        } catch {
          console.warn(`[dezign0] ${body}`);
        }
        alerts.clear();
      }
    },
  };
};
