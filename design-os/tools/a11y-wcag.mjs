/**
 * WCAG 2.2 metadata and finding normalization for measure-artifact.
 *
 * Node-side helper only: no browser globals, no dependencies, no I/O.
 * The browser checks live in measure-artifact.mjs; this module is the stable
 * vocabulary they report into, so the JSON can be read by other tools.
 *
 * Criterion ids use the WCAG short form ("2.5.8", "1.4.11", ...). Levels are
 * the conformance level of the criterion in WCAG 2.2, not the level of the
 * individual page audit.
 */

export const WCAG_VERSION = '2.2'

const LEVEL_ORDER = { A: 1, AA: 2, AAA: 3 }

/** Criterion id -> { level, title }. Keep in sync with CHECK_CRITERIA. */
export const WCAG_CRITERIA = {
  '1.1.1': { level: 'A', title: 'Non-text Content' },
  '1.3.1': { level: 'A', title: 'Info and Relationships' },
  '1.4.1': { level: 'A', title: 'Use of Color' },
  '1.4.3': { level: 'AA', title: 'Contrast (Minimum)' },
  '1.4.10': { level: 'AA', title: 'Reflow' },
  '1.4.11': { level: 'AA', title: 'Non-text Contrast' },
  '1.4.12': { level: 'AA', title: 'Text Spacing' },
  '2.1.1': { level: 'A', title: 'Keyboard' },
  '2.1.2': { level: 'A', title: 'No Keyboard Trap' },
  '2.2.2': { level: 'A', title: 'Pause, Stop, Hide' },
  '2.3.3': { level: 'AAA', title: 'Animation from Interactions' },
  '2.4.1': { level: 'A', title: 'Bypass Blocks' },
  '2.4.3': { level: 'A', title: 'Focus Order' },
  '2.4.6': { level: 'AA', title: 'Headings and Labels' },
  '2.4.7': { level: 'AA', title: 'Focus Visible' },
  '2.4.11': { level: 'AA', title: 'Focus Not Obscured (Minimum)' },
  '2.5.8': { level: 'AA', title: 'Target Size (Minimum)' },
  '3.3.2': { level: 'A', title: 'Labels or Instructions' },
  '4.1.2': { level: 'A', title: 'Name, Role, Value' },
  '4.1.3': { level: 'AA', title: 'Status Messages' },
}

/**
 * Hand-check id -> WCAG 2.2 criteria. These are the documented claims the
 * browser checks make; runtime/print are measurement fields, not criteria.
 */
export const CHECK_CRITERIA = {
  // existing hand checks
  'img-alt': ['1.1.1'],
  'control-name': ['4.1.2', '2.4.6'],
  'input-label': ['1.3.1', '3.3.2', '4.1.2'],
  'heading-h1': ['1.3.1', '2.4.6'],
  'heading-order': ['1.3.1', '2.4.6'],
  'landmark-main': ['1.3.1', '2.4.1'],
  'tabindex-positive': ['2.4.3'],
  // new hand checks
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
  'runtime': [],
  'print': [],
}

const fallbackCriterion = (id, level) => ({
  id,
  level: level || 'A',
  title: `WCAG ${id}`,
})

/** Return [{id, level, title}] for a hand-check id (empty for unknown ids). */
export function criteriaFor(checkId) {
  return (CHECK_CRITERIA[checkId] || []).map((id) => {
    const known = WCAG_CRITERIA[id]
    return known ? { id, level: known.level, title: known.title } : fallbackCriterion(id)
  })
}

function higherLevel(a, b) {
  if (!a) return b
  if (!b) return a
  return (LEVEL_ORDER[b] || 0) > (LEVEL_ORDER[a] || 0) ? b : a
}

/**
 * Parse axe-core `tags` into WCAG 2.2 criterion ids + a conformance level.
 * axe uses short tags for criteria (wcag1410) and version tags for levels
 * (wcag2a, wcag21aa, wcag22aa). Unknown numeric ids are still reported.
 */
export function parseAxeTags(tags = []) {
  const ids = new Set()
  let level = ''
  for (const raw of tags) {
    const tag = String(raw || '').toLowerCase()
    if (!tag.startsWith('wcag')) continue
    const criterion = /^wcag(\d)(\d)(\d+)$/.exec(tag)
    if (criterion) {
      const id = `${criterion[1]}.${criterion[2]}.${criterion[3]}`
      ids.add(id)
      const known = WCAG_CRITERIA[id]
      level = higherLevel(level, known ? known.level : '')
      continue
    }
    const versioned = /^wcag(2\d?)(a{1,3})$/.exec(tag)
    if (versioned) level = higherLevel(level, versioned[2].toUpperCase())
  }
  const wcag = [...ids]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((id) => {
      const known = WCAG_CRITERIA[id]
      return known ? { id, level: known.level, title: known.title } : fallbackCriterion(id, level)
    })
  return { wcag, level: level || undefined }
}

/** Map one axe-core violation (with nodes) into the shared finding shape. */
export function mapAxeViolation(violation = {}) {
  const parsed = parseAxeTags(violation.tags)
  const nodes = (violation.nodes || []).slice(0, 5).map((node) => ({
    target: (node.target || []).join(' ').slice(0, 160),
    html: String(node.html || '').slice(0, 160),
    summary: String(node.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220),
  }))
  return {
    source: 'axe',
    kind: `axe:${violation.id || 'unknown'}`,
    rule: violation.id || 'unknown',
    impact: violation.impact || 'unknown',
    detail: violation.help || violation.id || 'axe violation',
    helpUrl: violation.helpUrl || '',
    level: parsed.level,
    wcag: parsed.wcag,
    nodes,
  }
}

const dedupeKey = (item) =>
  `${item.kind}|${item.selector || ''}|${String(item.detail || '').slice(0, 90)}`

/**
 * axe rule -> hand-check equivalence. Used only to stop the same accessibility
 * problem being reported twice (hand check + axe rule) when their selectors
 * differ in depth. It does not suppress distinct axe rules.
 */
export const AXE_CHECK_EQUIVALENTS = {
  'image-alt': 'img-alt',
  'label': 'input-label',
  'button-name': 'control-name',
  'link-name': 'control-name',
  'landmark-one-main': 'landmark-main',
  'page-has-heading-one': 'heading-h1',
  'heading-order': 'heading-order',
  'duplicate-id': 'duplicate-id',
  'duplicate-id-aria': 'duplicate-id',
  'aria-labelledby': 'aria-ref',
  'aria-describedby': 'aria-ref',
}

const selectorRelated = (a, b) => {
  if (!a || !b) return true
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Merge hand checks and mapped axe violations into one de-duplicated list.
 * Dedupe is exact on (kind, selector, detail) plus a cross-source guard: an
 * axe node is dropped when a hand finding already covers the same problem for
 * a related selector.
 */
export function mergeA11y({ hand = [], axe = [] } = {}) {
  const out = []
  const seen = new Set()
  for (const finding of hand) {
    const item = {
      source: 'hand',
      kind: finding.kind,
      detail: finding.detail,
      selector: finding.selector || '',
      wcag: criteriaFor(finding.kind),
    }
    const key = dedupeKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  for (const violation of axe) {
    const equivalentCheck = AXE_CHECK_EQUIVALENTS[violation.rule]
    for (const node of violation.nodes || []) {
      const item = {
        source: 'axe',
        kind: violation.kind,
        detail: `${violation.detail} — ${node.summary || node.target || ''}`.trim(),
        selector: node.target || '',
        wcag: violation.wcag || [],
        impact: violation.impact,
        helpUrl: violation.helpUrl,
      }
      const key = dedupeKey(item)
      if (seen.has(key)) continue
      const coveredByHand = out.some(
        (existing) =>
          existing.source === 'hand' &&
          ((equivalentCheck && existing.kind === equivalentCheck) ||
            (existing.wcag.some((a) => item.wcag.some((b) => b.id === a.id)) &&
              selectorRelated(existing.selector, item.selector))),
      )
      if (coveredByHand) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/** Group findings by criterion for the JSON summary. */
export function summarizeWcag(findings = []) {
  const counts = new Map()
  for (const finding of findings) {
    for (const criterion of finding.wcag || []) {
      const current = counts.get(criterion.id) || { ...criterion, count: 0 }
      current.count += 1
      counts.set(criterion.id, current)
    }
  }
  return [...counts.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/** Candidates that expose WCAG metadata without running a browser. */
export function describeWcag() {
  return {
    version: WCAG_VERSION,
    criteria: Object.fromEntries(
      Object.entries(WCAG_CRITERIA).map(([id, value]) => [id, { ...value }]),
    ),
    checks: Object.fromEntries(
      Object.entries(CHECK_CRITERIA).map(([check, ids]) => [check, [...ids]]),
    ),
  }
}
