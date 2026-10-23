#!/usr/bin/env node
/**
 * Dezign0 MCP server (stdio, JSON-RPC 2.0, newline-delimited).
 *
 * Exposes the Dezign0 design checks over the Model Context Protocol so any
 * MCP-capable client gets the same tools as the native OpenCode plugin:
 *
 *   dezign0_lint            static craft lint on an HTML artifact
 *   dezign0_measure         rendered measurement (optional Playwright)
 *   dezign0_doctor          installation/health report
 *   dezign0_design_systems  browse the optional design-language pack
 *   dezign0_addons          browse the optional addon pack
 *   dezign0_content_lint    AI-tell/copy lint (when the script ships)
 *   dezign0_token_export    token export (when the script ships)
 *
 * Guarantees:
 *   - no shell: child processes are spawned with execFile and an argv array
 *   - no network: this file imports no network module and calls no fetch
 *   - no writes outside the project: every path argument is resolved and
 *     checked to stay inside the project directory
 *   - stdout carries only JSON-RPC; diagnostics go to stderr when
 *     DEZIGN0_MCP_DEBUG=1
 *
 * Usage:
 *   node mcp/server.mjs [--project <dir>]
 *   DEZIGN0_PROJECT=<dir> node mcp/server.mjs
 *
 * No dependencies. Node 18+.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const KIT = path.join(ROOT, "design-os");
const DEBUG = process.env.DEZIGN0_MCP_DEBUG === "1";
const SERVER_NAME = "dezign0";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];
const TOOL_NAMES = [
  "dezign0_lint",
  "dezign0_measure",
  "dezign0_doctor",
  "dezign0_design_systems",
  "dezign0_addons",
  "dezign0_content_lint",
  "dezign0_token_export",
];
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

function debug(...parts) {
  if (DEBUG) process.stderr.write(`[dezign0-mcp] ${parts.join(" ")}\n`);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const VERSION = readJson(path.join(ROOT, "package.json"), {})?.version || "0.0.0";
const KIT_VERSION = readJson(path.join(KIT, "kit.json"), {})?.version || "0.0.0";

function parseProjectArg(argv) {
  const flagIndex = argv.findIndex((arg) => arg === "--project");
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  const inline = argv.find((arg) => arg.startsWith("--project="));
  if (inline) return inline.slice("--project=".length);
  return null;
}

function resolveProject() {
  const requested = parseProjectArg(process.argv.slice(2)) || process.env.DEZIGN0_PROJECT || process.cwd();
  try {
    const root = fs.realpathSync(requested);
    if (!fs.statSync(root).isDirectory()) throw new Error("not a directory");
    return root;
  } catch (error) {
    process.stderr.write(
      `[dezign0-mcp] cannot use project directory ${JSON.stringify(requested)}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exit(2);
  }
}

const PROJECT = resolveProject();

// ── filesystem safety ───────────────────────────────────────────────────────

function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Resolve a project-relative path and refuse escapes (including symlinks). */
function resolveInside(root, value, label = "path") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError(`${label} is required`);
  }
  if (value.includes("\0")) throw new ToolError(`${label} contains a null byte`);
  if (path.isAbsolute(value)) throw new ToolError(`${label} must be relative to the project: ${value}`);
  const candidate = path.resolve(root, value);
  if (!isInside(root, candidate)) throw new ToolError(`${label} resolves outside the project: ${value}`);
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    throw new ToolError(`${label} does not exist in the project: ${value}`);
  }
  if (!isInside(root, real)) throw new ToolError(`${label} escapes the project through a symlink: ${value}`);
  return real;
}

function resolveArtifact(value) {
  const file = resolveInside(PROJECT, value, "artifact path");
  if (!fs.statSync(file).isFile()) throw new ToolError(`artifact path is not a file: ${value}`);
  return file;
}

class ToolError extends Error {}

// ── child processes (no shell) ──────────────────────────────────────────────

function runNode(script, args, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.env.DEZIGN0_NODE || "node",
      [script, ...args],
      {
        cwd: PROJECT,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", DEZIGN0_MCP_CHILD: "1" },
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

function commandOutput(command, run) {
  const parts = [`$ ${command}`, `exit ${run.code}`];
  if (run.stdout) parts.push("", run.stdout);
  if (run.stderr) parts.push("", run.stderr);
  return parts.join("\n");
}

function clip(text, limit = 12000) {
  const value = String(text || "").trim();
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated]` : value;
}

// ── optional pack discovery (same order as plugin/index.js) ─────────────────

function findDesignLanguages() {
  const candidates = [
    process.env.DEZIGN0_DESIGN_LANGUAGES,
    path.join(PROJECT, "design-systems"),
    path.join(PROJECT, "node_modules", "dezign0-design-languages", "design-systems"),
    path.resolve(KIT, "..", "design-languages", "design-systems"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const root = fs.realpathSync(candidate);
      if (!fs.statSync(root).isDirectory()) continue;
      if (fs.existsSync(path.join(root, "..", "index.json"))) return root;
      if (fs.readdirSync(root).some((name) => fs.existsSync(path.join(root, name, "DESIGN.md")))) return root;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function readDesignCatalog(root) {
  const index = readJson(path.join(root, "..", "index.json"));
  if (index && Array.isArray(index.items)) return index.items;
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "DESIGN.md")))
    .map((entry) => {
      const manifest = readJson(path.join(root, entry.name, "manifest.json"), {});
      return {
        slug: entry.name,
        name: manifest.name || entry.name,
        category: manifest.category || "Uncategorized",
        description: manifest.description || "",
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function formatDesignLanguages(root, items) {
  const lines = [`design languages: ${items.length}`, `root: ${root}`, ""];
  for (const item of items.slice(0, 40)) lines.push(`${item.slug} — ${item.name} [${item.category}]`);
  if (items.length > 40) lines.push(`... ${items.length - 40} more; use action=search with a query`);
  return lines.join("\n");
}

function findAddonPack() {
  const candidates = [
    process.env.DEZIGN0_ADDONS,
    PROJECT,
    path.join(PROJECT, "node_modules", "dezign0-design-languages"),
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
  const index = readJson(path.join(root, "addons", "index.json"), {});
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

function playwrightStatus() {
  try {
    createRequire(path.join(PROJECT, "__dezign0_resolve__.js")).resolve("playwright");
    return "installed in project";
  } catch {
    return "not found in project";
  }
}

// ── tools ───────────────────────────────────────────────────────────────────

function textResult(text, isError = false) {
  return { content: [{ type: "text", text: clip(text) }], ...(isError ? { isError: true } : {}) };
}

function unavailable(name, script) {
  return textResult(
    `${name} is not available in this build: ${path.relative(ROOT, path.join(KIT, "tools", script))} is missing.\n` +
      `It ships with a later core release; the other tools keep working.`,
    true,
  );
}

const TOOLS = [
  {
    name: "dezign0_lint",
    title: "Dezign0 static design lint",
    description:
      "Run Dezign0's static design linter on an HTML artifact in the current project. Use before a critique or handover to catch P0/P1 craft failures. Returns findings with file:line and fix text.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Artifact path, relative to the current project." },
        strict: { type: "boolean", description: "Treat P1 findings as failures too." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(input) {
      const file = resolveArtifact(input.path);
      const script = path.join(KIT, "tools", "design-lint.mjs");
      if (!fs.existsSync(script)) return unavailable("dezign0_lint", "design-lint.mjs");
      const args = input.strict ? ["--strict", file] : [file];
      const run = await runNode(script, args);
      if (run.spawnError) return textResult("ERROR: Node.js was not found. Install Node 18+ to use the linter.", true);
      return textResult(commandOutput(`design-lint ${input.strict ? "--strict " : ""}${path.relative(PROJECT, file)}`, run));
    },
  },
  {
    name: "dezign0_measure",
    title: "Dezign0 rendered measurement",
    description:
      "Render an HTML artifact in Chromium and report clipped content, rendered contrast, type sizes, focusable controls, console errors and optional accessibility findings. Requires Playwright in the project; returns a clear message if it is missing.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Artifact path, relative to the current project." },
        viewports: {
          type: "string",
          description: "Comma-separated WIDTH or WIDTHxHEIGHT values. Default: 1440x900,1024x900,768x900,390x844,375x812,360x800. Use 145x188 for an exact cell.",
        },
        selector: { type: "string", description: "Optional CSS selector; captures and reports the element box." },
        a11y: { type: "boolean", description: "Run accessibility checks; findings fail --strict." },
        axe: { type: "boolean", description: "Also run axe-core (requires axe-core in the project)." },
        reflow: { type: "boolean", description: "Check 320 CSS px reflow." },
        forcedColors: { type: "boolean", description: "Emulate forced-colors mode." },
        runtime: { type: "boolean", description: "Report failed requests, external origins and LCP." },
        baseline: { type: "string", description: "Optional project-relative directory of artifact-<size>.png baselines for pixel diff." },
        maxDiff: { type: "number", description: "Allowed changed-pixel ratio with a baseline (default 0.001)." },
        strict: { type: "boolean", description: "Fail on clipped content, contrast failures, console errors, a11y findings or a baseline diff." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(input) {
      const file = resolveArtifact(input.path);
      const script = path.join(KIT, "tools", "measure-artifact.mjs");
      if (!fs.existsSync(script)) return unavailable("dezign0_measure", "measure-artifact.mjs");
      const args = [file];
      if (input.viewports !== undefined) {
        if (typeof input.viewports !== "string" || !/^[0-9x,]+$/.test(input.viewports)) {
          throw new ToolError("viewports may contain only digits, x and commas");
        }
        args.push(`--viewports=${input.viewports}`);
      }
      if (input.selector !== undefined) {
        if (typeof input.selector !== "string" || input.selector.length > 300) throw new ToolError("selector is invalid");
        args.push(`--selector=${input.selector}`);
      }
      if (input.a11y === true) args.push("--a11y");
      if (input.axe === true) args.push("--axe");
      if (input.reflow === true) args.push("--reflow");
      if (input.forcedColors === true) args.push("--forced-colors");
      if (input.runtime === true) args.push("--runtime");
      if (input.baseline !== undefined) {
        if (typeof input.baseline !== "string") throw new ToolError("baseline must be a project-relative path");
        const baseline = resolveInside(PROJECT, input.baseline, "baseline directory");
        if (!fs.statSync(baseline).isDirectory()) throw new ToolError("baseline must be a directory");
        args.push(`--baseline=${baseline}`);
      }
      if (typeof input.maxDiff === "number") {
        if (!Number.isFinite(input.maxDiff) || input.maxDiff < 0 || input.maxDiff > 1) {
          throw new ToolError("maxDiff must be between 0 and 1");
        }
        args.push(`--max-diff=${input.maxDiff}`);
      }
      if (input.strict === true) args.push("--strict");
      const run = await runNode(script, args, { timeout: 180000 });
      if (run.spawnError) return textResult("ERROR: Node.js was not found. Install Node 18+ to use measurement.", true);
      let text = commandOutput(`measure-artifact ${path.relative(PROJECT, file)}`, run);
      if (/Cannot find package 'playwright'|ERR_MODULE_NOT_FOUND/.test(text)) {
        text += "\n\nPlaywright is not installed in this project. Run: npm i -D playwright && npx playwright install chromium";
      }
      return textResult(text);
    },
  },
  {
    name: "dezign0_doctor",
    title: "Dezign0 doctor",
    description:
      "Check the Dezign0 installation: server/kit versions, thirteen skills, the seven MCP tools, agent-plugin manifest, optional design-language and addon packs, Node and Playwright. Use when the tools seem installed but checks or packs are missing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler() {
      const kitOk = fs.existsSync(path.join(KIT, "DESIGN-OS.md"));
      const foundSkills = SKILLS.filter((id) => fs.existsSync(path.join(KIT, "skills", id, "SKILL.md"))).length;
      const lintOk = fs.existsSync(path.join(KIT, "tools", "design-lint.mjs"));
      const measureOk = fs.existsSync(path.join(KIT, "tools", "measure-artifact.mjs"));
      const contentOk = fs.existsSync(path.join(KIT, "tools", "content-lint.mjs"));
      const tokenOk = fs.existsSync(path.join(KIT, "tools", "token-export.mjs"));
      const designRoot = findDesignLanguages();
      const addonRoot = findAddonPack();
      const agentManifest = readJson(path.join(ROOT, "agent-plugin", "plugin.json"));
      const agentSkills = fs.existsSync(path.join(ROOT, "agent-plugin", "skills"))
        ? fs.readdirSync(path.join(ROOT, "agent-plugin", "skills"), { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, "agent-plugin", "skills", entry.name, "SKILL.md")))
            .length
        : 0;
      const lines = [
        "dezign0 mcp doctor",
        `server: ${VERSION}`,
        `protocol: ${negotiated}`,
        `project: ${PROJECT}`,
        `package: ${ROOT}`,
        `kit: ${kitOk ? `${KIT} (kit ${KIT_VERSION})` : `missing at ${KIT}`}`,
        `skills: ${foundSkills}/${SKILLS.length}`,
        `tools: ${TOOL_NAMES.length} (${TOOL_NAMES.join(", ")})`,
        `tool scripts: lint ${lintOk ? "ok" : "missing"}, measure ${measureOk ? "ok" : "missing"}, ` +
          `content ${contentOk ? "ok" : "not shipped"}, token ${tokenOk ? "ok" : "not shipped"}`,
        `agent plugin: ${
          agentManifest
            ? `ok (${agentManifest.name} ${agentManifest.version || "0.0.0"}, ${agentSkills} skill copies, mcp.json ${
                fs.existsSync(path.join(ROOT, "agent-plugin", "mcp.json")) ? "ok" : "missing"
              })`
            : "missing (agent-plugin/plugin.json)"
        }`,
        `design languages: ${designRoot ? `${readDesignCatalog(designRoot).length} (${designRoot})` : "none (optional pack not installed)"}`,
        `addons: ${addonRoot ? `${readAddonIndex(addonRoot).length} (${addonRoot})` : "none (optional pack not installed)"}`,
        `node: ${process.version}`,
        `playwright: ${playwrightStatus()}`,
        `ok: ${kitOk && foundSkills === SKILLS.length && lintOk ? "true" : "false"}`,
      ];
      if (!kitOk) lines.push("", "Fix: install the full dezign0 package; design-os/ is part of it.");
      if (foundSkills < SKILLS.length) lines.push("", "Fix: reinstall dezign0; the core skill set is incomplete.");
      return textResult(lines.join("\n"));
    },
  },
  {
    name: "dezign0_design_systems",
    title: "Dezign0 design languages",
    description:
      "Browse the optional Dezign0 design-language pack (upstream catalog design systems). Actions: list, search (query), get (slug). Returns catalog metadata or the selected DESIGN.md and tokens.css. Use before building when the user wants a known visual language.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "search", "get"] },
        query: { type: "string", description: "Search text for action=search." },
        slug: { type: "string", description: "Package slug for action=get." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(input) {
      const root = findDesignLanguages();
      if (!root) {
        return textResult(
          "No design-language pack found. Install `dezign0-design-languages` in the project, copy a `design-systems/` folder into the project, or set DEZIGN0_DESIGN_LANGUAGES.",
        );
      }
      const items = readDesignCatalog(root);
      if (input.action === "list") return textResult(formatDesignLanguages(root, items));
      if (input.action === "search") {
        const query = String(input.query || "").toLowerCase().trim();
        if (!query) throw new ToolError("query is required for action=search");
        const matches = items.filter((item) =>
          [item.slug, item.name, item.category, item.description].join(" ").toLowerCase().includes(query),
        );
        return textResult(formatDesignLanguages(root, matches));
      }
      if (input.action === "get") {
        const slug = String(input.slug || "");
        if (!/^[a-z0-9-]+$/.test(slug)) throw new ToolError("slug must be lowercase letters, numbers or hyphens");
        const dir = path.join(root, slug);
        const designFile = path.join(dir, "DESIGN.md");
        if (!isInside(root, dir) || !fs.existsSync(designFile)) throw new ToolError(`unknown design language: ${slug}`);
        const manifest = readJson(path.join(dir, "manifest.json"), {});
        const tokensPath = path.join(dir, "tokens.css");
        const tokens = fs.existsSync(tokensPath) ? fs.readFileSync(tokensPath, "utf8") : "";
        const packageFiles = [
          "DESIGN.md",
          "tokens.css",
          "USAGE.md",
          "components.html",
          "components.manifest.json",
          "design-tokens.json",
          "tailwind-v4.css",
        ].filter((name) => fs.existsSync(path.join(dir, name)));
        const header = [
          `design language: ${manifest.name || slug} (${slug})`,
          `category: ${manifest.category || "Uncategorized"}`,
          `root: ${dir}`,
          `files: ${packageFiles.join(", ")}`,
          `design: ${designFile}`,
          `tokens: ${fs.existsSync(tokensPath) ? tokensPath : "none"}`,
          "",
          "=== DESIGN.md (truncated; read the file for the full text) ===",
        ].join("\n");
        const design = fs.readFileSync(designFile, "utf8");
        const designPart = design.slice(0, 7000);
        const tokenPart = tokens.slice(0, 3500);
        return textResult(
          `${header}\n${designPart}${design.length > designPart.length ? "\n...[DESIGN.md truncated]" : ""}\n\n` +
            `=== tokens.css${tokens ? " (truncated; read the file for all tokens)" : " (missing)"} ===\n${tokenPart}` +
            `${tokens.length > tokenPart.length ? "\n...[tokens.css truncated]" : ""}`,
        );
      }
      throw new ToolError(`unknown action: ${input.action}`);
    },
  },
  {
    name: "dezign0_addons",
    title: "Dezign0 addons",
    description:
      "Browse the optional Dezign0 addon pack: starter templates, Figma bridge docs, React/Next/Vue handoff contracts, review playbooks and media prompt/storyboard packs. Actions: list, search, get.",
    inputSchema: {
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
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(input) {
      const root = findAddonPack();
      if (!root) {
        return textResult(
          "No addon pack found. Install `dezign0-design-languages` 0.2+ in the project, or use the sibling design-languages folder in a source checkout.",
        );
      }
      const all = readAddonIndex(root);
      const section = typeof input.section === "string" ? input.section : "";
      const filtered = section ? all.filter((item) => item.section === section) : all;
      if (input.action === "list") return textResult(formatAddons(root, filtered));
      if (input.action === "search") {
        const query = String(input.query || "").toLowerCase().trim();
        if (!query) throw new ToolError("query is required for action=search");
        const matches = filtered.filter((item) =>
          [item.id, item.title, item.section, item.description, item.path].join(" ").toLowerCase().includes(query),
        );
        return textResult(formatAddons(root, matches));
      }
      if (input.action === "get") {
        const item = all.find((entry) => entry.id === input.id);
        if (!item) throw new ToolError(`unknown addon: ${input.id}`);
        const file = path.join(root, item.path);
        if (!isInside(root, file) || !fs.existsSync(file)) throw new ToolError(`addon file missing: ${item.path}`);
        return textResult(
          `addon: ${item.title} (${item.id})\nsection: ${item.section}\npath: ${file}\n\n${fs.readFileSync(file, "utf8")}`,
        );
      }
      throw new ToolError(`unknown action: ${input.action}`);
    },
  },
  {
    name: "dezign0_content_lint",
    title: "Dezign0 content lint",
    description:
      "Check artifact copy and AI tells: filler, generic marketing language, invented metrics, placeholder names, CTA consistency and content realism. Available when the core package ships design-os/tools/content-lint.mjs.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Artifact path, relative to the current project." },
        strict: { type: "boolean", description: "Treat advisory findings as failures." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(input) {
      const file = resolveArtifact(input.path);
      const script = path.join(KIT, "tools", "content-lint.mjs");
      if (!fs.existsSync(script)) return unavailable("dezign0_content_lint", "content-lint.mjs");
      const args = input.strict ? ["--strict", file] : [file];
      const run = await runNode(script, args);
      if (run.spawnError) return textResult("ERROR: Node.js was not found. Install Node 18+ to use content lint.", true);
      return textResult(commandOutput(`content-lint ${input.strict ? "--strict " : ""}${path.relative(PROJECT, file)}`, run));
    },
  },
  {
    name: "dezign0_token_export",
    title: "Dezign0 token export",
    description:
      "Export design tokens (tokens.css / DESIGN.md / package tokens) to DTCG JSON, Tailwind v4 @theme CSS, shadcn variables or a platform format. Available when the core package ships design-os/tools/token-export.mjs.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "Project-relative token source file or design-system package directory (tokens.css, design-tokens.json or DESIGN.md). Omit to auto-detect tokens.css / design-tokens.json / DESIGN.md in the project.",
        },
        out: { type: "string", description: "Optional project-relative output file. Omit to return the artifact as text." },
        format: {
          type: "string",
          enum: ["dtcg", "tailwind", "shadcn", "swift", "compose", "flutter"],
          description: "Output format (default dtcg).",
        },
        platform: {
          type: "string",
          enum: ["swift", "compose", "flutter"],
          description: "Alias for format; kept for the plugin tool contract.",
        },
        json: { type: "boolean", description: "Return a JSON summary instead of the artifact." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    async handler(input) {
      const script = path.join(KIT, "tools", "token-export.mjs");
      if (!fs.existsSync(script)) return unavailable("dezign0_token_export", "token-export.mjs");
      const args = [];
      if (input.source !== undefined) {
        args.push(resolveInside(PROJECT, input.source, "source"));
      } else {
        const detected = ["tokens.css", "design-tokens.json", "DESIGN.md"]
          .map((name) => path.join(PROJECT, name))
          .find((file) => fs.existsSync(file));
        if (!detected) {
          throw new ToolError(
            "no token source found in the project; pass source=<file-or-dir> (tokens.css, design-tokens.json or a design-system package)",
          );
        }
        args.push(detected);
      }
      const format = input.format || input.platform;
      if (format !== undefined) {
        if (typeof format !== "string" || !["dtcg", "tailwind", "shadcn", "swift", "compose", "flutter"].includes(format)) {
          throw new ToolError("format must be one of dtcg, tailwind, shadcn, swift, compose, flutter");
        }
        args.push(`--format=${format}`);
      }
      if (input.out !== undefined) {
        // Output may not exist yet, so check containment without realpath.
        if (typeof input.out !== "string" || path.isAbsolute(input.out)) throw new ToolError("out must be project-relative");
        const target = path.resolve(PROJECT, input.out);
        if (!isInside(PROJECT, target)) throw new ToolError(`out resolves outside the project: ${input.out}`);
        args.push(`--out=${target}`);
      }
      if (input.json === true) args.push("--json");
      const run = await runNode(script, args);
      if (run.spawnError) return textResult("ERROR: Node.js was not found. Install Node 18+ to export tokens.", true);
      return textResult(commandOutput("token-export", run));
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

// ── JSON-RPC / MCP dispatch ────────────────────────────────────────────────

let negotiated = DEFAULT_PROTOCOL;
let initialized = false;
let pending = 0;
let stdinClosed = false;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

function send(message) {
  if (process.stdout.destroyed) return;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

function maybeExit() {
  if (stdinClosed && pending === 0) {
    debug("stdin closed and no pending calls; exiting");
    // Let pending stdout writes flush; the event loop is otherwise empty.
    process.exitCode = 0;
    rl.close();
  }
}

async function dispatch(message) {
  if (!initialized && message.method !== "initialize") {
    sendError(message.id ?? null, -32002, "server is not initialized");
    return;
  }
  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      negotiated = SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      initialized = true;
      const info = readJson(path.join(ROOT, "package.json"), {});
      sendResult(message.id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: info.version || VERSION },
        instructions:
          "Dezign0 design tools. Call dezign0_doctor when unsure what is installed; lint before a critique, measure when Playwright is available. All paths are project-relative.",
      });
      return;
    }
    case "ping":
      sendResult(message.id, {});
      return;
    case "tools/list":
      sendResult(message.id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        })),
      });
      return;
    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (typeof name !== "string" || !TOOL_MAP.has(name)) {
        sendError(message.id, -32602, `Unknown tool: ${String(name)}`);
        return;
      }
      if (typeof args !== "object" || Array.isArray(args) || args === null) {
        sendError(message.id, -32602, "Tool arguments must be an object");
        return;
      }
      pending += 1;
      try {
        const result = await TOOL_MAP.get(name).handler(args);
        sendResult(message.id, result);
      } catch (error) {
        if (error instanceof ToolError) sendResult(message.id, textResult(`ERROR: ${error.message}`, true));
        else {
          debug("tool crash", error && error.stack ? error.stack : String(error));
          sendResult(message.id, textResult(`ERROR: ${error instanceof Error ? error.message : String(error)}`, true));
        }
      } finally {
        pending -= 1;
        maybeExit();
      }
      return;
    }
    default:
      sendError(message.id, -32601, `Method not found: ${String(message.method)}`);
  }
}

function handleLine(line) {
  const raw = line.trim();
  if (!raw) return;
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    sendError(null, -32700, "Parse error");
    return;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    sendError(message?.id ?? null, -32600, "Invalid Request");
    return;
  }
  if (typeof message.method === "string" && message.method.startsWith("notifications/")) {
    debug("notification", message.method);
    return;
  }
  if (typeof message.method !== "string") {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) return; // client response
    sendError(message.id ?? null, -32600, "Invalid Request");
    return;
  }
  if (message.id === undefined) return; // request without id: treat as notification
  pending += 1;
  Promise.resolve(dispatch(message))
    .catch((error) => {
      debug("dispatch crashed", error && error.stack ? error.stack : String(error));
      sendError(message.id, -32603, `Internal error: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      pending -= 1;
      maybeExit();
    });
}

rl.on("line", handleLine);
rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
});
process.stdout.on("error", (error) => {
  if (error && error.code === "EPIPE") process.exit(0);
  debug("stdout error", String(error));
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

debug(`serving ${SERVER_NAME} ${VERSION} for project ${PROJECT} (${TOOL_NAMES.length} tools)`);
