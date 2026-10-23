#!/usr/bin/env node
/**
 * safety-scan.mjs — static safety review for generated HTML/SVG artifacts.
 *
 * Usage:
 *   node safety-scan.mjs <file-or-dir...> [--json] [--strict] [--quiet]
 *   node safety-scan.mjs design/<slug> --allow=cdn.example.com
 *   node safety-scan.mjs --self-test
 *
 * Checks: external scripts, known trackers, secret-like strings (masked in
 * output), unsafe embeds, javascript:/data:text/html URLs, remote fonts,
 * remote requests, external forms, meta refresh, remote hints and missing
 * license/notice files for external assets.
 *
 * Contract:
 *   - every input must resolve inside --root (default: current directory);
 *   - no network access, no shell, no dependencies;
 *   - secrets are never printed in full; evidence is masked;
 *   - exit 0 clean or P2-only, 1 blocking finding (P0/P1, or P2 with
 *     --strict), 2 usage/path/read error.
 *
 * Node 18+.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SELF = process.argv[1] ? path.resolve(process.argv[1]) : 'safety-scan.mjs'
const SCHEMA = 'dezign0/safety-scan/v1'
const MAX_BYTES = 5 * 1024 * 1024
const SCAN_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xhtml', '.css', '.js', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.design-os', 'dist', 'build', 'test-results'])
const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2 }

const TRACKER_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'googlesyndication.com',
  'connect.facebook.net', 'facebook.net', 'facebook.com', 'hotjar.com', 'hotjar.io',
  'segment.com', 'segment.io', 'mixpanel.com', 'amplitude.com', 'clarity.ms',
  'hubspot.com', 'hs-scripts.com', 'hs-analytics.net', 'fullstory.com', 'heap.io',
  'matomo.cloud', 'statcounter.com', 'quantserve.com', 'scorecardresearch.com',
  'adroll.com', 'bat.bing.com', 'tiktok.com', 'plausible.io', 'umami.is',
  'vercel-insights.com', 'sentry.io', 'bugsnag.com', 'newrelic.com',
]

const SECRET_PATTERNS = [
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { id: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { id: 'github-pat', re: /github_pat_[A-Za-z0-9_]{50,}/g },
  { id: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'stripe-secret', re: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'bearer-token', re: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi },
  { id: 'generic-secret', re: /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*["']([^"'\s]{12,})["']/gi, group: 1 },
]

class ScanError extends Error {
  constructor(message, code = 2) {
    super(message)
    this.code = code
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────
const BOOL_FLAGS = new Set(['json', 'strict', 'quiet', 'help', 'self-test'])
const VALUE_FLAGS = new Set(['root', 'allow', 'license'])

function parseArgs(argv) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg === '-h') {
      flags.help = true
      continue
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (BOOL_FLAGS.has(name)) {
      if (eq !== -1) throw new ScanError(`--${name} does not take a value`)
      flags[name] = true
      continue
    }
    if (VALUE_FLAGS.has(name)) {
      const value = eq !== -1 ? arg.slice(eq + 1) : argv[i + 1]
      if (value === undefined || (eq === -1 && value.startsWith('--'))) throw new ScanError(`--${name} requires a value`)
      if (eq === -1) i += 1
      flags[name] = value
      continue
    }
    throw new ScanError(`unknown flag --${name}`)
  }
  return { flags, positionals }
}

function usage(exitCode) {
  console.log(`safety-scan — static safety review for design artifacts

Usage: node safety-scan.mjs <file-or-dir...> [options]
       node safety-scan.mjs --self-test

Options:
  --root=<dir>       Files must resolve inside this directory (default: cwd).
  --allow=<domains>  Comma-separated remote hosts allowed for assets; their
                     findings are downgraded to P2. Trackers and secrets are
                     never allowlisted.
  --license=<file>   Explicit license/notice/attribution file for the project.
  --strict           Treat P2 findings as blocking too.
  --json             Machine-readable JSON on stdout.
  --quiet            Only the summary line.
  --help, -h         This help.

Checks: external scripts, trackers, secret-like strings (masked), unsafe
embeds, javascript:/data:text/html URLs, remote fonts, remote requests,
external forms, meta refresh, remote hints and missing license/notice files.
Directories are scanned for .html/.htm/.svg/.xhtml/.css/.js/.mjs files.

Exit codes: 0 clean or P2 only, 1 blocking findings, 2 usage/path/read error.
No network. Node 18+.`)
  process.exit(exitCode)
}

function isInside(parent, child) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

function resolveRoot(flags) {
  const root = path.resolve(flags.root || process.cwd())
  let stat
  try {
    stat = fs.statSync(root)
  } catch {
    throw new ScanError(`scan root not found: ${root}`)
  }
  if (!stat.isDirectory()) throw new ScanError(`scan root is not a directory: ${root}`)
  return root
}

function resolveInput(root, input) {
  const absolute = path.resolve(root, input)
  if (!isInside(root, absolute)) throw new ScanError(`input escapes the scan root: ${input}`)
  let stat
  try {
    stat = fs.statSync(absolute)
  } catch {
    throw new ScanError(`input not found: ${input}`)
  }
  const real = fs.realpathSync(absolute)
  if (!isInside(fs.realpathSync(root), real)) throw new ScanError(`input resolves outside the scan root: ${input}`)
  return { absolute: real, stat }
}

function expandInputs(root, inputs) {
  const files = []
  for (const input of inputs) {
    const resolved = resolveInput(root, input)
    if (resolved.stat.isDirectory()) {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (SKIP_DIRS.has(entry.name)) continue
          const child = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(child)
          else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fs.realpathSync(child))
        }
      }
      walk(resolved.absolute)
    } else if (resolved.stat.isFile()) {
      files.push(resolved.absolute)
    } else {
      throw new ScanError(`unsupported input: ${input}`)
    }
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b))
}

// ── Helpers ────────────────────────────────────────────────────────────────
function lineFinder(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1)
  return (index) => {
    let low = 0
    let high = starts.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (starts[mid] <= index) low = mid + 1
      else high = mid - 1
    }
    return Math.max(1, high + 1)
  }
}

function attribute(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = re.exec(tag)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? null
}

function urlInfo(value) {
  if (typeof value !== 'string') return null
  const url = value.trim()
  if (!url) return null
  if (/^data:/i.test(url)) return { url, protocol: 'data', remote: false, host: null }
  if (/^(?:javascript|mailto|tel|blob|file|about):/i.test(url)) return { url, protocol: url.split(':')[0].toLowerCase(), remote: false, host: null }
  const normalized = url.startsWith('//') ? `https:${url}` : url
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    return null
  }
  if (!/^https?:$/.test(parsed.protocol)) return { url, protocol: parsed.protocol.replace(':', ''), remote: false, host: parsed.hostname || null }
  return { url, protocol: parsed.protocol.replace(':', ''), remote: true, host: (parsed.hostname || '').toLowerCase(), href: parsed.href }
}

function isRemote(value) {
  const info = urlInfo(value)
  return Boolean(info && info.remote)
}

function hostAllowed(host, allow) {
  if (!host) return false
  return allow.some((entry) => host === entry || host.endsWith(`.${entry}`))
}

function maskSecret(value) {
  const text = String(value)
  if (text.includes('-----BEGIN')) return 'PRIVATE KEY block (masked)'
  if (text.length <= 6) return `${text.slice(0, 2)}…(${text.length} chars)`
  return `${text.slice(0, 4)}…(${text.length} chars)`
}

/** Keep scheme/host/path only: query strings can themselves carry secrets. */
function safeOrigin(value) {
  const text = String(value || '')
  try {
    const parsed = new URL(text.startsWith('//') ? `https:${text}` : text)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return text.split(/[?#]/)[0]
  }
}

function placeholderSecret(value) {
  return /\$\{|process\.env|YOUR_|REPLACE|CHANGEME|example|placeholder|<[^>]+>|xxx|\.\.\.|…|\*\*\*/i.test(value)
}

function trackerHost(host) {
  if (!host) return null
  return TRACKER_DOMAINS.find((domain) => host === domain || host.endsWith(`.${domain}`)) || null
}

// ── Scan ───────────────────────────────────────────────────────────────────
function scanFile(file, root, allow) {
  const buffer = fs.readFileSync(file)
  if (buffer.length > MAX_BYTES) return { findings: [], warning: `${path.relative(root, file)} is larger than 5 MB; skipped`, remoteOrigins: [], hasRemoteAsset: false }
  if (buffer.includes(0)) return { findings: [], warning: `${path.relative(root, file)} is binary; skipped`, remoteOrigins: [], hasRemoteAsset: false }
  const text = buffer.toString('utf8')
  const relative = path.relative(root, file).split(path.sep).join('/')
  const lineOf = lineFinder(text)
  const findings = []
  const remoteOrigins = new Set()
  let hasRemoteAsset = false
  const seen = new Set()

  const add = (category, severity, index, message, fix, extra = {}) => {
    const key = `${category}:${index}`
    if (seen.has(key)) return
    seen.add(key)
    const finding = {
      id: category,
      severity,
      category,
      file: relative,
      line: lineOf(index),
      message,
      fix,
      ...(extra.evidence ? { evidence: extra.evidence } : {}),
      ...(extra.origin ? { origin: extra.origin } : {}),
    }
    findings.push(finding)
  }

  const addRemote = (category, severity, index, url, message, fix, { asset = true } = {}) => {
    const info = urlInfo(url)
    if (!info || !info.remote) {
      if (info && info.protocol === 'data' && /^data:text\/html/i.test(info.url)) {
        add('data-html', 'P0', index, 'Embedded data:text/html document', 'Inline static HTML instead of a data URL, or sandbox the embed explicitly.')
        return
      }
      return
    }
    if (asset) hasRemoteAsset = true
    const origin = safeOrigin(info.href || info.url)
    remoteOrigins.add(origin)
    const tracker = trackerHost(info.host)
    if (tracker && asset && category !== 'tracker') {
      add('tracker', 'P0', index, `Known tracker/analytics domain: ${tracker}`, 'Remove the tracker; generated design artifacts must not ship analytics.', { origin })
    }
    add(category, severity, index, `${message}: ${info.host || info.url}`, fix, { origin })
  }

  // Tags
  for (const match of text.matchAll(/\bsrcdoc\s*=\s*["']/gi)) {
    add('unsafe-embed', 'P0', match.index, 'srcdoc embed executes embedded markup', 'Remove srcdoc; inline reviewed static markup or sandbox an external page.')
  }
  for (const match of text.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0]
    const src = attribute(tag, 'src')
    if (src) {
      const info = urlInfo(src)
      if (info && /^data:text\/html/i.test(info.url)) add('data-html', 'P0', match.index, 'Script URL is a data:text/html document', 'Use a local module script instead of a data URL.')
      else addRemote('remote-script', 'P0', match.index, src, 'External script', 'Vendor the script locally and review it, or remove it.', { asset: true })
    }
  }

  for (const match of text.matchAll(/<iframe\b[^>]*>/gi)) {
    const tag = match[0]
    const src = attribute(tag, 'src')
    if (src) {
      const info = urlInfo(src)
      if (info && /^data:text\/html/i.test(info.url)) add('data-html', 'P0', match.index, 'iframe src is a data:text/html document', 'Inline reviewed markup instead of a data URL iframe.')
      else addRemote('remote-iframe', 'P1', match.index, src, 'Remote iframe', 'Vendor the page or remove the iframe; remote frames load untrusted code.')
    }
  }

  for (const match of text.matchAll(/<(object|embed)\b[^>]*>/gi)) {
    const tag = match[0]
    if (/data:text\/html/i.test(tag)) add('data-html', 'P0', match.index, `${match[1]} embeds a data:text/html document`, 'Replace the embed with reviewed static markup.')
    else add('unsafe-embed', 'P1', match.index, `Unsafe <${match[1].toLowerCase()}> embed`, 'Remove object/embed; generated artifacts should not load plugin content.')
    const data = attribute(tag, 'data')
    if (data) addRemote('remote-request', 'P1', match.index, data, 'Remote object/embed payload', 'Vendor the payload with its license, or remove the embed.')
  }

  for (const match of text.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const href = attribute(tag, 'href')
    if (!href) continue
    const info = urlInfo(href)
    if (!info || !info.remote) continue
    const rel = (attribute(tag, 'rel') || '').toLowerCase()
    const as = (attribute(tag, 'as') || '').toLowerCase()
    if (rel.includes('stylesheet')) addRemote('remote-request', 'P1', match.index, href, 'Remote stylesheet', 'Vendor the CSS locally or remove the dependency.')
    else if (rel.includes('preconnect') || rel.includes('dns-prefetch')) addRemote('remote-hint', 'P2', match.index, href, 'Remote preconnect hint', 'Remove connection hints; they leak network metadata without user value.', { asset: false })
    else if (as === 'font' || /fonts\.(?:googleapis|gstatic)\.com/i.test(href)) addRemote('remote-font', 'P1', match.index, href, 'Remote font', 'Self-host the font with a license file, or use a system font stack.')
    else if (rel.includes('preload') || rel.includes('modulepreload') || rel.includes('prefetch')) addRemote('remote-request', 'P1', match.index, href, 'Remote preload', 'Vendor the asset locally or remove the preload.')
    else if (/(^|\s)(icon|manifest|apple-touch-icon|mask-icon)(\s|$)/.test(rel)) addRemote('remote-request', 'P1', match.index, href, 'Remote linked resource', 'Vendor the resource locally or remove the dependency.')
  }

  for (const match of text.matchAll(/\bsrcset\s*=\s*["']([^"']*)["']/gi)) {
    for (const candidate of match[1].split(',')) {
      const url = candidate.trim().split(/\s+/)[0]
      if (url) addRemote('remote-request', 'P1', match.index, url, 'Remote srcset asset', 'Vendor the asset with its license/attribution, or remove it.')
    }
  }

  for (const match of text.matchAll(/<(img|source|video|audio|track|input)\b[^>]*>/gi)) {
    const tag = match[0]
    const url = attribute(tag, 'src') || attribute(tag, 'poster')
    if (url) addRemote('remote-request', 'P1', match.index, url, `Remote ${match[1].toLowerCase()} asset`, 'Vendor the asset with its license/attribution, or remove it.')
  }

  for (const match of text.matchAll(/<form\b[^>]*>/gi)) {
    const action = attribute(match[0], 'action')
    if (action) addRemote('external-form', 'P1', match.index, action, 'Form submits to a remote endpoint', 'Remove network submissions; artifacts must be self-contained.')
  }

  for (const match of text.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(match[0], 'href')
    if (href && isRemote(href)) addRemote('external-link', 'P2', match.index, href, 'External navigation link', 'Confirm this link is intentional and documented; links are not executed automatically.', { asset: false })
  }

  for (const match of text.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi)) {
    add('meta-refresh', 'P1', match.index, 'Meta refresh redirects or reloads the page', 'Remove meta refresh; navigation belongs to the user.')
  }

  for (const match of text.matchAll(/(?:href|src|action)\s*=\s*["']\s*javascript:/gi)) {
    add('javascript-url', 'P0', match.index, 'javascript: URL executes code', 'Replace the handler with a real button and a local script.')
  }

  for (const match of text.matchAll(/(?:src|href)\s*=\s*["']?\s*data:text\/html/gi)) {
    add('data-html', 'P0', match.index, 'data:text/html URL', 'Inline reviewed static markup instead of a data URL.')
  }

  // CSS: fonts, imports, other remote urls.
  const fontFaceSpans = []
  for (const match of text.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
    fontFaceSpans.push([match.index, match.index + match[0].length])
    if (/url\(\s*["']?(?:https?:)?\/\//i.test(match[0])) {
      addRemote('remote-font', 'P1', match.index, /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/i.exec(match[0])?.[1] || '', 'Remote @font-face source', 'Self-host the font with a license file, or use a system font stack.')
    }
  }
  for (const match of text.matchAll(/@import\s+(?:url\(\s*)?["']?((?:https?:)?\/\/[^"')\s]+)/gi)) {
    addRemote('remote-request', 'P1', match.index, match[1], 'Remote CSS @import', 'Vendor the CSS locally or remove the import.')
  }
  for (const match of text.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi)) {
    const insideFont = fontFaceSpans.some(([start, end]) => match.index >= start && match.index < end)
    if (insideFont) continue
    addRemote('remote-request', 'P1', match.index, match[1], 'Remote CSS asset request', 'Vendor the asset with its license/attribution, or remove it.')
  }

  // Inline network calls and tracker snippets.
  for (const match of text.matchAll(/(?:fetch|sendBeacon|WebSocket|EventSource)\s*\(\s*["'`](https?:\/\/[^"'`\s]+)/gi)) {
    addRemote('remote-request', 'P1', match.index, match[1], 'Inline network request', 'Remove runtime network calls; artifacts must be self-contained.')
  }
  for (const match of text.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["'`](https?:\/\/[^"'`\s]+)["'`]|\bimport\s*\(\s*["'`](https?:\/\/[^"'`\s]+)["'`]/gi)) {
    addRemote('remote-request', 'P1', match.index, match[1] || match[2], 'Remote ES module import', 'Vendor the module locally and review it, or remove the dependency.')
  }
  for (const match of text.matchAll(/\b(?:gtag|fbq|hj|clarity|plausible|umami)\s*\(|mixpanel\.(?:track|init)\s*\(|amplitude\.(?:getInstance|track)\s*\(/gi)) {
    add('tracker', 'P0', match.index, 'Inline analytics/tracker snippet', 'Remove the tracker; generated artifacts must not ship analytics.')
  }
  for (const match of text.matchAll(/\bdataLayer\s*(?:\.|\[)/gi)) {
    add('tracker', 'P1', match.index, 'Google Tag Manager dataLayer usage', 'Remove GTM; generated artifacts must not ship analytics.')
  }

  // Secrets — masked, never printed in full.
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0
    for (const match of text.matchAll(pattern.re)) {
      const value = pattern.group ? match[pattern.group] : match[0]
      if (!value || placeholderSecret(value)) continue
      const index = pattern.group ? match.index + match[0].indexOf(match[pattern.group]) : match.index
      add('secret', 'P0', index, `Possible ${pattern.id.replaceAll('-', ' ')} (masked: ${maskSecret(value)})`, 'Remove the credential, rotate it, and load secrets from environment variables at runtime.', { evidence: maskSecret(value) })
    }
  }

  return { findings, warning: null, remoteOrigins: [...remoteOrigins], hasRemoteAsset }
}

function walkUpForLicense(file, root) {
  const names = /^(LICENSE|LICENCE|NOTICE|ATTRIBUTION|COPYING)(\..*)?$/i
  let dir = path.dirname(file)
  for (;;) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && names.test(entry.name)) return path.join(dir, entry.name)
      }
    } catch {
      // Ignore unreadable ancestors and keep walking.
    }
    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir || !isInside(root, parent)) break
    dir = parent
  }
  // Root itself may hold the notice even when the artifact sits deeper.
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && names.test(entry.name)) return path.join(root, entry.name)
    }
  } catch {
    // No readable root.
  }
  return null
}

// ── Report ─────────────────────────────────────────────────────────────────
function runScan(flags, positionals) {
  const root = resolveRoot(flags)
  if (!positionals.length) throw new ScanError('provide at least one file or directory')
  const files = expandInputs(root, positionals)
  if (!files.length) throw new ScanError('no scannable files found')
  const allow = (flags.allow ? String(flags.allow).split(',') : [])
    .map((entry) => entry.trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase())
    .filter(Boolean)
  const warnings = []
  const findings = []
  const remoteOrigins = new Set()
  let hasRemoteAsset = false
  let firstRemoteFile = null

  for (const file of files) {
    const result = scanFile(file, root, allow)
    if (result.warning) warnings.push(result.warning)
    for (const origin of result.remoteOrigins) remoteOrigins.add(origin)
    if (result.hasRemoteAsset) {
      hasRemoteAsset = true
      if (!firstRemoteFile) firstRemoteFile = file
    }
    findings.push(...result.findings)
  }

  let license = null
  let licenseMissing = false
  if (flags.license) {
    const resolved = resolveInput(root, flags.license)
    if (!resolved.stat.isFile()) throw new ScanError('--license must point at a file')
    license = resolved.absolute
  } else if (hasRemoteAsset) {
    license = walkUpForLicense(firstRemoteFile, root)
    licenseMissing = !license
  }
  if (licenseMissing) {
    findings.push({
      id: 'missing-license',
      severity: 'P1',
      category: 'missing-license',
      file: path.relative(root, firstRemoteFile).split(path.sep).join('/'),
      line: 1,
      message: `External assets have no license/notice/attribution file in the project (${remoteOrigins.size} origin(s))`,
      fix: 'Add a LICENSE, NOTICE or ATTRIBUTION file next to the artifact/project, or vendor licensed assets explicitly.',
    })
  }

  // Allowlisting downgrades remote asset findings only; never secrets/trackers.
  for (const finding of findings) {
    if (finding.category === 'secret' || finding.category === 'tracker' || finding.category === 'missing-license') continue
    if (!finding.origin) continue
    const info = urlInfo(finding.origin)
    if (info && hostAllowed(info.host, allow)) {
      finding.allowed = true
      finding.severity = 'P2'
      finding.message = `${finding.message} (allowed by --allow)`
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || a.file.localeCompare(b.file)
    || a.line - b.line
    || a.id.localeCompare(b.id))

  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  const blocking = counts.P0 > 0 || counts.P1 > 0 || (Boolean(flags.strict) && counts.P2 > 0)
  const code = blocking ? 1 : 0
  const payload = {
    schema: SCHEMA,
    ok: !blocking,
    root,
    files: files.map((file) => path.relative(root, file).split(path.sep).join('/')),
    allow,
    license: license ? path.relative(root, license).split(path.sep).join('/') : null,
    counts,
    blocking,
    strict: Boolean(flags.strict),
    warnings,
    findings,
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return code
  }
  if (!flags.quiet) {
    for (const finding of findings) {
      console.log(`${finding.severity}  ${finding.id.padEnd(16)} ${finding.file}:${finding.line}  ${finding.message}`)
      console.log(`     fix: ${finding.fix}`)
    }
    for (const warning of warnings) console.error(`safety-scan: ${warning}`)
  }
  console.log(`safety-scan: ${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2 across ${files.length} file(s)${blocking ? ' — blocking' : ''}`)
  return code
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dezign0-safety-test-'))
  let passed = 0
  const failures = []
  const test = (name, fn) => {
    try {
      fn()
      passed += 1
      console.log(`ok   ${name}`)
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
      console.log(`FAIL ${name}: ${error.message}`)
    }
  }
  const cleanup = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
  const write = (name, content) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
  }
  const run = (...args) => spawnSync(process.execPath, [SELF, ...args, '--root', root, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const json = (result) => {
    if (!result.stdout) throw new Error(`no stdout; stderr: ${result.stderr.trim()}`)
    return JSON.parse(result.stdout)
  }

  try {
    write('clean.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Clean</title>
<style>:root{--bg:#fff}body{background:var(--bg)}</style></head>
<body><img src="local.png" alt=""><a href="local.html">Local</a></body></html>
`)
    write('local.png', 'x')
    write('risky.html', `<!doctype html>
<html><head>
<script src="https://cdn.example.com/app.js"></script>
<script>gtag('config', 'G-123');</script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<style>@font-face{font-family:x;src:url(https://fonts.example.com/x.woff2)} .hero{background:url(https://img.example.com/hero.png)}</style>
</head><body>
<iframe srcdoc="<h1>hi</h1>"></iframe>
<img src="https://img.example.com/a.png?access_token=supersecretvalue123" alt="">
<script>fetch('https://api.example.com/collect')</script>
<script>const key = "AKIAZ7Q2W4X6Y8B0C1D2";</script>
<a href="javascript:alert(1)">bad</a>
</body></html>
`)
    write('allow.html', '<!doctype html><html><head><script src="https://cdn.example.com/app.js"></script></head><body></body></html>\n')
    write('hint.html', '<!doctype html><html><head><link rel="dns-prefetch" href="https://cdn.example.com"></head><body></body></html>\n')

    test('clean artifact has no findings', () => {
      const result = run('clean.html')
      if (result.status !== 0) throw new Error(`expected 0, got ${result.status}: ${result.stdout}`)
      const payload = json(result)
      if (payload.findings.length) throw new Error(`unexpected findings: ${payload.findings.map((f) => f.id).join(', ')}`)
    })

    test('risky artifact catches scripts, trackers, secrets and embeds', () => {
      const result = run('risky.html')
      if (result.status !== 1) throw new Error(`expected blocking exit 1, got ${result.status}`)
      const payload = json(result)
      const ids = new Set(payload.findings.map((finding) => finding.id))
      for (const id of ['remote-script', 'tracker', 'secret', 'unsafe-embed', 'remote-font', 'remote-request', 'javascript-url']) {
        if (!ids.has(id)) throw new Error(`missing ${id}; got ${[...ids].join(', ')}`)
      }
      if (payload.counts.P0 < 3) throw new Error('expected P0 findings')
      if (JSON.stringify(payload).includes('AKIAZ7Q2W4X6Y8B0C1D2')) throw new Error('secret leaked in output')
      if (JSON.stringify(payload).includes('supersecretvalue123')) throw new Error('URL query value leaked in output')
      if (!payload.findings.some((finding) => finding.id === 'secret' && /\(20 chars\)/.test(finding.evidence || ''))) throw new Error('secret evidence is not masked')
    })

    test('license/notice file satisfies the external-asset check', () => {
      write('LICENSE', 'Test license\n')
      const result = json(run('risky.html'))
      if (result.findings.some((finding) => finding.id === 'missing-license')) throw new Error('license finding should be satisfied')
      if (!result.license) throw new Error('license path not reported')
    })

    test('missing license is reported without a notice file', () => {
      const savedLicense = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
      fs.rmSync(path.join(root, 'LICENSE'))
      try {
        const dir = path.join(root, 'no-license', 'design', 'demo')
        fs.mkdirSync(dir, { recursive: true })
        fs.copyFileSync(path.join(root, 'risky.html'), path.join(dir, 'index.html'))
        const result = run('no-license')
        if (result.status !== 1) throw new Error('expected blocking exit')
        const payload = json(result)
        if (!payload.findings.some((finding) => finding.id === 'missing-license')) throw new Error('missing-license not reported')
      } finally {
        fs.writeFileSync(path.join(root, 'LICENSE'), savedLicense)
      }
    })

    test('allowlist downgrades remote assets but not secrets or trackers', () => {
      const blocked = run('allow.html')
      if (blocked.status !== 1) throw new Error('remote script should block by default')
      const allowed = json(run('allow.html', '--allow=cdn.example.com'))
      if (allowed.counts.P0 !== 0 || allowed.counts.P1 !== 0) throw new Error('allowlist did not downgrade the script')
      const stillBlocked = run('allow.html', '--allow=cdn.example.com', '--strict')
      if (stillBlocked.status !== 1) throw new Error('strict should block allowed P2')
    })

    test('P2 hints only block with --strict', () => {
      const normal = run('hint.html')
      if (normal.status !== 0) throw new Error(`hint should pass by default, got ${normal.status}`)
      if (json(normal).counts.P2 !== 1) throw new Error('hint was not counted as P2')
      if (run('hint.html', '--strict').status !== 1) throw new Error('strict should block the remote hint')
    })

    test('path containment refuses inputs outside the root', () => {
      const outside = path.join(root, '..', `dezign0-outside-${Date.now()}.html`)
      fs.writeFileSync(outside, '<html></html>')
      try {
        const result = run(outside)
        if (result.status !== 2) throw new Error(`expected exit 2, got ${result.status}`)
      } finally {
        fs.rmSync(outside, { force: true })
      }
    })

    test('directory scan aggregates files', () => {
      const result = json(run('.'))
      if (result.files.length < 3) throw new Error('directory scan missed files')
      if (result.findings.length === 0) throw new Error('directory scan found nothing in risky files')
    })
  } catch (error) {
    failures.push(`setup: ${error.message}`)
    console.log(`FAIL setup: ${error.message}`)
  } finally {
    cleanup()
  }

  console.log(`\nsafety-scan self-test: ${passed} passed, ${failures.length} failed`)
  return failures.length ? 1 : 0
}

// ── Main ───────────────────────────────────────────────────────────────────
function main(argv) {
  const wantsJson = argv.includes('--json')
  let flags = wantsJson ? { json: true } : {}
  try {
    const parsed = parseArgs(argv)
    flags = parsed.flags
    if (flags['self-test']) return selfTest()
    if (flags.help || !parsed.positionals.length) usage(flags.help ? 0 : 2)
    return runScan(flags, parsed.positionals)
  } catch (error) {
    const code = error instanceof ScanError ? error.code : 2
    const message = error instanceof Error ? error.message : String(error)
    if (flags.json) process.stdout.write(`${JSON.stringify({ schema: SCHEMA, ok: false, exitCode: code, error: message }, null, 2)}\n`)
    else console.error(`safety-scan: ${message}`)
    return code
  }
}

process.exitCode = main(process.argv.slice(2))
