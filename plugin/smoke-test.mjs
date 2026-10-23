/**
 * Smoke test for the OpenCode plugin without an OpenCode server.
 * Verifies kit copying and skill registration with a mock context.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Dezign0Plugin } from "./index.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dezign0-plugin-"));
try {
  const added = [];
  const ctx = {
    location: { directory: dir },
    skill: {
      transform: async (cb) => cb({ add: (skill) => added.push(skill) }),
    },
  };
  await Dezign0Plugin.setup(ctx);
  assert.equal(added.length, 6, "expected six registered skills");
  assert.ok(fs.existsSync(path.join(dir, ".design-os", "DESIGN-OS.md")), "kit copied");
  for (const skill of added) {
    assert.match(skill.id, /^dezign0-/);
    assert.ok(skill.content.length > 100);
    assert.ok(path.isAbsolute(skill.path));
  }
  console.log(`plugin smoke test: ${added.length} skills, kit at ${path.join(dir, ".design-os")}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
