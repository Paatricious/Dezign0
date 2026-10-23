#!/usr/bin/env node
/**
 * conformance — check an artifact against a design system, audit the system's
 * component matrix and theme parity, and validate/register user-supplied systems.
 *
 * Commands:
 *   artifact <file.html...> --system=<dir>   artifact conformance vs tokens.css/DESIGN.md
 *   components --system=<dir>                component x variant x state matrix
 *   themes --system=<dir>                    light / dark / high-contrast parity
 *   system <dir>                             validate a user-supplied system folder
 *   all <file.html...> --system=<dir>        artifact + components + themes
 *
 * Options:
 *   --system=<dir>   Design-system package directory (required unless command is system)
 *   --id=<id>        Expected system id for `system` (default: folder name)
 *   --register       `system` only: write <dir>/CONFORMANCE.json receipt and print
 *                    the catalog entry for design-systems/index.json
 *   --json           machine-readable result instead of the human summary
 *   --strict         fail (exit 1) on P1 findings as well as P0
 *   --out=<file>     write the report: JSON with --json, Markdown otherwise
 *   --help           show this help
 *
 * Exit codes: 0 no blocking findings, 1 blocking findings (P0 always, P1 with
 * --strict), 2 usage/unreadable input.
 *
 * No dependencies. Token parsing, colour math and the CSS parser are imported
 * from token-export.mjs, so this tool and token-lint.mjs share one implementation.
 * Findings are heuristic and evidence-first: every finding names a token, class,
 * selector or file:line; a clean run is a floor, not a certificate.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  parseTokenFile,
  parseCssSource,
  parseColor,
  colorToHex,
  contrastRatio,
  formatRatio,
  resolveValue,
  normalizeTokenValue,
} from './token-export.mjs'

const TOOL = 'conformance'
const SCHEMA = 'dezign0/conformance/v1'
const HC_RE = /high-contrast|forced-colors|contrast-more|data-contrast|prefers-contrast/i
const DARK_CLAIM_RE = /\bdark mode\b|\bdark theme\b|\bnight mode\b|prefers-color-scheme\s*:\s*dark/i
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb)\([^)]*\)|\b(?:oklch|oklab)\([^)]*\)/g
const DIM_RE = /^(-?\d*\.?\d+)(px|rem)$/
const SEV_ORDER = { P0: 0, P1: 1, P2: 2 }

const ROLE_CANDIDATES = {
  bg: ['--bg', '--background', '--canvas', '--base'],
  surface: ['--surface', '--card', '--panel'],
  fg: ['--fg', '--foreground', '--ink', '--text'],
  muted: ['--muted', '--fg-2', '--text-muted', '--muted-fg'],
  border: ['--border', '--line', '--border-soft'],
  accent: ['--accent', '--primary', '--brand'],
  accentOn: ['--accent-on', '--accent-foreground', '--on-accent', '--accent-ink', '--primary-foreground'],
  focus: ['--focus-ring', '--ring', '--focus'],
  success: ['--success', '--positive'],
  warn: ['--warn', '--warning'],
  danger: ['--danger', '--destructive', '--error'],
}
const CORE_ROLES = ['bg', 'surface', 'fg', 'muted', 'border', 'accent', 'accentOn', 'focus']
const TEXT_PAIRS = [
  { fg: 'fg', bg: 'bg', min: 4.5, severity: 'P1', label: 'body text on page' },
  { fg: 'fg', bg: 'surface', min: 4.5, severity: 'P1', label: 'body text on surface' },
  { fg: 'muted', bg: 'surface', min: 4.5, severity: 'P1', label: 'muted text on surface' },
  { fg: 'muted', bg: 'bg', min: 4.5, severity: 'P2', label: 'muted text on page' },
  { fg: 'accentOn', bg: 'accent', min: 4.5, severity: 'P1', label: 'ink on accent' },
  { fg: 'focus', bg: 'bg', min: 3, severity: 'P1', label: 'focus ring on page' },
  { fg: 'border', bg: 'surface', min: 3, severity: 'P2', label: 'surface boundary (UI 3:1)' },
  { fg: 'success', bg: 'surface', min: 4.5, severity: 'P2', label: 'success text on surface' },
  { fg: 'warn', bg: 'surface', min: 4.5, severity: 'P2', label: 'warning text on surface' },
  { fg: 'danger', bg: 'surface', min: 4.5, severity: 'P2', label: 'danger text on surface' },
]
const GROUP_REQUIRED = {
  buttons: ['hover', 'focus-visible', 'active', 'disabled'],
  inputs: ['hover', 'focus-visible', 'disabled', 'error'],
  links: ['hover', 'focus-visible', 'active'],
  keyboard: ['focus-visible'],
}
const STATE_SELECTOR_PATTERNS = [
  ['hover', /:hover\b/],
  ['focus-visible', /:focus-visible\b/],
  ['focus', /:focus\b(?!-visible)/],
  ['active', /:active\b/],
  ['disabled', /:disabled\b|\[disabled\]/],
  ['loading', /aria-busy|\.is-loading|\.loading\b|\[data-state=["']?loading/],
  ['error', /aria-invalid|\.is-error|\.error\b|\.field-error|\[data-state=["']?error/],
  ['empty', /\.is-empty|\.empty\b|\[data-state=["']?empty/],
  ['selected', /aria-selected|aria-pressed|\.is-selected|\.selected\b/],
]
const SYSTEM_REQUIRED = ['DESIGN.md', 'tokens.css']
const SYSTEM_OPTIONAL = ['manifest.json', 'design-tokens.json', 'components.html', 'components.manifest.json', 'USAGE.md']

/* ─────────────────────────────── helpers ────────────────────────────────── */

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

function readJsonFile(file) {
  return JSON.parse(readText(file))
}

function shortName(file) {
  const rel = path.relative(process.cwd(), file)
  return rel && rel.length < file.length ? rel : file
}

function lineAt(source, index) {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1
  return line
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unique(list) {
  return [...new Set(list)]
}

function pxValue(value) {
  const match = DIM_RE.exec(String(value).trim())
  if (!match) return null
  return Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
}

/** True when the design doc claims dark mode, ignoring negative statements. */
function claimsDarkMode(text) {
  if (!text) return false
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!/\bdark\s+(mode|theme)\b|prefers-color-scheme\s*:\s*dark/i.test(sentence)) continue
    if (/\b(no|not|without|never|isn'?t|doesn'?t|does not|light[- ]only)\b/i.test(sentence)) continue
    return true
  }
  return false
}

function isInsideVariable(value, index) {
  let depth = 0
  for (let i = 0; i < index; i += 1) {
    if (value.startsWith('var(', i)) depth += 1
    else if (value[i] === ')') depth = Math.max(0, depth - 1)
  }
  return depth > 0
}

/** Findings collector: aggregates repeated evidence and keeps counts. */
function createFindings() {
  const items = []
  const index = new Map()
  function add(severity, id, message, fix, meta = {}) {
    const key = `${severity}|${id}|${meta.key || message}`
    const existing = index.get(key)
    if (existing) {
      existing.count += 1
      if (meta.sample && existing.samples.length < 5 && !existing.samples.includes(meta.sample)) existing.samples.push(meta.sample)
      return existing
    }
    const finding = {
      severity,
      id,
      message,
      fix,
      file: meta.file || null,
      line: meta.line || 1,
      count: 1,
      samples: meta.sample ? [meta.sample] : [],
    }
    index.set(key, finding)
    items.push(finding)
    return finding
  }
  return {
    add,
    all: () => items,
    counts: () => ({
      P0: items.filter((item) => item.severity === 'P0').length,
      P1: items.filter((item) => item.severity === 'P1').length,
      P2: items.filter((item) => item.severity === 'P2').length,
    }),
  }
}

function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
      String(a.file || '').localeCompare(String(b.file || '')) ||
      a.line - b.line ||
      a.id.localeCompare(b.id),
  )
}

/** Extract <style> blocks with their starting line in the document. */
function styleBlocks(html) {
  const blocks = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let match
  while ((match = re.exec(html))) {
    blocks.push({ css: match[1], startLine: lineAt(html, match.index) })
  }
  return blocks
}

/** Parse CSS selectors (comma-split) without needing full selector parsing. */
function selectorList(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  const re = /([^{}]+)\{/g
  let match
  while ((match = re.exec(withoutComments))) {
    const prelude = match[1].trim()
    if (!prelude || prelude.startsWith('@')) continue
    for (const part of prelude.split(',')) {
      const selector = part.trim().replace(/\s+/g, ' ')
      if (selector) selectors.push(selector)
    }
  }
  return selectors
}

function classesInMarkup(html) {
  const counts = new Map()
  const re = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi
  let match
  while ((match = re.exec(html))) {
    const value = match[2] ?? match[3] ?? ''
    for (const token of value.split(/\s+/)) if (token) counts.set(token, (counts.get(token) || 0) + 1)
  }
  return counts
}

function selectorHasClass(selector, className) {
  const escaped = escapeRegExp(className)
  const re = new RegExp(`(?:^|[\\s>+~,()])\\.${escaped}(?=$|[\\s>+~,()\\[\\]:.#])`)
  return re.test(selector)
}

function statesFromSelector(selector) {
  const states = []
  for (const [state, pattern] of STATE_SELECTOR_PATTERNS) if (pattern.test(selector)) states.push(state)
  return states
}

function statesFromMarkup(fragment) {
  const states = []
  if (/\bdisabled\b/i.test(fragment)) states.push('disabled')
  if (/aria-busy/i.test(fragment) || /is-loading|class="[^"]*\bloading\b/i.test(fragment)) states.push('loading')
  if (/aria-invalid/i.test(fragment) || /is-error|field-error|class="[^"]*\berror\b/i.test(fragment)) states.push('error')
  if (/aria-selected|aria-pressed|is-selected|class="[^"]*\bselected\b/i.test(fragment)) states.push('selected')
  if (/is-empty|class="[^"]*\bempty\b/i.test(fragment)) states.push('empty')
  return states
}

function groupFragments(html, classes) {
  const fragments = []
  const re = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi
  let match
  while ((match = re.exec(html))) {
    const value = match[2] ?? match[3] ?? ''
    const tokens = value.split(/\s+/)
    if (!tokens.some((token) => classes.includes(token))) continue
    fragments.push(html.slice(Math.max(0, match.index - 320), Math.min(html.length, match.index + 640)))
  }
  return fragments
}

/* ─────────────────────────── system loading ─────────────────────────────── */

function modeMap(system, mode) {
  const maps = system.tokens && system.tokens.light ? system.tokens : system
  return mode === 'dark' ? maps.dark : mode === 'high-contrast' ? maps.highContrast : maps.light
}

function findRoleName(system, role) {
  const candidates = ROLE_CANDIDATES[role] || []
  const maps = system.tokens && system.tokens.light ? system.tokens : system
  for (const candidate of candidates) {
    if (maps.light.has(candidate)) return candidate
  }
  for (const candidate of candidates) {
    if (maps.dark.has(candidate) || maps.highContrast.has(candidate)) return candidate
  }
  return null
}

function resolveIn(system, mode, name) {
  const maps = system.tokens && system.tokens.light ? system.tokens : system
  const map = modeMap(system, mode)
  const token = map.get(name) || maps.light.get(name)
  if (!token) return null
  const merged = new Map([...maps.light, ...map])
  const resolved = resolveValue(token.value, merged)
  return { token, name, value: resolved.value, resolved: resolved.resolved, mode }
}

function hasInMode(system, mode, name) {
  return modeMap(system, mode).has(name)
}

function resolveRole(system, mode, role) {
  const name = findRoleName(system, role)
  if (!name) return null
  const resolved = resolveIn(system, mode, name)
  if (!resolved) return null
  return { name, ...resolved }
}

function roleColor(system, mode, role) {
  const resolved = resolveRole(system, mode, role)
  if (!resolved) return null
  const color = parseColor(resolved.value)
  return color ? { ...resolved, color } : null
}

function findUp(start, names, levels = 3) {
  let current = path.resolve(start)
  const root = path.parse(current).root
  for (let depth = 0; depth <= levels; depth += 1) {
    for (const name of names) {
      const candidate = path.join(current, name)
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    }
    if (current === root) break
    current = path.dirname(current)
  }
  return null
}

function categorizeTokens(parsedTokens) {
  const light = new Map()
  const dark = new Map()
  const highContrast = new Map()
  for (const token of parsedTokens) {
    if (token.mode === 'reduced') continue
    const context = (token.context || []).join(' ')
    const target = HC_RE.test(context) ? highContrast : token.mode === 'dark' ? dark : light
    if (!target.has(token.name)) target.set(token.name, token)
  }
  return { light, dark, highContrast }
}

/** Load and lightly validate a system package. Shared by every command. */
function loadSystem(dir, options = {}) {
  const findings = createFindings()
  const systemDir = path.resolve(dir)
  const result = {
    dir: systemDir,
    id: options.id || path.basename(systemDir),
    name: null,
    manifest: null,
    componentsManifest: null,
    componentsHtml: null,
    tokensCss: null,
    designText: null,
    tokens: { light: new Map(), dark: new Map(), highContrast: new Map() },
    tokenList: [],
    license: null,
    notice: null,
    files: {},
    tokenErrors: [],
    findings,
  }
  if (!isDirectory(systemDir)) {
    findings.add('P0', 'not-a-directory', `${systemDir} is not a directory.`, 'Pass a design-system package directory.', { file: systemDir, key: 'not-a-directory' })
    result.fatal = true
    return result
  }

  for (const name of SYSTEM_REQUIRED) {
    const file = path.join(systemDir, name)
    result.files[name] = fs.existsSync(file) ? file : null
    if (!fs.existsSync(file)) {
      findings.add('P0', 'missing-required-file', `Missing required file ${name}.`, 'A system package needs DESIGN.md and tokens.css.', { file, key: `missing-${name}` })
    }
  }
  for (const name of SYSTEM_OPTIONAL) {
    const file = path.join(systemDir, name)
    result.files[name] = fs.existsSync(file) ? file : null
    if (!fs.existsSync(file)) {
      findings.add('P2', 'missing-optional-file', `Missing ${name}.`, 'Add it when the system is shared or registered.', { file, key: `optional-${name}` })
    }
  }

  if (result.files['DESIGN.md']) {
    result.designText = readText(result.files['DESIGN.md'])
    if (result.designText.trim().length < 200) {
      findings.add('P2', 'thin-design-md', 'DESIGN.md is very short.', 'Document intent, colour roles, type, spacing, components and do/don\'t.', { file: result.files['DESIGN.md'], key: 'thin-design' })
    }
  }

  if (result.files['tokens.css']) {
    try {
      const parsed = parseTokenFile(result.files['tokens.css'])
      result.tokenList = parsed.tokens
      result.tokenErrors = parsed.errors || []
      for (const error of result.tokenErrors) {
        findings.add('P0', 'bad-token-source', `tokens.css parse error: ${error.message}`, 'Fix the CSS so every block is balanced.', { file: error.file, line: error.line, key: `css-${error.line}` })
      }
      const grouped = categorizeTokens(parsed.tokens)
      result.tokens = grouped
      if (!grouped.light.size) {
        findings.add('P0', 'no-tokens', 'tokens.css declares no custom properties.', 'Declare a :root token block.', { file: result.files['tokens.css'], key: 'no-tokens' })
      }
    } catch (error) {
      findings.add('P0', 'unreadable-tokens', `Cannot read tokens.css: ${error.message}`, 'Fix the file encoding or permissions.', { file: result.files['tokens.css'], key: 'unreadable-tokens' })
    }
  }

  if (result.files['manifest.json']) {
    try {
      result.manifest = readJsonFile(result.files['manifest.json'])
    } catch (error) {
      findings.add('P0', 'invalid-manifest', `manifest.json is not valid JSON: ${error.message}`, 'Fix the JSON syntax.', { file: result.files['manifest.json'], key: 'invalid-manifest' })
    }
  }
  if (result.manifest) {
    const manifestPath = result.files['manifest.json']
    if (typeof result.manifest.id !== 'string' || !result.manifest.id) {
      findings.add('P1', 'manifest-id-missing', 'manifest.json has no id.', 'Set a kebab-case id matching the folder name.', { file: manifestPath, key: 'manifest-id' })
    } else {
      result.id = result.manifest.id
      if (!/^[a-z0-9-]+$/.test(result.manifest.id)) {
        findings.add('P1', 'manifest-id-format', `manifest.id "${result.manifest.id}" is not kebab-case.`, 'Use lowercase letters, digits and hyphens.', { file: manifestPath, key: 'manifest-id-format' })
      }
      const expected = options.id || path.basename(systemDir)
      if (result.manifest.id !== expected) {
        findings.add('P1', 'manifest-id-mismatch', `manifest.id "${result.manifest.id}" does not match the folder "${expected}".`, 'Align the id with the folder, or pass --id=<id> when the rename is intentional.', { file: manifestPath, key: 'manifest-id-mismatch' })
      }
    }
    if (typeof result.manifest.name === 'string') result.name = result.manifest.name
    if (typeof result.manifest.schemaVersion !== 'string' || !result.manifest.schemaVersion) {
      findings.add('P1', 'manifest-schema-missing', 'manifest.json has no schemaVersion.', 'Declare the package schema version.', { file: manifestPath, key: 'manifest-schema' })
    }
    if (result.manifest.files && typeof result.manifest.files === 'object' && !Array.isArray(result.manifest.files)) {
      for (const [role, rel] of Object.entries(result.manifest.files)) {
        if (typeof rel !== 'string' || !rel) {
          findings.add('P1', 'manifest-file-role', `manifest.files.${role} is not a path string.`, 'Use a relative path.', { file: manifestPath, key: `file-role-${role}` })
          continue
        }
        const resolved = path.resolve(systemDir, rel)
        if (!resolved.startsWith(systemDir + path.sep)) {
          findings.add('P0', 'path-escape', `manifest.files.${role} escapes the package: ${rel}.`, 'Keep every referenced file inside the package.', { file: manifestPath, key: `escape-${role}` })
        } else if (!fs.existsSync(resolved)) {
          findings.add('P1', 'manifest-file-missing', `manifest.files.${role} points at a missing file: ${rel}.`, 'Ship the file or remove the reference.', { file: resolved, key: `missing-${role}` })
        }
      }
    } else {
      findings.add('P2', 'manifest-files-missing', 'manifest.json has no files map.', 'List the package files a consumer should read.', { file: manifestPath, key: 'files-map' })
    }
  }

  if (result.files['design-tokens.json'] && result.tokens.light.size) {
    try {
      const parsed = parseTokenFile(result.files['design-tokens.json'])
      const jsonNames = new Set(parsed.tokens.map((token) => token.name))
      const cssNames = new Set(result.tokens.light.keys())
      const stale = [...jsonNames].filter((name) => !cssNames.has(name))
      const uncovered = [...cssNames].filter((name) => !jsonNames.has(name))
      if (stale.length) {
        findings.add('P2', 'token-json-stale', `${stale.length} token(s) in design-tokens.json are not declared in tokens.css.`, 'Regenerate design-tokens.json from tokens.css.', { file: result.files['design-tokens.json'], key: 'json-stale', sample: stale.slice(0, 5).join(', ') })
      }
      if (uncovered.length) {
        findings.add('P2', 'token-json-incomplete', `${uncovered.length} token(s) in tokens.css are missing from design-tokens.json.`, 'Regenerate the JSON inventory.', { file: result.files['design-tokens.json'], key: 'json-incomplete', sample: uncovered.slice(0, 5).join(', ') })
      }
    } catch (error) {
      findings.add('P2', 'token-json-invalid', `design-tokens.json is unreadable: ${error.message}`, 'Fix or regenerate the file.', { file: result.files['design-tokens.json'], key: 'json-invalid' })
    }
  }

  if (result.files['components.manifest.json']) {
    try {
      result.componentsManifest = readJsonFile(result.files['components.manifest.json'])
    } catch (error) {
      findings.add('P1', 'components-manifest-invalid', `components.manifest.json is not valid JSON: ${error.message}`, 'Fix the JSON syntax.', { file: result.files['components.manifest.json'], key: 'cm-invalid' })
    }
  }
  if (result.files['components.html']) {
    result.componentsHtml = readText(result.files['components.html'])
  }

  result.license = findUp(systemDir, ['LICENSE', 'LICENSE.md', 'LICENSE.txt'])
  result.notice = findUp(systemDir, ['NOTICE', 'NOTICE.md', 'ATTRIBUTION.md', 'ATTRIBUTION'])
  if (!result.license) {
    findings.add('P1', 'missing-license', 'No LICENSE file found in the package or its parent directories (3 levels).', 'Ship the licence the system is distributed under.', { file: systemDir, key: 'license' })
  }
  if (!result.notice) {
    findings.add('P2', 'missing-notice', 'No NOTICE/ATTRIBUTION file found near the package.', 'Attribute upstream sources when the system derives from another project.', { file: systemDir, key: 'notice' })
  }

  const underDesignSystems = path.basename(path.dirname(systemDir)) === 'design-systems'
  if (!underDesignSystems) {
    findings.add('P2', 'layout-not-design-systems', 'Package is not inside a design-systems/<slug>/ folder.', 'For user registration, place the package at design-systems/<slug>/.', { file: systemDir, key: 'layout' })
  }

  return result
}

/* ───────────────────────────── artifact checks ──────────────────────────── */

function systemIndices(system) {
  const colors = new Map()
  const space = new Map()
  const radius = new Map()
  const fonts = new Map()
  const allNames = new Set()
  const add = (map, key, payload) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(payload)
  }
  for (const [name, token] of system.tokens.light) {
    allNames.add(name)
    const resolved = resolveIn(system, 'light', name)
    if (!resolved) continue
    const color = parseColor(resolved.value)
    if (color) {
      const hex = colorToHex(color).toLowerCase()
      add(colors, hex, { name, value: resolved.value })
    }
    const px = pxValue(resolved.value)
    if (px !== null) {
      if (/^--(space|spacing|gap|section|container-gutter)/.test(name)) space.set(px, name)
      if (/^--radius/.test(name)) radius.set(px, name)
    }
    if (/^--font/.test(name)) fonts.set(normalizeTokenValue(resolved.value), name)
  }
  for (const name of [...system.tokens.dark.keys(), ...system.tokens.highContrast.keys()]) allNames.add(name)
  return { colors, space, radius, fonts, allNames }
}

function inlineDeclarations(html, file) {
  const decls = []
  const re = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi
  let match
  while ((match = re.exec(html))) {
    const value = match[2] ?? match[3] ?? ''
    for (const part of value.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      decls.push({
        property: part.slice(0, colon).trim().toLowerCase(),
        value: part.slice(colon + 1).trim(),
        file,
        line: lineAt(html, match.index),
        selector: '[style]',
        inline: true,
      })
    }
  }
  return decls
}

function scanArtifact(file, system) {
  const raw = readText(file)
  const findings = createFindings()
  const indices = systemIndices(system)
  const blocks = styleBlocks(raw)
  const tokens = []
  const rules = []
  const parseErrors = []
  for (const block of blocks) {
    const parsed = parseCssSource(block.css, file)
    for (const token of parsed.tokens) {
      if (token.mode === 'reduced') continue
      tokens.push({ ...token, line: block.startLine + token.line - 1 })
    }
    for (const rule of parsed.rules) rules.push({ ...rule, line: block.startLine + rule.line - 1 })
    for (const error of parsed.errors) parseErrors.push({ ...error, line: block.startLine + error.line - 1 })
  }
  const decls = [...rules, ...inlineDeclarations(raw, file)]
  const tokenMap = new Map()
  for (const token of tokens) {
    if (token.mode === 'dark' || HC_RE.test((token.context || []).join(' '))) continue
    if (!tokenMap.has(token.name)) tokenMap.set(token.name, token)
  }
  const resolveArtifact = (value) => resolveValue(value, new Map([...system.tokens.light, ...tokenMap]))

  for (const error of parseErrors) {
    findings.add('P1', 'artifact-css-error', `Artifact CSS parse error: ${error.message}`, 'Fix the CSS block.', { file, line: error.line, key: `css-${error.line}` })
  }

  const stats = {
    file,
    bytes: Buffer.byteLength(raw, 'utf8'),
    declarations: decls.length,
    varDeclarations: 0,
    literalVisual: 0,
    tokens: { declared: tokenMap.size, embedded: 0, drifted: 0, undeclared: 0, used: 0, unusedSystem: 0, brokenRefs: 0 },
    colors: { literals: 0, matched: 0, undeclared: 0 },
    spacing: { literals: 0, onScale: 0, offScale: 0 },
    radii: { literals: 0, onScale: 0, offScale: 0 },
    fonts: { literals: 0, matched: 0 },
    shadows: { literals: 0 },
    classes: { total: 0, system: 0, oneOff: 0 },
    components: { systemGroups: 0, represented: 0 },
    coverage: 0,
  }

  const COLOR_PROPS = /^(color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|fill|stroke|text-decoration-color)$/
  const SPACE_PROPS = /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/
  const RADIUS_PROPS = /^border(-(top|bottom|left|right)-(left|right))?-radius$/
  const FONT_PROPS = /^font-family$/
  const VISUAL_PROPS = /^(color|background|background-color|border|border-color|border-width|border-radius|border(-(top|bottom|left|right))?-(width|color|radius)|outline|outline-color|box-shadow|font|font-family|font-size|font-weight|line-height|letter-spacing|margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|fill|stroke|opacity)$/

  const colorSeen = new Set()
  const spaceSeen = new Map()
  const radiusSeen = new Map()
  const fontSeen = new Map()
  const shadowSeen = new Set()

  for (const decl of decls) {
    const property = decl.property
    const value = decl.value
    const hasVar = /\bvar\(/.test(value)
    if (VISUAL_PROPS.test(property)) {
      if (hasVar) stats.varDeclarations += 1
      else stats.literalVisual += 1
    }

    if (property !== 'box-shadow' && (COLOR_PROPS.test(property) || COLOR_RE.test(value))) {
      COLOR_RE.lastIndex = 0
      let match
      while ((match = COLOR_RE.exec(value))) {
        if (isInsideVariable(value, match.index)) {
          findings.add('P2', 'var-fallback-literal', 'Literal colour used as a var() fallback.', 'Use the token directly; a fallback hides a missing token.', { file, line: decl.line, key: 'fallback-color', sample: match[0] })
          continue
        }
        const color = parseColor(match[0])
        if (!color) continue
        const hex = colorToHex(color).toLowerCase()
        stats.colors.literals += 1
        colorSeen.add(hex)
        const systemMatch = indices.colors.get(hex)
        if (systemMatch) {
          stats.colors.matched += 1
          findings.add('P2', 'literal-color-matches-token', `Hard-coded ${match[0]} equals ${systemMatch.map((entry) => entry.name).join('/')}; use var().`, 'Replace with the token so the value stays resolved by the system.', { file, line: decl.line, key: `match-${hex}`, sample: `${hex} (${decl.selector})` })
        } else {
          stats.colors.undeclared += 1
          findings.add('P1', 'undeclared-color', `Colour ${match[0]} is not declared in the system palette.`, 'Use a system token or add a documented token before shipping.', { file, line: decl.line, key: `color-${hex}`, sample: `${hex} (${decl.selector})` })
        }
      }
    }

    if (SPACE_PROPS.test(property) && !/[a-z-]*\(/i.test(value.replace(/var\([^)]*\)/g, ''))) {
      for (const part of value.split(/\s+/)) {
        if (part.includes('var(') || part.includes('calc(') || part.includes('%') || part === 'auto') continue
        const px = pxValue(part)
        if (px === null || px === 0) continue
        stats.spacing.literals += 1
        spaceSeen.set(px, (spaceSeen.get(px) || 0) + 1)
        if (indices.space.size && [...indices.space.keys()].some((scale) => Math.abs(scale - Math.abs(px)) < 0.5)) {
          stats.spacing.onScale += 1
        } else {
          stats.spacing.offScale += 1
          findings.add('P1', 'off-scale-spacing', `Spacing ${part} is not on the system scale (${[...indices.space.keys()].sort((a, b) => a - b).join(', ')}px).`, 'Use a space token; off-scale pixels break the rhythm.', { file, line: decl.line, key: `space-${px}`, sample: `${part} (${decl.selector})` })
        }
      }
      if (!indices.space.size) {
        findings.add('P2', 'no-spacing-scale', 'The system declares no --space/--gap scale; spacing cannot be checked.', 'Add space tokens so artifacts can be audited.', { file: system.dir, key: 'no-space-scale' })
      }
    }

    if (RADIUS_PROPS.test(property)) {
      for (const part of value.split(/\s+/)) {
        if (part.includes('var(') || part.includes('%')) continue
        const px = pxValue(part)
        if (px === null || px === 0) continue
        stats.radii.literals += 1
        radiusSeen.set(px, (radiusSeen.get(px) || 0) + 1)
        if (indices.radius.size && [...indices.radius.keys()].some((scale) => Math.abs(scale - px) < 0.5)) {
          stats.radii.onScale += 1
        } else {
          stats.radii.offScale += 1
          findings.add('P1', 'off-scale-radius', `Radius ${part} is not on the system radius scale (${[...indices.radius.entries()].map(([value, name]) => `${value}px ${name}`).join(', ')}).`, 'Use a radius token.', { file, line: decl.line, key: `radius-${px}`, sample: `${part} (${decl.selector})` })
        }
      }
    }

    if (FONT_PROPS.test(property)) {
      if (hasVar) continue
      stats.fonts.literals += 1
      const normalized = normalizeTokenValue(value)
      const matched = [...indices.fonts.entries()].find(([fontValue]) => fontValue === normalized)
      if (matched) {
        stats.fonts.matched += 1
        findings.add('P2', 'hardcoded-font', `Font family equals ${matched[1]}; use var().`, 'Reference the font token so the system can change it.', { file, line: decl.line, key: 'font-matched', sample: value.slice(0, 60) })
      } else {
        findings.add('P1', 'undeclared-font', `Font family "${value.slice(0, 80)}" is not a system font token.`, 'Use a --font-* token or declare the face in the system.', { file, line: decl.line, key: 'font-undeclared', sample: value.slice(0, 60) })
      }
      fontSeen.set(normalized, (fontSeen.get(normalized) || 0) + 1)
    }

    if (property === 'box-shadow' && !hasVar) {
      stats.shadows.literals += 1
      shadowSeen.add(value)
      findings.add('P2', 'hardcoded-shadow', 'Hard-coded box-shadow.', 'Use an elevation token (--elev-*).', { file, line: decl.line, key: 'shadow', sample: value.slice(0, 60) })
    }
  }

  /* Artifact token declarations vs the system. */
  for (const [name, token] of tokenMap) {
    const systemToken = system.tokens.light.get(name)
    if (!systemToken) {
      stats.tokens.undeclared += 1
      findings.add('P1', 'undeclared-token', `Artifact declares ${name}, which the system does not define.`, 'Do not extend the token contract inside an artifact; add it to the system.', { file, line: token.line, key: `token-${name}`, sample: name })
      continue
    }
    const artifactValue = resolveArtifact(token.value)
    const systemValue = resolveIn(system, 'light', name)
    const same = systemValue && normalizeTokenValue(artifactValue.value) === normalizeTokenValue(systemValue.value)
    if (same) {
      stats.tokens.embedded += 1
    } else {
      stats.tokens.drifted += 1
      findings.add('P1', 'token-drift', `Artifact re-declares ${name} as "${token.value}", system value is "${systemValue ? systemValue.value : '?'}".`, 'Use the system value; drift makes the artifact unreproducible.', { file, line: token.line, key: `drift-${name}` })
    }
  }

  const varRefs = new Map()
  const varRe = /\bvar\(\s*(--[A-Za-z0-9_-]+)/g
  let varMatch
  while ((varMatch = varRe.exec(raw))) varRefs.set(varMatch[1], (varRefs.get(varMatch[1]) || 0) + 1)
  stats.tokens.used = varRefs.size
  for (const [name, count] of varRefs) {
    if (indices.allNames.has(name) || tokenMap.has(name)) continue
    stats.tokens.brokenRefs += 1
    findings.add('P1', 'broken-token-reference', `var(${name}) is not declared by the system or the artifact.`, 'Fix the token name or declare it in the system.', { file, key: `ref-${name}`, sample: `${name} ×${count}` })
  }

  const systemUsed = [...varRefs.keys()].filter((name) => indices.allNames.has(name))
  const systemColorNames = [...system.tokens.light.keys()].filter((name) => parseColor((resolveIn(system, 'light', name) || {}).value))
  const unusedSystem = systemColorNames.filter((name) => !varRefs.has(name))
  stats.tokens.unusedSystem = unusedSystem.length
  if (systemColorNames.length && systemUsed.length === 0) {
    findings.add('P1', 'no-system-tokens-used', 'The artifact does not use any token from the system.', 'Resolve values through var(--*) so the artifact follows the system.', { file, key: 'no-tokens-used' })
  }

  const classes = classesInMarkup(raw)
  stats.classes.total = classes.size
  const systemClasses = new Set()
  const groups = Array.isArray(system.componentsManifest?.groups) ? system.componentsManifest.groups : []
  for (const group of groups) for (const className of group.classes || []) systemClasses.add(className)
  stats.components.systemGroups = groups.length
  const usedClasses = [...classes.keys()]
  for (const className of usedClasses) {
    if (systemClasses.has(className)) stats.classes.system += 1
  }
  if (systemClasses.size) {
    const oneOff = usedClasses.filter((className) => !systemClasses.has(className) && classes.get(className) === 1)
    stats.classes.oneOff = oneOff.length
    if (oneOff.length) {
      findings.add('P2', 'one-off-class', `${oneOff.length} single-use class(es) are not in the system component inventory.`, 'Reuse a system component or document the new component in the system.', { file, key: 'one-off', sample: oneOff.slice(0, 8).join(', ') })
    }
    const represented = groups.filter((group) => (group.classes || []).some((className) => classes.has(className)) || (group.elements || []).some((tag) => raw.includes(`<${tag}`)))
    stats.components.represented = represented.length
    if (groups.length && represented.length === 0) {
      findings.add('P2', 'no-system-components', 'No system component classes or elements appear in the artifact.', 'Reuse the system inventory unless the artifact is intentionally bespoke.', { file, key: 'no-components' })
    }
  } else if (classes.size) {
    findings.add('P2', 'component-inventory-missing', 'The system has no component inventory; one-off component detection is skipped.', 'Add components.manifest.json groups to audit artifact components.', { file: system.dir, key: 'no-inventory' })
  }

  const visualTotal = stats.varDeclarations + stats.literalVisual
  stats.coverage = visualTotal ? Math.round((stats.varDeclarations / visualTotal) * 100) : 0
  if (visualTotal && stats.coverage < 60) {
    findings.add('P2', 'low-token-coverage-declarations', `Only ${stats.coverage}% of visual declarations go through var().`, 'Convert the remaining literal colours, spacing and radii to tokens.', { file, key: 'coverage-low' })
  }

  return {
    stats,
    findings: sortFindings(findings.all()),
    counts: findings.counts(),
    details: {
      colors: [...colorSeen].sort(),
      spacing: [...spaceSeen.entries()].sort((a, b) => a[0] - b[0]),
      radii: [...radiusSeen.entries()].sort((a, b) => a[0] - b[0]),
      fonts: [...fontSeen.keys()],
      shadows: [...shadowSeen].slice(0, 5),
      classes: [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    },
  }
}

/* ─────────────────────────── component matrix ───────────────────────────── */

function deriveVariants(classes) {
  const list = classes.filter(Boolean)
  const bases = list.filter((base) => list.some((other) => other !== base && other.startsWith(`${base}-`)))
  const base = bases.sort((a, b) => b.length - a.length)[0]
  if (!base) return []
  return unique(
    list
      .filter((className) => className !== base && className.startsWith(`${base}-`))
      .map((className) => className.slice(base.length + 1)),
  )
}

function componentMatrix(system) {
  const findings = createFindings()
  const html = system.componentsHtml
  if (!html) {
    findings.add('P1', 'missing-components', 'The system has no components.html fixture.', 'Add a component fixture so variants and states can be audited.', { file: system.dir, key: 'no-components-html' })
    return { matrix: [], stats: { groups: 0, present: 0, missingStates: 0 }, findings: sortFindings(findings.all()), counts: findings.counts() }
  }
  const css = styleBlocks(html).map((block) => block.css).join('\n')
  const selectors = selectorList(css)
  const classes = classesInMarkup(html)
  const groups = Array.isArray(system.componentsManifest?.groups) ? system.componentsManifest.groups : null

  if (!groups) {
    const present = []
    const missing = []
    for (const [state, pattern] of STATE_SELECTOR_PATTERNS) {
      if (state === 'focus') continue
      if (pattern.test(html)) present.push(state)
      else missing.push(state)
    }
    findings.add('P2', 'no-component-manifest', 'No components.manifest.json groups; the matrix falls back to state-level scan.', 'Add groups (id, label, classes, selectors, tokenReferences) for a real matrix.', { file: system.dir, key: 'no-groups' })
    for (const state of missing) {
      if (state === 'focus-visible') findings.add('P1', 'state-missing', `No ${state} state found in components.html.`, 'Add a focus-visible example.', { file: system.files['components.html'], key: 'state-focus' })
      else findings.add('P2', 'state-missing', `No ${state} state found in components.html.`, `Add a ${state} example.`, { file: system.files['components.html'], key: `state-${state}` })
    }
    return { matrix: [], stats: { groups: 0, present: present.length, missingStates: missing.length }, findings: sortFindings(findings.all()), counts: findings.counts() }
  }

  const matrix = []
  let missingTotal = 0
  for (const group of groups) {
    const groupClasses = Array.isArray(group.classes) ? group.classes : []
    const groupSelectors = Array.isArray(group.selectors) ? group.selectors : []
    const candidateSelectors = unique([
      ...groupSelectors,
      ...selectors.filter((selector) => groupClasses.some((className) => selectorHasClass(selector, className))),
    ])
    const inFixture = groupClasses.some((className) => classes.has(className)) || candidateSelectors.some((selector) => selectors.includes(selector))
    const states = new Set()
    if (group.present && inFixture) states.add('default')
    for (const selector of candidateSelectors) {
      for (const state of statesFromSelector(selector)) states.add(state)
    }
    for (const fragment of groupFragments(html, groupClasses)) {
      for (const state of statesFromMarkup(fragment)) states.add(state)
    }
    const variants = deriveVariants(groupClasses)
    const required = GROUP_REQUIRED[group.id] || GROUP_REQUIRED[group.label?.toLowerCase?.()] || []
    const missing = required.filter((state) => !states.has(state))
    missingTotal += missing.length
    for (const state of missing) {
      const severity = state === 'focus-visible' ? 'P1' : 'P2'
      findings.add(severity, 'state-missing', `${group.id}: no ${state} state for ${(groupClasses[0] || group.id)}.`, `Add a ${state} example to the ${group.id} group.`, { file: system.files['components.html'], key: `${group.id}-${state}` })
    }
    if (group.present && !inFixture) {
      findings.add('P1', 'group-not-rendered', `${group.id} is declared present but does not appear in components.html.`, 'Render the group or set present:false.', { file: system.files['components.html'], key: `rendered-${group.id}` })
    }
    const missingSelectors = groupSelectors.filter((selector) => !selectors.includes(selector))
    if (groupSelectors.length && missingSelectors.length) {
      findings.add('P2', 'manifest-selector-drift', `${group.id}: ${missingSelectors.length}/${groupSelectors.length} manifest selectors are not in the fixture CSS.`, 'Regenerate components.manifest.json from the fixture.', { file: system.files['components.manifest.json'], key: `selector-${group.id}`, sample: missingSelectors.slice(0, 4).join(', ') })
    }
    matrix.push({
      id: group.id,
      label: group.label || group.id,
      present: Boolean(group.present && inFixture),
      variants,
      states: [...states].sort(),
      missing,
      required,
      selectors: groupSelectors.length,
      classes: groupClasses,
      tokens: Array.isArray(group.tokenReferences) ? group.tokenReferences.length : 0,
    })
  }

  const present = matrix.filter((row) => row.present).length
  return {
    matrix,
    stats: {
      groups: matrix.length,
      present,
      withVariants: matrix.filter((row) => row.variants.length > 0).length,
      missingStates: missingTotal,
      states: unique(matrix.flatMap((row) => row.states)),
    },
    findings: sortFindings(findings.all()),
    counts: findings.counts(),
  }
}

/* ───────────────────────────── theme parity ─────────────────────────────── */

function themeParity(system) {
  const findings = createFindings()
  const modes = ['light', 'dark', 'high-contrast']
  const declared = { light: system.tokens.light.size, dark: system.tokens.dark.size, highContrast: system.tokens.highContrast.size }
  const stats = {
    modes: declared,
    singleMode: declared.dark === 0 && declared.highContrast === 0,
    missingCounterparts: [],
    pairs: [],
    failures: 0,
    unmeasured: [],
  }
  if (!declared.dark) {
    const claimsDark = claimsDarkMode(system.designText)
    findings.add(claimsDark ? 'P1' : 'P2', 'no-dark-mode', claimsDark ? 'DESIGN.md describes dark mode but tokens.css declares no dark tokens.' : 'System declares no dark tokens; dark parity cannot be checked.', 'Add a .dark/[data-theme="dark"] token block, or state that the system is light-only.', { file: system.files['tokens.css'], key: 'no-dark' })
  }
  if (!declared.highContrast) {
    findings.add('P2', 'no-high-contrast-mode', 'No high-contrast/forced-colors token block.', 'Add a forced-colors-safe token set, or note that the platform handles it.', { file: system.files['tokens.css'], key: 'no-hc' })
  }

  if (declared.dark) {
    for (const role of CORE_ROLES) {
      const name = findRoleName(system, role)
      if (!name) continue
      if (!hasInMode(system, 'dark', name)) {
        stats.missingCounterparts.push({ mode: 'dark', role, token: name })
        const severity = ['bg', 'fg', 'accent', 'accentOn', 'surface'].includes(role) ? 'P1' : 'P2'
        findings.add(severity, 'missing-dark-counterpart', `Dark mode has no ${name} (${role}).`, 'Declare the token in the dark block; falling back to light breaks the pair.', { file: system.files['tokens.css'], key: `dark-${role}` })
      }
    }
    for (const role of ['success', 'warn', 'danger']) {
      const name = findRoleName(system, role)
      if (name && !hasInMode(system, 'dark', name)) stats.missingCounterparts.push({ mode: 'dark', role, token: name })
    }
    for (const role of CORE_ROLES) {
      const name = findRoleName(system, role)
      if (!name || !hasInMode(system, 'dark', name)) continue
      const light = roleColor(system, 'light', role)
      const dark = roleColor(system, 'dark', role)
      if (light && dark && colorToHex(light.color).toLowerCase() === colorToHex(dark.color).toLowerCase() && role !== 'focus') {
        findings.add('P2', 'identical-mode-value', `${role} resolves to the same colour in light and dark.`, 'Confirm this is intentional; identical surface/ink values usually mean the dark theme is unfinished.', { file: system.files['tokens.css'], key: `same-${role}`, sample: colorToHex(light.color) })
      }
    }
  }
  if (declared.highContrast) {
    for (const role of CORE_ROLES) {
      const name = findRoleName(system, role)
      if (!name) continue
      if (!hasInMode(system, 'high-contrast', name)) {
        stats.missingCounterparts.push({ mode: 'high-contrast', role, token: name })
        findings.add('P2', 'missing-high-contrast-counterpart', `High-contrast mode has no ${name} (${role}).`, 'Declare it in the forced-colors/high-contrast block.', { file: system.files['tokens.css'], key: `hc-${role}` })
      }
    }
  }

  for (const mode of modes) {
    if (mode !== 'light' && !declared[mode === 'high-contrast' ? 'highContrast' : mode]) continue
    for (const pair of TEXT_PAIRS) {
      const fgName = findRoleName(system, pair.fg)
      const bgName = findRoleName(system, pair.bg)
      if (mode !== 'light' && ((!fgName || !hasInMode(system, mode, fgName)) || (!bgName || !hasInMode(system, mode, bgName)))) {
        stats.unmeasured.push({ mode, pair: `${pair.fg}/${pair.bg}`, reason: `not declared in ${mode} mode` })
        continue
      }
      const fg = roleColor(system, mode, pair.fg)
      const bg = roleColor(system, mode, pair.bg)
      if (!fg || !bg) {
        stats.unmeasured.push({ mode, pair: `${pair.fg}/${pair.bg}`, reason: `missing ${!fg ? pair.fg : pair.bg}` })
        continue
      }
      const ratio = contrastRatio(fg.color, bg.color)
      if (ratio === null || !Number.isFinite(ratio)) {
        stats.unmeasured.push({ mode, pair: `${pair.fg}/${pair.bg}`, reason: 'colour is not statically resolvable (alpha, color-mix or var chain)' })
        continue
      }
      const pass = ratio >= pair.min - 0.01
      stats.pairs.push({ mode, pair: `${pair.fg}/${pair.bg}`, label: pair.label, ratio: Number(ratio.toFixed(2)), min: pair.min, pass, fg: fg.name, bg: bg.name })
      if (!pass) {
        stats.failures += 1
        const severity = mode === 'light' || mode === 'dark' ? pair.severity : 'P2'
        findings.add(severity, 'contrast-failure', `${mode}: ${pair.label} is ${formatRatio(ratio)} (needs ${pair.min}:1) — ${fg.name} on ${bg.name}.`, 'Adjust the token pair; do not add an exception without a documented reason.', { file: system.files['tokens.css'], key: `contrast-${mode}-${pair.fg}-${pair.bg}` })
      }
    }
  }

  return { modes: { declared, pairs: stats.pairs }, stats, findings: sortFindings(findings.all()), counts: findings.counts() }
}

/* ─────────────────────── system validation & registration ───────────────── */

function systemValidation(system, options = {}) {
  const findings = createFindings()
  for (const finding of system.findings.all()) findings.add(finding.severity, finding.id, finding.message, finding.fix, { file: finding.file, line: finding.line, key: `${finding.id}|${finding.message}|${finding.file || ""}` })
  const light = system.tokens.light
  const criticalRoles = ['bg', 'fg', 'accent']
  for (const role of CORE_ROLES) {
    const name = findRoleName(system, role)
    if (!name) {
      findings.add(criticalRoles.includes(role) ? 'P1' : 'P2', 'missing-role', `No ${role} token role found.`, `Add ${ROLE_CANDIDATES[role][0]} so artifacts can resolve ${role}.`, { file: system.files['tokens.css'] || system.dir, key: `role-${role}` })
      continue
    }
    if (light.size && !roleColor(system, 'light', role)) {
      findings.add('P2', 'unparseable-role', `Role ${role} (${name}) does not resolve to a colour.`, 'Point the role at a colour token; var chains must end in a value.', { file: system.files['tokens.css'], key: `role-color-${role}` })
    }
  }
  const modes = { light: light.size, dark: system.tokens.dark.size, highContrast: system.tokens.highContrast.size }
  if (!modes.dark && !modes.highContrast) {
    findings.add('P2', 'single-mode', 'System declares light tokens only.', 'State that it is light-only, or add dark/forced-colors blocks.', { file: system.files['tokens.css'], key: 'single-mode' })
  }

  const matrix = componentMatrix(system)
  for (const finding of matrix.findings) findings.add(finding.severity, finding.id, finding.message, finding.fix, { file: finding.file, line: finding.line, key: `${finding.id}|${finding.message}|${finding.file || ""}` })

  const result = {
    ok: true,
    system: {
      dir: system.dir,
      id: system.id,
      name: system.name,
      files: Object.fromEntries(Object.entries(system.files).map(([name, file]) => [name, Boolean(file)])),
      tokens: modes,
      roles: Object.fromEntries(CORE_ROLES.map((role) => [role, findRoleName(system, role)])),
      components: matrix.stats,
      license: system.license ? shortName(system.license) : null,
      notice: system.notice ? shortName(system.notice) : null,
      manifest: system.manifest ? { id: system.manifest.id, schemaVersion: system.manifest.schemaVersion } : null,
    },
    matrix: matrix.matrix,
    findings: sortFindings(findings.all()),
    counts: findings.counts(),
  }
  result.ok = result.counts.P0 === 0
  return result
}

function registrationEntry(system) {
  const manifest = system.manifest || {}
  return {
    slug: system.id,
    name: system.name || system.id,
    category: manifest.category || 'User-supplied',
    description: manifest.description || `User-supplied design system at design-systems/${system.id}/.`,
    design: 'DESIGN.md',
    tokens: 'tokens.css',
    components: fs.existsSync(path.join(system.dir, 'components.html')) ? 'components.html' : null,
    usage: fs.existsSync(path.join(system.dir, 'USAGE.md')) ? 'USAGE.md' : null,
    source: {
      type: 'user',
      origin: path.basename(path.dirname(system.dir)) === 'design-systems' ? `design-systems/${path.basename(system.dir)}` : shortName(system.dir),
    },
  }
}

function registerSystem(result, system) {
  const receiptPath = path.join(system.dir, 'CONFORMANCE.json')
  const receipt = {
    schema: 'dezign0/system-conformance/v1',
    id: system.id,
    name: system.name,
    path: shortName(system.dir),
    validatedAt: new Date().toISOString(),
    conforms: result.counts.P0 === 0,
    counts: result.counts,
    tokens: result.system.tokens,
    roles: result.system.roles,
    components: result.system.components,
    license: result.system.license,
    catalogEntry: registrationEntry(system),
  }
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return { receiptPath, receipt, entry: receipt.catalogEntry }
}

/* ────────────────────────────── reporting ───────────────────────────────── */

function relFile(file) {
  return file ? shortName(file) : null
}

function renderFindingsTable(findings) {
  if (!findings.length) return '_No findings._\n'
  const rows = [
    '| Severity | Check | Where | Problem | Fix |',
    '|---|---|---|---|---|',
    ...findings.map((finding) => {
      const samples = finding.count > 1 ? ` ×${finding.count}${finding.samples.length ? `<br>${finding.samples.map((sample) => `\`${sample}\``).join('<br>')}` : ''}` : ''
      return `| ${finding.severity} | ${finding.id} | ${relFile(finding.file)}:${finding.line} | ${finding.message}${samples} | ${finding.fix} |`
    }),
  ]
  return `${rows.join('\n')}\n`
}

function renderMarkdown(result) {
  const lines = []
  lines.push(`# Conformance report — ${result.system?.id || 'system'}${result.artifacts?.length ? ` / ${result.artifacts.map((artifact) => path.basename(artifact.stats.file)).join(', ')}` : ''}`)
  lines.push('')
  lines.push(`Schema: \`${SCHEMA}\` · command: \`${result.command}\` · system: \`${relFile(result.system?.dir) || 'n/a'}\``)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Findings: ${result.counts.P0} P0, ${result.counts.P1} P1, ${result.counts.P2} P2`)
  if (result.system) lines.push(`- Modes: ${result.system.modes.light} light / ${result.system.modes.dark} dark / ${result.system.modes.highContrast} high-contrast tokens`)
  if (result.artifacts?.length) lines.push(`- Artifacts: ${result.artifacts.length} checked`)
  if (result.components?.matrix?.length) lines.push(`- Component groups: ${result.components.stats.groups} (${result.components.stats.present} rendered, ${result.components.stats.missingStates} missing required states)`)
  if (result.themes) lines.push(`- Contrast pairs: ${result.themes.stats.pairs.filter((pair) => pair.pass).length}/${result.themes.stats.pairs.length} pass`)
  lines.push('')
  lines.push('## Findings')
  lines.push('')
  lines.push(renderFindingsTable(result.findings))
  if (result.artifacts?.length) {
    lines.push('## Artifact conformance')
    lines.push('')
    lines.push('| Artifact | Bytes | Declarations | var() | Token coverage | Colours (literal/matched/undeclared) | Spacing off-scale | Radii off-scale | Broken refs | One-off classes |')
    lines.push('|---|---|---|---|---|---|---|---|---|---|')
    for (const artifact of result.artifacts) {
      const stats = artifact.stats
      lines.push(`| ${path.basename(stats.file)} | ${stats.bytes} | ${stats.declarations} | ${stats.varDeclarations} | ${stats.coverage}% | ${stats.colors.literals}/${stats.colors.matched}/${stats.colors.undeclared} | ${stats.spacing.offScale}/${stats.spacing.literals} | ${stats.radii.offScale}/${stats.radii.literals} | ${stats.tokens.brokenRefs} | ${stats.classes.oneOff} |`)
    }
    lines.push('')
  }
  if (result.components?.matrix?.length) {
    lines.push('## Component matrix')
    lines.push('')
    lines.push('| Group | Present | Variants | States | Missing required | Selectors | Tokens |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const row of result.components.matrix) {
      lines.push(`| ${row.id} | ${row.present ? 'yes' : 'no'} | ${row.variants.join(', ') || '—'} | ${row.states.join(', ') || '—'} | ${row.missing.join(', ') || 'none'} | ${row.selectors} | ${row.tokens} |`)
    }
    lines.push('')
  }
  if (result.themes?.stats?.pairs?.length) {
    lines.push('## Theme parity')
    lines.push('')
    lines.push(`Declared modes: light ${result.themes.stats.modes.light}, dark ${result.themes.stats.modes.dark}, high-contrast ${result.themes.stats.modes.highContrast}.`)
    lines.push('')
    lines.push('| Mode | Pair | Ratio | Minimum | Result |')
    lines.push('|---|---|---|---|---|')
    for (const pair of result.themes.stats.pairs) {
      lines.push(`| ${pair.mode} | ${pair.label} (\`${pair.fg}\` on \`${pair.bg}\`) | ${pair.ratio === null ? 'n/a' : `${pair.ratio}:1`} | ${pair.min}:1 | ${pair.pass ? 'pass' : 'FAIL'} |`)
    }
    if (result.themes.stats.missingCounterparts.length) {
      lines.push('')
      lines.push(`Missing mode counterparts: ${result.themes.stats.missingCounterparts.map((entry) => `${entry.mode}:${entry.token}`).join(', ')}`)
    }
    lines.push('')
  }
  if (result.registration) {
    lines.push('## Registration')
    lines.push('')
    lines.push(`Receipt: \`${relFile(result.registration.receiptPath)}\``)
    lines.push('')
    lines.push('Catalog entry for `design-systems/index.json`:')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(result.registration.entry, null, 2))
    lines.push('```')
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('A clean conformance run is a floor, not a certificate: this tool reads files, not rendered pixels.')
  lines.push('')
  return lines.join('\n')
}

function printHuman(result) {
  for (const finding of result.findings) {
    console.log(`${finding.severity}  ${finding.id}  ${relFile(finding.file)}:${finding.line}`)
    console.log(`     ${finding.message}${finding.count > 1 ? ` (×${finding.count})` : ''}`)
    console.log(`     fix: ${finding.fix}`)
  }
  if (result.artifacts?.length) {
    for (const artifact of result.artifacts) {
      const stats = artifact.stats
      console.log(
        `\n${path.basename(stats.file)}: ${stats.declarations} declarations, ${stats.coverage}% token coverage, ` +
        `${stats.colors.undeclared} undeclared colours, spacing off-scale ${stats.spacing.offScale}/${stats.spacing.literals}, ` +
        `radii off-scale ${stats.radii.offScale}/${stats.radii.literals}, ${stats.tokens.brokenRefs} broken refs`,
      )
    }
  }
  if (result.components?.matrix?.length) {
    console.log('')
    for (const row of result.components.matrix) {
      console.log(`${row.id.padEnd(10)} ${row.present ? 'present' : 'absent '}  variants: ${row.variants.join(',') || '—'}  states: ${row.states.join(',') || '—'}  missing: ${row.missing.join(',') || 'none'}`)
    }
  }
  if (result.themes) {
    const { modes, pairs } = result.themes.stats
    console.log(`\nmodes: light ${modes.light}, dark ${modes.dark}, high-contrast ${modes.highContrast}`)
    for (const pair of pairs) console.log(`  ${pair.mode.padEnd(13)} ${pair.pair.padEnd(18)} ${pair.ratio === null ? 'n/a' : `${pair.ratio}:1`} (min ${pair.min}) ${pair.pass ? 'pass' : 'FAIL'}`)
    if (result.themes.stats.missingCounterparts.length) console.log(`  missing counterparts: ${result.themes.stats.missingCounterparts.map((entry) => `${entry.mode}:${entry.token}`).join(', ')}`)
  }
  if (result.registration) console.log(`\nregistered: ${relFile(result.registration.receiptPath)}\n${JSON.stringify(result.registration.entry, null, 2)}`)
  const counts = result.counts
  console.log(`\nconformance: ${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2 — ${result.ok ? 'ok' : 'blocking findings'}`)
}

/* ───────────────────────────────── CLI ──────────────────────────────────── */

const COMMANDS = ['artifact', 'components', 'themes', 'system', 'all']

function usage() {
  console.log(`conformance — artifact and design-system conformance

Usage:
  node conformance.mjs artifact <file.html...> --system=<dir> [options]
  node conformance.mjs components --system=<dir> [options]
  node conformance.mjs themes --system=<dir> [options]
  node conformance.mjs system <dir> [--register] [options]
  node conformance.mjs all <file.html...> --system=<dir> [options]

Checks:
  artifact    literal colours/spacing/radii vs tokens.css, hard-coded values,
              undeclared tokens, broken var() refs, token coverage, one-off classes
  components  components x variants x states from components.manifest.json groups,
              missing states, manifest/fixture drift
  themes      light / dark / high-contrast counterparts, contrast per mode
  system      design-systems/<slug> contract: manifest, tokens, components, licence;
              --register writes <dir>/CONFORMANCE.json and prints the catalog entry

Options:
  --system=<dir>   system package (required for artifact/components/themes/all)
  --id=<id>        expected system id for system (default: folder name)
  --register       system only: write the conformance receipt (user packages
                   only; refused for the bundled design-languages pack and for
                   systems with P0 findings)
  --json           machine-readable result
  --strict         exit 1 on P1 findings as well as P0
  --out=<file>     write the report (JSON with --json, Markdown otherwise)
  --help           show this help

Exit codes: 0 no blocking findings, 1 blocking findings (P0; P1 with --strict),
2 usage or unreadable input.`)
}

function parseArgs(argv) {
  const options = { command: null, positionals: [], system: null, id: null, register: false, json: false, strict: false, out: null, help: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--strict') { options.strict = true; continue }
    if (arg === '--register') { options.register = true; continue }
    if (!arg.startsWith('--')) {
      if (!options.command) options.command = arg
      else options.positionals.push(arg)
      continue
    }
    const match = /^--([a-z-]+)=([\s\S]+)$/.exec(arg)
    if (!match) throw new Error(`unexpected argument: ${arg}`)
    const [, key, value] = match
    if (key === 'system') options.system = value
    else if (key === 'id') options.id = value
    else if (key === 'out') options.out = value
    else throw new Error(`unknown option: --${key}`)
  }
  if (options.help) return options
  if (!options.command) throw new Error('no command')
  if (!COMMANDS.includes(options.command)) throw new Error(`unknown command "${options.command}" (expected ${COMMANDS.join(', ')})`)
  if (options.command === 'system') {
    if (options.positionals.length !== 1) throw new Error('system needs exactly one package directory')
  } else if (options.command === 'components' || options.command === 'themes') {
    if (options.positionals.length) throw new Error(`${options.command} takes no positional arguments`)
  } else if (!options.positionals.length) {
    throw new Error(`${options.command} needs at least one HTML artifact`)
  }
  if (!options.system && options.command !== 'system') throw new Error('--system=<dir> is required')
  return options
}

function finish(result, options) {
  const blocking = result.counts.P0 > 0 || (options.strict && result.counts.P1 > 0)
  result.ok = !blocking
  if (options.out) {
    const outPath = path.resolve(options.out)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    result.out = outPath
    fs.writeFileSync(outPath, options.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result))
    if (!options.json) console.log(`${TOOL}: report written to ${shortName(outPath)}`)
  }
  if (options.json) {
    const sanitized = { ...result, findings: result.findings.map((finding) => ({ ...finding, file: relFile(finding.file) })), out: result.out ? shortName(result.out) : null }
    console.log(JSON.stringify(sanitized, null, 2))
  } else if (!options.out) {
    printHuman(result)
  }
  if (blocking) process.exitCode = 1
}

function run(options) {
  const started = { command: options.command, findings: [], counts: { P0: 0, P1: 0, P2: 0 }, system: null, artifacts: null, components: null, themes: null, registration: null }
  const command = options.command
  if (command === 'system') {
    const system = loadSystem(options.positionals[0], { id: options.id })
    if (system.fatal) return { ...started, system: { dir: system.dir, id: system.id }, findings: sortFindings(system.findings.all()), counts: system.findings.counts(), fatal: true }
    const validation = systemValidation(system)
    const result = {
      ...started,
      system: { ...validation.system, modes: validation.system.tokens, components: validation.system.components },
      matrix: validation.matrix,
      findings: validation.findings,
      counts: validation.counts,
      registration: null,
    }
    if (options.register) {
      const inBundledPack = path.normalize(system.dir).split(path.sep).join('/').includes('/design-languages/design-systems/')
      const refusal = inBundledPack
        ? 'The bundled design-languages pack is read-only. Copy the system into <project>/design-systems/<slug>/ and register that copy.'
        : validation.counts.P0 > 0
          ? 'The system has P0 findings; fix them before registering.'
          : null
      if (refusal) {
        result.findings = sortFindings([
          ...result.findings,
          { severity: 'P0', id: 'registration-refused', message: refusal, fix: 'Run without --register to keep validating, or satisfy the condition above.', file: system.dir, line: 1, count: 1, samples: [] },
        ])
        result.counts = {
          P0: result.findings.filter((finding) => finding.severity === 'P0').length,
          P1: result.findings.filter((finding) => finding.severity === 'P1').length,
          P2: result.findings.filter((finding) => finding.severity === 'P2').length,
        }
      } else {
        try {
          result.registration = registerSystem({ counts: validation.counts, system: validation.system }, system)
        } catch (error) {
          result.findings = sortFindings([
            ...result.findings,
            { severity: 'P0', id: 'registration-failed', message: `Cannot write CONFORMANCE.json: ${error.message}`, fix: 'Make the package directory writable, or run without --register.', file: system.dir, line: 1, count: 1, samples: [] },
          ])
          result.counts = {
            P0: result.findings.filter((finding) => finding.severity === 'P0').length,
            P1: result.findings.filter((finding) => finding.severity === 'P1').length,
            P2: result.findings.filter((finding) => finding.severity === 'P2').length,
          }
        }
      }
    }
    return result
  }

  const system = loadSystem(options.system)
  if (system.fatal) {
    return { ...started, system: { dir: system.dir, id: system.id }, findings: sortFindings(system.findings.all()), counts: system.findings.counts(), fatal: true }
  }
  const baseFindings = system.findings.all()
  const systemInfo = {
    dir: system.dir,
    id: system.id,
    name: system.name,
    modes: { light: system.tokens.light.size, dark: system.tokens.dark.size, highContrast: system.tokens.highContrast.size },
  }
  const result = { ...started, system: systemInfo }
  const all = createFindings()
  const absorb = (findings) => findings.forEach((finding) => all.add(finding.severity, finding.id, finding.message, finding.fix, { file: finding.file, line: finding.line, key: `${finding.id}|${finding.message}|${finding.file || ""}` }))
  absorb(baseFindings)
  const includeComponents = command === 'components' || command === 'all'
  const includeThemes = command === 'themes' || command === 'all'
  const includeArtifacts = command === 'artifact' || command === 'all'

  if (includeComponents) {
    const matrix = componentMatrix(system)
    result.components = { matrix: matrix.matrix, stats: matrix.stats }
    absorb(matrix.findings)
  }
  if (includeThemes) {
    const themes = themeParity(system)
    result.themes = { modes: themes.modes, stats: themes.stats }
    absorb(themes.findings)
  }
  if (includeArtifacts) {
    result.artifacts = []
    for (const file of options.positionals) {
      const resolved = path.resolve(file)
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        const errorResult = { ...result, findings: [{ severity: 'P0', id: 'artifact-missing', message: `Artifact not found: ${file}`, fix: 'Pass an existing HTML file.', file: resolved, line: 1, count: 1, samples: [] }], counts: { P0: 1, P1: 0, P2: 0 }, fatal: true }
        return errorResult
      }
      if (!/\.html?$/i.test(resolved)) {
        const errorResult = { ...result, findings: [{ severity: 'P0', id: 'artifact-not-html', message: `Not an HTML artifact: ${file}`, fix: 'Conformance reads HTML artifacts; pass a .html file.', file: resolved, line: 1, count: 1, samples: [] }], counts: { P0: 1, P1: 0, P2: 0 }, fatal: true }
        return errorResult
      }
      const scanned = scanArtifact(resolved, system)
      result.artifacts.push({ stats: scanned.stats, details: scanned.details })
      absorb(scanned.findings)
    }
  }
  result.findings = sortFindings(all.all())
  result.counts = all.counts()
  return result
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`)
    console.error('Run with --help for usage.')
    process.exitCode = 2
    return
  }
  if (options.help) { usage(); return }
  const result = run(options)
  if (result.fatal) {
    for (const finding of result.findings) console.error(`${TOOL}: ${finding.message}`)
    process.exitCode = 2
    return
  }
  finish(result, options)
}

export {
  SCHEMA,
  loadSystem,
  scanArtifact,
  componentMatrix,
  themeParity,
  systemValidation,
  registerSystem,
  renderMarkdown,
  run,
  parseArgs,
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath && invokedPath.toLowerCase() === import.meta.url.toLowerCase()) {
  main()
}
