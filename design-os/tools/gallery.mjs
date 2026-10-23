#!/usr/bin/env node
/**
 * gallery — static, self-contained HTML gallery for the design-language pack.
 *
 * Reads design-languages/index.json (152 systems), resolves each system's preview,
 * DESIGN.md, tokens.css and components.html, samples its palette from tokens.css,
 * and renders one HTML file with search + category filtering. No external assets:
 * inline CSS/JS, system fonts, colour swatches drawn with CSS.
 *
 * Usage:
 *   node gallery.mjs --out=design-languages/gallery.html
 *   node gallery.mjs --json
 *   node gallery.mjs --index=./design-languages/index.json --base=design-languages
 *
 * Options:
 *   --index=<file>   index.json to read (default: <repo>/design-languages/index.json)
 *   --out=<file>     write the gallery here; default prints to stdout
 *   --base=<prefix>  link prefix for the pack (default: computed from --out or cwd)
 *   --title=<text>   gallery heading (default: "Dezign0 design languages")
 *   --json           print a JSON summary instead of the HTML
 *   --strict         exit 1 when there are warnings
 *   --help           show this help
 *
 * Exit codes: 0 ok, 1 warnings with --strict, 2 read/usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCssSource, parseColor, colorToHex, resolveValue } from './token-export.mjs';

const TOOL = 'gallery';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_INDEX = path.join(REPO_ROOT, 'design-languages', 'index.json');

const SWATCH_ROLES = [
  { role: 'background', candidates: ['--bg', '--background', '--canvas'] },
  { role: 'surface', candidates: ['--surface', '--card', '--panel'] },
  { role: 'text', candidates: ['--fg', '--foreground', '--text', '--ink'] },
  { role: 'accent', candidates: ['--accent', '--primary', '--brand'] },
  { role: 'accent-on', candidates: ['--accent-on', '--accent-foreground', '--on-accent'] },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function joinUrl(base, ...parts) {
  const cleanBase = base.replace(/\/+$/, '');
  const cleanParts = parts.map((part) => String(part).replace(/^\/+/, '')).join('/');
  return cleanBase ? `${cleanBase}/${cleanParts}` : cleanParts;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Palette for one system: resolved swatches from tokens.css. */
function samplePalette(systemDir, warnings) {
  const tokensFile = path.join(systemDir, 'tokens.css');
  if (!fs.existsSync(tokensFile)) return [];
  let parsed;
  try {
    parsed = parseCssSource(fs.readFileSync(tokensFile, 'utf8'), tokensFile);
  } catch {
    warnings.push('tokens.css unreadable');
    return [];
  }
  const byName = new Map();
  for (const token of parsed.tokens) {
    if (token.mode !== 'light') continue;
    if (!byName.has(token.name)) byName.set(token.name, token);
  }
  const swatches = [];
  const seen = new Set();
  for (const { role, candidates } of SWATCH_ROLES) {
    for (const candidate of candidates) {
      const token = byName.get(candidate);
      if (!token) continue;
      const resolved = resolveValue(token.value, byName);
      const color = parseColor(resolved.value);
      if (!color) continue;
      const hex = colorToHex(color);
      if (seen.has(hex)) break;
      seen.add(hex);
      swatches.push({ role, token: candidate, value: hex });
      break;
    }
  }
  return swatches;
}

/** Resolve one system into a render model. */
function buildSystem(entry, packRoot, warnings) {
  const slug = entry.slug;
  const systemDir = path.join(packRoot, 'design-systems', slug);
  const manifest = readJsonSafe(path.join(systemDir, 'manifest.json'));
  const files = manifest?.files && typeof manifest.files === 'object' ? manifest.files : {};
  const pick = (rel) => {
    if (typeof rel !== 'string' || !rel) return null;
    const target = path.resolve(systemDir, rel);
    if (!target.startsWith(systemDir + path.sep)) return null;
    return fs.existsSync(target) ? toPosix(rel) : null;
  };
  const design = pick(entry.design || files.design);
  const tokens = pick(entry.tokens || files.tokens);
  const components = pick(entry.components || files.components);
  const usage = pick(entry.usage || files.usage);
  let preview = null;
  const pages = Array.isArray(manifest?.preview?.pages) ? manifest.preview.pages : [];
  for (const page of pages) {
    const rel = pick(page?.path);
    if (rel) { preview = rel; break; }
  }
  if (!preview) preview = pick('preview/colors.html');
  if (!preview) {
    const previewDir = path.join(systemDir, 'preview');
    if (fs.existsSync(previewDir)) {
      const first = fs.readdirSync(previewDir).filter((name) => /\.html?$/i.test(name)).sort()[0];
      if (first) preview = pick(path.join('preview', first));
    }
  }
  if (!fs.existsSync(systemDir)) warnings.push(`${slug}: package directory is missing`);
  if (!design) warnings.push(`${slug}: no DESIGN.md`);
  if (!tokens) warnings.push(`${slug}: no tokens.css`);
  if (!preview) warnings.push(`${slug}: no preview page`);

  return {
    slug,
    name: entry.name || slug,
    category: entry.category || 'Uncategorised',
    description: entry.description || '',
    source: entry.source?.origin || entry.source?.type || '',
    design,
    tokens,
    components,
    usage,
    preview,
    palette: samplePalette(systemDir, warnings.map((warning) => `${slug}: ${warning}`)),
  };
}

function renderCard(system, base) {
  const href = (rel) => (rel ? joinUrl(base, system.slug, rel) : null);
  const swatchHtml = system.palette.length
    ? system.palette.map((swatch) =>
      `<span class="swatch" style="background:${escapeHtml(swatch.value)}" title="${escapeHtml(swatch.role)}: ${escapeHtml(swatch.token)} ${escapeHtml(swatch.value)}"><span class="swatch-role">${escapeHtml(swatch.role)}</span></span>`)
      .join('')
    : '<span class="swatch swatch-empty" aria-hidden="true"></span>';
  const links = [];
  if (system.preview) links.push(`<a class="card-link primary" href="${escapeHtml(href(system.preview))}">Preview</a>`);
  if (system.design) links.push(`<a class="card-link" href="${escapeHtml(href(system.design))}">Design</a>`);
  if (system.tokens) links.push(`<a class="card-link" href="${escapeHtml(href(system.tokens))}">Tokens</a>`);
  if (system.components) links.push(`<a class="card-link" href="${escapeHtml(href(system.components))}">Components</a>`);
  if (!links.length) links.push('<span class="card-link muted">No files</span>');
  const search = [system.name, system.slug, system.category, system.description].join(' ').toLowerCase();
  return `<article class="card" data-slug="${escapeHtml(system.slug)}" data-category="${escapeHtml(system.category)}" data-search="${escapeHtml(search)}">
  <div class="swatches" role="img" aria-label="${escapeHtml(`Palette: ${system.palette.map((swatch) => `${swatch.role} ${swatch.value}`).join(', ') || 'unavailable'}`)}">${swatchHtml}</div>
  <div class="card-body">
    <p class="card-category">${escapeHtml(system.category)}</p>
    <h2 class="card-title"><a href="${escapeHtml(href(system.preview || system.design) || '#')}">${escapeHtml(system.name)}</a></h2>
    <p class="card-description">${escapeHtml(system.description)}</p>
    <div class="card-links">${links.join('')}</div>
  </div>
</article>`;
}

function renderHtml({ systems, categories, title, base, indexMeta }) {
  const cards = systems.map((system) => renderCard(system, base)).join('\n');
  const options = categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  const commit = indexMeta?.source?.commit ? String(indexMeta.source.commit).slice(0, 12) : null;
  const meta = [
    `${systems.length} systems`,
    categories.length ? `${categories.length} categories` : null,
    commit ? `source ${commit}` : null,
  ].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(`${systems.length} design languages with preview, DESIGN.md and tokens.`)}">
<style>
  :root {
    color-scheme: light dark;
    --bg: #f2f2ed;
    --surface: #ffffff;
    --ink: #16181a;
    --ink-soft: #5a615d;
    --line: #d7d7cf;
    --accent: #8f3f26;
    --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --font-body: "Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif;
    --font-mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141614;
      --surface: #1c1f1c;
      --ink: #efefe8;
      --ink-soft: #a6ada6;
      --line: #333834;
      --accent: #d98a63;
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--ink); font-family: var(--font-body); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .shell { max-width: 1320px; margin: 0 auto; padding: clamp(18px, 3vw, 44px) clamp(14px, 3vw, 32px) 64px; display: grid; gap: clamp(16px, 2.4vw, 28px); }
  header.top { display: grid; gap: 10px; padding-bottom: clamp(12px, 2vw, 20px); border-bottom: 1px solid var(--line); }
  .eyebrow { margin: 0; font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
  h1 { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: clamp(1.8rem, 3.4vw, 2.8rem); letter-spacing: -0.015em; line-height: 1.05; }
  .lede { margin: 0; max-width: 62ch; color: var(--ink-soft); }
  .controls { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: end; }
  .field { display: grid; gap: 5px; }
  .field label { font-family: var(--font-mono); font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft); }
  .field input, .field select { font: inherit; font-size: 0.92rem; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 9px 12px; min-width: 12rem; }
  .field input { min-width: min(26rem, 100%); }
  .status { margin: 0 0 3px auto; font-family: var(--font-mono); font-size: 0.76rem; color: var(--ink-soft); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: clamp(12px, 1.8vw, 20px); }
  .card { display: grid; grid-template-rows: auto 1fr; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .swatches { display: flex; height: 56px; }
  .swatch { flex: 1 1 0; position: relative; display: block; }
  .swatch-role {
    position: absolute; bottom: 4px; left: 6px; font-family: var(--font-mono); font-size: 0.58rem; letter-spacing: 0.06em;
    text-transform: uppercase; color: #ffffff; mix-blend-mode: difference; opacity: 0; transition: opacity 120ms ease;
  }
  .swatch:hover .swatch-role { opacity: 1; }
  .swatch-empty { background: repeating-linear-gradient(45deg, var(--line) 0 6px, transparent 6px 12px); }
  .card-body { display: grid; align-content: start; gap: 8px; padding: 16px 18px 18px; }
  .card-category { margin: 0; font-family: var(--font-mono); font-size: 0.64rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-soft); }
  .card-title { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: 1.22rem; line-height: 1.15; letter-spacing: -0.01em; }
  .card-title a { color: inherit; text-decoration: none; }
  .card-title a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .card-description { margin: 0; font-size: 0.86rem; color: var(--ink-soft); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .card-links { display: flex; flex-wrap: wrap; gap: 6px 12px; padding-top: 6px; margin-top: auto; }
  .card-link { font-size: 0.8rem; color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line); padding-bottom: 1px; }
  .card-link:hover { border-color: var(--ink); }
  .card-link.primary { color: var(--accent); border-color: var(--accent); }
  .card-link.muted { color: var(--ink-soft); border-color: transparent; }
  .empty { margin: 0; padding: 36px 0; color: var(--ink-soft); font-size: 0.95rem; }
  footer.foot { border-top: 1px solid var(--line); padding-top: 14px; color: var(--ink-soft); font-size: 0.78rem; }
  @media (prefers-reduced-motion: reduce) { .swatch-role { transition: none; } }
</style>
</head>
<body>
<div class="shell">
  <header class="top">
    <p class="eyebrow">Design languages</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">${escapeHtml(meta)}. Each card links to a rendered preview, the DESIGN.md contract and the token layer. Static page, no external requests.</p>
  </header>
  <div class="controls">
    <div class="field">
      <label for="search">Search</label>
      <input id="search" type="search" placeholder="name, category or description" autocomplete="off">
    </div>
    <div class="field">
      <label for="category">Category</label>
      <select id="category"><option value="">All categories</option>${options}</select>
    </div>
    <p class="status" id="status" role="status" aria-live="polite">${systems.length} of ${systems.length} systems</p>
  </div>
  <main class="grid" id="grid">
${cards}
  </main>
  <p class="empty" id="empty" hidden>No system matches that search. Clear the search or pick another category.</p>
  <footer class="foot">Generated by <code>design-os/tools/gallery.mjs</code>. Preview links open the design-language package pages; links are relative to this file.</footer>
</div>
<script>
  (function () {
    "use strict";
    var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
    var search = document.getElementById("search");
    var category = document.getElementById("category");
    var status = document.getElementById("status");
    var empty = document.getElementById("empty");
    function apply() {
      var query = search.value.trim().toLowerCase();
      var selected = category.value;
      var shown = 0;
      cards.forEach(function (card) {
        var matchesQuery = !query || card.getAttribute("data-search").indexOf(query) !== -1;
        var matchesCategory = !selected || card.getAttribute("data-category") === selected;
        var visible = matchesQuery && matchesCategory;
        card.hidden = !visible;
        if (visible) shown += 1;
      });
      status.textContent = shown + " of " + cards.length + " systems";
      empty.hidden = shown !== 0;
    }
    search.addEventListener("input", apply);
    category.addEventListener("change", apply);
    apply();
  })();
</script>
</body>
</html>
`;
}

/* ────────────────────────────────── CLI ─────────────────────────────────── */

function usage() {
  console.log(`gallery — static design-language gallery

Usage:
  node gallery.mjs [--out=<file>] [options]

Options:
  --index=<file>   index.json to read (default: <repo>/design-languages/index.json)
  --out=<file>     write the gallery here; default prints to stdout
  --base=<prefix>  link prefix for the pack (default: computed from --out or cwd)
  --title=<text>   gallery heading (default: "Dezign0 design languages")
  --json           print a JSON summary instead of the HTML
  --strict         exit 1 when there are warnings
  --help           show this help

The page is one self-contained file: inline CSS/JS, system fonts, CSS swatches,
relative links only. Exit codes: 0 ok, 1 warnings with --strict, 2 read/usage error.`);
}

function parseArgs(argv) {
  const options = { index: DEFAULT_INDEX, out: null, base: null, title: 'Dezign0 design languages', json: false, strict: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    const match = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(arg);
    if (!match) throw new Error(`unexpected argument: ${arg}`);
    const [, key, inline] = match;
    if (!['index', 'out', 'base', 'title'].includes(key)) throw new Error(`unknown option: --${key}`);
    let value = inline;
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined) throw new Error(`--${key} needs a value`);
      index += 1;
    }
    if (key === 'index') options.index = value;
    else if (key === 'out') options.out = value;
    else if (key === 'base') options.base = value;
    else options.title = value;
  }
  return options;
}

export function buildGallery(options = {}) {
  const indexFile = path.resolve(options.index || DEFAULT_INDEX);
  if (!fs.existsSync(indexFile)) throw new Error(`index not found: ${indexFile}`);
  const packRoot = path.dirname(indexFile);
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  } catch (error) {
    throw new Error(`index.json is not valid JSON: ${error.message}`);
  }
  if (!index || !Array.isArray(index.items) || !index.items.length) {
    throw new Error('index.json has no items array');
  }
  const warnings = [];
  if (typeof index.count === 'number' && index.count !== index.items.length) {
    warnings.push(`index.count (${index.count}) does not match items (${index.items.length})`);
  }
  const slugs = new Set();
  const systems = [];
  for (const entry of index.items) {
    if (!entry || typeof entry.slug !== 'string' || !/^[a-z0-9-]+$/.test(entry.slug)) {
      warnings.push('skipped an index entry without a valid slug');
      continue;
    }
    if (slugs.has(entry.slug)) {
      warnings.push(`duplicate slug skipped: ${entry.slug}`);
      continue;
    }
    slugs.add(entry.slug);
    systems.push(buildSystem(entry, packRoot, warnings));
  }
  systems.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const categories = [...new Set(systems.map((system) => system.category))].sort((a, b) => a.localeCompare(b));
  // Links point at the systems root, so a card href is `<base>/<slug>/<file>`.
  const systemsRoot = path.resolve(packRoot, 'design-systems');
  const base = options.base !== null && options.base !== undefined
    ? String(options.base)
    : options.out
      ? toPosix(path.relative(path.dirname(path.resolve(options.out)), systemsRoot)) || '.'
      : toPosix(path.relative(process.cwd(), systemsRoot)) || '.';
  const html = renderHtml({ systems, categories, title: options.title || 'Dezign0 design languages', base, indexMeta: index });
  return { html, systems, categories, warnings, base, indexFile, packRoot, indexMeta: index };
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
  if (options.help) {
    usage();
    return;
  }
  let result;
  try {
    result = buildGallery(options);
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const warnings = [...new Set(result.warnings)].sort();
  let outFile = null;
  if (options.out) {
    outFile = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, result.html);
  }
  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      systems: result.systems.length,
      categories: result.categories.length,
      base: result.base,
      out: outFile,
      bytes: Buffer.byteLength(result.html),
      warnings,
    }, null, 2));
  } else {
    if (outFile) {
      console.log(`${TOOL}: wrote ${path.relative(process.cwd(), outFile) || outFile} (${result.systems.length} systems, ${Buffer.byteLength(result.html)} bytes)`);
      for (const warning of warnings) console.error(`${TOOL}: warning: ${warning}`);
    } else {
      process.stdout.write(result.html);
      for (const warning of warnings) console.error(`${TOOL}: warning: ${warning}`);
    }
  }
  if (options.strict && warnings.length) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath && invokedPath.toLowerCase() === import.meta.url.toLowerCase()) {
  main();
}
