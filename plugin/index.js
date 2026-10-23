/**
 * Dezign0 OpenCode plugin.
 *
 * Zero runtime dependencies. OpenCode 2 calls `setup(ctx)` for each location.
 * On setup it:
 *   1. copies the bundled design kit to `<project>/.design-os` (only if missing)
 *   2. registers the six design skills from the kit
 *   3. registers tools for lint, rendered measurement and a doctor check
 *
 * The tools only read files inside the current project. They never write source
 * files and never run a shell.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, "..", "design-os");
if (!fs.existsSync(path.join(KIT, "DESIGN-OS.md"))) {
  throw new Error(`[dezign0] package is incomplete: ${path.join(KIT, "DESIGN-OS.md")} is missing`);
}
const META = ".dezign0-kit.json";
const LEGACY_META = ".dezign0.json";
const SKILLS = [
  "design-brief",
  "frontend-design",
  "redesign",
  "critique",
  "design-system-extract",
  "state-board",
];
const TOOL_NAMES = ["dezign0_lint", "dezign0_measure", "dezign0_doctor"];
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
      if (entry.name === META || entry.name === LEGACY_META || entry.name === "node_modules" || entry.name === ".git") {
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

function writeMeta(dest, source) {
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
          files: hashTree(dest),
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

function ensureKit(projectDir) {
  const dest = path.join(projectDir, ".design-os");
  if (fs.existsSync(dest)) {
    const stat = fs.lstatSync(dest);
    if (stat.isSymbolicLink()) throw new Error(`${dest} is a symlink; refusing to trust it`);
    if (!stat.isDirectory()) throw new Error(`${dest} exists and is not a directory`);
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
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
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
            description: "Comma-separated widths. Default: 1440,1024,768,390,375,360.",
          },
          strict: { type: "boolean", description: "Fail on clipped content, contrast failures or console errors." },
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
      name: "dezign0_doctor",
      description:
        "Check the installed Dezign0 kit: plugin version, kit location/version, six skills, lint/measure scripts, Node and Playwright. Use when the plugin seems installed but skills or checks are missing.",
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
        const playwright = fs.existsSync(path.join(projectDir, "node_modules", "playwright"))
          ? "installed in project"
          : "not found in project node_modules";
        const lines = [
          `dezign0 doctor`,
          `plugin: ${VERSION}`,
          `project: ${projectDir}`,
          `kit: ${kitDir}`,
          `kit version: ${meta?.version || "unknown (legacy install; delete .design-os to refresh)"}${meta?.version && meta.version !== VERSION ? ` (plugin is ${VERSION})` : ""}`,
          `skills: ${found}/${SKILLS.length}`,
          `lint: ${fs.existsSync(path.join(kitDir, "tools", "design-lint.mjs")) ? "ok" : "missing"}`,
          `measure: ${fs.existsSync(path.join(kitDir, "tools", "measure-artifact.mjs")) ? "ok" : "missing"}`,
          `node: ${process.version}`,
          `playwright: ${playwright}`,
          `tools: ${TOOL_NAMES.join(", ")}`,
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
