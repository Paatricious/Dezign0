#!/usr/bin/env node
/**
 * bundle.mjs — build one self-contained review HTML for a design project.
 *
 * Usage:
 *   node bundle.mjs design/<slug>
 *   node bundle.mjs design/<slug> --out=review.html --title="Billing review"
 *   node bundle.mjs design/<slug> --json
 *
 * What it does:
 *   reads design/<slug>/, embeds every top-level *.html artifact inline in a
 *   sandboxed iframe, renders the ANNOTATIONS.json entries, derives the open
 *   findings (P0/P1), and writes a coverage manifest into the page.
 *
 * Contract:
 *   - one file, no network requests, no build step, no dependencies;
 *   - artifacts are untrusted: they run in a sandboxed iframe without
 *     allow-same-origin;
 *   - every counted value comes from a file; nothing is estimated.
 *
 * Exit codes:
 *   0  bundle written (or manifest printed with --json)
 *   1  invalid input: no artifact, unreadable file, or invalid annotations
 *   2  usage error
 *
 * No dependencies. Node 18+.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const args = process.argv.slice(2)
const isHelp = args.includes('--help') || args.includes('-h')
const asJson = args.includes('--json')
const positional = args.filter((a) => !a.startsWith('--'))
const option = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  if (i !== -1) {
    const next = args[i + 1]
    return next && !next.startsWith('--') ? next : true
  }
  return null
}

function usage(exitCode) {
  console.log(`bundle — one self-contained review page for a design project

Usage: node bundle.mjs <design/project-dir> [options]

Options:
  --out=<file>       Output path (default: <project-dir>/review.html).
  --title=<text>     Page title (default: project slug).
  --json             Print the coverage manifest as JSON. Without --out this
                     writes no HTML; with --out it writes both.
  --help             Show this help.

Reads: project.json (optional), top-level *.html artifacts, ANNOTATIONS.json.
Writes: one HTML file with artifacts inline, annotations, findings and the
coverage manifest. Exit codes: 0 ok, 1 invalid input, 2 usage error.`)
  process.exit(exitCode)
}
if (isHelp || !positional.length) usage(isHelp ? 0 : 2)

const projectDir = path.resolve(String(positional[0]))
if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
  console.error(`bundle: project directory not found: ${projectDir}`)
  process.exit(1)
}

const outOption = option('out')
const outputPath = outOption && outOption !== true
  ? path.resolve(String(outOption))
  : path.join(projectDir, 'review.html')
const writeHtml = !asJson || Boolean(outOption && outOption !== true)
const titleOption = option('title')

function readJson(file, { required = false } = {}) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${path.basename(file)}`)
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${error.message}`)
  }
}

const SEVERITIES = ['P0', 'P1', 'P2', 'nit']
const STATUSES = ['open', 'in-progress', 'resolved', 'wontfix', 'accepted']

let project = null
let annotationsFile = null
let annotationData = { schema: 'dezign0/annotations/v1', items: [] }
const errors = []
const warnings = []

try {
  project = readJson(path.join(projectDir, 'project.json'))
  if (project && project.schema !== 'dezign0/project/v1') {
    warnings.push(`project.json schema is "${project.schema || 'missing'}", expected dezign0/project/v1`)
  }
  if (!project) warnings.push('project.json missing: profile, status and constraints are unknown')

  for (const name of ['ANNOTATIONS.json', 'annotations.json']) {
    const candidate = path.join(projectDir, name)
    if (fs.existsSync(candidate)) {
      annotationsFile = candidate
      annotationData = readJson(candidate, { required: true })
      break
    }
  }
  if (!annotationData) {
    annotationData = { schema: 'dezign0/annotations/v1', items: [] }
  } else if (annotationData.schema !== 'dezign0/annotations/v1') {
    warnings.push(`ANNOTATIONS.json schema is "${annotationData.schema || 'missing'}", expected dezign0/annotations/v1`)
  }
  if (!annotationsFile) warnings.push('no ANNOTATIONS.json: the bundle has no element anchors')
} catch (error) {
  console.error(`bundle: ${error.message}`)
  process.exit(1)
}

const items = Array.isArray(annotationData?.items) ? annotationData.items : null
if (!items) {
  console.error('bundle: ANNOTATIONS.json must be an object with an "items" array.')
  process.exit(1)
}

function validateAnnotations(list) {
  const bad = []
  list.forEach((item, index) => {
    const at = `item ${index + 1}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) return bad.push(`${at}: not an object`)
    if (typeof item.selector !== 'string' || !item.selector.trim()) bad.push(`${at}: selector must be a non-empty string`)
    if (typeof item.note !== 'string' || !item.note.trim()) bad.push(`${at}: note must be a non-empty string`)
    if (typeof item.author !== 'string' || !item.author.trim()) bad.push(`${at}: author must be a non-empty string`)
    if (!Number.isInteger(item.round) || item.round < 1) bad.push(`${at}: round must be an integer >= 1`)
    if (!SEVERITIES.includes(item.severity)) bad.push(`${at}: severity must be one of ${SEVERITIES.join(', ')}`)
    if (!STATUSES.includes(item.status)) bad.push(`${at}: status must be one of ${STATUSES.join(', ')}`)
    if (!Object.prototype.hasOwnProperty.call(item, 'box')) {
      bad.push(`${at}: box is required; use null when the finding was not measured`)
    } else if (item.box != null) {
      const box = item.box
      const ok = box && typeof box === 'object' && ['x', 'y', 'width', 'height'].every((k) => typeof box[k] === 'number' && Number.isFinite(box[k]))
      if (!ok) bad.push(`${at}: box must be null or { x, y, width, height } numbers`)
    }
    if (item.artifact != null && (typeof item.artifact !== 'string' || !item.artifact.trim())) {
      bad.push(`${at}: artifact must be a file name when present`)
    }
  })
  return bad
}
errors.push(...validateAnnotations(items))
if (errors.length) {
  console.error(`bundle: invalid annotations in ${path.basename(annotationsFile || 'ANNOTATIONS.json')}:`)
  for (const error of errors.slice(0, 20)) console.error(`  - ${error}`)
  if (errors.length > 20) console.error(`  ... ${errors.length - 20} more`)
  process.exit(1)
}

const artifactFiles = fs.readdirSync(projectDir)
  .filter((name) => /\.html?$/i.test(name))
  .filter((name) => !name.startsWith('.'))
  .filter((name) => path.resolve(projectDir, name) !== outputPath)
  .sort((a, b) => a.localeCompare(b))

if (!artifactFiles.length) {
  console.error(`bundle: no HTML artifacts in ${projectDir}. Build one before bundling a review.`)
  process.exit(1)
}

const artifacts = artifactFiles.map((name) => {
  const file = path.join(projectDir, name)
  const html = fs.readFileSync(file, 'utf8')
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : name
  return {
    file: name,
    path: file,
    title: title || name,
    bytes: Buffer.byteLength(html, 'utf8'),
    sha256: crypto.createHash('sha256').update(html).digest('hex'),
    dataOdIds: (html.match(/data-od-id\s*=/gi) || []).length,
    inlineScripts: (html.match(/<script(?![^>]*\bsrc\s*=)[^>]*>/gi) || []).length,
    remoteRefs: [
      /<script[^>]+src\s*=\s*["']https?:/gi,
      /<link[^>]+href\s*=\s*["']https?:/gi,
      /<img[^>]+src\s*=\s*["']https?:/gi,
      /url\(\s*["']?https?:/gi,
      /@import\s+(?:url\()?["']?https?:/gi,
    ].reduce((sum, re) => sum + (html.match(re) || []).length, 0),
    html,
  }
})

const firstArtifact = artifacts[0].file
const normalized = items.map((item) => ({
  ...item,
  artifact: item.artifact || firstArtifact,
  round: item.round,
}))
const orphan = normalized.filter((item) => !artifacts.some((a) => a.file === item.artifact))
for (const item of orphan) warnings.push(`annotation targets unknown artifact "${item.artifact}": ${item.selector}`)

for (const artifact of artifacts) {
  artifact.annotations = normalized.filter((item) => item.artifact === artifact.file).length
  artifact.openFindings = normalized.filter(
    (item) => item.artifact === artifact.file && item.status !== 'resolved' && item.status !== 'wontfix' && item.status !== 'accepted' && (item.severity === 'P0' || item.severity === 'P1'),
  ).length
}
const artifactPublic = (artifact) => ({
  file: artifact.file,
  title: artifact.title,
  bytes: artifact.bytes,
  sha256: artifact.sha256,
  dataOdIds: artifact.dataOdIds,
  inlineScripts: artifact.inlineScripts,
  remoteRefs: artifact.remoteRefs,
  annotations: artifact.annotations,
  openFindings: artifact.openFindings,
})

const findings = normalized
  .filter((item) => (item.status === 'open' || item.status === 'in-progress') && (item.severity === 'P0' || item.severity === 'P1'))
  .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.round - b.round || a.selector.localeCompare(b.selector))

const byKey = (list, key, keys) => Object.fromEntries(keys.map((value) => [value, list.filter((item) => item[key] === value).length]))
const rounds = [...new Set(normalized.map((item) => item.round))].sort((a, b) => a - b)
const measurementFiles = fs.readdirSync(projectDir).filter((name) => /^measure.*\.json$/i.test(name) || name === 'MEASUREMENTS.json')
const handoverPath = path.join(projectDir, 'HANDOVER.md')
const handoverText = fs.existsSync(handoverPath) ? fs.readFileSync(handoverPath, 'utf8') : null
const handover = handoverText
  ? { file: 'HANDOVER.md', bytes: Buffer.byteLength(handoverText, 'utf8'), sha256: crypto.createHash('sha256').update(handoverText).digest('hex') }
  : null

const constraints = project?.constraints || {}
const coverage = {
  profile: project?.profile || null,
  status: project?.status || null,
  entry: constraints.entry || null,
  viewports: Array.isArray(constraints.viewports) ? constraints.viewports : [],
  states: Array.isArray(constraints.states) ? constraints.states : [],
  targetSizes: Array.isArray(constraints.targetSizes) ? constraints.targetSizes : [],
  artifactsTotal: artifacts.length,
  artifactsWithAnnotations: artifacts.filter((a) => a.annotations > 0).length,
  annotationsTotal: normalized.length,
  findingsTotal: findings.length,
  measurementRecorded: measurementFiles.length > 0,
  measurementFiles,
  handoverPresent: Boolean(handover),
  unverified: [],
}
if (!coverage.measurementRecorded) coverage.unverified.push('no rendered measurement record (run measure-artifact and save measure.json)')
if (measurementFiles.length && !measurementFiles.some((name) => name.toLowerCase().includes('a11y'))) {
  coverage.unverified.push('measurement files do not indicate an --a11y pass')
}
if (!coverage.handoverPresent) coverage.unverified.push('no HANDOVER.md in the project yet')
if (artifacts.some((a) => a.remoteRefs > 0)) coverage.unverified.push('one or more artifacts reference remote URLs; confirm they are allowed')
for (const artifact of artifacts.filter((a) => a.annotations === 0)) coverage.unverified.push(`${artifact.file} has no annotations`)
for (const [index, item] of normalized.entries()) {
  if (!item.box) coverage.unverified.push(`annotation ${index + 1} (${item.selector}) has no measured box`)
}
if (!project) coverage.unverified.push('project.json is missing; profile, system pin and constraints were not read')

const manifest = {
  schema: 'dezign0/review-bundle/v1',
  generated: new Date().toISOString(),
  project: project
    ? {
        slug: project.slug || path.basename(projectDir),
        profile: project.profile || null,
        status: project.status || null,
        systemPin: project.systemPin || null,
        skillPins: Array.isArray(project.skillPins) ? project.skillPins : [],
        constraints,
      }
    : null,
  source: projectDir,
  output: writeHtml
    ? (path.relative(projectDir, outputPath).startsWith('..') ? outputPath : path.relative(projectDir, outputPath))
    : null,
  annotationsFile: annotationsFile ? path.basename(annotationsFile) : null,
  artifacts: artifacts.map(artifactPublic),
  annotations: {
    total: normalized.length,
    bySeverity: byKey(normalized, 'severity', SEVERITIES),
    byStatus: byKey(normalized, 'status', STATUSES),
    rounds,
  },
  findings,
  handover,
  coverage,
  errors,
  warnings,
}

const title = String(titleOption && titleOption !== true ? titleOption : project?.slug || path.basename(projectDir))

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
const attr = escapeHtml
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const severityClass = (severity) => (severity === 'P0' ? 'sev sev-p0' : severity === 'P1' ? 'sev sev-p1' : severity === 'P2' ? 'sev sev-p2' : 'sev sev-nit')
const statusClass = (status) => `status status-${status}`

function annotationRows(list) {
  if (!list.length) return '<tr><td colspan="7" class="empty">No annotations recorded.</td></tr>'
  return list.map((item) => [
    '<tr>',
    `<td><span class="${severityClass(item.severity)}">${escapeHtml(item.severity)}</span></td>`,
    `<td><span class="${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>`,
    `<td><code>${escapeHtml(item.selector)}</code></td>`,
    `<td>${escapeHtml(item.artifact)}</td>`,
    `<td class="note">${escapeHtml(item.note)}</td>`,
    `<td>${item.box ? `${Math.round(item.box.width)}×${Math.round(item.box.height)} @ ${Math.round(item.box.x)},${Math.round(item.box.y)}` : '—'}</td>`,
    `<td>${escapeHtml(item.author)} · r${item.round}</td>`,
    '</tr>',
  ].join('')).join('\n')
}

function findingsRows(list) {
  if (!list.length) return '<tr><td colspan="6" class="empty">No open P0/P1 findings.</td></tr>'
  return list.map((item) => [
    '<tr>',
    `<td><span class="${severityClass(item.severity)}">${escapeHtml(item.severity)}</span></td>`,
    `<td>${escapeHtml(item.artifact)}</td>`,
    `<td><code>${escapeHtml(item.selector)}</code></td>`,
    `<td class="note">${escapeHtml(item.note)}</td>`,
    `<td><span class="${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>`,
    `<td>${escapeHtml(item.author)} · r${item.round}</td>`,
    '</tr>',
  ].join('')).join('\n')
}

function artifactTabs(list) {
  return list.map((artifact, index) => `<button class="tab${index === 0 ? ' active' : ''}" data-panel="panel-${index}" type="button">${escapeHtml(artifact.file)} <span>${artifact.annotations}</span></button>`).join('\n')
}

function artifactPanels(list) {
  return list.map((artifact, index) => [
    `<section class="panel${index === 0 ? ' active' : ''}" id="panel-${index}" data-file="${attr(artifact.file)}">`,
    `<header class="panel-head"><h2>${escapeHtml(artifact.file)}</h2><p>${escapeHtml(artifact.title)} · ${artifact.bytes.toLocaleString()} bytes · ${artifact.dataOdIds} data-od-id · ${artifact.annotations} annotations · ${artifact.openFindings} open findings</p></header>`,
    `<div class="frame-wrap"><iframe class="frame" title="${attr(artifact.file)}" sandbox="allow-scripts allow-forms allow-modals allow-popups" srcdoc="${attr(artifact.html)}"></iframe></div>`,
    `<p class="hash">sha256 <code>${artifact.sha256}</code></p>`,
    '</section>',
  ].join('\n')).join('\n')
}

function coverageRows() {
  return [
    `<tr><td>Artifacts</td><td>${coverage.artifactsTotal} inlined, ${coverage.artifactsWithAnnotations} annotated</td></tr>`,
    `<tr><td>Annotations</td><td>${coverage.annotationsTotal} across ${rounds.length} round(s)</td></tr>`,
    `<tr><td>Open P0/P1 findings</td><td>${coverage.findingsTotal}</td></tr>`,
    `<tr><td>Measurement record</td><td>${coverage.measurementRecorded ? escapeHtml(measurementFiles.join(', ')) : 'none recorded'}</td></tr>`,
    `<tr><td>Handover</td><td>${coverage.handoverPresent ? 'present' : 'missing'}</td></tr>`,
    `<tr><td>Profile</td><td>${escapeHtml(coverage.profile || 'unknown')} · status ${escapeHtml(coverage.status || 'unknown')}</td></tr>`,
    `<tr><td>Viewports</td><td>${escapeHtml(coverage.viewports.join(', ') || 'not declared')}</td></tr>`,
    `<tr><td>States</td><td>${escapeHtml(coverage.states.join(', ') || 'not declared')}</td></tr>`,
  ].join('\n')
}

function unverifiedList() {
  if (!coverage.unverified.length) return '<li>Nothing listed. Confirm before trusting the bundle.</li>'
  return coverage.unverified.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n')
}

const artifactJson = artifacts.map(artifactPublic)
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — review bundle</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --surface: #ffffff; --fg: #16181a; --muted: #5b6167; --border: #dfe3e8;
    --accent: #2f6feb; --p0: #b3261e; --p1: #a15c00; --p2: #525a63; --ok: #12805c;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1012; --surface: #171a1d; --fg: #f2f4f6; --muted: #a3a9b0; --border: #2a2f35; --accent: #6f9bff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--sans); }
  main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 72px; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin: 40px 0 12px; }
  h3 { font-size: 15px; margin: 24px 0 8px; }
  p, li { color: var(--fg); }
  .meta { color: var(--muted); margin: 0 0 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 24px 0; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .card b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
  .card span { color: var(--muted); font-size: 13px; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; font-size: 14px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); background: color-mix(in srgb, var(--surface) 92%, var(--fg)); }
  tr:last-child td { border-bottom: 0; }
  td.note { max-width: 460px; }
  code { font-family: var(--mono); font-size: 12.5px; }
  .sev { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11.5px; font-weight: 600; color: #fff; white-space: nowrap; }
  .sev-p0 { background: var(--p0); } .sev-p1 { background: var(--p1); } .sev-p2 { background: var(--p2); } .sev-nit { background: #6b7280; }
  .status { font-size: 12.5px; }
  .status-open { color: var(--p0); font-weight: 600; } .status-resolved, .status-accepted { color: var(--ok); }
  .status-in-progress { color: var(--p1); } .status-wontfix { color: var(--muted); }
  .empty { color: var(--muted); }
  .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
  .tab { font: inherit; font-size: 13px; padding: 7px 12px; border: 1px solid var(--border); background: var(--surface); color: var(--fg); border-radius: 8px; cursor: pointer; }
  .tab span { color: var(--muted); font-size: 11px; margin-left: 4px; }
  .tab.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .panel { display: none; }
  .panel.active { display: block; }
  .panel-head h2 { margin: 16px 0 4px; font-size: 16px; }
  .panel-head p { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
  .frame-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  iframe.frame { width: 100%; height: 78vh; min-height: 520px; border: 0; display: block; background: #fff; }
  .hash { color: var(--muted); font-size: 12px; margin: 8px 0 0; overflow-wrap: anywhere; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
  details { margin: 8px 0 0; }
  summary { cursor: pointer; color: var(--accent); font-size: 13px; }
  pre { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; overflow: auto; font-size: 12px; }
  footer { margin-top: 48px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Review bundle · generated ${escapeHtml(manifest.generated)} · schema ${escapeHtml(manifest.schema)} · source <code>${escapeHtml(projectDir)}</code></p>

  <div class="cards">
    <div class="card"><b>${coverage.artifactsTotal}</b><span>artifact(s) inlined</span></div>
    <div class="card"><b>${coverage.annotationsTotal}</b><span>annotations</span></div>
    <div class="card"><b>${coverage.findingsTotal}</b><span>open P0/P1 findings</span></div>
    <div class="card"><b>${escapeHtml(coverage.profile || '—')}</b><span>profile</span></div>
  </div>

  <h2>Open findings</h2>
  <table>
    <thead><tr><th>Severity</th><th>Artifact</th><th>Selector</th><th>Note</th><th>Status</th><th>Author · round</th></tr></thead>
    <tbody>
${findingsRows(findings)}
    </tbody>
  </table>

  <h2>Annotations</h2>
  <table>
    <thead><tr><th>Severity</th><th>Status</th><th>Selector</th><th>Artifact</th><th>Note</th><th>Box</th><th>Author · round</th></tr></thead>
    <tbody>
${annotationRows(normalized)}
    </tbody>
  </table>

  <h2>Artifacts</h2>
  <div class="tabs" role="tablist">
${artifactTabs(artifacts)}
  </div>
${artifactPanels(artifacts)}

  <h2>Handover</h2>
${handover
  ? `<details><summary>${escapeHtml(handover.file)} · ${handover.bytes} bytes · sha256 <code>${escapeHtml(handover.sha256.slice(0, 12))}…</code></summary><pre>${escapeHtml(handoverText)}</pre></details>`
  : '<p class="empty">No HANDOVER.md in the project yet.</p>'}

  <h2>Coverage manifest</h2>
  <div class="grid-2">
    <table>
      <tbody>
${coverageRows()}
      </tbody>
    </table>
    <div>
      <h3>Not reviewed</h3>
      <ul>
${unverifiedList()}
      </ul>
      <h3>Warnings</h3>
      <ul>
${warnings.length ? warnings.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n') : '<li>None.</li>'}
      </ul>
    </div>
  </div>

  <details>
    <summary>Manifest JSON</summary>
    <pre>${escapeHtml(JSON.stringify(manifest, null, 2))}</pre>
  </details>

  <footer>Generated by .design-os/tools/bundle.mjs. Artifacts are untrusted and run sandboxed without same-origin access.</footer>
</main>
<script type="application/json" id="coverage-manifest">${jsonForScript(manifest)}</script>
<script type="application/json" id="artifacts-index">${jsonForScript(artifactJson)}</script>
<script>
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(tab.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });
</script>
</body>
</html>
`

if (writeHtml) {
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, html)
  } catch (error) {
    console.error(`bundle: cannot write ${outputPath}: ${error.message}`)
    process.exit(1)
  }
}

if (asJson) {
  console.log(JSON.stringify(manifest, null, 2))
} else {
  const rel = path.relative(process.cwd(), outputPath)
  console.log(`bundle: ${writeHtml ? 'wrote ' + rel : 'manifest only'}`)
  console.log(`  artifacts: ${artifacts.length} (${artifacts.map((a) => a.file).join(', ')})`)
  console.log(`  annotations: ${normalized.length}; open P0/P1: ${findings.length}`)
  if (coverage.unverified.length) console.log(`  not reviewed: ${coverage.unverified.length} item(s) listed in the bundle`)
  for (const warning of warnings) console.log(`  warning: ${warning}`)
}
process.exit(0)
