#!/usr/bin/env node
/**
 * Mock eval adapter, used by scripts/test-evals.mjs and as a reference for the
 * adapter contract.
 *
 * It is not an agent. It copies a fixture:
 *   - WITH mode:      evals/fixtures/<task>.html  (the reference artifact)
 *   - WITHOUT mode:   evals/fixtures/_without.html (a deliberately poor artifact)
 *
 * Set DEZIGN0_MOCK_FAIL=1 to exit 0 without writing an artifact, which exercises
 * the harness's missing-artifact path.
 *
 * Adapter contract:
 *   node mock.mjs --task <id> --mode with|without --prompt <path>
 *                 --out <artifact path> --workspace <dir> [--kit <dir>]
 *   Env mirrors: DEZIGN0_EVAL_TASK, DEZIGN0_EVAL_MODE, DEZIGN0_EVAL_PROMPT,
 *   DEZIGN0_EVAL_OUT, DEZIGN0_EVAL_WORKSPACE, DEZIGN0_EVAL_KIT.
 * The adapter must write the artifact to --out (or DEZIGN0_EVAL_OUT).
 */
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--task" || key === "--mode" || key === "--prompt" || key === "--out" || key === "--workspace" || key === "--kit") {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const task = args.task ?? process.env.DEZIGN0_EVAL_TASK;
const mode = args.mode ?? process.env.DEZIGN0_EVAL_MODE;
const out = args.out ?? process.env.DEZIGN0_EVAL_OUT;
const fixtureDir = path.resolve(import.meta.dirname, "..", "fixtures");

if (!task || !mode || !out) {
  console.error("mock adapter: --task, --mode and --out (or env) are required");
  process.exit(2);
}
if (mode !== "with" && mode !== "without") {
  console.error(`mock adapter: unknown mode ${mode}`);
  process.exit(2);
}

if (process.env.DEZIGN0_MOCK_FAIL === "1") {
  console.error("mock adapter: DEZIGN0_MOCK_FAIL=1, writing no artifact");
  process.exit(0);
}

const fixture = mode === "with" ? path.join(fixtureDir, `${task}.html`) : path.join(fixtureDir, "_without.html");
if (!fs.existsSync(fixture)) {
  console.error(`mock adapter: fixture missing: ${fixture}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(fixture, out);
console.log(`mock adapter: ${task} ${mode} -> ${path.basename(out)} (${fs.statSync(out).size} bytes)`);
