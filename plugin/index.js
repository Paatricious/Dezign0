/**
 * Dezign0 OpenCode plugin.
 *
 * Zero runtime dependencies. OpenCode 2 calls `setup(ctx)` for each location.
 * On setup it:
 *   1. copies the bundled design kit to `<project>/.design-os` (only if missing)
 *   2. registers the thirteen design skills from the kit
 *   3. registers tools for lint, rendered measurement and a doctor check
 *
 * The tools only read files inside the current project. They never write source
 * files and never run a shell.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Dezign0OpenCodePlugin } from "./opencode-lifecycle.mjs";
export { Dezign0OpenCodePlugin };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, "..", "design-os");
if (!fs.existsSync(path.join(KIT, "DESIGN-OS.md"))) {
  throw new Error(`[dezign0] package is incomplete: ${path.join(KIT, "DESIGN-OS.md")} is missing`);
}
const META = ".dezign0-kit.json";
const LEGACY_META = ".dezign0.json";
const KIT_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(KIT, "kit.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
const SKILLS = [
  "design-brief",
  "frontend-design",
  "redesign",
  "critique",
  "design-system-extract",
  "state-board",
  "figma-context",
  "design-language",
  "template-start",
  "figma-to-code",
  "code-handoff",
  "visual-review",
  "media-brief",
];
const TOOL_NAMES = ["dezign0_lint", "dezign0_measure", "dezign0_doctor", "dezign0_design_systems", "dezign0_addons"];
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(HERE, "..", "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

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

function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function hashTree(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === META || entry.name === LEGACY_META || entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".backup-")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files[path.relative(root, full).split(path.sep).join("/")] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(full))
          .digest("hex");
      }
    }
  };
  walk(root);
  return files;
}

function walkFiles(root, prefix = "") {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === META || entry.name === LEGACY_META || entry.name.startsWith(".backup-")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full, rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result;
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function recoverLegacyKit(dest) {
  // A kit created by an older installer has no hash manifest. Refresh the
  // managed files, but keep every overwritten file in a local backup.
  const stamp = Date.now();
  let changed = 0;
  for (const rel of walkFiles(KIT)) {
    const src = path.join(KIT, rel);
    const dst = path.join(dest, rel);
    let differs = true;
    try {
      differs = hashFile(src) !== hashFile(dst);
    } catch {
      differs = true;
    }
    if (!differs) continue;
    if (fs.existsSync(dst)) {
      const backup = path.join(dest, `.backup-${stamp}`, rel);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(dst, backup);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    changed += 1;
  }
  writeMeta(dest, "recovered");
  if (changed > 0) console.warn(`[dezign0] refreshed a legacy kit (${changed} files; old versions in .backup-${stamp})`);
  return true;
}

function matchesPackage(dest) {
  for (const rel of walkFiles(KIT)) {
    try {
      if (hashFile(path.join(dest, rel)) !== hashFile(path.join(KIT, rel))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function upgradeKit(dest, meta) {
  const oldFiles = meta?.files && typeof meta.files === "object" ? meta.files : {};
  const nextFiles = {};
  let updated = 0;
  let conflict = 0;
  for (const rel of walkFiles(KIT)) {
    const src = path.join(KIT, rel);
    const dst = path.join(dest, rel);
    const srcHash = hashFile(src);
    const oldHash = oldFiles[rel];
    let dstHash = null;
    try {
      dstHash = hashFile(dst);
    } catch {
      // Missing file: copy below.
    }
    if (dstHash === null || (oldHash && dstHash === oldHash)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      nextFiles[rel] = srcHash;
      updated += 1;
    } else if (!oldHash) {
      // A legacy install with no hash: do not overwrite an existing file.
      nextFiles[rel] = dstHash;
      conflict += 1;
    } else {
      // User modified this file; preserve it and keep the old base hash so the
      // next upgrade still treats it as modified.
      nextFiles[rel] = oldHash;
      conflict += 1;
    }
  }
  writeMeta(dest, "upgrade", nextFiles);
  if (process.env.DEZIGN0_DEBUG === "1") {
    console.error(`[dezign0] kit upgraded: ${updated} files, ${conflict} preserved`);
  }
}

function writeMeta(dest, source, files = null) {
  try {
    fs.writeFileSync(
      path.join(dest, META),
      JSON.stringify(
        {
          schema: 1,
          package: "dezign0",
          version: VERSION,
          source,
          installedAt: new Date().toISOString(),
          files: files || hashTree(dest),
        },
        null,
        2,
      ) + "\n",
    );
  } catch {
    // A read-only project must not stop the plugin from loading.
  }
}

function readMeta(kitDir) {
  for (const name of [META, LEGACY_META]) {
    try {
      return { name, data: JSON.parse(fs.readFileSync(path.join(kitDir, name), "utf8")) };
    } catch {
      // Try the next metadata file.
    }
  }
  return { name: null, data: null };
}

function countDrift(kitDir, files) {
  if (!files || typeof files !== "object") return null;
  let changed = 0;
  for (const [rel, expected] of Object.entries(files)) {
    try {
      const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(kitDir, rel))).digest("hex");
      if (actual !== expected) changed += 1;
    } catch {
      changed += 1;
    }
  }
  return changed;
}

function repairMissing(dest) {
  for (const rel of walkFiles(KIT)) {
    const dst = path.join(dest, rel);
    if (fs.existsSync(dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(KIT, rel), dst);
  }
}

function ensureKit(projectDir) {
  const dest = path.join(projectDir, ".design-os");
  if (fs.existsSync(dest)) {
    const stat = fs.lstatSync(dest);
    if (stat.isSymbolicLink()) throw new Error(`${dest} is a symlink; refusing to trust it`);
    if (!stat.isDirectory()) throw new Error(`${dest} exists and is not a directory`);
    const meta = readMeta(dest).data;
    if (!meta) {
      // A legacy installer (or an interrupted copy) produced a kit without
      // metadata. Add missing files, then adopt it only if it is byte-identical.
      recoverLegacyKit(dest);
    } else if (meta.version !== KIT_VERSION) {
      try {
        upgradeKit(dest, meta);
      } catch (error) {
        console.warn(`[dezign0] kit upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (meta?.version === KIT_VERSION) {
      repairMissing(dest);
    }
    return dest;
  }
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fs.cpSync(KIT, tmp, { recursive: true });
    writeMeta(tmp, "project");
    fs.renameSync(tmp, dest);
  } catch (error) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; the original error is more useful.
    }
    throw error;
  }
  return dest;
}

function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

function resolveArtifact(projectDir, value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("path is required");
  let root;
  try {
    root = fs.realpathSync(projectDir);
  } catch {
    root = path.resolve(projectDir);
  }
  const candidate = path.resolve(root, value);
  if (!isInside(root, candidate)) throw new Error("path must be inside the current project");
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    throw new Error(`artifact not found: ${value}`);
  }
  if (!isInside(root, real)) throw new Error("path resolves outside the current project");
  if (!fs.statSync(real).isFile()) throw new Error(`not a file: ${value}`);
  return real;
}

function runNode(script, args, cwd) {
  return new Promise((resolve) => {
    execFile(
      process.env.DEZIGN0_NODE || "node",
      [script, ...args],
      {
        cwd,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", DEZIGN0_PROJECT_DIR: cwd },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          killed: Boolean(error && error.killed),
          stdout: stdout || "",
          stderr: stderr || "",
          spawnError: error && error.code === "ENOENT" ? error : null,
        });
      },
    );
  });
}

function clip(text, limit = 12000) {
  const value = String(text || "").trim();
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated]` : value;
}

function result(text, metadata = {}) {
  return { content: [{ type: "text", text: clip(text) }], metadata };
}

function failure(message) {
  return result(`ERROR: ${message}`, { ok: false });
}

function commandOutput(command, run) {
  const parts = [`$ ${command}`, `exit ${run.code}`];
  if (run.stdout) parts.push("", run.stdout);
  if (run.stderr) parts.push("", run.stderr);
  return parts.join("\n");
}

function findDesignLanguages(projectDir) {
  const candidates = [
    process.env.DEZIGN0_DESIGN_LANGUAGES,
    path.join(projectDir, "design-systems"),
    path.join(projectDir, "node_modules", "dezign0-design-languages", "design-systems"),
    path.resolve(KIT, "..", "design-languages", "design-systems"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const root = fs.realpathSync(candidate);
      if (fs.statSync(root).isDirectory()) {
        if (fs.existsSync(path.join(root, "..", "index.json"))) return root;
        const hasSystem = fs.readdirSync(root).some((name) => fs.existsSync(path.join(root, name, "DESIGN.md")));
        if (hasSystem) return root;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function readDesignCatalog(root) {
  const indexPath = path.join(root, "..", "index.json");
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (Array.isArray(index.items)) return index.items;
  } catch {
    // Fall back to scanning packages.
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "DESIGN.md")))
    .map((entry) => {
      let manifest = {};
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, "manifest.json"), "utf8"));
      } catch {
        // Legacy package without a manifest.
      }
      return {
        slug: entry.name,
        name: manifest.name || entry.name,
        category: manifest.category || "Uncategorized",
        description: manifest.description || "",
        tokens: fs.existsSync(path.join(root, entry.name, "tokens.css")) ? "tokens.css" : null,
        components: fs.existsSync(path.join(root, entry.name, "components.html")) ? "components.html" : null,
        usage: fs.existsSync(path.join(root, entry.name, "USAGE.md")) ? "USAGE.md" : null,
        source: manifest.source || null,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function formatDesignLanguages(root, items) {const lines = [`design languages: ${items.length}`, `root: ${root}`, ""];for (const item of items.slice(0, 40)) lines.push(`${item.slug} — ${item.name} [${item.category}]`);if (items.length > 40) lines.push(`... ${items.length - 40} more; use action=search with a query`);return lines.join("\n");}function findAddonPack(projectDir) {
  const candidates = [
    process.env.DEZIGN0_ADDONS,
    projectDir,
    path.join(projectDir, "node_modules", "dezign0-design-languages"),
    path.resolve(KIT, "..", "design-languages"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const root = fs.realpathSync(candidate);
      if (fs.existsSync(path.join(root, "addons", "index.json"))) return root;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function readAddonIndex(root) {
  const index = JSON.parse(fs.readFileSync(path.join(root, "addons", "index.json"), "utf8"));
  return Array.isArray(index.items) ? index.items : [];
}

function formatAddons(root, items) {
  const lines = [`addons: ${items.length}`, `root: ${root}`, ""];
  let section = "";
  for (const item of items) {
    if (item.section !== section) {
      section = item.section;
      lines.push(`[${section}]`);
    }
    lines.push(`${item.id} — ${item.title}: ${item.path}`);
  }
  return lines.join("\n");
}

function makeTools(projectDir, kitDir, scriptKit) {
  return [
    {
      name: "dezign0_lint",
      description:
        "Run Dezign0's static design linter on an HTML artifact in the current project. Use before a critique or handover to catch P0/P1 craft failures. Returns findings with file:line and fix text.",
      input: {
        type: "object",
        properties: {
          path: { type: "string", description: "Artifact path, relative to the current project." },
          strict: { type: "boolean", description: "Treat P1 findings as failures too." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      async execute(input) {
        try {
          const file = resolveArtifact(projectDir, input.path);
          const script = path.join(scriptKit, "tools", "design-lint.mjs");
          if (!fs.existsSync(script)) return failure("design-lint.mjs is missing from the installed kit");
          const args = input.strict ? ["--strict", file] : [file];
          const run = await runNode(script, args, projectDir);
          if (run.spawnError) return failure("Node.js was not found. Install Node 18+ to use the linter.");
          return result(commandOutput(`design-lint ${input.strict ? "--strict " : ""}${path.relative(projectDir, file)}`, run), {
            ok: run.code === 0,
            exitCode: run.code,
            file,
          });
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      name: "dezign0_measure",
      description:
        "Render an HTML artifact in Chromium and report clipped content, rendered contrast, type sizes, focusable controls and console errors. Requires Playwright in the project; returns a clear message if it is missing.",
      input: {
        type: "object",
        properties: {
          path: { type: "string", description: "Artifact path, relative to the current project." },
          viewports: {
            type: "string",
            description: "Comma-separated WIDTH or WIDTHxHEIGHT values. Default: 1440x900,1024x900,768x900,390x844,375x812,360x800. Use 145x188 for an exact cell.",
          },
          selector: { type: "string", description: "Optional CSS selector; captures and reports the element box." },
          a11y: { type: "boolean", description: "Run accessibility checks and fail under --strict." },
          baseline: { type: "string", description: "Optional directory of artifact-<size>.png baselines for pixel diff." },
          maxDiff: { type: "number", description: "Allowed changed-pixel ratio with a baseline (default 0.001)." },
          strict: { type: "boolean", description: "Fail on clipped content, contrast failures, console errors or a11y findings." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      async execute(input) {
        try {
          const file = resolveArtifact(projectDir, input.path);
          const script = path.join(scriptKit, "tools", "measure-artifact.mjs");
          if (!fs.existsSync(script)) return failure("measure-artifact.mjs is missing from the installed kit");
          const args = [file];
          if (input.viewports) args.push(`--viewports=${input.viewports}`);
          if (input.selector) args.push(`--selector=${input.selector}`);
          if (input.a11y) args.push("--a11y");
          if (input.baseline) args.push(`--baseline=${input.baseline}`);
          if (typeof input.maxDiff === "number") args.push(`--max-diff=${input.maxDiff}`);
          if (input.strict) args.push("--strict");
          const run = await runNode(script, args, projectDir);
          if (run.spawnError) return failure("Node.js was not found. Install Node 18+ to use measurement.");
          const text = commandOutput(`measure-artifact ${path.relative(projectDir, file)}`, run);
          const missingPlaywright = /Cannot find package 'playwright'|ERR_MODULE_NOT_FOUND/.test(text);
          return result(
            missingPlaywright
              ? `${text}\n\nPlaywright is not installed in this project. Run: npm i -D playwright && npx playwright install chromium`
              : text,
            { ok: run.code === 0, exitCode: run.code, file },
          );
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      name: "dezign0_addons",
      description:
        "Browse the optional Dezign0 addon pack: starter templates, Figma bridge docs, React/Next/Vue handoff contracts, review playbooks and media prompt/storyboard packs. Actions: list, search, get.",
      input: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "search", "get"] },
          query: { type: "string", description: "Search text for action=search." },
          section: { type: "string", description: "Optional section filter: templates, figma, handoff, review, media." },
          id: { type: "string", description: "Item id for action=get." },
        },
        required: ["action"],
        additionalProperties: false,
      },
      async execute(input) {
        const root = findAddonPack(projectDir);
        if (!root) {
          return result(
            "No addon pack found. Install `dezign0-design-languages` 0.2+ in the project, or use the sibling design-languages folder in a source checkout.",
          );
        }
        const all = readAddonIndex(root);
        const section = typeof input.section === "string" ? input.section : "";
        const filtered = section ? all.filter((item) => item.section === section) : all;
        if (input.action === "list") return result(formatAddons(root, filtered), { count: filtered.length, root });
        if (input.action === "search") {
          const query = String(input.query || "").toLowerCase().trim();
          if (!query) return failure("query is required for action=search");
          const matches = filtered.filter((item) =>
            [item.id, item.title, item.section, item.description, item.path].join(" ").toLowerCase().includes(query),
          );
          return result(formatAddons(root, matches), { count: matches.length, query });
        }
        if (input.action === "get") {
          const item = all.find((entry) => entry.id === input.id);
          if (!item) return failure(`unknown addon: ${input.id}`);
          const file = path.join(root, item.path);
          if (!isInside(root, file) || !fs.existsSync(file)) return failure(`addon file missing: ${item.path}`);
          return result(`addon: ${item.title} (${item.id})
section: ${item.section}
path: ${file}

${fs.readFileSync(file, "utf8")}`, {
            id: item.id,
            section: item.section,
            file,
          });
        }
        return failure(`unknown action: ${input.action}`);
      },
    },
    {
      name: "dezign0_design_systems",
      description:
        "Browse the optional Dezign0 design-language pack (152 the upstream catalog design systems). Actions: list, search (query), get (slug). Returns catalog metadata or the selected DESIGN.md and tokens.css. Use before building when the user wants a known visual language.",
      input: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "search", "get"] },
          query: { type: "string", description: "Search text for action=search." },
          slug: { type: "string", description: "Package slug for action=get." },
        },
        required: ["action"],
        additionalProperties: false,
      },
      async execute(input) {
        const root = findDesignLanguages(projectDir);
        if (!root) {
          return result(
            "No design-language pack found. Install `dezign0-design-languages` in the project, copy a `design-systems/` folder into the project, or set DEZIGN0_DESIGN_LANGUAGES.",
          );
        }
        const items = readDesignCatalog(root);
        if (input.action === "list") return result(formatDesignLanguages(root, items), { count: items.length });
        if (input.action === "search") {
          const query = String(input.query || "").toLowerCase().trim();
          if (!query) return failure("query is required for action=search");
          const matches = items.filter((item) =>
            [item.slug, item.name, item.category, item.description].join(" ").toLowerCase().includes(query),
          );
          return result(formatDesignLanguages(root, matches), { count: matches.length, query });
        }
        if (input.action === "get") {
          const slug = String(input.slug || "");
          if (!/^[a-z0-9-]+$/.test(slug)) return failure("slug must be lowercase letters, numbers or hyphens");
          const dir = path.join(root, slug);
          if (!isInside(root, dir) || !fs.existsSync(path.join(dir, "DESIGN.md"))) {
            return failure(`unknown design language: ${slug}`);
          }
          const manifest = (() => {
            try {
              return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
            } catch {
              return {};
            }
          })();
          const design = fs.readFileSync(path.join(dir, "DESIGN.md"), "utf8");
          const tokensPath = path.join(dir, "tokens.css");
          const tokens = fs.existsSync(tokensPath) ? fs.readFileSync(tokensPath, "utf8") : "";
          const designFile = path.join(dir, "DESIGN.md");
          const packageFiles = [
            "DESIGN.md", "tokens.css", "USAGE.md", "components.html",
            "components.manifest.json", "design-tokens.json", "tailwind-v4.css",
          ].filter((name) => fs.existsSync(path.join(dir, name)));
          const header = [
            `design language: ${manifest.name || slug} (${slug})`,
            `category: ${manifest.category || "Uncategorized"}`,
            `root: ${dir}`,
            `files: ${packageFiles.join(", ")}`,
            `preview: ${fs.existsSync(path.join(dir, "preview")) ? path.join(dir, "preview") : "none"}`,
            `source: ${fs.existsSync(path.join(dir, "source")) ? path.join(dir, "source") : "none"}`,
            `design: ${designFile}`,
            `tokens: ${fs.existsSync(tokensPath) ? tokensPath : "none"}`,
            "",
            "=== DESIGN.md (truncated; read the file for the full text) ===",
          ].join("\n");
          const designPart = design.slice(0, 7000);
          const tokenPart = tokens ? tokens.slice(0, 3500) : "";
          return result(
            `${header}\n${designPart}${design.length > designPart.length ? "\n...[DESIGN.md truncated]" : ""}\n\n=== tokens.css${tokens ? " (truncated; read the file for all tokens)" : " (missing)"} ===\n${tokenPart}${tokens.length > tokenPart.length ? "\n...[tokens.css truncated]" : ""}`,
            { slug, category: manifest.category || null, designFile, tokensFile: fs.existsSync(tokensPath) ? tokensPath : null, files: packageFiles },
          );
        }
        return failure(`unknown action: ${input.action}`);
      },
    },
    {
      name: "dezign0_doctor",
      description:
        "Check the installed Dezign0 kit: plugin version, kit location/version, thirteen skills, lint/measure scripts, Node and Playwright. Use when the plugin seems installed but skills or checks are missing.",
      input: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const metaFile = path.join(kitDir, META);
        let meta = null;
        try {
          meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        } catch {
          // Meta is optional.
        }
        const skillFiles = SKILLS.map((id) => path.join(kitDir, "skills", id, "SKILL.md"));
        const found = skillFiles.filter((file) => fs.existsSync(file)).length;
        let playwright = "not found in project";
        try {
          createRequire(path.join(projectDir, "__dezign0_resolve__.js")).resolve("playwright");
          playwright = "installed in project";
        } catch {
          // Keep the clear not-found message.
        }
        const drift = meta ? countDrift(kitDir, meta.files) : null;
        const projectLint = fs.existsSync(path.join(kitDir, "tools", "design-lint.mjs"));
        const projectMeasure = fs.existsSync(path.join(kitDir, "tools", "measure-artifact.mjs"));
        const designRoot = findDesignLanguages(projectDir);
        const designCount = designRoot ? readDesignCatalog(designRoot).length : 0;
        const addonRoot = findAddonPack(projectDir);
        const addonCount = addonRoot ? readAddonIndex(addonRoot).length : 0;
        const lines = [
          `dezign0 doctor`,
          `plugin: ${VERSION}`,
          `project: ${projectDir}`,
          `kit: ${kitDir}`,
          `kit version: ${meta?.version || "unknown (legacy install; delete .design-os to refresh)"}${meta?.version && meta.version !== KIT_VERSION ? ` (plugin is ${KIT_VERSION})` : ""}`,
          `skills: ${found}/${SKILLS.length}`,
          `kit drift: ${drift === null ? "unknown (no hash metadata)" : drift === 0 ? "none" : `${drift} modified/missing file(s)`}`,
          `project lint/measure: ${projectLint ? "ok" : "missing"}/${projectMeasure ? "ok" : "missing"}`,
          `package scripts: lint/measure from ${KIT_VERSION}`,
          `design languages: ${designRoot ? `${designCount} (${designRoot})` : "none (optional pack not installed)"}`,
          `addons: ${addonRoot ? `${addonCount} (${addonRoot})` : "none (optional pack not installed)"}`,
          `node: ${process.version}`,
          `playwright: ${playwright}`,
          `tools: ${TOOL_NAMES.join(", ")} (scripts from package ${KIT_VERSION})`,
        ];
        if (found < SKILLS.length) lines.push("", "Fix: delete .design-os and reload the plugin to recopy the kit.");
        if (meta?.version && meta.version !== VERSION) {
          lines.push("", `Kit was installed by ${meta.version}; package is ${VERSION}. Delete .design-os to refresh.`);
        }
        return result(lines.join("\n"), { ok: found === SKILLS.length });
      },
    },
  ];
}

export const Dezign0Plugin = {
  id: "dezign0",
  async setup(ctx) {
    if (!ctx?.location?.directory) {
      console.warn("[dezign0] no project location; kit copy and tools are disabled");
      return;
    }
    const projectDir = path.resolve(ctx.location.directory);
    const options = ctx.options && typeof ctx.options === "object" ? ctx.options : {};
    let kitDir = KIT;
    if (options.copyKit === false) {
      if (process.env.DEZIGN0_DEBUG === "1") console.error("[dezign0] copyKit=false; using the package kit");
    } else try {
      kitDir = ensureKit(projectDir);
    } catch (error) {
      // Keep the skills available from the package, but make the failure visible.
      kitDir = KIT;
      console.warn(`[dezign0] kit copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (process.env.DEZIGN0_DEBUG === "1") {
      console.error(`[dezign0] setup kit=${kitDir} skillTransform=${typeof ctx?.skill?.transform} toolTransform=${typeof ctx?.tool?.transform}`);
    }

    if (typeof ctx?.skill?.transform === "function") {
      await ctx.skill.transform((editor) => {
        for (const id of SKILLS) {
          // Always read packaged content. A project copy is untrusted input and
          // must not be able to inject instructions into the agent context.
          const file = path.join(KIT, "skills", id, "SKILL.md");
          if (!fs.existsSync(file)) continue;
          const raw = fs.readFileSync(file, "utf8");
          const meta = readFrontmatter(raw);
          editor.add({
            id: `dezign0-${id}`,
            name: `dezign0-${id}`,
            description:
              meta.description ||
              "Dezign0 design workflow skill. Use for UI, page, component and visual design work.",
            path: file,
            content: stripFrontmatter(raw),
            autoinvoke: true,
          });
        }
      });
    } else {
      console.warn("[dezign0] skill domain is unavailable; no skills registered");
    }

    if (options.tools !== false && typeof ctx?.tool?.transform === "function") {
      // Tool scripts come from the immutable package, not the project copy.
      const tools = makeTools(projectDir, kitDir, KIT);
      await ctx.tool.transform((editor) => {
        for (const tool of tools) editor.add(tool);
      });
    } else if (options.tools !== false && process.env.DEZIGN0_DEBUG === "1") {
      console.error("[dezign0] tool domain is unavailable; tools were not registered");
    }

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
