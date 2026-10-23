#!/usr/bin/env node
/**
 * Temp-fixture smoke tests for bin/dezign0.mjs.
 *
 * Runs the real CLI as a child process against a throwaway directory. No
 * network, no dependencies, Node 18+.
 *
 *   node bin/dezign0.test.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLI = path.join(HERE, "dezign0.mjs");
const capabilities = JSON.parse(fs.readFileSync(path.join(ROOT, "capabilities.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dezign0-cli-test-"));
const spaced = path.join(tmp, "a directory with spaces");
fs.mkdirSync(spaced, { recursive: true });

const dirty = path.join(tmp, "dirty.html");
fs.writeFileSync(dirty, `<!doctype html>
<html lang="en"><head><style>.hero{background:linear-gradient(90deg,#6366f1,#8b5cf6)}</style></head>
<body><div class="hero"><h1>Hello</h1></div></body></html>
`);
const clean = path.join(tmp, "clean.html");
fs.writeFileSync(clean, `<!doctype html>
<html lang="en"><head><style>
:root { --color-bg: #ffffff; --color-fg: #111111; --color-accent: #2563eb; }
body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: system-ui, sans-serif; }
</style></head><body><main><h1>Demo</h1><p>A real sentence of product copy.</p></main></body></html>
`);

let passed = 0;
const failures = [];

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || tmp,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { ...result, json };
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

function expectExit(result, code, label) {
  assert.equal(result.status, code, `${label}: expected exit ${code}, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
}

try {
  test("version is the capability manifest version", () => {
    const result = run(["--version"]);
    expectExit(result, 0, "version");
    assert.match(result.stdout, new RegExp(`dezign0 ${capabilities.version.replace(/\./g, "\\.")}`));
  });

  test("help lists every command", () => {
    const result = run(["--help"]);
    expectExit(result, 0, "help");
    for (const command of capabilities.commands.names) {
      assert.ok(result.stdout.includes(command), `help is missing ${command}`);
    }
    const perCommand = run(["lint", "--help"]);
    expectExit(perCommand, 0, "lint --help");
    assert.match(perCommand.stdout, /dezign0 lint/);
  });

  test("unknown command and unknown flag exit 2", () => {
    expectExit(run(["frobnicate"]), 2, "unknown command");
    expectExit(run(["lint", "--nonsense", clean]), 2, "unknown flag");
  });

  test("lint reports findings and exits 1", () => {
    const result = run(["lint", dirty, "--json"]);
    expectExit(result, 1, "lint dirty");
    assert.equal(result.json.command, "lint");
    assert.ok(result.json.counts.P0 > 0);
    assert.equal(result.json.ok, false);
  });

  test("lint clean artifact exits 0 with and without --strict", () => {
    expectExit(run(["lint", clean, "--json"]), 0, "lint clean");
    const strict = run(["lint", clean, "--strict", "--json"]);
    expectExit(strict, 0, "lint clean strict");
    assert.equal(strict.json.counts.P0 + strict.json.counts.P1, 0);
  });

  test("lint --quiet keeps only the summary", () => {
    const result = run(["lint", dirty, "--quiet"]);
    expectExit(result, 1, "lint quiet");
    assert.match(result.stdout, /^lint: /m);
    assert.ok(!result.stdout.includes("purple-gradient"), "quiet must not print findings");
  });

  test("lint missing file exits 2", () => {
    expectExit(run(["lint", path.join(tmp, "nope.html")]), 2, "lint missing");
  });

  test("measure without Playwright exits 2 with a JSON error", () => {
    const result = run(["measure", dirty, "--json"]);
    expectExit(result, 2, "measure no playwright");
    assert.equal(result.json.command, "measure");
    assert.match(String(result.json.error), /Playwright is not installed/);
  });

  test("measure missing file exits 2", () => {
    expectExit(run(["measure", path.join(tmp, "nope.html")]), 2, "measure missing");
  });

  test("audit combines lint and a skipped measurement", () => {
    const dirtyAudit = run(["audit", dirty, "--json"]);
    expectExit(dirtyAudit, 1, "audit dirty");
    assert.ok(dirtyAudit.json.lint.counts.P0 > 0);
    assert.equal(dirtyAudit.json.measure, null);
    assert.ok(dirtyAudit.json.skipped.some((line) => line.includes("Playwright")));
    expectExit(run(["audit", clean, "--json"]), 0, "audit clean");
  });

  test("doctor reports a healthy core in a temp project", () => {
    const result = run(["doctor", "--json"]);
    expectExit(result, 0, "doctor");
    assert.equal(result.json.version, capabilities.version);
    const ids = result.json.checks.map((check) => check.id);
    for (const id of ["node", "version", "skills", "tools", "adapters", "plugin-tools"]) {
      assert.ok(ids.includes(id), `doctor is missing ${id}`);
    }
    assert.equal(result.json.summary.fail, 0);
  });

  test("doctor --strict promotes warnings to exit 1", () => {
    const result = run(["doctor", "--strict", "--json"]);
    assert.equal(result.status, 1);
    assert.ok(result.json.summary.warn > 0);
  });

  test("systems lists the 152-language pack and filters", () => {
    const all = run(["systems", "--json"]);
    expectExit(all, 0, "systems");
    assert.equal(all.json.total, capabilities.designLanguages.count);
    assert.equal(all.json.packVersion, capabilities.designLanguages.version);
    const searched = run(["systems", "--search=figma", "--json"]);
    expectExit(searched, 0, "systems search");
    assert.equal(searched.json.total, 1);
    assert.equal(searched.json.items[0].slug, "figma");
    const limited = run(["systems", "--limit=3", "--json"]);
    expectExit(limited, 0, "systems limit");
    assert.equal(limited.json.returned, 3);
  });

  test("addons lists, filters and reads an addon", () => {
    const all = run(["addons", "--json"]);
    expectExit(all, 0, "addons");
    assert.equal(all.json.count, capabilities.addons.count);
    const review = run(["addons", "--section=review", "--json"]);
    expectExit(review, 0, "addons section");
    assert.equal(review.json.count, 3);
    const figma = run(["addons", "figma-bridge", "--json"]);
    expectExit(figma, 0, "addons get");
    assert.equal(figma.json.item.id, "figma-bridge");
    assert.ok(figma.json.content.length > 200);
    assert.match(figma.json.content, /Figma/);
    expectExit(run(["addons", "not-an-addon", "--json"]), 1, "addons unknown");
  });

  test("new scaffolds a lint-clean project and refuses unsafe targets", () => {
    const created = run(["new", "billing-settings", "--profile=dashboard", "--json"]);
    expectExit(created, 0, "new");
    assert.equal(created.json.created.length, 9);
    const projectDir = created.json.directory;
    for (const name of ["project.json", "artifact.html", "tokens.css", "annotations.json"]) {
      assert.ok(fs.existsSync(path.join(projectDir, name)), `new did not create ${name}`);
    }
    const project = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8"));
    assert.equal(project.profile, "dashboard");
    assert.equal(project.slug, "billing-settings");
    expectExit(run(["lint", path.join(projectDir, "artifact.html"), "--strict", "--json"]), 0, "scaffold lint");

    expectExit(run(["new", "billing-settings", "--json"]), 1, "new exists");
    expectExit(run(["new", "billing-settings", "--force", "--json"]), 0, "new force");
    expectExit(run(["new", "escape-me", "--dir=../outside", "--json"]), 2, "new escape");
    expectExit(run(["new", "demo", "--profile=unknown", "--json"]), 2, "new profile");
    expectExit(run(["new", "Bad Slug", "--json"]), 2, "new slug");
  });

  test("export writes capabilities and a design system", () => {
    const manifest = run(["export", "capabilities"]);
    expectExit(manifest, 0, "export capabilities");
    const exported = JSON.parse(manifest.stdout);
    assert.equal(exported.version, capabilities.version);

    const manifestFile = path.join(tmp, "caps.json");
    expectExit(run(["export", "capabilities", `--out=${manifestFile}`, "--json"]), 0, "export capabilities out");
    assert.equal(JSON.parse(fs.readFileSync(manifestFile, "utf8")).version, capabilities.version);
    expectExit(run(["export", "capabilities", `--out=${manifestFile}`, "--json"]), 1, "export no overwrite");
    expectExit(run(["export", "capabilities", `--out=${manifestFile}`, "--force", "--json"]), 0, "export force");

    const systemDir = path.join(tmp, "system-airbnb");
    const system = run(["export", "system", "airbnb", `--out=${systemDir}`, "--json"]);
    expectExit(system, 0, "export system");
    assert.ok(system.json.files > 5);
    assert.ok(fs.existsSync(path.join(systemDir, "DESIGN.md")));
    expectExit(run(["export", "system", "airbnb", `--out=${systemDir}`, "--json"]), 1, "export system exists");
    expectExit(run(["export", "system", "airbnb", `--out=${systemDir}`, "--force", "--json"]), 0, "export system force");
    expectExit(run(["export", "system", "no-such-system", `--out=${path.join(tmp, "nope")}`, "--json"]), 1, "export system unknown");
    expectExit(run(["export", "system", "../../etc", `--out=${path.join(tmp, "nope")}`, "--json"]), 2, "export traversal");
  });

  test("works from a directory whose path contains spaces", () => {
    const result = run(["systems", "--limit=1", "--json"], { cwd: spaced });
    expectExit(result, 0, "spaced cwd");
    assert.equal(result.json.returned, 1);
  });

  test("capabilities.json is internally consistent", () => {
    assert.equal(capabilities.skills.count, capabilities.skills.names.length);
    assert.equal(capabilities.tools.count, capabilities.tools.names.length);
    assert.equal(capabilities.adapters.count, capabilities.adapters.ids.length);
    assert.equal(capabilities.addons.count, capabilities.addons.ids.length);
    assert.equal(capabilities.commands.count, capabilities.commands.names.length);
    assert.equal(capabilities.compatibility.core, capabilities.version);
    assert.equal(capabilities.compatibility.addonPack.version, capabilities.designLanguages.version);
    assert.equal(capabilities.compatibility.addonPack.name, capabilities.designLanguages.pack);
    const help = run(["--help"]).stdout;
    for (const command of capabilities.commands.names) assert.ok(help.includes(command), `help misses ${command}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCLI smoke: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) {
  const stack = failure.error?.stack || String(failure.error);
  console.log(`\n${failure.name}\n${stack.split("\n").slice(0, 6).join("\n")}`);
}
process.exitCode = failures.length ? 1 : 0;
