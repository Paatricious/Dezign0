/**
 * Skill consistency check: frontmatter, negative triggers and kit-relative
 * file references must resolve after installation.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const skillsDir = path.join(root, "design-os", "skills");
const names = fs.readdirSync(skillsDir).filter((name) =>
  fs.existsSync(path.join(skillsDir, name, "SKILL.md")),
);

assert.equal(names.length, 8, "expected eight skills");
for (const name of names) {
  const file = path.join(skillsDir, name, "SKILL.md");
  const text = fs.readFileSync(file, "utf8");
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(front, `${name}: missing frontmatter`);
  assert.match(front[1], new RegExp(`^name:\\s*${name}$`, "m"), `${name}: frontmatter name mismatch`);
  const description = /^description:\s*(.+)$/m.exec(front[1])?.[1] ?? "";
  assert.ok(description.length >= 60, `${name}: description is too short to trigger reliably`);
  assert.match(description, /\bUse\b/, `${name}: description must say when to use the skill`);
  assert.match(text, /## When not to use/, `${name}: missing negative trigger section`);
  assert.ok(text.includes("Kit root: `.design-os/`"), `${name}: missing kit root line`);

  for (const match of text.matchAll(/`\.design-os\/([^`\s]+)`/g)) {
    const rel = match[1].replace(/<[^>]+>/g, "").replace(/[.,;:]$/, "");
    if (!rel || rel.includes("*") || rel.startsWith("design-memory")) continue;
    assert.ok(fs.existsSync(path.join(root, "design-os", rel)), `${name}: missing kit file ${rel}`);
  }
  const bare = text.match(/`(?:briefs|craft|tools|skills)\/([^`\s]+)`/g) ?? [];
  assert.equal(bare.length, 0, `${name}: bare kit paths must start with .design-os/: ${bare.join(", ")}`);
}
console.log(`skill check: ${names.length} skills, frontmatter, negative triggers, paths`);
