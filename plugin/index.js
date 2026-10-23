/**
 * Dezign0 OpenCode plugin.
 *
 * Zero runtime dependencies. OpenCode 2 calls `setup(ctx)` for each location.
 * On setup it:
 *   1. copies the bundled design kit to `<project>/.design-os` (only if missing)
 *   2. registers the six design skills from the kit
 *
 * It does not register tools, modify source files, or run commands on its own.
 * The skills tell the agent when to read DESIGN-OS.md, brief, critique, etc.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, "..", "design-os");
const SKILLS = [
  "design-brief",
  "frontend-design",
  "redesign",
  "critique",
  "design-system-extract",
  "state-board",
];

function readFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return data;
}

function ensureKit(projectDir) {
  const dest = path.join(projectDir, ".design-os");
  if (!fs.existsSync(path.join(dest, "DESIGN-OS.md"))) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(KIT, dest, { recursive: true });
  }
  return dest;
}

export const Dezign0Plugin = {
  id: "dezign0",
  async setup(ctx) {
    const projectDir = ctx?.location?.directory || process.cwd();
    let kitDir;
    try {
      kitDir = ensureKit(projectDir);
    } catch {
      // A read-only project should still load the plugin, using the package copy.
      kitDir = KIT;
    }
    if (process.env.DEZIGN0_DEBUG === "1") {
      console.error(`[dezign0] setup kit=${kitDir} skillTransform=${typeof ctx?.skill?.transform}`);
    }
    if (typeof ctx?.skill?.transform !== "function") return;

    await ctx.skill.transform((editor) => {
      for (const id of SKILLS) {
        const local = path.join(kitDir, "skills", id, "SKILL.md");
        const packaged = path.join(KIT, "skills", id, "SKILL.md");
        const file = fs.existsSync(local) ? local : packaged;
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, "utf8");
        const meta = readFrontmatter(content);
        editor.add({
          id: `dezign0-${id}`,
          name: `dezign0-${id}`,
          description:
            meta.description ||
            "Dezign0 design workflow skill. Use for UI, page, component and visual design work.",
          path: file,
          content,
          autoinvoke: true,
        });
      }
    });
    if (process.env.DEZIGN0_DEBUG === "1") {
      try {
        const list = await ctx.skill.list();
        console.error(`[dezign0] registered=${SKILLS.length} visible=${list?.data?.length ?? "?"}`);
      } catch (error) {
        console.error(`[dezign0] skill list failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  },
};

export default Dezign0Plugin;
