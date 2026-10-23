#!/usr/bin/env node
/**
 * Dezign0 eval harness: run a user-supplied agent adapter WITH and WITHOUT the
 * kit, grade both artifacts deterministically, and emit the delta as JSON and
 * markdown.
 *
 * The harness itself never calls a model or the network. The adapter is any
 * command the user supplies; it receives the task, mode, prompt path, output path
 * and workspace, and writes one HTML artifact.
 *
 * Usage:
 *   node evals/run.mjs --adapter "node my-agent.mjs"
 *   node evals/run.mjs --adapter "node my-agent.mjs" --tasks landing-01,deck-01
 *   node evals/run.mjs --adapter "my-agent --task {task} --mode {mode}" --out /tmp/run
 *
 * See evals/README.md for the adapter contract.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { gradeArtifact, loadPrompt, loadTask, validateTask } from "./grader.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");
const TASKS_DIR = path.join(HERE, "tasks");
const KIT_DEFAULT = path.join(ROOT, "design-os");
const LINT_PATH = path.join(KIT_DEFAULT, "tools", "design-lint.mjs");
const PASS_THRESHOLD = 70;
const SCHEMA = "dezign0/eval-run/v1";
const PLACEHOLDER = /\{(task|mode|prompt|out|workspace|kit)\}/g;

const KIT_PROMPT = [
  "",
  "---",
  "",
  "## Installed kit",
  "",
  "The Dezign0 design kit is installed in this workspace at `.design-os/`.",
  "Read `.design-os/DESIGN-OS.md` first, then the profile guidance and templates",
  "that apply to this deliverable. Follow the kit's craft rules and write the",
  "artifact to the exact output path you were given.",
  "",
].join("\n");

function usage(code = 2) {
  console.error(`Usage: node evals/run.mjs --adapter "<command>" [options]

Options:
  --adapter <cmd>    Required. Adapter command. Placeholders: {task} {mode}
                     {prompt} {out} {workspace} {kit}. Without placeholders the
                     harness appends --task/--mode/--prompt/--out/--workspace.
  --tasks <list>     Comma-separated task ids, or "all" (default).
  --out <dir>        Output directory (default: evals/results/run-<utc>).
  --kit <dir>        Kit directory to install in WITH mode (default: design-os/).
  --timeout <ms>     Per-adapter timeout (default: 120000).
  --shell            Run the adapter through the platform shell.
  --quiet            Only print the final summary.
  -h, --help         Show this help.`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    adapter: null,
    tasks: "all",
    out: null,
    kit: KIT_DEFAULT,
    timeout: 120000,
    shell: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--adapter":
        args.adapter = argv[++i];
        break;
      case "--tasks":
        args.tasks = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--kit":
        args.kit = path.resolve(argv[++i]);
        break;
      case "--timeout":
        args.timeout = Number(argv[++i]);
        break;
      case "--shell":
        args.shell = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage(2);
    }
  }
  if (!args.adapter || typeof args.adapter !== "string") {
    console.error("--adapter is required");
    usage(2);
  }
  if (!Number.isFinite(args.timeout) || args.timeout < 1000) {
    console.error("--timeout must be a number >= 1000");
    usage(2);
  }
  return args;
}

/** Split a command string into argv tokens. Supports single and double quotes. */
function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) throw new Error("unbalanced quote in adapter command");
  if (started || current) tokens.push(current);
  if (tokens.length === 0) throw new Error("adapter command is empty");
  return tokens;
}

function adapterCommand(template, vars) {
  const hasPlaceholders = PLACEHOLDER.test(template);
  PLACEHOLDER.lastIndex = 0;
  if (hasPlaceholders) {
    const filled = template.replace(PLACEHOLDER, (_, key) => vars[key] ?? "");
    return tokenize(filled);
  }
  const tokens = tokenize(template);
  tokens.push(
    "--task",
    vars.task,
    "--mode",
    vars.mode,
    "--prompt",
    vars.prompt,
    "--out",
    vars.out,
    "--workspace",
    vars.workspace,
  );
  if (vars.kit) tokens.push("--kit", vars.kit);
  return tokens;
}

/**
 * Adapters run with cwd set to the per-task workspace (so the kit is local), but
 * users naturally write paths relative to where they ran the harness. Resolve a
 * relative script path against the invocation directory when it does not exist
 * in the workspace.
 */
function resolveAdapterPaths(tokens, cwd) {
  return tokens.map((token) => {
    if (token.startsWith("-")) return token;
    const looksLikePath = /[\\/]/.test(token) || /\.(?:mjs|cjs|js|ts|py|sh)$/.test(token);
    if (!looksLikePath || path.isAbsolute(token)) return token;
    if (fs.existsSync(path.resolve(cwd, token))) return path.resolve(cwd, token);
    const fromInvocation = path.resolve(process.cwd(), token);
    return fs.existsSync(fromInvocation) ? fromInvocation : token;
  });
}

function listTasks(selection) {
  if (!fs.existsSync(TASKS_DIR)) throw new Error(`tasks directory not found: ${TASKS_DIR}`);
  const dirs = fs
    .readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(TASKS_DIR, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "expected.json")));
  const tasks = dirs.map((dir) => ({ dir, task: loadTask(dir), prompt: loadPrompt(dir) }));
  const sorted = tasks.sort((a, b) => a.task.id.localeCompare(b.task.id));
  if (selection === "all") return sorted;
  const wanted = new Set(
    selection
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  const selected = sorted.filter((entry) => wanted.has(entry.task.id));
  const missing = [...wanted].filter((id) => !selected.some((entry) => entry.task.id === id));
  if (missing.length > 0) throw new Error(`unknown task id(s): ${missing.join(", ")}`);
  if (selected.length === 0) throw new Error("no tasks selected");
  return selected;
}

function copyKit(source, dest) {
  fs.cpSync(source, dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== "node_modules" && base !== ".git";
    },
  });
}

function runAdapter({ template, shell, args, cwd, env, timeout, logFile }) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let child;
    const usingShell = shell;
    if (usingShell) {
      const commandLine = args.map((token) => quoteForShell(token)).join(" ");
      child = spawn(commandLine, {
        cwd,
        env,
        shell: true,
        windowsHide: true,
      });
    } else {
      child = spawn(args[0], args.slice(1), {
        cwd,
        env,
        shell: false,
        windowsHide: true,
      });
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const limit = Math.max(4096, timeout);
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < limit) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < limit) stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    const finish = (code, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const log = [
        `$ ${args.join(" ")}`,
        `exit ${code}${signal ? ` signal ${signal}` : ""}${timedOut ? " (timeout)" : ""}`,
        "",
        stdout ? `--- stdout ---\n${stdout}` : "",
        stderr ? `--- stderr ---\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      try {
        fs.writeFileSync(logFile, log);
      } catch {
        // Logging must not abort the run.
      }
      resolve({
        exitCode: code,
        signal: signal ?? null,
        timedOut,
        durationMs: Math.round(durationMs),
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
        spawnError: error ? String(error.message ?? error) : null,
      });
    };
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
}

function quoteForShell(token) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(token) ? token : `"${token.replace(/"/g, '\\"')}"`;
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function mean(values) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function dimensionRow(label, withDim, withoutDim) {
  if (!withDim && !withoutDim) return null;
  return {
    dimension: label,
    with: withDim ? `${withDim.score}/${withDim.max}` : "—",
    without: withoutDim ? `${withoutDim.score}/${withoutDim.max}` : "—",
    delta:
      withDim && withoutDim ? `${withDim.score - withoutDim.score >= 0 ? "+" : ""}${withDim.score - withoutDim.score}` : "—",
  };
}

function failedItems(dimension) {
  return (dimension?.items ?? []).filter((item) => !item.pass);
}

function buildDelta(runs) {
  const mustHaveGained = [];
  const mustHaveLost = [];
  const forbiddenCleared = [];
  const forbiddenAdded = [];
  for (const run of runs) {
    const withMissing = new Set(failedItems(run.with.grade?.dimensions?.mustHave).map((item) => item.id));
    const withoutMissing = new Set(failedItems(run.without.grade?.dimensions?.mustHave).map((item) => item.id));
    for (const id of withoutMissing) if (!withMissing.has(id)) mustHaveGained.push(`${run.id}:${id}`);
    for (const id of withMissing) if (!withoutMissing.has(id)) mustHaveLost.push(`${run.id}:${id}`);
    const withForbidden = new Set(failedItems(run.with.grade?.dimensions?.forbidden).map((item) => item.id));
    const withoutForbidden = new Set(failedItems(run.without.grade?.dimensions?.forbidden).map((item) => item.id));
    for (const id of withoutForbidden) if (!withForbidden.has(id)) forbiddenCleared.push(`${run.id}:${id}`);
    for (const id of withForbidden) if (!withoutForbidden.has(id)) forbiddenAdded.push(`${run.id}:${id}`);
  }
  return { mustHaveGained, mustHaveLost, forbiddenCleared, forbiddenAdded };
}

function renderMarkdown(result) {
  const lines = [];
  const add = (line = "") => lines.push(line);
  add("# Dezign0 eval run");
  add();
  add(`Run: \`${result.runId}\` · Adapter: \`${result.adapter.command}\` · Tasks: ${result.tasks.length}`);
  add();
  add(
    "> **Harness output, not a benchmark.** Scores grade artifacts produced by the adapter you supplied; they say nothing about other agents, and are not comparable across adapters, prompts or hardware. The harness makes no model or network calls.",
  );
  add();
  add("## Summary");
  add();
  add("| Task | Profile | WITH | WITHOUT | DELTA | WITH ≥70 | WITHOUT ≥70 |");
  add("|---|---|---:|---:|---:|:---:|:---:|");
  for (const run of result.tasks) {
    add(
      `| ${run.id} | ${run.profile} | ${formatScore(run.with.score)} | ${formatScore(run.without.score)} | ${deltaLabel(run.delta)} | ${run.with.score >= PASS_THRESHOLD ? "yes" : "no"} | ${run.without.score >= PASS_THRESHOLD ? "yes" : "no"} |`,
    );
  }
  add();
  add("| Aggregate | Value |");
  add("|---|---:|");
  add(`| Mean WITH | ${formatScore(result.aggregate.with)} |`);
  add(`| Mean WITHOUT | ${formatScore(result.aggregate.without)} |`);
  add(`| Mean DELTA | ${deltaLabel(result.aggregate.delta)} |`);
  add(`| Tasks improved (WITH > WITHOUT) | ${result.aggregate.improved}/${result.tasks.length} |`);
  add(`| Ties | ${result.aggregate.ties} |`);
  add(`| Regressions (WITH < WITHOUT) | ${result.aggregate.regressions} |`);
  add(`| Adapter errors | ${result.aggregate.adapterErrors} |`);
  add();
  add("## What changed");
  add();
  add(`- Must-have checks gained in WITH: ${result.delta.mustHaveGained.length}`);
  if (result.delta.mustHaveGained.length > 0) {
    add(`  - ${result.delta.mustHaveGained.join(", ")}`);
  }
  add(`- Must-have checks lost in WITH: ${result.delta.mustHaveLost.length}`);
  if (result.delta.mustHaveLost.length > 0) {
    add(`  - ${result.delta.mustHaveLost.join(", ")}`);
  }
  add(`- Forbidden checks cleared in WITH: ${result.delta.forbiddenCleared.length}`);
  if (result.delta.forbiddenCleared.length > 0) {
    add(`  - ${result.delta.forbiddenCleared.join(", ")}`);
  }
  add(`- Forbidden checks newly hit in WITH: ${result.delta.forbiddenAdded.length}`);
  if (result.delta.forbiddenAdded.length > 0) {
    add(`  - ${result.delta.forbiddenAdded.join(", ")}`);
  }
  add();
  add("## Per-task detail");
  for (const run of result.tasks) {
    add();
    add(`### ${run.id} — ${run.task.title}`);
    add();
    add(`Profile: ${run.profile} · WITH **${formatScore(run.with.score)}** · WITHOUT **${formatScore(run.without.score)}** · DELTA **${deltaLabel(run.delta)}**`);
    add();
    if (run.with.error || run.without.error) {
      add(`Adapter/grade errors: WITH ${run.with.error ?? "none"} · WITHOUT ${run.without.error ?? "none"}`);
      add();
    }
    add("| Dimension | WITH | WITHOUT | Δ |");
    add("|---|---:|---:|---:|");
    const rows = [
      dimensionRow("Must-have", run.with.grade?.dimensions?.mustHave, run.without.grade?.dimensions?.mustHave),
      dimensionRow("Forbidden", run.with.grade?.dimensions?.forbidden, run.without.grade?.dimensions?.forbidden),
      dimensionRow("Lint", run.with.grade?.dimensions?.lint, run.without.grade?.dimensions?.lint),
      dimensionRow("Content", run.with.grade?.dimensions?.content, run.without.grade?.dimensions?.content),
      dimensionRow("A11y (static)", run.with.grade?.dimensions?.a11y, run.without.grade?.dimensions?.a11y),
      dimensionRow("Structure", run.with.grade?.dimensions?.structure, run.without.grade?.dimensions?.structure),
    ].filter(Boolean);
    for (const row of rows) add(`| ${row.dimension} | ${row.with} | ${row.without} | ${row.delta} |`);
    add();
    const withMissing = failedItems(run.with.grade?.dimensions?.mustHave);
    if (withMissing.length > 0) {
      add(`Missing must-have in WITH: ${withMissing.map((item) => `${item.id} (${item.description})`).join("; ")}`);
      add();
    }
    const withoutForbidden = failedItems(run.without.grade?.dimensions?.forbidden);
    if (withoutForbidden.length > 0) {
      add(`Forbidden hits in WITHOUT: ${withoutForbidden.map((item) => `${item.id} (${item.description})`).join("; ")}`);
      add();
    }
    const lintWith = run.with.grade?.lint?.counts;
    const lintWithout = run.without.grade?.lint?.counts;
    if (lintWith || lintWithout) {
      add(
        `Lint: WITH P0=${lintWith?.P0 ?? "?"} P1=${lintWith?.P1 ?? "?"} P2=${lintWith?.P2 ?? "?"} · WITHOUT P0=${lintWithout?.P0 ?? "?"} P1=${lintWithout?.P1 ?? "?"} P2=${lintWithout?.P2 ?? "?"}`,
      );
      add();
    }
    add(`Artifacts: \`${path.relative(result.outDir, run.with.artifactPath)}\`, \`${path.relative(result.outDir, run.without.artifactPath)}\``);
  }
  add();
  add("## Reproduce");
  add();
  add("```bash");
  add(`node evals/run.mjs --adapter ${JSON.stringify(result.adapter.command)} --tasks ${result.tasks.map((run) => run.id).join(",")}`);
  add("```");
  add();
  add("## Method");
  add();
  add("- Both modes use the same task prompt. WITH mode additionally installs the kit at `.design-os/` in the workspace and appends a short pointer to it.");
  add("- The adapter is user-supplied and runs once per task per mode. The harness records its exit code, stdout/stderr and duration but never interprets its prose.");
  add("- Grading is deterministic and dependency-free: regex expectations, forbidden patterns, the kit's static linter, a content audit, static a11y checks and structural checks. Rendered measurement is not part of the grade.");
  add("- No model calls and no network calls are made by the harness; `evals/grader.mjs` imports only Node built-ins.");
  add("- Scores are integers 0–100. The pass threshold used in the table is 70 and is a reading aid, not a standard.");
  add();
  return `${lines.join("\n")}\n`;
}

function deltaLabel(value) {
  return `${value >= 0 ? "+" : ""}${formatScore(value)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.kit)) {
    console.error(`kit directory not found: ${args.kit}`);
    process.exit(3);
  }
  let tasks;
  try {
    tasks = listTasks(args.tasks);
  } catch (error) {
    console.error(`[eval] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(args.out ?? path.join(HERE, "results", `run-${runId}`));
  fs.mkdirSync(outDir, { recursive: true });

  const envBase = {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    DEZIGN0_EVAL_RUN: runId,
  };

  const runs = [];
  for (const entry of tasks) {
    const record = {
      id: entry.task.id,
      profile: entry.task.profile,
      task: { title: entry.task.title, artifact: entry.task.artifact },
      with: null,
      without: null,
      delta: 0,
    };
    for (const mode of ["with", "without"]) {
      const workspace = path.join(outDir, "work", entry.task.id, mode);
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.mkdirSync(path.join(workspace, "out"), { recursive: true });
      const kitDir = mode === "with" ? path.join(workspace, ".design-os") : null;
      if (kitDir) copyKit(args.kit, kitDir);
      const promptText = mode === "with" ? `${entry.prompt}\n${KIT_PROMPT}` : `${entry.prompt}\n`;
      const promptPath = path.join(workspace, "prompt.md");
      fs.writeFileSync(promptPath, promptText);
      const artifactPath = path.join(workspace, "out", entry.task.artifact);
      const logFile = path.join(workspace, "adapter.log");
      const vars = {
        task: entry.task.id,
        mode,
        prompt: promptPath,
        out: artifactPath,
        workspace,
        kit: kitDir ?? "",
      };
      const tokens = resolveAdapterPaths(adapterCommand(args.adapter, vars), workspace);
      const env = {
        ...envBase,
        DEZIGN0_EVAL_TASK: vars.task,
        DEZIGN0_EVAL_MODE: mode,
        DEZIGN0_EVAL_PROMPT: vars.prompt,
        DEZIGN0_EVAL_OUT: vars.out,
        DEZIGN0_EVAL_WORKSPACE: vars.workspace,
        DEZIGN0_EVAL_KIT: vars.kit,
      };
      if (!args.quiet) console.error(`[eval] ${entry.task.id} ${mode}`);
      const adapter = await runAdapter({
        template: args.adapter,
        shell: args.shell,
        args: tokens,
        cwd: workspace,
        env,
        timeout: args.timeout,
        logFile,
      });
      const grade = gradeArtifact({ artifactPath, task: entry.task, lintPath: LINT_PATH });
      record[mode] = {
        score: grade.score,
        error: grade.error,
        artifactPath,
        artifact: grade.artifact,
        adapter: {
          exitCode: adapter.exitCode,
          timedOut: adapter.timedOut,
          durationMs: adapter.durationMs,
          spawnError: adapter.spawnError,
          log: path.relative(outDir, logFile),
        },
        grade: {
          dimensions: grade.dimensions,
          lint: grade.lint,
        },
      };
    }
    record.delta = record.with.score - record.without.score;
    runs.push(record);
  }

  const aggregate = {
    with: mean(runs.map((run) => run.with.score)),
    without: mean(runs.map((run) => run.without.score)),
    delta: mean(runs.map((run) => run.delta)),
    improved: runs.filter((run) => run.delta > 0).length,
    ties: runs.filter((run) => run.delta === 0).length,
    regressions: runs.filter((run) => run.delta < 0).length,
    adapterErrors: runs.filter(
      (run) => run.with.error || run.without.error || run.with.adapter.exitCode !== 0 || run.without.adapter.exitCode !== 0,
    ).length,
  };

  const result = {
    schema: SCHEMA,
    runId,
    generatedAt: new Date().toISOString(),
    harness: {
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      passThreshold: PASS_THRESHOLD,
      schemaTasks: "dezign0/eval-task/v1",
    },
    adapter: { command: args.adapter, shell: args.shell, timeoutMs: args.timeout },
    kit: { path: path.relative(ROOT, args.kit).split(path.sep).join("/") || ".", lintPath: path.relative(ROOT, LINT_PATH).split(path.sep).join("/") },
    outDir,
    tasks: runs,
    aggregate,
    delta: buildDelta(runs),
    disclaimers: [
      "Harness output for a user-supplied adapter; this is not a published benchmark.",
      "Scores are only comparable across runs with the same adapter, tasks and kit version.",
      "The harness makes no model or network calls; artifact quality is the adapter's output.",
    ],
  };

  const jsonPath = path.join(outDir, "results.json");
  const mdPath = path.join(outDir, "results.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderMarkdown(result));

  console.log("");
  console.log("task                 profile            WITH  WITHOUT  DELTA");
  console.log("-------------------  -----------------  ----  -------  -----");
  for (const run of runs) {
    console.log(
      `${run.id.padEnd(19)}  ${run.profile.padEnd(17)}  ${String(run.with.score).padStart(4)}  ${String(run.without.score).padStart(7)}  ${deltaLabel(run.delta).padStart(5)}`,
    );
  }
  console.log("");
  console.log(`mean WITH ${formatScore(aggregate.with)} · mean WITHOUT ${formatScore(aggregate.without)} · mean DELTA ${deltaLabel(aggregate.delta)}`);
  console.log(`results: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`report:  ${path.relative(process.cwd(), mdPath)}`);
}

main().catch((error) => {
  console.error(`[eval] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
