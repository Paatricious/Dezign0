/**
 * Package consistency check: version, skill count, plugin surface and files.
 * Runs in CI before publish.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const pkg = read("package.json");
const plugin = read(".claude-plugin/plugin.json");
const market = read(".claude-plugin/marketplace.json");
const skills = fs.readdirSync(path.join(root, "design-os", "skills"))
  .filter((name) => fs.existsSync(path.join(root, "design-os", "skills", name, "SKILL.md")));

assert.equal(plugin.version, pkg.version, ".claude-plugin/plugin.json version must match package.json");
assert.equal(market.plugins[0].version, pkg.version, "marketplace plugin version must match package.json");
assert.equal(skills.length, 6, "expected six SKILL.md files");
assert.ok(pkg.files.includes(".claude-plugin/"), "package files must include .claude-plugin/");
assert.ok(pkg.files.includes("server.js"), "package files must include server.js");
for (const file of ["server.js", "plugin/index.js", "design-os/DESIGN-OS.md", "README.md", "SECURITY.md"]) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
}
const source = fs.readFileSync(path.join(root, "plugin", "index.js"), "utf8");
for (const name of ["dezign0_lint", "dezign0_measure", "dezign0_doctor"]) {
  assert.ok(source.includes(name), `plugin is missing ${name}`);
}
const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
assert.equal(pack.status, 0, pack.stderr);
const packed = JSON.parse(pack.stdout)[0].files.map((file) => file.path);
for (const file of [
  "server.js",
  "plugin/index.js",
  "design-os/DESIGN-OS.md",
  "design-os/skills/critique/SKILL.md",
  ".claude-plugin/plugin.json",
  "SECURITY.md",
]) {
  assert.ok(packed.includes(file), `npm pack is missing ${file}`);
}
console.log(`package check: dezign0@${pkg.version}, ${skills.length} skills, 3 tools, ${packed.length} packed files`);
