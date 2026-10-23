#!/usr/bin/env node
/**
 * check-docs — fail CI when capability counts, tool names or versions drift.
 *
 * capabilities.json is the single source of truth. This script checks it
 * against the filesystem and against the public docs that state those facts
 * (README.md, SECURITY.md, docs/ARCHITECTURE.md and, when present,
 * docs/ADAPTERS*). It also guards the CLI, composite action and validate
 * workflow from being removed.
 *
 *   node scripts/check-docs.mjs [--json] [--quiet]
 *
 * Exit codes: 0 consistent, 1 drift, 2 unexpected read error.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const quiet = args.includes("--quiet");
const unknown = args.filter((arg) => !["--json", "--quiet", "--help", "-h"].includes(arg));
if (unknown.length) {
  console.error(`check-docs: unknown flag ${unknown[0]}`);
  process.exit(2);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: node scripts/check-docs.mjs [--json] [--quiet]");
  process.exit(0);
}

const checks = [];
const failures = [];
const warnings = [];

function check(id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail });
  if (!ok) failures.push(`${id}: ${detail}`);
}

function warnCheck(id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), warning: true, detail });
  if (!ok) warnings.push({ id, detail });
}

function readText(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function readJsonSafe(relative) {
  try {
    return JSON.parse(readText(relative));
  } catch {
    return null;
  }
}

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};
/**
 * Find "N <noun>" claims by looking back at most five whitespace-separated
 * tokens from each noun and taking the nearest integer or number word.
 * Dotted versions are ignored, so "0.7.1 pairs with five tools" is a five, and
 * "thirteen skills and five tools" yields 5 for tools, not 13.
 */
function countClaims(text, nounPattern) {
  const claims = [];
  const noun = new RegExp(nounPattern, "gi");
  let match;
  while ((match = noun.exec(text))) {
    const before = text.slice(0, match.index);
    const tokens = before.split(/\s+/).filter(Boolean);
    let value = null;
    for (let i = tokens.length - 1; i >= Math.max(0, tokens.length - 5); i -= 1) {
      const token = tokens[i].replace(/^[^\w]+/, "").replace(/[^\w]+$/, "");
      if (/^\d+$/.test(token)) {
        value = Number(token);
        break;
      }
      const word = token.toLowerCase();
      if (WORD_NUMBERS[word]) {
        value = WORD_NUMBERS[word];
        break;
      }
    }
    if (value !== null) {
      const context = before.trim().split(/\s+/).slice(-5).join(" ");
      claims.push({ value, text: `${context} ${match[0]}`.trim() });
    }
  }
  return claims;
}

function checkClaims(label, text, nounPattern, expected, { required = true, packageCheck = false } = {}) {
  const claims = countClaims(text, nounPattern);
  if (!claims.length) {
    check(`${label}-claim`, !required, required ? `no "${nounPattern}" count claim found` : "no claim to check");
  } else {
    const wrong = claims.filter((claim) => claim.value !== expected);
    check(`${label}-claim`, wrong.length === 0,
      wrong.length
        ? `expected ${expected}; found ${wrong.map((claim) => `${claim.value} (${claim.text})`).join("; ")}`
        : `${claims.length} claim(s) all equal ${expected}`);
  }
  if (packageCheck) {
    const special = [...text.matchAll(/\b(\d{2,4})-package\b/g)].map((entry) => Number(entry[1]));
    if (special.length) {
      const wrongPackage = special.filter((value) => value !== expected);
      check(`${label}-package`, wrongPackage.length === 0,
        wrongPackage.length ? `expected ${expected}; found ${wrongPackage.join(", ")} in "N-package"` : `N-package claims equal ${expected}`);
    }
  }
}

function toolNamesIn(text) {
  return [...new Set([...text.matchAll(/dezign0_[a-z_]+/g)].map((entry) => entry[0]))].filter((name) => !name.endsWith("__"));
}

let capabilities;
try {
  capabilities = JSON.parse(readText("capabilities.json"));
} catch (error) {
  console.error(`check-docs: cannot read capabilities.json: ${error.message}`);
  process.exit(2);
}

// ── 1. capabilities.json is internally consistent ──────────────────────────
check("schema", capabilities.schema === "dezign0/capabilities/v1", `schema ${capabilities.schema || "missing"}`);
check("skills-count", capabilities.skills?.count === capabilities.skills?.names?.length, `${capabilities.skills?.count} vs ${capabilities.skills?.names?.length} names`);
check("tools-count", capabilities.tools?.count === capabilities.tools?.names?.length, `${capabilities.tools?.count} vs ${capabilities.tools?.names?.length} names`);
check("adapters-count", capabilities.adapters?.count === capabilities.adapters?.ids?.length, `${capabilities.adapters?.count} vs ${capabilities.adapters?.ids?.length} ids`);
check("addons-count", capabilities.addons?.count === capabilities.addons?.ids?.length, `${capabilities.addons?.count} vs ${capabilities.addons?.ids?.length} ids`);
check("languages-count", Number.isInteger(capabilities.designLanguages?.count), `count ${capabilities.designLanguages?.count}`);
check("commands-count", capabilities.commands?.count === capabilities.commands?.names?.length, `${capabilities.commands?.count} vs ${capabilities.commands?.names?.length}`);
check("compatibility-core", capabilities.compatibility?.core === capabilities.version, `core ${capabilities.compatibility?.core} vs version ${capabilities.version}`);
check("compatibility-pack", capabilities.compatibility?.addonPack?.name === capabilities.designLanguages?.pack
  && capabilities.compatibility?.addonPack?.version === capabilities.designLanguages?.version,
`${capabilities.compatibility?.addonPack?.name}@${capabilities.compatibility?.addonPack?.version} vs ${capabilities.designLanguages?.pack}@${capabilities.designLanguages?.version}`);

// ── 2. Filesystem matches the manifest ─────────────────────────────────────
const pkg = readJsonSafe("package.json");
const kit = readJsonSafe("design-os/kit.json");
const pluginManifest = readJsonSafe(".claude-plugin/plugin.json");
const marketplace = readJsonSafe(".claude-plugin/marketplace.json");
check("package-version", pkg?.version === capabilities.version, `package.json ${pkg?.version} vs ${capabilities.version}`);
check("kit-version", kit?.version === capabilities.version, `kit.json ${kit?.version} vs ${capabilities.version}`);
if (pluginManifest) check("plugin-version", pluginManifest.version === capabilities.version, `.claude-plugin/plugin.json ${pluginManifest.version}`);
if (marketplace) check("marketplace-version", marketplace.plugins?.[0]?.version === capabilities.version, `marketplace ${marketplace.plugins?.[0]?.version}`);

// Packaging is owned by package.json; surface gaps without blocking CI here.
const pkgFiles = Array.isArray(pkg?.files) ? pkg.files : [];
warnCheck("package-bin", pkg?.bin?.dezign0 !== undefined, pkg?.bin?.dezign0 ? "package.json maps the dezign0 bin" : "package.json has no bin entry; add {\"dezign0\":\"./bin/dezign0.mjs\"}");
warnCheck("package-files-bin", pkgFiles.includes("bin/"), pkgFiles.includes("bin/") ? "package files include bin/" : "package.json files must include bin/ so npm ships the CLI");
warnCheck("package-files-capabilities", pkgFiles.includes("capabilities.json"), pkgFiles.includes("capabilities.json") ? "package files include capabilities.json" : "package.json files must include capabilities.json for the CLI manifest");

const skillsDir = path.join(ROOT, "design-os", "skills");
const installedSkills = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir).filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md"))).sort()
  : [];
const expectedSkills = [...(capabilities.skills?.names || [])].sort();
check("skills-files", installedSkills.length === capabilities.skills?.count && JSON.stringify(installedSkills) === JSON.stringify(expectedSkills),
  installedSkills.length !== capabilities.skills?.count
    ? `${installedSkills.length} installed vs ${capabilities.skills?.count} expected`
    : `all ${installedSkills.length} names match`);

const adaptersDir = path.join(ROOT, "design-os", "adapters");
const adapterIds = fs.existsSync(adaptersDir)
  ? fs.readdirSync(adaptersDir).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, "")).sort()
  : [];
const expectedAdapters = [...(capabilities.adapters?.ids || [])].sort();
check("adapters-files", adapterIds.length === capabilities.adapters?.count && JSON.stringify(adapterIds) === JSON.stringify(expectedAdapters),
  `${adapterIds.length} files vs ${capabilities.adapters?.count} expected; extra: ${adapterIds.filter((id) => !expectedAdapters.includes(id)).join(", ") || "none"}`);

const toolScripts = ["design-lint.mjs", "measure-artifact.mjs"];
const missingTools = toolScripts.filter((name) => !fs.existsSync(path.join(ROOT, "design-os", "tools", name)));
check("tool-scripts", missingTools.length === 0, missingTools.length ? `missing ${missingTools.join(", ")}` : "lint and measure present");

const pluginSourcePath = path.join(ROOT, "plugin", "index.js");
const pluginSource = fs.existsSync(pluginSourcePath) ? fs.readFileSync(pluginSourcePath, "utf8") : "";
const pluginTools = [...new Set([...pluginSource.matchAll(/name:\s*"(dezign0_[a-z_]+)"/g)].map((entry) => entry[1]))].sort();
const expectedTools = [...(capabilities.tools?.names || [])].sort();
check("plugin-tools", JSON.stringify(pluginTools) === JSON.stringify(expectedTools),
  `plugin exposes [${pluginTools.join(", ")}] vs [${expectedTools.join(", ")}]`);

const addonsIndex = readJsonSafe("design-languages/addons/index.json");
const addonIds = (addonsIndex?.items || []).map((item) => item.id).sort();
const expectedAddons = [...(capabilities.addons?.ids || [])].sort();
check("addons-files", (addonsIndex?.count === capabilities.addons?.count) && JSON.stringify(addonIds) === JSON.stringify(expectedAddons),
  `index count ${addonsIndex?.count} vs ${capabilities.addons?.count}; ids ${addonIds.length} vs ${expectedAddons.length}`);

const languagesIndex = readJsonSafe("design-languages/index.json");
const packPackage = readJsonSafe("design-languages/package.json");
check("languages-files", languagesIndex?.count === capabilities.designLanguages?.count && languagesIndex?.items?.length === capabilities.designLanguages?.count,
  `index ${languagesIndex?.count}/${languagesIndex?.items?.length} vs ${capabilities.designLanguages?.count}`);
check("pack-version", packPackage?.version === capabilities.designLanguages?.version, `pack package.json ${packPackage?.version} vs ${capabilities.designLanguages?.version}`);
check("addon-pack-version", addonsIndex?.version === capabilities.designLanguages?.version, `addons index ${addonsIndex?.version} vs ${capabilities.designLanguages?.version}`);

// ── 3. Public docs match the manifest ──────────────────────────────────────
const readme = readText("README.md");
checkClaims("readme-skills", readme, "skills?", capabilities.skills.count);
checkClaims("readme-tools", readme, "tools?", capabilities.tools.count);
checkClaims("readme-languages", readme, "design[ -]languages?|design systems?|catalog systems?", capabilities.designLanguages.count, { packageCheck: true });
checkClaims("readme-adapters", readme, "adapters?|targets?", capabilities.adapters.count);

const readmeToolNames = toolNamesIn(readme);
const missingReadmeTools = expectedTools.filter((name) => !readmeToolNames.includes(name));
const unknownReadmeTools = readmeToolNames.filter((name) => !expectedTools.includes(name));
check("readme-tool-names", missingReadmeTools.length === 0 && unknownReadmeTools.length === 0,
  `missing [${missingReadmeTools.join(", ")}], unknown [${unknownReadmeTools.join(", ")}]`);
const readmeHasCore = new RegExp(`\\b${capabilities.version.replace(/\./g, "\\.")}\\b`).test(readme);
check("readme-version", readmeHasCore, readmeHasCore ? `README names core ${capabilities.version}` : `README does not name core ${capabilities.version}`);
const readmeHasPack = new RegExp(`\\b${capabilities.designLanguages.version.replace(/\./g, "\\.")}\\b`).test(readme);
check("readme-pack-version", readmeHasPack, readmeHasPack ? `README names addon pack ${capabilities.designLanguages.version}` : `README does not name addon pack ${capabilities.designLanguages.version}`);

const security = readText("SECURITY.md");
checkClaims("security-skills", security, "skills?", capabilities.skills.count);
checkClaims("security-tools", security, "tools?", capabilities.tools.count, { required: false });
const securityToolNames = toolNamesIn(security);
const missingSecurityTools = expectedTools.filter((name) => !securityToolNames.includes(name));
const unknownSecurityTools = securityToolNames.filter((name) => !expectedTools.includes(name));
check("security-tool-names", missingSecurityTools.length === 0 && unknownSecurityTools.length === 0,
  `missing [${missingSecurityTools.join(", ")}], unknown [${unknownSecurityTools.join(", ")}]`);

const architecture = readText("docs/ARCHITECTURE.md");
checkClaims("architecture-languages", architecture, "design[ -]languages?|design systems?|catalog systems?", capabilities.designLanguages.count);
const architectureToolNames = toolNamesIn(architecture);
if (architectureToolNames.length) {
  const unknownArchitectureTools = architectureToolNames.filter((name) => !expectedTools.includes(name));
  check("architecture-tool-names", unknownArchitectureTools.length === 0, `unknown [${unknownArchitectureTools.join(", ")}]`);
}

const optionalAdapterDocs = ["docs/ADAPTERS.md", "docs/ADAPTERS/README.md", "docs/ADAPTERS/ARCHITECTURE.md"]
  .filter((relative) => fs.existsSync(path.join(ROOT, relative)));
for (const relative of optionalAdapterDocs) {
  const text = readText(relative);
  checkClaims(`${relative}-adapters`, text, "adapters?|targets?", capabilities.adapters.count);
}

// ── 4. CLI, action and workflow gates stay wired ───────────────────────────
const cliPath = path.join(ROOT, "bin", "dezign0.mjs");
const cliExists = fs.existsSync(cliPath);
check("cli-file", cliExists, cliExists ? "bin/dezign0.mjs present" : "bin/dezign0.mjs is missing");
if (cliExists) {
  const firstLine = fs.readFileSync(cliPath, "utf8").split("\n")[0];
  check("cli-shebang", firstLine.startsWith("#!/usr/bin/env node"), firstLine.startsWith("#!/usr/bin/env node") ? "node shebang present" : "bin/dezign0.mjs needs a node shebang");
  const help = spawnSync(process.execPath, [cliPath, "--help"], { cwd: ROOT, encoding: "utf8" });
  check("cli-help", help.status === 0, help.status === 0 ? "--help exits 0" : `--help exited ${help.status}: ${(help.stderr || "").trim().slice(0, 200)}`);
  const missingCommands = (capabilities.commands?.names || []).filter((name) => !(help.stdout || "").includes(name));
  check("cli-commands", missingCommands.length === 0, missingCommands.length ? `help is missing [${missingCommands.join(", ")}]` : `all ${capabilities.commands?.names?.length} commands listed`);
}

const actionPath = path.join(ROOT, ".github", "actions", "dezign0-review", "action.yml");
const actionExists = fs.existsSync(actionPath);
check("action-file", actionExists, actionExists ? "action.yml present" : ".github/actions/dezign0-review/action.yml is missing");
if (actionExists) {
  const action = fs.readFileSync(actionPath, "utf8");
  const summarySource = fs.existsSync(path.join(ROOT, ".github", "actions", "dezign0-review", "summary.mjs"))
    ? fs.readFileSync(path.join(ROOT, ".github", "actions", "dezign0-review", "summary.mjs"), "utf8")
    : "";
  for (const token of ["dezign0 lint", "1440x900", "390x844", "145x188", "--a11y", "upload-artifact", "GITHUB_STEP_SUMMARY", "comment-body"]) {
    const found = token === "GITHUB_STEP_SUMMARY" ? `${action}\n${summarySource}`.includes(token) : action.includes(token);
    check(`action-${token.replace(/[^a-z0-9]+/gi, "-")}`, found, found ? `mentions "${token}"` : `action.yml is missing "${token}"`);
  }
  const uses = [...action.matchAll(/uses:\s*([^\s#]+)/g)].map((entry) => entry[1]);
  const allowedActions = uses.every((ref) => /^actions\/(setup-node|upload-artifact)@/.test(ref));
  check("action-uses", allowedActions, allowedActions ? `allowed actions only: ${uses.join(", ")}` : `only setup-node/upload-artifact allowed, found [${uses.join(", ")}]`);
}
const summaryExists = fs.existsSync(path.join(ROOT, ".github", "actions", "dezign0-review", "summary.mjs"));
check("action-summary", summaryExists, summaryExists ? "summary.mjs present" : "summary.mjs is missing");

const validatePath = path.join(ROOT, ".github", "workflows", "validate.yml");
const validate = fs.existsSync(validatePath) ? fs.readFileSync(validatePath, "utf8") : "";
check("validate-check-docs", validate.includes("scripts/check-docs.mjs"), validate.includes("scripts/check-docs.mjs") ? "validate.yml runs check-docs" : "validate.yml does not run scripts/check-docs.mjs");
check("validate-cli-smoke", validate.includes("bin/dezign0.test.mjs"), validate.includes("bin/dezign0.test.mjs") ? "validate.yml runs the CLI smoke test" : "validate.yml does not run bin/dezign0.test.mjs");

// ── 5. Report ──────────────────────────────────────────────────────────────
const failed = checks.filter((entry) => !entry.ok && !entry.warning);
if (json) {
  console.log(JSON.stringify({
    schema: "dezign0/check-docs/v1",
    ok: failed.length === 0,
    version: capabilities.version,
    checks: checks.length,
    failures: failed.map((entry) => ({ id: entry.id, detail: entry.detail })),
    warnings: warnings.map((entry) => ({ id: entry.id.split(":")[0], detail: entry.detail })),
  }, null, 2));
} else {
  if (!quiet) {
    for (const entry of checks) {
      const state = entry.ok ? "PASS" : entry.warning ? "WARN" : "FAIL";
      console.log(`${state} ${entry.id.padEnd(24)} ${entry.detail}`);
    }
  }
  for (const entry of failed) console.error(`check-docs: ${entry.id}: ${entry.detail}`);
  for (const entry of warnings) console.error(`check-docs: warning: ${entry.id}: ${entry.detail}`);
  console.log(`check-docs: ${checks.length - failed.length - warnings.length}/${checks.length} checks passed${failed.length ? ` — ${failed.length} failure(s)` : ""}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
}
process.exit(failed.length ? 1 : 0);
