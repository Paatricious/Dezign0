#!/usr/bin/env node
/**
 * audit-matrix — deterministic audit wrapper around the kit's existing tools.
 *
 * What it does
 *   1. crawls a file or folder of HTML artifacts (multi-page);
 *   2. runs design-lint.mjs through child_process argv (no shell) and collects
 *      one aggregate finding set;
 *   3. renders every page in the installed Playwright browsers, one viewport
 *      per browser by default (chromium/firefox/webkit), with all non-file
 *      requests blocked so the audit itself never uses the network;
 *   4. optionally runs measure-artifact.mjs for the deeper Chromium checks
 *      (--measure; opt-in because a page may request remote assets);
 *   5. optionally emits SARIF 2.1.0 (from the design-lint JSON), JUnit XML or
 *      machine JSON, and can poll for changes in watch mode.
 *
 * Exit codes: 0 pass, 1 findings, 2 usage/measurement error.
 *
 * Usage:
 *   node audit-matrix.mjs <file-or-dir...> [--json|--sarif|--junit]
 *                         [--out=PATH] [--strict] [--measure]
 *                         [--browsers=chromium,firefox,webkit]
 *                         [--viewports=1440x900] [--max-pages=200]
 *                         [--watch] [--watch-interval=1000]
 *                         [--watch-iterations=N] [--timeout=30000]
 *
 * No shell is used and no network request is made by this tool: Playwright
 * routes are aborted unless they are file:, data:, about: or blob:.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url))
const LINT_SCRIPT = path.join(TOOLS_DIR, 'design-lint.mjs')
const MEASURE_SCRIPT = path.join(TOOLS_DIR, 'measure-artifact.mjs')
const SAFE_URL = /^(file|data|about|blob):/i
const DEFAULT_BROWSERS = ['chromium', 'firefox', 'webkit']
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.dezign0', '.design-os', '.cache'])
const NAME = 'dezign0-audit-matrix'

class UsageError extends Error {}

function packageVersion() {
  let dir = TOOLS_DIR
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      if (pkg && pkg.name === 'dezign0') return pkg.version || '0.0.0'
    } catch {
      // Keep walking up; the kit copy lives in a user project without a
      // dezign0 package.json.
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return '0.0.0'
}

function usage(stream = process.stdout) {
  stream.write(`audit-matrix — deterministic cross-browser audit for HTML artifacts

Usage: node audit-matrix.mjs <file-or-dir...> [options]

Targets: one or more HTML files, or folders crawled recursively for .html/.htm
(excluded: node_modules, .git, .dezign0, .design-os, .cache). Targets must
resolve inside the project root (cwd or DEZIGN0_PROJECT_DIR).

Options:
  --json                 machine-readable report (stdout, or --out)
  --sarif                SARIF 2.1.0 from the design-lint findings
  --junit                JUnit XML for CI dashboards
  --out=PATH             write the selected report to PATH (inside the project)
  --strict               fail on P1 as well as P0
  --measure              also run measure-artifact.mjs (Chromium deep checks;
                         opt-in because it may load the page's remote assets)
  --browsers=a,b         chromium, firefox, webkit, auto (default), none
  --viewports=WxH,...    one entry per browser (default 1440x900)
  --max-pages=N          crawl limit (default 200; extra pages are reported skipped)
  --watch                poll targets and re-run on change (no chokidar);
                         with --json each run is one compact JSON line
  --watch-interval=MS    polling interval (default 1000)
  --watch-iterations=N   stop after N runs (test aid; default forever)
  --timeout=MS           per-page load timeout (default 30000)
  --quiet                suppress human progress lines
  --help                 show this help

Exit codes: 0 pass, 1 findings, 2 usage or measurement error.
No shell, no network: only file/data/about/blob requests are allowed.`)
}

function parseArgs(argv) {
  const opts = {
    json: false,
    sarif: false,
    junit: false,
    strict: false,
    measure: false,
    watch: false,
    quiet: false,
    browsers: 'auto',
    viewports: '1440x900',
    out: null,
    maxPages: 200,
    watchInterval: 1000,
    watchIterations: Infinity,
    timeout: 30000,
    targets: [],
  }
  const formats = []
  const value = (name, arg) => {
    const eq = arg.indexOf('=')
    if (eq === -1) throw new UsageError(`${name} needs a value, for example ${name}=...`)
    return arg.slice(eq + 1)
  }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (!arg.startsWith('--')) {
      opts.targets.push(arg)
      continue
    }
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg
    switch (name) {
      case '--json':
        opts.json = true
        if (!formats.includes('json')) formats.push('json')
        break
      case '--sarif':
        opts.sarif = true
        if (!formats.includes('sarif')) formats.push('sarif')
        break
      case '--junit':
        opts.junit = true
        if (!formats.includes('junit')) formats.push('junit')
        break
      case '--strict':
        opts.strict = true
        break
      case '--measure':
        opts.measure = true
        break
      case '--watch':
        opts.watch = true
        break
      case '--quiet':
        opts.quiet = true
        break
      case '--out':
        opts.out = value(name, arg)
        break
      case '--browsers':
        opts.browsers = value(name, arg)
        break
      case '--viewports':
        opts.viewports = value(name, arg)
        break
      case '--max-pages':
        opts.maxPages = positiveInt(name, value(name, arg))
        break
      case '--watch-interval':
        opts.watchInterval = positiveInt(name, value(name, arg))
        break
      case '--watch-iterations':
        opts.watchIterations = positiveInt(name, value(name, arg))
        break
      case '--timeout':
        opts.timeout = positiveInt(name, value(name, arg))
        break
      default:
        throw new UsageError(`unknown option: ${name}`)
    }
  }
  if (formats.length > 1) throw new UsageError('choose one output format: --json, --sarif or --junit')
  opts.format = formats[0] || 'text'
  if (!opts.targets.length) throw new UsageError('at least one file or folder is required')
  if (opts.watch && !Number.isFinite(opts.watchIterations)) {
    // Watch forever is the documented mode; tests pass --watch-iterations.
  }
  return opts
}

function positiveInt(name, raw) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${name} needs a positive integer`)
  return n
}

function isInside(root, candidate) {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

function realpathInside(root, value, label) {
  let real
  try {
    real = fs.realpathSync(path.resolve(process.cwd(), value))
  } catch {
    throw new UsageError(`${label} not found: ${value}`)
  }
  if (!isInside(root, real)) throw new UsageError(`${label} must be inside the project root (${root}): ${value}`)
  return real
}

function relFromRoot(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/')
}

function collectTargets(root, positionals, maxPages, excludePath = null) {
  const files = []
  const skipped = []
  const seen = new Set()
  const addFile = (absolute) => {
    if (excludePath && absolute === excludePath) return
    const rel = relFromRoot(root, absolute)
    if (seen.has(rel)) return
    seen.add(rel)
    files.push(absolute)
  }
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      skipped.push({ what: relFromRoot(root, dir), reason: `unreadable folder: ${error.message}` })
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(absolute)
        continue
      }
      if (entry.isFile() && /\.html?$/i.test(entry.name)) addFile(absolute)
    }
  }
  for (const positional of positionals) {
    const real = realpathInside(root, positional, 'target')
    const stat = fs.statSync(real)
    if (stat.isDirectory()) walk(real)
    else addFile(real)
  }
  files.sort((a, b) => {
    const left = relFromRoot(root, a)
    const right = relFromRoot(root, b)
    return left < right ? -1 : left > right ? 1 : 0
  })
  if (files.length > maxPages) {
    const dropped = files.length - maxPages
    files.length = maxPages
    skipped.push({ what: 'pages', reason: `page limit ${maxPages} reached; ${dropped} file(s) not audited` })
  }
  return { files, skipped }
}

function runNode(script, argv, cwd, timeout = 180000) {
  const result = spawnSync(process.execPath, [script, ...argv], {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', DEZIGN0_PROJECT_DIR: cwd },
  })
  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  }
}

function firstLine(text) {
  return String(text || '').trim().split(/\r?\n/).filter(Boolean)[0] || ''
}

function runLint(files, opts, root) {
  const result = runNode(
    LINT_SCRIPT,
    ['--json', ...(opts.strict ? ['--strict'] : []), ...files],
    root,
  )
  if (result.error) return { error: result.error }
  if (result.code === 2) return { error: firstLine(result.stderr) || 'design-lint failed to read a target' }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { error: 'design-lint did not emit valid JSON' }
  }
  return { code: result.code, parsed }
}

async function loadPlaywright(root) {
  try {
    const requireFromProject = createRequire(path.join(root, '__audit_matrix_resolve__.js'))
    const entry = requireFromProject.resolve('playwright')
    const module = await import(pathToFileURL(entry).href)
    return module.default || module
  } catch {
    return null
  }
}

async function probePage(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity <= 0.01 || style.position === 'fixed') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      let scrollable = false
      let parent = el.parentElement
      while (parent && parent !== document.body) {
        const overflowX = getComputedStyle(parent).overflowX
        if ((overflowX === 'auto' || overflowX === 'scroll') && parent.scrollWidth > parent.clientWidth) {
          scrollable = true
          break
        }
        parent = parent.parentElement
      }
      if (rect.right > vw + 1 && !scrollable) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 40),
          right: Math.round(rect.right),
        })
      }
    }
    let smallTargets = 0
    for (const el of document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"]')) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || el.disabled) continue
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) smallTargets += 1
    }
    return {
      title: document.title || '',
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: vw,
      clipped: offenders.slice(0, 20),
      clippedCount: offenders.length,
      smallTargetCount: smallTargets,
      textLength: (document.body.innerText || '').trim().length,
    }
  })
}

async function runBrowserMatrix({ root, files, browsers, viewports, timeout }) {
  const requested = browsers
  const matrix = { requested, results: [], skipped: [] }
  if (requested.length === 0) {
    matrix.skipped.push({ what: 'browsers', reason: 'disabled by --browsers=none' })
    return matrix
  }
  const playwright = await loadPlaywright(root)
  if (!playwright) {
    matrix.skipped.push({ what: 'browsers', reason: 'Playwright is not installed in the project (npm i -D playwright)' })
    for (const name of requested) {
      matrix.results.push({ browser: name, status: 'skipped', reason: 'Playwright is not installed in the project', cells: [] })
    }
    return matrix
  }
  for (const name of requested) {
    const browserType = playwright[name] || playwright.default?.[name]
    if (!browserType) {
      matrix.results.push({ browser: name, status: 'skipped', reason: `unknown Playwright browser: ${name}`, cells: [] })
      continue
    }
    let executable = ''
    try {
      executable = browserType.executablePath()
    } catch {
      executable = ''
    }
    if (!executable || !fs.existsSync(executable)) {
      matrix.skipped.push({ what: name, reason: 'browser executable is not installed' })
      matrix.results.push({ browser: name, status: 'skipped', reason: 'browser executable is not installed', cells: [] })
      continue
    }
    let browser
    let browserVersion = ''
    try {
      browser = await browserType.launch({ headless: true })
      browserVersion = browser.version()
    } catch (error) {
      matrix.skipped.push({ what: name, reason: `browser launch failed: ${firstLine(error.message)}` })
      matrix.results.push({
        browser: name,
        status: 'skipped',
        reason: `browser launch failed: ${firstLine(error.message)}`,
        cells: [],
      })
      continue
    }
    const cells = []
    for (const file of files) {
      for (const viewport of viewports) {
        const cell = {
          page: relFromRoot(root, file),
          viewport: { width: viewport.width, height: viewport.height, label: viewport.label },
          status: 'fail',
          scrollWidth: null,
          clippedCount: null,
          smallTargetCount: null,
          consoleErrors: [],
          pageErrors: [],
          blockedRequests: [],
        }
        const blocked = new Set()
        const consoleErrors = new Set()
        const pageErrors = new Set()
        let context
        try {
          context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
          })
          await context.route('**/*', (route) => {
            const url = route.request().url()
            if (SAFE_URL.test(url)) return route.continue()
            blocked.add(url.slice(0, 300))
            return route.abort()
          })
          const page = await context.newPage()
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.add(message.text().slice(0, 300))
          })
          page.on('pageerror', (error) => pageErrors.add(String(error).slice(0, 300)))
          await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout })
          await page.evaluate(() => document.fonts.ready)
          const metrics = await probePage(page)
          Object.assign(cell, metrics)
          cell.consoleErrors = [...consoleErrors].slice(0, 10)
          cell.pageErrors = [...pageErrors].slice(0, 10)
          cell.blockedRequests = [...blocked].slice(0, 10)
          cell.status = cell.consoleErrors.length || cell.pageErrors.length || cell.clippedCount > 0 ? 'fail' : 'pass'
        } catch (error) {
          cell.error = firstLine(error.message)
          cell.consoleErrors = [...consoleErrors].slice(0, 10)
          cell.pageErrors = [...pageErrors].slice(0, 10)
          cell.blockedRequests = [...blocked].slice(0, 10)
          cell.status = 'fail'
        } finally {
          if (context) await context.close().catch(() => {})
        }
        cells.push(cell)
      }
    }
    await browser.close().catch(() => {})
    matrix.results.push({
      browser: name,
      version: browserVersion,
      status: cells.some((cell) => cell.status === 'fail') ? 'fail' : 'pass',
      cells,
    })
  }
  return matrix
}

function runMeasure(files, opts, root) {
  const viewportLabels = opts.viewports.map((entry) => entry.label).join(',') || '1440x900'
  const pages = []
  const skipped = []
  for (const file of files) {
    const result = runNode(MEASURE_SCRIPT, ['--json', `--viewports=${viewportLabels}`, file], root, opts.timeout + 60000)
    if (result.code === 2) {
      pages.push({ page: relFromRoot(root, file), status: 'skipped', reason: firstLine(result.stderr) || 'measurement unavailable' })
      skipped.push({ what: relFromRoot(root, file), reason: firstLine(result.stderr) || 'measurement unavailable' })
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      pages.push({ page: relFromRoot(root, file), status: 'skipped', reason: 'measure-artifact did not emit valid JSON' })
      continue
    }
    pages.push({
      page: relFromRoot(root, file),
      status: parsed.blocking ? 'fail' : 'pass',
      blocking: Boolean(parsed.blocking),
      consoleErrors: (parsed.consoleErrors || []).length,
      pageErrors: (parsed.pageErrors || []).length,
      viewports: (parsed.results || []).map((entry) => ({
        label: entry.label,
        width: entry.width,
        height: entry.height,
        scrollWidth: entry.scrollWidth,
        clippedCount: entry.clippedCount,
        contrastCount: entry.contrastCount,
        tabStops: entry.tabStops,
      })),
    })
  }
  const ran = pages.some((page) => page.status !== 'skipped')
  return {
    status: ran ? 'ran' : 'skipped',
    reason: ran ? undefined : 'measurement was skipped for every page',
    pages,
    skipped,
  }
}

function buildReport({ root, files, opts, lint, browsers, measure }) {
  const findings = (lint?.parsed?.findings || []).map((finding) => ({
    severity: finding.severity,
    id: finding.id,
    line: finding.line || 1,
    file: relFromRoot(root, path.resolve(finding.file)),
    message: finding.message,
    fix: finding.fix || '',
    snippet: finding.snippet || '',
  }))
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const finding of findings) if (counts[finding.severity] !== undefined) counts[finding.severity] += 1
  const pages = files.map((file) => relFromRoot(root, file))
  const pageFindings = Object.fromEntries(pages.map((page) => [page, findings.filter((finding) => finding.file === page)]))
  const browserCells = browsers.results.flatMap((result) => result.cells)
  const browserFailures = browserCells.filter((cell) => cell.status === 'fail')
  const measureFailures = (measure?.pages || []).filter((page) => page.status === 'fail')
  const verdict = counts.P0 > 0 || (opts.strict && counts.P1 > 0) || browserFailures.length > 0 || measureFailures.length > 0
    ? 'fail'
    : 'pass'
  return {
    tool: NAME,
    version: packageVersion(),
    project: root,
    formatVersion: 1,
    targets: pages,
    viewports: opts.viewports,
    strict: opts.strict,
    lint: {
      counts,
      findings,
      pages: pages.map((page) => ({ page, counts: countBySeverity(pageFindings[page]) })),
    },
    browsers,
    measure,
    summary: {
      pages: pages.length,
      findings: findings.length,
      lint: counts,
      browserCells: browserCells.length,
      browserFailures: browserFailures.length,
      browsersSkipped: browsers.results.filter((result) => result.status === 'skipped').length,
      measureFailures: measureFailures.length,
      verdict,
    },
    skipped: [
      ...browsers.skipped,
      ...(measure?.skipped || []),
    ],
  }
}

function countBySeverity(findings = []) {
  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const finding of findings) if (counts[finding.severity] !== undefined) counts[finding.severity] += 1
  return counts
}

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

function renderText(report) {
  const lines = []
  lines.push(`audit-matrix: ${report.summary.pages} page(s), ${report.lint.counts.P0} P0 / ${report.lint.counts.P1} P1 / ${report.lint.counts.P2} P2`)
  for (const finding of report.lint.findings.slice(0, 40)) {
    lines.push(`  ${finding.file}:${finding.line}  ${finding.severity} ${finding.id}  ${finding.message}`)
  }
  for (const result of report.browsers.results) {
    if (result.status === 'skipped') {
      lines.push(`  ${result.browser}: skipped — ${result.reason}`)
      continue
    }
    for (const cell of result.cells) {
      const bits = [
        `${result.browser} ${cell.viewport.label}`,
        cell.page,
        cell.status,
        `scroll=${cell.scrollWidth}`,
        `clipped=${cell.clippedCount}`,
        `console=${cell.consoleErrors.length + cell.pageErrors.length}`,
      ]
      if (cell.blockedRequests.length) bits.push(`blocked=${cell.blockedRequests.length}`)
      lines.push(`  ${bits.join('  ')}`)
    }
  }
  if (report.measure?.pages?.length) {
    for (const page of report.measure.pages) lines.push(`  measure ${page.page}: ${page.status}${page.reason ? ` — ${page.reason}` : ''}`)
  }
  for (const skip of report.skipped) lines.push(`  skipped ${skip.what}: ${skip.reason}`)
  lines.push(`verdict: ${report.summary.verdict}`)
  return lines.join('\n') + '\n'
}

function findingHash(finding) {
  return crypto
    .createHash('sha256')
    .update(`${finding.severity}|${finding.id}|${finding.file}|${finding.line}|${finding.message}`)
    .digest('hex')
    .slice(0, 16)
}

function uriForPage(page) {
  return page.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function renderSarif(report) {
  const rules = new Map()
  const results = []
  for (const finding of report.lint.findings) {
    const ruleId = finding.id
    if (!rules.has(ruleId)) {
      rules.set(ruleId, {
        id: ruleId,
        name: ruleId,
        shortDescription: { text: finding.message },
        help: { text: finding.fix || finding.message },
        defaultConfiguration: { level: finding.severity === 'P0' ? 'error' : finding.severity === 'P1' ? 'warning' : 'note' },
        properties: { severity: finding.severity, tags: ['design', 'dezign0'] },
      })
    }
    results.push({
      ruleId,
      ruleIndex: [...rules.keys()].indexOf(ruleId),
      level: finding.severity === 'P0' ? 'error' : finding.severity === 'P1' ? 'warning' : 'note',
      message: { text: finding.fix ? `${finding.message} Fix: ${finding.fix}` : finding.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: uriForPage(finding.file) },
            region: { startLine: finding.line || 1 },
          },
        },
      ],
      partialFingerprints: { dezign0FindingHash: findingHash(finding) },
    })
  }
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: NAME,
            semanticVersion: report.version,
            informationUri: 'https://github.com/Paatricious/Dezign0',
            rules: [...rules.values()],
          },
        },
        artifacts: report.targets.map((page) => ({ location: { uri: uriForPage(page) } })),
        results,
        invocations: [
          {
            executionSuccessful: true,
            exitCode: report.summary.verdict === 'pass' ? 0 : 1,
            commandLine: `${NAME} (design-lint + cross-browser matrix)`,
          },
        ],
        properties: {
          pages: report.summary.pages,
          browserFailures: report.summary.browserFailures,
          strict: report.strict,
        },
      },
    ],
  }
  return JSON.stringify(sarif, null, 2) + '\n'
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function renderJunit(report) {
  const cases = []
  for (const page of report.lint.pages) {
    const failures = report.lint.findings.filter((finding) => finding.file === page.page)
    const failingFindings = failures.filter((finding) => finding.severity === 'P0' || (report.strict && finding.severity === 'P1'))
    const ordered = [...failingFindings, ...failures.filter((finding) => !failingFindings.includes(finding))]
    const failureText = ordered.map((finding) => `${finding.severity} ${finding.id} at line ${finding.line}: ${finding.message}`).join('\n')
    const failing = failingFindings.length > 0
    cases.push(
      `<testcase classname="design-lint" name="${xmlEscape(page.page)}">` +
        (failing ? `<failure message="${xmlEscape(failureText.split('\n')[0])}">${xmlEscape(failureText)}</failure>` : '') +
        '</testcase>',
    )
  }
  for (const result of report.browsers.results) {
    if (result.status === 'skipped') {
      cases.push(
        `<testcase classname="browsers" name="${xmlEscape(result.browser)}"><skipped message="${xmlEscape(result.reason)}"/></testcase>`,
      )
      continue
    }
    for (const cell of result.cells) {
      const name = `${result.browser} ${cell.viewport.label} ${cell.page}`
      const failing = cell.status === 'fail'
      const detail = [
        `scrollWidth=${cell.scrollWidth}`,
        `clipped=${cell.clippedCount}`,
        ...(cell.consoleErrors || []),
        ...(cell.pageErrors || []),
        cell.error ? `error: ${cell.error}` : '',
      ].filter(Boolean).join('\n')
      cases.push(
        `<testcase classname="browser.${xmlEscape(result.browser)}" name="${xmlEscape(name)}">` +
          (failing ? `<failure message="${xmlEscape(detail.split('\n')[0] || 'rendered failure')}">${xmlEscape(detail)}</failure>` : '') +
          '</testcase>',
      )
    }
  }
  const failures = cases.filter((testcase) => testcase.includes('<failure')).length
  const skipped = cases.filter((testcase) => testcase.includes('<skipped')).length
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites name="${NAME}" tests="${cases.length}" failures="${failures}" skipped="${skipped}">\n` +
    `  <testsuite name="${NAME}" tests="${cases.length}" failures="${failures}" skipped="${skipped}">\n` +
    cases.map((testcase) => `    ${testcase}`).join('\n') +
    '\n  </testsuite>\n</testsuites>\n'
  )
}

function formatReport(report, opts, watchRun) {
  if (opts.format === 'sarif') return renderSarif(report)
  if (opts.format === 'junit') return renderJunit(report)
  if (opts.format === 'json') return JSON.stringify(report, null, watchRun ? 0 : 2) + '\n'
  return renderText(report)
}

function writeOut(outPath, content) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, content)
  } catch (error) {
    process.stderr.write(`audit-matrix: cannot write --out ${outPath}: ${error.message}\n`)
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------
// Watch support: snapshot mtimes/sizes of the resolved targets, poll, re-run.
// ---------------------------------------------------------------------------

function snapshotTargets(root, positionals, excludePath = null) {
  const snapshot = new Map()
  const addFile = (absolute) => {
    if (excludePath && absolute === excludePath) return
    try {
      const stat = fs.statSync(absolute)
      snapshot.set(relFromRoot(root, absolute), `${stat.mtimeMs}:${stat.size}`)
    } catch {
      snapshot.set(relFromRoot(root, absolute), 'missing')
    }
  }
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(absolute)
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        addFile(absolute)
      }
    }
  }
  for (const positional of positionals) {
    let real
    try {
      real = fs.realpathSync(path.resolve(process.cwd(), positional))
    } catch {
      continue
    }
    const stat = fs.statSync(real, { throwIfNoEntry: false })
    if (!stat) continue
    if (stat.isDirectory()) walk(real)
    else addFile(real)
  }
  return snapshot
}

function sameSnapshot(a, b) {
  if (a.size !== b.size) return false
  for (const [key, value] of a) if (b.get(key) !== value) return false
  return true
}

async function waitForChange(root, positionals, interval, previous, excludePath = null) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    const next = snapshotTargets(root, positionals, excludePath)
    if (!sameSnapshot(previous, next)) return next
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function auditOnce(opts, root) {
  const collected = collectTargets(root, opts.targets, opts.maxPages, opts.out)
  if (!collected.files.length) throw new UsageError('no HTML files found in the targets')
  const lint = runLint(collected.files, opts, root)
  if (lint.error) return { error: lint.error }
  const browsers = await runBrowserMatrix({
    root,
    files: collected.files,
    browsers: opts.browsers,
    viewports: opts.viewports,
    timeout: opts.timeout,
  })
  const measure = opts.measure ? runMeasure(collected.files, opts, root) : {
    status: 'skipped',
    reason: 'pass --measure to run the Chromium deep checks',
    pages: [],
    skipped: [],
  }
  const report = buildReport({ root, files: collected.files, opts, lint, browsers, measure })
  report.skipped.push(...collected.skipped)
  return { report }
}

function parseViewports(raw) {
  const parsed = []
  for (const entry of String(raw).split(',')) {
    const match = /^(\d+)(?:x(\d+))?$/i.exec(entry.trim())
    if (!match) throw new UsageError(`invalid viewport: ${entry} (use WIDTH or WIDTHxHEIGHT)`)
    const width = Number(match[1])
    const height = Number(match[2] || 900)
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new UsageError(`invalid viewport: ${entry}`)
    }
    parsed.push({ width, height, label: match[2] ? `${width}x${height}` : `${width}x${height}` })
  }
  if (!parsed.length) throw new UsageError('--viewports needs at least one entry')
  return parsed
}

function parseBrowsers(raw) {
  const value = String(raw).trim().toLowerCase()
  if (value === 'none') return []
  if (value === 'auto' || value === '') return [...DEFAULT_BROWSERS]
  const requested = value.split(',').map((name) => name.trim()).filter(Boolean)
  for (const name of requested) {
    if (!DEFAULT_BROWSERS.includes(name)) throw new UsageError(`unknown browser: ${name}`)
  }
  return [...new Set(requested)]
}

async function auditOnceSafe(opts, root) {
  try {
    return await auditOnce(opts, root)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`audit-matrix: ${error.message}\n`)
      process.exit(2)
    }
    throw error
  }
}

async function main() {
  let opts
  let root
  try {
    opts = parseArgs(process.argv.slice(2))
    const projectRoot = process.env.DEZIGN0_PROJECT_DIR || process.cwd()
    root = fs.realpathSync(path.resolve(projectRoot))
    opts.browsers = parseBrowsers(opts.browsers)
    opts.viewports = parseViewports(opts.viewports)
    if (opts.out) {
      const resolved = path.resolve(root, opts.out)
      if (!isInside(root, resolved)) throw new UsageError(`--out must be inside the project root (${root})`)
      opts.out = resolved
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`audit-matrix: ${error.message}\n`)
      process.exit(2)
    }
    throw error
  }

  if (!opts.watch) {
    const result = await auditOnceSafe(opts, root)
    if (result.error) {
      process.stderr.write(`audit-matrix: ${result.error}\n`)
      process.exit(2)
    }
    const output = formatReport(result.report, opts, false)
    if (opts.out) {
      writeOut(opts.out, output)
      if (!opts.quiet) process.stdout.write(`audit-matrix: wrote ${opts.out}\n`)
    } else {
      process.stdout.write(output)
    }
    process.exit(result.report.summary.verdict === 'pass' ? 0 : 1)
  }

  // Watch mode: first run immediately, then poll the targets.
  let runs = 0
  let lastCode = 0
  let snapshot = snapshotTargets(root, opts.targets, opts.out)
  for (;;) {
    runs += 1
    const result = await auditOnceSafe(opts, root)
    if (result.error) {
      process.stderr.write(`audit-matrix: ${result.error}\n`)
      process.exit(2)
    }
    const output = formatReport(result.report, opts, true)
    if (opts.out) {
      writeOut(opts.out, output)
      if (!opts.quiet) process.stdout.write(`[watch] run ${runs}: wrote ${opts.out} (${result.report.summary.verdict})\n`)
    } else {
      process.stdout.write(output)
    }
    lastCode = result.report.summary.verdict === 'pass' ? 0 : 1
    if (runs >= opts.watchIterations) break
    snapshot = await waitForChange(root, opts.targets, opts.watchInterval, snapshot, opts.out)
  }
  process.exit(lastCode)
}

await main()
