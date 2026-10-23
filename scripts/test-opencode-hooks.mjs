#!/usr/bin/env node
/**
 * OpenCode lifecycle observer regression test.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Dezign0OpenCodePlugin } from "../plugin/index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dezign0-oc-hooks-"));
fs.writeFileSync(
  path.join(tmp, "bad.html"),
  '<!doctype html><html><body><div style="background:linear-gradient(#6366f1,#a855f7)">x</div></body></html>',
);
fs.writeFileSync(path.join(tmp, "good.html"), "<!doctype html><html><body><h1>Good</h1></body></html>");

const toasts = [];
const hooks = await Dezign0OpenCodePlugin({
  directory: tmp,
  client: { tui: { showToast: async (input) => toasts.push(input) } },
});

await hooks.event({ event: { type: "file.edited", properties: { file: "good.html" } } });
await hooks.event({ event: { type: "file.edited", properties: { file: "bad.html" } } });
await hooks.event({ event: { type: "file.edited", properties: { file: "notes.md" } } });
await hooks.event({ event: { type: "session.idle" } });

assert.equal(toasts.length, 1, "one idle notification");
assert.match(toasts[0].body, /P0 finding/);
assert.ok(!toasts[0].body.includes("good.html"), "clean file not reported");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("opencode lifecycle: 4/4 checks passed");
