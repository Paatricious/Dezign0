#!/usr/bin/env node
/**
 * measure-artifact — browser measurements for a design artifact.
 *
 * design-lint is static. This tool answers the questions a static reader cannot:
 * is content actually clipped at small widths? Which contrast pairs fail in the
 * rendered page? How many type sizes exist? How many controls are focusable?
 * Does the page survive 320px reflow, text-spacing overrides, forced colors and
 * print? What did the network do, and what does axe say when it is available?
 *
 * Requires Playwright (not bundled). Install it in the harness that runs the
 * measurement, not in the kit:
 *
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * axe-core is optional and only used with --axe:
 *
 *   npm i -D axe-core
 *
 * Usage:
 *   node measure-artifact.mjs <file-or-url> [--viewports=1440,1024,768,390,375,360]
 *                                [--json] [--strict] [--shots=dir] [--a11y]
 *                                [--axe] [--reflow] [--forced-colors]
 *                                [--print] [--runtime]
 *
 * Exit codes: 0 no blocking failures, 1 blocking failures with --strict,
 *             2 load/measurement error.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import {
  WCAG_VERSION,
  CHECK_CRITERIA,
  criteriaFor,
  mapAxeViolation,
  mergeA11y,
  summarizeWcag,
} from './a11y-wcag.mjs'

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith('--'))
const json = args.includes('--json')
const strict = args.includes('--strict')
const viewportsArg = args.find((a) => a.startsWith('--viewports='))
const shotsArg = args.find((a) => a.startsWith('--shots='))
const excludeArg = args.find((a) => a.startsWith('--exclude='))
const selectorArg = args.find((a) => a.startsWith('--selector='))
const selector = selectorArg ? selectorArg.split('=').slice(1).join('=') : null
const baselineArg = args.find((a) => a.startsWith('--baseline='))
const baselineDir = baselineArg ? baselineArg.split('=').slice(1).join('=') : null
const maxDiffArg = args.find((a) => a.startsWith('--max-diff='))
const maxDiff = maxDiffArg ? Number(maxDiffArg.split('=')[1]) : 0.001
const a11y = args.includes('--a11y')
const axeFlag = args.includes('--axe')
const reflowFlag = args.includes('--reflow')
const forcedColorsFlag = args.includes('--forced-colors')
const printFlag = args.includes('--print')
const runtimeFlag = args.includes('--runtime')
const excludes = (excludeArg ? excludeArg.split('=')[1] : '')
  .split(',').map((s) => s.trim()).filter(Boolean)
const viewports = (viewportsArg ? viewportsArg.split('=')[1] : '1440x900,1024x900,768x900,390x844,375x812,360x800')
  .split(',')
  .map((entry) => {
    const [w, h] = entry.toLowerCase().split('x').map(Number)
    return { width: w, height: h || 900, label: entry }
  })
  .filter((v) => Number.isFinite(v.width) && v.width > 0)
const shotsDir = shotsArg ? shotsArg.split('=')[1] : null

if (!target || args.includes('--help') || args.includes('-h')) {
  console.log(`measure-artifact — rendered checks for a design artifact

Usage: node measure-artifact.mjs <file-or-url> [--viewports=1440x900,768x900,390x844]
                                   [--json] [--strict] [--shots=dir] [--a11y]
                                   [--axe] [--reflow] [--forced-colors]
                                   [--print] [--runtime]
                                   [--selector=.widget] [--baseline=dir]
                                   [--max-diff=0.001]
                                   [--exclude=.selector,other-selector]

Requires Playwright: npm i -D playwright && npx playwright install chromium
Optional axe-core:   npm i -D axe-core   (only used with --axe)

Reports: console errors, clipped elements per viewport, rendered contrast
failures, distinct type sizes and text below 11px, focusable controls,
data-od-id hooks and accessibility checks. Viewports accept WIDTH or
WIDTHxHEIGHT; use 145x188 for an exact widget cell. --selector also captures
the element box. --baseline compares full-page screenshots (same viewport) and
fails --strict when the changed-pixel ratio exceeds --max-diff.

--a11y adds WCAG 2.2 mapped checks: target size (2.5.8), non-text contrast
(1.4.11), keyboard tab order/trap/focus-visible (2.1.1/2.1.2/2.4.3/2.4.7),
ARIA refs, duplicate ids and a reduced-motion audit. --axe merges axe-core
violations (mapped to criterion ids/levels) with the hand checks and reports
axe as skipped, not failed, when it is not installed. --reflow tests 1.4.10 at
320 CSS px and 1.4.12 text spacing. --forced-colors emulates forced-colors:
active. --print emulates print media and reports page-break/overflow/PDF facts.
--runtime reports failed requests, transfer bytes, external origins and LCP.

--strict exits 1 on clipped content, contrast failures, console errors, a11y
findings, axe violations, reflow/forced-colors/print findings or a baseline
diff. --exclude skips intentionally reproduced regions (for example inert mock
widgets on a state board).`)
  process.exit(target ? 0 : 2)
}

const projectDir = process.env.DEZIGN0_PROJECT_DIR || process.cwd()
const requireFromProject = createRequire(path.join(projectDir, '__dezign0_resolve__.js'))

let chromium
try {
  // Resolve Playwright from the project, not from this script's package.
  // The plugin executes this file from its bundled kit, which has no node_modules.
  const playwrightEntry = requireFromProject.resolve('playwright')
  const playwright = await import(pathToFileURL(playwrightEntry).href)
  chromium = playwright.chromium || playwright.default?.chromium
} catch (error) {
  console.error(`measure-artifact: Playwright is not installed in the project.
  project: ${projectDir}
  npm i -D playwright
  npx playwright install chromium`)
  if (process.env.DEZIGN0_DEBUG === '1' && error instanceof Error) console.error(error.message)
  process.exit(2)
}

// axe-core is optional. Resolve it from the project, and report "skipped"
// instead of failing when it is absent.
let axeScriptPath = null
const axeStatus = { status: 'not-requested' }
if (axeFlag) {
  try {
    let entry
    try {
      entry = requireFromProject.resolve('axe-core/axe.min.js')
    } catch {
      entry = path.join(path.dirname(requireFromProject.resolve('axe-core')), 'axe.min.js')
    }
    if (!fs.existsSync(entry)) throw new Error('axe.min.js not found')
    axeScriptPath = entry
    axeStatus.status = 'available'
  } catch {
    axeStatus.status = 'skipped'
    axeStatus.reason = 'axe-core is not installed in the project'
    axeStatus.install = 'npm i -D axe-core'
  }
}

const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(path.resolve(target)).href
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const pageErrors = []
const requests = []
const requestRecords = []
const requestFailures = []
const httpErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('request', (r) => {
  requestRecords.push(r)
  if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url())
})
page.on('requestfailed', (r) => {
  requestFailures.push({ url: r.url().slice(0, 300), method: r.method(), error: String(r.failure()?.errorText || '') })
})
page.on('response', (res) => {
  if (res.status() >= 400 && !res.url().startsWith('file:')) {
    httpErrors.push({ url: res.url().slice(0, 300), status: res.status(), resourceType: res.request().resourceType() })
  }
})

if (runtimeFlag) {
  await page.addInitScript(() => {
    window.__dezign0Runtime = { lcp: [] }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__dezign0Runtime.lcp.push({
            startTime: entry.startTime,
            size: entry.size,
            url: entry.url || '',
            element: entry.element && entry.element.tagName ? entry.element.tagName.toLowerCase() : '',
          })
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {
      // LCP is best-effort; the Performance API still exposes a fallback below.
    }
  })
}

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
} catch (e) {
  console.error(`measure-artifact: cannot load ${url}: ${e.message}`)
  await browser.close()
  process.exit(2)
}
await page.evaluate(() => document.fonts.ready)

// A short selector helper is inlined in each page.evaluate below instead of
// being passed as source: artifacts may ship a CSP that forbids eval().
const results = []
for (const viewport of viewports) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.waitForTimeout(150)
  const safe = viewport.label.replace(/[^a-z0-9x-]+/gi, '-')
  let screenshotBuffer = null
  if (shotsDir || baselineDir) {
    screenshotBuffer = await page.screenshot({ fullPage: true })
    if (shotsDir) {
      fs.mkdirSync(shotsDir, { recursive: true })
      fs.writeFileSync(path.join(shotsDir, `artifact-${safe}.png`), screenshotBuffer)
    }
    if (shotsDir && selector) {
      const element = page.locator(selector).first()
      if (await element.count()) await element.screenshot({ path: path.join(shotsDir, `artifact-${safe}-element.png`) }).catch(() => {})
    }
  }
  const measure = await page.evaluate(({ excludes, a11yEnabled }) => {
    const vw = window.innerWidth
    const sel = (el) => {
      if (!el || el === document.body) return 'body'
      const parts = []
      let node = el
      while (node && node.nodeType === 1 && parts.length < 3) {
        let part = node.tagName.toLowerCase()
        if (node.id) { part += '#' + CSS.escape(node.id); parts.unshift(part); break }
        const classes = [...node.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('')
        if (classes) part += classes
        parts.unshift(part)
        node = node.parentElement
      }
      return parts.join(' > ')
    }
    const excluded = (el) => excludes.some((s) => {
      try { return !!el.closest(s) } catch { return false }
    })
    const fixed = (el) => getComputedStyle(el).position === 'fixed'
    const visible = (el) => {
      const s = getComputedStyle(el)
      return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.01
    }
    const clippedByScrollable = (el) => {
      let p = el.parentElement
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX
        if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return true
        p = p.parentElement
      }
      return false
    }
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || fixed(el) || excluded(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if ((r.right > vw + 1 || r.left < -1) && !clippedByScrollable(el)) {
        offenders.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 60), left: Math.round(r.left), right: Math.round(r.right) })
      }
    }

    // Normalize any computed color (rgb, oklch, lab, ...) through a 1x1 canvas.
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const cx = cv.getContext('2d')
    function rgba(c) {
      cx.clearRect(0, 0, 1, 1)
      cx.fillStyle = c
      cx.fillRect(0, 0, 1, 1)
      const d = cx.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2], d[3] / 255]
    }
    function over(fg, bg) {
      const a = fg[3]
      return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)))
    }
    function lum(rgb) {
      const [r, g, b] = rgb.map((v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    function ratio(a, b) {
      const l1 = lum(a), l2 = lum(b)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    function effectiveBg(el) {
      // Collect backgrounds from the text element outward. The nearest opaque
      // ancestor is the backdrop; translucent ancestors closer than it composite
      // on top of it. Do NOT stop at the first opaque ancestor found walking
      // outward, or a button background is ignored in favour of the page.
      const chain = []
      let p = el
      while (p) { chain.push(p); p = p.parentElement }
      const layers = chain.map((node) => rgba(getComputedStyle(node).backgroundColor))
      let base = [255, 255, 255]
      let nearestOpaque = -1
      for (let i = 0; i < layers.length; i++) {
        if (layers[i][3] >= 1) { base = layers[i].slice(0, 3); nearestOpaque = i; break }
      }
      const start = nearestOpaque === -1 ? layers.length - 1 : nearestOpaque - 1
      for (let i = start; i >= 0; i--) {
        if (layers[i][3] > 0) base = over(layers[i], base)
      }
      return base
    }

    const contrast = []
    const textSizes = new Set()
    const tiny = []
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length > 0 || !el.textContent || !el.textContent.trim()) continue
      if (!visible(el) || excluded(el)) continue
      const s = getComputedStyle(el)
      if (s.color === 'transparent') continue
      const size = parseFloat(s.fontSize)
      if (!Number.isFinite(size)) continue
      textSizes.add(+size.toFixed(1))
      if (size < 11) tiny.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), size })
      const fg = rgba(s.color)
      const bg = effectiveBg(el)
      if (fg[3] === 0) continue
      const r = ratio(over(fg, bg), bg)
      const large = size >= 24 || (size >= 18.66 && (parseInt(s.fontWeight, 10) || 400) >= 700)
      const required = large ? 3 : 4.5
      if (r < required - 0.01) {
        contrast.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), size: +size.toFixed(1), ratio: +r.toFixed(2), required, text: el.textContent.trim().slice(0, 50) })
      }
    }

    let tabStops = 0
    for (const el of document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')) {
      if (el.closest('[inert]') || el.disabled || el.getAttribute('tabindex') === '-1') continue
      if (!visible(el)) continue
      if (el.tagName === 'A' && !el.getAttribute('href')) continue
      tabStops++
    }

    const a11yIssues = []
    const addA11y = (kind, detail, selector) => a11yIssues.push(selector ? { kind, detail, selector } : { kind, detail })
    const textOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
    const accessibleName = (el) => {
      const aria = (el.getAttribute('aria-label') || '').trim()
      if (aria) return aria
      const labelledby = (el.getAttribute('aria-labelledby') || '').trim()
      if (labelledby) {
        const text = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim()
        if (text) return text
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (label && label.textContent.trim()) return label.textContent.trim()
      }
      const wrapped = el.closest('label')
      if (wrapped && wrapped.textContent.trim()) return wrapped.textContent.trim()
      return (el.getAttribute('title') || el.textContent || '').trim()
    }
    for (const img of document.querySelectorAll('img')) {
      if (!img.hasAttribute('alt')) addA11y('img-alt', `<img src="${String(img.getAttribute('src') || '').slice(0, 40)}">`, sel(img))
    }
    for (const control of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea')) {
      if (control.closest('[inert]')) continue
      if (control.tagName === 'INPUT' && control.type === 'submit') continue
      const name = accessibleName(control) || control.getAttribute('placeholder') || ''
      if (!name) addA11y('control-name', `<${control.tagName.toLowerCase()}>`, sel(control))
      if (control.tagName === 'INPUT' && control.type !== 'submit' && control.type !== 'button') {
        const id = control.getAttribute('id')
        const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || control.closest('label') || control.getAttribute('aria-label')
        if (!labelled) addA11y('input-label', `<input${id ? ` id="${id}"` : ''}>`, sel(control))
      }
    }
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    const h1s = headings.filter((h) => h.tagName === 'H1').length
    if (h1s === 0) addA11y('heading-h1', 'no h1')
    if (h1s > 1) addA11y('heading-h1', `${h1s} h1 elements`)
    let lastLevel = 0
    for (const h of headings) {
      const level = Number(h.tagName[1])
      if (lastLevel && level > lastLevel + 1) addA11y('heading-order', `${h.tagName} after h${lastLevel}`, sel(h))
      lastLevel = level
    }
    if (!document.querySelector('main,[role="main"]')) addA11y('landmark-main', 'no main landmark')
    if (document.querySelector('[tabindex]')) {
      for (const el of document.querySelectorAll('[tabindex]')) {
        if (Number(el.getAttribute('tabindex')) > 0) addA11y('tabindex-positive', el.tagName.toLowerCase(), sel(el))
      }
    }

    let targetSize = { status: 'skipped', reason: 'pass --a11y' }
    let nonTextContrast = { status: 'skipped', reason: 'pass --a11y' }
    if (a11yEnabled) {
      // 2.5.8 Target Size (Minimum). Inline links in running text and disabled
      // controls are exempt; the 24px spacing exception is approximated by
      // centre distance between targets.
      const targetSelector = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="switch"],[role="option"]'
      const targets = []
      for (const el of document.querySelectorAll(targetSelector)) {
        if (el.closest('[inert]') || el.disabled || el.getAttribute('tabindex') === '-1') continue
        if (!visible(el)) continue
        const s = getComputedStyle(el)
        if (el.tagName === 'A' && s.display === 'inline' && el.closest('p,li,td,th,dd,dt,figcaption,label,blockquote')) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        targets.push({ tag: el.tagName.toLowerCase(), width: Math.round(r.width), height: Math.round(r.height), cx: r.left + r.width / 2, cy: r.top + r.height / 2, text: textOf(el).slice(0, 40), selector: sel(el) })
        if (targets.length >= 400) break
      }
      const undersized = targets.filter((t) => t.width < 24 || t.height < 24)
      for (const t of undersized) {
        t.spaced = targets.every((other) => other === t || Math.hypot(t.cx - other.cx, t.cy - other.cy) >= 24)
      }
      const failures = undersized.filter((t) => !t.spaced)
      targetSize = {
        status: failures.length ? 'fail' : 'pass',
        total: targets.length,
        undersizedCount: undersized.length,
        failures: failures.slice(0, 12).map((t) => ({ tag: t.tag, width: t.width, height: t.height, text: t.text, selector: t.selector })),
        exception: 'inline links in text and disabled controls skipped; 24px spacing exception approximated by centre distance',
      }
      for (const t of failures.slice(0, 12)) addA11y('target-size', `${t.tag} ${t.width}x${t.height}px "${t.text}"`, t.selector)

      // 1.4.11 Non-text Contrast. Check control boundaries/backgrounds against
      // the surrounding backdrop. Plain text links are text, not UI components.
      const controlSelector = 'button,input:not([type="hidden"]),select,textarea,[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"]'
      const ntFailures = []
      let ntChecked = 0
      for (const el of document.querySelectorAll(controlSelector)) {
        if (el.closest('[inert]') || el.disabled || !visible(el) || excluded(el)) continue
        const s = getComputedStyle(el)
        const parentBg = effectiveBg(el.parentElement || document.body)
        ntChecked++
        const borderWidths = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map((v) => parseFloat(v) || 0)
        const borderColor = rgba(s.borderTopColor)
        const bgColor = rgba(s.backgroundColor)
        let failure = null
        if (borderWidths.some((w) => w > 0) && borderColor[3] > 0) {
          const bc = over(borderColor, parentBg)
          const r = ratio(bc, parentBg)
          if (r < 2.9) failure = { part: 'border', ratio: +r.toFixed(2) }
        } else if (bgColor[3] > 0) {
          const bc = over(bgColor, parentBg)
          const r = ratio(bc, parentBg)
          if (r < 2.9) failure = { part: 'background', ratio: +r.toFixed(2) }
        }
        if (failure) {
          ntFailures.push({ tag: el.tagName.toLowerCase(), selector: sel(el), part: failure.part, ratio: failure.ratio, required: 3, text: textOf(el).slice(0, 40) })
          addA11y('non-text-contrast', `${failure.part} ${failure.ratio}:1 (need 3) <${el.tagName.toLowerCase()}>`, sel(el))
        }
      }
      nonTextContrast = {
        status: ntFailures.length ? 'fail' : 'pass',
        checked: ntChecked,
        failures: ntFailures.slice(0, 12),
      }

      // ARIA hygiene checks that axe may duplicate; mergeA11y dedupes them.
      const ids = new Map()
      for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1)
      for (const [id, count] of ids) if (count > 1) addA11y('duplicate-id', `id="${id}" used ${count} times`)
      for (const el of document.querySelectorAll('[aria-labelledby],[aria-describedby]')) {
        for (const attr of ['aria-labelledby', 'aria-describedby']) {
          const value = el.getAttribute(attr)
          if (!value) continue
          for (const ref of value.split(/\s+/).filter(Boolean)) {
            if (!document.getElementById(ref)) addA11y('aria-ref', `${attr}="${ref}" target missing`, sel(el))
          }
        }
      }
      for (const el of document.querySelectorAll('[aria-hidden="true"]')) {
        if (el.matches('a[href],button,input,select,textarea,[tabindex]') || el.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')) {
          addA11y('aria-hidden-focus', 'focusable content inside aria-hidden="true"', sel(el))
        }
      }
    }

    return {
      vw,
      scrollWidth: document.documentElement.scrollWidth,
      a11yCount: a11yIssues.length,
      a11y: a11yIssues.slice(0, 12),
      clipped: offenders.slice(0, 12),
      clippedCount: offenders.length,
      contrast: contrast.sort((a, b) => a.ratio - b.ratio).slice(0, 12),
      contrastCount: contrast.length,
      typeSizeCount: textSizes.size,
      tiny: [...new Map(tiny.map((t) => [t.tag + t.cls + t.size, t])).values()].slice(0, 12),
      tabStops,
      odHooks: document.querySelectorAll('[data-od-id]').length,
      targetSize,
      nonTextContrast,
    }
  }, { excludes, a11yEnabled: a11y })
  if (a11y) {
    measure.targetSize = { ...measure.targetSize, wcag: criteriaFor('target-size') }
    measure.nonTextContrast = { ...measure.nonTextContrast, wcag: criteriaFor('non-text-contrast') }
  }
  let elementBox = null
  if (selector) {
    const box = await page.locator(selector).first().boundingBox().catch(() => null)
    if (box) elementBox = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
  }
  let diff = null
  if (baselineDir && screenshotBuffer) {
    const baselinePath = path.join(baselineDir, `artifact-${safe}.png`)
    if (fs.existsSync(baselinePath)) {
      const baseline = fs.readFileSync(baselinePath).toString('base64')
      const candidate = screenshotBuffer.toString('base64')
      diff = await page.evaluate(async ({ baseline, candidate, maxDiff }) => {
        const load = (b64) => new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = `data:image/png;base64,${b64}`
        })
        const [a, b] = await Promise.all([load(baseline), load(candidate)])
        if (a.width !== b.width || a.height !== b.height) {
          return { status: 'size-mismatch', baseline: [a.width, a.height], candidate: [b.width, b.height], ratio: 1 }
        }
        const canvas = document.createElement('canvas')
        canvas.width = a.width
        canvas.height = a.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(a, 0, 0)
        const da = ctx.getImageData(0, 0, a.width, a.height).data
        ctx.clearRect(0, 0, a.width, a.height)
        ctx.drawImage(b, 0, 0)
        const db = ctx.getImageData(0, 0, a.width, a.height).data
        let changed = 0
        for (let i = 0; i < da.length; i += 4) {
          if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3])) > 12) changed += 1
        }
        return { status: 'compared', changed, total: a.width * a.height, ratio: changed / (a.width * a.height), maxDiff }
      }, { baseline, candidate, maxDiff })
      diff.path = baselinePath
    } else {
      diff = { status: 'no-baseline', path: baselinePath }
    }
  }
  results.push({ width: viewport.width, height: viewport.height, label: viewport.label, selector, elementBox, diff, ...measure })
}

// ---------------------------------------------------------------------------
// Whole-page checks. Each is opt-in and reports a skipped shape when absent so
// the JSON schema stays stable.
// ---------------------------------------------------------------------------

const skipped = (reason) => ({ status: 'skipped', reason })

async function resetViewport() {
  const first = viewports[0] || { width: 1440, height: 900 }
  await page.setViewportSize({ width: first.width, height: first.height })
  await page.waitForTimeout(100)
}

let axeResult = skipped('pass --axe')
if (axeFlag) {
  if (axeStatus.status === 'available') {
    try {
      await resetViewport()
      await page.evaluate(() => window.scrollTo(0, 0))
      // Inject axe through page.evaluate rather than addScriptTag: a strict
      // page CSP can block an inline <script>, but CDP evaluation is not blocked.
      const axeSource = fs.readFileSync(axeScriptPath, 'utf8')
      await page.evaluate(axeSource)
      const raw = await page.evaluate(async () => {
        const result = await window.axe.run(document)
        return {
          version: window.axe.version,
          violations: result.violations.map((v) => ({
            id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
            tags: v.tags,
            nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })),
          })),
          passes: result.passes.length,
          incomplete: result.incomplete.length,
          inapplicable: result.inapplicable.length,
        }
      })
      axeResult = {
        status: 'ran',
        version: raw.version,
        viewport: viewports[0]?.label || '1440x900',
        violations: raw.violations.map(mapAxeViolation),
        violationCount: raw.violations.length,
        nodeCount: raw.violations.reduce((sum, v) => sum + v.nodes.length, 0),
        passes: raw.passes,
        incomplete: raw.incomplete,
        inapplicable: raw.inapplicable,
      }
    } catch (error) {
      axeResult = skipped(`axe-core failed to run: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    axeResult = { ...axeStatus }
  }
}

let keyboard = skipped('pass --a11y')
if (a11y) {
  await resetViewport()
  try {
    await page.evaluate(() => {
      const focusables = [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]')]
        .filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1' && !el.closest('[inert]'))
      window.__dezign0FocusBaseline = new Map()
      for (const el of focusables) {
        const s = getComputedStyle(el)
        window.__dezign0FocusBaseline.set(el, {
          outline: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset].join('|'),
          boxShadow: s.boxShadow,
          borderColor: s.borderColor,
          backgroundColor: s.backgroundColor,
        })
      }
    })
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() })
    const sequence = []
    const noFocusVisible = []
    const obscured = []
    let trap = null
    let dialogSeen = null
    let dialogCount = 0
    for (let stop = 0; stop < 80; stop++) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body || el === document.documentElement) return null
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        const base = window.__dezign0FocusBaseline?.get(el)
        const outlineNow = [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset].join('|')
        const focusVisible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
          s.boxShadow !== 'none' ||
          Boolean(base && (outlineNow !== base.outline || s.boxShadow !== base.boxShadow || s.borderColor !== base.borderColor || s.backgroundColor !== base.backgroundColor))
        const cx = Math.max(0, Math.min(window.innerWidth - 1, r.left + r.width / 2))
        const cy = Math.max(0, Math.min(window.innerHeight - 1, r.top + r.height / 2))
        const top = document.elementFromPoint(cx, cy)
        const obscuredByFocus = !(top === el || el.contains(top) || top?.contains(el))
        const dialog = el.closest('[role="dialog"],[aria-modal="true"]')
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: String(el.className || '').slice(0, 40),
          role: el.getAttribute('role') || '',
          text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          focusVisible,
          obscured: obscuredByFocus,
          dialog: Boolean(dialog),
          dialogSelector: dialog ? (dialog.id ? `#${dialog.id}` : '') : '',
        }
      })
      if (!info) break
      const duplicate = sequence.some((prev) => prev.tag === info.tag && prev.id === info.id && prev.cls === info.cls && prev.text === info.text)
      sequence.push({ stop, ...info, wrap: duplicate })
      if (!info.focusVisible) noFocusVisible.push(info)
      if (info.obscured) obscured.push(info)
      if (info.dialog) {
        if (dialogSeen === info.dialogSelector) dialogCount++
        else { dialogSeen = info.dialogSelector; dialogCount = 1 }
        if (dialogCount > 30) { trap = { dialog: info.dialogSelector || 'dialog', afterTabs: stop + 1 }; break }
      }
      if (duplicate) break
    }
    keyboard = {
      status: trap ? 'fail' : noFocusVisible.length || obscured.length ? 'fail' : 'pass',
      tabStopsReached: sequence.length,
      sequence: sequence.slice(0, 30).map(({ stop, tag, id, cls, role, text, focusVisible, obscured: isObscured, wrap }) => ({ stop, tag, id, cls, role, text, focusVisible, obscured: isObscured, wrap })),
      focusVisible: { checked: sequence.length, failures: noFocusVisible.slice(0, 10).map(({ tag, id, cls, text }) => ({ tag, id, cls, text })) },
      obscured: obscured.slice(0, 10).map(({ tag, id, cls, text }) => ({ tag, id, cls, text })),
      trap,
      wcag: [...criteriaFor('focus-visible'), ...criteriaFor('keyboard-trap'), ...criteriaFor('focus-order')],
    }
  } catch (error) {
    keyboard = skipped(`keyboard probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

let aria = skipped('pass --a11y')
if (a11y) {
  try {
    const snapshot = await page.locator('body').ariaSnapshot()
    aria = { status: 'captured', bytes: Buffer.byteLength(snapshot, 'utf8'), snapshot: snapshot.slice(0, 8000), truncated: snapshot.length > 8000 }
  } catch (error) {
    aria = skipped(`ARIA snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

let reducedMotion = skipped('pass --a11y')
if (a11y) {
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(120)
    const probe = await page.evaluate(() => {
      const sel = (el) => {
        if (!el || el === document.body) return 'body'
        const parts = []
        let node = el
        while (node && node.nodeType === 1 && parts.length < 3) {
          let part = node.tagName.toLowerCase()
          if (node.id) { part += '#' + CSS.escape(node.id); parts.unshift(part); break }
          const classes = [...node.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('')
          if (classes) part += classes
          parts.unshift(part)
          node = node.parentElement
        }
        return parts.join(' > ')
      }
      let mediaSupport = false
      for (const sheet of document.styleSheets) {
        let rules
        try { rules = sheet.cssRules } catch { continue }
        for (const rule of rules) {
          if (rule.media?.mediaText?.includes('prefers-reduced-motion')) mediaSupport = true
        }
      }
      const animated = []
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el)
        const duration = Math.max(...String(s.animationDuration).split(',').map((v) => parseFloat(v) || 0))
        if (s.animationName && s.animationName !== 'none' && duration > 0.1) {
          animated.push({ selector: sel(el), animation: s.animationName, duration: s.animationDuration })
        }
      }
      const running = (document.getAnimations ? document.getAnimations() : [])
        .filter((animation) => animation.playState === 'running' && ((animation.effect && animation.effect.getTiming ? animation.effect.getTiming().duration : 0) > 100))
        .length
      return { mediaSupport, animated: animated.slice(0, 10), animatedCount: animated.length, running }
    })
    const findings = []
    if (probe.running > 0) findings.push({ kind: 'reduced-motion', detail: `${probe.running} animations keep running with prefers-reduced-motion: reduce` })
    if (!probe.mediaSupport && probe.animatedCount > 0) findings.push({ kind: 'reduced-motion', detail: `${probe.animatedCount} animated elements but no prefers-reduced-motion media query` })
    reducedMotion = {
      status: findings.length ? 'fail' : 'pass',
      mediaQuery: probe.mediaSupport,
      animatedCount: probe.animatedCount,
      runningAnimations: probe.running,
      findings,
      wcag: criteriaFor('reduced-motion'),
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  } catch (error) {
    await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {})
    reducedMotion = skipped(`reduced-motion probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 1.4.12 Text Spacing. Apply the four user-override values and re-measure
// overflow at the 320px stress width, then restore the page.
let textSpacing = skipped('pass --a11y')
if (a11y) {
  try {
    await page.setViewportSize({ width: 320, height: 800 })
    const probe = await page.evaluate(() => {
      const sel = (el) => {
        if (!el || el === document.body) return 'body'
        const parts = []
        let node = el
        while (node && node.nodeType === 1 && parts.length < 3) {
          let part = node.tagName.toLowerCase()
          if (node.id) { part += '#' + CSS.escape(node.id); parts.unshift(part); break }
          const classes = [...node.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('')
          if (classes) part += classes
          parts.unshift(part)
          node = node.parentElement
        }
        return parts.join(' > ')
      }
      const style = document.createElement('style')
      style.id = 'dezign0-text-spacing-probe'
      style.textContent = '*,*::before,*::after{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important} p{margin-bottom:2em!important}'
      document.head.appendChild(style)
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el)
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity <= 0.01) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > window.innerWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(el.parentElement || document.body).overflowX)) {
          offenders.push({ tag: el.tagName.toLowerCase(), selector: sel(el), right: Math.round(r.right) })
        }
      }
      const result = { scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth, offenders: offenders.slice(0, 12), clippedCount: offenders.length }
      style.remove()
      return result
    })
    await resetViewport()
    const fail = probe.scrollWidth > 320 + 1 || probe.clippedCount > 0
    textSpacing = {
      status: fail ? 'fail' : 'pass',
      width: 320,
      scrollWidth: probe.scrollWidth,
      clippedCount: probe.clippedCount,
      offenders: probe.offenders,
      wcag: criteriaFor('text-spacing'),
    }
  } catch (error) {
    await resetViewport()
    textSpacing = skipped(`text-spacing probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

let reflow = skipped('pass --reflow')
if (reflowFlag) {
  try {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.waitForTimeout(150)
    const probe = await page.evaluate(() => {
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el)
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity <= 0.01) continue
        if (s.position === 'fixed') continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        let scrollable = false
        let p = el.parentElement
        while (p && p !== document.body) {
          const ox = getComputedStyle(p).overflowX
          if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) { scrollable = true; break }
          p = p.parentElement
        }
        if (r.right > window.innerWidth + 1 && !scrollable) offenders.push({ tag: el.tagName.toLowerCase(), left: Math.round(r.left), right: Math.round(r.right) })
      }
      return { scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth, clippedCount: offenders.length, offenders: offenders.slice(0, 12) }
    })
    await resetViewport()
    reflow = {
      status: probe.scrollWidth <= 320 + 1 && probe.clippedCount === 0 ? 'pass' : 'fail',
      width: 320,
      scrollWidth: probe.scrollWidth,
      clippedCount: probe.clippedCount,
      offenders: probe.offenders,
      wcag: criteriaFor('reflow'),
    }
  } catch (error) {
    await resetViewport()
    reflow = skipped(`reflow probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

let forcedColors = skipped('pass --forced-colors')
if (forcedColorsFlag) {
  try {
    await resetViewport()
    await page.emulateMedia({ forcedColors: 'active' })
    await page.waitForTimeout(150)
    const probe = await page.evaluate(() => {
      const sel = (el) => {
        if (!el || el === document.body) return 'body'
        const parts = []
        let node = el
        while (node && node.nodeType === 1 && parts.length < 3) {
          let part = node.tagName.toLowerCase()
          if (node.id) { part += '#' + CSS.escape(node.id); parts.unshift(part); break }
          const classes = [...node.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('')
          if (classes) part += classes
          parts.unshift(part)
          node = node.parentElement
        }
        return parts.join(' > ')
      }
      const findings = []
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el)
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity <= 0.01) continue
        const maskImage = s.maskImage || s.webkitMaskImage
        const blend = s.mixBlendMode
        const filter = s.filter
        if ((maskImage && maskImage !== 'none') || (blend && blend !== 'normal') || (filter && filter !== 'none')) {
          findings.push({ kind: 'reduced-cue', selector: sel(el), detail: `forced colors may hide cue: mask=${maskImage || 'none'} blend=${blend} filter=${filter}` })
        }
      }
      // Focus indicator: box-shadow is commonly dropped in forced-colors mode.
      const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
        .filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1')
      let focusChecked = 0
      const focusFailures = []
      for (const el of focusables.slice(0, 20)) {
        el.focus()
        const s = getComputedStyle(el)
        focusChecked++
        if (s.outlineStyle === 'none' && s.boxShadow !== 'none') {
          focusFailures.push({ selector: sel(el), detail: 'focus relies on box-shadow, which forced-colors commonly removes' })
        }
      }
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
      return { findings: findings.slice(0, 15), focusChecked, focusFailures: focusFailures.slice(0, 10) }
    })
    await page.emulateMedia({ forcedColors: 'none' })
    await resetViewport()
    const fail = probe.findings.length > 0 || probe.focusFailures.length > 0
    forcedColors = {
      status: fail ? 'fail' : 'pass',
      scheme: 'forced-colors: active',
      findings: probe.findings,
      focusChecked: probe.focusChecked,
      focusFailures: probe.focusFailures,
      wcag: criteriaFor('forced-colors'),
    }
  } catch (error) {
    await page.emulateMedia({ forcedColors: 'none' }).catch(() => {})
    await resetViewport()
    forcedColors = skipped(`forced-colors probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

let print = skipped('pass --print')
if (printFlag) {
  try {
    await resetViewport()
    await page.emulateMedia({ media: 'print' })
    // Emulate the paper layout width as well as the media query: Chromium keeps
    // the screen viewport when only media is emulated, which would make every
    // centred desktop column look like print overflow.
    await page.setViewportSize({ width: 816, height: 1056 })
    await page.waitForTimeout(150)
    const probe = await page.evaluate(() => {
      const paperWidth = 816 // Letter at 96dpi
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el)
        if (s.display === 'none' || s.visibility === 'hidden') continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > paperWidth + 1) offenders.push({ tag: el.tagName.toLowerCase(), right: Math.round(r.right) })
      }
      const fixed = [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && getComputedStyle(el).display !== 'none').length
      const sticky = [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'sticky').length
      return { scrollWidth: document.documentElement.scrollWidth, paperWidth, clippedCount: offenders.length, offenders: offenders.slice(0, 12), fixed, sticky }
    })
    let pdf = null
    try {
      const buffer = await page.pdf({ format: 'Letter', printBackground: true })
      const text = buffer.toString('latin1')
      const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length
      pdf = { bytes: buffer.length, pages }
    } catch {
      pdf = { error: 'PDF generation is unavailable in this Chromium build' }
    }
    await page.emulateMedia({ media: 'screen' })
    await resetViewport()
    const fail = probe.clippedCount > 0
    print = { status: fail ? 'fail' : 'pass', media: 'print', ...probe, pdf }
  } catch (error) {
    await page.emulateMedia({ media: 'screen' }).catch(() => {})
    await resetViewport()
    print = skipped(`print probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

let runtime = skipped('pass --runtime')
if (runtimeFlag) {
  try {
    const lcpEntries = await page.evaluate(() => {
      const observed = (window.__dezign0Runtime?.lcp || [])
      const perf = (performance.getEntriesByType('largest-contentful-paint') || []).map((entry) => ({ startTime: entry.startTime, size: entry.size, url: entry.url || '' }))
      return { observed, perf }
    })
    const allLcp = [...lcpEntries.observed, ...lcpEntries.perf]
    const lcp = allLcp.sort((a, b) => b.startTime - a.startTime)[0] || null
    let responseBytes = 0
    for (const request of requestRecords.slice(0, 200)) {
      try {
        const sizes = await request.sizes()
        responseBytes += sizes.responseBodySize || 0
      } catch {
        // Detached request (redirect, aborted); ignore.
      }
    }
    const origins = [...new Set(requests.map((u) => { try { return new URL(u).origin } catch { return '' } }).filter(Boolean))]
    runtime = {
      status: 'measured',
      requestCount: requests.length,
      failedRequests: [...requestFailures, ...httpErrors].slice(0, 25),
      failedCount: requestFailures.length + httpErrors.length,
      responseBytes,
      externalOrigins: origins.slice(0, 20),
      externalOriginCount: origins.length,
      lcp,
      wcag: [],
    }
  } catch (error) {
    runtime = skipped(`runtime probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await browser.close()

// Merge hand findings (deduped across viewports) with axe violations, then
// build the WCAG 2.2 summary. runtime/print are measurements, not criteria.
const handFindings = []
const handSeen = new Set()
for (const result of results) {
  for (const finding of result.a11y) {
    const key = `${finding.kind}|${finding.selector || ''}|${finding.detail}`
    if (handSeen.has(key)) continue
    handSeen.add(key)
    handFindings.push(finding)
  }
}
const axeViolations = axeResult.status === 'ran' ? axeResult.violations : []
const mergedFindings = mergeA11y({ hand: handFindings, axe: axeViolations })
const topLevelFindings = []
if (a11y) {
  if (keyboard.trap) topLevelFindings.push({ kind: 'keyboard-trap', detail: `possible keyboard trap in ${keyboard.trap.dialog} after ${keyboard.trap.afterTabs} tabs`, wcag: criteriaFor('keyboard-trap') })
  for (const failure of keyboard.focusVisible?.failures || []) topLevelFindings.push({ kind: 'focus-visible', detail: `no visible focus indicator on ${failure.tag}${failure.id ? '#' + failure.id : ''}`, wcag: criteriaFor('focus-visible') })
  for (const finding of reducedMotion.findings || []) topLevelFindings.push({ kind: 'reduced-motion', detail: finding.detail, wcag: criteriaFor('reduced-motion') })
  if (textSpacing.status === 'fail') topLevelFindings.push({ kind: 'text-spacing', detail: `${textSpacing.clippedCount} clipped elements at 320px with user text-spacing overrides`, wcag: criteriaFor('text-spacing') })
}
if (reflow.status === 'fail') topLevelFindings.push({ kind: 'reflow', detail: `horizontal scrolling/clipping at 320px (${reflow.scrollWidth}px content)`, wcag: criteriaFor('reflow') })
if (forcedColors.status === 'fail') {
  for (const finding of forcedColors.findings || []) topLevelFindings.push({ kind: 'forced-colors', detail: `${finding.selector}: ${finding.detail}`, wcag: criteriaFor('forced-colors') })
  for (const failure of forcedColors.focusFailures || []) topLevelFindings.push({ kind: 'forced-colors', detail: `${failure.selector}: ${failure.detail}`, wcag: criteriaFor('forced-colors') })
}
const allFindings = [...mergedFindings, ...topLevelFindings]
const wcagSummary = summarizeWcag(allFindings)
const wcagChecks = Object.fromEntries(Object.entries(CHECK_CRITERIA).map(([check, ids]) => [check, ids]))

const baselineFailures = baselineDir
  ? results.filter((r) => r.diff && ((r.diff.status !== 'compared') || (r.diff.status === 'compared' && r.diff.ratio > maxDiff)))
  : []
const blockingReasons = []
if (results.some((r) => r.clippedCount > 0)) blockingReasons.push('clipped')
if (results.some((r) => r.contrastCount > 0)) blockingReasons.push('contrast')
if (consoleErrors.length > 0 || pageErrors.length > 0) blockingReasons.push('console-errors')
if (a11y && (results.some((r) => r.a11yCount > 0) || keyboard.status === 'fail' || textSpacing.status === 'fail')) blockingReasons.push('a11y')
if (axeFlag && axeResult.status === 'ran' && axeResult.violationCount > 0) blockingReasons.push('axe')
if (reflowFlag && reflow.status === 'fail') blockingReasons.push('reflow')
if (forcedColorsFlag && forcedColors.status === 'fail') blockingReasons.push('forced-colors')
if (printFlag && print.status === 'fail') blockingReasons.push('print')
if (baselineFailures.length > 0) blockingReasons.push('baseline')
const blocking = blockingReasons.length > 0

const payload = {
  url,
  viewports,
  results,
  consoleErrors,
  pageErrors,
  requests,
  blocking,
  // Extended, additive fields. Old consumers keep reading the keys above.
  blockingReasons,
  wcag: {
    version: WCAG_VERSION,
    summary: wcagSummary,
    checks: wcagChecks,
  },
  a11y: {
    handCount: handFindings.length,
    mergedCount: allFindings.length,
    findings: allFindings.slice(0, 40),
  },
  axe: axeResult,
  keyboard,
  aria,
  reducedMotion,
  textSpacing,
  reflow,
  forcedColors,
  print,
  runtime,
}

if (json) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  console.log(`measure-artifact: ${target}`)
  console.log(`console errors: ${consoleErrors.length + pageErrors.length}, external requests: ${requests.length}`)
  for (const r of results) {
    const clip = r.clippedCount ? `CLIPPED ${r.clippedCount}` : 'no clipped content'
    const con = r.contrastCount ? `contrast failures ${r.contrastCount}` : 'contrast ok'
    console.log(`${String(r.label || r.width).padStart(9)}  scrollWidth=${r.scrollWidth}  ${clip}  ${con}  typeSizes=${r.typeSizeCount}  tabStops=${r.tabStops}  odHooks=${r.odHooks}${a11y ? `  a11y=${r.a11yCount}  targets=${r.targetSize.failures?.length || 0}/${r.targetSize.total ?? '?'}  nonText=${r.nonTextContrast.failures?.length || 0}` : ''}${r.elementBox ? `  element=${r.elementBox.width}x${r.elementBox.height}` : ''}${r.diff ? `  diff=${r.diff.status === 'compared' ? (r.diff.ratio * 100).toFixed(2) + '%' : r.diff.status}` : ''}`)
    for (const c of r.clipped.slice(0, 4)) console.log(`      clip: <${c.tag.toLowerCase()} class="${c.cls}"> ${c.left}..${c.right}`)
    for (const c of r.contrast.slice(0, 4)) console.log(`      contrast ${c.ratio}:1 (need ${c.required}) ${c.size}px "${c.text}"`)
    if (r.tiny.length) console.log(`      text <11px: ${r.tiny.map((t) => `${t.size}px ${t.tag.toLowerCase()}.${t.cls}`).join(', ')}`)
    if (a11y) for (const a of r.a11y.slice(0, 6)) console.log(`      a11y ${a.kind}: ${a.detail}${a.wcag?.length ? ` [${a.wcag.map((c) => c.id).join(', ')}]` : ''}`)
    if (a11y && r.targetSize.failures?.length) for (const t of r.targetSize.failures.slice(0, 3)) console.log(`      target ${t.width}x${t.height} <${t.tag}> "${t.text}" [2.5.8 AA]`)
    if (a11y && r.nonTextContrast.failures?.length) for (const t of r.nonTextContrast.failures.slice(0, 3)) console.log(`      non-text ${t.ratio}:1 ${t.part} <${t.tag}> [1.4.11 AA]`)
  }
  if (a11y) {
    console.log(`a11y: ${mergedFindings.length} merged findings; keyboard=${keyboard.status}; reduced-motion=${reducedMotion.status}`)
    if (keyboard.focusVisible?.failures?.length) console.log(`      focus-visible failures: ${keyboard.focusVisible.failures.length}`)
    if (keyboard.trap) console.log(`      possible keyboard trap: ${keyboard.trap.dialog}`)
    if (reducedMotion.findings?.length) for (const f of reducedMotion.findings.slice(0, 4)) console.log(`      reduced-motion: ${f.detail}`)
    console.log(`text-spacing: ${textSpacing.status}${textSpacing.clippedCount ? ` (${textSpacing.clippedCount} clipped at 320)` : ''}`)
  }
  if (axeFlag) {
    console.log(`axe: ${axeResult.status}${axeResult.status === 'ran' ? `, ${axeResult.violationCount} violations (${axeResult.nodeCount} nodes)` : ` — ${axeResult.reason || ''}`}`)
    for (const v of (axeResult.violations || []).slice(0, 5)) console.log(`      axe ${v.rule} [${v.impact}] ${v.wcag?.map((c) => `${c.id} ${c.level}`).join(', ')}`)
  }
  if (reflowFlag) console.log(`reflow: ${reflow.status} at 320px (scrollWidth=${reflow.scrollWidth ?? '?'})`)
  if (forcedColorsFlag) console.log(`forced-colors: ${forcedColors.status} (${forcedColors.findings?.length || 0} findings, ${forcedColors.focusFailures?.length || 0} focus failures)`)
  if (printFlag) console.log(`print: ${print.status} scrollWidth=${print.scrollWidth ?? '?'} fixed=${print.fixed ?? '?'} pdf=${print.pdf?.pages ?? '?'} pages/${print.pdf?.bytes ?? '?'} bytes`)
  if (runtimeFlag) console.log(`runtime: ${runtime.status} requests=${runtime.requestCount} failed=${runtime.failedCount} bytes=${runtime.responseBytes} origins=${runtime.externalOriginCount} lcp=${runtime.lcp ? Math.round(runtime.lcp.startTime) + 'ms' : 'n/a'}`)
  if (wcagSummary.length) console.log(`wcag 2.2: ${wcagSummary.map((c) => `${c.id}(${c.level})x${c.count}`).join(' ')}`)
  if (consoleErrors.length) console.log('console:', consoleErrors.slice(0, 5))
  if (pageErrors.length) console.log('pageerrors:', pageErrors.slice(0, 5))
  if (blockingReasons.length) console.log(`blocking: ${blockingReasons.join(', ')}`)
  console.log(blocking ? 'measure-artifact: findings present' : 'measure-artifact: no blocking findings')
}

process.exit(strict && blocking ? 1 : 0)
