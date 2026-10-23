#!/usr/bin/env node
/**
 * token-export — read a design-system token source and emit a portable token file.
 *
 * Sources (any mix, order = priority):
 *   tokens.css         CSS custom properties; :root = light, .dark/[data-theme="dark"]/
 *                      [data-mode="dark"]/@media (prefers-color-scheme: dark) = dark
 *   design-tokens.json DTCG ($value) or Dezign0 { tokens: [{ name, value }] }
 *   DESIGN.md          fenced ```css``` blocks and | token | value | markdown tables
 *
 * Outputs (--format):
 *   dtcg       W3C Design Tokens Community Group JSON (colours normalised to hex)
 *   tailwind   Tailwind v4 `@theme` block (+ optional dark variant)
 *   shadcn     shadcn/ui CSS variables for :root and .dark
 *   swift      SwiftUI constants (basic)
 *   compose    Jetpack Compose constants (basic)
 *   flutter    Flutter/Dart constants (basic)
 *
 * Usage:
 *   node token-export.mjs <file-or-pack-dir...> [options]
 *
 *   --format=<dtcg|tailwind|shadcn|swift|compose|flutter>  default: dtcg
 *   --platform=<swift|compose|flutter>                     alias for --format
 *   --out=<file>        write the artifact to a file instead of stdout
 *   --resolve           inline resolved values (Tailwind/shadcn) instead of var()
 *   --name=<brand>      namespace/comment label for platform exports
 *   --json              print a JSON summary instead of the artifact
 *   --strict            exit 1 when there are warnings
 *   --help              show this help
 *
 * Deterministic: sources are read in the given order, tokens are sorted, no
 * timestamps are written. Exit codes: 0 ok, 1 warnings with --strict, 2 usage/read error.
 *
 * The CSS/DTCG parsing and colour helpers are exported for token-lint.mjs and
 * ds-validate.mjs (same directory).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL = 'token-export';
const FORMATS = ['dtcg', 'tailwind', 'shadcn', 'swift', 'compose', 'flutter'];
const DARK_CONTEXT_RE = /\.dark\b|\[data-theme\s*[*^$~|]?=\s*["']?dark|\[data-mode\s*[*^$~|]?=\s*["']?dark|prefers-color-scheme\s*:\s*dark/i;

/* ─────────────────────────────── CSS parsing ─────────────────────────────── */

/**
 * Parse CSS custom properties and ordinary declarations with line numbers.
 * Handles nested blocks (@media, @supports, @layer, @theme) and comments.
 * @returns {{tokens: Token[], rules: Rule[], errors: {file:string,line:number,message:string}[]}}
 */
export function parseCssSource(src, file) {
  const tokens = [];
  const rules = [];
  const errors = [];
  let i = 0;
  let line = 1;
  let buf = '';
  let bufLine = 1;
  const stack = [];

  const context = () => stack.map((entry) => entry.selector).filter(Boolean);
  const reset = () => { buf = ''; bufLine = line; };

  function handleDeclaration(text, declLine) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const custom = /^--([A-Za-z0-9_-]+)\s*:\s*([\s\S]+)$/.exec(trimmed);
    if (custom) {
      const value = custom[2].replace(/!important\s*$/i, '').trim();
      const ctx = context().join(' ');
      const mode = DARK_CONTEXT_RE.test(ctx) ? 'dark' : /prefers-reduced-motion\s*:\s*reduce/i.test(ctx) ? 'reduced' : 'light';
      tokens.push({ name: '--' + custom[1], value, file, line: declLine, context: context(), mode });
      return;
    }
    const top = stack[stack.length - 1];
    if (!top) return;
    const colon = trimmed.indexOf(':');
    if (colon === -1) return;
    top.decls.push({
      property: trimmed.slice(0, colon).trim(),
      value: trimmed.slice(colon + 1).trim(),
      file,
      line: declLine,
      selector: top.selector,
      context: context(),
    });
  }

  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      reset();
      continue;
    }
    if (ch === '{') {
      const selector = buf.trim();
      stack.push({ selector, decls: [] });
      reset();
      i += 1;
      continue;
    }
    if (ch === ';') {
      handleDeclaration(buf, bufLine);
      reset();
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (buf.trim()) handleDeclaration(buf, bufLine);
      const block = stack.pop();
      if (!block) {
        errors.push({ file, line, message: 'unbalanced closing brace' });
      } else {
        const selector = block.selector && block.selector.trim();
        if (selector && block.decls.length && !selector.startsWith('@')) {
          for (const decl of block.decls) rules.push(decl);
        }
      }
      reset();
      i += 1;
      continue;
    }
    if (!buf) bufLine = line;
    buf += ch;
    i += 1;
  }
  if (buf.trim()) handleDeclaration(buf, bufLine);
  if (stack.length) {
    for (const open of stack) {
      errors.push({ file, line, message: `unclosed block "${open.selector || '?'}"` });
    }
  }
  return { tokens, rules, errors };
}

/** Extract the contents of every <style> block in an HTML document. */
export function extractStyleBlocks(html) {
  const blocks = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = re.exec(html))) blocks.push(match[1]);
  return blocks;
}

/* ─────────────────────────── DTCG / JSON parsing ─────────────────────────── */

const DTCG_DIMENSION = /^(-?\d*\.?\d+)(px|rem|em|%)$/;
const DTCG_DURATION = /^(-?\d*\.?\d+)(ms|s)$/;

function dtcgScalarToCss(value, type) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (type === 'cubicBezier' || (value.length === 4 && value.every((n) => typeof n === 'number'))) {
      return `cubic-bezier(${value.join(', ')})`;
    }
    if (type === 'fontFamily') return value.join(', ');
    return value.join(' ');
  }
  if (typeof value === 'object') {
    if ('value' in value && 'unit' in value) {
      const unit = value.unit === 'ms' ? 'ms' : value.unit;
      return `${value.value}${unit}`;
    }
    if ('color' in value && ('offsetX' in value || 'blur' in value)) {
      const dim = (v) => (v && typeof v === 'object' && 'value' in v ? `${v.value}${v.unit || 'px'}` : String(v ?? 0));
      return [dim(value.offsetX), dim(value.offsetY), dim(value.blur), dim(value.spread), value.color]
        .filter((part) => part && part !== '0px' || part === value.color)
        .join(' ')
        .trim();
    }
  }
  return '';
}

function parseDtcgNode(node, pathParts, inheritedType, out, file) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return;
  const type = node.$type || inheritedType;
  if ('$value' in node) {
    const name = '--' + pathParts.join('-');
    const value = dtcgScalarToCss(node.$value, type);
    if (value) out.push({ name, value, file, line: 1, context: [], mode: 'light', typeHint: type });
    return;
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('$')) continue;
    parseDtcgNode(node[key], [...pathParts, key], type, out, file);
  }
}

/** Parse design-tokens.json: DTCG, upstream catalog {tokens:[...]}, or a flat map. */
export function parseTokensJson(parsed, file) {
  const out = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (entry && typeof entry.name === 'string' && entry.value !== undefined) {
        out.push({ name: entry.name.startsWith('--') ? entry.name : `--${entry.name}`, value: String(entry.value), file, line: 1, context: [], mode: 'light', typeHint: entry.type });
      }
    }
    return { tokens: out, rules: [], errors: [] };
  }
  if (parsed && Array.isArray(parsed.tokens)) {
    for (const entry of parsed.tokens) {
      if (!entry || typeof entry.name !== 'string' || entry.value === undefined) continue;
      out.push({ name: entry.name.startsWith('--') ? entry.name : `--${entry.name}`, value: String(entry.value), file, line: 1, context: [], mode: 'light', typeHint: entry.type });
    }
    return { tokens: out, rules: [], errors: [] };
  }
  if (parsed && typeof parsed === 'object' && '$value' in parsed) {
    parseDtcgNode(parsed, [], parsed.$type, out, file);
    return { tokens: out, rules: [], errors: [] };
  }
  if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        out.push({ name: key.startsWith('--') ? key : `--${key}`, value, file, line: 1, context: [], mode: 'light' });
      }
    }
  }
  return { tokens: out, rules: [], errors: [] };
}

/* ────────────────────────────── Markdown parsing ─────────────────────────── */

/** Parse DESIGN.md fenced CSS and token tables. */
export function parseDesignMarkdown(text, file) {
  const tokens = [];
  const fence = /```(?:css|sass|scss|less)?\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = fence.exec(text))) {
    const inner = match[1];
    if (!/--[A-Za-z0-9_-]+\s*:/.test(inner)) continue;
    const parsed = parseCssSource(inner, file);
    for (const token of parsed.tokens) tokens.push(token);
  }
  const lines = text.split(/\r?\n/);
  let columns = null;
  for (let index = 0; index < lines.length; index += 1) {
    const cells = lines[index].trim().startsWith('|')
      ? lines[index].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim().toLowerCase())
      : null;
    if (cells) {
      if (!columns) {
        const nameCol = cells.findIndex((cell) => /^(token|name|variable)$/.test(cell));
        const valueCol = cells.findIndex((cell) => /^(value|hex|default|light)$/.test(cell));
        if (nameCol !== -1 && valueCol !== -1) columns = { nameCol, valueCol };
        continue;
      }
      const raw = lines[index].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim().replace(/^`+|`+$/g, ''));
      if (!raw[columns.nameCol] || !raw[columns.valueCol]) continue;
      const name = raw[columns.nameCol];
      if (!/^--[A-Za-z0-9_-]+$/.test(name)) continue;
      tokens.push({ name, value: raw[columns.valueCol], file, line: index + 1, context: [], mode: 'light' });
    } else if (columns) {
      columns = null;
    }
  }
  return { tokens, rules: [], errors: [] };
}

/* ─────────────────────────────── Collecting ──────────────────────────────── */

/** Parse one token file by extension. */
export function parseTokenFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { tokens: [], rules: [], errors: [{ file, line: 1, message: `invalid JSON: ${error.message}` }] };
    }
    return parseTokensJson(parsed, file);
  }
  if (ext === '.md' || ext === '.mdx') return parseDesignMarkdown(raw, file);
  if (ext === '.html' || ext === '.htm') {
    const merged = { tokens: [], rules: [], errors: [] };
    for (const block of extractStyleBlocks(raw)) {
      const parsed = parseCssSource(block, file);
      merged.tokens.push(...parsed.tokens);
      merged.rules.push(...parsed.rules);
      merged.errors.push(...parsed.errors);
    }
    return merged;
  }
  return parseCssSource(raw, file);
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Files a directory input expands to (token sources, ordered by priority). */
export function sourceFilesFor(target) {
  if (!isDirectory(target)) return [target];
  const candidates = ['tokens.css', 'design-tokens.json', 'DESIGN.md'];
  const files = candidates.map((name) => path.join(target, name)).filter((file) => fs.existsSync(file));
  return files;
}

/**
 * Read and merge token sources. First source wins on conflicts.
 * @returns {{tokens: Token[], byName: Map<string,Token>, dark: Map<string,Token>,
 *   rules: Rule[], files: string[], warnings: string[], errors: {file:string,line:number,message:string}[]}}
 */
export function collectSources(inputs) {
  const tokens = [];
  const byName = new Map();
  const dark = new Map();
  const rules = [];
  const files = [];
  const warnings = [];
  const errors = [];

  for (const input of inputs) {
    const expanded = sourceFilesFor(input);
    if (!expanded.length) {
      errors.push({ file: input, line: 1, message: 'no token source found (expected tokens.css, design-tokens.json or DESIGN.md)' });
      continue;
    }
    for (const file of expanded) {
      let parsed;
      try {
        parsed = parseTokenFile(file);
      } catch (error) {
        errors.push({ file, line: 1, message: error.message });
        continue;
      }
      files.push(file);
      errors.push(...parsed.errors);
      for (const rule of parsed.rules) rules.push(rule);
      for (const token of parsed.tokens) {
        if (token.mode === 'reduced') continue; // motion overrides are not theme tokens
        const target = token.mode === 'dark' ? dark : byName;
        const existing = target.get(token.name);
        if (existing && normalizeTokenValue(existing.value) !== normalizeTokenValue(token.value)) {
          warnings.push(`${token.name}: keeping ${existing.value} from ${short(existing.file)} (ignoring ${token.value} from ${short(file)})`);
          continue;
        }
        if (!existing) {
          target.set(token.name, token);
          if (token.mode !== 'dark') tokens.push(token);
        }
      }
    }
  }
  return { tokens, byName, dark, rules, files, warnings, errors };
}

function short(file) {
  const rel = path.relative(process.cwd(), file);
  return rel && rel.length < file.length ? rel : file;
}

/* ─────────────────────────────── Colour math ─────────────────────────────── */

function clamp(value, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(value) {
  const trimmed = String(value).trim();
  if (trimmed.endsWith('%')) return parseFloat(trimmed) / 100;
  return parseFloat(trimmed);
}

/** Parse a CSS colour to {r,g,b,a} (0-255, a 0-1). Returns null when unsupported. */
export function parseColor(value) {
  if (!value) return null;
  const input = String(value).trim().toLowerCase();
  if (input === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (input === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (input === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (input === 'currentcolor' || input.startsWith('color-mix(') || input.startsWith('var(')) return null;

  const hex = /^#([0-9a-f]{3,8})$/.exec(input);
  if (hex) {
    const digits = hex[1];
    const expand = (ch) => parseInt(ch + ch, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]),
        g: expand(digits[1]),
        b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^([a-z]+)\(([^)]*)\)$/.exec(input);
  if (!fn) return null;
  const name = fn[1];
  const body = fn[2].replace(/\//g, ' / ');
  const parts = body.split(/\s+(?![^()]*\))/).filter(Boolean);
  const args = parts.flatMap((part) => part.split(',')).map((part) => part.trim()).filter(Boolean);
  if (args.length < 3) return null;

  if (name === 'rgb' || name === 'rgba') {
    const alpha = args[3] !== undefined ? parseNumber(args[3]) : 1;
    return { r: clamp(Math.round(parseNumber(args[0]))), g: clamp(Math.round(parseNumber(args[1]))), b: clamp(Math.round(parseNumber(args[2]))), a: clamp(alpha, 0, 1) };
  }
  if (name === 'hsl' || name === 'hsla') {
    const h = ((parseNumber(args[0]) % 360) + 360) % 360;
    const s = Math.min(1, Math.max(0, parseNumber(args[1])));
    const l = Math.min(1, Math.max(0, parseNumber(args[2])));
    const alpha = args[3] !== undefined ? parseNumber(args[3]) : 1;
    return { ...hslToRgb(h, s, l), a: clamp(alpha, 0, 1) };
  }
  if (name === 'oklch' || name === 'oklab') {
    const l = parseNumber(args[0]);
    let a;
    let b;
    if (name === 'oklch') {
      const c = parseNumber(args[1]);
      const h = ((parseNumber(args[2]) % 360) + 360) % 360;
      const rad = (h * Math.PI) / 180;
      a = c * Math.cos(rad);
      b = c * Math.sin(rad);
    } else {
      a = parseNumber(args[1]);
      b = parseNumber(args[2]);
    }
    const alpha = args[3] !== undefined ? parseNumber(args[3]) : 1;
    return { ...oklabToRgb(l, a, b), a: clamp(alpha, 0, 1) };
  }
  return null;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = table[sector];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function oklabToRgb(L, a, b) {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  const gamma = (value) => {
    const v = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  return { r: gamma(linear[0]), g: gamma(linear[1]), b: gamma(linear[2]) };
}

/** Hex string from {r,g,b,a}; drops alpha when opaque. */
export function colorToHex(color) {
  const hex = (n) => clamp(Math.round(n)).toString(16).padStart(2, '0');
  return color.a < 1 ? `#${hex(color.r)}${hex(color.g)}${hex(color.b)}${hex(color.a * 255)}` : `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours; alpha is composited over `against`. */
export function contrastRatio(foreground, background) {
  if (!foreground || !background) return null;
  const composite = (fg, bg) => {
    const a = fg.a ?? 1;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  };
  const fg = composite(foreground, background);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function formatRatio(value) {
  return value === null ? 'n/a' : `${value.toFixed(2)}:1`;
}

/* ────────────────────────────── Type helpers ─────────────────────────────── */

/** Infer a DTCG type for a token from its name and value. */
export function inferType(name, value, hint) {
  const known = ['color', 'dimension', 'fontFamily', 'number', 'duration', 'cubicBezier', 'shadow', 'string'];
  if (hint && known.includes(hint)) return hint;
  const input = String(value || '').trim();
  const bare = name.replace(/^--/, '');
  if (parseColor(input)) return 'color';
  if (/^cubic-bezier\(/i.test(input)) return 'cubicBezier';
  if (/^-?\d*\.?\d+(ms|s)$/i.test(input)) return 'duration';
  if (/^-?\d*\.?\d+(px|rem|em|%|vw|vh|ch)$/i.test(input)) return 'dimension';
  if (/^(none|0)$/i.test(input) && /shadow|elev/.test(bare)) return 'shadow';
  if (/-?(px|rem|em)?\s*.*(rgba?\(|#[0-9a-f]{3,8})/i.test(input) && /shadow|elev|focus-ring/.test(bare)) return 'shadow';
  if (/font|typeface/.test(bare)) return 'fontFamily';
  if (/,/.test(input) && /(serif|sans|mono|system-ui|Inter|Georgia|Helvetica|Arial)/i.test(input)) return 'fontFamily';
  if (/^-?\d*\.?\d+$/.test(input)) return 'number';
  return 'string';
}

/** Resolve var(--x) chains against a token map. */
export function resolveValue(value, byName, seen = new Set()) {
  const input = String(value || '').trim();
  const direct = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(input);
  if (direct) {
    const [, name, fallback] = direct;
    if (seen.has(name)) return { value: fallback || input, resolved: false, chain: [...seen, name] };
    const token = byName.get(name);
    if (!token) {
      if (fallback) return resolveValue(fallback, byName, new Set([...seen, name]));
      return { value: input, resolved: false, chain: [...seen, name] };
    }
    const next = resolveValue(token.value, byName, new Set([...seen, name]));
    return { value: next.value, resolved: next.resolved, chain: [name, ...next.chain] };
  }
  if (input.startsWith('color-mix(')) return { value: input, resolved: false, chain: [] };
  return { value: input, resolved: true, chain: [] };
}

export function cssify(name) {
  return name;
}

/** Collapse whitespace so formatting-only differences are not token conflicts. */
export function normalizeTokenValue(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/* ─────────────────────────────── DTCG export ─────────────────────────────── */

function dtcgValue(type, value) {
  if (type === 'color') {
    const color = parseColor(value);
    return color ? colorToHex(color) : null;
  }
  if (type === 'dimension') {
    const match = DTCG_DIMENSION.exec(String(value).trim());
    if (!match) return null;
    return { value: Number(match[1]), unit: match[2] };
  }
  if (type === 'duration') {
    const match = DTCG_DURATION.exec(String(value).trim());
    if (!match) return null;
    return { value: Number(match[1]), unit: match[2] };
  }
  if (type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (type === 'cubicBezier') {
    const match = /cubic-bezier\(([\s\S]+)\)/i.exec(String(value));
    if (!match) return null;
    const points = match[1].split(',').map((part) => Number(part.trim()));
    return points.length === 4 && points.every((point) => Number.isFinite(point)) ? points : null;
  }
  if (type === 'shadow') {
    if (String(value).trim() === 'none') {
      return { color: '#00000000', offsetX: { value: 0, unit: 'px' }, offsetY: { value: 0, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 0, unit: 'px' } };
    }
    const shadow = String(value);
    const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(shadow);
    if (!color) return null;
    const parsed = parseColor(color[1]);
    if (!parsed) return null;
    // CSS order: offset-x offset-y blur spread (unitless 0 is valid).
    const rest = shadow.slice(0, color.index) + shadow.slice(color.index + color[0].length);
    const parts = rest.trim().split(/\s+/).filter(Boolean);
    const lengths = [];
    for (const part of parts) {
      const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(part);
      if (!match) return null;
      const unit = match[2] || 'px';
      if (unit !== 'px') return null;
      lengths.push(Number(match[1]));
    }
    if (lengths.length < 2) return null;
    const [offsetX, offsetY, blur = 0, spread = 0] = lengths;
    return {
      color: colorToHex(parsed),
      offsetX: { value: offsetX, unit: 'px' },
      offsetY: { value: offsetY, unit: 'px' },
      blur: { value: blur, unit: 'px' },
      spread: { value: spread, unit: 'px' },
    };
  }
  return String(value);
}

/** Build a DTCG document from collected tokens. */
export function toDtcg(byName, dark) {
  const groups = new Map();
  const skipped = [];
  const sorted = [...byName.keys()].sort();
  for (const name of sorted) {
    const token = byName.get(name);
    const resolved = resolveValue(token.value, byName);
    const type = inferType(name, resolved.value, token.typeHint);
    const value = dtcgValue(type, resolved.value);
    if (value === null) {
      skipped.push(`${name}: ${token.value} (unresolved or unsupported)`);
      continue;
    }
    const key = name.replace(/^--/, '');
    if (!groups.has(type)) groups.set(type, {});
    groups.get(type)[key] = { $value: value, $type: type };
  }
  const doc = {};
  const order = ['color', 'dimension', 'fontFamily', 'number', 'duration', 'cubicBezier', 'shadow', 'string'];
  for (const type of order) {
    if (!groups.has(type)) continue;
    const entries = groups.get(type);
    const sortedKeys = Object.keys(entries).sort();
    doc[type] = { $type: type };
    for (const key of sortedKeys) doc[type][key] = entries[key];
  }
  if (dark && dark.size) {
    const darkGroups = new Map();
    for (const name of [...dark.keys()].sort()) {
      const token = dark.get(name);
      const resolved = resolveValue(token.value, dark);
      const type = inferType(name, resolved.value, token.typeHint);
      const value = dtcgValue(type, resolved.value);
      if (value === null) continue;
      if (!darkGroups.has(type)) darkGroups.set(type, {});
      darkGroups.get(type)[name.replace(/^--/, '')] = { $value: value, $type: type };
    }
    const modes = {};
    for (const type of order) {
      if (!darkGroups.has(type)) continue;
      const entries = darkGroups.get(type);
      modes[type] = {};
      for (const key of Object.keys(entries).sort()) modes[type][key] = entries[key];
    }
    if (Object.keys(modes).length) {
      doc.$extensions = { 'com.dezign0.modes': { dark: modes } };
    }
  }
  return { output: JSON.stringify(doc, null, 2) + '\n', skipped };
}

/* ───────────────────────────── Tailwind export ───────────────────────────── */

function tailwindVarName(name) {
  const bare = name.replace(/^--/, '');
  if (/^space-/.test(bare)) return `--spacing-${bare.slice(6)}`;
  if (/^spacing-/.test(bare)) return `--spacing-${bare.slice(8)}`;
  if (/^section-y-/.test(bare)) return `--spacing-section-${bare.slice(10)}`;
  if (/^container-gutter-/.test(bare)) return `--spacing-container-${bare.slice(17)}`;
  if (/^container-max$/.test(bare)) return '--container-max';
  return `--${bare}`;
}

export function toTailwind(byName, dark, { resolve = false } = {}) {
  const sorted = [...byName.keys()].sort();
  const lines = [];
  const seen = new Set();
  const skipped = [];
  for (const name of sorted) {
    const token = byName.get(name);
    const resolved = resolveValue(token.value, byName);
    const type = inferType(name, resolved.value, token.typeHint);
    if (type === 'string' && /\s/.test(resolved.value) && !/^(font|ease|leading|tracking)/.test(name.slice(2))) continue;
    const bare = name.replace(/^--/, '');
    let varName;
    if (type === 'color') varName = `--color-${bare}`;
    else if (type === 'fontFamily') varName = `--font-${bare.replace(/^font-/, '')}`;
    else if (type === 'dimension' && /^text-/.test(bare)) varName = `--text-${bare.slice(5)}`;
    else if (type === 'dimension' && /^radius-/.test(bare)) varName = `--radius-${bare.slice(7)}`;
    else if (type === 'duration') varName = `--duration-${bare.replace(/^motion-/, '')}`;
    else if (type === 'cubicBezier') varName = `--ease-${bare.replace(/^ease-/, '')}`;
    else if (type === 'shadow') varName = `--shadow-${bare.replace(/^elev-/, '')}`;
    else if (type === 'number' && /^leading-/.test(bare)) varName = `--leading-${bare.slice(8)}`;
    else if (type === 'dimension' && /^tracking-/.test(bare)) varName = `--tracking-${bare.slice(9)}`;
    else varName = tailwindVarName(name);
    if (seen.has(varName)) { skipped.push(`${name}: duplicate output var ${varName}`); continue; }
    seen.add(varName);
    const value = resolve ? resolved.value : `var(${name})`;
    lines.push([varName, value, name, type]);
  }
  lines.push(['--font-sans', resolve ? (byName.get('--font-body') ? resolveValue(byName.get('--font-body').value, byName).value : 'ui-sans-serif, system-ui, sans-serif') : 'var(--font-body)', '--font-body', 'fontFamily']);
  const theme = lines
    .filter(([, , , type]) => type !== 'string')
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([varName, value]) => `  ${varName}: ${value};`)
    .join('\n');
  const parts = [];
  parts.push('/* Generated by token-export.mjs. Keep tokens.css as the source of truth. */');
  if (!resolve) parts.push('@import "./tokens.css";');
  parts.push('');
  parts.push('@theme {');
  parts.push(theme);
  parts.push('}');
  if (dark && dark.size) {
    const darkLines = [];
    for (const name of [...dark.keys()].sort()) {
      const token = dark.get(name);
      const resolved = resolveValue(token.value, dark);
      const type = inferType(name, resolved.value, token.typeHint);
      if (type !== 'color') continue;
      darkLines.push(`  --color-${name.replace(/^--/, '')}: ${resolve ? resolved.value : `var(${name})`};`);
    }
    if (darkLines.length) {
      parts.push('');
      parts.push('@custom-variant dark (&:where(.dark, .dark *));');
      parts.push('');
      parts.push('/* Combined selector so class, data-theme and data-mode hosts all switch. */');
      parts.push('.dark, [data-theme="dark"], [data-mode="dark"] {');
      parts.push(darkLines.join('\n'));
      parts.push('}');
    }
  }
  return { output: parts.join('\n') + '\n', skipped };
}

/* ────────────────────────────── shadcn export ────────────────────────────── */

const SHADCN_SLOTS = [
  ['background', ['bg', 'background', 'canvas', 'base']],
  ['foreground', ['fg', 'foreground', 'text', 'ink']],
  ['card', ['surface', 'card', 'panel']],
  ['card-foreground', ['fg', 'foreground', 'ink']],
  ['popover', ['surface', 'card', 'panel']],
  ['popover-foreground', ['fg', 'foreground', 'ink']],
  ['primary', ['accent', 'primary', 'brand']],
  ['primary-foreground', ['accent-on', 'accent-foreground', 'on-accent', 'accent-ink']],
  ['secondary', ['surface-warm', 'surface-2', 'secondary', 'surface']],
  ['secondary-foreground', ['fg', 'foreground', 'ink']],
  ['muted', ['surface-warm', 'surface-2', 'muted', 'surface']],
  ['muted-foreground', ['muted', 'muted-fg', 'fg-2', 'text-muted']],
  ['accent', ['hover', 'surface-warm', 'accent-soft', 'surface']],
  ['accent-foreground', ['fg', 'foreground', 'ink']],
  ['destructive', ['danger', 'destructive', 'error']],
  ['destructive-foreground', ['accent-on', 'on-danger', 'fg-on', 'background']],
  ['border', ['border', 'line', 'border-soft']],
  ['input', ['border', 'input', 'border-soft']],
  ['ring', ['ring', 'accent', 'focus']],
];

function findToken(byName, candidates) {
  for (const candidate of candidates) {
    const token = byName.get(`--${candidate}`);
    if (token) return { token, name: `--${candidate}` };
  }
  return null;
}

export function toShadcn(byName, dark, { resolve = true, name = 'tokens' } = {}) {
  const lightLines = [];
  const darkLines = [];
  const used = new Set();
  for (const [slot, candidates] of SHADCN_SLOTS) {
    const found = findToken(byName, candidates);
    if (!found) continue;
    used.add(found.name);
    const resolved = resolveValue(found.token.value, byName);
    lightLines.push([slot, resolved.value]);
    const darkToken = findToken(dark, candidates);
    if (darkToken) {
      used.add(darkToken.name);
      darkLines.push([slot, resolveValue(darkToken.token.value, dark).value]);
    }
  }
  const radiusToken = findToken(byName, ['radius-md', 'radius', 'radius-lg', 'radius-sm']);
  if (radiusToken) {
    const value = resolveValue(radiusToken.token.value, byName).value;
    const px = /^(-?\d*\.?\d+)px$/.exec(value);
    lightLines.push(['radius', px ? `${(Number(px[1]) / 16).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}rem` : value]);
    used.add(radiusToken.name);
  }
  const extras = [];
  for (const [tokenName, token] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (used.has(tokenName)) continue;
    const resolved = resolveValue(token.value, byName);
    const type = inferType(tokenName, resolved.value, token.typeHint);
    if (type !== 'color') continue;
    extras.push([tokenName.replace(/^--/, ''), resolved.value]);
  }
  const header = [
    `/* shadcn/ui variables generated by token-export.mjs from ${name}. */`,
    '/* Values are resolved colours; keep the source token file authoritative. */',
    '',
  ];
  const format = (entries) => entries.map(([slot, value]) => `  --${slot}: ${value};`).join('\n');
  const parts = [...header];
  parts.push(':root {');
  parts.push(format(lightLines));
  if (extras.length) parts.push('  /* additional brand tokens */\n' + format(extras));
  parts.push('}');
  if (darkLines.length) {
    parts.push('');
    parts.push('.dark {');
    parts.push(format(darkLines));
    parts.push('}');
  }
  return { output: parts.join('\n') + '\n', skipped: [] };
}

/* ───────────────────────────── platform exports ──────────────────────────── */

function camelCase(name) {
  return name
    .replace(/^--/, '')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+([a-zA-Z0-9])/g, (_, ch) => ch.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function pascalCase(name) {
  const camel = camelCase(name || 'tokens');
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function sortNumeric(entries) {
  return entries.sort((a, b) => {
    const an = /-(\d+)$/.exec(a[0]);
    const bn = /-(\d+)$/.exec(b[0]);
    if (an && bn) return Number(an[1]) - Number(bn[1]);
    if (an) return -1;
    if (bn) return 1;
    return a[0].localeCompare(b[0]);
  });
}

function collectPlatformValues(byName) {
  const colors = [];
  const dimensions = [];
  const skipped = [];
  for (const name of [...byName.keys()].sort()) {
    const token = byName.get(name);
    const resolved = resolveValue(token.value, byName);
    const type = inferType(name, resolved.value, token.typeHint);
    const value = resolved.value.trim();
    if (type === 'color') {
      const color = parseColor(value);
      if (color) colors.push([camelCase(name), color]);
      else skipped.push(`${name}: ${value} (not a static colour)`);
    } else if (type === 'dimension') {
      if (/^--tracking/.test(name)) continue; // letter-spacing is not a CGFloat dimension
      const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value);
      if (match) {
        const amount = Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
        dimensions.push([camelCase(name), amount]);
      } else {
        skipped.push(`${name}: ${value} (unsupported unit)`);
      }
    }
  }
  return { colors, dimensions: sortNumeric(dimensions), skipped };
}

function swiftNumber(value) {
  return Number(value.toFixed(3));
}

export function toSwift(byName, { name = 'tokens' } = {}) {
  const { colors, dimensions, skipped } = collectPlatformValues(byName);
  const enumName = `${pascalCase(name)}Tokens`;
  const lines = [
    '// Generated by token-export.mjs. Basic export: review names and types before shipping.',
    'import SwiftUI',
    '',
    `enum ${enumName} {`,
  ];
  lines.push('    struct Colors {');
  for (const [key, color] of colors) {
    lines.push(`        static let ${key} = Color(red: ${swiftNumber(color.r / 255)}, green: ${swiftNumber(color.g / 255)}, blue: ${swiftNumber(color.b / 255)}, opacity: ${swiftNumber(color.a)})`);
  }
  lines.push('    }');
  const spacing = dimensions.filter(([key]) => /^(space|spacing|gap|section|container)/.test(key));
  const radius = dimensions.filter(([key]) => /^radius/.test(key));
  const type = dimensions.filter(([key]) => /^text/.test(key));
  if (spacing.length) {
    lines.push('');
    lines.push('    struct Spacing {');
    for (const [key, value] of spacing) lines.push(`        static let ${key}: CGFloat = ${value}`);
    lines.push('    }');
  }
  if (radius.length) {
    lines.push('');
    lines.push('    struct Radius {');
    for (const [key, value] of radius) lines.push(`        static let ${key.replace(/^radius/, 'radius')}: CGFloat = ${value}`);
    lines.push('    }');
  }
  if (type.length) {
    lines.push('');
    lines.push('    struct Typography {');
    for (const [key, value] of type) lines.push(`        static let ${key}: CGFloat = ${value}`);
    lines.push('    }');
  }
  lines.push('}');
  return { output: lines.join('\n') + '\n', skipped };
}

function composeColor(color) {
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  const alpha = Math.round((color.a ?? 1) * 255).toString(16).padStart(2, '0').toUpperCase();
  const argb = `${alpha}${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
  return `Color(0x${argb})`;
}

export function toCompose(byName, { name = 'tokens' } = {}) {
  const { colors, dimensions, skipped } = collectPlatformValues(byName);
  const objectName = pascalCase(name);
  const lines = [
    '// Generated by token-export.mjs. Basic export: review package, names and types before shipping.',
    `package com.dezign0.${camelCase(name).toLowerCase()}`,
    '',
    'import androidx.compose.ui.graphics.Color',
    'import androidx.compose.ui.unit.dp',
    'import androidx.compose.ui.unit.sp',
    '',
    `object ${objectName}Tokens {`,
  ];
  lines.push('    object Colors {');
  for (const [key, color] of colors) lines.push(`        val ${key} = ${composeColor(color)}`);
  lines.push('    }');
  const spacing = dimensions.filter(([key]) => /^(space|spacing|gap|section|container)/.test(key));
  const radius = dimensions.filter(([key]) => /^radius/.test(key));
  const type = dimensions.filter(([key]) => /^text/.test(key));
  if (spacing.length) {
    lines.push('');
    lines.push('    object Spacing {');
    for (const [key, value] of spacing) lines.push(`        val ${key} = ${value}.dp`);
    lines.push('    }');
  }
  if (radius.length) {
    lines.push('');
    lines.push('    object Radius {');
    for (const [key, value] of radius) lines.push(`        val ${key} = ${value}.dp`);
    lines.push('    }');
  }
  if (type.length) {
    lines.push('');
    lines.push('    object Typography {');
    for (const [key, value] of type) lines.push(`        val ${key} = ${value}.sp`);
    lines.push('    }');
  }
  lines.push('}');
  return { output: lines.join('\n') + '\n', skipped };
}

function dartColor(color) {
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  const alpha = Math.round((color.a ?? 1) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `Color(0x${alpha}${hex(color.r)}${hex(color.g)}${hex(color.b)})`;
}

export function toFlutter(byName, { name = 'tokens' } = {}) {
  const { colors, dimensions, skipped } = collectPlatformValues(byName);
  const className = `${pascalCase(name)}Tokens`;
  const lines = [
    '// Generated by token-export.mjs. Basic export: review names and types before shipping.',
    "import 'dart:ui';",
    '',
    `class ${className} {`,
    `  ${className}._();`,
  ];
  for (const [key, color] of colors) lines.push(`  static const Color ${key} = ${dartColor(color)};`);
  for (const [key, value] of dimensions) lines.push(`  static const double ${key} = ${value};`);
  lines.push('');
  lines.push('  static const Map<String, Color> colors = <String, Color>{');
  for (const [key] of colors) lines.push(`    '${key}': ${key},`);
  lines.push('  };');
  lines.push('}');
  return { output: lines.join('\n') + '\n', skipped };
}

/* ────────────────────────────────── CLI ──────────────────────────────────── */

function usage() {
  console.log(`token-export — portable token exports

Usage:
  node token-export.mjs <file-or-pack-dir...> [options]

Sources: tokens.css, design-tokens.json (DTCG or {tokens:[...]}), DESIGN.md.
A directory input reads tokens.css, design-tokens.json and DESIGN.md in that order.
First source wins on conflicting values.

Options:
  --format=<${FORMATS.join('|')}>   default: dtcg
  --platform=<swift|compose|flutter>   alias for --format
  --out=<file>       write the artifact to a file (default: stdout)
  --resolve          inline values in Tailwind/shadcn instead of var()
  --name=<brand>     label used in platform exports and shadcn header
  --json             print a JSON summary instead of the artifact
  --strict           exit 1 when there are warnings
  --help             show this help

Examples:
  node token-export.mjs tokens.css --format=dtcg --out=design-tokens.dtcg.json
  node token-export.mjs tokens.css --format=tailwind --resolve
  node token-export.mjs design-systems/agentic --format=shadcn
  node token-export.mjs tokens.css --platform=swift --name=acme`);
}

function parseArgs(argv) {
  const options = { inputs: [], format: 'dtcg', out: null, resolve: false, name: null, json: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--resolve') { options.resolve = true; continue; }
    if (!arg.startsWith('--')) { options.inputs.push(arg); continue; }
    const match = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(arg);
    if (!match) { throw new Error(`unexpected argument: ${arg}`); }
    const [, key, value] = match;
    if (key === 'format') options.format = value;
    else if (key === 'platform') options.format = value;
    else if (key === 'out') options.out = value;
    else if (key === 'name') options.name = value;
    else throw new Error(`unknown option: --${key}`);
  }
  if (options.help) return options;
  if (!FORMATS.includes(options.format)) {
    throw new Error(`--format must be one of: ${FORMATS.join(', ')}`);
  }
  if (!options.inputs.length) throw new Error('no input files');
  return options;
}

export function exportTokens(options) {
  const collected = collectSources(options.inputs);
  const warnings = [...collected.warnings];
  if (collected.errors.length) {
    return { ok: false, errors: collected.errors, warnings, collected };
  }
  if (!collected.tokens.length) {
    return { ok: false, errors: [{ file: options.inputs.join(','), line: 1, message: 'no tokens found' }], warnings, collected };
  }
  const label = options.name || path.basename(path.dirname(path.resolve(collected.files[0] || '.')) || 'tokens');
  const context = { resolve: options.resolve, name: label };
  let result;
  if (options.format === 'dtcg') result = toDtcg(collected.byName, collected.dark);
  else if (options.format === 'tailwind') result = toTailwind(collected.byName, collected.dark, context);
  else if (options.format === 'shadcn') result = toShadcn(collected.byName, collected.dark, context);
  else if (options.format === 'swift') result = toSwift(collected.byName, context);
  else if (options.format === 'compose') result = toCompose(collected.byName, context);
  else result = toFlutter(collected.byName, context);
  warnings.push(...(result.skipped || []).map((entry) => `skipped: ${entry}`));
  return { ok: true, output: result.output, warnings, collected, format: options.format, label };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`);
    console.error(`Run with --help for usage.`);
    process.exitCode = 2;
    return;
  }
  if (options.help) { usage(); return; }

  const result = exportTokens(options);
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`${TOOL}: ${short(error.file)}:${error.line}: ${error.message}`);
    }
    process.exitCode = 2;
    return;
  }
  for (const warning of result.warnings) console.error(`${TOOL}: warning: ${warning}`);

  const tokenCount = result.collected.byName.size;
  const darkCount = result.collected.dark.size;
  if (options.out) {
    const outPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.output);
    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        format: result.format,
        sources: result.collected.files.map(short),
        tokens: tokenCount,
        darkTokens: darkCount,
        warnings: result.warnings,
        out: outPath,
        bytes: Buffer.byteLength(result.output),
      }, null, 2));
    } else {
      console.log(`${TOOL}: wrote ${short(outPath)} (${tokenCount} tokens${darkCount ? `, ${darkCount} dark` : ''}, ${result.format})`);
    }
  } else if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      format: result.format,
      sources: result.collected.files.map(short),
      tokens: tokenCount,
      darkTokens: darkCount,
      warnings: result.warnings,
      output: result.output,
    }, null, 2));
  } else {
    process.stdout.write(result.output);
  }
  if (options.strict && result.warnings.length) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
const modulePath = import.meta.url;
if (invokedPath && invokedPath.toLowerCase() === modulePath.toLowerCase()) {
  main();
}
