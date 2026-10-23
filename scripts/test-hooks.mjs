#!/usr/bin/env node
/**
 * Lifecycle hook regression test. Runs the real hook scripts against a
 * temporary project and asserts the block/allow contract.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POST = path.join(ROOT, "scripts", "hook-post-tool.mjs");
const STOP = path.join(ROOT, "scripts", "hook-stop.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dezign0-hooks-"));
let failures = 0;

function run(script, input) {
  return spawnSync(process.execPath, [script], {
    cwd: tmp,
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 30_000,
  });
}
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

fs.writeFileSync(path.join(tmp, "good.html"), "<!doctype html><html><body><h1>Good</h1></body></html>");
fs.writeFileSync(
  path.join(tmp, "bad.html"),
  '<!doctype html><html><body><div style="background:linear-gradient(#6366f1,#a855f7)">x</div></body></html>',
);

const good = run(POST, { tool_name: "Write", tool_input: { file_path: "good.html" } });
check("PostToolUse allows clean HTML", good.status === 0, `exit ${good.status}`);

const bad = run(POST, { tool_name: "Write", tool_input: { file_path: "bad.html" } });
check("PostToolUse blocks P0 HTML", bad.status === 2, `exit ${bad.status}`);
check("PostToolUse explains the P0", /blocking P0|purple-gradient/i.test(bad.stderr), bad.stderr.slice(0, 120));

const nonHtml = run(POST, { tool_name: "Write", tool_input: { file_path: "notes.md" } });
check("PostToolUse ignores non-HTML", nonHtml.status === 0, `exit ${nonHtml.status}`);

const missing = run(POST, { tool_name: "Write", tool_input: {} });
check("PostToolUse ignores missing path", missing.status === 0, `exit ${missing.status}`);

const stop = run(STOP, {});
check("Stop blocks P0 in recent HTML", stop.status === 2, `exit ${stop.status}`);
check("Stop explains the P0", /review gate|blocking P0/i.test(stop.stderr), stop.stderr.slice(0, 120));

const active = run(STOP, { stop_hook_active: true });
check("Stop does not loop when stop_hook_active", active.status === 0, `exit ${active.status}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nlifecycle hooks: all checks passed" : `\nlifecycle hooks: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
