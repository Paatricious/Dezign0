#!/usr/bin/env node
/**
 * content-lint — static content and AI-tell checks for HTML design artifacts.
 *
 * design-lint checks the mechanics of the markup. content-lint checks whether
 * the words, claims, identities and imagery would survive a design review:
 * generated-slop tells, marketing filler, unlabelled metrics, placeholder
 * people and links, and the quality of error/empty states.
 *
 * Render-independent and dependency-free. It reads source only. It does not
 * judge hierarchy, composition, contrast or whether a flow works — use the
 * critique protocol and measure-artifact for those.
 *
 * Missing alt attributes are deliberately NOT reported here: design-lint has a
 * static img-alt rule and measure-artifact --a11y is authoritative for the
 * rendered/a11y view. This tool reports alt text that exists but is useless
 * ("image", a filename, a generic noun).
 *
 * Usage:
 *   node content-lint.mjs [--json] [--strict] [--quiet] [--self-test] <file...>
 *
 * Exit codes:
 *   0  no blocking findings
 *   1  P0 findings (or P0+P1 with --strict), or a failed self-test
 *   2  usage/read error, or self-test fixtures unavailable
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const json = args.includes('--json')
const strict = args.includes('--strict')
const quiet = args.includes('--quiet')
const selfTest = args.includes('--self-test')
const files = args.filter((a) => !a.startsWith('--'))

if (args.includes('--help') || args.includes('-h')) {
  console.log(`content-lint — content and AI-tell checks for HTML design artifacts

Usage: node content-lint.mjs [--json] [--strict] [--quiet] <file...>
       node content-lint.mjs --self-test

  --json       machine-readable output
  --strict     fail on P0 and P1 (default: fail on P0 only)
  --quiet      only print the summary
  --self-test  run the fixtures in scripts/fixtures/content/ and compare with expected.json

Checks (all heuristic, all static):
  AI tells      cream/serif/terracotta cluster, near-black + acid accent,
                uniform rounded card kit, ALL-CAPS eyebrows, middot meta strings,
                monospace micro-labels, arrows on every CTA, em-dash density,
                generic marketing phrases.
  Copy          lorem/filler, unlabelled fake metrics, long sentences, vague and
                inconsistent CTAs, error/empty-state quality, TODO/TBD.
  Realism       placeholder people/companies/emails/phones, placeholder image
                sources, useless alt text, placeholder links.

Delegation: missing alt attributes belong to design-lint (img-alt) and
measure-artifact --a11y; render, contrast and layout checks are out of scope.

Checks are heuristics with documented guards. Read the artifact, then run a
critique. Data-no-lint on any element excludes it from text checks.`)
  process.exit(0)
}

if (!files.length && !selfTest) {
  console.error('content-lint: no input files. Try: node content-lint.mjs --help')
  process.exit(2)
}

// ── shared helpers (same conventions as design-lint) ──────────────────────
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polygon',
  'polyline', 'ellipse', 'stop', 'use', 'image',
])

// Text inside these is code/sample material, not interface copy.
const SKIP_TEXT_TAGS = new Set([
  'head', 'script', 'style', 'template', 'code', 'pre', 'kbd', 'samp', 'textarea', 'svg', 'math',
])

function lineOf(src, index) {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++
  return line
}

function snippet(src, index, max = 120) {
  const start = Math.max(0, src.lastIndexOf('\n', index) + 1)
  const end = src.indexOf('\n', index)
  let line = src.slice(start, end === -1 ? src.length : end).trim()
  if (!line) line = src.slice(index, index + 160).replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

/**
 * Mark every character that is visible prose.
 * Markup, comments, and the contents of code/pre/script/style/template/svg/
 * textarea/kbd/samp are masked. Masked characters become spaces, newlines are
 * preserved so line numbers still map to the original file.
 */
function maskProse(raw) {
  const mask = new Array(raw.length).fill(true)
  const blank = (a, b) => {
    for (let i = Math.max(0, a); i < Math.min(mask.length, b); i++) if (raw[i] !== '\n') mask[i] = false
  }
  for (const m of raw.matchAll(/<!--[\s\S]*?-->/g)) blank(m.index, m.index + m[0].length)

  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  const stack = []
  let m
  while ((m = tagRe.exec(raw))) {
    const start = m.index
    const end = tagRe.lastIndex
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const attrs = m[3] || ''
    const selfClosing = m[4] === '/' || VOID_TAGS.has(tag)
    blank(start, end)
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const entry = stack.splice(i, 1)[0]
          if (entry.skip) blank(entry.start, end)
          break
        }
      }
      continue
    }
    if (selfClosing) continue
    const skip = SKIP_TEXT_TAGS.has(tag) || /(?:^|\s)data-no-lint(?:\s|=|$)/.test(attrs)
    stack.push({ tag, start, skip })
  }
  for (const entry of stack) if (entry.skip) blank(entry.start, raw.length)

  return mask
}

function proseOf(raw, mask) {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    out += mask[i] ? c : c === '\n' ? '\n' : ' '
  }
  return out
}

function attr(attrs, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')
  const m = re.exec(attrs || '')
  return m ? m[1] ?? m[2] ?? m[3] : null
}

function attrList(attrs, name) {
  const v = attr(attrs, name)
  return v ? v.split(/\s+/).filter(Boolean) : []
}

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&middot;/gi, '·')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectTags(src) {
  const tags = []
  const re = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let m
  while ((m = re.exec(src))) {
    const tag = m[1].toLowerCase()
    if (tag === '!doctype') continue
    tags.push({ tag, attrs: m[2] || '', start: m.index, end: re.lastIndex, self: m[3] === '/' })
  }
  return tags
}

/** Index of the matching close tag, or the end of a self-closing tag. */
function findClose(src, openIndex, tag) {
  const re = new RegExp('<(\\/?)' + tag + '\\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*?)(\\/?)>', 'gi')
  re.lastIndex = openIndex
  const first = re.exec(src)
  if (!first) return -1
  if (VOID_TAGS.has(tag) || first[3] === '/') return first.index + first[0].length
  let depth = 1
  let m
  while ((m = re.exec(src))) {
    if (m[3] === '/') continue
    if (m[1] === '/') {
      depth--
      if (depth === 0) return m.index
    } else {
      depth++
    }
  }
  return -1
}

function innerOf(src, openIndex, closeIndex) {
  if (closeIndex === -1) return { text: '', html: '' }
  const html = src.slice(openIndex, closeIndex)
  return { text: stripTags(html), html }
}

function styleBlocks(src) {
  const out = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let m
  while ((m = re.exec(src))) out.push({ text: m[1], base: m.index + m[0].indexOf(m[1]) })
  const inlineRe = /<[a-zA-Z][^>]*?\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  while ((m = inlineRe.exec(src))) {
    const value = m[1] ?? m[2] ?? ''
    const quoteIndex = m[0].indexOf(value) - 1
    out.push({ text: value, base: m.index + Math.max(0, quoteIndex) + 1, inline: true })
  }
  return out
}

function cssRules(text, base) {
  const rules = []
  // CSS comments can sit between rules; blank them length-preserving so a
  // comment line is never read as a selector.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    if (!selector || selector.startsWith('@') || selector.length > 300) continue
    const bodyStart = base + m.index + m[0].indexOf('{') + 1
    const lead = m[1].length - m[1].trimStart().length
    rules.push({ selector, body: m[2], index: base + m.index + lead, bodyIndex: bodyStart })
  }
  return rules
}

function declarationsOf(body, baseIndex) {
  const decls = []
  let cursor = 0
  for (const part of body.split(';')) {
    const at = body.indexOf(part, cursor)
    cursor = at + part.length
    const colon = part.indexOf(':')
    if (colon < 0) continue
    decls.push({
      prop: part.slice(0, colon).trim().toLowerCase(),
      value: part.slice(colon + 1).trim(),
      index: baseIndex + Math.max(0, at),
    })
  }
  return decls
}

function hexesIn(value) {
  const out = []
  for (const m of String(value).matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    let h = m[1].toLowerCase()
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length === 8) h = h.slice(0, 6)
    if (h.length === 6) out.push(h)
  }
  return out
}

function hexToRgb(hex) {
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

function nearHex(hex, targets, tolerance) {
  const [r, g, b] = hexToRgb(hex)
  for (const target of targets) {
    const [tr, tg, tb] = hexToRgb(target)
    if (Math.abs(r - tr) <= tolerance && Math.abs(g - tg) <= tolerance && Math.abs(b - tb) <= tolerance) {
      return target
    }
  }
  return null
}

// ── calibration lists ─────────────────────────────────────────────────────
// Warm cream + terracotta are the cluster Anthropic's frontend-design skill
// documents as a generated-design default. They are legitimate for some
// briefs; the finding fires only when the cluster appears together.
const CREAM_BACKGROUNDS = ['f4f1ea', 'f5f1e8', 'f4f0e6', 'faf7f0', 'f1ece1', 'efe9dd', 'f6f2e9']
const TERRACOTTA_ACCENTS = ['d97757', 'c96a46', 'e07a5f', 'c65d3b', 'e2725a', 'cc6b4f', 'b85c3e', 'd2694a']
const NEAR_BLACKS = ['0b0b0b', '111111', '0a0a0a', '121212', '0e0e0e', '101010', '0f0f0f', '141414']
const ACID_ACCENTS = ['ccff00', 'd4ff00', 'b6ff00', 'a3e635', '84cc16', '7fff00', '9dff00', 'b4ff39']
const VERMILION_ACCENTS = ['ff4d00', 'ff3b00', 'ff4500', 'e63e00', 'f04400']
const SERIF_FACES = /serif|georgia|times new roman|palatino|charter|iowan|garamond|baskerville|playfair|lora\b|merriweather|source serif|noto serif|pt serif|crimson|domine|fraunces|instrument serif|newsreader|libre caslon/i

const PLACEHOLDER_IMAGE_SRC = /(picsum|placehold|placekitten|via\.placeholder|placeimg|loremflickr|unsplash\.com|dummyimage|fakeimg|placeimg|placeholder\.com)/i
const GENERIC_ALT = /^(?:\s*(?:image|photo|picture|img|screenshot|graphic|icon|banner|hero|illustration|logo|thumbnail|avatar)\s*\.?\s*)$/i
const FILENAME_ALT = /\.(?:png|jpe?g|gif|svg|webp|avif)$/i
const CAMERA_ALT = /^(?:img|dsc|dscn|screenshot|screen shot|untitled|photo|image)[-_ ]?\d+/i

const IDENTITY_PATTERNS = [
  { re: /\b(?:Acme(?:\s+(?:Corp(?:oration)?|Co|Inc|Labs))?|Foo\s*Bar|John\s+(?:Doe|Smith)|Jane\s+(?:Doe|Smith)|Company\s+Name|Your\s+Company(?:\s+Name)?|Test\s+User)\b/i, what: 'person or company name' },
  { re: /[\w.+-]+@example\.(?:com|org|net)\b/i, what: 'example.com email address' },
  { re: /\b555-01\d{2}\b/, what: '555-01xx phone number' },
  { re: /\b123\s+Main\s+St(?:reet)?\b/i, what: 'street address' },
]

const METRIC_PATTERNS = [
  { re: /\b\d+(?:\.\d+)?\s*[x×]\s*(?:faster|more|better|cheaper|higher|lower|quicker|bigger)\b/gi, what: 'multiplier claim' },
  { re: /\b\d{2,3}(?:\.\d+)?\s*%\s*(?:uptime|faster|increase|improvement|conversion|accuracy|retention|growth|reduction|savings|less|more)\b/gi, what: 'percentage claim' },
  { re: /\b(?:trusted|used|chosen)\s+by\s+\d[\d,.]*\s*\+?\s*(?:teams|companies|customers|users|businesses|brands|developers)\b/gi, what: 'social-proof count' },
  { re: /\b\d[\d,.]{2,}\+?\s*(?:happy\s+)?(?:customers|users|teams|companies|businesses|developers|downloads)\b/gi, what: 'aggregate user count' },
  { re: /\b(?:10x|100x|99\.9{1,}\s*%|100\s*%\s+uptime)\b/gi, what: 'rounded marketing statistic' },
]
const METRIC_LABEL = /\b(?:example|sample|illustrative|placeholder|mock|demo|dummy|simulated|synthetic|for illustration|target|goal|benchmark|measured|tested|study|survey|source|since\s+20\d\d|n\s*=\s*\d+|\d+\s+(?:users|participants|sessions|runs|respondents))\b/i

const GENERIC_PHRASES = [
  { re: /\bseamlessly\b/gi, guard: null },
  {
    re: /\belevat(?:e|es|ing|ed)\b/gi,
    guard: (after) => /^\s+(?:(?:your|the)\s+)?(?:brand|design|experience|story|product|workflow|ui|website|interface|content|presence|standard|customer)/i.test(after),
  },
  {
    re: /\bunlock(?:s|ing|ed)?\b/gi,
    guard: (after) => /^\s+(?:the|your)\s+(?:power|potential|growth|value|insights|productivity|possibilities|next level|full potential|revenue|future)/i.test(after),
  },
  {
    re: /\bempower(?:s|ing|ed)?\b/gi,
    guard: (after) => /^\s+(?:your|their)\s+(?:team|users|customers|business|workforce|people|organization|organisation)/i.test(after),
  },
  { re: /\b(?:unleash(?:es|ing|ed)?|revolutioniz(?:e|es|ing|ed)|supercharg(?:e|es|ing|ed)|game-changer|game-changing|next-gen|cutting-edge)\b/gi, guard: null },
  { re: /\btransform\s+(?:your|the)\s+(?:business|workflow|workflows|team|brand|product|experience)\b/gi, guard: null },
  { re: /\bin today's (?:fast-paced|digital|competitive) world\b/gi, guard: null },
  { re: /\bwe(?:'re| are) (?:excited|thrilled) to (?:announce|share|introduce)\b/gi, guard: null },
  { re: /\btake (?:it|your \w+) to the next level\b/gi, guard: null },
  {
    re: /\beffortless(?:ly)?\b/gi,
    guard: (after) => /^\s+(?:experience|design|workflow|way|setup|onboarding|collaboration)/i.test(after),
  },
]

const VAGUE_CTAS = [/^(?:submit|click here|click|go|send|ok|okay|yes|no)$/i]
const GENERIC_CTAS = [/^(?:learn more|read more|more|explore|discover|see more|find out more)$/i]
const CTA_FAMILIES = [
  { id: 'start', re: /^(?:get started|get started free|start free|start for free|start now|sign up|signup|create account|create an account|try it free|try free|start your free trial|start trial|join now)$/i },
  { id: 'save', re: /^(?:save|save changes|save all|save draft|save and continue)$/i },
  { id: 'continue', re: /^(?:continue|next|proceed|proceed to checkout)$/i },
]

const ERROR_VAGUE = /\b(?:something went wrong|an error (?:occurred|happened)|oops|there was a problem|error!|unknown error|unexpected error)\b/i
const ERROR_RECOVERY = /\b(?:try again|retry|reload|refresh|check (?:your|the)|contact|review|fix|restore|sign in again|go back|wait a moment|contact support)\b/i
const EMPTY_THIN = /^(?:no data|no results|no items|nothing here|nothing yet|empty|no records|no content)\.?$/i

// ── main lint ────────────────────────────────────────────────────────────
function lintContent(raw, file) {
  const findings = []
  const add = (severity, id, index, message, fix) =>
    findings.push({
      severity, id, line: lineOf(raw, index), file,
      message, fix, snippet: snippet(raw, index),
    })

  const mask = maskProse(raw)
  const text = proseOf(raw, mask)
  const tags = collectTags(raw)

  const rules = []
  const inlineDecls = []
  for (const block of styleBlocks(raw)) {
    if (block.inline) {
      for (const d of declarationsOf(block.text, block.base)) inlineDecls.push(d)
    } else {
      for (const r of cssRules(block.text, block.base)) rules.push(r)
    }
  }
  const decls = []
  for (const r of rules) for (const d of declarationsOf(r.body, r.bodyIndex)) decls.push(d)
  decls.push(...inlineDecls)


  // ── P0: lorem ipsum ─────────────────────────────────────────────────────
  const lorem = /(?:lorem ipsum|dolor sit amet|consectetur adipiscing)/i.exec(text)
  if (lorem) {
    add('P0', 'copy-lorem', lorem.index,
      'Lorem ipsum in visible copy. The artifact is not finished.',
      'Replace with real, brief-derived copy. If a section has no copy yet, compose an honest empty state rather than shipping latin.')
  }

  // ── P0: placeholder filler ──────────────────────────────────────────────
  const filler = /(?:\bfeature\s+(?:one|two|three|1|2|3)\b|\bplaceholder\s+(?:text|copy|content)\b|\byour\s+(?:text|copy|content|headline)\s+here\b|\binsert\s+(?:copy|text|content)\b|\bsample\s+(?:text|copy)\b|\[insert[^\]]*\])/i.exec(text)
  if (filler) {
    add('P0', 'copy-filler', filler.index,
      `Placeholder filler copy: "${filler[0]}".`,
      'Write the actual sentence, or label the slot explicitly ("Copy pending: one sentence on billing"). Never ship template tokens.')
  }

  // ── P0: unlabelled fake metrics ─────────────────────────────────────────
  let metricHits = 0
  for (const pattern of METRIC_PATTERNS) {
    if (metricHits >= 3) break
    pattern.re.lastIndex = 0
    let m
    while ((m = pattern.re.exec(text)) && metricHits < 3) {
      const windowText = text.slice(Math.max(0, m.index - 90), m.index + m[0].length + 90)
      if (METRIC_LABEL.test(windowText)) continue
      add('P0', 'copy-fake-metric', m.index,
        `Unlabelled ${pattern.what}: "${m[0]}".`,
        'Replace with a measured number and its source ("42% fewer clicks, n=12, staging run") or label it as illustrative. An unsourced claim is a fake metric.')
      metricHits++
    }
  }

  // ── P1: cream + serif + terracotta cluster ──────────────────────────────
  const isBgDecl = (d) => /^background(?:-color)?$/.test(d.prop) || /^--[\w-]*(?:bg|background|surface|paper|canvas|base)[\w-]*$/.test(d.prop)
  const bgDecls = decls.filter(isBgDecl)
  const creamBgs = bgDecls.flatMap((d) => hexesIn(d.value).map((hex) => ({ hex, hit: nearHex(hex, CREAM_BACKGROUNDS, 10), decl: d })).filter((x) => x.hit))
  const fonts = decls.filter((d) => d.prop === 'font-family')
  const serif = fonts.find((d) => SERIF_FACES.test(d.value.replace(/sans-serif/gi, '')))
  const terracotta = decls.flatMap((d) => hexesIn(d.value).map((hex) => ({ hex, hit: nearHex(hex, TERRACOTTA_ACCENTS, 25), decl: d })).filter((x) => x.hit))
  if (creamBgs.length && serif && terracotta.length) {
    const c = creamBgs[0]
    add('P1', 'ai-cream-terracotta-serif', c.decl.index,
      `Generated-design cluster: cream background (#${c.hex}), serif display face (${serif.value.replace(/\s+/g, ' ').slice(0, 48)}) and terracotta accent (#${terracotta[0].hex}).`,
      'This trio is a documented default, not a choice for this brief. Keep one of the three and derive the other two from the subject: a different surface value, a face that carries the brand, or a non-terracotta accent. Document the exception if the brief asks for this look.')
  }

  // ── P1: near-black + acid accent ────────────────────────────────────────
  const nearBlack = bgDecls.flatMap((d) => hexesIn(d.value).map((hex) => ({ hex, hit: nearHex(hex, NEAR_BLACKS, 2), decl: d })).filter((x) => x.hit))
  const acid = decls.flatMap((d) => hexesIn(d.value).map((hex) => ({
    hex,
    hit: nearHex(hex, ACID_ACCENTS, 6) || nearHex(hex, VERMILION_ACCENTS, 8),
    decl: d,
  })).filter((x) => x.hit))
  if (nearBlack.length && acid.length) {
    add('P1', 'ai-near-black-acid', nearBlack[0].decl.index,
      `Generated-design cluster: near-black surface (#${nearBlack[0].hex}) with a single acid/vermilion accent (#${acid[0].hex}).`,
      'Dark surfaces are fine; the near-black-plus-acid pair is the default. Justify the accent against the product subject, or use a brand token with provenance. If the brief asks for this, say so in the artifact.')
  }

  // ── P2: uniform rounded card kit ────────────────────────────────────────
  // Resolve simple var(--token) references so a token-driven radius is still
  // measured. Without this, every well-tokenised design evades the check.
  const customProps = new Map()
  for (const d of decls) if (d.prop.startsWith('--')) customProps.set(d.prop, d.value)
  const resolveValue = (value, depth = 0) => {
    const v = String(value).trim()
    const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(v)
    if (ref && depth < 3 && customProps.has(ref[1])) return resolveValue(customProps.get(ref[1]), depth + 1)
    return v
  }
  const radiusPx = (value) => {
    const v = resolveValue(value)
    const n = parseFloat(v)
    if (!Number.isFinite(n)) return NaN
    if (/rem\b/i.test(v)) return n * 16
    if (/em\b/i.test(v)) return n * 16
    return n
  }
  const cardRules = rules.filter((r) => /(?:card|tile|panel|feature|pricing|testimonial|stat|kpi)/i.test(r.selector))
  const roundedCards = []
  for (const r of cardRules) {
    const ds = declarationsOf(r.body, r.bodyIndex)
    const radius = ds.find((d) => d.prop === 'border-radius')
    const shadow = ds.find((d) => d.prop === 'box-shadow' && /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.(?:0[5-9]|1\d?|2[0-5]?)\s*\)/i.test(d.value))
    if (!radius || !shadow) continue
    const px = radiusPx(radius.value)
    if (!(px >= 6 && px < 40)) continue
    roundedCards.push({ radius, shadow })
  }
  const uniqueRadii = new Set(roundedCards.map((c) => resolveValue(c.radius.value)))
  if (roundedCards.length >= 3 && uniqueRadii.size <= 2) {
    add('P2', 'ai-card-kit', roundedCards[2].radius.index,
      `Uniform rounded card kit: ${roundedCards.length} card-like rules share ${uniqueRadii.size === 1 ? 'one radius' : 'two radii'} and the same soft black shadow.`,
      'Differentiate hierarchy by size, padding or surface instead of repeating one radius plus one shadow. If a single radius token is deliberate, vary elevation between primary and secondary cards.')
  }

  // ── P2: ALL-CAPS eyebrow labels ─────────────────────────────────────────
  const eyebrowClass = /(?:eyebrow|kicker|overline|section-label|pre-title|suptitle)/i
  let eyebrowFound = false
  for (const t of tags) {
    const cls = ((attr(t.attrs, 'class') || '') + ' ' + (attr(t.attrs, 'id') || '')).trim()
    if (!eyebrowClass.test(cls)) continue
    const close = findClose(raw, t.start, t.tag)
    const label = innerOf(raw, t.end, close).text
    if (label && /[A-Z]{2}/.test(label) && label === label.toUpperCase() && label.length <= 48) {
      add('P2', 'ai-eyebrow-caps', t.start,
        `ALL-CAPS eyebrow label: "${label}".`,
        'Sentence case is the default for labels. If the caps are deliberate, give them tracking and a documented rule; do not use a tracked-out caps label above every heading.')
      eyebrowFound = true
      break
    }
  }
  if (!eyebrowFound) {
    for (const rule of rules) {
      if (!eyebrowClass.test(rule.selector)) continue
      if (!/text-transform\s*:\s*uppercase/i.test(rule.body)) continue
      // Tracked caps are a documented type rule, not the default-caps tell.
      const tracking = /letter-spacing\s*:\s*(-?[\d.]+)(em|rem|px)/i.exec(rule.body)
      const tracked = tracking && (tracking[2].toLowerCase() === 'px' ? parseFloat(tracking[1]) >= 1 : parseFloat(tracking[1]) >= 0.06)
      if (!tracked) {
        add('P2', 'ai-eyebrow-caps', rule.index,
          `CSS forces an ALL-CAPS eyebrow ("${rule.selector.slice(0, 60)}") without type tracking.`,
          'Prefer sentence case for labels. If caps are a deliberate system, add tracking and document the rule in DESIGN.md.')
        break
      }
    }
  }

  // ── P2: middot metadata strings ─────────────────────────────────────────
  const middotRe = /[^\n·]{1,60}\s·\s[^\n·]{1,80}/g
  // One middle dot is punctuation; two or more on a page is a metadata system.
  const middots = [...text.matchAll(middotRe)]
  const middotTotal = (text.match(/·/g) || []).length
  if (middots.length && middotTotal >= 2) {
    add('P2', 'ai-middot-meta', middots[0].index,
      `Metadata joined with middle dots: "${middots[0][0].trim().slice(0, 80)}".`,
      'If the string carries real information, give each part its own labelled element. If it is chrome, remove it.')
  }

  // ── P2: monospace micro-labels ──────────────────────────────────────────
  const microLabel = /(?:label|meta|kicker|tag|badge|eyebrow|chip|caption|byline)/i
  for (const rule of rules) {
    if (!microLabel.test(rule.selector)) continue
    const fam = /font-family\s*:\s*([^;}]+)/i.exec(rule.body)
    if (fam && /mono/i.test(fam[1])) {
      add('P2', 'ai-mono-micro', rule.index,
        `Monospace face on a micro-label ("${rule.selector.slice(0, 60)}").`,
        'Monospace is a technical affordance, not a default for labels. Use the body face with a weight/tracking change, or reserve mono for real code and IDs.')
      break
    }
  }
  for (const d of inlineDecls) {
    if (d.prop === 'font-family' && /mono/i.test(d.value)) {
      add('P2', 'ai-mono-micro', d.index,
        'Inline monospace on a small label.',
        'Prefer the body face for labels; keep monospace for code, tokens and IDs.')
      break
    }
  }

  // ── CTA collection (used by arrow / vague / consistency / casing) ───────
  const ctas = []
  for (const t of tags) {
    if (t.tag !== 'button' && t.tag !== 'a') continue
    if (t.self) continue
    const cls = attr(t.attrs, 'class') || ''
    if (t.tag === 'a' && !/btn|button|cta|primary|action/i.test(cls)) continue
    const close = findClose(raw, t.start, t.tag)
    const label = innerOf(raw, t.end, close).text
    if (!label || label.length > 80) continue
    ctas.push({ label, cls, index: t.start })
  }
  for (const t of tags) {
    if (t.tag !== 'input') continue
    const type = (attr(t.attrs, 'type') || '').toLowerCase()
    if (type !== 'submit' && type !== 'button') continue
    const label = attr(t.attrs, 'value')
    if (label) ctas.push({ label, cls: attr(t.attrs, 'class') || '', index: t.start })
  }

  // ── P2: arrow on every CTA ──────────────────────────────────────────────
  const arrowCtas = ctas.filter((c) => /(?:→|->|›|»)\s*$/.test(c.label))
  if (arrowCtas.length >= 2) {
    add('P2', 'ai-arrow-cta', arrowCtas[1].index,
      `${arrowCtas.length} of ${ctas.length} CTA labels end with an arrow.`,
      'An arrow is a template chrome signature when every action has one. Keep it for the single primary action, or remove it and let the verb carry the direction.')
  }

  // ── P1/P2: generic marketing phrases ────────────────────────────────────
  const phraseHits = []
  for (const pattern of GENERIC_PHRASES) {
    pattern.re.lastIndex = 0
    let m
    while ((m = pattern.re.exec(text))) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40)
      if (/^\s*\(/.test(after)) continue // function call, e.g. unlock()
      if (pattern.guard && !pattern.guard(after)) continue
      phraseHits.push({ phrase: m[0], index: m.index })
      break // one hit per phrase pattern is enough to prove the tell
    }
  }
  const phraseSeverity = phraseHits.length >= 3 ? 'P1' : 'P2'
  for (const hit of phraseHits.slice(0, 5)) {
    add(phraseSeverity, 'copy-generic-phrase', hit.index,
      `Generic marketing phrase: "${hit.phrase}".${phraseHits.length >= 3 ? ` ${phraseHits.length} distinct phrases cross the slop threshold.` : ''}`,
      'Say the concrete thing instead: what changes, for whom, by how much. If a phrase is the product name or a quoted claim, mark it data-no-lint.')
  }

  // ── P1: vague CTAs ──────────────────────────────────────────────────────
  let vagueCount = 0
  for (const c of ctas) {
    const label = c.label.replace(/\s+/g, ' ').trim()
    if (!VAGUE_CTAS.some((re) => re.test(label))) continue
    if (vagueCount >= 3) break
    add('P1', 'copy-vague-cta', c.index,
      `Vague call to action: "${label}".`,
      'Name the action and the object: "Save changes", "Create invoice", "Send invite". "Submit" tells the user nothing about what happens next.')
    vagueCount++
  }

  // ── P2: generic secondary CTAs ──────────────────────────────────────────
  let genericCtaCount = 0
  for (const c of ctas) {
    const label = c.label.replace(/\s+/g, ' ').trim()
    if (!GENERIC_CTAS.some((re) => re.test(label))) continue
    if (genericCtaCount >= 3) break
    add('P2', 'copy-generic-cta', c.index,
      `Generic CTA label: "${label}".`,
      'If this is a secondary action, say what it reveals ("Compare plans") rather than "Learn more". Keep one real primary action per region.')
    genericCtaCount++
  }

  // ── P1: same action, different labels ───────────────────────────────────
  const normalized = ctas.map((c) => ({ ...c, norm: c.label.replace(/\s+/g, ' ').trim().toLowerCase() }))
  let familyHits = 0
  for (const family of CTA_FAMILIES) {
    const members = normalized.filter((c) => family.re.test(c.norm))
    const distinct = [...new Map(members.map((m) => [m.norm, m])).values()]
    if (distinct.length < 2 || familyHits >= 2) continue
    add('P1', 'copy-cta-inconsistent', distinct[1].index,
      `Same action labelled "${distinct[0].label}" and "${distinct[1].label}".`,
      'One action, one name, through the whole flow: the button, the toast and the handoff should use the same verb and object.')
    familyHits++
  }

  // ── P1/P2: error-state quality ──────────────────────────────────────────
  const errorish = /(?:^|[\s_-])(?:error|alert|validation|form-error|error-message)/i
  let errorCount = 0
  for (const t of tags) {
    if (errorCount >= 3) break
    const cls = (attr(t.attrs, 'class') || '') + ' ' + (attr(t.attrs, 'id') || '') + ' ' + (attr(t.attrs, 'role') || '')
    if (!errorish.test(cls) && !/role\s*=\s*"?alert"?/i.test(t.attrs)) continue
    const close = findClose(raw, t.start, t.tag)
    const message = innerOf(raw, t.end, close).text
    if (message.length < 3) continue
    const vague = ERROR_VAGUE.test(message)
    const recovery = ERROR_RECOVERY.test(message)
    if (vague && !recovery) {
      add('P1', 'copy-error-vague', t.start,
        `Vague error message: "${message.slice(0, 100).replace(/[.\s]+$/, '')}".`,
        'Say what happened, why if knowable, and what the user can do. Preserve their input. An error the user cannot act on is a dead end.')
      errorCount++
    } else if (vague && recovery) {
      add('P2', 'copy-error-generic', t.start,
        `Generic error opener with a recovery path: "${message.slice(0, 100).replace(/[.\s]+$/, '')}".`,
        'The recovery is there; replace the opener with the cause ("Card declined", "Network unreachable").')
      errorCount++
    }
  }

  // ── P1: thin empty states ───────────────────────────────────────────────
  const emptyish = /(?:^|[\s_-])(?:empty|no-results|zero-state|empty-state|nothing-here)/i
  let emptyCount = 0
  for (const t of tags) {
    if (emptyCount >= 3) break
    const cls = (attr(t.attrs, 'class') || '') + ' ' + (attr(t.attrs, 'id') || '')
    if (!emptyish.test(cls)) continue
    const close = findClose(raw, t.start, t.tag)
    const inner = innerOf(raw, t.end, close)
    if (inner.text.length < 3) continue
    const hasAction = /<(?:a|button|input)\b/i.test(inner.html)
    if (!hasAction) {
      add('P1', 'copy-empty-thin', t.start,
        `Empty state with no next step: "${inner.text.slice(0, 80).replace(/[.\s]+$/, '')}".`,
        'An empty state is a first-run screen: say what belongs here, why it matters and give one primary action. "No data" alone is a dead end.')
      emptyCount++
    } else if (EMPTY_THIN.test(inner.text.replace(/\s+/g, ' ').trim())) {
      add('P2', 'copy-empty-thin', t.start,
        `Minimal empty-state copy: "${inner.text}".`,
        'Add one sentence of value and keep the action. The action exists; the explanation is missing.')
      emptyCount++
    }
  }

  // ── P1: placeholder identities ──────────────────────────────────────────
  let identityCount = 0
  for (const pattern of IDENTITY_PATTERNS) {
    if (identityCount >= 3) break
    const m = pattern.re.exec(text)
    if (!m) continue
    add('P1', 'realism-placeholder-identity', m.index,
      `Placeholder ${pattern.what}: "${m[0]}".`,
      'Use a real identity from the brief, or a clearly fictional one labelled as sample data. Do not ship "Acme" or "John Doe" in a product surface.')
    identityCount++
  }

  // ── P1: placeholder images + useless alt ────────────────────────────────
  let imageCount = 0
  for (const t of tags) {
    if (imageCount >= 4) break
    if (t.tag !== 'img') continue
    const src = attr(t.attrs, 'src') || ''
    const alt = attr(t.attrs, 'alt')
    if (PLACEHOLDER_IMAGE_SRC.test(src) || /(?:^|[/._-])(?:placeholder|dummy|sample)(?:[/._-]|$)/i.test(src)) {
      add('P1', 'realism-placeholder-image', t.start,
        `Placeholder image source: "${src.slice(0, 80)}".`,
        'Use a real local asset, a generated asset recorded in MEMORY.md, or a labelled placeholder slot in the layout. Never hotlink a placeholder service into a shipped artifact.')
      imageCount++
      continue
    }
    if (alt === null) continue // missing alt is design-lint / measure-artifact --a11y
    const a = alt.trim()
    if (!a) continue
    if (GENERIC_ALT.test(a) || FILENAME_ALT.test(a) || CAMERA_ALT.test(a)) {
      add('P1', 'realism-alt-unhelpful', t.start,
        `Unhelpful alt text: alt="${a}".`,
        'Alt text is the content of the image for someone who cannot see it. Describe what it shows and why it is there, not that it is an image.')
      imageCount++
    }
  }

  // ── P1/P2: placeholder links ────────────────────────────────────────────
  let linkCount = 0
  for (const t of tags) {
    if (linkCount >= 3) break
    if (t.tag !== 'a') continue
    const href = (attr(t.attrs, 'href') || '').trim()
    if (!href) continue
    const close = findClose(raw, t.start, t.tag)
    const label = innerOf(raw, t.end, close).text
    const cls = attr(t.attrs, 'class') || ''
    const ctaish = /btn|button|cta|primary|action/i.test(cls) || /(?:→|->|›|»)\s*$/.test(label) ||
      /^(?:get|start|sign|create|book|buy|contact|download|try|request|join|subscribe|view|open)\b/i.test(label)
    if (/^(?:#|#!|javascript:void\(0\)|javascript:;)$/i.test(href)) {
      if (!ctaish) continue // design-lint already reports generic href="#" as P2
      add('P2', 'realism-placeholder-link', t.start,
        `Placeholder link on an action: href="${href}" ("${label.slice(0, 60)}").`,
        'Point the action at a real route, or render it disabled and say why. A CTA that goes nowhere is worse than no CTA.')
      linkCount++
      continue
    }
    if (/(?:^|\/\/|mailto:|tel:)example\.(?:com|org|net)/i.test(href) || /^\/path\/to\//i.test(href) || /^(?:link|url|href)$/i.test(href)) {
      add('P2', 'realism-placeholder-link', t.start,
        `Placeholder link target: "${href}".`,
        'Use the real destination. If this is documentation showing an example URL, wrap the example in data-no-lint or mark it in the copy.')
      linkCount++
    }
  }

  // ── P1: unfinished markers ──────────────────────────────────────────────
  const todo = /\b(?:TBD|TODO|FIXME)\b/.exec(text)
  if (todo) {
    add('P1', 'copy-todo', todo.index,
      `Unfinished marker in visible copy: "${todo[0]}".`,
      'Resolve it before handover, or replace it with a labelled placeholder the user can act on.')
  }

  // ── P2: long sentences in prose blocks ──────────────────────────────────
  const proseTags = new Set(['p', 'li', 'blockquote', 'dd', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
  let longCount = 0
  for (const t of tags) {
    if (longCount >= 3) break
    if (!proseTags.has(t.tag)) continue
    const close = findClose(raw, t.start, t.tag)
    const body = innerOf(raw, t.end, close).text
    if (!body) continue
    for (const sentence of body.split(/(?<=[.!?])\s+/)) {
      const words = (sentence.match(/[A-Za-z0-9][\w'’.-]*/g) || []).length
      if (words <= 40) continue
      const needle = sentence.trim().slice(0, 60)
      const idx = needle ? raw.indexOf(needle, t.start) : -1
      add('P2', 'copy-sentence-long', idx === -1 ? t.start : idx,
        `Sentence of ${words} words.`,
        'Split it. One idea per sentence; the reader is scanning, not reading a whitepaper.')
      longCount++
      break
    }
  }

  // ── P2: mixed CTA casing ────────────────────────────────────────────────
  if (ctas.length >= 3) {
    const classes = new Set()
    for (const c of ctas) {
      const label = c.label.replace(/\s+/g, ' ').trim()
      if (!/[a-z]/i.test(label)) continue
      const words = label.split(' ')
      const title = words.every((w) => !/[a-z]/i.test(w) || /^[A-Z]/.test(w))
      classes.add(title ? 'title' : 'sentence')
    }
    if (classes.size === 2) {
      add('P2', 'copy-cta-casing', ctas[0].index,
        'CTA labels mix Title Case and sentence case.',
        'Pick one casing rule for actions and apply it everywhere. Mixed casing reads as two different systems.')
    }
  }

  // ── em-dash density ─────────────────────────────────────────────────────
  const emDashes = (text.match(/—|&mdash;/g) || []).length
  const words = (text.match(/[A-Za-z0-9][\w'’.-]*/g) || []).length
  if (emDashes >= 3 && words > 0 && (emDashes / words) * 100 >= 2.0) {
    const m = /—|&mdash;/.exec(text)
    add('P2', 'ai-emdash-density', m ? m.index : 0,
      `Em-dash density: ${emDashes} dashes in ${words} words (${((emDashes / words) * 100).toFixed(1)} per 100).`,
      'Em dashes are fine typography; a page of them is a generated voice. Replace most with a full stop, colon or comma, and keep one where it does real work.')
  }

  // ── dedupe by (id, line) ────────────────────────────────────────────────
  const seen = new Set()
  return findings.filter((f) => {
    const key = f.id + ':' + f.line
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── self-test ────────────────────────────────────────────────────────────
function runSelfTest() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dir = path.resolve(here, '..', '..', 'scripts', 'fixtures', 'content')
  const expectedFile = path.join(dir, 'expected.json')
  if (!fs.existsSync(expectedFile)) {
    console.error(`content-lint: self-test fixtures not found at ${path.relative(process.cwd(), dir)}`)
    process.exit(2)
  }
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'))
  let failed = 0
  for (const fixture of expected.fixtures || []) {
    const file = path.join(dir, fixture.file)
    if (!fs.existsSync(file)) {
      console.log(`FAIL  ${fixture.file} (missing)`)
      failed++
      continue
    }
    const findings = lintContent(fs.readFileSync(file, 'utf8'), file)
    const ids = new Set(findings.map((f) => f.id))
    const missing = (fixture.mustInclude || []).filter((id) => !ids.has(id))
    const unexpected = (fixture.mustExclude || []).filter((id) => ids.has(id))
    const cleanFailure = fixture.expectClean && findings.length > 0
    if (missing.length || unexpected.length || cleanFailure) {
      failed++
      console.log(`FAIL  ${fixture.file}`)
      if (missing.length) console.log(`      missing: ${missing.join(', ')}`)
      if (unexpected.length) console.log(`      unexpected: ${unexpected.join(', ')}`)
      if (cleanFailure) console.log(`      expected clean, got: ${[...ids].join(', ')}`)
    } else {
      console.log(`PASS  ${fixture.file} (${findings.length} finding${findings.length === 1 ? '' : 's'})`)
    }
  }
  console.log(`\ncontent-lint --self-test: ${failed === 0 ? 'all fixtures passed' : failed + ' fixture(s) failed'}`)
  process.exit(failed === 0 ? 0 : 1)
}

if (selfTest) runSelfTest()

// ── file loop and output ─────────────────────────────────────────────────
let all = []
let hadError = false
for (const file of files) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    console.error(`content-lint: cannot read ${file}: ${e.message}`)
    hadError = true
    continue
  }
  if (!/\.(html?|svg)$/i.test(file)) continue
  all = all.concat(lintContent(raw, path.resolve(file)))
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
  if (!all.length) console.log('content-lint: no findings')
}
if (!json) {
  console.log(`\ncontent-lint: ${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2 across ${files.length} file(s)`)
}

if (hadError) process.exit(2)
if (counts.P0 > 0) process.exit(1)
if (strict && counts.P1 > 0) process.exit(1)
process.exit(0)
