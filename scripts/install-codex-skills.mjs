#!/usr/bin/env node
/**
 * install-codex-skills — copy the Dezign0 skills to Codex's native skill path.
 *
 * Codex scans `.agents/skills/<name>/SKILL.md` from the working directory up to
 * the repository root (Agent Skills layout). This script installs the core
 * skills there without touching the kit, AGENTS.md or any other installer
 * output. install.mjs remains the full harness installer; this is the narrow
 * Codex-native skill path until `design-os/adapters/codex.json` is updated by
 * its owner.
 *
 * Usage:
 *   node scripts/install-codex-skills.mjs [--target=<dir>] [--scope=project|global]
 *                                        [--force] [--dry-run] [--check] [--self-test] [--json]
 *
 * Defaults: --target=<cwd> --scope=project, so skills land in
 * <target>/.agents/skills/<name>/. --scope=global writes ~/.agents/skills.
 *
 * Modes:
 *   (default)   copy missing skills; existing skills are skipped unless --force
 *   --dry-run   print the plan, write nothing
 *   --check     read-only drift check: missing/modified skills exit 1
 *   --self-test install into a temp dir, verify 13 skills and hashes, clean up
 *
 * Exit codes: 0 ok, 1 drift or failure, 2 usage/read error.
 * No dependencies, no network. Node 18+.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SKILLS_SRC = path.join(REPO, "design-os", "skills");
const EXPECTED_SKILLS = [
  "code-handoff",
  "critique",
  "design-brief",
  "design-language",
  "design-system-extract",
  "figma-context",
  "figma-to-code",
  "frontend-design",
  "media-brief",
  "redesign",
  "state-board",
  "template-start",
  "visual-review",
];

class UsageError extends Error {}

function parseArgs(argv) {
  const out = {
    target: process.cwd(),
    scope: "project",
    force: false,
    dryRun: false,
    check: false,
    selfTest: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--check") out.check = true;
    else if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) throw new UsageError("--target needs a directory");
      out.target = value;
      index += 1;
    } else if (arg.startsWith("--target=")) out.target = arg.slice("--target=".length);
    else if (arg === "--scope") {
      const value = argv[index + 1];
      if (!value) throw new UsageError("--scope needs project or global");
      out.scope = value;
      index += 1;
    } else if (arg.startsWith("--scope=")) out.scope = arg.slice("--scope=".length);
    else throw new UsageError(`unknown option: ${arg}`);
  }
  if (!["project", "global"].includes(out.scope)) throw new UsageError("--scope must be project or global");
  if (out.check && out.dryRun) throw new UsageError("use either --check or --dry-run, not both");
  return out;
}

function usage() {
  console.log(`Codex skills installer (Dezign0)

Usage:
  node scripts/install-codex-skills.mjs [--target=<dir>] [--scope=project|global]
                                       [--force] [--dry-run] [--check] [--self-test] [--json]

Installs the thirteen Dezign0 skills to Codex's native path:
  project (default): <target>/.agents/skills/<name>/SKILL.md
  global:            ~/.agents/skills/<name>/SKILL.md

Options:
  --target=<dir>   Project directory (default: current directory)
  --scope=<s>      project (default) or global
  --force          overwrite skills that already exist
  --dry-run        print the plan, write nothing
  --check          verify an existing install and exit 1 on drift (writes nothing)
  --self-test      install into a temp directory, verify, clean up
  --json           machine-readable output
  --help           show this help

No dependencies, no network. Node 18+.`);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walk(root, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function sourceSkills() {
  if (!fs.existsSync(SKILLS_SRC)) throw new UsageError(`skills folder is missing: ${SKILLS_SRC}`);
  const names = fs
    .readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SKILLS_SRC, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  if (!names.length) throw new UsageError(`no SKILL.md found under ${SKILLS_SRC}`);
  return names;
}

function resolveTarget(args) {
  if (args.selfTest) {
    return { root: fs.mkdtempSync(path.join(os.tmpdir(), "dezign0-codex-skills-")), temporary: true };
  }
  if (args.scope === "global") return { root: path.join(os.homedir(), ".agents", "skills"), temporary: false };
  const target = path.resolve(args.target);
  if (!fs.existsSync(target)) throw new UsageError(`target does not exist: ${target}`);
  if (!fs.statSync(target).isDirectory()) throw new UsageError(`target is not a directory: ${target}`);
  const sourceKit = path.join(REPO, "design-os");
  const relative = path.relative(sourceKit, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new UsageError("target is inside design-os/; pass the project you are designing");
  }
  return { root: path.join(target, ".agents", "skills"), temporary: false, project: target };
}

function copySkill(name, destinationRoot, force, dryRun) {
  const source = path.join(SKILLS_SRC, name);
  const destination = path.join(destinationRoot, name);
  if (fs.existsSync(destination) && !force) return { name, status: "skipped", reason: "exists" };
  const files = [];
  let copied = 0;
  for (const relative of walk(source)) {
    const to = path.join(destination, relative);
    if (fs.existsSync(to) && !force) {
      files.push({ file: relative, status: "kept" });
      continue;
    }
    files.push({ file: relative, status: fs.existsSync(to) ? "updated" : "copied" });
    copied += 1;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(source, relative), to);
    }
  }
  return { name, status: files.some((entry) => entry.status === "copied" || entry.status === "updated") ? "installed" : "unchanged", files, changed: copied };
}

function checkSkill(name, destinationRoot) {
  const source = path.join(SKILLS_SRC, name);
  const destination = path.join(destinationRoot, name);
  if (!fs.existsSync(destination)) return { name, status: "missing", files: [] };
  const sourceFiles = walk(source);
  const destinationFiles = fs.existsSync(destination) ? walk(destination) : [];
  const missing = sourceFiles.filter((relative) => !destinationFiles.includes(relative));
  const extra = destinationFiles.filter((relative) => !sourceFiles.includes(relative));
  const modified = sourceFiles.filter((relative) => {
    const installed = path.join(destination, relative);
    return destinationFiles.includes(relative) && fs.existsSync(installed) && sha256(path.join(source, relative)) !== sha256(installed);
  });
  if (missing.length || extra.length || modified.length) {
    return { name, status: "drifted", missing, extra, modified };
  }
  return { name, status: "ok", files: sourceFiles.length };
}

function verifySelfTest(destinationRoot) {
  const problems = [];
  const names = sourceSkills();
  for (const expected of EXPECTED_SKILLS) {
    if (!names.includes(expected)) problems.push(`source is missing skill ${expected}`);
  }
  if (names.length !== EXPECTED_SKILLS.length) problems.push(`expected ${EXPECTED_SKILLS.length} source skills, found ${names.length}`);
  for (const name of names) {
    const result = checkSkill(name, destinationRoot);
    if (result.status !== "ok") problems.push(`${name}: ${result.status}`);
    const skillFile = path.join(destinationRoot, name, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      problems.push(`${name}: SKILL.md was not installed`);
      continue;
    }
    const text = fs.readFileSync(skillFile, "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) problems.push(`${name}: SKILL.md has no frontmatter`);
    else {
      const declared = /\nname:\s*([^\n]+)/.exec(`\n${frontmatter[1]}`);
      if (!declared || declared[1].trim() !== name) problems.push(`${name}: frontmatter name mismatch`);
      if (!/\ndescription:\s*\S/.test(`\n${frontmatter[1]}`)) problems.push(`${name}: frontmatter has no description`);
    }
  }
  return problems;
}

function printHuman(summary, json) {
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  for (const line of summary.lines) console.log(line);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  const names = sourceSkills();
  const { root, temporary, project } = resolveTarget(args);
  const lines = [];
  const summary = {
    schema: "dezign0/codex-skills/v1",
    ok: true,
    mode: args.selfTest ? "self-test" : args.check ? "check" : args.dryRun ? "dry-run" : "install",
    scope: args.selfTest ? "temp" : args.scope,
    target: temporary ? root : project || root,
    skillsRoot: root,
    skills: [],
  };

  try {
    if (args.check || args.selfTest) {
      const results = names.map((name) => checkSkill(name, root));
      summary.skills = results;
      const bad = results.filter((result) => result.status !== "ok");
      if (args.selfTest) {
        // The self-test installs first, then verifies the copy plus frontmatter.
        for (const name of names) {
          const result = copySkill(name, root, true, false);
          summary.skills = summary.skills.filter((entry) => entry.name !== name).concat(result);
        }
        const problems = verifySelfTest(root);
        summary.ok = problems.length === 0;
        summary.problems = problems;
        lines.push(`self-test: installed ${names.length} skills into ${root}`);
        if (problems.length) {
          lines.push(`FAIL self-test: ${problems.length} problem(s)`);
          for (const problem of problems) lines.push(`  - ${problem}`);
        } else {
          lines.push("PASS self-test: 13 skills installed with matching hashes and frontmatter");
        }
      } else {
        summary.ok = bad.length === 0;
        lines.push(`Codex skills check: ${results.length - bad.length}/${results.length} ok — ${root}`);
        for (const result of bad) {
          const detail = [result.missing?.length ? `missing ${result.missing.length}` : "", result.modified?.length ? `modified ${result.modified.join(", ")}` : "", result.extra?.length ? `extra ${result.extra.length}` : ""].filter(Boolean).join("; ");
          lines.push(`  - ${result.name}: ${result.status}${detail ? ` (${detail})` : ""}`);
        }
        if (bad.length) lines.push("Fix: rerun with --force to replace the drifted skills.");
      }
    } else {
      const results = names.map((name) => copySkill(name, root, args.force, args.dryRun));
      summary.skills = results;
      const installed = results.filter((result) => result.status === "installed" || result.status === "unchanged").length;
      const skipped = results.filter((result) => result.status === "skipped").length;
      lines.push(`${args.dryRun ? "dry-run: would install" : "installed"} ${installed}/${names.length} skills${skipped ? `, skipped ${skipped} existing` : ""}`);
      lines.push(`skills folder: ${root}`);
      if (!temporary) lines.push(`Codex scans .agents/skills from the working directory up to the repository root; restart Codex to rescan.`);
      for (const result of results) {
        if (result.status === "skipped") lines.push(`  - ${result.name}: exists (use --force to replace)`);
      }
      if (summary.skills.every((result) => result.status === "skipped")) summary.ok = true;
    }
  } finally {
    if (temporary) fs.rmSync(root, { recursive: true, force: true });
  }

  printHuman({ ...summary, lines }, args.json);
  return summary.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`install-codex-skills: ${error.message}`);
    process.exitCode = 2;
  } else {
    console.error(`install-codex-skills: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exitCode = 1;
  }
}
