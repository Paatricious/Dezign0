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
import fs from 'node:fs'

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith('--'))
const json = args.includes('--json')
const strict = args.includes('--strict')
const viewportsArg = args.find((a) => a.startsWith('--viewports='))
const shotsArg = args.find((a) => a.startsWith('--shots='))
const excludeArg = args.find((a) => a.startsWith('--exclude='))
const excludes = (excludeArg ? excludeArg.split('=')[1] : '')
  .split(',').map((s) => s.trim()).filter(Boolean)
const viewports = (viewportsArg ? viewportsArg.split('=')[1] : '1440,1024,768,390,375,360')
  .split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
const shotsDir = shotsArg ? shotsArg.split('=')[1] : null

if (!target || args.includes('--help') || args.includes('-h')) {
  console.log(`measure-artifact — rendered checks for a design artifact

Usage: node measure-artifact.mjs <file-or-url> [--viewports=1440,768,390,375,360]
                                   [--json] [--strict] [--shots=dir]
                                   [--exclude=.selector,other-selector]

Requires Playwright: npm i -D playwright && npx playwright install chromium

Reports: console errors, clipped elements per viewport, rendered contrast
failures, distinct type sizes and text below 11px, focusable controls, and
data-od-id hooks. --strict exits 1 on clipped content, contrast failures or
console errors. --exclude skips intentionally reproduced regions (for example
the inert mock widgets on a state board) from clipping/contrast/type checks.`)
  process.exit(target ? 0 : 2)
}

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('measure-artifact: Playwright is not installed.\n  npm i -D playwright\n  npx playwright install chromium')
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
for (const width of viewports) {
  await page.setViewportSize({ width, height: 900 })
  await page.waitForTimeout(150)
  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true })
    await page.screenshot({ path: path.join(shotsDir, `artifact-${width}.png`), fullPage: true })
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
      while (p && p !== document.documentElement) { chain.push(p); p = p.parentElement }
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

    return {
      vw,
      scrollWidth: document.documentElement.scrollWidth,
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
  results.push({ width, ...measure })
}

await browser.close()

const blocking =
  results.some((r) => r.clippedCount > 0 || r.contrastCount > 0) ||
  consoleErrors.length > 0 || pageErrors.length > 0

if (json) {
  console.log(JSON.stringify({ url, viewports, results, consoleErrors, pageErrors, requests, blocking }, null, 2))
} else {
  console.log(`measure-artifact: ${target}`)
  console.log(`console errors: ${consoleErrors.length + pageErrors.length}, external requests: ${requests.length}`)
  for (const r of results) {
    const clip = r.clippedCount ? `CLIPPED ${r.clippedCount}` : 'no clipped content'
    const con = r.contrastCount ? `contrast failures ${r.contrastCount}` : 'contrast ok'
    console.log(`${String(r.width).padStart(4)}px  scrollWidth=${r.scrollWidth}  ${clip}  ${con}  typeSizes=${r.typeSizeCount}  tabStops=${r.tabStops}  odHooks=${r.odHooks}`)
    for (const c of r.clipped.slice(0, 4)) console.log(`      clip: <${c.tag.toLowerCase()} class="${c.cls}"> ${c.left}..${c.right}`)
    for (const c of r.contrast.slice(0, 4)) console.log(`      contrast ${c.ratio}:1 (need ${c.required}) ${c.size}px "${c.text}"`)
    if (r.tiny.length) console.log(`      text <11px: ${r.tiny.map((t) => `${t.size}px ${t.tag.toLowerCase()}.${t.cls}`).join(', ')}`)
  }
  if (consoleErrors.length) console.log('console:', consoleErrors.slice(0, 5))
  if (pageErrors.length) console.log('pageerrors:', pageErrors.slice(0, 5))
  console.log(blocking ? 'measure-artifact: findings present' : 'measure-artifact: no blocking findings')
}

process.exit(strict && blocking ? 1 : 0)
