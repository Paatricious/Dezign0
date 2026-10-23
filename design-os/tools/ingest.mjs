#!/usr/bin/env node
/**
 * ingest — turn an external design source into a reviewable, provenance-stamped folder.
 *
 * Subcommands:
 *   url <http(s)-url>       capture a page: DOM, optional screenshot + computed token
 *                           snapshot (Playwright), or markup-only with --html-only
 *   repo <path>             scan a local repository/app: CSS custom properties, font
 *                           stacks, radii, spacing, palette, component files
 *   screenshot <image>      grade an image (dimensions, aspect, usable-for) and copy it
 *   references <file|dir>   normalise a reference board (JSON / Markdown / HTML / folder)
 *                           into references.json with local images copied in
 *
 * Every command writes the same shape:
 *   <out>/source.json      provenance: kind, origin, input hash, capturedAt, files, warnings
 *   <out>/tokens.css       reconstructed token layer (:root + [data-theme="dark"] when found)
 *   <out>/analysis.json    tokens, fonts, radii, spacing scale, palette, structure
 *   <out>/references.json   normalised references (one entry for url/repo/screenshot)
 *   <out>/INDEX.md          short human summary + next steps
 *   <out>/raw/              page.html / screenshot / copied reference images
 *
 * Usage:
 *   node ingest.mjs url https://example.com --out=.ingest/example
 *   node ingest.mjs url https://example.com --html-only --out=.ingest/example
 *   node ingest.mjs repo ../my-app --out=.ingest/my-app --json
 *   node ingest.mjs screenshot ./refs/hero.png --out=.ingest/hero
 *   node ingest.mjs references ./refs --out=.ingest/refs
 *
 * Options:
 *   --out=<dir>        output folder (default: design-ingest/<slug>)
 *   --name=<slug>      override the slug derived from the input
 *   --json             print a JSON summary instead of the human summary
 *   --force            write into a non-empty output folder
 *   --no-timestamp     omit capturedAt (byte-identical repeat runs)
 *   --captured-at=<iso> pin capturedAt
 *   --strict           exit 1 when there are warnings
 *   --max-bytes=<n>    per-file read cap (default 2 MiB)
 *   --max-files=<n>    repo scan cap (default 4000)
 *   --help             show this help
 *
 * URL network policy: the only network access is the single user-supplied URL.
 * Playwright gives screenshot + computed styles (preferred); --html-only fetches
 * that one URL with Node's fetch and records it as the only request. Redirects
 * are not followed (they could pivot to another origin). file:/ftp: URLs are
 * rejected; pass a screenshot or a local repo instead.
 *
 * Path containment: repo scans never follow symlinks and stay inside the repo
 * root; reference-board local files must resolve inside the board root; every
 * copied file is re-hashed into source.json.
 *
 * Exit codes: 0 ok, 1 warnings with --strict, 2 usage/read/capture error.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCssSource, extractStyleBlocks, normalizeTokenValue, parseColor, colorToHex } from './token-export.mjs';

const TOOL = 'ingest';
const SCHEMA = 'dezign0/ingest/v1';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.turbo', '.cache', 'coverage', '.svelte-kit', 'out']);
const CSS_EXT = new Set(['.css']);
const HTML_EXT = new Set(['.html', '.htm']);
const COMPONENT_EXT = new Set(['.tsx', '.jsx', '.vue', '.svelte']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const BOARD_EXT = new Set(['.json', '.md', '.markdown', '.html', '.htm']);

/* ───────────────────────────── small helpers ────────────────────────────── */

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function slugify(value, fallback = 'source') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

function statSafe(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function walk(root, { maxFiles = 4000, skipDirs = SKIP_DIRS } = {}) {
  const files = [];
  const dirs = [];
  let truncated = false;
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue; // containment: never follow links
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        dirs.push(full);
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(full);
      if (files.length >= maxFiles) {
        truncated = true;
        return { files, dirs, truncated };
      }
    }
  }
  return { files, dirs, truncated };
}

function relativeList(root, files) {
  return files.map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
}

function readText(file, maxBytes) {
  const stat = fs.statSync(file);
  if (stat.size > maxBytes) return null;
  return fs.readFileSync(file, 'utf8');
}

function nowStamp(options) {
  if (options.noTimestamp) return null;
  if (options.capturedAt) {
    const parsed = new Date(options.capturedAt);
    if (Number.isNaN(parsed.getTime())) throw new Error('--captured-at is not a valid date');
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

/* ─────────────────────────── analysis from CSS ──────────────────────────── */

function analyzeCssFiles(files, options) {
  const tokens = new Map(); // key: `${mode}:${name}`
  const fonts = new Map();
  const radii = new Map();
  const spacing = new Map();
  const palette = new Map();
  const rulesCount = { total: 0, generated: 0 };
  const filesRead = [];
  const warnings = [];

  const bump = (map, key, file) => {
    const entry = map.get(key) || { value: key, count: 0, files: new Set() };
    entry.count += 1;
    entry.files.add(file);
    map.set(key, entry);
  };

  for (const file of files) {
    let text;
    try {
      text = readText(file, options.maxBytes);
    } catch {
      continue;
    }
    if (text === null) {
      warnings.push(`${path.basename(file)}: skipped, larger than --max-bytes`);
      continue;
    }
    filesRead.push(file);
    const ext = path.extname(file).toLowerCase();
    const sources = HTML_EXT.has(ext)
      ? extractStyleBlocks(text).map((block) => ({ source: block, label: file }))
      : [{ source: text, label: file }];
    const parsed = sources.map(({ source, label }) => parseCssSource(source, label));
    const combined = { tokens: parsed.flatMap((entry) => entry.tokens), rules: parsed.flatMap((entry) => entry.rules), errors: parsed.flatMap((entry) => entry.errors) };
    if (combined.errors.length) {
      for (const error of combined.errors) warnings.push(`${path.basename(file)}:${error.line}: ${error.message}`);
    }
    for (const token of combined.tokens) {
      if (token.mode === 'reduced') continue;
      const key = `${token.mode}:${token.name}`;
      const existing = tokens.get(key);
      if (existing && normalizeTokenValue(existing.value) !== normalizeTokenValue(token.value)) {
        warnings.push(`${token.name}: conflicting value in ${path.basename(token.file)} (${token.value}) and ${path.basename(existing.file)} (${existing.value})`);
        continue;
      }
      if (!existing) {
        tokens.set(key, { name: token.name, value: token.value, mode: token.mode, file, line: token.line });
      }
    }
    rulesCount.total += combined.rules.length;
    for (const rule of combined.rules) {
      const property = rule.property.toLowerCase();
      const value = rule.value.trim();
      if (/^font-family$/i.test(property)) bump(fonts, normalizeTokenValue(value), file);
      if (/^border(-[a-z]+)?-radius$/i.test(property)) bump(radii, normalizeTokenValue(value), file);
      if (/^(padding|margin|gap|row-gap|column-gap|inset)(-[a-z]+)?$/i.test(property)) {
        for (const match of value.matchAll(/(-?\d*\.?\d+)(px|rem)\b/g)) {
          const amount = Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
          bump(spacing, String(Math.round(amount * 100) / 100), file);
        }
      }
      const color = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))/i.exec(value);
      if (color) bump(palette, color[0].toLowerCase(), file);
    }
  }

  const toSorted = (map, limit = 24) => [...map.values()]
    .map((entry) => ({ ...entry, files: [...entry.files].map((file) => path.basename(file)).sort() }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
    .slice(0, limit);

  const spacingValues = [...spacing.keys()].map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, Math.round(a) % Math.round(b)));
  const light = [...tokens.values()].filter((token) => token.mode !== 'dark');
  const dark = [...tokens.values()].filter((token) => token.mode === 'dark');

  // Palette: declared colour tokens are the most reliable evidence, so add
  // them after rule literals (normalised to hex where possible).
  for (const token of [...light, ...dark]) {
    const color = parseColor(token.value);
    if (color) bump(palette, colorToHex(color), token.file);
  }

  // Spacing base: declared space tokens win over observed literals.
  const declaredSpacing = light
    .filter((token) => /^--(space|spacing|gap|pad|inset)/.test(token.name))
    .map((token) => {
      const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(token.value.trim());
      return match ? Number(match[1]) * (match[2] === 'rem' ? 16 : 1) : null;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  let base = null;
  if (declaredSpacing.length >= 2) base = declaredSpacing.reduce((acc, value) => gcd(acc, value), 0);
  else if (spacingValues.length >= 2) {
    const observedBase = spacingValues.reduce((acc, value) => gcd(acc, value), 0);
    base = observedBase >= 2 ? observedBase : null;
  }

  return {
    filesRead: filesRead.length,
    rules: rulesCount,
    tokens: { light, dark },
    fonts: toSorted(fonts),
    radii: toSorted(radii),
    spacing: { observed: toSorted(spacing), base: base && base > 0 ? base : null },
    palette: toSorted(palette, 16),
    warnings,
  };
}

function fontsFromRules(analysis) {
  return analysis.fonts.map((entry) => entry.value);
}

function tokenCss(analysis, label) {
  const lines = ['/* Reconstructed token layer. Source: ' + label + '. Verify before use. */'];
  const light = [...analysis.tokens.light].sort((a, b) => a.name.localeCompare(b.name));
  const dark = [...analysis.tokens.dark].sort((a, b) => a.name.localeCompare(b.name));
  if (light.length) {
    lines.push('', ':root {');
    for (const token of light) lines.push(`  ${token.name}: ${token.value};`);
    lines.push('}');
  }
  if (dark.length) {
    lines.push('', '[data-theme="dark"], [data-mode="dark"] {');
    for (const token of dark) lines.push(`  ${token.name}: ${token.value};`);
    lines.push('}');
  }
  if (!light.length && !dark.length) lines.push('/* No CSS custom properties were found. */');
  return lines.join('\n') + '\n';
}

/* ────────────────────────────── screenshot ──────────────────────────────── */

function imageSize(buffer, ext) {
  if (ext === '.png' && buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }
  if ((ext === '.jpg' || ext === '.jpeg') && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), format: 'jpeg' };
      }
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
    return { width: null, height: null, format: 'jpeg' };
  }
  if (ext === '.gif' && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), format: 'gif' };
  }
  if (ext === '.webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buffer.length > 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: 'webp' };
    }
    if (chunk === 'VP8L' && buffer.length > 25) {
      const b = buffer.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: 'webp' };
    }
    if (chunk === 'VP8X' && buffer.length > 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height, format: 'webp' };
    }
    return { width: null, height: null, format: 'webp' };
  }
  if (ext === '.svg') {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
    const width = /\bwidth\s*=\s*["']?([\d.]+)/i.exec(text);
    const height = /\bheight\s*=\s*["']?([\d.]+)/i.exec(text);
    const viewBox = /\bviewBox\s*=\s*["']([\d.\s-]+)["']/i.exec(text);
    if (width && height) return { width: Math.round(Number(width[1])), height: Math.round(Number(height[1])), format: 'svg' };
    if (viewBox) {
      const parts = viewBox[1].trim().split(/\s+/).map(Number);
      if (parts.length === 4) return { width: Math.round(parts[2]), height: Math.round(parts[3]), format: 'svg' };
    }
    return { width: null, height: null, format: 'svg' };
  }
  return { width: null, height: null, format: ext.replace('.', '') || 'unknown' };
}

function gradeImage(size, bytes) {
  const { width, height } = size;
  const warnings = [];
  if (!width || !height) {
    warnings.push('Image dimensions could not be read from the file header.');
    return { tier: 'unknown', aspect: 'unknown', usableFor: [], warnings };
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const ratio = width / height;
  const tier = shortEdge >= 1000 || longEdge >= 1600 ? 'high' : shortEdge >= 640 ? 'medium' : 'low';
  let aspect = 'other';
  if (Math.abs(ratio - 16 / 9) < 0.03) aspect = '16:9';
  else if (Math.abs(ratio - 4 / 3) < 0.03) aspect = '4:3';
  else if (Math.abs(ratio - 1) < 0.02) aspect = '1:1';
  else if (ratio < 0.75) aspect = 'portrait';
  else if (ratio > 2.2) aspect = 'ultrawide';
  const usableFor = [];
  if (shortEdge >= 720 && ['16:9', '4:3', 'ultrawide'].includes(aspect)) usableFor.push('desktop-review');
  if (shortEdge >= 720 && ratio < 0.8) usableFor.push('mobile-review');
  if (shortEdge >= 640) usableFor.push('reference-board');
  if (tier === 'low') warnings.push('Short edge is below 640px; treat this as a thumbnail, not a design reference.');
  if (aspect === 'ultrawide') warnings.push('Very wide aspect ratio; check that the crop is intentional.');
  if (bytes > 12 * 1024 * 1024) warnings.push('File is larger than 12 MiB; consider compressing before review.');
  return { width, height, longEdge, shortEdge, aspect, ratio: Number(ratio.toFixed(4)), tier, usableFor, warnings };
}

/* ─────────────────────────────── writers ────────────────────────────────── */

function makeContext(options, kind, origin) {
  return {
    schema: SCHEMA,
    tool: TOOL,
    kind,
    origin,
    slug: options.slug,
    capturedAt: nowStamp(options),
    flags: options.flagsForProvenance,
    warnings: [],
    files: [],
    analysis: null,
    references: [],
    tokensCss: null,
    indexLines: [],
    rawWrites: [],
  };
}

function prepareOut(options) {
  if (!options.out) options.out = path.join('design-ingest', options.slug);
  const outDir = path.resolve(options.out);
  if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) {
    throw new Error(`--out is a file: ${outDir}`);
  }
  const existing = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  if (existing.length && !options.force) {
    throw new Error(`output folder is not empty: ${outDir} (use --force to overwrite)`);
  }
  ensureDir(outDir);
  return outDir;
}

function writeFileIn(outDir, relPath, contentBuffer) {
  const target = path.resolve(outDir, relPath);
  if (!target.startsWith(outDir + path.sep) && target !== outDir) {
    throw new Error(`refusing to write outside the output folder: ${relPath}`);
  }
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, contentBuffer);
}

function finalize(context, outDir, filesWritten) {
  // Every file that landed in the output folder gets a hash in source.json.
  const all = [];
  const stack = [outDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) all.push(full);
    }
  }
  for (const file of all.sort()) {
    const rel = path.relative(outDir, file).split(path.sep).join('/');
    if (rel === 'source.json') continue;
    const buffer = fs.readFileSync(file);
    context.files.push({ path: rel, bytes: buffer.length, sha256: sha256(buffer) });
  }
  const index = renderIndex(context);
  fs.writeFileSync(path.join(outDir, 'INDEX.md'), index);
  context.files.push({ path: 'INDEX.md', bytes: Buffer.byteLength(index), sha256: sha256(Buffer.from(index)) });
  const source = {
    schema: context.schema,
    tool: context.tool,
    kind: context.kind,
    origin: context.origin,
    slug: context.slug,
    capturedAt: context.capturedAt,
    flags: context.flags,
    counts: context.counts || {},
    warnings: [...new Set(context.warnings)].sort(),
    files: context.files.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const text = JSON.stringify(source, null, 2) + '\n';
  fs.writeFileSync(path.join(outDir, 'source.json'), text);
  return { outDir, source, index };
}

function renderIndex(context) {
  const lines = [`# Ingested ${context.kind}: ${context.slug}`, ''];
  lines.push(`- Source: \`${context.originLabel}\``);
  if (context.capturedAt) lines.push(`- Captured: ${context.capturedAt}`);
  if (context.counts) {
    for (const [key, value] of Object.entries(context.counts)) lines.push(`- ${key}: ${value}`);
  }
  if (context.indexLines.length) lines.push('', '## Findings', '', ...context.indexLines);
  lines.push('', '## Files', '');
  lines.push('- `source.json` — provenance, hashes and warnings');
  lines.push('- `tokens.css` — reconstructed token layer (verify before use)');
  lines.push('- `analysis.json` — tokens, fonts, radii, spacing, palette');
  lines.push('- `references.json` — normalised reference list');
  if (context.rawWrites.length) {
    lines.push('- Raw captures: ' + context.rawWrites.map((file) => `\`${file}\``).join(', '));
  }
  if (context.warnings.length) {
    lines.push('', '## Warnings', '');
    for (const warning of [...new Set(context.warnings)].sort()) lines.push(`- ${warning}`);
  }
  lines.push('', '## Next steps', '');
  if (context.kind === 'url') lines.push('- Compare the captured tokens with the project tokens before reusing any value.');
  if (context.kind === 'repo') lines.push('- Run the `design-system-extract` skill on `tokens.css` and `analysis.json` to produce a DESIGN.md.');
  if (context.kind === 'screenshot') lines.push('- Use the image as reference evidence; do not treat it as a token source.');
  if (context.kind === 'references') lines.push('- Pick 2–5 references with the same job as the artifact, not the prettiest ones.');
  lines.push('- Keep `source.json` with the folder so every later claim has provenance.');
  return lines.join('\n') + '\n';
}

/* ─────────────────────────────── URL capture ────────────────────────────── */

function validateUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`only http(s) URLs are supported (got ${url.protocol}); for a local file use the screenshot, repo or references subcommand`);
  }
  if (!url.hostname) throw new Error('URL has no host');
  return url;
}

async function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try {
      const module = await import(name);
      if (module.chromium) return module;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const COLLECT_IN_PAGE = () => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const tokens = new Map();
  const add = (name, value) => {
    if (!name || !String(name).startsWith('--')) return;
    if (!tokens.has(name)) tokens.set(name, clean(value).slice(0, 400));
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = [];
    try { rules = Array.from(sheet.cssRules || []); } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.style) {
          for (const name of Array.from(rule.style)) if (name.startsWith('--')) add(name, rule.style.getPropertyValue(name));
        }
        if (rule.cssRules) walk(Array.from(rule.cssRules));
      }
    };
    walk(rules);
  }
  for (const element of Array.from(document.querySelectorAll('[style]'))) {
    for (const name of Array.from(element.style)) if (name.startsWith('--')) add(name, element.style.getPropertyValue(name));
  }
  const sample = (selector, properties) => Array.from(document.querySelectorAll(selector)).slice(0, 6).map((element) => {
    const style = getComputedStyle(element);
    const out = { selector, tag: element.tagName.toLowerCase() };
    for (const property of properties) out[property] = clean(style.getPropertyValue(property));
    return out;
  });
  const heading = (selector) => Array.from(document.querySelectorAll(selector)).slice(0, 12).map((element) => clean(element.textContent));
  return {
    title: clean(document.title),
    description: clean(document.querySelector('meta[name="description"]')?.getAttribute('content')),
    lang: clean(document.documentElement.lang),
    headings: { h1: heading('h1'), h2: heading('h2'), h3: heading('h3') },
    tokens: [...tokens.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name)),
    typeSamples: sample('h1, h2, p, code, label', ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']),
    borderRadiusSamples: sample('button, [class*="card"], input, a[class]', ['border-radius']),
    colorSamples: sample('body, header, main, button, a, [class*="card"]', ['background-color', 'color', 'border-color']),
    counts: {
      links: document.querySelectorAll('a[href]').length,
      images: document.querySelectorAll('img').length,
      forms: document.querySelectorAll('form').length,
      buttons: document.querySelectorAll('button').length,
      stylesheets: document.styleSheets.length,
    },
  };
};

async function captureUrl(options) {
  const url = validateUrl(options.input);
  options.slug = options.name || slugify(`${url.hostname}${url.pathname}`, 'url-capture');
  const outDir = prepareOut(options);
  const context = makeContext(options, 'url', { url: url.href, host: url.hostname, path: url.pathname });
  context.originLabel = url.href;
  context.flagsForProvenance = { htmlOnly: options.htmlOnly, viewport: options.viewport, playwright: false };

  let rawHtml = '';
  let capture = null;
  const network = [];

  if (options.htmlOnly) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout);
    let response;
    try {
      response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'dezign0-ingest/1 (+local design tool)' } });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`the URL redirects (HTTP ${response.status}); pass the final URL the user wants captured`);
    }
    if (!response.ok) throw new Error(`the URL returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/html|xml/i.test(contentType)) throw new Error(`expected an HTML page, got "${contentType || 'unknown content type'}"`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > options.maxBytes * 4) throw new Error('page is larger than the capture limit');
    rawHtml = buffer.toString('utf8').slice(0, options.maxBytes * 4);
    network.push(url.href);
    context.warnings.push('Markup-only capture: no screenshot and no computed styles (Playwright not used).');
  } else {
    const playwright = await loadPlaywright();
    if (!playwright) {
      throw new Error('Playwright is required for URL capture. Install playwright (or use the existing Playwright-based measure-artifact tool), pass --html-only for a markup-only capture, or ingest a screenshot.');
    }
    const { width, height } = parseViewport(options.viewport);
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('request', (request) => network.push(request.url()));
      await page.goto(url.href, { waitUntil: 'load', timeout: options.timeout });
      rawHtml = await page.content();
      capture = await page.evaluate(COLLECT_IN_PAGE);
      const shot = path.join(outDir, 'raw', 'screenshot.png');
      ensureDir(path.dirname(shot));
      await page.screenshot({ path: shot, fullPage: true });
      context.rawWrites.push('raw/screenshot.png');
      context.flagsForProvenance.playwright = true;
    } finally {
      await browser.close();
    }
  }

  writeFileIn(outDir, 'raw/page.html', Buffer.from(rawHtml, 'utf8'));
  context.rawWrites.unshift('raw/page.html');

  // Token analysis: computed tokens (Playwright) or inline CSS (html-only).
  if (capture) {
    const analysis = { tokens: { light: capture.tokens, dark: [] }, fonts: [], radii: [], spacing: { observed: [], base: null }, palette: [], warnings: [] };
    const fonts = new Map();
    for (const sample of capture.typeSamples) {
      if (sample['font-family']) {
        const entry = fonts.get(sample['font-family']) || { value: sample['font-family'], count: 0 };
        entry.count += 1;
        fonts.set(sample['font-family'], entry);
      }
    }
    analysis.fonts = [...fonts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 12);
    const radii = new Map();
    for (const sample of capture.borderRadiusSamples) {
      if (sample['border-radius'] && sample['border-radius'] !== '0px') {
        const entry = radii.get(sample['border-radius']) || { value: sample['border-radius'], count: 0 };
        entry.count += 1;
        radii.set(sample['border-radius'], entry);
      }
    }
    analysis.radii = [...radii.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 12);
    const palette = new Map();
    for (const sample of capture.colorSamples) {
      for (const property of ['background-color', 'color', 'border-color']) {
        const value = sample[property];
        if (!value || value === 'rgba(0, 0, 0, 0)') continue;
        const entry = palette.get(value) || { value, count: 0 };
        entry.count += 1;
        palette.set(value, entry);
      }
    }
    analysis.palette = [...palette.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 16);
    context.analysis = analysis;
    context.counts = {
      tokens: capture.tokens.length,
      headings: Object.values(capture.headings).reduce((total, list) => total + list.length, 0),
      links: capture.counts.links,
      images: capture.counts.images,
      forms: capture.counts.forms,
    };
    context.indexLines.push(`- Title: ${capture.title || '(none)'}`);
    if (capture.description) context.indexLines.push(`- Description: ${capture.description}`);
    if (capture.headings.h1.length) context.indexLines.push('- H1: ' + capture.headings.h1.slice(0, 3).join(' / '));
    if (capture.tokens.length) context.indexLines.push(`- ${capture.tokens.length} CSS custom properties collected from stylesheets`);
    context.references.push({ id: 'source', kind: 'url', title: capture.title || url.hostname, url: url.href, tags: ['capture'] });
  } else {
    // html-only: parse inline CSS for tokens and rule-derived signals.
    const styleText = extractStyleBlocks(rawHtml).join('\n');
    const parsed = parseCssSource(styleText, 'capture/raw/page.html');
    const analysis = {
      tokens: {
        light: parsed.tokens.filter((token) => token.mode === 'light').map(({ name, value }) => ({ name, value })),
        dark: parsed.tokens.filter((token) => token.mode === 'dark').map(({ name, value }) => ({ name, value })),
      },
      fonts: [], radii: [], spacing: { observed: [], base: null }, palette: [], warnings: [],
    };
    const fonts = new Map();
    const radii = new Map();
    const palette = new Map();
    for (const rule of parsed.rules) {
      if (/^font-family$/i.test(rule.property)) fonts.set(rule.value, (fonts.get(rule.value) || 0) + 1);
      if (/^border(-[a-z]+)?-radius$/i.test(rule.property)) radii.set(rule.value, (radii.get(rule.value) || 0) + 1);
      const color = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))/i.exec(rule.value);
      if (color) palette.set(color[0].toLowerCase(), (palette.get(color[0].toLowerCase()) || 0) + 1);
    }
    analysis.fonts = [...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })).slice(0, 12);
    analysis.radii = [...radii.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })).slice(0, 12);
    analysis.palette = [...palette.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })).slice(0, 16);
    context.analysis = analysis;
    context.counts = {
      tokens: analysis.tokens.light.length + analysis.tokens.dark.length,
      inlineStyles: parsed.rules.length,
      links: (rawHtml.match(/<a\b[^>]*href=/gi) || []).length,
      images: (rawHtml.match(/<img\b/gi) || []).length,
    };
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(rawHtml);
    const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(rawHtml);
    if (title) context.indexLines.push(`- Title: ${normalizeTokenValue(title[1])}`);
    if (description) context.indexLines.push(`- Description: ${normalizeTokenValue(description[1])}`);
    context.indexLines.push(`- ${context.counts.tokens} custom properties parsed from inline CSS`);
    context.references.push({ id: 'source', kind: 'url', title: title ? normalizeTokenValue(title[1]) : url.hostname, url: url.href, tags: ['capture', 'html-only'] });
  }

  context.warnings.push(...(context.analysis.warnings || []));
  context.origin.network = [...new Set(network)].sort();
  context.flagsForProvenance.requests = context.origin.network.length;
  context.tokensCss = tokenCss(context.analysis, url.href);
  writeFileIn(outDir, 'tokens.css', Buffer.from(context.tokensCss));
  writeFileIn(outDir, 'analysis.json', Buffer.from(JSON.stringify(context.analysis, null, 2) + '\n'));
  writeFileIn(outDir, 'references.json', Buffer.from(JSON.stringify({ schema: SCHEMA, references: context.references }, null, 2) + '\n'));
  const finalized = finalize(context, outDir, []);
  return { ok: true, kind: 'url', out: outDir, summary: finalized, warnings: context.warnings };
}

function parseViewport(value) {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value || '1440x900');
  if (!match) throw new Error('--viewport must look like 1440x900');
  return { width: Number(match[1]), height: Number(match[2]) };
}

/* ─────────────────────────────── repo scan ──────────────────────────────── */

function readGitInfo(root) {
  const info = { commit: null, branch: null, remote: null };
  try {
    const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) {
      info.branch = head.slice(4).trim().replace(/^refs\/heads\//, '');
      const refFile = path.join(root, '.git', head.slice(4).trim());
      if (fs.existsSync(refFile)) info.commit = fs.readFileSync(refFile, 'utf8').trim();
    } else if (/^[0-9a-f]{40}$/.test(head)) {
      info.commit = head;
    }
    const config = path.join(root, '.git', 'config');
    if (fs.existsSync(config)) {
      const remote = /\[remote "origin"\][^\[]*?url\s*=\s*(.+)/i.exec(fs.readFileSync(config, 'utf8'));
      if (remote) info.remote = remote[1].trim();
    }
  } catch {
    // not a git checkout, or unreadable: provenance just lacks git fields
  }
  return info;
}

function detectFrameworks(packageJson) {
  if (!packageJson || typeof packageJson !== 'object') return [];
  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const known = ['next', 'react', 'vue', 'svelte', '@sveltejs/kit', 'nuxt', 'astro', 'solid-js', 'tailwindcss', '@angular/core', 'vite', 'expo', 'react-native', 'electron'];
  const frameworks = known.filter((name) => deps[name]);
  return frameworks.sort();
}

function captureRepo(options) {
  const inputPath = path.resolve(options.input);
  const stat = statSafe(inputPath);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`repo input must be a directory: ${inputPath}`);
  }
  const root = fs.realpathSync(inputPath);
  options.slug = options.name || slugify(path.basename(root), 'repo');
  const outDir = prepareOut(options);
  const context = makeContext(options, 'repo', { path: root, basename: path.basename(root) });
  context.originLabel = root;
  context.flagsForProvenance = { maxFiles: options.maxFiles, maxBytes: options.maxBytes };

  const scan = walk(root, { maxFiles: options.maxFiles });
  if (scan.truncated) context.warnings.push(`scan stopped at --max-files=${options.maxFiles}; the report is partial.`);
  const relative = relativeList(root, scan.files);
  const byExt = {};
  for (const file of relative) {
    const ext = path.extname(file).toLowerCase() || '(none)';
    byExt[ext] = (byExt[ext] || 0) + 1;
  }
  const cssFiles = scan.files.filter((file) => CSS_EXT.has(path.extname(file).toLowerCase()));
  // HTML style blocks often carry the real component layer (and the only CSS in
  // a single-file artifact), so they feed the same analysis.
  const styleFiles = scan.files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return CSS_EXT.has(ext) || HTML_EXT.has(ext);
  });
  const analysis = analyzeCssFiles(styleFiles, options);
  analysis.warnings.unshift(...context.warnings);

  let packageJson = null;
  const pkgFile = path.join(root, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      packageJson = readJson(pkgFile);
    } catch (error) {
      analysis.warnings.push(`package.json is unreadable: ${error.message}`);
    }
  }
  const frameworks = detectFrameworks(packageJson);
  const components = relative.filter((file) => COMPONENT_EXT.has(path.extname(file).toLowerCase())).slice(0, 40);
  const images = relative.filter((file) => IMAGE_EXT.has(path.extname(file).toLowerCase()));

  const git = readGitInfo(root);
  context.origin.git = git;
  context.origin.package = packageJson ? { name: packageJson.name || null, version: packageJson.version || null } : null;
  context.origin.frameworks = frameworks;

  // Aggregate token layers into the standard analysis shape.
  const tokens = [...analysis.tokens.light, ...analysis.tokens.dark].map((token) => ({
    name: token.name,
    value: token.value,
    mode: token.mode,
    file: path.relative(root, token.file).split(path.sep).join('/'),
    line: token.line,
  }));
  const report = {
    files: { scanned: relative.length, css: cssFiles.length, components: components.length, images: images.length, byExt: Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1] - a[1])) },
    frameworks,
    git,
    components,
    tokens,
    fonts: analysis.fonts,
    radii: analysis.radii,
    spacing: analysis.spacing,
    palette: analysis.palette,
    warnings: analysis.warnings,
  };
  context.analysis = report;
  context.counts = {
    files: relative.length,
    cssFiles: cssFiles.length,
    tokens: tokens.length,
    darkTokens: tokens.filter((token) => token.mode === 'dark').length,
    fonts: analysis.fonts.length,
    radii: analysis.radii.length,
    spacingSteps: analysis.spacing.observed.length,
    frameworks: frameworks.length,
  };
  if (!cssFiles.length) context.warnings.push('No CSS files found; nothing to extract.');
  if (!tokens.length) context.warnings.push('No CSS custom properties found; the design layer is not tokenised.');
  if (analysis.spacing.base) context.indexLines.push(`- Spacing base unit looks like ${analysis.spacing.base}px`);
  if (analysis.fonts.length) context.indexLines.push('- Font stacks: ' + analysis.fonts.slice(0, 3).map((entry) => entry.value).join(' | '));
  if (analysis.radii.length) context.indexLines.push('- Radii: ' + analysis.radii.slice(0, 4).map((entry) => entry.value).join(', '));
  if (frameworks.length) context.indexLines.push('- Frameworks: ' + frameworks.join(', '));
  if (git.commit) context.indexLines.push(`- Git: ${git.branch || 'detached'} @ ${git.commit.slice(0, 8)}`);

  context.tokensCss = tokenCss(analysis, root);
  writeFileIn(outDir, 'tokens.css', Buffer.from(context.tokensCss));
  writeFileIn(outDir, 'analysis.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  context.references.push({ id: 'source', kind: 'repo', title: packageJson?.name || path.basename(root), path: root, git: git.commit || undefined, tags: ['source'] });
  writeFileIn(outDir, 'references.json', Buffer.from(JSON.stringify({ schema: SCHEMA, references: context.references }, null, 2) + '\n'));
  const finalized = finalize(context, outDir, []);
  return { ok: true, kind: 'repo', out: outDir, summary: finalized, warnings: context.warnings, analysis: report };
}

/* ─────────────────────────────── screenshot ─────────────────────────────── */

function captureScreenshot(options) {
  const inputPath = path.resolve(options.input);
  const stat = statSafe(inputPath);
  if (!stat || !stat.isFile()) throw new Error(`screenshot input must be a file: ${inputPath}`);
  const ext = path.extname(inputPath).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error(`unsupported image type "${ext || 'none'}"; expected ${[...IMAGE_EXT].join(', ')}`);
  const buffer = fs.readFileSync(inputPath);
  if (buffer.length > options.maxBytes * 8) throw new Error('image is larger than the ingestion limit');
  options.slug = options.name || slugify(path.basename(inputPath, ext), 'screenshot');
  const outDir = prepareOut(options);
  const context = makeContext(options, 'screenshot', { path: inputPath, bytes: buffer.length });
  context.originLabel = inputPath;
  context.flagsForProvenance = { copy: !options.noCopy };

  const size = imageSize(buffer, ext);
  const grade = gradeImage(size, buffer.length);
  context.warnings.push(...grade.warnings);
  const rawName = `raw/${options.slug}${ext}`;
  if (!options.noCopy) {
    writeFileIn(outDir, rawName, buffer);
    context.rawWrites.push(rawName);
  }
  const report = {
    file: { name: path.basename(inputPath), format: size.format, bytes: buffer.length, sha256: sha256(buffer) },
    dimensions: size.width && size.height ? { width: size.width, height: size.height } : null,
    grade,
  };
  context.analysis = report;
  context.counts = { width: size.width || 0, height: size.height || 0, tier: grade.tier, aspect: grade.aspect };
  context.indexLines.push(`- Format: ${size.format}, ${buffer.length} bytes, sha256 ${report.file.sha256.slice(0, 12)}…`);
  if (size.width) context.indexLines.push(`- Dimensions: ${size.width}×${size.height} (${grade.aspect}, ${grade.tier})`);
  if (grade.usableFor.length) context.indexLines.push('- Usable for: ' + grade.usableFor.join(', '));
  context.tokensCss = '/* A screenshot has no token layer. Extract colours visually or use the repo/url subcommands. */\n';
  writeFileIn(outDir, 'tokens.css', Buffer.from(context.tokensCss));
  writeFileIn(outDir, 'analysis.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  context.references.push({
    id: 'source',
    kind: 'image',
    title: path.basename(inputPath),
    path: options.noCopy ? inputPath : rawName,
    originalPath: inputPath,
    dimensions: report.dimensions,
    tags: [grade.tier, grade.aspect],
  });
  writeFileIn(outDir, 'references.json', Buffer.from(JSON.stringify({ schema: SCHEMA, references: context.references }, null, 2) + '\n'));
  const finalized = finalize(context, outDir, []);
  return { ok: true, kind: 'screenshot', out: outDir, summary: finalized, warnings: context.warnings };
}

/* ────────────────────────────── references ──────────────────────────────── */

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseBoardFile(file) {
  const ext = path.extname(file).toLowerCase();
  const text = fs.readFileSync(file, 'utf8');
  const baseDir = path.dirname(file);
  const entries = [];
  if (ext === '.json') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${path.basename(file)} is not valid JSON: ${error.message}`);
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.references) ? parsed.references : Array.isArray(parsed.items) ? parsed.items : [];
    if (!list.length) throw new Error(`${path.basename(file)} contains no references array`);
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const title = item.title || item.name || null;
      if (item.url || item.href) entries.push({ kind: 'url', title, url: item.url || item.href, tags: item.tags, note: item.note || item.notes });
      else if (item.path || item.file || item.image) entries.push({ kind: 'image', title, path: item.path || item.file || item.image, tags: item.tags, note: item.note || item.notes });
      else if (item.text || item.note) entries.push({ kind: 'note', title, text: item.text || item.note, tags: item.tags });
      else entries.push({ kind: 'note', title, text: JSON.stringify(item) });
    }
    return { entries, baseDir };
  }
  if (ext === '.md' || ext === '.markdown') {
    for (const line of text.split(/\r?\n/)) {
      const image = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      let match;
      while ((match = image.exec(line))) entries.push({ kind: 'image', title: match[1] || null, path: match[2] });
      // Strip image syntax first so the link matcher does not double-count it.
      const withoutImages = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
      const link = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      while ((match = link.exec(withoutImages))) entries.push({ kind: 'url', title: match[1] || null, url: match[2] });
      const note = /^\s*[-*]\s+(?:note|context|why)\s*:\s*(.+)$/i.exec(line);
      if (note) entries.push({ kind: 'note', text: note[1].trim() });
    }
    return { entries, baseDir };
  }
  // HTML boards
  const anchors = [...text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of anchors) {
    const label = normalizeTokenValue(match[2].replace(/<[^>]+>/g, '')) || null;
    entries.push({ kind: 'url', title: label, url: match[1] });
  }
  const images = [...text.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)];
  for (const match of images) {
    const alt = /alt=["']([^"']*)["']/i.exec(match[0]);
    entries.push({ kind: 'image', title: alt ? alt[1] || null : null, path: match[1] });
  }
  return { entries, baseDir };
}

function collectBoardInputs(inputPath) {
  const stat = statSafe(inputPath);
  if (!stat) throw new Error(`references input not found: ${inputPath}`);
  if (stat.isFile()) {
    return { boards: [inputPath], baseDir: path.dirname(inputPath), root: path.dirname(inputPath) };
  }
  if (!stat.isDirectory()) throw new Error('references input must be a file or directory');
  const root = fs.realpathSync(inputPath);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const boards = [];
  const images = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (entry.isFile() && BOARD_EXT.has(ext)) boards.push(full);
    else if (entry.isFile() && IMAGE_EXT.has(ext)) images.push(full);
  }
  return { boards, images, baseDir: root, root };
}

function insideBase(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function captureReferences(options) {
  const inputPath = path.resolve(options.input);
  options.slug = options.name || slugify(path.basename(inputPath, path.extname(inputPath)) || 'references', 'references');
  const outDir = prepareOut(options);
  const context = makeContext(options, 'references', { path: inputPath });
  context.originLabel = inputPath;
  context.flagsForProvenance = { copy: !options.noCopy };

  const collected = collectBoardInputs(inputPath);
  const base = collected.baseDir;
  const rawEntries = [];
  for (const board of collected.boards) {
    try {
      rawEntries.push(...parseBoardFile(board).entries);
    } catch (error) {
      context.warnings.push(error.message);
    }
  }
  if (collected.images) {
    for (const image of collected.images) rawEntries.push({ kind: 'image', path: image });
  }

  const references = [];
  const usedIds = new Set();
  const copied = [];
  for (const entry of rawEntries) {
    const title = entry.title ? normalizeTokenValue(entry.title) : null;
    if (entry.kind === 'url') {
      const raw = String(entry.url || '');
      if (raw.startsWith('data:') || raw.startsWith('javascript:')) {
        context.warnings.push(`skipped non-capturable URL: ${raw.slice(0, 40)}…`);
        continue;
      }
      const absolute = /^https?:/i.test(raw) ? normalizeUrl(raw) : null;
      if (absolute) {
        let id = slugify(title || absolute, 'reference');
        while (usedIds.has(id)) id = `${id}-2`;
        usedIds.add(id);
        references.push({ id, kind: 'url', title, url: absolute, tags: Array.isArray(entry.tags) ? entry.tags : [], note: entry.note || undefined });
        continue;
      }
      // A relative link is a local file reference (e.g. another preview page),
      // not a bare hostname; keep it inside the board folder.
      const local = path.resolve(base, raw);
      if (!insideBase(base, local) || !fs.existsSync(local) || !statSafe(local)?.isFile()) {
        context.warnings.push(`skipped non-http(s) reference that is not a local file: ${raw.slice(0, 60)}`);
        continue;
      }
      let id = slugify(title || path.basename(local, path.extname(local)), 'reference');
      while (usedIds.has(id)) id = `${id}-2`;
      usedIds.add(id);
      references.push({
        id,
        kind: 'file',
        title,
        path: local.split(path.sep).join('/'),
        originalPath: local,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        note: entry.note || undefined,
      });
      continue;
    }
    if (entry.kind === 'image') {
      const raw = String(entry.path || '');
      if (/^https?:/i.test(raw)) {
        // Remote images are recorded as references, never fetched.
        let id = slugify(title || raw, 'reference');
        while (usedIds.has(id)) id = `${id}-2`;
        usedIds.add(id);
        references.push({ id, kind: 'image', title, url: normalizeUrl(raw) || raw, remote: true, tags: Array.isArray(entry.tags) ? entry.tags : [] });
        continue;
      }
      const resolved = path.resolve(base, raw);
      if (!insideBase(base, resolved)) {
        context.warnings.push(`skipped image outside the board folder: ${raw}`);
        continue;
      }
      if (!fs.existsSync(resolved) || !statSafe(resolved)?.isFile()) {
        context.warnings.push(`missing reference image: ${raw}`);
        continue;
      }
      if (!IMAGE_EXT.has(path.extname(resolved).toLowerCase())) {
        context.warnings.push(`skipped non-image reference: ${raw}`);
        continue;
      }
      let id = slugify(title || path.basename(resolved, path.extname(resolved)), 'reference');
      while (usedIds.has(id)) id = `${id}-2`;
      usedIds.add(id);
      let stored = resolved;
      if (!options.noCopy) {
        const ext = path.extname(resolved).toLowerCase();
        stored = `raw/references/${id}${ext}`;
        writeFileIn(outDir, stored, fs.readFileSync(resolved));
        copied.push(stored);
      }
      references.push({
        id,
        kind: 'image',
        title,
        path: stored.split(path.sep).join('/'),
        originalPath: resolved,
        copied: !options.noCopy,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        note: entry.note || undefined,
      });
      continue;
    }
    if (entry.kind === 'note') {
      const text = normalizeTokenValue(entry.text || '');
      if (!text) continue;
      let id = slugify(title || text.slice(0, 40), 'note');
      while (usedIds.has(id)) id = `${id}-2`;
      usedIds.add(id);
      references.push({ id, kind: 'note', title, text, tags: Array.isArray(entry.tags) ? entry.tags : [] });
    }
  }

  if (!references.length) {
    throw new Error('no valid references found (check the board format and local image paths)');
  }
  references.sort((a, b) => a.id.localeCompare(b.id));
  context.references = references;
  context.rawWrites.push(...copied);
  const counts = references.reduce((acc, reference) => {
    acc[reference.kind] = (acc[reference.kind] || 0) + 1;
    return acc;
  }, {});
  context.counts = { references: references.length, byKind: counts, copied: copied.length };
  context.indexLines.push(`- ${counts.url || 0} URL, ${counts.image || 0} image, ${counts.note || 0} note reference(s)`);
  if (copied.length) context.indexLines.push(`- Copied ${copied.length} local image(s) into raw/references/`);
  context.tokensCss = '/* A reference board has no token layer. Use the repo or url subcommand for tokens. */\n';
  writeFileIn(outDir, 'tokens.css', Buffer.from(context.tokensCss));
  const analysis = { references: references.length, byKind: counts, entries: references };
  context.analysis = analysis;
  writeFileIn(outDir, 'analysis.json', Buffer.from(JSON.stringify(analysis, null, 2) + '\n'));
  writeFileIn(outDir, 'references.json', Buffer.from(JSON.stringify({ schema: SCHEMA, references }, null, 2) + '\n'));
  const finalized = finalize(context, outDir, []);
  return { ok: true, kind: 'references', out: outDir, summary: finalized, warnings: context.warnings };
}

/* ────────────────────────────────── CLI ─────────────────────────────────── */

function usage() {
  console.log(`ingest — capture an external design source with provenance

Usage:
  node ingest.mjs url <http(s)-url> [options]
  node ingest.mjs repo <path> [options]
  node ingest.mjs screenshot <image> [options]
  node ingest.mjs references <file|dir> [options]

Common options:
  --out=<dir>         output folder (default: design-ingest/<slug>)
  --name=<slug>       override the slug
  --json              print a JSON summary instead of the human summary
  --force             write into a non-empty output folder
  --no-timestamp      omit capturedAt (deterministic repeat runs)
  --captured-at=<iso> pin capturedAt
  --strict            exit 1 when there are warnings
  --max-bytes=<n>     per-file read cap in bytes (default 2097152)
  --max-files=<n>     repo scan cap (default 4000)
  --help              show this help

url options:   --html-only, --viewport=1440x900, --timeout=<ms>
screenshot:    --no-copy
references:    --no-copy

Network: only the user-supplied URL is contacted (Playwright, or one fetch with
--html-only). Redirects are refused. No other network access is performed.
Exit codes: 0 ok, 1 warnings with --strict, 2 usage/read/capture error.`);
}

const BOOLEAN = new Set(['json', 'force', 'no-timestamp', 'strict', 'help', 'html-only', 'no-copy']);
const VALUED = new Set(['out', 'name', 'captured-at', 'max-bytes', 'max-files', 'viewport', 'timeout']);

function parseArgs(argv) {
  const options = {
    subcommand: null,
    input: null,
    json: false,
    force: false,
    noTimestamp: false,
    strict: false,
    help: false,
    htmlOnly: false,
    noCopy: false,
    out: null,
    name: null,
    capturedAt: null,
    maxBytes: 2 * 1024 * 1024,
    maxFiles: 4000,
    viewport: '1440x900',
    timeout: 15000,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const match = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(arg);
    if (!match) throw new Error(`unexpected argument: ${arg}`);
    const [, key, inline] = match;
    if (BOOLEAN.has(key)) {
      if (inline !== undefined && inline !== 'true' && inline !== 'false') throw new Error(`--${key} is a flag`);
      const value = inline === undefined ? true : inline === 'true';
      if (key === 'json') options.json = value;
      else if (key === 'force') options.force = value;
      else if (key === 'no-timestamp') options.noTimestamp = value;
      else if (key === 'strict') options.strict = value;
      else if (key === 'html-only') options.htmlOnly = value;
      else if (key === 'no-copy') options.noCopy = value;
      continue;
    }
    if (!VALUED.has(key)) throw new Error(`unknown option: --${key}`);
    let value = inline;
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
      index += 1;
    }
    if (key === 'out') options.out = value;
    else if (key === 'name') options.name = value;
    else if (key === 'captured-at') options.capturedAt = value;
    else if (key === 'max-bytes') options.maxBytes = Number(value);
    else if (key === 'max-files') options.maxFiles = Number(value);
    else if (key === 'viewport') options.viewport = value;
    else if (key === 'timeout') options.timeout = Number(value);
  }
  if (options.help) return options;
  if (positional.length < 1) throw new Error('missing subcommand (url, repo, screenshot, references)');
  options.subcommand = positional[0].toLowerCase();
  if (!['url', 'repo', 'screenshot', 'references'].includes(options.subcommand)) {
    throw new Error(`unknown subcommand "${positional[0]}"; expected url, repo, screenshot or references`);
  }
  if (positional.length < 2) throw new Error(`${options.subcommand} needs an input`);
  options.input = positional[1];
  if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) throw new Error('--max-bytes must be a positive number');
  if (!Number.isFinite(options.maxFiles) || options.maxFiles <= 0) throw new Error('--max-files must be a positive number');
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('--timeout must be a positive number');
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`);
    console.error('Run with --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    usage();
    return;
  }

  let result;
  try {
    if (options.subcommand === 'url') result = await captureUrl(options);
    else if (options.subcommand === 'repo') result = captureRepo(options);
    else if (options.subcommand === 'screenshot') result = captureScreenshot(options);
    else result = captureReferences(options);
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const warnings = [...new Set(result.warnings || [])].sort();
  const rel = path.relative(process.cwd(), result.out) || result.out;
  if (options.json) {
    const { source } = result.summary;
    console.log(JSON.stringify({
      ok: true,
      kind: result.kind,
      out: result.out,
      slug: source.slug,
      counts: source.counts,
      warnings,
      files: source.files.map((file) => file.path),
    }, null, 2));
  } else {
    console.log(`${TOOL}: captured ${result.kind} -> ${rel}`);
    for (const [key, value] of Object.entries(result.summary.source.counts || {})) {
      console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
    for (const warning of warnings) console.error(`${TOOL}: warning: ${warning}`);
    console.log(`  files: ${result.summary.source.files.length} (source.json, tokens.css, analysis.json, references.json, INDEX.md)`);
  }
  if (options.strict && warnings.length) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath && invokedPath.toLowerCase() === import.meta.url.toLowerCase()) {
  main();
}
