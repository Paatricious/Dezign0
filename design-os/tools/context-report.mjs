#!/usr/bin/env node
/**
 * context-report.mjs — context cost and migration/deprecation report.
 *
 * Answers two maintenance questions without a model or a network call:
 *
 *   1. What does this kit cost every turn, and which files are too big?
 *      Skills and agents pay for their name + description on every turn
 *      ("always-on"); skill bodies, craft notes and briefs are paid only when
 *      used ("on-invoke"). The report estimates tokens at chars / 4, compares
 *      the always-on total with a budget, flags oversized files, near-duplicate
 *      descriptions that compete for the same trigger, duplicate files and
 *      reference docs nothing points at.
 *
 *   2. What must a consumer change when upgrading?
 *      Parses CHANGELOG.md (Keep a Changelog), classifies removed / renamed /
 *      deprecated / breaking entries into a checkable migration list, scans the
 *      kit's scripts for deprecation markers, and prints the consumer upgrade
 *      steps.
 *
 * Usage:
 *   node context-report.mjs [--root=DIR] [--budget=TOKENS] [--large=TOKENS]
 *                           [--top=N] [--changelog=FILE] [--from=VERSION]
 *                           [--json] [--out=FILE] [--strict] [--self-test]
 *
 * Exit codes:
 *   0  report generated
 *   1  --strict and at least one high/medium flag
 *   2  usage or read error
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ESTIMATOR = 'tokens ≈ ceil(characters / 4); a planning estimate, not a tokenizer count'
const DEFAULT_BUDGET = 2000 // Claude Code highlights a plugin at 2,000 always-on tokens
const DEFAULT_LARGE = 4000
const SKIP_DIRS = new Set(['node_modules', '.git', 'design-systems', 'fixtures', 'dist', 'build', '.design-os'])

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'when',
  'use', 'uses', 'using', 'this', 'that', 'is', 'are', 'be', 'it', 'its', 'as',
  'by', 'from', 'into', 'your', 'you', 'we', 'or', 'not', 'but', 'so', 'than',
  'then', 'there', 'their', 'them', 'they', 'at', 'if', 'do', 'does', 'can',
])

const KIND_ACTIONS = {
  removed: 'Search projects, saved prompts and docs for this name; replace it with the current path or tool, then re-run the check suite.',
  renamed: 'Update every reference and alias; keep the old name working for one release; re-run installer/plugin validation.',
  deprecated: 'Plan the replacement before the removal release; record the sunset version and the migration owner.',
  breaking: 'Read the entry, apply the change on a scratch branch, re-run the kit checks and a measure pass, then upgrade consumers.',
}

const KIND_LABEL = { removed: 'removed', renamed: 'renamed', deprecated: 'deprecated', breaking: 'breaking' }

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4)
}

function wordsOf(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || []
}

function contentWords(text) {
  return new Set(wordsOf(text).filter((w) => w.length > 2 && !STOPWORDS.has(w)))
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return shared / (a.size + b.size - shared)
}

function hashText(text) {
  // Tiny non-crypto digest: FNV-1a is enough to detect identical files.
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0') + ':' + text.length
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { fields: {}, body: text, ok: false }
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return { fields, body: text.slice(match[0].length), ok: true }
}

function walk(root, relative = '', depth = 0, out = []) {
  if (depth > 5) return out
  const dir = path.join(root, relative)
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = relative ? path.join(relative, entry.name) : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      walk(root, rel, depth + 1, out)
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      out.push(rel.split(path.sep).join('/'))
    }
  }
  return out
}

function resolveRoot(arg) {
  const candidate = arg ? path.resolve(arg) : path.resolve(HERE, '..')
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`root does not exist or is not a directory: ${candidate}`)
  }
  if (!fs.existsSync(path.join(candidate, 'skills')) && fs.existsSync(path.join(candidate, 'design-os', 'skills'))) {
    return path.join(candidate, 'design-os')
  }
  return candidate
}

function resolveChangelog(root, explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [path.join(root, 'CHANGELOG.md'), path.resolve(root, '..', 'CHANGELOG.md')]
  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
  }
  return null
}

// ── context inventory ─────────────────────────────────────────────────────
function readItem(root, rel, category, alwaysOnFields) {
  const file = path.join(root, rel)
  const text = fs.readFileSync(file, 'utf8')
  const stat = fs.statSync(file)
  const { fields, body, ok } = frontmatter(text)
  const description = fields.description || ''
  const name = fields.name || path.basename(path.dirname(rel)) || path.basename(rel, '.md')
  const alwaysOnText = alwaysOnFields
    ? [name, description, fields.when_to_use || ''].filter(Boolean).join('\n')
    : ''
  return {
    category,
    name,
    file: rel,
    bytes: stat.size,
    chars: text.length,
    words: (text.match(/\S+/g) || []).length,
    frontmatterOk: ok,
    descriptionChars: description.length,
    description,
    hash: hashText(text),
    tokens: {
      alwaysOn: estimateTokens(alwaysOnText),
      body: estimateTokens(body),
      total: estimateTokens(alwaysOnText) + estimateTokens(body),
    },
    bodyText: body,
  }
}

function inventory(root) {
  const items = []
  const listDir = (dir) => {
    try {
      return fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    } catch {
      return []
    }
  }

  for (const entry of listDir('skills')) {
    if (!entry.isDirectory()) continue
    const rel = `skills/${entry.name}/SKILL.md`
    if (!fs.existsSync(path.join(root, rel))) continue
    items.push(readItem(root, rel, 'skill', true))
  }
  for (const rel of walk(root, 'agents')) items.push(readItem(root, rel, 'agent', true))
  for (const entry of listDir('commands')) {
    if (entry.isFile() && /\.md$/i.test(entry.name)) items.push(readItem(root, `commands/${entry.name}`, 'command', true))
  }
  for (const rel of walk(root, 'craft')) items.push(readItem(root, rel, 'craft', false))
  for (const rel of walk(root, 'briefs')) items.push(readItem(root, rel, 'brief', false))
  for (const rel of walk(root, 'harness')) items.push(readItem(root, rel, 'harness', false))
  const META_DOCS = new Set(['README.md', 'ATTRIBUTION.md', 'VALIDATION.md', 'CHANGELOG.md'])
  for (const rel of walk(root, '')) {
    if (rel.includes('/') || META_DOCS.has(rel)) continue
    items.push(readItem(root, rel, 'doc', false))
  }
  return items
}

function buildContextReport(root, opts = {}) {
  const budget = Number(opts.budget) > 0 ? Number(opts.budget) : DEFAULT_BUDGET
  const large = Number(opts.large) > 0 ? Number(opts.large) : DEFAULT_LARGE
  const top = Number(opts.top) > 0 ? Number(opts.top) : 12
  const items = inventory(root)

  const alwaysOn = items.filter((i) => i.tokens.alwaysOn > 0)
  const alwaysOnTokens = alwaysOn.reduce((n, i) => n + i.tokens.alwaysOn, 0)
  const bodyTokens = items.reduce((n, i) => n + i.tokens.body, 0)
  const totalBytes = items.reduce((n, i) => n + i.bytes, 0)
  const flags = []
  const flag = (severity, id, message, file, fix) => flags.push({ severity, id, message, file, fix })

  // Budget and per-item always-on weight.
  if (alwaysOnTokens > budget) {
    flag('high', 'always-on-budget-exceeded',
      `Always-on context is ~${alwaysOnTokens} tokens against a ${budget}-token budget (${Math.round((alwaysOnTokens / budget) * 100)}%).`,
      null,
      'Shorten descriptions, split the plugin, or move rarely used skills out of the always-on set.')
  }
  for (const item of alwaysOn) {
    const share = budget ? item.tokens.alwaysOn / budget : 0
    if (item.tokens.alwaysOn > 400 || share > 0.25) {
      flag('medium', 'always-on-heavy',
        `${item.name} costs ~${item.tokens.alwaysOn} always-on tokens (${Math.round(share * 100)}% of budget).`,
        item.file,
        'Keep the trigger words, cut narrative from the description, and move detail into the skill body.')
    }
    if (!item.frontmatterOk) {
      flag('high', 'missing-frontmatter', `${item.file} has no parseable frontmatter; its trigger text will not load.`, item.file, 'Add a name/description frontmatter block.')
    } else if (!item.description) {
      flag('high', 'missing-description', `${item.file} has no description field.`, item.file, 'Add a description that says when to use it.')
    } else if (item.descriptionChars < 60) {
      flag('medium', 'short-description', `${item.file} description is only ${item.descriptionChars} chars; it may not trigger reliably.`, item.file, 'Describe the user request it answers, not the process.')
    }
  }

  // Large files (on-invoke cost).
  for (const item of items) {
    if (item.tokens.body > large) {
      flag('medium', 'large-file',
        `${item.file} is ~${item.tokens.body} on-invoke tokens (${item.bytes} bytes), above the ${large}-token threshold.`,
        item.file,
        'Split reference material into a loaded-on-demand reference file, or trim it. A big body only costs when used, but it still slows every invocation.')
    }
  }

  // Duplicate files.
  const byHash = new Map()
  for (const item of items) {
    if (!byHash.has(item.hash)) byHash.set(item.hash, [])
    byHash.get(item.hash).push(item.file)
  }
  for (const files of byHash.values()) {
    if (files.length > 1) {
      flag('high', 'duplicate-file', `Identical content in ${files.length} files: ${files.join(', ')}.`, files[0], 'Keep one copy and link to it; duplicated docs drift apart.')
    }
  }

  // Description overlap: descriptions that compete for the same request.
  const overlaps = []
  for (let i = 0; i < alwaysOn.length; i++) {
    for (let j = i + 1; j < alwaysOn.length; j++) {
      const a = alwaysOn[i]
      const b = alwaysOn[j]
      const score = jaccard(contentWords(a.description), contentWords(b.description))
      if (score >= 0.5) {
        const shared = [...contentWords(a.description)].filter((w) => contentWords(b.description).has(w)).slice(0, 8)
        overlaps.push({ a: a.name, b: b.name, score: Number(score.toFixed(2)), shared, files: [a.file, b.file] })
      }
    }
  }
  overlaps.sort((x, y) => y.score - x.score)
  for (const overlap of overlaps.slice(0, 10)) {
    flag('medium', 'trigger-overlap',
      `${overlap.a} and ${overlap.b} descriptions overlap ${Math.round(overlap.score * 100)}% (shared: ${overlap.shared.join(', ')}).`,
      overlap.files[0],
      'Give each skill a distinct request phrasing, or merge them. Overlapping descriptions make the router pick the wrong skill.')
  }

  // Reference docs nothing links by path. Directory-level references ("use the
  // craft/ rules") are normal, so cluster small groups instead of one note each.
  const corpusSources = items.filter((i) =>
    i.category === 'skill' || i.category === 'harness' || i.file === 'DESIGN-OS.md' || i.file === 'README.md' || i.file === 'VALIDATION.md')
  let installText = ''
  try {
    installText = fs.readFileSync(path.join(root, 'install.mjs'), 'utf8')
  } catch {
    // Optional.
  }
  const corpus = (corpusSources.map((i) => i.bodyText).join('\n') + '\n' + installText).toLowerCase()
  const unreferenced = []
  for (const item of items) {
    if (!['craft', 'brief', 'harness'].includes(item.category)) continue
    const base = path.basename(item.file).toLowerCase()
    if (!corpus.includes(base)) unreferenced.push({ file: item.file, tokens: item.tokens.body })
  }
  const byDir = new Map()
  for (const entry of unreferenced) {
    const dir = path.dirname(entry.file)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(entry)
  }
  const docNotes = []
  for (const [dir, entries] of byDir) {
    if (entries.length >= 3) docNotes.push({ dir, entries })
    else for (const entry of entries) docNotes.push({ dir, entries: [entry] })
  }
  for (const note of docNotes.slice(0, 6)) {
    if (note.entries.length > 1) {
      const tokens = note.entries.reduce((n, entry) => n + entry.tokens, 0)
      flag('note', 'unreferenced-docs',
        `${note.entries.length} files in ${note.dir}/ are not linked by path (~${tokens} tokens): ` +
        `${note.entries.slice(0, 6).map((entry) => path.basename(entry.file)).join(', ')}${note.entries.length > 6 ? ', …' : ''}. ` +
        'A directory-level reference may be intentional.',
        note.dir,
        'Link each file from the skill that needs it, or confirm the directory-level reference is deliberate.')
    } else {
      const entry = note.entries[0]
      flag('note', 'unreferenced-doc',
        `${entry.file} (~${entry.tokens} tokens) is not linked by path from any skill, DESIGN-OS.md or install.mjs.`,
        entry.file,
        'Link it from the skill that needs it, or delete it.')
    }
  }

  const flagCounts = { high: 0, medium: 0, note: 0 }
  for (const f of flags) flagCounts[f.severity] = (flagCounts[f.severity] || 0) + 1
  for (const item of items) delete item.bodyText

  return {
    schema: 'dezign0/context-report/v1',
    generated: new Date().toISOString(),
    root,
    estimator: ESTIMATOR,
    budget: {
      tokens: budget,
      used: alwaysOnTokens,
      remaining: budget - alwaysOnTokens,
      sharePct: budget ? Math.round((alwaysOnTokens / budget) * 100) : 0,
      status: alwaysOnTokens > budget ? 'exceeded' : alwaysOnTokens > budget * 0.8 ? 'near' : 'ok',
    },
    totals: {
      files: items.length,
      bytes: totalBytes,
      alwaysOnTokens,
      bodyTokens,
      totalTokens: alwaysOnTokens + bodyTokens,
    },
    items,
    alwaysOn,
    overlaps,
    unreferenced,
    flags,
    flagCounts,
    top,
  }
}

// ── migration / deprecation ───────────────────────────────────────────────
function classifyMigration(section, text) {
  const s = String(section || '').toLowerCase()
  // A bug fix is not a migration item, even when it says "no longer" or
  // "legacy". Security fixes likewise. Only explicit API/rename language counts.
  if (s === 'fixed' || s === 'security') return null
  if (s === 'removed') return 'removed'
  if (s === 'deprecated') return 'deprecated'

  if (/\bdeprecat(?:e|ed|es|ing|ion)\b|\bsunset\b/i.test(text)) return 'deprecated'
  if (/\brenam(?:e|ed|es|ing)\b|\bnow called\b|\breplaced (?:by|with)\b|\binstead of\b|\balias(?:ed|es|ing)?\b|\bmoved (?:to|from)\b/i.test(text)) return 'renamed'
  if (/\bremov(?:e|ed|es|ing)\b|\bdelet(?:e|ed|es|ing)\b|\bdropp(?:ed|ping)\b|\bno longer (?:supported|available|accepted|provided)\b/i.test(text)) return 'removed'
  if (/\bbreaking\b|\bincompatib(?:le|ility)\b|\bupgrade required\b|\bmigrat(?:e|ed|es|ing|ion)\b/i.test(text)) return 'breaking'

  const objectWord = /\b(?:api|tool|command|skill|option|flag|export|path|alias|hook|adapter|plugin|schema|package s?)\b/i.test(text)
  if (objectWord && s === 'changed' && /\b(?:chang|renam|remov|replac|deprecat|alias)\w*\b/i.test(text)) return 'breaking'
  if (objectWord && s === 'added' && /\b(?:alias|rename|replac)\w*\b/i.test(text)) return 'breaking'
  return null
}

function cleanInline(text) {
  return String(text || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseChangelog(text) {
  const lines = text.split(/\r?\n/)
  const bullets = []
  let version = null
  let date = null
  let section = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const versionMatch = /^##\s+\[?([0-9][^\]\s]*)\]?(?:\s*-\s*(.+))?\s*$/.exec(line)
    if (versionMatch) {
      version = versionMatch[1]
      date = (versionMatch[2] || '').trim() || null
      section = null
      continue
    }
    const sectionMatch = /^###\s+(.+?)\s*$/.exec(line)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line)
    if (!bulletMatch) continue
    let body = bulletMatch[1]
    const startLine = i + 1
    // Continuation lines belong to the same bullet.
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^[-*]\s/.test(lines[i + 1].trim())) {
      i++
      body += ' ' + lines[i].trim()
    }
    if (!version) continue
    const kind = classifyMigration(section, body)
    if (!kind) continue
    bullets.push({
      version,
      date,
      section: section || '',
      kind,
      text: cleanInline(body),
      line: startLine,
      action: KIND_ACTIONS[kind],
    })
  }
  const versions = [...new Set(bullets.map((b) => b.version))]
  return { bullets, versions }
}

function versionAtLeast(version, from) {
  if (!from) return true
  const a = String(version).split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const b = String(from).split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d) return d > 0
  }
  return true
}

function scanDeprecations(root) {
  const markers = []
  const roots = ['tools', 'adapters']
  const files = []
  for (const dir of roots) {
    try {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(mjs|js)$/i.test(entry.name)) continue
        files.push(`${dir}/${entry.name}`)
      }
    } catch {
      // Optional directory.
    }
  }
  for (const name of ['install.mjs']) if (fs.existsSync(path.join(root, name))) files.push(name)
  for (const rel of files) {
    // The scanner's own source contains marker examples; skip it so its
    // vocabulary never shows up as a finding about the kit.
    if (path.basename(rel) === 'context-report.mjs') continue
    let text
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      // Real annotations only: `@deprecated`, or a comment line that opens with
      // DEPRECATED / `deprecated:`. Prose that mentions the word is not a marker.
      if (/@deprecated\b|(?:\/\/|\*)\s*(?:DEPRECATED\b|deprecated\s*:)/.test(lines[i])) {
        markers.push({ file: rel, line: i + 1, text: cleanInline(lines[i]).slice(0, 140) })
        if (markers.length >= 40) return markers
      }
    }
  }
  return markers
}

function buildMigrationReport(root, opts = {}) {
  const changelogFile = resolveChangelog(root, opts.changelog)
  const consumerSteps = [
    'Pin the version you are upgrading from and to; store both in the project.',
    'Read every migration item below and mark each one applied, not-applicable, or blocked.',
    'Reinstall or re-copy the kit; diff skill bodies before overwriting project-local edits.',
    'Re-run npm run check, the content lint, and a measure pass on one artifact.',
    'Update AGENTS.md / CLAUDE.md / DESIGN.md references to renamed paths or tools.',
    'Verify hooks, aliases and saved prompts that name a removed or renamed skill.',
  ]
  if (!changelogFile) {
    return { input: null, from: opts.from || null, versions: [], items: [], codeMarkers: scanDeprecations(root), consumerSteps, note: 'No CHANGELOG.md found at the root or one directory above; migration items are empty.' }
  }
  const text = fs.readFileSync(changelogFile, 'utf8')
  const parsed = parseChangelog(text)
  const items = parsed.bullets.filter((b) => versionAtLeast(b.version, opts.from))
  const versions = []
  for (const version of [...new Set(items.map((i) => i.version))]) {
    const date = items.find((i) => i.version === version)?.date || null
    versions.push({ version, date, items: items.filter((i) => i.version === version) })
  }
  return {
    input: changelogFile,
    from: opts.from || null,
    versions,
    items,
    codeMarkers: scanDeprecations(root),
    consumerSteps,
    counts: { items: items.length, versions: versions.length, kinds: countKinds(items) },
  }
}

function countKinds(items) {
  const counts = {}
  for (const item of items) counts[item.kind] = (counts[item.kind] || 0) + 1
  return counts
}

// ── markdown ──────────────────────────────────────────────────────────────
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
const severityLabel = { high: 'HIGH', medium: 'MED', note: 'note' }

function renderMarkdown(context, migration) {
  const lines = []
  lines.push(`# Context and migration report — ${path.basename(context.root)}`, '')
  lines.push(`Generated: ${context.generated}`)
  lines.push('')
  lines.push(`Estimator: ${context.estimator}. The budget is a planning target, not a hard limit.`, '')

  lines.push('## Always-on context (paid every turn)', '')
  lines.push(`**~${context.budget.used} tokens** against a ${context.budget.tokens}-token budget ` +
    `(${context.budget.sharePct}%, ${context.budget.status}); headroom ${context.budget.remaining} tokens.`, '')
  if (!context.alwaysOn.length) {
    lines.push('No always-on items found (no skills/agents/commands in this root).', '')
  } else {
    lines.push('| Source | File | Desc chars | Tokens | Share |')
    lines.push('|---|---|---|---|---|')
    const sorted = [...context.alwaysOn].sort((a, b) => b.tokens.alwaysOn - a.tokens.alwaysOn)
    for (const item of sorted) {
      const share = context.budget.tokens ? Math.round((item.tokens.alwaysOn / context.budget.tokens) * 100) : 0
      lines.push(`| ${item.category} ${cell(item.name)} | ${item.file} | ${item.descriptionChars} | ~${item.tokens.alwaysOn} | ${share}% |`)
    }
    lines.push('')
  }

  lines.push('## On-invoke files (paid when used)', '')
  lines.push('| File | Category | Bytes | Tokens |')
  lines.push('|---|---|---|---|')
  const byBody = [...context.items].filter((i) => i.tokens.body > 0).sort((a, b) => b.tokens.body - a.tokens.body)
  for (const item of byBody.slice(0, context.top)) {
    lines.push(`| ${item.file} | ${item.category} | ${item.bytes} | ~${item.tokens.body} |`)
  }
  lines.push('')
  lines.push(`Totals: ${context.totals.files} files, ${context.totals.bytes} bytes, ` +
    `~${context.totals.alwaysOnTokens} always-on + ~${context.totals.bodyTokens} on-invoke tokens.`, '')

  lines.push('## Flags', '')
  if (!context.flags.length) {
    lines.push('No flags. Context budget, file sizes and descriptions are within the configured thresholds.', '')
  } else {
    lines.push('| Severity | Flag | Detail | Fix |')
    lines.push('|---|---|---|---|')
    for (const flag of context.flags) {
      lines.push(`| ${severityLabel[flag.severity] || flag.severity} | ${flag.id}${flag.file ? ` (${flag.file})` : ''} | ${cell(flag.message)} | ${cell(flag.fix)} |`)
    }
    lines.push('')
  }

  if (context.overlaps.length) {
    lines.push('## Description overlap (routing risk)', '')
    lines.push('| A | B | Overlap | Shared content words |')
    lines.push('|---|---|---|---|')
    for (const overlap of context.overlaps) {
      lines.push(`| ${overlap.a} | ${overlap.b} | ${Math.round(overlap.score * 100)}% | ${overlap.shared.join(', ')} |`)
    }
    lines.push('')
  }

  lines.push('## Migration and deprecation checklist', '')
  if (!migration.input) {
    lines.push(migration.note, '')
  } else {
    lines.push(`Source: ${path.relative(context.root, migration.input)} ` +
      `(${migration.counts.items} migration item(s) across ${migration.counts.versions} version(s)` +
      `${migration.from ? `, from ${migration.from}` : ''}).`, '')
    if (!migration.versions.length) {
      lines.push('No removed/renamed/deprecated/breaking entries matched the filter.', '')
    }
    for (const version of migration.versions) {
      lines.push(`### ${version.version}${version.date ? ` — ${version.date}` : ''}`, '')
      for (const item of version.items) {
        lines.push(`- [ ] **${KIND_LABEL[item.kind]}** ${cell(item.text)} *(line ${item.line})*`)
        lines.push(`  - Action: ${item.action}`)
      }
      lines.push('')
    }
  }

  lines.push('## Deprecation markers in source', '')
  if (!migration.codeMarkers?.length) {
    lines.push('None found in tools/, adapters/ or install.mjs.', '')
  } else {
    lines.push('| File | Line | Marker |')
    lines.push('|---|---|---|')
    for (const marker of migration.codeMarkers) lines.push(`| ${marker.file} | ${marker.line} | ${cell(marker.text)} |`)
    lines.push('')
  }

  lines.push('## Consumer upgrade checklist', '')
  for (const step of migration.consumerSteps) lines.push(`- [ ] ${step}`)
  lines.push('')
  return lines.join('\n')
}

// ── output / CLI helpers ──────────────────────────────────────────────────
function writeOut(file, content) {
  const target = path.resolve(file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  const rel = path.relative(process.cwd(), target)
  return rel.startsWith('..') ? target : rel
}

// ── self-test ─────────────────────────────────────────────────────────────
function writeFixtureTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dezign0-context-'))
  const kit = path.join(tmp, 'design-os')
  const write = (rel, content) => {
    const file = path.join(kit, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  const longBody = 'Reference paragraph for the fixture skill. '.repeat(700) // ~33k chars
  write('skills/alpha/SKILL.md', `---\nname: alpha\ndescription: Build a production-grade analytics dashboard with every state, real content and measured contrast.\n---\n\n# Alpha\n\n${longBody}`)
  write('skills/beta/SKILL.md', `---\nname: beta\ndescription: Build a production-grade analytics dashboard with every state, real content and measured layout.\n---\n\n# Beta\n\nShort body.\n`)
  write('skills/gamma/SKILL.md', `---\nname: alpha\ndescription: Build a production-grade analytics dashboard with every state, real content and measured contrast.\n---\n\n# Alpha\n\n${longBody}`)
  write('skills/delta/SKILL.md', '---\nname: delta\ndescription: Short.\n---\n\n# Delta\n\nBody.\n')
  write('agents/critic.md', '---\nname: critic\ndescription: Review a rendered artifact against a scored critique protocol with evidence.\n---\n\nYou review artifacts.\n')
  write('craft/used.md', '# Used note\n\nReferenced from alpha.\n')
  write('craft/orphan-doc.md', '# Orphan\n\nNothing points here.\n')
  write('DESIGN-OS.md', '# Design OS\n\nRead craft/used.md when reviewing.\n')
  write('tools/deprecated-tool.mjs', '// @deprecated remove in 1.0\nexport const x = 1\n')
  write('node_modules/noise.md', '# should never be scanned\n')
  fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), [
    '# Changelog',
    '',
    '## [1.0.0] - 2026-11-01',
    '',
    '### Removed',
    '',
    '- Removed the `design-ship` command; use `design-review --ship`.',
    '',
    '### Deprecated',
    '',
    '- Deprecated `alpha` skill in favour of `beta`.',
    '',
    '### Fixed',
    '',
    '- Fixed a legacy path that no longer existed.',
    '',
    '## [0.9.0] - 2026-10-01',
    '',
    '### Changed',
    '',
    '- Renamed `beta` to `beta-v2`; the old name is an alias.',
    '- Breaking: the `--old-mode` flag is gone.',
    '- Responsive breakpoints are canonical at every size.',
    '',
    '## [0.8.0] - 2026-09-01',
    '',
    '### Added',
    '',
    '- Added a new template.',
    '',
  ].join('\n'))
  return { tmp, kit }
}

function runSelfTest() {
  const { tmp, kit } = writeFixtureTree()
  const checks = []
  const check = (name, condition, detail) => {
    checks.push(Boolean(condition))
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${!condition && detail ? ` — ${detail}` : ''}`)
  }
  try {
    const context = buildContextReport(kit, { budget: 40, large: 4000, top: 10 })
    const migration = buildMigrationReport(kit, {})
    const alwaysOn = context.alwaysOn
    const byFile = (suffix) => context.items.find((i) => i.file.endsWith(suffix))
    const alpha = byFile('skills/alpha/SKILL.md')
    const beta = byFile('skills/beta/SKILL.md')
    const gamma = byFile('skills/gamma/SKILL.md')

    check('skills and agents are always-on', alwaysOn.some((i) => i.name === 'alpha') && alwaysOn.some((i) => i.name === 'critic'))
    check('token estimate is ceil(chars/4)', alpha.tokens.alwaysOn === Math.ceil((alpha.descriptionChars + 'alpha'.length + 1) / 4), `${alpha.tokens.alwaysOn}`)
    check('always-on total equals sum of items', context.totals.alwaysOnTokens === alwaysOn.reduce((n, i) => n + i.tokens.alwaysOn, 0))
    check('budget exceeded with a small budget', context.flags.some((f) => f.id === 'always-on-budget-exceeded' && f.severity === 'high'))
    check('large body flagged', context.flags.some((f) => f.id === 'large-file' && f.file.includes('skills/alpha')), context.flags.map((f) => f.id).join(','))
    check('overlapping descriptions flagged', context.overlaps.some((o) => [o.a, o.b].includes('alpha') && [o.a, o.b].includes('beta')), JSON.stringify(context.overlaps))
    check('identical files flagged', context.flags.some((f) => f.id === 'duplicate-file'))
    check('short description flagged', context.flags.some((f) => f.id === 'short-description' && f.file.includes('delta')))
    check('orphan doc flagged', context.flags.some((f) => f.id === 'unreferenced-doc' && f.file.includes('orphan-doc')))
    check('referenced doc not flagged', !context.flags.some((f) => f.id === 'unreferenced-doc' && f.file.includes('craft/used')))
    check('node_modules not scanned', !context.items.some((i) => i.file.includes('node_modules')))
    check('gamma resolves as duplicate, not missing', gamma && alpha.hash === gamma.hash)

    check('changelog items classified', migration.items.length >= 4, JSON.stringify(migration.counts))
    const kinds = migration.items.map((i) => i.kind)
    check('removed entry classified', kinds.includes('removed'))
    check('deprecated entry classified', kinds.includes('deprecated'))
    check('renamed entry classified', kinds.includes('renamed'))
    check('breaking entry classified', kinds.includes('breaking'))
    check('line numbers recorded', migration.items.every((i) => i.line > 0))
    check('fixed-section prose is not migration noise', !migration.items.some((i) => /legacy path/i.test(i.text)), JSON.stringify(migration.items.map((i) => i.text)))
    check('substring "breakpoints" is not classified as breaking', !migration.items.some((i) => /breakpoints/i.test(i.text)), JSON.stringify(migration.items.map((i) => i.text)))
    const fromReport = buildMigrationReport(kit, { from: '1.0.0' })
    check('--from filters older versions', fromReport.items.every((i) => i.version === '1.0.0'))
    check('deprecation marker scanned', migration.codeMarkers.some((m) => m.text.includes('@deprecated')))
    check('consumer steps present', migration.consumerSteps.length >= 5)

    const markdown = renderMarkdown(context, migration)
    check('markdown has both sections', markdown.includes('Always-on context') && markdown.includes('Migration and deprecation checklist'))
    check('markdown renders checkboxes', markdown.includes('- [ ] **removed**'))

    const cli = (args) => spawnSync(process.execPath, [path.join(HERE, 'context-report.mjs'), ...args], { encoding: 'utf8' })
    const jsonRun = cli([`--root=${kit}`, '--json', '--budget=40'])
    let parsed = null
    try { parsed = JSON.parse(jsonRun.stdout) } catch { /* reported below */ }
    check('--json exits 0 and parses', jsonRun.status === 0 && parsed?.schema === 'dezign0/context-report/v1', `status ${jsonRun.status}`)
    check('--json carries migration', parsed && Array.isArray(parsed.migration?.items) && parsed.migration.items.length >= 4)
    const strictRun = cli([`--root=${kit}`, '--budget=40', '--strict'])
    check('--strict exits 1 with high/medium flags', strictRun.status === 1, `status ${strictRun.status}`)
    const outFile = path.join(tmp, 'out', 'context.md')
    check('--out writes markdown', cli([`--root=${kit}`, `--out=${outFile}`, '--budget=40']).status === 0 && fs.existsSync(outFile))
    const outJson = path.join(tmp, 'out', 'context.json')
    check('--out with --json writes JSON', cli([`--root=${kit}`, `--out=${outJson}`, '--json', '--budget=40']).status === 0 &&
      (() => { try { return JSON.parse(fs.readFileSync(outJson, 'utf8')).schema === 'dezign0/context-report/v1' } catch { return false } })())
    check('bad root exits 2', cli([`--root=${path.join(tmp, 'missing')}`]).status === 2)
    check('unknown flag exits 2', cli([`--root=${kit}`, '--nope']).status === 2)

    const failed = checks.filter((ok) => !ok).length
    console.log(`\ncontext-report --self-test: ${failed ? failed + ' check(s) failed' : 'all checks passed'}`)
    return failed ? 1 : 0
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ── main ──────────────────────────────────────────────────────────────────
function main(argv) {
  const args = argv.slice(2)
  const BOOLEAN = new Set(['json', 'strict', 'self-test', 'help', 'h'])
  const VALUED = new Set(['root', 'out', 'budget', 'large', 'top', 'changelog', 'from'])
  const KNOWN = new Set([...BOOLEAN, ...VALUED])
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      console.error(`context-report: unexpected argument ${arg}. See --help.`)
      return 2
    }
    const eq = arg.indexOf('=')
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (!KNOWN.has(key)) {
      console.error(`context-report: unknown option --${key}. See --help.`)
      return 2
    }
    if (eq !== -1) { opts[key] = arg.slice(eq + 1); continue }
    if (BOOLEAN.has(key)) { opts[key] = true; continue }
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++ } else { opts[key] = true }
  }
  if (opts.help || opts.h) {
    console.log(`context-report — context cost and migration/deprecation report

Usage: node context-report.mjs [options]

  --root=DIR         kit root to scan (default: this tool's parent directory)
  --budget=TOKENS    always-on budget (default ${DEFAULT_BUDGET}; Claude Code highlights 2,000)
  --large=TOKENS     on-invoke size threshold per file (default ${DEFAULT_LARGE})
  --top=N            rows in the on-invoke table (default 12)
  --changelog=FILE   CHANGELOG.md to parse (default: root/ or one directory above)
  --from=VERSION     only migration items in versions newer than this
  --json             print the report model as JSON
  --out=FILE         write markdown (or JSON with --json) to FILE
  --strict           exit 1 when a high or medium flag exists
  --self-test        run the embedded fixture tests (no repository fixtures needed)

Estimator: ${ESTIMATOR}.
Always-on = skill/agent/command name + description (paid every turn).
On-invoke = bodies and reference docs (paid only when used).
Exit codes: 0 report generated, 1 --strict with high/medium flags, 2 usage/read error.`)
    return 0
  }
  if (opts['self-test']) return runSelfTest()

  let root
  try {
    root = resolveRoot(typeof opts.root === 'string' ? opts.root : null)
  } catch (error) {
    console.error(`context-report: ${error.message}`)
    return 2
  }
  let context
  let migration
  try {
    context = buildContextReport(root, {
      budget: opts.budget,
      large: opts.large,
      top: opts.top,
    })
    migration = buildMigrationReport(root, {
      from: typeof opts.from === 'string' ? opts.from : null,
      changelog: typeof opts.changelog === 'string' ? opts.changelog : null,
    })
  } catch (error) {
    console.error(`context-report: ${error.message}`)
    return 2
  }
  const report = { ...context, migration }
  const markdown = renderMarkdown(context, migration)

  if (typeof opts.out === 'string') {
    try {
      const file = writeOut(opts.out, opts.json ? JSON.stringify(report, null, 2) + '\n' : markdown)
      console.log(`wrote ${file}`)
    } catch (error) {
      console.error(`context-report: cannot write output: ${error.message}`)
      return 2
    }
  } else if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(markdown)
  }

  const blocking = (context.flagCounts.high || 0) + (context.flagCounts.medium || 0)
  if (opts.strict && blocking > 0) return 1
  return 0
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isEntry) process.exit(main(process.argv))

export { buildContextReport, buildMigrationReport, renderMarkdown, parseChangelog, classifyMigration, inventory, estimateTokens }
