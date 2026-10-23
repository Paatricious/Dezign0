#!/usr/bin/env node
/**
 * measure-artifact — browser measurements for a design artifact.
 *
 * design-lint is static. This tool answers the questions a static reader cannot:
 * is content actually clipped at small widths? Which contrast pairs fail in the
 * rendered page? How many type sizes exist? How many controls are focusable?
 *
 * Requires Playwright (not bundled). Install it in the harness that runs the
 * measurement, not in the kit:
 *
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   node measure-artifact.mjs <file-or-url> [--viewports=1440,1024,768,390,375,360]
 *                                [--json] [--strict] [--shots=dir]
 *
 * Exit codes: 0 no blocking failures, 1 blocking failures with --strict,
 *             2 load/measurement error.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'

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
                                   [--selector=.widget] [--baseline=dir]
                                   [--max-diff=0.001]
                                   [--exclude=.selector,other-selector]

Requires Playwright: npm i -D playwright && npx playwright install chromium

Reports: console errors, clipped elements per viewport, rendered contrast
failures, distinct type sizes and text below 11px, focusable controls,
data-od-id hooks and optional accessibility checks. Viewports accept WIDTH or
WIDTHxHEIGHT; use 145x188 for an exact widget cell. --selector also captures
the element box. --baseline compares full-page screenshots (same viewport) and
fails --strict when the changed-pixel ratio exceeds --max-diff. --strict exits 1
on clipped content, contrast failures, console errors, a11y findings or a
baseline diff. --exclude skips intentionally reproduced regions (for example
inert mock widgets on a state board).`)
  process.exit(target ? 0 : 2)
}

let chromium
try {
  // Resolve Playwright from the project, not from this script's package.
  // The plugin executes this file from its bundled kit, which has no node_modules.
  const projectDir = process.env.DEZIGN0_PROJECT_DIR || process.cwd()
  const requireFromProject = createRequire(path.join(projectDir, '__dezign0_resolve__.js'))
  const playwrightEntry = requireFromProject.resolve('playwright')
  const playwright = await import(pathToFileURL(playwrightEntry).href)
  chromium = playwright.chromium || playwright.default?.chromium
} catch (error) {
  console.error(`measure-artifact: Playwright is not installed in the project.
  project: ${process.env.DEZIGN0_PROJECT_DIR || process.cwd()}
  npm i -D playwright
  npx playwright install chromium`)
  if (process.env.DEZIGN0_DEBUG === '1' && error instanceof Error) console.error(error.message)
  process.exit(2)
}
const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(path.resolve(target)).href
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const pageErrors = []
const requests = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()) })

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
} catch (e) {
  console.error(`measure-artifact: cannot load ${url}: ${e.message}`)
  await browser.close()
  process.exit(2)
}
await page.evaluate(() => document.fonts.ready)

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
  const measure = await page.evaluate((excludes) => {
    const vw = window.innerWidth
    const excluded = (el) => excludes.some((sel) => {
      try { return !!el.closest(sel) } catch { return false }
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
    const addA11y = (kind, detail) => a11yIssues.push({ kind, detail })
    const textOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
    for (const img of document.querySelectorAll('img')) {
      if (!img.hasAttribute('alt')) addA11y('img-alt', `<img src="${String(img.getAttribute('src') || '').slice(0, 40)}">`)
    }
    for (const control of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea')) {
      if (control.closest('[inert]')) continue
      if (control.tagName === 'INPUT' && control.type === 'submit') continue
      const name = textOf(control) || control.getAttribute('placeholder') || ''
      if (!name) addA11y('control-name', `<${control.tagName.toLowerCase()}>`)
      if (control.tagName === 'INPUT' && control.type !== 'submit' && control.type !== 'button') {
        const id = control.getAttribute('id')
        const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || control.closest('label') || control.getAttribute('aria-label')
        if (!labelled) addA11y('input-label', `<input${id ? ` id="${id}"` : ''}>`)
      }
    }
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    const h1s = headings.filter((h) => h.tagName === 'H1').length
    if (h1s === 0) addA11y('heading-h1', 'no h1')
    if (h1s > 1) addA11y('heading-h1', `${h1s} h1 elements`)
    let lastLevel = 0
    for (const h of headings) {
      const level = Number(h.tagName[1])
      if (lastLevel && level > lastLevel + 1) addA11y('heading-order', `${h.tagName} after h${lastLevel}`)
      lastLevel = level
    }
    if (!document.querySelector('main,[role="main"]')) addA11y('landmark-main', 'no main landmark')
    if (document.querySelector('[tabindex]')) {
      for (const el of document.querySelectorAll('[tabindex]')) {
        if (Number(el.getAttribute('tabindex')) > 0) addA11y('tabindex-positive', el.tagName.toLowerCase())
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
    }
  }, excludes)
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

await browser.close()

const blocking =
  results.some((r) => r.clippedCount > 0 || r.contrastCount > 0) ||
  consoleErrors.length > 0 || pageErrors.length > 0 ||
  (a11y && results.some((r) => r.a11yCount > 0)) ||
  (baselineDir && results.some((r) => r.diff && r.diff.status !== 'compared' || (r.diff?.status === 'compared' && r.diff.ratio > maxDiff)))

if (json) {
  console.log(JSON.stringify({ url, viewports, results, consoleErrors, pageErrors, requests, blocking }, null, 2))
} else {
  console.log(`measure-artifact: ${target}`)
  console.log(`console errors: ${consoleErrors.length + pageErrors.length}, external requests: ${requests.length}`)
  for (const r of results) {
    const clip = r.clippedCount ? `CLIPPED ${r.clippedCount}` : 'no clipped content'
    const con = r.contrastCount ? `contrast failures ${r.contrastCount}` : 'contrast ok'
    console.log(`${String(r.label || r.width).padStart(9)}  scrollWidth=${r.scrollWidth}  ${clip}  ${con}  typeSizes=${r.typeSizeCount}  tabStops=${r.tabStops}  odHooks=${r.odHooks}${a11y ? `  a11y=${r.a11yCount}` : ''}${r.elementBox ? `  element=${r.elementBox.width}x${r.elementBox.height}` : ''}${r.diff ? `  diff=${r.diff.status === 'compared' ? (r.diff.ratio * 100).toFixed(2) + '%' : r.diff.status}` : ''}`)
    for (const c of r.clipped.slice(0, 4)) console.log(`      clip: <${c.tag.toLowerCase()} class="${c.cls}"> ${c.left}..${c.right}`)
    for (const c of r.contrast.slice(0, 4)) console.log(`      contrast ${c.ratio}:1 (need ${c.required}) ${c.size}px "${c.text}"`)
    if (r.tiny.length) console.log(`      text <11px: ${r.tiny.map((t) => `${t.size}px ${t.tag.toLowerCase()}.${t.cls}`).join(', ')}`)
    if (a11y) for (const a of r.a11y.slice(0, 6)) console.log(`      a11y ${a.kind}: ${a.detail}`)
  }
  if (consoleErrors.length) console.log('console:', consoleErrors.slice(0, 5))
  if (pageErrors.length) console.log('pageerrors:', pageErrors.slice(0, 5))
  console.log(blocking ? 'measure-artifact: findings present' : 'measure-artifact: no blocking findings')
}

process.exit(strict && blocking ? 1 : 0)
