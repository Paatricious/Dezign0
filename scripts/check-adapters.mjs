/**
 * Validate the declarative harness adapters.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "design-os", "adapters");
const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
assert.ok(files.length >= 10, `expected at least 10 adapters, found ${files.length}`);

const ids = new Set();
for (const file of files) {
  const adapter = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  assert.ok(adapter.id, `${file}: missing id`);
  assert.ok(!ids.has(adapter.id), `${file}: duplicate id`);
  ids.add(adapter.id);
  assert.equal(file, `${adapter.id}.json`, `${file}: id must match filename`);
  assert.ok(adapter.label, `${adapter.id}: missing label`);
  assert.ok(adapter.instructions?.file, `${adapter.id}: missing instructions.file`);
  assert.ok(adapter.capabilities, `${adapter.id}: missing capabilities`);
  if (adapter.skills) {
    assert.ok(Array.isArray(adapter.skills.project) && adapter.skills.project.length, `${adapter.id}: missing project skill path`);
    assert.ok(Array.isArray(adapter.skills.global) && adapter.skills.global.length, `${adapter.id}: missing global skill path`);
  }
}
for (const required of ["opencode", "claude", "codex", "cursor", "dsh", "aider", "files"]) {
  assert.ok(ids.has(required), `missing required adapter: ${required}`);
}
console.log(`adapter check: ${ids.size} adapters (${[...ids].sort().join(", ")})`);
