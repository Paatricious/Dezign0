#!/usr/bin/env node
/**
 * compliance.mjs — draft accessibility evidence scaffold from measure-artifact JSON.
 *
 * Turns rendered measurements into four documents:
 *   1. a WCAG 2.2 A/AA conformance scaffold (pass / fail / not tested per SC,
 *      with the evidence that produced each status and the unchecked list),
 *   2. an ACR/VPAT 2.5-style draft template,
 *   3. an EAA / EN 301 549 mapping template,
 *   4. a colour-vision simulation metadata + checklist (no image processing).
 *
 * Hard rule: this tool produces DRAFTS. Automated checks cannot prove WCAG
 * conformance, and no output here is a compliance claim. Every generated file
 * carries that banner, and the JSON says `"complianceClaimed": false`.
 *
 * Input: the JSON emitted by `measure-artifact.mjs --json` (with --a11y and
 * optionally --axe/--reflow/--forced-colors/--print/--runtime). Older payloads
 * with only `results` still work; anything unmeasured is reported as not tested.
 *
 * Usage:
 *   node compliance.mjs <measure.json> [--json] [--strict]
 *                        [--out=dir|file] [--only=wcag|acr|eaa|cvd|all]
 *                        [--artifact=<label>] [--self-test]
 *
 * Exit codes:
 *   0  report generated (draft)
 *   1  --strict and at least one criterion failed
 *   2  usage, read or parse error
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const DRAFT_BANNER =
  '**DRAFT — evidence scaffold, not a compliance claim.** Generated from automated ' +
  'measurements. A criterion marked *pass* means "no automated finding in the checked ' +
  'subset"; it does not mean the artifact conforms. A qualified human review is required ' +
  'before this document is used in procurement, an accessibility statement, or an ' +
  'ACR/VPAT submission.'

const LIMITATIONS = [
  'Automated checks cover a subset of each success criterion; the pass labels are not conformance findings.',
  'No screen-reader, browser-zoom, print, forced-colors or second-engine result is assumed unless the measure payload contains that run.',
  'Contrast is measured on text leaves with a nearest-opaque-background walk; background images, gradients and images of text are not composited.',
  'Media alternatives, timing, language, consistent behaviour and authentication criteria are not machine-checkable and stay not tested.',
  'axe-core, when used, is a rule engine, not a compliance verdict; its coverage is partial and its absence is not evidence of conformance.',
]

// ── WCAG 2.2 A/AA criterion set ───────────────────────────────────────────
// Principle numbers are derived from the criterion id. Titles are the short
// names from the specification. AAA criteria are listed only where this kit
// produces evidence (reduced motion); AAA is out of the AA target.
const WCAG_A_AA = [
  ['1.1.1', 'A', 'Non-text Content'],
  ['1.2.1', 'A', 'Audio-only and Video-only (Prerecorded)'],
  ['1.2.2', 'A', 'Captions (Prerecorded)'],
  ['1.2.3', 'A', 'Audio Description or Media Alternative (Prerecorded)'],
  ['1.2.4', 'AA', 'Captions (Live)'],
  ['1.2.5', 'AA', 'Audio Description (Prerecorded)'],
  ['1.3.1', 'A', 'Info and Relationships'],
  ['1.3.2', 'A', 'Meaningful Sequence'],
  ['1.3.3', 'A', 'Sensory Characteristics'],
  ['1.3.4', 'AA', 'Orientation'],
  ['1.3.5', 'AA', 'Identify Input Purpose'],
  ['1.4.1', 'A', 'Use of Color'],
  ['1.4.2', 'A', 'Audio Control'],
  ['1.4.3', 'AA', 'Contrast (Minimum)'],
  ['1.4.4', 'AA', 'Resize Text'],
  ['1.4.5', 'AA', 'Images of Text'],
  ['1.4.10', 'AA', 'Reflow'],
  ['1.4.11', 'AA', 'Non-text Contrast'],
  ['1.4.12', 'AA', 'Text Spacing'],
  ['1.4.13', 'AA', 'Content on Hover or Focus'],
  ['2.1.1', 'A', 'Keyboard'],
  ['2.1.2', 'A', 'No Keyboard Trap'],
  ['2.1.4', 'A', 'Character Key Shortcuts'],
  ['2.2.1', 'A', 'Timing Adjustable'],
  ['2.2.2', 'A', 'Pause, Stop, Hide'],
  ['2.3.1', 'A', 'Three Flashes or Below Threshold'],
  ['2.4.1', 'A', 'Bypass Blocks'],
  ['2.4.2', 'A', 'Page Titled'],
  ['2.4.3', 'A', 'Focus Order'],
  ['2.4.4', 'A', 'Link Purpose (In Context)'],
  ['2.4.5', 'AA', 'Multiple Ways'],
  ['2.4.6', 'AA', 'Headings and Labels'],
  ['2.4.7', 'AA', 'Focus Visible'],
  ['2.4.11', 'AA', 'Focus Not Obscured (Minimum)'],
  ['2.5.1', 'A', 'Pointer Gestures'],
  ['2.5.2', 'A', 'Pointer Cancellation'],
  ['2.5.3', 'A', 'Label in Name'],
  ['2.5.4', 'A', 'Motion Actuation'],
  ['2.5.7', 'AA', 'Dragging Movements'],
  ['2.5.8', 'AA', 'Target Size (Minimum)'],
  ['3.1.1', 'A', 'Language of Page'],
  ['3.1.2', 'AA', 'Language of Parts'],
  ['3.2.1', 'A', 'On Focus'],
  ['3.2.2', 'A', 'On Input'],
  ['3.2.3', 'AA', 'Consistent Navigation'],
  ['3.2.4', 'AA', 'Consistent Identification'],
  ['3.2.6', 'A', 'Consistent Help'],
  ['3.3.1', 'A', 'Error Identification'],
  ['3.3.2', 'A', 'Labels or Instructions'],
  ['3.3.3', 'AA', 'Error Suggestion'],
  ['3.3.4', 'AA', 'Error Prevention (Legal, Financial, Data)'],
  ['3.3.7', 'A', 'Redundant Entry'],
  ['3.3.8', 'AA', 'Accessible Authentication (Minimum)'],
  ['4.1.2', 'A', 'Name, Role, Value'],
  ['4.1.3', 'AA', 'Status Messages'],
]

const WCAG_AAA_MEASURED = [['2.3.3', 'AAA', 'Animation from Interactions']]

// Hand-check ids used by measure-artifact, from a11y-wcag.mjs CHECK_CRITERIA.
const CHECK_TO_CRITERIA = {
  'img-alt': ['1.1.1'],
  'control-name': ['4.1.2', '2.4.6'],
  'input-label': ['1.3.1', '3.3.2', '4.1.2'],
  'heading-h1': ['1.3.1', '2.4.6'],
  'heading-order': ['1.3.1', '2.4.6'],
  'landmark-main': ['1.3.1', '2.4.1'],
  'tabindex-positive': ['2.4.3'],
  'aria-ref': ['1.3.1', '4.1.2'],
  'aria-hidden-focus': ['4.1.2'],
  'duplicate-id': ['1.3.1', '4.1.2'],
  'target-size': ['2.5.8'],
  'non-text-contrast': ['1.4.11'],
  'focus-visible': ['2.4.7', '2.4.11'],
  'keyboard-trap': ['2.1.2'],
  'focus-order': ['2.4.3'],
  'reduced-motion': ['2.3.3', '2.2.2'],
  'forced-colors': ['1.4.1', '1.4.11'],
  'reflow': ['1.4.10'],
  'text-spacing': ['1.4.12'],
}

// How much of each criterion an automated pass actually covers. `subset` means
// "pass" still needs human confirmation; `strong` means the automated check is
// a faithful test for this criterion in ordinary pages.
const COVERAGE = {
  '1.1.1': 'subset',
  '1.3.1': 'subset',
  '1.4.1': 'subset',
  '1.4.3': 'subset',
  '1.4.10': 'strong',
  '1.4.11': 'subset',
  '1.4.12': 'strong',
  '2.1.1': 'subset',
  '2.1.2': 'subset',
  '2.4.1': 'subset',
  '2.4.3': 'subset',
  '2.4.6': 'subset',
  '2.4.7': 'subset',
  '2.4.11': 'subset',
  '2.5.8': 'strong',
  '3.3.2': 'subset',
  '4.1.2': 'subset',
  '2.3.3': 'strong',
}

const MANUAL_HINTS = {
  '1.2.1': 'Provide a transcript for audio-only and video-only media.',
  '1.2.2': 'Provide captions and verify them in the player.',
  '1.2.3': 'Provide audio description or a text alternative for video.',
  '1.2.4': 'Verify the live-caption path exists and is accurate.',
  '1.2.5': 'Verify an audio-description track exists and is synced.',
  '1.3.2': 'Check reading order with a screen reader or with CSS disabled.',
  '1.3.3': 'Instructions must not rely on shape, size or position alone.',
  '1.3.4': 'Test portrait and landscape; no orientation lock.',
  '1.3.5': 'Add autocomplete tokens to identity and contact fields.',
  '1.4.2': 'Audio longer than 3s needs pause or volume control.',
  '1.4.4': 'Zoom to 200% and confirm no text is lost.',
  '1.4.5': 'Replace images of text with real text.',
  '1.4.13': 'Hover/focus content must be dismissible, hoverable and persistent.',
  '2.1.4': 'Single-key shortcuts must be remappable or disableable.',
  '2.2.1': 'Time limits must be adjustable or extendable.',
  '2.2.2': 'Moving or blinking content needs pause, stop or hide.',
  '2.3.1': 'No more than three flashes per second.',
  '2.4.2': 'Give every page a descriptive title.',
  '2.4.4': 'Link purpose must be clear from its text or context.',
  '2.4.5': 'Provide more than one way to reach pages.',
  '3.1.1': 'Declare the page language and verify it in the DOM.',
  '3.1.2': 'Mark inline language changes.',
  '3.2.1': 'Focus must not trigger an unexpected context change.',
  '3.2.2': 'Changing a value must not trigger an unexpected context change.',
  '3.2.3': 'Navigation order and placement consistent across pages.',
  '3.2.4': 'Identify components consistently across pages.',
  '3.2.6': 'Help mechanisms in a consistent location.',
  '3.3.1': 'Describe input errors in text and tie them to the field.',
  '3.3.3': 'Offer a correction when an input error is detected.',
  '3.3.4': 'Review/confirm/undo for legal, financial or data submissions.',
  '3.3.7': 'Do not require re-entering previously supplied information.',
  '3.3.8': 'No cognitive test for authentication, or provide an alternative.',
  '2.5.1': 'Pointer gestures need a single-pointer alternative.',
  '2.5.2': 'Pointer actions must be cancelable or undoable.',
  '2.5.3': 'The accessible name must contain the visible label text.',
  '2.5.4': 'Motion actuation needs a user-interface alternative.',
  '2.5.7': 'Dragging interactions need a non-drag alternative.',
  '4.1.3': 'Status messages must be announced without moving focus.',
  '2.4.11': 'Focus must not be hidden by sticky headers or overlays.',
}

// ── small helpers ─────────────────────────────────────────────────────────
const numId = (id) => id.split('.').map(Number)

function sortCriteria(list) {
  return [...list].sort((a, b) => {
    const A = numId(a.id)
    const B = numId(b.id)
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const d = (A[i] || 0) - (B[i] || 0)
      if (d) return d
    }
    return 0
  })
}

const cell = (value) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim()

const isRun = (section) => section && typeof section === 'object' && (section.status === 'pass' || section.status === 'fail')

function countBy(list, key) {
  const out = {}
  for (const item of list) out[item[key]] = (out[item[key]] || 0) + 1
  return out
}

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0
}

function readPayload(file) {
  let raw
  try {
    raw = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${file === '-' ? 'stdin' : file}: ${error.message}`)
  }
  let payload
  try {
    payload = JSON.parse(raw)
  } catch (error) {
    throw new Error(`not valid measure JSON: ${error.message}`)
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) {
    throw new Error('not a measure-artifact payload: expected a top-level "results" array')
  }
  return payload
}

// ── report model ──────────────────────────────────────────────────────────
function buildReport(payload, options = {}) {
  const results = payload.results || []
  const viewports = (payload.viewports || results.map((r) => ({ label: r.label, width: r.width, height: r.height })))
    .map((v) => ({ label: String(v.label || `${v.width}x${v.height}`), width: v.width, height: v.height }))

  const handRan = Boolean(payload.a11y && (payload.a11y.findings || Number.isFinite(payload.a11y.mergedCount)))
  const contrastRan = results.length > 0
  const keyboard = payload.keyboard || {}
  const reflow = payload.reflow || {}
  const textSpacing = payload.textSpacing || {}
  const forcedColors = payload.forcedColors || {}
  const reducedMotion = payload.reducedMotion || {}
  const axe = payload.axe || {}
  const axeRan = axe.status === 'ran'

  // Per-criterion failures collected from every automated source.
  const failures = new Map()
  const addFailure = (id, detail) => {
    if (!failures.has(id)) failures.set(id, [])
    failures.get(id).push(detail)
  }

  // 1. Criteria already summarised by measure (hand checks + axe merged).
  for (const item of payload.wcag?.summary || []) {
    const count = Number(item.count) || 0
    if (count <= 0) continue
    addFailure(item.id, `${count} automated finding${count === 1 ? '' : 's'}${axeRan ? ' (hand checks and axe, merged and deduplicated)' : ' (hand checks)'}`)
  }
  // 2. Individual hand findings add the kind/detail evidence trail.
  for (const finding of payload.a11y?.findings || []) {
    const ids = (finding.wcag || []).map((c) => c.id).filter(Boolean)
    for (const id of ids) {
      const marker = `hand/${finding.kind || 'check'}`
      const existing = failures.get(id) || []
      if (!existing.some((entry) => entry.startsWith(marker))) {
        addFailure(id, `${marker}: ${String(finding.detail || finding.text || 'finding').slice(0, 90)}`)
      }
    }
  }
  // 3. Rendered contrast failures.
  const contrastOffenders = results.filter((r) => Number(r.contrastCount) > 0)
  if (contrastOffenders.length) {
    const first = (contrastOffenders[0].contrast || [])[0]
    addFailure('1.4.3', `${contrastOffenders.reduce((n, r) => n + (Number(r.contrastCount) || 0), 0)} rendered contrast failure(s)` +
      (first ? `; e.g. ${first.ratio}:1 at ${first.size}px " ${String(first.text || '').slice(0, 40)} "` : ''))
  }
  // 4. Keyboard / focus runs.
  if (keyboard.status === 'fail') {
    if (keyboard.trap) addFailure('2.1.2', `possible keyboard trap at ${keyboard.trap.dialog} after ${keyboard.trap.afterTabs} Tab press(es)`)
    if ((keyboard.focusVisible?.failures || []).length) addFailure('2.4.7', `${keyboard.focusVisible.failures.length} focusable control(s) without a visible focus indicator`)
    if ((keyboard.obscured || []).length) addFailure('2.4.11', `${keyboard.obscured.length} focused control(s) obscured`)
    if (!keyboard.trap && !(keyboard.focusVisible?.failures || []).length && !(keyboard.obscured || []).length) {
      addFailure('2.1.1', 'keyboard probe reported a failure')
    }
  }
  // 5. Optional runs.
  if (reflow.status === 'fail') addFailure('1.4.10', `content did not reflow at 320 CSS px (scrollWidth ${reflow.scrollWidth ?? 'unknown'})`)
  if (textSpacing.status === 'fail') addFailure('1.4.12', 'text spacing overrides clipped or overflowed content')
  if (forcedColors.status === 'fail') {
    addFailure('1.4.1', `${(forcedColors.findings || []).length} forced-colors finding(s)`)
    if ((forcedColors.focusFailures || []).length) addFailure('1.4.11', `${forcedColors.focusFailures.length} focus indicator(s) lost in forced-colors mode`)
  }
  if (reducedMotion.status === 'fail') addFailure('2.3.3', `${(reducedMotion.findings || []).length} animation(s) still move with prefers-reduced-motion: reduce`)
  for (const item of axe.violations || []) {
    for (const c of item.wcag || []) {
      if (!c.id) continue
      const existing = failures.get(c.id) || []
      if (!existing.some((entry) => entry.startsWith('axe/'))) addFailure(c.id, `axe/${item.rule}: ${String(item.help || item.description || '').slice(0, 80)}`)
    }
  }

  // Which automated families produced a clean result?
  // The seven basic hand checks run on every measure pass; the extended ones
  // (target size, non-text contrast, ARIA, keyboard, reflow, text spacing,
  // forced colors, reduced motion) run only when their flag did. Never mark a
  // criterion "pass" for a check that did not actually run.
  const clean = new Map()
  const markClean = (id, detail) => {
    if (!clean.has(id)) clean.set(id, [])
    clean.get(id).push(detail)
  }
  const resultsHave = (field) => results.some((r) => r && r[field] && typeof r[field] === 'object')
  const extendedA11yRan = Boolean(payload.aria?.status === 'captured' || isRun(keyboard) || isRun(reducedMotion) || isRun(textSpacing))
  const checkRan = {
    'img-alt': true,
    'control-name': true,
    'input-label': true,
    'heading-h1': true,
    'heading-order': true,
    'landmark-main': true,
    'tabindex-positive': true,
    'aria-ref': extendedA11yRan,
    'aria-hidden-focus': extendedA11yRan,
    'duplicate-id': extendedA11yRan,
    'target-size': resultsHave('targetSize'),
    'non-text-contrast': resultsHave('nonTextContrast'),
    'focus-visible': isRun(keyboard),
    'keyboard-trap': isRun(keyboard),
    'focus-order': isRun(keyboard),
    'reduced-motion': isRun(reducedMotion),
    'reflow': isRun(reflow),
    'text-spacing': isRun(textSpacing),
    'forced-colors': isRun(forcedColors),
  }
  for (const [check, ids] of Object.entries(CHECK_TO_CRITERIA)) {
    if (!checkRan[check]) continue
    for (const id of ids) {
      if (!failures.has(id)) markClean(id, `hand/${check} ran with no finding`)
    }
  }
  if (contrastRan && !failures.has('1.4.3')) markClean('1.4.3', `rendered contrast measured at ${viewports.length || results.length} viewport(s), no failure`)
  if (isRun(keyboard) && !failures.has('2.1.1')) markClean('2.1.1', `keyboard probe tabbed ${keyboard.tabStopsReached ?? '?'} stops with no trap`)
  if (isRun(keyboard) && keyboard.status === 'pass') {
    if (!failures.has('2.4.7')) markClean('2.4.7', 'focus indicator present on every probed stop')
    if (!failures.has('2.4.11')) markClean('2.4.11', 'no probed control obscured while focused')
    if (!failures.has('2.1.2')) markClean('2.1.2', 'no keyboard trap detected')
  }
  if (isRun(reflow) && !failures.has('1.4.10')) markClean('1.4.10', 'reflow probe passed at 320 CSS px')
  if (isRun(textSpacing) && !failures.has('1.4.12')) markClean('1.4.12', 'text-spacing overrides preserved content')
  if (isRun(forcedColors) && !failures.has('1.4.1')) markClean('1.4.1', 'forced-colors probe passed')
  if (isRun(reducedMotion) && !failures.has('2.3.3')) markClean('2.3.3', 'reduced-motion probe found no movement')

  const criteria = []
  for (const [id, level, title] of [...WCAG_A_AA, ...WCAG_AAA_MEASURED]) {
    const failureEvidence = failures.get(id) || []
    const cleanEvidence = clean.get(id) || []
    const status = failureEvidence.length ? 'fail' : cleanEvidence.length ? 'pass' : 'not-tested'
    const coverage = status === 'fail' ? 'automated' : cleanEvidence.length ? COVERAGE[id] || 'subset' : 'none'
    criteria.push({
      id,
      level,
      title,
      principle: Number(id[0]),
      status,
      coverage,
      evidence: status === 'fail' ? failureEvidence : cleanEvidence,
      note: status === 'pass'
        ? coverage === 'strong'
          ? 'Automated check is a faithful test for this criterion in ordinary pages; still confirm in human review.'
          : 'Automated subset passed; the criterion has parts this kit cannot check.'
        : status === 'fail'
          ? 'Fix the failure, then re-measure. This is a finding, not an audit verdict.'
          : 'No automated evidence in this run.',
      manualHint: status === 'not-tested' ? MANUAL_HINTS[id] || 'Manual review required; no automated check in this kit.' : undefined,
    })
  }

  const checked = criteria.filter((c) => c.status !== 'not-tested')
  const summary = {
    criteria: criteria.length,
    pass: criteria.filter((c) => c.status === 'pass').length,
    fail: criteria.filter((c) => c.status === 'fail').length,
    notTested: criteria.filter((c) => c.status === 'not-tested').length,
    checked: checked.length,
    coveragePct: pct(checked.length, criteria.length),
    byLevel: {
      A: countBy(criteria.filter((c) => c.level === 'A'), 'status'),
      AA: countBy(criteria.filter((c) => c.level === 'AA'), 'status'),
      AAA: countBy(criteria.filter((c) => c.level === 'AAA'), 'status'),
    },
  }

  const unchecked = criteria
    .filter((c) => c.status === 'not-tested' && c.level !== 'AAA')
    .map((c) => ({ id: c.id, level: c.level, title: c.title, reason: c.manualHint }))

  return {
    schema: 'dezign0/compliance-report/v1',
    draft: true,
    complianceClaimed: false,
    generated: new Date().toISOString(),
    artifact: {
      label: options.artifact || String(payload.url || 'artifact').split('/').pop() || 'artifact',
      url: payload.url || null,
      source: options.source || null,
    },
    method: {
      tool: 'measure-artifact.mjs',
      viewports: viewports.map((v) => v.label),
      runs: {
        handChecks: handRan ? 'ran' : 'not in payload',
        contrast: contrastRan ? 'ran' : 'not in payload',
        axe: axeRan ? `ran (${axe.violationCount ?? 0} violation(s), axe ${axe.version || 'unknown'})` : axe.status || 'not requested',
        keyboard: keyboard.status || 'not in payload',
        reflow: reflow.status || 'not requested',
        textSpacing: textSpacing.status || 'not in payload',
        forcedColors: forcedColors.status || 'not requested',
        reducedMotion: reducedMotion.status || 'not in payload',
        print: payload.print?.status || 'not requested',
        runtime: payload.runtime?.status || 'not requested',
      },
      axe: axe.status || 'not requested',
    },
    limitations: LIMITATIONS,
    wcag: { version: '2.2', target: 'AA', criteria, summary, unchecked },
    diagnostics: {
      blocking: Boolean(payload.blocking),
      blockingReasons: payload.blockingReasons || [],
      consoleErrors: (payload.consoleErrors || []).slice(0, 5),
      pageErrors: (payload.pageErrors || []).slice(0, 5),
      externalRequests: (payload.requests || []).length,
      clipped: results.reduce((n, r) => n + (Number(r.clippedCount) || 0), 0),
      contrast: results.reduce((n, r) => n + (Number(r.contrastCount) || 0), 0),
    },
    acr: buildAcr(criteria),
    eaa: buildEaa(criteria),
    colourVision: buildColourVision({ results, viewports }),
  }
}

function failsForCheck(failures, check) {
  const ids = CHECK_TO_CRITERIA[check] || []
  return ids.some((id) => failures.has(id))
}

function buildAcr(criteria) {
  const toConformance = (c) => {
    if (c.status === 'fail') return 'Does Not Support'
    if (c.status === 'not-tested') return 'Not Evaluated'
    return c.coverage === 'strong' ? 'Supports' : 'Partially Supports'
  }
  // The ACR tables cover level A and AA; AAA criteria stay in the WCAG scaffold.
  const table = criteria.filter((c) => c.level !== 'AAA').map((c) => ({
    id: c.id,
    level: c.level,
    title: c.title,
    conformance: toConformance(c),
    remarks: c.status === 'fail'
      ? c.evidence.slice(0, 3).join('; ')
      : c.status === 'pass'
        ? c.note
        : (c.manualHint || 'No automated evidence.'),
  }))
  const fpc = [
    ['302.1', 'Vision', ['1.1.1', '1.4.1', '1.4.3', '1.4.4', '1.4.11']],
    ['302.2', 'Hearing', ['1.2.1', '1.2.2', '1.2.4', '1.2.5']],
    ['302.3', 'Speech', ['2.5.4']],
    ['302.4', 'Manipulation', ['2.1.1', '2.1.2', '2.5.1', '2.5.2', '2.5.3', '2.5.7', '2.5.8']],
    ['302.5', 'Cognition', ['1.3.1', '2.2.1', '3.2.1', '3.2.2', '3.2.6', '3.3.1', '3.3.2', '3.3.3', '3.3.4', '3.3.7', '3.3.8']],
    ['302.6', 'Motor', ['2.1.1', '2.4.3', '2.4.7', '2.5.8']],
    ['302.7', 'With Limited Reach and Strength', ['2.5.8']],
    ['302.8', 'With Limited Language, Cognitive, and Learning Abilities', ['3.1.1', '3.1.2', '3.3.1', '3.3.2', '3.3.3']],
  ].map(([id, title, related]) => {
    const supporting = related.map((rid) => criteria.find((c) => c.id === rid)).filter(Boolean)
    const failed = supporting.filter((c) => c.status === 'fail')
    const tested = supporting.filter((c) => c.status !== 'not-tested')
    return {
      id,
      title,
      related,
      status: failed.length ? 'Does Not Support' : tested.length ? 'Partially Supports (automated subset)' : 'Not Evaluated',
      evidence: failed.length ? `${failed.length} related criterion failure(s)` : `${tested.length}/${related.length} related criteria had automated evidence`,
    }
  })
  return { template: 'VPAT 2.5-inspired draft', functionalPerformanceCriteria: fpc, table }
}

// EN 301 549 V3.2.1 maps the WCAG 2.1 A/AA criteria; the clause number follows
// 9.<principle>.<criterion> (2.4.11 -> 9.2.4.11). WCAG 2.2 additions are not in
// that revision yet and must not be presented as harmonised.
const WCAG_22_ADDITIONS = new Set(['2.4.11', '2.4.12', '2.4.13', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8', '3.3.9'])

function buildEaa(criteria) {
  const mappings = criteria
    .filter((c) => c.level !== 'AAA')
    .map((c) => ({
      clause: `9.${c.id}`,
      requirement: c.title,
      wcag: c.id,
      level: c.level,
      status: c.status,
      harmonised: !WCAG_22_ADDITIONS.has(c.id),
      note: WCAG_22_ADDITIONS.has(c.id)
        ? 'WCAG 2.2 addition; not yet referenced by EN 301 549 V3.2.1. Track the next revision; do not claim harmonised coverage.'
        : c.status === 'not-tested' ? (c.manualHint || 'Not evaluated.') : c.note,
    }))
  return {
    standard: 'EN 301 549 V3.2.1 (harmonised standard for the EAA)',
    applicability:
      'The European Accessibility Act applies from 28 June 2025 to consumer-facing products and services in the EU. ' +
      'Whether a given artifact falls inside its scope is a legal determination for the product owner and counsel; this file is not legal advice.',
    standardBasis: 'EN 301 549 V3.2.1 references WCAG 2.1 A/AA for web content (clause 9). WCAG 2.2-only criteria are marked unharmonised.',
    mappings,
    nonWcagObligations: [
      'Publish an accessibility statement that names the standard and the known gaps.',
      'Provide consumer-facing accessibility information before purchase or contract.',
      'Operate a complaint and redress procedure with a response timeline.',
      'Record conformity-assessment evidence (this file is one input, not the assessment).',
      'Train staff who answer accessibility questions.',
    ],
    signoff: { evaluator: '<name>', date: '<date>', statement: '<organization and product>', counselReview: 'pending' },
  }
}

function buildColourVision({ results, viewports }) {
  const seeds = []
  for (const r of results) {
    for (const c of (r.contrast || []).slice(0, 4)) {
      seeds.push({
        viewport: r.label || `${r.width}x${r.height}`,
        text: String(c.text || '').slice(0, 60),
        size: c.size,
        ratio: c.ratio,
        required: c.required,
      })
    }
  }
  return {
    method: 'metadata + checklist only; this tool performs no image processing and simulates nothing',
    simulation: {
      tool: '<record: browser devtools rendering emulation, OS colour filter, image editor, or CVD library>',
      algorithm: '<record: e.g. Machado 2009 at severity 1.0>',
      severity: 1.0,
      renderedVia: '<record: screenshot per viewport, or live emulation>',
      date: '<record>',
      evaluator: '<record>',
    },
    population: [
      { type: 'Protanopia / protanomaly (red-weak)', approximate: 'about 1% of men, rare in women', affects: 'red vs green, red vs dark, pure-red distinction', note: 'Simulate at full severity, not only mild.' },
      { type: 'Deuteranopia / deuteranomaly (green-weak)', approximate: 'about 1% of men at full severity; mild forms far more common (roughly 5% of men)', affects: 'red vs green, orange vs green, status colours', note: 'The most common practical failure; check status and chart palettes first.' },
      { type: 'Tritanopia / tritanomaly (blue-weak)', approximate: 'rare, under 0.1%', affects: 'blue vs green, yellow vs pink, hue gradients', note: 'Check links, focus rings and data series.' },
      { type: 'Achromatopsia / achromatomaly', approximate: 'very rare', affects: 'all hue information; luminance only', note: 'A pass in greyscale is the strongest single check.' },
    ],
    surfaces: [
      'Status and feedback (success, warning, error, info)',
      'Data series in charts (line, bar, area, heatmap, legend swatches)',
      'Links inside body text',
      'Focus indicator and selected/active states',
      'Toggle, checkbox and radio states',
      'Form validation: error, warning and success borders',
      'Disabled vs enabled controls',
      'Badges, tags and categorical labels',
      'Illustrations or icons that carry meaning',
      'Gradients used to encode value (heatmaps, meters)',
      'Text on coloured or photographic surfaces',
      'Dense tables with zebra striping or colour-coded cells',
    ],
    checklist: [
      { id: 'CV-01', check: 'Every colour-coded meaning also has a non-colour channel (text, icon, pattern, position or label).', wcag: ['1.4.1'] },
      { id: 'CV-02', check: 'Greyscale render keeps all information legible; nothing becomes uniform grey.', wcag: ['1.4.1', '1.4.3'] },
      { id: 'CV-03', check: 'Status colours remain distinguishable under protan and deutan simulation, or carry icons.', wcag: ['1.4.1'] },
      { id: 'CV-04', check: 'Chart series differ by more than hue: dash, marker, direct label or position.', wcag: ['1.4.1'] },
      { id: 'CV-05', check: 'Links are identifiable without colour (underline, weight or icon) where colour is the only cue.', wcag: ['1.4.1'] },
      { id: 'CV-06', check: 'Focus ring is visible on every simulated palette and in forced-colors mode.', wcag: ['1.4.1', '1.4.11', '2.4.7'] },
      { id: 'CV-07', check: 'Form error and success states pair colour with text and an icon.', wcag: ['1.4.1', '3.3.1'] },
      { id: 'CV-08', check: 'Text contrast still meets 4.5:1 (3:1 large) under each simulation; record the re-measured ratio.', wcag: ['1.4.3'] },
      { id: 'CV-09', check: 'Non-text boundaries and icons keep 3:1 against adjacent colours under simulation.', wcag: ['1.4.11'] },
      { id: 'CV-10', check: 'Heatmap and gradient legends have numeric or labelled stops, not colour alone.', wcag: ['1.4.1'] },
      { id: 'CV-11', check: 'Selection, hover and disabled states survive simulation without becoming identical.', wcag: ['1.4.1'] },
      { id: 'CV-12', check: 'Every simulated viewport and state is recorded with a screenshot path and verdict.', wcag: ['1.4.1', '1.4.3', '1.4.11'] },
    ],
    measuredSeeds: seeds,
    viewports: viewports.map((v) => v.label),
    recordTable: {
      columns: ['Surface', 'State', 'Viewport', 'Protan', 'Deutan', 'Tritan', 'Achroma', 'Verdict', 'Evidence'],
      rows: seeds.length
        ? seeds.map((s) => ({
            surface: `Measured contrast pair: "${s.text}"`,
            state: 'rendered',
            viewport: s.viewport,
            protan: '<pass/fail>',
            deutan: '<pass/fail>',
            tritan: '<pass/fail>',
            achroma: '<pass/fail>',
            verdict: s.ratio < s.required ? 'already failing contrast' : '<review>',
            evidence: `<screenshot path> (${s.ratio}:1, needs ${s.required})`,
          }))
        : [],
    },
  }
}

// ── markdown renderers ────────────────────────────────────────────────────
function renderWcag(report) {
  const { wcag, method, diagnostics } = report
  const lines = [
    `# WCAG 2.2 conformance scaffold — ${report.artifact.label}`,
    '',
    `> ${DRAFT_BANNER}`,
    '',
    `- Generated: ${report.generated}`,
    `- Source: ${report.artifact.url || report.artifact.source || 'measure-artifact JSON'}`,
    `- Viewports: ${method.viewports.join(', ') || 'not recorded'}`,
    `- Target: WCAG ${wcag.version} level ${wcag.target} (AAA evidence reported separately where measured)`,
    `- Coverage: ${wcag.summary.checked}/${wcag.summary.criteria} criteria had automated evidence (${wcag.summary.coveragePct}%); ` +
      `${wcag.summary.pass} pass (automated evidence), ${wcag.summary.fail} fail, ${wcag.summary.notTested} not tested`,
    '',
    '## Status legend',
    '',
    '| Status | Meaning |',
    '|---|---|',
    '| pass | No automated finding in the checked subset. Not a conformance finding. |',
    '| fail | Automated evidence of a failure. Fix and re-measure; a human must confirm. |',
    '| not tested | No automated evidence in this run. Manual review required. |',
    '',
  ]
  const byPrinciple = new Map()
  for (const c of wcag.criteria) {
    if (!byPrinciple.has(c.principle)) byPrinciple.set(c.principle, [])
    byPrinciple.get(c.principle).push(c)
  }
  const names = { 1: 'Perceivable', 2: 'Operable', 3: 'Understandable', 4: 'Robust' }
  for (const [principle, list] of [...byPrinciple.entries()].sort()) {
    lines.push(`## Principle ${principle} — ${names[principle] || ''}`, '')
    lines.push('| SC | Level | Title | Status | Coverage | Evidence / note |')
    lines.push('|---|---|---|---|---|---|')
    for (const c of sortCriteria(list)) {
      const evidence = c.status === 'fail' ? c.evidence.join('; ') : c.note
      lines.push(`| ${c.id} | ${c.level} | ${cell(c.title)} | **${c.status}** | ${c.coverage} | ${cell(evidence)} |`)
    }
    lines.push('')
  }
  lines.push('## Not tested (manual review required)', '')
  if (!wcag.unchecked.length) {
    lines.push('Every criterion had some automated evidence. That is unusual and still not conformance.')
  } else {
    lines.push('| SC | Level | Title | Why it is unchecked / what to do |')
    lines.push('|---|---|---|---|')
    for (const item of wcag.unchecked) {
      lines.push(`| ${item.id} | ${item.level} | ${cell(item.title)} | ${cell(item.reason)} |`)
    }
  }
  lines.push('', '## Method and limitations', '')
  lines.push('```text')
  for (const [key, value] of Object.entries(method.runs)) lines.push(`${key}: ${value}`)
  lines.push('```')
  lines.push('')
  for (const limitation of report.limitations) lines.push(`- ${limitation}`)
  lines.push('', '## Diagnostics (not success criteria)', '')
  lines.push(`- Blocking reasons: ${diagnostics.blockingReasons.join(', ') || 'none'}`)
  lines.push(`- Console/page errors: ${diagnostics.consoleErrors.length + diagnostics.pageErrors.length}`)
  lines.push(`- External requests: ${diagnostics.externalRequests}`)
  lines.push(`- Clipped elements: ${diagnostics.clipped}; contrast failures: ${diagnostics.contrast}`)
  lines.push('', '## Sign-off (draft)', '')
  lines.push('- [ ] Evidence reviewed by a qualified person')
  lines.push('- [ ] Every *pass* confirmed by manual testing or accepted as unverified')
  lines.push('- [ ] Every *fail* fixed, or recorded as a known limitation')
  lines.push('- [ ] This document relabelled from DRAFT only after the review')
  lines.push('')
  return lines.join('\n')
}

function renderAcr(report) {
  const { acr } = report
  const lines = [
    `# Accessibility Conformance Report — DRAFT (${acr.template})`,
    '',
    `> ${DRAFT_BANNER}`,
    '',
    `> **This is not a completed ACR/VPAT.** The tables below are pre-filled from automated`,
    `> evidence only. "Supports" in this draft means "no automated finding in the checked`,
    `> subset"; a qualified evaluator must confirm every row, complete the product and`,
    `> contact details, and sign before this document leaves the organization.`,
    '',
    '## Product information',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Product / artifact | ${cell(report.artifact.label)} |`,
    '| Version | `<version>` |',
    '| Report date | `<date>` |',
    `| Generated from | ${cell(report.artifact.url || report.artifact.source || 'measure-artifact JSON')} |`,
    '| Contact | `<name, email>` |',
    '| Evaluation methods | Automated measurement with `measure-artifact` plus `<manual methods>` |',
    '| Applicable standards | WCAG 2.2 A/AA; EN 301 549 V3.2.1 |',
    '',
    '## Table 1 — Success Criteria, Level A and AA',
    '',
    '| Criteria | Level | Conformance (draft) | Remarks and explanations |',
    '|---|---|---|---|',
  ]
  for (const row of acr.table.filter((r) => r.level !== 'AAA')) {
    lines.push(`| ${row.id} ${cell(row.title)} | ${row.level} | ${row.conformance} | ${cell(row.remarks)} |`)
  }
  lines.push('', '## Table 2 — Functional Performance Criteria', '')
  lines.push('| Criteria | Title | Conformance (draft) | Remarks |')
  lines.push('|---|---|---|---|')
  for (const row of acr.functionalPerformanceCriteria) {
    lines.push(`| ${row.id} | ${cell(row.title)} | ${row.status} | ${cell(row.evidence)} |`)
  }
  lines.push('', '## Appendix A — Evidence and limitations', '')
  lines.push('| Run | Result |')
  lines.push('|---|---|')
  for (const [key, value] of Object.entries(report.method.runs)) lines.push(`| ${key} | ${cell(value)} |`)
  lines.push('')
  for (const limitation of report.limitations) lines.push(`- ${limitation}`)
  lines.push('', '## Appendix B — Sign-off (required before use)', '')
  lines.push('| Role | Name | Date | Signature |')
  lines.push('|---|---|---|---|')
  lines.push('| Evaluator | `<name>` | `<date>` | `<signature>` |')
  lines.push('| Product owner | `<name>` | `<date>` | `<signature>` |')
  lines.push('')
  return lines.join('\n')
}

function renderEaa(report) {
  const { eaa } = report
  const lines = [
    `# EAA / EN 301 549 mapping scaffold — ${report.artifact.label}`,
    '',
    `> ${DRAFT_BANNER}`,
    '',
    '## Applicability (not legal advice)',
    '',
    eaa.applicability,
    '',
    `- Standard basis: ${eaa.standardBasis}`,
    `- Standard: ${eaa.standard}`,
    '',
    '## Clause map (web content, clause 9)',
    '',
    '| EN 301 549 clause | Requirement | WCAG SC | Level | Status | Harmonised | Note |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const m of eaa.mappings) {
    lines.push(`| ${m.clause} | ${cell(m.requirement)} | ${m.wcag} | ${m.level} | ${m.status} | ${m.harmonised ? 'yes' : 'no (WCAG 2.2)'} | ${cell(m.note)} |`)
  }
  lines.push('', '## Non-WCAG obligations to evidence separately', '')
  for (const item of eaa.nonWcagObligations) lines.push(`- [ ] ${item}`)
  lines.push('', '## Sign-off (draft)', '')
  lines.push('| Field | Value |')
  lines.push('|---|---|')
  for (const [key, value] of Object.entries(eaa.signoff)) lines.push(`| ${key} | ${cell(value)} |`)
  lines.push('')
  return lines.join('\n')
}

function renderCvd(report) {
  const { colourVision: cv } = report
  const lines = [
    `# Colour-vision checklist — ${report.artifact.label}`,
    '',
    `> ${DRAFT_BANNER}`,
    '',
    `> Method: ${cv.method}. Record the simulation tool and algorithm below; without them`,
    '> the checklist results are not reproducible.',
    '',
    '## Simulation metadata (fill in)',
    '',
    '| Field | Value |',
    '|---|---|',
  ]
  for (const [key, value] of Object.entries(cv.simulation)) lines.push(`| ${key} | ${cell(value)} |`)
  lines.push('', '## Why these types', '')
  lines.push('| Type | Approximate population | What it breaks | Note |')
  lines.push('|---|---|---|---|')
  for (const row of cv.population) lines.push(`| ${cell(row.type)} | ${cell(row.approximate)} | ${cell(row.affects)} | ${cell(row.note)} |`)
  lines.push('', '## Surface inventory', '')
  for (const surface of cv.surfaces) lines.push(`- ${surface}`)
  lines.push('', '## Checklist', '')
  lines.push('| ID | Check | WCAG | Result | Evidence |')
  lines.push('|---|---|---|---|---|')
  for (const item of cv.checklist) {
    lines.push(`| ${item.id} | ${cell(item.check)} | ${item.wcag.join(', ')} | \`<pass/fail>\` | \`<screenshot or note>\` |`)
  }
  lines.push('', '## Record table', '')
  lines.push(`| ${cv.recordTable.columns.join(' | ')} |`)
  lines.push(`|${cv.recordTable.columns.map(() => '---').join('|')}|`)
  if (cv.recordTable.rows.length) {
    for (const row of cv.recordTable.rows) {
      lines.push(`| ${cv.recordTable.columns.map((c) => cell(row[c.toLowerCase()])).join(' | ')} |`)
    }
  } else {
    lines.push(`| \`<surface>\` | \`<state>\` | ${cv.viewports.join(', ') || '<viewport>'} |  |  |  |  |  |  |`)
  }
  lines.push('', '## Acceptance', '')
  lines.push('- All information encoded in colour is also available without it (WCAG 1.4.1).')
  lines.push('- Text contrast passes 4.5:1 (3:1 large) when re-measured under simulation (WCAG 1.4.3).')
  lines.push('- Non-text boundaries and icons keep 3:1 (WCAG 1.4.11).')
  lines.push('- Any failure is recorded in the WCAG scaffold, not only here.')
  lines.push('')
  return lines.join('\n')
}

// ── output ────────────────────────────────────────────────────────────────
function outputsFor(report, only) {
  const all = {
    wcag: { file: 'compliance-wcag.md', render: renderWcag },
    acr: { file: 'acr-draft.md', render: renderAcr },
    eaa: { file: 'eaa-en301549-mapping.md', render: renderEaa },
    cvd: { file: 'colour-vision-checklist.md', render: renderCvd },
  }
  const keys = only === 'all' ? Object.keys(all) : [only]
  return keys.map((key) => ({ key, file: all[key].file, content: all[key].render(report) }))
}

function writeOutputs(report, outArg, only, json) {
  const target = path.resolve(outArg)
  const stat = fs.existsSync(target) ? fs.statSync(target) : null
  // A missing path ending in .md/.json is a file, not a directory to create.
  const looksLikeFile = /\.(md|markdown|json|txt)$/i.test(target)
  const isDir = stat ? stat.isDirectory() : !looksLikeFile
  if (isDir) {
    fs.mkdirSync(target, { recursive: true })
    const written = []
    const docs = outputsFor(report, 'all')
    for (const doc of docs) {
      const file = path.join(target, doc.file)
      fs.writeFileSync(file, doc.content)
      written.push(file)
    }
    const jsonFile = path.join(target, 'compliance.json')
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2) + '\n')
    written.push(jsonFile)
    const index = ['# Compliance draft pack', '', DRAFT_BANNER, '', ...docs.map((d) => `- [${d.file}](${d.file})`), '- [compliance.json](compliance.json)', '']
    fs.writeFileSync(path.join(target, 'README.md'), index.join('\n'))
    written.push(path.join(target, 'README.md'))
    return written
  }
  if (json || target.endsWith('.json')) {
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n')
    return [target]
  }
  const doc = outputsFor(report, only === 'all' ? 'wcag' : only)[0]
  fs.writeFileSync(target, doc.content)
  return [target]
}

// ── self-test ─────────────────────────────────────────────────────────────
function measureFixture() {
  return {
    url: 'file:///tmp/artifact.html',
    viewports: [
      { label: '390x844', width: 390, height: 844 },
      { label: '1440x900', width: 1440, height: 900 },
    ],
    results: [
      {
        width: 390,
        height: 844,
        label: '390x844',
        scrollWidth: 390,
        clippedCount: 0,
        clipped: [],
        contrastCount: 1,
        contrast: [{ tag: 'P', cls: 'meta', size: 12, ratio: 3.1, required: 4.5, text: 'muted metadata' }],
        typeSizeCount: 5,
        tiny: [],
        tabStops: 6,
        odHooks: 4,
        a11yCount: 1,
        a11y: [],
      },
      { width: 1440, height: 900, label: '1440x900', scrollWidth: 1440, clippedCount: 0, clipped: [], contrastCount: 0, contrast: [], typeSizeCount: 5, tiny: [], tabStops: 6, odHooks: 4, a11yCount: 0, a11y: [] },
    ],
    consoleErrors: ['TypeError: undefined is not a function'],
    pageErrors: [],
    requests: ['https://fonts.example.com/inter.woff2'],
    blocking: true,
    blockingReasons: ['contrast', 'a11y', 'axe', 'reflow'],
    wcag: {
      version: '2.2',
      summary: [
        { id: '1.1.1', level: 'A', title: 'Non-text Content', count: 1 },
        { id: '1.4.3', level: 'AA', title: 'Contrast (Minimum)', count: 1 },
        { id: '1.4.11', level: 'AA', title: 'Non-text Contrast', count: 0 },
        { id: '2.4.7', level: 'AA', title: 'Focus Visible', count: 1 },
        { id: '4.1.2', level: 'A', title: 'Name, Role, Value', count: 1 },
      ].filter((c) => c.count > 0),
      checks: { 'img-alt': ['1.1.1'], 'control-name': ['4.1.2', '2.4.6'], 'input-label': ['1.3.1', '3.3.2', '4.1.2'] },
    },
    a11y: {
      handCount: 2,
      mergedCount: 3,
      findings: [
        { kind: 'control-name', detail: '<button> with no accessible name', wcag: [{ id: '4.1.2' }] },
        { kind: 'img-alt', detail: '<img src="hero.webp">', wcag: [{ id: '1.1.1' }] },
        { kind: 'focus-visible', detail: '2 stops without a focus ring', wcag: [{ id: '2.4.7' }, { id: '2.4.11' }] },
      ],
    },
    axe: { status: 'ran', version: '4.10.2', violationCount: 1, violations: [{ rule: 'image-alt', impact: 'critical', help: 'Images must have alternate text', wcag: [{ id: '1.1.1', level: 'A' }] }] },
    keyboard: { status: 'fail', tabStopsReached: 4, focusVisible: { checked: 4, failures: [{ tag: 'a', text: 'Read more' }] }, obscured: [], trap: null },
    aria: { status: 'captured', bytes: 512 },
    reducedMotion: { status: 'pass', findings: [] },
    textSpacing: { status: 'pass', clippedCount: 0 },
    reflow: { status: 'pass', scrollWidth: 320 },
    forcedColors: { status: 'skipped', reason: 'not requested' },
    print: { status: 'skipped', reason: 'not requested' },
    runtime: { status: 'skipped', reason: 'not requested' },
  }
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dezign0-compliance-'))
  const checks = []
  const check = (name, condition, detail) => {
    checks.push({ name, ok: Boolean(condition), detail })
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${!condition && detail ? ` — ${detail}` : ''}`)
  }
  try {
    const fixture = measureFixture()
    const fixtureFile = path.join(tmp, 'measure.json')
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2))

    // In-process model
    const report = buildReport(fixture, { source: fixtureFile })
    const byId = Object.fromEntries(report.wcag.criteria.map((c) => [c.id, c]))
    check('draft flags are set', report.draft === true && report.complianceClaimed === false)
    check('1.4.3 fails from rendered contrast', byId['1.4.3']?.status === 'fail', byId['1.4.3']?.status)
    check('4.1.2 fails from hand check', byId['4.1.2']?.status === 'fail', byId['4.1.2']?.status)
    check('1.1.1 fails from axe + hand', byId['1.1.1']?.status === 'fail', byId['1.1.1']?.status)
    check('2.4.7 fails from focus-visible', byId['2.4.7']?.status === 'fail', byId['2.4.7']?.status)
    check('1.4.10 passes from reflow run', byId['1.4.10']?.status === 'pass', byId['1.4.10']?.status)
    check('1.4.12 passes from text-spacing run', byId['1.4.12']?.status === 'pass', byId['1.4.12']?.status)
    check('unmeasured SC is not-tested', byId['1.2.2']?.status === 'not-tested', byId['1.2.2']?.status)
    check('unchecked list carries manual hints', report.wcag.unchecked.some((u) => u.id === '1.2.2' && /caption/i.test(u.reason || '')))
    check('summary counts add up', report.wcag.summary.pass + report.wcag.summary.fail + report.wcag.summary.notTested === report.wcag.summary.criteria)
    check('ACR gives Does Not Support for failures', report.acr.table.find((r) => r.id === '1.4.3')?.conformance === 'Does Not Support')
    check('ACR gives Partially Supports for subset passes', report.acr.table.find((r) => r.id === '1.4.10')?.conformance === 'Supports')
    check('EAA maps clause numbers', report.eaa.mappings.some((m) => m.wcag === '2.4.11' && m.clause === '9.2.4.11'))
    check('EAA flags WCAG 2.2 additions as unharmonised', report.eaa.mappings.find((m) => m.wcag === '2.5.8')?.harmonised === false)
    check('colour-vision checklist is complete', report.colourVision.checklist.length >= 10)
    check('colour-vision seeds measured contrast pairs', report.colourVision.measuredSeeds.length >= 1)

    const wcagMd = renderWcag(report)
    check('markdown carries the draft banner', wcagMd.includes('not a compliance claim'))
    check('markdown carries every principle', ['Perceivable', 'Operable', 'Understandable', 'Robust'].every((p) => wcagMd.includes(p)))
    check('ACR markdown warns it is not a completed ACR', renderAcr(report).includes('not a completed ACR'))
    check('EAA markdown carries applicability note', renderEaa(report).includes('28 June 2025'))
    check('CVD markdown records simulation metadata', renderCvd(report).includes('Machado'))

    // CLI: JSON to stdout, out dir, strict exit codes, bad input
    const cli = (args) => spawnSync(process.execPath, [path.join(HERE, 'compliance.mjs'), ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    const jsonRun = cli([fixtureFile, '--json'])
    check('--json exits 0 and parses', jsonRun.status === 0 && (() => { try { JSON.parse(jsonRun.stdout); return true } catch { return false } })(), `status ${jsonRun.status}, bytes ${jsonRun.stdout?.length}, stderr ${jsonRun.stderr?.slice(0, 120)}`)
    const strictRun = cli([fixtureFile, '--strict'])
    check('--strict exits 1 when a criterion fails', strictRun.status === 1, `status ${strictRun.status}`)
    const markdownRun = cli([fixtureFile])
    check('default stdout is the WCAG markdown', markdownRun.status === 0 && markdownRun.stdout.includes('conformance scaffold'))

    const outDir = path.join(tmp, 'out')
    const outRun = cli([fixtureFile, '--out', outDir, '--only', 'all'])
    const expectedFiles = ['compliance-wcag.md', 'acr-draft.md', 'eaa-en301549-mapping.md', 'colour-vision-checklist.md', 'compliance.json', 'README.md']
    check('--out writes the full draft pack', outRun.status === 0 && expectedFiles.every((f) => fs.existsSync(path.join(outDir, f))),
      fs.existsSync(outDir) ? fs.readdirSync(outDir).join(',') : 'no out dir')

    const badRun = cli([path.join(tmp, 'nope.json')])
    check('missing input exits 2', badRun.status === 2, `status ${badRun.status}`)
    const broken = path.join(tmp, 'broken.json')
    fs.writeFileSync(broken, '{"results": [}')
    check('invalid JSON exits 2', cli([broken]).status === 2)
    const notMeasure = path.join(tmp, 'other.json')
    fs.writeFileSync(notMeasure, '{"hello": true}')
    check('non-measure JSON exits 2', cli([notMeasure]).status === 2)

    // Old-style payload (no extended keys) must degrade to not-tested, not crash.
    const legacy = { url: 'file:///old.html', results: [{ width: 1440, height: 900, label: '1440x900', contrastCount: 0, clippedCount: 0 }], consoleErrors: [], pageErrors: [], requests: [] }
    const legacyReport = buildReport(legacy)
    const legacyCheck = legacyReport.wcag.criteria.find((c) => c.id === '2.4.7')
    check('legacy payload leaves unrun checks not-tested', legacyCheck?.status === 'not-tested', legacyCheck?.status)

    // A measure run without --a11y must not report extended checks as passing.
    const noA11y = JSON.parse(JSON.stringify(fixture))
    noA11y.a11y = { handCount: 0, mergedCount: 0, findings: [] }
    noA11y.keyboard = { status: 'skipped', reason: 'pass --a11y' }
    noA11y.aria = { status: 'skipped', reason: 'pass --a11y' }
    noA11y.reducedMotion = { status: 'skipped', reason: 'pass --a11y' }
    noA11y.textSpacing = { status: 'skipped', reason: 'pass --a11y' }
    noA11y.reflow = { status: 'skipped', reason: 'pass --reflow' }
    noA11y.forcedColors = { status: 'skipped', reason: 'pass --forced-colors' }
    noA11y.axe = { status: 'skipped', reason: 'pass --axe' }
    noA11y.results = noA11y.results.map((r) => { delete r.targetSize; delete r.nonTextContrast; return r })
    noA11y.wcag.summary = []
    const noA11yReport = buildReport(noA11y)
    const noA11yById = Object.fromEntries(noA11yReport.wcag.criteria.map((c) => [c.id, c]))
    check('no --a11y leaves target size not-tested', noA11yById['2.5.8']?.status === 'not-tested', noA11yById['2.5.8']?.status)
    check('no --a11y leaves focus visible not-tested', noA11yById['2.4.7']?.status === 'not-tested', noA11yById['2.4.7']?.status)
    check('no --a11y still passes the basic alt check subset', noA11yById['1.1.1']?.status === 'pass', noA11yById['1.1.1']?.status)

    const failed = checks.filter((c) => !c.ok)
    console.log(`\ncompliance --self-test: ${failed.length ? failed.length + ' check(s) failed' : 'all checks passed'}`)
    return failed.length ? 1 : 0
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────
function main(argv) {
  const args = argv.slice(2)
  const BOOLEAN = new Set(['json', 'strict', 'self-test', 'help', 'h'])
  const VALUED = new Set(['out', 'only', 'artifact'])
  const KNOWN = new Set([...BOOLEAN, ...VALUED])
  const opts = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-') { positionals.push('-'); continue }
    if (!arg.startsWith('--')) { positionals.push(arg); continue }
    const eq = arg.indexOf('=')
    const key = (eq === -1 ? arg.slice(2) : arg.slice(2, eq))
    if (!KNOWN.has(key)) {
      console.error(`compliance: unknown option --${key}. See --help.`)
      return 2
    }
    if (eq !== -1) { opts[key] = arg.slice(eq + 1); continue }
    if (BOOLEAN.has(key)) { opts[key] = true; continue }
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++ } else { opts[key] = true }
  }
  if (opts.help || opts.h) {
    console.log(`compliance — draft WCAG/ACR/EAA/colour-vision scaffold from measure JSON

Usage: node compliance.mjs <measure.json | -> [options]

  --json              print the report model as JSON instead of markdown
  --out=<dir|file>    write the draft pack to a directory (all sections), or one file
  --only=<section>    wcag | acr | eaa | cvd | all   (default: wcag on stdout)
  --artifact=<label>  label used in the document headers
  --strict            exit 1 when any criterion fails
  --self-test         run the embedded fixture tests (no repository fixtures needed)

Input is the JSON from: node measure-artifact.mjs <artifact> --json --a11y
Exit codes: 0 report generated, 1 --strict with failures, 2 usage/read/parse error.

This tool produces DRAFTS. It never claims WCAG conformance; "pass" means no
automated finding in the subset that was checked.`)
    return 0
  }
  if (opts['self-test']) return runSelfTest()

  const file = positionals[0] || null
  if (!file) {
    console.error('compliance: no input. Pass a measure JSON file, or - for stdin. See --help.')
    return 2
  }
  const onlyRaw = typeof opts.only === 'string' ? opts.only : 'wcag'
  const validOnly = ['wcag', 'acr', 'eaa', 'cvd', 'all']
  if (!validOnly.includes(onlyRaw)) {
    console.error(`compliance: --only must be one of ${validOnly.join(', ')}`)
    return 2
  }
  let payload
  try {
    payload = readPayload(file)
  } catch (error) {
    console.error(`compliance: ${error.message}`)
    return 2
  }
  const report = buildReport(payload, {
    artifact: typeof opts.artifact === 'string' ? opts.artifact : undefined,
    source: file === '-' ? 'stdin' : path.resolve(file),
  })

  if (typeof opts.out === 'string') {
    try {
      const written = writeOutputs(report, opts.out, onlyRaw === 'all' ? 'all' : onlyRaw, Boolean(opts.json))
      for (const filePath of written) {
        const rel = path.relative(process.cwd(), filePath)
        console.log(`wrote ${rel.startsWith('..') ? filePath : rel}`)
      }
    } catch (error) {
      console.error(`compliance: cannot write output: ${error.message}`)
      return 2
    }
  } else if (opts.json) {
    console.log(JSON.stringify(report))
  } else {
    const separator = String.fromCharCode(10, 10) + '---' + String.fromCharCode(10, 10)
    console.log(outputsFor(report, onlyRaw === 'all' ? 'all' : onlyRaw).map((d) => d.content).join(separator))
  }

  if (opts.strict && report.wcag.summary.fail > 0) return 1
  return 0
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isEntry) process.exit(main(process.argv))

export { buildReport, renderWcag, renderAcr, renderEaa, renderCvd, WCAG_A_AA, WCAG_AAA_MEASURED }
