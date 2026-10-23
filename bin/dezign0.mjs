#!/usr/bin/env node
/**
 * dezign0 — portable design-tool CLI.
 *
 * Runs the kit's static linter and rendered measurement tool from any working
 * directory, lists the optional design-language/addon pack, scaffolds a project
 * and exports the capability manifest. Zero dependencies; Node 18+.
 *
 * Exit codes are stable for every command:
 *   0  ok / no findings
 *   1  findings, health problems, or a refused operation
 *   2  usage error, missing file, or tool/environment failure
 *
 * No network access is performed by this CLI.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DESIGN_OS = path.join(ROOT, "design-os");
const TOOLS = path.join(DESIGN_OS, "tools");
const LINT_SCRIPT = path.join(TOOLS, "design-lint.mjs");
const MEASURE_SCRIPT = path.join(TOOLS, "measure-artifact.mjs");
const CAPABILITIES_PATH = path.join(ROOT, "capabilities.json");

const EXIT = { OK: 0, FINDINGS: 1, USAGE: 2 };
const COMMANDS = ["lint", "measure", "audit", "doctor", "systems", "addons", "new", "export"];
const PROFILES = ["prototype", "landing", "dashboard", "deck", "document", "email", "mobile", "component-library"];
const BOOL_FLAGS = new Set([
  "json", "strict", "quiet", "help", "version", "a11y", "force",
]);
const VALUE_FLAGS = new Set([
  "viewports", "shots", "selector", "baseline", "max-diff", "exclude",
  "search", "category", "section", "profile", "dir", "out", "limit",
]);

class CliError extends Error {
  constructor(message, code = EXIT.USAGE, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

function out(line = "") {
  process.stdout.write(`${line}\n`);
}

function warn(line) {
  process.stderr.write(`dezign0: ${line}\n`);
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function envelope(command, code, extra = {}) {
  return {
    schema: "dezign0/cli/v1",
    command,
    ok: code === EXIT.OK,
    exitCode: code,
    ...extra,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getPackageVersion() {
  try {
    return readJson(path.join(ROOT, "package.json")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function getCapabilities() {
  try {
    const capabilities = readJson(CAPABILITIES_PATH);
    if (capabilities && typeof capabilities === "object") return capabilities;
  } catch {
    // Fall through: commands that need the manifest report it themselves.
  }
  return null;
}

function getVersion() {
  return getCapabilities()?.version || getPackageVersion();
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "-v") {
      flags.version = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (name === "no-a11y") {
      flags.a11y = false;
      continue;
    }
    if (BOOL_FLAGS.has(name)) {
      if (eq !== -1) throw new CliError(`--${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      let value;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new CliError(`--${name} requires a value`);
        }
        i += 1;
      }
      if (value === "") throw new CliError(`--${name} requires a value`);
      flags[name] = value;
      continue;
    }
    throw new CliError(`unknown flag --${name}`);
  }
  return { flags, positionals };
}

const HELP = `dezign0 ${getVersion()} — portable design tools for AI coding agents

Usage: dezign0 <command> [args] [flags]

Commands:
  lint <file...>          Static design lint (P0/P1/P2 findings)
  measure <file|url>      Rendered measurement via Playwright (optional)
  audit <file>            Lint plus rendered measurement and a verdict
  doctor                  Check versions, kit, tools, adapters and optional pack
  systems [query]         List design languages from the optional pack
  addons [id]             List addons or print one addon document
  new <slug>              Scaffold design/<slug>/ from the profile templates
  export [capabilities|system]  Export the manifest or a design-system package

Flags:
  --json                  Machine-readable JSON on stdout
  --strict                Treat P1/warnings as failures where supported
  --quiet                 Only print the final summary
  --help, -h              Show help (also per command)
  --version, -v           Print the version

Command flags:
  lint     --strict --quiet --json
  measure  --viewports=1440x900,390x844,145x188 --a11y --shots=dir
           --selector=.css --baseline=dir --max-diff=0.001 --exclude=.a,.b
           --strict --quiet --json
  audit    --viewports=... --shots=dir --strict --json
  doctor   --strict --json --quiet
  systems  --search=term --category=name --limit=20 --json --quiet
  addons   --section=review --search=term --json --quiet
  new      --profile=prototype --dir=design --force --json
  export   capabilities [--out=file] [--force] [--json]
           system <slug> --out=dir [--force] [--json]

Exit codes: 0 ok, 1 findings/refused health check, 2 usage or tool failure.
No network access. DESIGN-OS.md and craft rules live under design-os/.`;

function commandHelp(command) {
  const usage = {
    lint: "dezign0 lint [--strict] [--quiet] [--json] <file...>",
    measure: "dezign0 measure [--viewports=WxH,...] [--a11y] [--shots=dir] [--selector=.css] [--baseline=dir] [--max-diff=0.001] [--exclude=.a,.b] [--strict] [--json] <file|url>",
    audit: "dezign0 audit [--viewports=WxH,...] [--shots=dir] [--strict] [--json] <file>",
    doctor: "dezign0 doctor [--strict] [--quiet] [--json]",
    systems: "dezign0 systems [query] [--search=term] [--category=name] [--limit=20] [--json] [--quiet]",
    addons: "dezign0 addons [id] [--section=name] [--search=term] [--json] [--quiet]",
    new: "dezign0 new <slug> [--profile=prototype] [--dir=design] [--force] [--json]",
    export: "dezign0 export [capabilities] [--out=file] [--force] [--json]\n       dezign0 export system <slug> --out=dir [--force] [--json]",
  }[command];
  out(usage || "dezign0 <command> [args] [flags]");
  if (!usage) out("\nRun `dezign0 --help` for the command list.");
}

function requireFiles(files, command) {
  if (!files.length) throw new CliError(`${command} needs at least one file`);
  for (const file of files) {
    if (/^https?:|^file:/.test(file)) continue;
    const resolved = path.resolve(process.cwd(), file);
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new CliError(`file not found: ${file}`);
    }
    if (!stat.isFile()) throw new CliError(`not a file: ${file}`);
  }
}

function runNodeScript(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    timeout: options.timeout || 180_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.error) {
    throw new CliError(`failed to run ${path.basename(script)}: ${result.error.message}`);
  }
  return {
    status: typeof result.status === "number" ? result.status : EXIT.USAGE,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function parseToolJson(result, tool) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    const detail = result.stderr.trim() || result.stdout.trim() || "no output";
    throw new CliError(`${tool} did not return JSON: ${detail.slice(0, 500)}`);
  }
}

function hasPlaywright(cwd) {
  try {
    const requireFromProject = createRequire(path.join(cwd, "__dezign0_resolve__.js"));
    requireFromProject.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

function toolExitToCliExit(status) {
  if (status === 0) return EXIT.OK;
  if (status === 1) return EXIT.FINDINGS;
  return EXIT.USAGE;
}

function runLint(files, flags, extraArgs = []) {
  const args = ["--json"];
  if (flags.strict) args.push("--strict");
  if (flags.quiet) args.push("--quiet");
  args.push(...extraArgs, ...files);
  const result = runNodeScript(LINT_SCRIPT, args);
  const parsed = parseToolJson(result, "design-lint");
  return { result, parsed, code: toolExitToCliExit(result.status) };
}

function runMeasure(target, flags, overrides = {}) {
  const args = ["--json"];
  if (flags.strict) args.push("--strict");
  if (flags.viewports || overrides.viewports) args.push(`--viewports=${flags.viewports || overrides.viewports}`);
  if (flags.shots || overrides.shots) args.push(`--shots=${flags.shots || overrides.shots}`);
  if (flags.selector) args.push(`--selector=${flags.selector}`);
  if (flags.baseline) args.push(`--baseline=${flags.baseline}`);
  if (flags["max-diff"]) args.push(`--max-diff=${flags["max-diff"]}`);
  if (flags.exclude) args.push(`--exclude=${flags.exclude}`);
  if (flags.a11y || overrides.a11y) args.push("--a11y");
  args.push(target);
  const result = runNodeScript(MEASURE_SCRIPT, args, {
    env: { DEZIGN0_PROJECT_DIR: process.cwd() },
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return {
    result,
    parsed,
    code: result.status === 0 ? EXIT.OK : result.status === 1 ? EXIT.FINDINGS : EXIT.USAGE,
  };
}

function formatFindings(findings, limit = 40) {
  return findings.slice(0, limit).map((finding) => {
    const where = finding.file ? ` ${path.relative(process.cwd(), finding.file) || finding.file}:${finding.line}` : "";
    return `${finding.severity} ${finding.id}${where} — ${finding.message}`;
  });
}

function commandLint(flags, files) {
  requireFiles(files, "lint");
  const { parsed, code } = runLint(files, flags);
  if (flags.json) {
    emitJson(envelope("lint", code, { strict: Boolean(flags.strict), files: parsed.files, counts: parsed.counts, findings: parsed.findings }));
    return code;
  }
  if (!flags.quiet) for (const line of formatFindings(parsed.findings)) out(line);
  out(`lint: ${parsed.counts.P0} P0, ${parsed.counts.P1} P1, ${parsed.counts.P2} P2 across ${parsed.files.length} file(s)${code === EXIT.OK ? "" : " — blocking"}`);
  return code;
}

function measureFailureMessage(result) {
  return (result.stderr || result.stdout).trim().split("\n").slice(0, 6).join("\n");
}

function commandMeasure(flags, positionals) {
  const target = positionals[0];
  if (!target) throw new CliError("measure needs a file or URL");
  requireFiles([target], "measure");
  const { result, parsed, code } = runMeasure(target, flags);
  if (flags.json) {
    emitJson(envelope("measure", code, parsed
      ? { target, ...parsed }
      : { target, error: measureFailureMessage(result) }));
    return code;
  }
  if (!parsed) {
    warn(measureFailureMessage(result));
    return code;
  }
  if (!flags.quiet) {
    for (const viewport of parsed.results) {
      const bits = [
        String(viewport.label || viewport.width).padStart(9),
        `scroll=${viewport.scrollWidth}`,
        viewport.clippedCount ? `clipped=${viewport.clippedCount}` : "clipped=0",
        viewport.contrastCount ? `contrast=${viewport.contrastCount}` : "contrast=0",
        `typeSizes=${viewport.typeSizeCount}`,
        `tabStops=${viewport.tabStops}`,
        flags.a11y ? `a11y=${viewport.a11yCount}` : null,
        viewport.diff ? `diff=${viewport.diff.status === "compared" ? `${(viewport.diff.ratio * 100).toFixed(2)}%` : viewport.diff.status}` : null,
      ].filter(Boolean);
      out(bits.join("  "));
    }
    if (parsed.consoleErrors.length) out(`console errors: ${parsed.consoleErrors.length}`);
  }
  out(`measure: ${parsed.blocking ? "findings present" : "no blocking findings"}${code === EXIT.OK ? "" : " — blocking"}${flags.shots ? `; screenshots in ${flags.shots}` : ""}`);
  return code;
}

function commandAudit(flags, positionals) {
  const artifact = positionals[0];
  if (!artifact) throw new CliError("audit needs an artifact file");
  requireFiles([artifact], "audit");
  const lint = runLint([artifact], flags);
  const skipped = [];
  let measure = null;
  let measureCode = null;
  if (!hasPlaywright(process.cwd())) {
    skipped.push("measure: Playwright is not installed in this project (npm i -D playwright && npx playwright install chromium)");
  } else {
    measure = runMeasure(artifact, flags, {
      viewports: "1440x900,390x844,145x188",
      a11y: true,
      shots: flags.shots,
    });
    measureCode = measure.code;
    if (measure.code === EXIT.USAGE) skipped.push(`measure: ${measureFailureMessage(measure.result)}`);
  }
  let code = lint.code;
  if (measure && measure.code === EXIT.FINDINGS) code = EXIT.FINDINGS;
  if (measure && measure.code === EXIT.USAGE) code = EXIT.FINDINGS;
  if (flags.json) {
    emitJson(envelope("audit", code, {
      artifact: path.resolve(artifact),
      strict: Boolean(flags.strict),
      lint: { exitCode: lint.code, counts: lint.parsed.counts, findings: lint.parsed.findings },
      measure: measure && measure.parsed
        ? { exitCode: measureCode, viewports: measure.parsed.results, consoleErrors: measure.parsed.consoleErrors, pageErrors: measure.parsed.pageErrors, blocking: measure.parsed.blocking, screenshots: flags.shots ? path.resolve(flags.shots) : null }
        : null,
      skipped,
    }));
    return code;
  }
  if (!flags.quiet) {
    for (const line of formatFindings(lint.parsed.findings, 20)) out(line);
    if (measure && measure.parsed) {
      for (const viewport of measure.parsed.results) {
        out(`${String(viewport.label).padStart(9)}  clipped=${viewport.clippedCount}  contrast=${viewport.contrastCount}  a11y=${viewport.a11yCount}`);
      }
    }
    for (const note of skipped) warn(note);
  }
  out(`audit: ${lint.parsed.counts.P0} P0, ${lint.parsed.counts.P1} P1; ${measure ? "rendered checks ran" : "rendered checks skipped"} — ${code === EXIT.OK ? "pass" : "review required"}`);
  return code;
}

function resolveDesignLanguages(cwd) {
  const candidates = [
    process.env.DEZIGN0_DESIGN_LANGUAGES,
    path.join(cwd, "design-systems"),
    path.join(cwd, "design-languages", "design-systems"),
    path.join(cwd, "node_modules", "dezign0-design-languages", "design-systems"),
    path.join(ROOT, "design-languages", "design-systems"),
    path.resolve(DESIGN_OS, "..", "design-languages", "design-systems"),
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

function resolveAddonPack(cwd) {
  const candidates = [
    process.env.DEZIGN0_ADDONS,
    cwd,
    path.join(cwd, "design-languages"),
    path.join(cwd, "node_modules", "dezign0-design-languages"),
    path.join(ROOT, "design-languages"),
    path.resolve(DESIGN_OS, "..", "design-languages"),
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

function readDesignCatalog(systemsDir) {
  const indexPath = path.join(systemsDir, "..", "index.json");
  const packPackage = readJsonSafe(path.join(systemsDir, "..", "package.json"));
  try {
    const index = readJson(indexPath);
    if (Array.isArray(index.items)) return { index, packVersion: packPackage?.version || null, items: index.items, indexPath };
  } catch {
    // Fall back to scanning packages below.
  }
  const items = fs.readdirSync(systemsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(systemsDir, entry.name, "DESIGN.md")))
    .map((entry) => {
      let manifest = {};
      try {
        manifest = readJson(path.join(systemsDir, entry.name, "manifest.json"));
      } catch {
        manifest = {};
      }
      return {
        slug: entry.name,
        name: manifest.name || entry.name,
        category: manifest.category || "Uncategorized",
        description: manifest.description || "",
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return { index: null, packVersion: packPackage?.version || null, items, indexPath: null };
}

function filterItems(items, flags, query) {
  const term = (flags.search || query || "").toLowerCase();
  const category = (flags.category || "").toLowerCase();
  return items.filter((item) => {
    if (category && String(item.category || "").toLowerCase() !== category) return false;
    if (!term) return true;
    return [item.slug, item.name, item.category, item.description].filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
}

function parseLimit(value) {
  if (value === undefined) return 0;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new CliError("--limit must be a positive integer");
  return limit;
}

function commandSystems(flags, positionals) {
  const systemsDir = resolveDesignLanguages(process.cwd());
  if (!systemsDir) {
    const code = EXIT.FINDINGS;
    if (flags.json) {
      emitJson(envelope("systems", code, {
        available: false,
        error: "design-language pack not found",
        hint: "install dezign0-design-languages, copy design-systems/ into the project, or set DEZIGN0_DESIGN_LANGUAGES",
      }));
    } else {
      warn("design-language pack not found (install dezign0-design-languages 0.2+ or set DEZIGN0_DESIGN_LANGUAGES)");
    }
    return code;
  }
  const catalog = readDesignCatalog(systemsDir);
  const expected = getCapabilities()?.designLanguages?.count;
  if (expected && catalog.items.length !== expected) {
    throw new CliError(`design-language pack has ${catalog.items.length} items, expected ${expected}`);
  }
  let items = filterItems(catalog.items, flags, positionals[0]);
  const limit = parseLimit(flags.limit);
  const total = items.length;
  if (limit) items = items.slice(0, limit);
  if (flags.json) {
    emitJson(envelope("systems", EXIT.OK, {
      available: true,
      root: systemsDir,
      packVersion: catalog.packVersion || catalog.index?.version || null,
      total,
      returned: items.length,
      items: items.map((item) => ({
        slug: item.slug,
        name: item.name,
        category: item.category || null,
        description: item.description || "",
      })),
    }));
    return EXIT.OK;
  }
  if (!flags.quiet) {
    out(`systems: ${total} design language(s) at ${systemsDir}`);
    for (const item of items) out(`${item.slug} — ${item.name} [${item.category || "Uncategorized"}]`);
    if (limit && total > items.length) out(`... ${total - items.length} more; raise --limit or use --search`);
  } else {
    out(`systems: ${total}`);
  }
  return EXIT.OK;
}

function safeChild(root, relative) {
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return resolved;
  throw new CliError(`addon path escapes the pack: ${relative}`);
}

function commandAddons(flags, positionals) {
  const root = resolveAddonPack(process.cwd());
  if (!root) {
    const code = EXIT.FINDINGS;
    if (flags.json) {
      emitJson(envelope("addons", code, {
        available: false,
        error: "addon pack not found",
        hint: "install dezign0-design-languages or use the sibling design-languages folder",
      }));
    } else {
      warn("addon pack not found (install dezign0-design-languages 0.2+ or set DEZIGN0_ADDONS)");
    }
    return code;
  }
  const index = readJson(path.join(root, "addons", "index.json"));
  const all = Array.isArray(index.items) ? index.items : [];
  const expected = getCapabilities()?.addons?.count;
  if (expected && all.length !== expected) {
    throw new CliError(`addon pack has ${all.length} items, expected ${expected}`);
  }
  const id = positionals[0];
  if (id) {
    const item = all.find((entry) => entry.id === id);
    if (!item) {
      const message = `unknown addon: ${id}`;
      if (flags.json) emitJson(envelope("addons", EXIT.FINDINGS, { available: true, error: message, ids: all.map((entry) => entry.id) }));
      else warn(message);
      return EXIT.FINDINGS;
    }
    const file = safeChild(root, item.path);
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      throw new CliError(`addon file is missing: ${item.path}`);
    }
    if (flags.json) {
      emitJson(envelope("addons", EXIT.OK, {
        available: true,
        root,
        item,
        path: file,
        contentType: path.extname(file).slice(1) || "text",
        content,
      }));
      return EXIT.OK;
    }
    if (!flags.quiet) out(content);
    else out(`addon: ${item.id} (${item.path})`);
    return EXIT.OK;
  }
  let items = all;
  if (flags.section) items = items.filter((item) => item.section === flags.section);
  items = filterItems(items, { search: flags.search }, null);
  if (flags.json) {
    emitJson(envelope("addons", EXIT.OK, { available: true, root, count: items.length, items }));
    return EXIT.OK;
  }
  if (!flags.quiet) {
    out(`addons: ${items.length} item(s) at ${root}`);
    let section = "";
    for (const item of items) {
      if (item.section !== section) {
        section = item.section;
        out(`[${section}]`);
      }
      out(`${item.id} — ${item.title}: ${item.path}`);
    }
  } else {
    out(`addons: ${items.length}`);
  }
  return EXIT.OK;
}

function slugIsValid(slug) {
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) && !slug.includes("--");
}

function profileBrief(slug, profile) {
  return `# Brief — ${slug}

Profile: \`${profile}\`

## Goal

State the user-visible outcome in one sentence.

## Audience

Who uses this and in what context.

## Constraints

- Sizes, grid, type scale and tokens (numbers, not adjectives).
- States: default, hover, focus, active, disabled, empty, loading, error.
- Accessibility floor: WCAG 2.2 AA, keyboard reachable, visible focus.

## Deliverables

- \`artifact.html\` — self-contained, no external assets.
- \`tokens.css\` — the token set this artifact consumes.
- \`CRITIQUE.md\` — evidence after measurement.

Read \`.design-os/DESIGN-OS.md\` before changing the artifact.
`;
}

function profileSpec(slug, profile) {
  return `# Design spec — ${slug}

Profile: \`${profile}\`

## Structure

Name each region and its job. Keep the DOM flat enough to review.

## Tokens

Only \`var(--...)\` values from \`tokens.css\`. No raw hex or px in components.

## States

Every interactive control needs default, hover, focus-visible, active and
disabled; every collection needs empty and loading; every form needs an error
state.

## Acceptance

- Lint clean with \`dezign0 lint --strict artifact.html\`.
- Rendered review with \`dezign0 measure artifact.html --viewports=1440x900,390x844,145x188 --a11y\`.
- Critique findings are recorded in \`CRITIQUE.md\`.
`;
}

function artifactTemplate(slug) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${slug}</title>
<link rel="stylesheet" href="tokens.css">
<style>
  :root { --color-bg: #ffffff; --color-fg: #111111; --color-accent: #2563eb; --color-on-accent: #ffffff; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --radius-md: 8px; }
  body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 72rem; margin: 0 auto; padding: var(--space-6); }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 var(--space-3); }
  p { font-size: 1rem; line-height: 1.6; max-width: 42rem; }
  .action { display: inline-block; margin-top: var(--space-4); padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); background: var(--color-accent); color: var(--color-on-accent); text-decoration: none; }
  .action:focus-visible { outline: 2px solid var(--color-fg); outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>${slug}</h1>
  <p>Replace this paragraph with the real product copy from the brief. Keep the
  copy specific and short enough to scan.</p>
  <a class="action" href="#next">Continue</a>
</main>
</body>
</html>
`;
}

function commandNew(flags, positionals) {
  const slug = positionals[0];
  if (!slug) throw new CliError("new needs a slug, for example: dezign0 new billing-settings");
  if (!slugIsValid(slug)) throw new CliError("slug must be lowercase letters, digits and single hyphens (max 63)");
  const profile = flags.profile || "prototype";
  if (!PROFILES.includes(profile)) throw new CliError(`unknown profile: ${profile} (expected ${PROFILES.join(", ")})`);
  const cwd = path.resolve(process.cwd());
  const target = path.resolve(cwd, flags.dir || "design", slug);
  const rel = path.relative(cwd, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new CliError("refusing to create a project outside the current directory");
  }
  const exists = fs.existsSync(target);
  if (exists && !flags.force) {
    const code = EXIT.FINDINGS;
    if (flags.json) emitJson(envelope("new", code, { slug, profile, directory: target, error: "directory already exists (use --force to overwrite known files)" }));
    else warn(`directory already exists: ${rel} (use --force to overwrite known files)`);
    return code;
  }
  fs.mkdirSync(target, { recursive: true });
  const files = {
    "project.json": `${JSON.stringify({
      schema: "dezign0/project/v1",
      slug,
      profile,
      system: null,
      skills: ["design-brief", "frontend-design", "critique"],
      constraints: {},
      status: "draft",
      created: new Date().toISOString(),
    }, null, 2)}\n`,
    "BRIEF.md": profileBrief(slug, profile),
    "DESIGN-SPEC.md": profileSpec(slug, profile),
    "CRITIQUE.md": `# Critique — ${slug}\n\nRun the critique skill against the artifact after measurement.\nRecord evidence, not opinions.\n`,
    "HANDOVER.md": `# Handover — ${slug}\n\nRecord the contract another agent needs to implement this artifact:\ncomponent tree, token mapping, states, assets and known gaps.\n`,
    "MEMORY.md": `# Memory — ${slug}\n\nDurable decisions and the reasons behind them. Keep entries dated.\n`,
    "tokens.css": `:root {\n  --color-bg: #ffffff;\n  --color-fg: #111111;\n  --color-accent: #2563eb;\n  --color-on-accent: #ffffff;\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 12px;\n  --space-4: 16px;\n  --space-6: 24px;\n  --radius-md: 8px;\n  --font-body: 16px;\n  --font-title: 32px;\n}\n`,
    "annotations.json": `${JSON.stringify({ schema: "dezign0/annotations/v1", items: [] }, null, 2)}\n`,
    "artifact.html": artifactTemplate(slug),
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(target, name), content);
  const created = Object.keys(files);
  if (flags.json) {
    emitJson(envelope("new", EXIT.OK, { slug, profile, directory: target, created, files: created.map((name) => path.join(rel, name)) }));
  } else {
    out(`created ${rel} (${profile}) with ${created.length} files`);
    for (const name of created) out(`  ${path.join(rel, name)}`);
  }
  return EXIT.OK;
}

function exportCapabilities(flags) {
  const capabilities = getCapabilities();
  if (!capabilities) throw new CliError("capabilities.json is missing or invalid");
  const text = `${JSON.stringify(capabilities, null, 2)}\n`;
  if (flags.out) {
    const file = path.resolve(process.cwd(), flags.out);
    const exists = fs.existsSync(file);
    if (exists && !flags.force) {
      const message = `file already exists: ${file} (use --force)`;
      if (flags.json) emitJson(envelope("export", EXIT.FINDINGS, { kind: "capabilities", error: message }));
      else warn(message);
      return EXIT.FINDINGS;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (flags.json) {
      emitJson(envelope("export", EXIT.OK, { kind: "capabilities", path: file, bytes: Buffer.byteLength(text), version: capabilities.version }));
    } else {
      out(`exported capabilities ${capabilities.version} to ${file}`);
    }
    return EXIT.OK;
  }
  process.stdout.write(text);
  return EXIT.OK;
}

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return count;
}

function exportSystem(flags, positionals) {
  const slug = positionals[0];
  if (!slug) throw new CliError("export system needs a design-language slug");
  if (!flags.out) throw new CliError("export system needs --out=<directory>");
  const systemsDir = resolveDesignLanguages(process.cwd());
  if (!systemsDir) throw new CliError("design-language pack not found (install dezign0-design-languages)");
  const source = safeChild(systemsDir, slug);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    const message = `unknown design language: ${slug}`;
    if (flags.json) emitJson(envelope("export", EXIT.FINDINGS, { kind: "system", slug, error: message }));
    else warn(message);
    return EXIT.FINDINGS;
  }
  const target = path.resolve(process.cwd(), flags.out);
  if (fs.existsSync(target)) {
    if (!flags.force) {
      const message = `target already exists: ${target} (use --force)`;
      if (flags.json) emitJson(envelope("export", EXIT.FINDINGS, { kind: "system", slug, error: message }));
      else warn(message);
      return EXIT.FINDINGS;
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  const files = countFiles(target);
  if (flags.json) {
    emitJson(envelope("export", EXIT.OK, { kind: "system", slug, source, path: target, files }));
  } else {
    out(`exported ${slug} to ${target} (${files} files)`);
  }
  return EXIT.OK;
}

function commandExport(flags, positionals) {
  const kind = positionals[0] || "capabilities";
  if (kind === "capabilities") return exportCapabilities(flags);
  if (kind === "system") return exportSystem(flags, positionals.slice(1));
  throw new CliError(`unknown export kind: ${kind} (expected capabilities or system)`);
}

function readJsonSafe(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function commandDoctor(flags) {
  const capabilities = getCapabilities();
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("node", nodeMajor >= 18 ? "pass" : "fail", `Node ${process.versions.node} (requires >=18)`);

  if (!capabilities) {
    add("capabilities", "fail", "capabilities.json is missing or invalid");
  } else {
    add("capabilities", "pass", `manifest ${capabilities.schema || "unknown"} at ${CAPABILITIES_PATH}`);
    add("version", capabilities.version === getPackageVersion() ? "pass" : "fail",
      `manifest ${capabilities.version}, package ${getPackageVersion()}`);
    const compatibilityCore = capabilities.compatibility?.core;
    add("compatibility", compatibilityCore === capabilities.version ? "pass" : "fail",
      `compatibility.core ${compatibilityCore || "missing"} vs manifest ${capabilities.version}`);
    const kit = readJsonSafe(path.join(DESIGN_OS, "kit.json"));
    add("kit-version", kit?.version === capabilities.version ? "pass" : "fail",
      `kit.json ${kit?.version || "missing"}`);
    const skillsDir = path.join(DESIGN_OS, "skills");
    const skills = fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir).filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md")))
      : [];
    const expectedSkills = capabilities.skills?.names || [];
    add("skills", skills.length === capabilities.skills?.count && expectedSkills.every((name) => skills.includes(name)) ? "pass" : "fail",
      `${skills.length} installed / ${capabilities.skills?.count ?? "?"} expected`);
    const toolFiles = ["design-lint.mjs", "measure-artifact.mjs"].filter((name) => fs.existsSync(path.join(TOOLS, name)));
    add("tools", toolFiles.length === 2 ? "pass" : "fail", `${toolFiles.length}/2 tool scripts present`);
    const pluginSource = fs.existsSync(path.join(ROOT, "plugin", "index.js")) ? fs.readFileSync(path.join(ROOT, "plugin", "index.js"), "utf8") : null;
    const pluginTools = pluginSource
      ? [...new Set([...pluginSource.matchAll(/name:\s*"(dezign0_[a-z_]+)"/g)].map((match) => match[1]))].sort()
      : [];
    const expectedTools = [...(capabilities.tools?.names || [])].sort();
    add("plugin-tools", pluginTools.length === expectedTools.length && expectedTools.every((name) => pluginTools.includes(name)) ? "pass" : "fail",
      `plugin exposes ${pluginTools.length} tools / ${expectedTools.length} expected`);
    const adaptersDir = path.join(DESIGN_OS, "adapters");
    const adapters = fs.existsSync(adaptersDir) ? fs.readdirSync(adaptersDir).filter((name) => name.endsWith(".json")).length : 0;
    add("adapters", adapters === capabilities.adapters?.count ? "pass" : "fail",
      `${adapters} adapters / ${capabilities.adapters?.count ?? "?"} expected`);
  }

  const systemsDir = resolveDesignLanguages(process.cwd());
  if (systemsDir) {
    const catalog = readDesignCatalog(systemsDir);
    const expected = capabilities?.designLanguages?.count;
    add("design-languages", !expected || catalog.items.length === expected ? "pass" : "fail",
      `${catalog.items.length} design languages at ${systemsDir}`);
  } else {
    add("design-languages", "warn", "optional pack not found (install dezign0-design-languages)");
  }

  const addonRoot = resolveAddonPack(process.cwd());
  if (addonRoot) {
    const index = readJsonSafe(path.join(addonRoot, "addons", "index.json"));
    const count = Array.isArray(index?.items) ? index.items.length : 0;
    const expected = capabilities?.addons?.count;
    add("addons", !expected || count === expected ? "pass" : "fail",
      `${count} addons at ${addonRoot}${index?.version ? ` (pack ${index.version})` : ""}`);
  } else {
    add("addons", "warn", "optional addon pack not found");
  }

  const projectKit = readJsonSafe(path.join(process.cwd(), ".design-os", ".dezign0-kit.json"));
  if (projectKit) {
    add("project-kit", !capabilities || projectKit.version === capabilities.version ? "pass" : "warn",
      `project kit ${projectKit.version || "unknown"}, plugin ${capabilities?.version || "?"}`);
  } else {
    add("project-kit", "pass", "not installed in this project (optional)");
  }

  add("playwright", hasPlaywright(process.cwd()) ? "pass" : "warn",
    hasPlaywright(process.cwd()) ? "resolvable from the project" : "not installed (required only for measure/audit)");

  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const code = failures.length || (flags.strict && warnings.length) ? EXIT.FINDINGS : EXIT.OK;
  if (flags.json) {
    emitJson(envelope("doctor", code, {
      version: getVersion(),
      strict: Boolean(flags.strict),
      summary: { pass: checks.filter((c) => c.status === "pass").length, warn: warnings.length, fail: failures.length },
      checks,
    }));
    return code;
  }
  if (!flags.quiet) {
    for (const check of checks) out(`${check.status.toUpperCase().padEnd(5)} ${check.id.padEnd(16)} ${check.detail}`);
  }
  out(`doctor: ${checks.length - failures.length - warnings.length} pass, ${warnings.length} warn, ${failures.length} fail — ${code === EXIT.OK ? "healthy" : "needs attention"}`);
  return code;
}

function route(flags, positionals) {
  const command = positionals.shift();
  if (flags.version) {
    out(`dezign0 ${getVersion()}`);
    return EXIT.OK;
  }
  if (!command) {
    out(HELP);
    return EXIT.OK;
  }
  if (!COMMANDS.includes(command)) throw new CliError(`unknown command: ${command} (run dezign0 --help)`);
  if (flags.help) {
    commandHelp(command);
    return EXIT.OK;
  }
  switch (command) {
    case "lint":
      return commandLint(flags, positionals);
    case "measure":
      return commandMeasure(flags, positionals);
    case "audit":
      return commandAudit(flags, positionals);
    case "doctor":
      return commandDoctor(flags);
    case "systems":
      return commandSystems(flags, positionals);
    case "addons":
      return commandAddons(flags, positionals);
    case "new":
      return commandNew(flags, positionals);
    case "export":
      return commandExport(flags, positionals);
    default:
      throw new CliError(`unknown command: ${command}`);
  }
}

function main(argv) {
  const wantsJson = argv.includes("--json");
  try {
    const { flags, positionals } = parseArgs(argv);
    if (flags.version) {
      out(`dezign0 ${getVersion()}`);
      return EXIT.OK;
    }
    if (flags.help && !positionals.length) {
      out(HELP);
      return EXIT.OK;
    }
    return route(flags, positionals);
  } catch (error) {
    const code = error instanceof CliError ? error.code : EXIT.USAGE;
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson) {
      emitJson({ schema: "dezign0/cli/v1", command: null, ok: false, exitCode: code, error: message, ...(error instanceof CliError ? error.extra : {}) });
    } else {
      warn(message);
    }
    return code;
  }
}

process.exitCode = main(process.argv.slice(2));
