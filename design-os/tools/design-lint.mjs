#!/usr/bin/env node
/**
 * design-lint — static checks for HTML design artifacts.
 *
 * A harness-agnostic implementation of mechanical design-lint rules plus the
 * craft rules in this kit. It catches patterns that are cheap to detect and
 * expensive to miss.
 * It does NOT judge hierarchy, taste, flow, contrast in rendered pixels, or
 * responsive behavior. Use the critique protocol for those.
 *
 * Usage:
 *   node design-lint.mjs [--json] [--strict] [--quiet] <file...>
 *
 * Exit codes:
 *   0  no blocking findings
 *   1  P0 findings (or P0+P1 with --strict)
 *   2  usage/read error
 */
import fs from 'node:fs'
import path from 'node:path'

const INDIGO_HEXES = ['#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#8b5cf6', '#7c3aed', '#a855f7']
const PURPLE_GRADIENT_HEXES = [...INDIGO_HEXES, '#c026d3', '#d946ef', '#e879f9', '#a21caf', '#9333ea']
const PLACEHOLDER_CDNS = ['unsplash.com', 'placehold.co', 'placekitten.com', 'picsum.photos', 'loremflickr.com']
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u

const args = process.argv.slice(2)
const json = args.includes('--json')
const strict = args.includes('--strict')
const quiet = args.includes('--quiet')
const files = args.filter((a) => !a.startsWith('--'))

if (!files.length || args.includes('--help') || args.includes('-h')) {
  console.log(`design-lint — static checks for HTML design artifacts

Usage: node design-lint.mjs [--json] [--strict] [--quiet] <file...>

  --json     machine-readable output
  --strict   fail on P0 and P1 (default: fail on P0 only)
  --quiet    only print the summary

Checks are heuristics. Read the artifact and run a critique as well.`)
  process.exit(files.length ? 0 : 2)
}

function lineOf(src, index) {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++
  return line
}

function snippet(src, index, max = 120) {
  const start = Math.max(0, src.lastIndexOf('\n', index) + 1)
  const end = src.indexOf('\n', index)
  const line = src.slice(start, end === -1 ? src.length : end).trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

function stripTokenDeclarations(src) {
  // Blank out CSS custom-property declarations anywhere in a declaration block
  // so a declared brand indigo token is not flagged as a hardcoded default.
  // The replacement keeps the same length (spaces) so match indices still map
  // to the original file for line numbers and snippets.
  return src.replace(/--[\w-]+\s*:\s*[^;{}]+;/g, (m) => ' '.repeat(m.length))
}

function cssRules(src) {
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    if (selector.startsWith('@') || selector.length > 200) continue
    rules.push({ selector, body: m[2], index: m.index })
  }
  return rules
}

function lintHtml(raw, file) {
  const findings = []
  const add = (severity, id, index, message, fix) =>
    findings.push({ severity, id, line: lineOf(raw, index), file, message, fix, snippet: snippet(raw, index) })

  const noTokens = stripTokenDeclarations(raw)

  // ── P0-1: violet / purple gradients ──────────────────────────────────────
  const gradientRe = /(linear|radial|conic)-gradient\([^)]*\)/gi
  let gm
  let purpleFound = false
  while ((gm = gradientRe.exec(raw))) {
    const body = gm[0].toLowerCase()
    const hit = PURPLE_GRADIENT_HEXES.find((h) => body.includes(h)) || (/\b(purple|violet|fuchsia)\b/.test(body) ? 'keyword' : null)
    if (hit) {
      purpleFound = true
      add('P0', 'purple-gradient', gm.index,
        `Violet/purple gradient (${hit}). This is the most reliable AI-design tell.`,
        'Replace with a flat surface token or a single accent at one intensity. A gradient must separate a hierarchy, not decorate a hero.')
      break
    }
  }

  // ── P0-2: blue→cyan "trust" gradient ─────────────────────────────────────
  gradientRe.lastIndex = 0
  let trustFound = false
  while ((gm = gradientRe.exec(raw))) {
    const body = gm[0].toLowerCase()
    const blue = /#(3b82f6|0ea5e9|06b6d4|0284c7|2563eb|1d4ed8)|\b(blue|sky|cyan)\b/.test(body)
    const cyan = /#(06b6d4|22d3ee|2dd4bf|0ea5e9)|\b(cyan|teal)\b/.test(body)
    if (blue && cyan && !purpleFound) {
      trustFound = true
      add('P0', 'trust-gradient', gm.index,
        'Blue→cyan two-stop "trust" gradient. SaaS hero cliché.',
        'Use a flat surface plus hierarchy. If a gradient is required, make it a single brand accent and justify it.')
      break
    }
  }

  // ── P0-3: hardcoded default indigo ───────────────────────────────────────
  for (const hex of INDIGO_HEXES) {
    const re = new RegExp(hex.replace('#', '\\#'), 'i')
    const m = re.exec(noTokens)
    if (m) {
      add('P0', 'ai-default-indigo', m.index,
        `Hardcoded default LLM accent ${hex}.`,
        'Use var(--accent) from the brand system. If indigo is the brand, declare it as a token so it reads as intentional.')
      break
    }
  }

  // ── P0-4: emoji used as UI icon ──────────────────────────────────────────
  const emojiBlocks = [
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    /<button[^>]*>([\s\S]*?)<\/button>/gi,
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    /class=["'][^"']*icon[^"']*["'][^>]*>([\s\S]*?)<\//gi,
  ]
  for (const re of emojiBlocks) {
    let m
    while ((m = re.exec(raw))) {
      const em = EMOJI_RE.exec(m[1] || '')
      if (em) {
        add('P0', 'emoji-icon', m.index,
          `Emoji "${em[0]}" used as a UI icon.`,
          'Use a monoline SVG icon at 1.6–1.8px stroke with currentColor, or a bundled icon set.')
        break
      }
    }
  }

  // ── P0-5: rounded card with a colored left-border accent ─────────────────
  for (const rule of cssRules(raw)) {
    if (/border-left\s*:/i.test(rule.body) && /border-radius\s*:/i.test(rule.body)) {
      add('P0', 'left-accent-card', rule.index,
        `Rounded card with a left-border accent (${rule.selector.slice(0, 60)}). The canonical AI dashboard tile.`,
        'Drop the radius or the left border. Use one surface treatment, not two competing edges.')
      break
    }
  }

  // ── P0-6: invented metrics ───────────────────────────────────────────────
  const metricPatterns = [
    /\b\d+(?:\.\d+)?\s*[x×]\s*(?:faster|more|better|cheaper|higher|lower)\b/gi,
    /\b99\.9+\s*%\s*(?:uptime|reliability|accuracy)\b/gi,
    /\b(?:trusted by|used by)\s+\d{1,3}(?:,\d{3})+\+?\s+(?:teams|companies|customers|brands)\b/gi,
  ]
  for (const re of metricPatterns) {
    const m = re.exec(raw)
    if (m) {
      add('P0', 'invented-metric', m.index,
        `Suspected invented metric: "${m[0]}".`,
        'Use a real source, or a labelled placeholder. Never ship a number the brief did not supply.')
      break
    }
  }

  // ── P0-7: filler copy ────────────────────────────────────────────────────
  const filler = /(lorem ipsum|placeholder text|sample content|feature one\b|feature two\b|feature three\b|your headline here|your text here)/i.exec(raw)
  if (filler) {
    add('P0', 'filler-copy', filler.index,
      `Filler copy detected: "${filler[0]}".`,
      'Replace with real, brief-derived copy or a clearly labelled placeholder slot. An empty section is a composition problem.')
  }

  // ── P0-8: scrollIntoView in an iframe artifact ───────────────────────────
  const siv = raw.indexOf('scrollIntoView')
  if (siv !== -1) {
    add('P0', 'scroll-into-view', siv,
      'Element.scrollIntoView() detected. It can yank the host page when the artifact is in an iframe.',
      'Use scrollTo on the artifact container, or scroll the specific element with a bounded container.')
  }

  // ── P1: display face uses a default sans ─────────────────────────────────
  for (const rule of cssRules(raw)) {
    if (!/(^|,)\s*(h1|h2|h3|\.display|\.headline)\b/i.test(rule.selector)) continue
    if (/font-family\s*:\s*[^;]*(Inter|Roboto|system-ui|^\s*sans-serif)/i.test(rule.body)) {
      add('P1', 'sans-display', rule.index,
        `Heading rule "${rule.selector.slice(0, 60)}" uses a default sans as the display face.`,
        'Use the brand display face, or declare an intentional first choice. Do not let system-ui be the visual idea.')
      break
    }
  }

  // ── P1: declared weight above the loaded face's maximum ──────────────────
  {
    let faceMax = 0
    const faceRe = /@font-face\s*\{([^}]*)\}/gi
    let fm
    while ((fm = faceRe.exec(raw))) {
      const wm = /font-weight\s*:\s*(\d{2,4})(?:\s+(\d{2,4}))?/i.exec(fm[1])
      if (wm) faceMax = Math.max(faceMax, +(wm[2] || wm[1]))
    }
    if (faceMax) {
      for (const rule of cssRules(raw)) {
        const wm = /font-weight\s*:\s*(\d{3})/i.exec(rule.body)
        if (wm && +wm[1] > faceMax) {
          add('P1', 'font-weight-clamp', rule.index,
            `font-weight ${wm[1]} exceeds the loaded face's maximum (${faceMax}); it will render at ${faceMax}.`,
            `Declare ${faceMax}, or load a face that includes ${wm[1]} so the design is not silently clamped.`)
          break
        }
      }
    }
  }

  // ── P1: ALL CAPS without tracking ────────────────────────────────────────
  // Applies to uppercase labels/body, not to display headings: large uppercase
  // display type may deliberately use tight negative tracking (editorial rule).
  for (const rule of cssRules(raw)) {
    if (!/text-transform\s*:\s*uppercase/i.test(rule.body)) continue
    const sizeMatch = /font-size\s*:\s*([\d.]+)px/i.exec(rule.body)
    if (sizeMatch && parseFloat(sizeMatch[1]) >= 20) continue
    if (/(^|,)\s*(h1|h2|h3|\.display|\.title|\.headline)\b/i.test(rule.selector)) continue
    const ls = /letter-spacing\s*:\s*([^;]+)/i.exec(rule.body)
    let track = 0
    if (ls) {
      const v = ls[1].trim()
      if (v.endsWith('em')) track = parseFloat(v)
      else if (v.endsWith('px')) track = parseFloat(v) / 16
    }
    if (track < 0.06) {
      add('P1', 'all-caps-no-tracking', rule.index,
        `Uppercase rule "${rule.selector.slice(0, 60)}" has tracking ${ls ? ls[1].trim() : '0'} (<0.06em).`,
        'ALL CAPS needs positive tracking between 0.06em and 0.1em.')
      break
    }
  }

  // ── P1: external placeholder images ──────────────────────────────────────
  for (const host of PLACEHOLDER_CDNS) {
    const i = raw.indexOf(host)
    if (i !== -1) {
      add('P1', 'external-image', i,
        `External placeholder image host "${host}". Fragile and obvious once it 404s.`,
        'Use a local asset, a generated image, or a clearly labelled placeholder slot. Never hotlink a placeholder CDN in a delivered artifact.')
      break
    }
  }

  // ── P1: raw hex outside token declarations ──────────────────────────────
  const hexMatches = [...noTokens.matchAll(/#[0-9a-f]{3,8}\b/gi)]
  if (hexMatches.length > 12) {
    add('P1', 'raw-hex', hexMatches[0].index,
      `${hexMatches.length} raw hex values found outside custom-property declarations.`,
      'Move repeated colors into tokens. A few literal values are fine; a palette is not.')
  }

  // ── P1: accent overuse ──────────────────────────────────────────────────
  const accentUses = (raw.match(/var\(--accent\b/g) || []).length
  if (accentUses > 6) {
    add('P1', 'accent-overuse', raw.indexOf('var(--accent'),
      `var(--accent) used ${accentUses} times. The design cap is two visible uses per screen.`,
      'Ration the accent: one primary CTA and one accent mark. Links/focus rings count too.')
  }

  // ── P1: transition: all ─────────────────────────────────────────────────
  const ta = /transition\s*:\s*all\b/i.exec(raw)
  if (ta) {
    add('P1', 'transition-all', ta.index,
      '`transition: all` animates layout and paint properties you did not intend.',
      'Name the properties: transform, opacity, box-shadow, color.')
  }

  // ── P1: outline removed ─────────────────────────────────────────────────
  const on = /outline\s*:\s*(none|0)\b/i.exec(raw)
  if (on && !/:focus-visible|:focus\b/.test(raw)) {
    add('P1', 'outline-none', on.index,
      '`outline: none` without a visible focus replacement.',
      'Provide a :focus-visible style with at least 2px and 3:1 contrast.')
  }

  // ── P1: no focus-visible at all ─────────────────────────────────────────
  const interactive = /<(button|a\s|input|select|textarea)\b/i.test(raw)
  if (interactive && !/:focus-visible/.test(raw)) {
    add('P1', 'missing-focus-visible', raw.search(/<(button|a\s|input|select|textarea)\b/i),
      'Interactive elements found, but no :focus-visible rule.',
      'Add a visible focus style for every interactive element.')
  }

  // ── P1: animation without reduced motion ────────────────────────────────
  if ((/transition\s*:|animation\s*:|@keyframes/i.test(raw)) && !/prefers-reduced-motion/.test(raw)) {
    add('P1', 'missing-reduced-motion', raw.search(/transition\s*:|animation\s*:|@keyframes/i),
      'Motion present, but no prefers-reduced-motion guard.',
      'Add a reduce block that removes translate/scale/parallax; keep opacity/color changes.')
  }

  // ── P1: images missing alt ──────────────────────────────────────────────
  const imgRe = /<img\b[^>]*>/gi
  let im
  while ((im = imgRe.exec(raw))) {
    if (!/\balt\s*=/.test(im[0])) {
      add('P1', 'img-missing-alt', im.index, 'Image without an alt attribute.',
        'Add alt text for meaningful images, alt="" for decorative ones.')
      break
    }
  }

  // ── P2: href="#" placeholders ───────────────────────────────────────────
  const hashLinks = (raw.match(/href\s*=\s*["']#["']/gi) || []).length
  if (hashLinks > 0) {
    add('P2', 'hash-link', raw.indexOf('href="#"'),
      `${hashLinks} href="#" placeholder link(s).`, 'Use a real destination or a button with behavior.')
  }

  // ── P2: no tokens declared ──────────────────────────────────────────────
  if (!/:root\s*\{[^}]*--[a-z]/i.test(raw) && !/--[a-z-]+\s*:/.test(raw)) {
    add('P2', 'no-tokens', 0,
      'No CSS custom properties found.', 'Declare a token layer before styling components.')
  }

  // ── P2: missing inspect hooks ───────────────────────────────────────────
  const sections = (raw.match(/<section\b/gi) || []).length
  const odHooks = (raw.match(/data-od-id\s*=/gi) || []).length
  if (sections > 0 && odHooks === 0) {
    add('P2', 'missing-inspect-hooks', raw.search(/<section\b/i),
      `<section> elements found, but no data-od-id attributes.`,
      'Add data-od-id to meaningful regions/screens so review comments and inspect mode can target them. A stable id alone is not the contract.')
  }

  // ── P2: page-level overflow clip can hide broken content ────────────────
  if (/(html|body)[^{}]*\{[^}]*overflow(-x)?\s*:\s*(clip|hidden)/i.test(raw)) {
    add('P2', 'overflow-clip', raw.search(/overflow(-x)?\s*:\s*(clip|hidden)/i),
      'Page-level overflow clipping. It can hide content that is actually wider than the viewport.',
      'Do not use overflow clip to make an overflow bug disappear. Check every element against the viewport with a browser, then fix the layout.')
  }

  return findings
}

let all = []
let hadError = false
for (const file of files) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    console.error(`design-lint: cannot read ${file}: ${e.message}`)
    hadError = true
    continue
  }
  if (!/\.(html?|svg)$/i.test(file)) {
    continue
  }
  const findings = lintHtml(raw, path.resolve(file))
  all = all.concat(findings)
}

const order = { P0: 0, P1: 1, P2: 2 }
all.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)
const counts = {
  P0: all.filter((f) => f.severity === 'P0').length,
  P1: all.filter((f) => f.severity === 'P1').length,
  P2: all.filter((f) => f.severity === 'P2').length,
}

if (json) {
  console.log(JSON.stringify({ files, counts, findings: all }, null, 2))
} else if (!quiet) {
  for (const f of all) {
    console.log(`${f.severity}  ${f.id}  ${path.relative(process.cwd(), f.file)}:${f.line}`)
    console.log(`     ${f.message}`)
    console.log(`     fix: ${f.fix}`)
    if (f.snippet) console.log(`     > ${f.snippet}`)
  }
  if (!all.length) console.log('design-lint: no findings')
}
if (!json) {
  console.log(`\ndesign-lint: ${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2 across ${files.length} file(s)`)
}

if (hadError) process.exit(2)
if (counts.P0 > 0) process.exit(1)
if (strict && counts.P1 > 0) process.exit(1)
process.exit(0)
