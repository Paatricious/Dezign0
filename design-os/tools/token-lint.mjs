#!/usr/bin/env node
/**
 * token-lint — check a token set and the CSS/HTML that consumes it.
 *
 * Findings (P0 blocks, P1 is a hard finding under --strict, P2 advisory):
 *   P0  bad-token-source        unreadable/unbalanced source, no tokens found
 *   P1  conflicting-token       the same token declared twice with different values
 *   P1  hardcoded-color         a colour literal that no token declares
 *   P2  should-use-token        a literal that equals a declared token (use var())
 *   P1  hardcoded-type          px/em on font-size / letter-spacing / line-height / radius
 *   P2  px-literal              other px literal outside a token
 *   P1  off-scale-spacing       spacing literal off the declared grid
 *   P2  off-scale-spacing       on-grid value that is not a declared step
 *   P2  duplicate-value         two or more tokens share one value
 *   P1  missing-dark-pair       semantic colour token not overridden in dark mode
 *   P1  missing-dark-mode       --require-dark set but no dark tokens exist
 *   P2  dark-only-token         dark token with no light counterpart
 *   P1  non-text-contrast       focus/ring colour below 3:1 against the background
 *   P2  non-text-contrast       border/line/UI colour below 3:1 (often deliberate)
 *
 * Usage:
 *   node token-lint.mjs <file-or-pack-dir...> [options]
 *
 *   --json             machine-readable findings
 *   --strict           fail on P1 as well as P0
 *   --quiet            summary only
 *   --base=<px>        spacing grid base (default: smallest declared space token)
 *   --require-dark     fail when no dark-mode tokens exist
 *   --help             show this help
 *
 * A directory input reads tokens.css, design-tokens.json and DESIGN.md as token
 * sources, and components.html for literal/usage checks. Scans CSS and HTML
 * only; geometry properties (width/height/grid) are excluded from px checks on
 * purpose — a token cannot express responsive geometry.
 *
 * Exit codes: 0 clean (or P2 only), 1 P0 (or P1 with --strict), 2 read/usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseTokenFile,
  parseColor,
  colorToHex,
  contrastRatio,
  formatRatio,
  inferType,
  resolveValue,
  normalizeTokenValue,
} from './token-export.mjs';

const TOOL = 'token-lint';
const TOKEN_FILES = ['tokens.css', 'design-tokens.json', 'DESIGN.md'];
const USAGE_FILES = ['components.html', 'index.html'];
const SPACING_PROP_RE = /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/;
const TYPE_PROP_RE = /^(font-size|letter-spacing|line-height|border-radius)$/;
const GEOMETRY_PROP_RE = /^(width|height|min-width|max-width|min-height|max-height|grid-template-columns|grid-template-rows|flex-basis|transform|translate|rotate|scale)$/;
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)/g;
const DARK_SEMANTIC_RE = /^--(bg|background|surface|surface-warm|fg|fg-2|foreground|text|muted|meta|border|border-soft|line|accent|accent-on|primary|success|warn|warning|danger|destructive|error|info)(-|$)/;

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Load token sources and usage rules for a list of files/directories.
 * @returns {{byName:Map, dark:Map, rules:Array, files:string[], warnings:string[],
 *   errors:Array, conflicts:Array}}
 */
export function loadInputs(inputs) {
  const state = {
    byName: new Map(),
    dark: new Map(),
    rules: [],
    files: [],
    warnings: [],
    errors: [],
    conflicts: [],
  };

  function addTokens(parsed, file) {
    for (const token of parsed.tokens) {
      if (token.mode === 'reduced') continue;
      const target = token.mode === 'dark' ? state.dark : state.byName;
      const existing = target.get(token.name);
      if (existing) {
        if (normalizeTokenValue(existing.value) !== normalizeTokenValue(token.value)) {
          state.conflicts.push({ name: token.name, file, line: token.line, first: existing, second: token });
        }
        continue;
      }
      target.set(token.name, token);
    }
  }

  function read(file, { tokens = true, rules = false } = {}) {
    let parsed;
    try {
      parsed = parseTokenFile(file);
    } catch (error) {
      state.errors.push({ file, line: 1, message: error.message });
      return;
    }
    state.files.push(file);
    for (const error of parsed.errors) state.errors.push(error);
    if (tokens) addTokens(parsed, file);
    if (rules) state.rules.push(...parsed.rules);
  }

  for (const input of inputs) {
    if (!fs.existsSync(input)) {
      state.errors.push({ file: input, line: 1, message: 'no such file or directory' });
      continue;
    }
    if (isDirectory(input)) {
      for (const name of TOKEN_FILES) {
        const file = path.join(input, name);
        if (fs.existsSync(file)) read(file, { tokens: true, rules: name.endsWith('.css') });
      }
      for (const name of USAGE_FILES) {
        const file = path.join(input, name);
        if (fs.existsSync(file)) read(file, { tokens: false, rules: true });
      }
      continue;
    }
    // For an explicit file, load the sibling token sources first so an artifact
    // can be linted on its own inside a pack (components.html -> tokens.css).
    const dir = path.dirname(path.resolve(input));
    for (const name of TOKEN_FILES) {
      const sibling = path.join(dir, name);
      if (path.resolve(sibling) === path.resolve(input)) continue;
      if (fs.existsSync(sibling)) read(sibling, { tokens: true, rules: false });
    }
    const ext = path.extname(input).toLowerCase();
    if (ext === '.json' || ext === '.md' || ext === '.mdx') read(input, { tokens: true, rules: false });
    else read(input, { tokens: true, rules: true });
  }
  return state;
}

function lineOfRule(rule) {
  return rule.line || 1;
}

function snippet(rule) {
  return `${rule.property}: ${rule.value}`;
}

function pxValues(value) {
  return [...String(value).matchAll(/(-?\d*\.?\d+)px\b/g)].map((match) => Number(match[1]));
}

function spacingScale(byName) {
  const values = [];
  for (const [name, token] of byName) {
    const bare = name.replace(/^--/, '');
    if (!/^(space|spacing|gap|pad|padding|margin|inset|section-y|container-gutter)/.test(bare)) continue;
    const resolved = resolveValue(token.value, byName);
    const px = /^(-?\d*\.?\d+)(px|rem)$/.exec(resolved.value.trim());
    if (!px) continue;
    values.push(Number(px[1]) * (px[2] === 'rem' ? 16 : 1));
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function colorIndex(byName) {
  const byHex = new Map();
  for (const [name, token] of byName) {
    const resolved = resolveValue(token.value, byName);
    if (!resolved.resolved) continue;
    const color = parseColor(resolved.value);
    if (!color) continue;
    const hex = colorToHex(color);
    if (!byHex.has(hex)) byHex.set(hex, []);
    byHex.get(hex).push(name);
  }
  return byHex;
}

function colorOf(byName, names) {
  for (const name of names) {
    const token = byName.get(name);
    if (!token) continue;
    const resolved = resolveValue(token.value, byName);
    if (!resolved.resolved) continue;
    const color = parseColor(resolved.value);
    if (color) return { name, color };
  }
  return null;
}

/** Lint tokens + usage. Exported so tests can call it directly. */
export function lintTokens(options) {
  const loaded = loadInputs(options.inputs);
  const findings = [];
  const push = (severity, id, file, line, message, fix, extra = {}) => {
    findings.push({ severity, id, file, line, message, fix, ...extra });
  };

  for (const error of loaded.errors) {
    push('P0', 'bad-token-source', error.file, error.line, error.message, 'Fix the source file so it parses.');
  }
  for (const conflict of loaded.conflicts) {
    push(
      'P1',
      'conflicting-token',
      conflict.file,
      conflict.line,
      `${conflict.name} is declared twice with different values (${conflict.first.value} at ${path.basename(conflict.first.file)}:${conflict.first.line} vs ${conflict.second.value}).`,
      'Keep one declaration; move mode-specific values into a dark selector.',
    );
  }
  if (!loaded.byName.size) {
    push('P0', 'no-tokens', options.inputs.join(', '), 1, 'No CSS custom properties were found.', 'Point token-lint at tokens.css, design-tokens.json or DESIGN.md.');
    return { ok: false, findings, loaded, counts: count(findings), exitCode: 2 };
  }

  const byName = loaded.byName;
  const scale = spacingScale(byName);
  const base = options.base || (scale.length ? Math.min(...scale.filter((value) => value > 0)) || 4 : 4);
  const colors = colorIndex(byName);

  /* 1. Literals in usage rules. */
  for (const rule of loaded.rules) {
    if (!rule.property || rule.property.startsWith('--')) continue;
    const property = rule.property.toLowerCase();
    const value = rule.value;
    const hasVar = /var\(--/.test(value);

    for (const match of value.matchAll(COLOR_LITERAL_RE)) {
      const literal = match[0];
      const color = parseColor(literal);
      if (!color) continue;
      const hex = colorToHex(color);
      const names = colors.get(hex);
      if (names && names.length) {
        push(
          'P2',
          'should-use-token',
          rule.file,
          lineOfRule(rule),
          `${literal} equals the declared token ${names[0]}${names.length > 1 ? ` (also ${names.slice(1).join(', ')})` : ''}.`,
          `Use var(${names[0]}) so a token change reaches this rule.`,
          { snippet: snippet(rule) },
        );
      } else {
        push(
          'P1',
          'hardcoded-color',
          rule.file,
          lineOfRule(rule),
          `Colour ${literal} is not declared by any token.`,
          'Use a token (for example var(--danger)) or declare this colour in tokens.css.',
          { snippet: snippet(rule) },
        );
      }
    }

    if (hasVar) continue;

    if (TYPE_PROP_RE.test(property)) {
      if (/(\d*\.?\d+)(px|em|rem)\b/.test(value)) {
        push(
          'P1',
          'hardcoded-type',
          rule.file,
          lineOfRule(rule),
          `${property}: ${value} bypasses the type/radius scale.`,
          property === 'border-radius' ? 'Use var(--radius-*).' : 'Use var(--text-*), var(--leading-*), var(--tracking-*) or a radius token.',
          { snippet: snippet(rule) },
        );
      }
      continue;
    }

    if (SPACING_PROP_RE.test(property)) {
      const numbers = pxValues(value);
      for (const number of numbers) {
        if (!Number.isFinite(number) || number === 0 || number === 1) continue;
        if (scale.includes(number)) continue;
        const onGrid = number % base === 0;
        const nearest = scale.length
          ? scale.reduce((best, step) => (Math.abs(step - number) < Math.abs(best - number) ? step : best), scale[0])
          : null;
        push(
          onGrid ? 'P2' : 'P1',
          'off-scale-spacing',
          rule.file,
          lineOfRule(rule),
          onGrid
            ? `${property}: ${number}px is on the ${base}px grid but not a declared spacing step.`
            : `${property}: ${number}px is off the ${base}px grid and not a declared spacing step.`,
          `Use var(--space-*)${nearest !== null ? ` (nearest declared step: ${nearest}px)` : ''}.`,
          { snippet: snippet(rule) },
        );
      }
      continue;
    }

    if (GEOMETRY_PROP_RE.test(property)) continue;
    const numbers = pxValues(value);
    for (const number of numbers) {
      if (!Number.isFinite(number) || number === 0 || number === 1) continue;
      push(
        'P2',
        'px-literal',
        rule.file,
        lineOfRule(rule),
        `${property}: ${number}px is a literal outside the token layer.`,
        'Declare a size token if this value repeats, or leave a comment explaining why it is fixed.',
        { snippet: snippet(rule) },
      );
    }
  }

  /* 2. Duplicate values across tokens. */
  const seenValues = new Map();
  for (const [hex, names] of colors) {
    if (names.length < 2) continue;
    seenValues.set(hex, names);
  }
  let duplicatesReported = 0;
  for (const [hex, names] of [...seenValues.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (duplicatesReported >= 10) break;
    duplicatesReported += 1;
    push(
      'P2',
      'duplicate-value',
      loaded.files[0] || options.inputs[0],
      1,
      `${names.length} colour tokens share ${hex}: ${names.join(', ')}.`,
      'If the roles differ, alias one with var(--name) so the shared value is intentional; otherwise merge.',
    );
  }

  /* 3. Dark-mode coverage. */
  if (!loaded.dark.size) {
    if (options.requireDark) {
      push('P1', 'missing-dark-mode', loaded.files[0] || options.inputs[0], 1, 'No dark-mode tokens found.', 'Add a .dark / [data-theme="dark"] block or pass a source that has one.');
    }
  } else {
    for (const name of [...byName.keys()].sort()) {
      if (!DARK_SEMANTIC_RE.test(name)) continue;
      const token = byName.get(name);
      const resolved = resolveValue(token.value, byName);
      if (!parseColor(resolved.value)) continue;
      if (loaded.dark.has(name)) continue;
      push(
        'P1',
        'missing-dark-pair',
        token.file,
        token.line,
        `${name} has no dark-mode value.`,
        `Add ${name} to the dark selector, or alias it explicitly (for example ${name}: var(--other)).`,
      );
    }
    for (const [name, token] of [...loaded.dark.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (byName.has(name)) continue;
      push('P2', 'dark-only-token', token.file, token.line, `${name} exists only in dark mode.`, 'Declare a light value or document the token as dark-only.');
    }
  }

  /* 4. Non-text contrast. */
  const background = colorOf(byName, ['--bg', '--background']);
  const surface = colorOf(byName, ['--surface', '--card', '--surface-warm']);
  const backgrounds = [background, surface].filter(Boolean);
  if (backgrounds.length) {
    const checked = new Set();
    for (const [name, token] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const bare = name.replace(/^--/, '');
      const boundaryRole = /^(border|line|divider|ring|focus|outline|input|control|track)(-|$)/.test(bare) || bare === 'accent';
      if (!boundaryRole) continue;
      if (/-on$|-hover$|-active$/.test(bare)) continue;
      const resolved = resolveValue(token.value, byName);
      if (!resolved.resolved) continue;
      const color = parseColor(resolved.value);
      if (!color) continue;
      let best = null;
      for (const bg of backgrounds) {
        const ratio = contrastRatio(color, bg.color);
        if (ratio === null) continue;
        if (!best || ratio > best.ratio) best = { ratio, background: bg.name };
      }
      if (!best) continue;
      const key = `${name}|${best.background}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const focusRole = /focus|ring/.test(bare);
      const required = 3;
      if (best.ratio >= required) continue;
      push(
        focusRole ? 'P1' : 'P2',
        'non-text-contrast',
        token.file,
        token.line,
        `${name} on ${best.background}: ${formatRatio(best.ratio)} — below the 3:1 non-text floor.`,
        focusRole
          ? 'Focus indicators need 3:1 against the adjacent background; raise the value or add a dark outline.'
          : 'Borders may be deliberately subtle; if this edge identifies a control, raise it to 3:1.',
        { ratio: Number(best.ratio.toFixed(2)), required },
      );
    }
  }

  const counts = count(findings);
  const hasBlocking = counts.P0 > 0 || (options.strict && counts.P1 > 0);
  return {
    ok: true,
    findings,
    loaded,
    counts,
    exitCode: hasBlocking ? 1 : 0,
    meta: { tokens: byName.size, dark: loaded.dark.size, base, files: loaded.files.length },
  };
}

function count(findings) {
  return {
    P0: findings.filter((finding) => finding.severity === 'P0').length,
    P1: findings.filter((finding) => finding.severity === 'P1').length,
    P2: findings.filter((finding) => finding.severity === 'P2').length,
  };
}

/* ────────────────────────────────── CLI ──────────────────────────────────── */

function usage() {
  console.log(`token-lint — token-set and usage lint

Usage:
  node token-lint.mjs <file-or-pack-dir...> [options]

  --json             machine-readable findings
  --strict           fail on P1 as well as P0
  --quiet            summary only
  --base=<px>        spacing grid base (default: smallest declared space token)
  --require-dark     fail when no dark-mode tokens exist
  --help             show this help

Findings: hard-coded colours, literals that should use a token, hard-coded type,
off-scale spacing, duplicate values, missing dark-mode pairs, non-text contrast.
Exit codes: 0 clean or P2 only, 1 P0 (or P1 with --strict), 2 read/usage error.`);
}

function parseArgs(argv) {
  const options = { inputs: [], json: false, strict: false, quiet: false, base: null, requireDark: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--quiet') { options.quiet = true; continue; }
    if (arg === '--require-dark') { options.requireDark = true; continue; }
    if (!arg.startsWith('--')) { options.inputs.push(arg); continue; }
    const match = /^--([a-z-]+)(?:=([\s\S]+))?$/.exec(arg);
    if (!match) throw new Error(`unexpected argument: ${arg}`);
    if (match[1] === 'base') {
      const value = Number(match[2]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--base must be a positive number');
      options.base = value;
    } else {
      throw new Error(`unknown option: --${match[1]}`);
    }
  }
  if (options.help) return options;
  if (!options.inputs.length) throw new Error('no input files');
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

  const result = lintTokens(options);
  const findings = result.findings.slice(0, 200);
  const omitted = result.findings.length - findings.length;
  for (const warning of result.loaded && result.loaded.warnings ? result.loaded.warnings : []) {
    console.error(`${TOOL}: warning: ${warning}`);
  }

  if (options.json) {
    console.log(JSON.stringify({
      ok: result.ok,
      counts: result.counts,
      meta: result.meta || null,
      findings: findings.map((finding) => ({ ...finding, file: path.relative(process.cwd(), finding.file) || finding.file })),
      omitted,
    }, null, 2));
  } else if (!options.quiet) {
    for (const finding of findings) {
      console.log(`${finding.severity}  ${finding.id}  ${path.relative(process.cwd(), finding.file) || finding.file}:${finding.line}`);
      console.log(`     ${finding.message}`);
      console.log(`     fix: ${finding.fix}`);
      if (finding.snippet) console.log(`     > ${finding.snippet}`);
    }
    if (omitted > 0) console.log(`... ${omitted} more finding(s) omitted`);
    if (!findings.length) console.log('token-lint: no findings');
    console.log('');
  }
  if (!options.json) {
    const meta = result.meta || { tokens: 0, dark: 0, files: result.loaded ? result.loaded.files.length : 0 };
    console.log(
      `token-lint: ${result.counts.P0} P0, ${result.counts.P1} P1, ${result.counts.P2} P2 across ${meta.files} file(s), ` +
      `${meta.tokens} tokens${meta.dark ? ` (${meta.dark} dark)` : ''}`,
    );
  }
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath && invokedPath.toLowerCase() === import.meta.url.toLowerCase()) {
  main();
}
