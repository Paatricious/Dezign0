/**
 * Self-test for the Dezign0 eval harness.
 *
 * Proves, without a model or the network:
 *   - the eight task briefs and expected files validate;
 *   - every reference fixture scores 100 and the no-kit fixture fails;
 *   - the grader is deterministic;
 *   - run.mjs installs the kit only in WITH mode, computes WITH/WITHOUT/DELTA,
 *     emits JSON + markdown, and handles a missing artifact without crashing;
 *   - placeholder adapter commands work;
 *   - the harness source contains no network or model-call APIs.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gradeArtifact, loadPrompt, loadTask, resolveWeights, validateTask } from "../evals/grader.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const EVALS = path.join(ROOT, "evals");
const TASKS_DIR = path.join(EVALS, "tasks");
const FIXTURES = path.join(EVALS, "fixtures");
const RUN = path.join(EVALS, "run.mjs");
const LINT = path.join(ROOT, "design-os", "tools", "design-lint.mjs");
const MOCK = path.join(EVALS, "adapters", "mock.mjs");
const REQUIRED_PROFILES = [
  "prototype",
  "landing",
  "dashboard",
  "deck",
  "document",
  "email",
  "mobile",
  "component-library",
];

const tempDirs = [];
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dezign0-evals-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function runHarness(args, env = {}) {
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 240000,
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `harness exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function failingDetails(grade) {
  const lines = [];
  for (const [name, dimension] of Object.entries(grade.dimensions ?? {})) {
    if (!dimension) continue;
    for (const item of dimension.items ?? []) {
      if (!item.pass) lines.push(`${name}.${item.id}: ${item.detail}`);
    }
  }
  if (grade.lint?.counts) lines.push(`lint counts: ${JSON.stringify(grade.lint.counts)}`);
  return lines.join("\n") || "(no failing checks)";
}

function main() {
  console.log("[test-evals] task inventory");

  // ---- 1. Task inventory and required profiles ---------------------------
  const taskDirs = fs
    .readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(TASKS_DIR, entry.name));
  assert.ok(taskDirs.length >= 8, `expected at least 8 tasks, found ${taskDirs.length}`);

  const tasks = taskDirs.map((dir) => {
    assert.ok(fs.existsSync(path.join(dir, "prompt.md")), `${path.basename(dir)}: missing prompt.md`);
    assert.ok(fs.existsSync(path.join(dir, "expected.json")), `${path.basename(dir)}: missing expected.json`);
    const task = loadTask(dir);
    const prompt = loadPrompt(dir);
    validateTask(task, task.id);
    assert.equal(task.id, path.basename(dir), `${task.id}: folder name must match id`);
    assert.ok(prompt.length >= 200, `${task.id}: prompt is too thin to be a usable brief`);
    assert.ok(task.mustHave.length >= 4, `${task.id}: needs at least 4 must-have checks`);
    assert.ok(task.forbidden.length >= 3, `${task.id}: needs at least 3 forbidden checks`);
    const weights = resolveWeights(task);
    assert.equal(
      Object.values(weights).reduce((a, b) => a + b, 0),
      100,
      `${task.id}: weights must sum to 100`,
    );
    return { dir, task, prompt };
  });

  const profiles = new Set(tasks.map(({ task }) => task.profile));
  for (const profile of REQUIRED_PROFILES) {
    assert.ok(profiles.has(profile), `missing profile: ${profile}`);
  }
  assert.ok(
    tasks.length >= REQUIRED_PROFILES.length,
    `expected at least ${REQUIRED_PROFILES.length} tasks, found ${tasks.length}`,
  );

  // ---- 2. Fixtures score perfectly in WITH mode --------------------------
  console.log("[test-evals] reference fixtures");
  const grades = new Map();
  for (const { task } of tasks) {
    const fixture = path.join(FIXTURES, `${task.id}.html`);
    assert.ok(fs.existsSync(fixture), `${task.id}: missing reference fixture ${path.relative(ROOT, fixture)}`);
    const grade = gradeArtifact({ artifactPath: fixture, task, lintPath: LINT });
    grades.set(task.id, grade);
    assert.equal(
      grade.score,
      100,
      `${task.id}: reference fixture should score 100 but scored ${grade.score}\n${failingDetails(grade)}`,
    );
  }

  // Deterministic grading: same bytes, same result.
  const again = gradeArtifact({
    artifactPath: path.join(FIXTURES, "prototype-01.html"),
    task: tasks.find(({ task }) => task.id === "prototype-01").task,
    lintPath: LINT,
  });
  assert.deepEqual(again.dimensions, grades.get("prototype-01").dimensions, "grader must be deterministic");
  assert.equal(again.score, grades.get("prototype-01").score);

  // ---- 3. The no-kit fixture must fail -----------------------------------
  const badFixture = path.join(FIXTURES, "_without.html");
  assert.ok(fs.existsSync(badFixture), "missing fixtures/_without.html");
  for (const { task } of tasks) {
    const grade = gradeArtifact({ artifactPath: badFixture, task, lintPath: LINT });
    assert.ok(grade.score <= 60, `${task.id}: no-kit fixture should score <= 60, scored ${grade.score}`);
    const mustHave = grade.dimensions.mustHave.items.filter((item) => item.pass).length;
    const forbiddenHits = grade.dimensions.forbidden.items.filter((item) => !item.pass).length;
    assert.ok(mustHave < task.mustHave.length, `${task.id}: no-kit fixture should miss a must-have`);
    assert.ok(forbiddenHits > 0, `${task.id}: no-kit fixture should hit a forbidden pattern`);
  }

  // ---- 4. End-to-end WITH/WITHOUT run ------------------------------------
  console.log("[test-evals] end-to-end run (mock adapter)");
  const out1 = tempDir("run1");
  runHarness(["--adapter", `node ${JSON.stringify(MOCK)}`, "--out", out1, "--quiet"]);
  const jsonPath = path.join(out1, "results.json");
  const mdPath = path.join(out1, "results.md");
  assert.ok(fs.existsSync(jsonPath), "results.json was not written");
  assert.ok(fs.existsSync(mdPath), "results.md was not written");
  const results = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(results.schema, "dezign0/eval-run/v1");
  assert.equal(results.tasks.length, tasks.length);
  assert.ok(results.adapter.command.includes("mock.mjs"), "adapter command recorded");
  assert.ok(Array.isArray(results.disclaimers) && results.disclaimers.length >= 2, "disclaimers recorded");

  for (const record of results.tasks) {
    assert.ok(record.with && record.without, `${record.id}: both modes recorded`);
    assert.equal(record.with.score, 100, `${record.id}: WITH fixture should score 100`);
    assert.ok(record.without.score < record.with.score, `${record.id}: WITHOUT must score lower`);
    assert.equal(record.delta, record.with.score - record.without.score);
    const withKit = path.join(out1, "work", record.id, "with", ".design-os", "DESIGN-OS.md");
    const withoutKit = path.join(out1, "work", record.id, "without", ".design-os");
    assert.ok(fs.existsSync(withKit), `${record.id}: WITH workspace must contain the kit`);
    assert.ok(!fs.existsSync(withoutKit), `${record.id}: WITHOUT workspace must not contain the kit`);
    assert.ok(fs.existsSync(path.join(out1, record.with.adapter.log)), `${record.id}: WITH adapter log missing`);
  }

  assert.ok(results.aggregate.with > results.aggregate.without, "mean WITH must exceed mean WITHOUT");
  assert.ok(results.aggregate.delta >= 20, `mean delta should be substantial, got ${results.aggregate.delta}`);
  assert.equal(results.aggregate.improved, tasks.length, "every task should improve with the kit");
  assert.equal(results.aggregate.regressions, 0, "no regressions expected with the mock adapter");
  assert.equal(results.aggregate.adapterErrors, 0, "mock adapter should not error");

  const markdown = fs.readFileSync(mdPath, "utf8");
  for (const token of ["WITH", "WITHOUT", "DELTA", "not a benchmark", "Reproduce"]) {
    assert.ok(markdown.includes(token), `results.md must mention ${token}`);
  }

  // Determinism of the whole pipeline: a second run yields identical scores.
  console.log("[test-evals] determinism");
  const out2 = tempDir("run2");
  runHarness(["--adapter", `node ${JSON.stringify(MOCK)}`, "--out", out2, "--quiet"]);
  const results2 = JSON.parse(fs.readFileSync(path.join(out2, "results.json"), "utf8"));
  const scores = (result) => result.tasks.map((t) => [t.id, t.with.score, t.without.score, t.delta]);
  assert.deepEqual(scores(results2), scores(results), "two runs with the same adapter must produce identical scores");
  assert.deepEqual(results2.aggregate, results.aggregate, "aggregate scores must be identical");

  // ---- 5. Placeholder adapter contract -----------------------------------
  console.log("[test-evals] adapter placeholders");
  const out3 = tempDir("run3");
  const placeholderAdapter = `node ${JSON.stringify(MOCK)} --task {task} --mode {mode} --prompt {prompt} --out {out}`;
  runHarness(["--adapter", placeholderAdapter, "--tasks", "deck-01", "--out", out3, "--quiet"]);
  const results3 = JSON.parse(fs.readFileSync(path.join(out3, "results.json"), "utf8"));
  assert.equal(results3.tasks.length, 1);
  assert.equal(results3.tasks[0].with.score, 100, "placeholder adapter should still produce a full score");

  // ---- 6. Missing artifact does not crash the harness --------------------
  console.log("[test-evals] missing artifact");
  const out4 = tempDir("run4");
  runHarness(["--adapter", `node ${JSON.stringify(MOCK)}`, "--tasks", "prototype-01", "--out", out4, "--quiet"], {
    DEZIGN0_MOCK_FAIL: "1",
  });
  const results4 = JSON.parse(fs.readFileSync(path.join(out4, "results.json"), "utf8"));
  assert.equal(results4.tasks[0].with.score, 0);
  assert.equal(results4.tasks[0].without.score, 0);
  assert.equal(results4.tasks[0].with.error, "missing-artifact");
  assert.equal(results4.aggregate.adapterErrors, 1);

  // ---- 7. Static guarantees: no network or model dependencies -----------
  console.log("[test-evals] static guarantees");
  const sources = [
    path.join(EVALS, "run.mjs"),
    path.join(EVALS, "grader.mjs"),
    path.join(EVALS, "adapters", "mock.mjs"),
  ];
  const forbiddenApis = [
    /\bfetch\s*\(/,
    /from\s+["'](?:node:)?(?:http|https|net|dgram)["']/,
    /require\s*\(\s*["'](?:http|https|net|dgram)["']\s*\)/,
    /OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY/,
  ];
  for (const file of sources) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of forbiddenApis) {
      assert.ok(!pattern.test(source), `${path.relative(ROOT, file)} must not use ${pattern}`);
    }
  }

  // ---- 8. README documents the contract ---------------------------------
  const readme = fs.readFileSync(path.join(EVALS, "README.md"), "utf8");
  for (const token of ["--adapter", "DEZIGN0_EVAL_TASK", "WITH", "WITHOUT", "DELTA", "not a benchmark"]) {
    assert.ok(readme.includes(token), `evals/README.md must document ${token}`);
  }

  console.log(
    `[test-evals] ok: ${tasks.length} tasks, ${REQUIRED_PROFILES.length} profiles, mean delta ${results.aggregate.delta}`,
  );
}

try {
  main();
} finally {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Temp cleanup is best effort.
    }
  }
}
