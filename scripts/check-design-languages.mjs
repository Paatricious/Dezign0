/**
 * Validate the optional design-languages pack and its relationship to OpenDesign.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const pack = path.join(root, "design-languages");
const systemsDir = path.join(pack, "design-systems");
const index = JSON.parse(fs.readFileSync(path.join(pack, "index.json"), "utf8"));

assert.equal(index.count, 152, "expected 152 design languages");
assert.equal(index.items.length, 152, "index item count");
assert.match(index.source.commit, /^[a-f0-9]{40}$/, "pinned source commit");
const dirs = fs.readdirSync(systemsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
assert.equal(dirs.length, 152, "expected 152 package directories");
for (const item of index.items) {
  assert.ok(/^[a-z0-9-]+$/.test(item.slug), `invalid slug ${item.slug}`);
  assert.ok(fs.existsSync(path.join(systemsDir, item.slug, "DESIGN.md")), `${item.slug}: missing DESIGN.md`);
  assert.ok(fs.existsSync(path.join(systemsDir, item.slug, "manifest.json")), `${item.slug}: missing manifest.json`);
}
for (const file of ["LICENSE", "NOTICE", "ATTRIBUTION.md", "OPEN-DESIGN-README.md", "package.json", "licenses/volt-agent-awesome-design-md-LICENSE", "licenses/tw93-kami-LICENSE"]) {
  assert.ok(fs.existsSync(path.join(pack, file)), `pack missing ${file}`);
}
console.log(`design languages check: ${index.count} packages, source ${index.source.commit.slice(0, 7)}`);
