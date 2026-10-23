#!/usr/bin/env node
/**
 * Smoke suite for the advanced design tools exposed by `dezign0 tool`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = path.join(ROOT, "design-os", "tools");
const cases = [
  ["ingest", ["--help"], 0],
  ["gallery", ["--json"], 0],
  ["conformance", ["--help"], 0],
  ["review", ["--self-test"], 0],
  ["safety-scan", ["--self-test"], 0],
  ["audit-matrix", ["--help"], 0],
  ["compliance", ["--self-test"], 0],
  ["context-report", ["--self-test"], 0],
];
let failed = 0;

for (const [name, args, expected] of cases) {
  const file = path.join(TOOLS, `${name}.mjs`);
  if (!fs.existsSync(file)) {
    console.error(`FAIL ${name}: missing ${file}`);
    failed += 1;
    continue;
  }
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (check.status !== 0) {
    console.error(`FAIL ${name}: syntax error`);
    failed += 1;
    continue;
  }
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== expected) {
    console.error(`FAIL ${name} ${args.join(" ")}: exit ${result.status}, expected ${expected}`);
    if (result.stderr) console.error(result.stderr.slice(0, 500));
    failed += 1;
    continue;
  }
  console.log(`ok   ${name} ${args.join(" ")}`);
}

console.log(failed === 0 ? `advanced tools: ${cases.length}/${cases.length} passed` : `advanced tools: ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
