#!/usr/bin/env node
/**
 * ds-validate — validate a design-system package before it is published or used.
 *
 * Checks:
 *   structure    manifest.json + DESIGN.md + tokens.css present; optional files
 *   manifest     schemaVersion, id matches the folder, files map resolves,
 *                preview pages exist, sourceFiles/evidence exist
 *   tokens       tokens.css parses, design-tokens.json and components.manifest.json
 *                stay in sync with the declared tokens, no conflicting declarations
 *   components   components.html exists and covers the interaction states
 *   preview      preview directory with at least one page
 *   licensing    a LICENSE and a NOTICE/ATTRIBUTION file reachable from the pack
 *
 * Usage:
 *   node ds-validate.mjs <pack-dir> [options]
 *
 *   --json             machine-readable findings
 *   --strict           fail on P1 as well as P0
 *   --quiet            summary only
 *   --id=<id>          expected manifest id (default: folder name)
 *   --pack-root=<dir>  where to look for LICENSE/NOTICE (default: walk up 3 levels)
 *   --help             show this help
 *
 * Exit codes: 0 valid, 1 P0 (or P1 with --strict), 2 unusable path/usage error.
 *
 * A pack is the OpenDesign/Dezign0 design-system shape:
 *   manifest.json, DESIGN.md, tokens.css, design-tokens.json, components.html,
 *   components.manifest.json, tailwind-v4.css, USAGE.md, preview/, source/
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTokenFile, normalizeTokenValue } from './token-export.mjs';

const TOOL = 'ds-validate';
const REQUIRED = ['manifest.json', 'DESIGN.md', 'tokens.css'];
const P1_FILES = ['design-tokens.json', 'components.html'];
const P2_FILES = ['USAGE.md', 'components.manifest.json', 'tailwind-v4.css'];

const STATES = [
  ['default', null],
  ['hover', /:hover\b/],
  ['focus', /:focus-visible\b|:focus\b/],
  ['disabled', /:disabled\b|\[disabled\]|aria-disabled/],
  ['loading', /aria-busy|is-loading|loading-/],
  ['empty', /empty-state|is-empty|class="[^"]*\bempty\b/],
  ['error', /aria-invalid|\.error\b|is-error|error-/],
  ['selected', /aria-selected|aria-pressed|\.selected\b|is-selected/],
];

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function listHtml(dir) {
  if (!isDirectory(dir)) return [];
  return fs.readdirSync(dir).filter((entry) => /\.html?$/i.test(entry));
}

function findUp(start, names, levels = 3) {
  let current = path.resolve(start);
  const root = path.parse(current).root;
  for (let depth = 0; depth <= levels; depth += 1) {
    for (const name of names) {
      const candidate = path.join(current, name);
      if (fs.existsSync(candidate)) return { file: candidate, dir: current };
    }
    if (current === root) break;
    current = path.dirname(current);
  }
  return null;
}

function count(findings) {
  return {
    P0: findings.filter((finding) => finding.severity === 'P0').length,
    P1: findings.filter((finding) => finding.severity === 'P1').length,
    P2: findings.filter((finding) => finding.severity === 'P2').length,
  };
}

/** Validate one pack. Exported for tests. */
export function validatePack(options) {
  const packDir = path.resolve(options.packDir);
  const findings = [];
  const push = (severity, id, file, line, message, fix) => {
    findings.push({ severity, id, file: file || packDir, line: line || 1, message, fix });
  };
  const result = {
    ok: true,
    packDir,
    id: null,
    findings,
    counts: { P0: 0, P1: 0, P2: 0 },
    exitCode: 0,
    tokens: { light: 0, dark: 0 },
    states: { present: [], missing: [] },
  };

  if (!isDirectory(packDir)) {
    push('P0', 'not-a-directory', packDir, 1, `${packDir} is not a directory.`, 'Pass the design-system package directory.');
    result.counts = count(findings);
    result.exitCode = 2;
    return result;
  }

  /* 1. Required and optional files. */
  for (const name of REQUIRED) {
    if (!fs.existsSync(path.join(packDir, name))) {
      push('P0', 'missing-required-file', path.join(packDir, name), 1, `Missing required file ${name}.`, 'Every pack needs manifest.json, DESIGN.md and tokens.css.');
    }
  }
  for (const name of P1_FILES) {
    if (!fs.existsSync(path.join(packDir, name))) {
      push('P1', 'missing-file', path.join(packDir, name), 1, `Missing ${name}.`, 'Add the file, or stop advertising it in manifest.json.');
    }
  }
  for (const name of P2_FILES) {
    if (!fs.existsSync(path.join(packDir, name))) {
      push('P2', 'missing-optional-file', path.join(packDir, name), 1, `Missing optional ${name}.`, 'Add it when the package is shared beyond this repository.');
    }
  }

  /* 2. Manifest. */
  let manifest = null;
  const manifestPath = path.join(packDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = readJson(manifestPath);
    } catch (error) {
      push('P0', 'invalid-manifest', manifestPath, 1, `manifest.json is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
    }
  }
  if (manifest) {
    if (typeof manifest.id !== 'string' || !manifest.id) {
      push('P1', 'manifest-field', manifestPath, 1, 'manifest.id is missing.', 'Set a kebab-case id that matches the package folder.');
    } else {
      result.id = manifest.id;
      if (!/^[a-z0-9-]+$/.test(manifest.id)) {
        push('P1', 'manifest-id', manifestPath, 1, `manifest.id "${manifest.id}" is not kebab-case.`, 'Use lowercase letters, digits and hyphens.');
      }
      const expected = options.id || path.basename(packDir);
      if (manifest.id !== expected) {
        push('P1', 'manifest-id-mismatch', manifestPath, 1, `manifest.id "${manifest.id}" does not match "${expected}".`, 'Align the id with the folder name, or pass --id=<id> if the rename is intentional.');
      }
    }
    if (typeof manifest.schemaVersion !== 'string' || !manifest.schemaVersion) {
      push('P1', 'manifest-field', manifestPath, 1, 'manifest.schemaVersion is missing.', 'Declare the package schema version, for example "od-design-system-project/v1".');
    }
    if (typeof manifest.name !== 'string' || !manifest.name) {
      push('P2', 'manifest-field', manifestPath, 1, 'manifest.name is missing.', 'Add a display name.');
    }

    if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
      push('P0', 'manifest-files', manifestPath, 1, 'manifest.files is missing or not an object.', 'List the package files the consumer should read.');
    } else {
      for (const [role, rel] of Object.entries(manifest.files)) {
        if (typeof rel !== 'string' || !rel) {
          push('P1', 'manifest-files', manifestPath, 1, `manifest.files.${role} is not a path string.`, 'Use a relative path.');
          continue;
        }
        const resolved = path.resolve(packDir, rel);
        if (!resolved.startsWith(packDir + path.sep)) {
          push('P0', 'path-escape', manifestPath, 1, `manifest.files.${role} escapes the package: ${rel}.`, 'Keep every referenced file inside the package.');
          continue;
        }
        if (!fs.existsSync(resolved)) {
          push('P0', 'manifest-file-missing', resolved, 1, `manifest.files.${role} points at a missing file: ${rel}.`, 'Ship the file or remove the reference.');
        }
      }
    }

    const preview = manifest.preview;
    if (preview && typeof preview === 'object') {
      const previewDir = path.resolve(packDir, preview.dir || 'preview');
      if (!isDirectory(previewDir)) {
        push('P1', 'missing-preview', previewDir, 1, `Preview directory "${preview.dir || 'preview'}" does not exist.`, 'Add preview pages or remove the preview block.');
      } else if (!listHtml(previewDir).length) {
        push('P1', 'empty-preview', previewDir, 1, 'Preview directory has no HTML pages.', 'Add at least one preview page (colours, typography or spacing).');
      }
      if (Array.isArray(preview.pages)) {
        if (!preview.pages.length) {
          push('P2', 'preview-pages', previewDir, 1, 'manifest.preview.pages is empty.', 'List the preview page paths and roles.');
        }
        for (const page of preview.pages) {
          if (!page || typeof page.path !== 'string') {
            push('P2', 'preview-page', previewDir, 1, 'A preview page has no path.', 'Each page needs { path, role, title }.');
            continue;
          }
          const file = path.resolve(packDir, page.path);
          if (!fs.existsSync(file)) {
            push('P1', 'preview-page-missing', file, 1, `Preview page missing: ${page.path}.`, 'Ship the page or remove it from manifest.preview.pages.');
          }
          if (!page.role) push('P2', 'preview-page', file, 1, `Preview page ${page.path} has no role.`, 'Add a role such as colors, typography or spacing.');
        }
      }
    } else {
      push('P2', 'missing-preview', manifestPath, 1, 'manifest.preview is missing.', 'Document at least one visual preview page.');
    }

    if (manifest.componentsManifest && !fs.existsSync(path.resolve(packDir, manifest.componentsManifest))) {
      push('P1', 'manifest-file-missing', path.resolve(packDir, manifest.componentsManifest), 1, `manifest.componentsManifest is missing: ${manifest.componentsManifest}.`, 'Ship the components manifest or remove the reference.');
    }
    if (manifest.usage && !fs.existsSync(path.resolve(packDir, manifest.usage))) {
      push('P2', 'manifest-file-missing', path.resolve(packDir, manifest.usage), 1, `manifest.usage is missing: ${manifest.usage}.`, 'Add usage notes for the consumer.');
    }
    if (manifest.sourceFiles && typeof manifest.sourceFiles === 'object') {
      for (const [role, rel] of Object.entries(manifest.sourceFiles)) {
        if (typeof rel !== 'string' || !fs.existsSync(path.resolve(packDir, rel))) {
          push('P2', 'missing-source-evidence', packDir, 1, `manifest.sourceFiles.${role} is missing: ${rel}.`, 'Keep token evidence with the package, or drop the reference.');
        }
      }
    }
  }

  /* 3. Tokens and coverage. */
  const tokensCss = path.join(packDir, 'tokens.css');
  let cssTokens = new Map();
  let darkTokens = new Map();
  if (fs.existsSync(tokensCss)) {
    try {
      const parsed = parseTokenFile(tokensCss);
      for (const error of parsed.errors) {
        push('P0', 'bad-token-source', tokensCss, error.line, error.message, 'Fix the CSS so every block is balanced.');
      }
      for (const token of parsed.tokens) {
        if (token.mode === 'reduced') continue;
        const target = token.mode === 'dark' ? darkTokens : cssTokens;
        const existing = target.get(token.name);
        if (existing && normalizeTokenValue(existing.value) !== normalizeTokenValue(token.value)) {
          push('P1', 'conflicting-token', tokensCss, token.line, `${token.name} is declared twice with different values (${existing.value} vs ${token.value}).`, 'Keep one declaration; move mode-specific values into a dark selector.');
          continue;
        }
        if (!existing) target.set(token.name, token);
      }
      result.tokens = { light: cssTokens.size, dark: darkTokens.size };
      if (!cssTokens.size) {
        push('P0', 'no-tokens', tokensCss, 1, 'tokens.css declares no custom properties.', 'Declare a :root token block.');
      } else if (cssTokens.size < 8) {
        push('P2', 'small-token-set', tokensCss, 1, `Only ${cssTokens.size} tokens declared.`, 'A usable system usually declares colour, type, space, radius and motion roles.');
      }
      for (const family of [['colour', /^--(bg|background|fg|foreground|accent|border)/], ['type', /^--(font|text|leading|tracking)/], ['space', /^--(space|spacing|gap)/], ['radius', /^--radius/]]) {
        if (![...cssTokens.keys()].some((name) => family[1].test(name))) {
          push('P2', 'missing-slot', tokensCss, 1, `No ${family[0]} tokens found.`, `Add ${family[0]} roles so artifacts can stay token-driven.`);
        }
      }
    } catch (error) {
      push('P0', 'bad-token-source', tokensCss, 1, `Cannot read tokens.css: ${error.message}`, 'Fix the file encoding or permissions.');
    }
  }

  const designTokensPath = path.join(packDir, 'design-tokens.json');
  if (fs.existsSync(designTokensPath)) {
    try {
      const parsed = parseTokenFile(designTokensPath);
      const jsonNames = new Set(parsed.tokens.map((token) => token.name));
      const declared = [...cssTokens.keys()];
      if (!jsonNames.size) {
        push('P1', 'token-json-stale', designTokensPath, 1, 'design-tokens.json contains no tokens.', 'Regenerate it from tokens.css.');
      }
      const uncovered = declared.filter((name) => !jsonNames.has(name));
      const stale = [...jsonNames].filter((name) => !cssTokens.has(name));
      if (uncovered.length) {
        push('P2', 'uncovered-token', designTokensPath, 1, `${uncovered.length} token(s) in tokens.css are not covered by design-tokens.json: ${uncovered.slice(0, 6).join(', ')}${uncovered.length > 6 ? '…' : ''}.`, 'Regenerate design-tokens.json so the machine-readable inventory is complete.');
      }
      if (stale.length) {
        push('P1', 'token-json-stale', designTokensPath, 1, `${stale.length} token(s) in design-tokens.json are not declared in tokens.css: ${stale.slice(0, 6).join(', ')}${stale.length > 6 ? '…' : ''}.`, 'Regenerate the JSON; stale entries mislead consumers.');
      }
    } catch (error) {
      push('P1', 'token-json-stale', designTokensPath, 1, `design-tokens.json is unreadable: ${error.message}`, 'Regenerate or fix the file.');
    }
  }

  const componentsManifestPath = path.join(packDir, 'components.manifest.json');
  if (fs.existsSync(componentsManifestPath)) {
    try {
      const componentsManifest = readJson(componentsManifestPath);
      const declared = componentsManifest?.tokens?.declared;
      if (Array.isArray(declared) && declared.length && cssTokens.size) {
        const missing = declared.filter((name) => !cssTokens.has(name));
        if (missing.length) {
          push('P2', 'unreferenced-token', componentsManifestPath, 1, `components.manifest.json lists ${missing.length} token(s) not declared in tokens.css: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}.`, 'Regenerate the components fixture from the current tokens.');
        }
      }
      const selectorCount = componentsManifest?.fixture?.selectorCount;
      if (typeof selectorCount === 'number' && selectorCount < 5) {
        push('P2', 'thin-components', componentsManifestPath, 1, `Only ${selectorCount} selectors in the components fixture.`, 'Cover the component states the package claims to support.');
      }
    } catch (error) {
      push('P2', 'components-manifest', componentsManifestPath, 1, `components.manifest.json is unreadable: ${error.message}`, 'Fix the JSON syntax.');
    }
  }

  /* 4. Component states. */
  const componentsPath = path.join(packDir, 'components.html');
  if (fs.existsSync(componentsPath)) {
    const html = fs.readFileSync(componentsPath, 'utf8');
    if (!/<style\b/i.test(html) && !/class=/i.test(html)) {
      push('P1', 'components-shape', componentsPath, 1, 'components.html has no styles or classes.', 'A components fixture needs real markup and CSS.');
    }
    const present = [];
    const missing = [];
    for (const [state, pattern] of STATES) {
      if (!pattern) { present.push(state); continue; }
      if (pattern.test(html)) present.push(state);
      else missing.push(state);
    }
    result.states = { present, missing };
    for (const state of missing) {
      push('P2', 'state-missing', componentsPath, 1, `No ${state} state found in components.html.`, `Add a ${state} example to the components fixture.`);
    }
    if (present.length < 3) {
      push('P1', 'sparse-component-states', componentsPath, 1, `Only ${present.length} component state(s) appear in components.html.`, 'Cover at least default, hover, focus, disabled and error before calling the package complete.');
    }
  }

  /* 5. Preview presence. */
  const previewDir = path.join(packDir, 'preview');
  if (!isDirectory(previewDir)) {
    if (fs.existsSync(previewDir)) {
      push('P1', 'missing-preview', previewDir, 1, 'preview exists but is not a directory.', 'Replace it with a directory of preview pages.');
    }
  } else if (!listHtml(previewDir).length) {
    push('P1', 'empty-preview', previewDir, 1, 'preview/ has no HTML pages.', 'Add at least one preview page.');
  }

  /* 6. Licensing. */
  const packRoot = options.packRoot ? path.resolve(options.packRoot) : null;
  const license = packRoot
    ? ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((name) => path.join(packRoot, name)).find((file) => fs.existsSync(file)) || null
    : findUp(packDir, ['LICENSE', 'LICENSE.md', 'LICENSE.txt'])?.file || null;
  if (!license) {
    push('P1', 'missing-license', packDir, 1, 'No LICENSE file found in the pack or its parent directories (3 levels).', 'Ship the licence the package is distributed under, or pass --pack-root.');
  }
  const notice = packRoot
    ? ['NOTICE', 'NOTICE.md', 'ATTRIBUTION.md', 'ATTRIBUTION'].map((name) => path.join(packRoot, name)).find((file) => fs.existsSync(file)) || null
    : findUp(packDir, ['NOTICE', 'NOTICE.md', 'ATTRIBUTION.md', 'ATTRIBUTION'])?.file || null;
  if (!notice) {
    push('P2', 'missing-notice', packDir, 1, 'No NOTICE/ATTRIBUTION file found near the pack.', 'Attribute upstream sources when the package derives from another project.');
  }

  result.manifest = manifest;
  result.counts = count(findings);
  result.exitCode = result.counts.P0 > 0 || (options.strict && result.counts.P1 > 0) ? 1 : 0;
  result.ok = result.exitCode === 0;
  return result;
}

/* ────────────────────────────────── CLI ──────────────────────────────────── */

function usage() {
  console.log(`ds-validate — design-system package validation

Usage:
  node ds-validate.mjs <pack-dir> [options]

  --json             machine-readable findings
  --strict           fail on P1 as well as P0
  --quiet            summary only
  --id=<id>          expected manifest id (default: folder name)
  --pack-root=<dir>  where to look for LICENSE/NOTICE
  --help             show this help

Checks: required files, manifest fields and file references, tokens.css structure,
design-tokens.json / components.manifest.json coverage, component states, preview
pages, and licence/notice presence.
Exit codes: 0 valid, 1 problems (P1 only with --strict), 2 unusable path/usage error.`);
}

function parseArgs(argv) {
  const options = { packDir: null, json: false, strict: false, quiet: false, id: null, packRoot: null, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--quiet') { options.quiet = true; continue; }
    if (!arg.startsWith('--')) {
      if (options.packDir) throw new Error(`unexpected argument: ${arg}`);
      options.packDir = arg;
      continue;
    }
    const match = /^--([a-z-]+)=([\s\S]+)$/.exec(arg);
    if (!match) throw new Error(`unexpected argument: ${arg}`);
    if (match[1] === 'id') options.id = match[2];
    else if (match[1] === 'pack-root') options.packRoot = match[2];
    else throw new Error(`unknown option: --${match[1]}`);
  }
  if (options.help) return options;
  if (!options.packDir) throw new Error('no pack directory');
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`);
    console.error('Run with --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) { usage(); return; }

  const result = validatePack(options);
  const rel = (file) => path.relative(process.cwd(), file) || file;
  if (options.json) {
    console.log(JSON.stringify({
      ok: result.ok,
      id: result.id,
      pack: rel(result.packDir),
      counts: result.counts,
      tokens: result.tokens,
      states: result.states,
      findings: result.findings.map((finding) => ({ ...finding, file: rel(finding.file) })),
    }, null, 2));
  } else if (!options.quiet) {
    for (const finding of result.findings) {
      console.log(`${finding.severity}  ${finding.id}  ${rel(finding.file)}:${finding.line}`);
      console.log(`     ${finding.message}`);
      console.log(`     fix: ${finding.fix}`);
    }
    if (!result.findings.length) console.log('ds-validate: no findings');
    console.log('');
  }
  if (!options.json) {
    console.log(
      `ds-validate: ${result.id || path.basename(result.packDir)} — ${result.counts.P0} P0, ${result.counts.P1} P1, ${result.counts.P2} P2; ` +
      `${result.tokens.light} tokens${result.tokens.dark ? ` (${result.tokens.dark} dark)` : ''}`,
    );
  }
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath && invokedPath.toLowerCase() === import.meta.url.toLowerCase()) {
  main();
}
