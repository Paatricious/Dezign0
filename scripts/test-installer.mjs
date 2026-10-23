/**
 * Installer regression test. Runs real installs in temp directories with
 * spaces, checks the destructive/negative flag paths and the upgrade path.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const installer = path.join(root, "design-os", "install.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dezign0 installer "));

function run(args) {
  return spawnSync(process.execPath, [installer, ...args], { cwd: root, encoding: "utf8" });
}

try {
  const target = path.join(temp, "my app");

  const dry = run(["--target", target, "--harness=opencode", "--with-agents", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(path.join(target, ".design-os")), false, "dry run must not write");

  const install = run(["--target", target, "--harness=opencode", "--with-agents"]);
  assert.equal(install.status, 0, install.stderr);
  assert.ok(fs.existsSync(path.join(target, ".design-os", "DESIGN-OS.md")), "kit copied");
  assert.equal(
    fs.readdirSync(path.join(target, ".opencode", "skills")).filter((name) =>
      fs.existsSync(path.join(target, ".opencode", "skills", name, "SKILL.md")),
    ).length,
    8,
    "eight skills installed",
  );
  assert.match(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8"), /design-os:start/);
  const meta = JSON.parse(fs.readFileSync(path.join(target, ".design-os", ".dezign0-kit.json"), "utf8"));
  assert.equal(meta.version, JSON.parse(fs.readFileSync(path.join(root, "design-os", "kit.json"), "utf8")).version);
  assert.ok(meta.files && Object.keys(meta.files).length > 40, "installer writes per-file hashes");

  const canary = path.join(target, ".design-os", "canary.txt");
  fs.writeFileSync(canary, "keep");
  const noForce = run(["--target", target, "--harness=opencode", "--force=false"]);
  assert.equal(noForce.status, 0, noForce.stderr);
  assert.equal(fs.readFileSync(canary, "utf8"), "keep", "--force=false must not overwrite");

  const codex = path.join(temp, "codex app");
  const codexRun = run(["--target", codex, "--harness=codex", "--with-agents"]);
  assert.equal(codexRun.status, 0, codexRun.stderr);
  assert.ok(
    fs.existsSync(path.join(codex, ".codex", "skills", "critique", "SKILL.md")),
    "Codex skills must go to .codex/skills",
  );
  assert.ok(fs.existsSync(path.join(codex, "AGENTS.md")), "Codex instruction file");

  const bad = run(["--target", target, "--harness=opencode", "--force=maybe"]);
  assert.equal(bad.status, 2, "invalid boolean must be a usage error");

  const conflict = path.join(temp, "conflict");
  fs.mkdirSync(conflict, { recursive: true });
  fs.writeFileSync(path.join(conflict, ".design-os"), "not a directory");
  const conflictRun = run(["--target", conflict, "--harness=files"]);
  assert.equal(conflictRun.status, 2, "file at .design-os must be a clear error");
  assert.match(conflictRun.stderr, /not a directory/);

  fs.rmSync(path.join(target, ".design-os", "craft", "color.md"));
  const upgrade = run(["--target", target, "--harness=opencode", "--upgrade"]);
  assert.equal(upgrade.status, 0, upgrade.stderr);
  assert.ok(fs.existsSync(path.join(target, ".design-os", "craft", "color.md")), "upgrade restores missing files");
  assert.equal(fs.readFileSync(canary, "utf8"), "keep", "upgrade keeps existing files");

  console.log("installer smoke test: dry-run, install, force=false, conflict, upgrade");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
