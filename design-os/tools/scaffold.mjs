#!/usr/bin/env node
/**
 * scaffold.mjs — create a design project folder with the kit's project contract.
 *
 * Usage:
 *   node scaffold.mjs new <slug> --profile=dashboard
 *   node scaffold.mjs new billing --profile=email --root=../app
 *   node scaffold.mjs list
 *
 * What it does:
 *   creates <root>/design/<slug>/ with project.json, BRIEF.md, DESIGN-SPEC.md,
 *   CRITIQUE.md, HANDOVER.md, MEMORY.md, tokens.css and ANNOTATIONS.json.
 *
 * Contract:
 *   - the target must resolve inside <root>/design; path traversal is refused;
 *   - <root> must look like a project (a kit, design, git or agent marker);
 *   - an existing project folder is never overwritten without --force;
 *   - --force rewrites only the files this tool owns, never deletes others;
 *   - --dry-run prints the plan and writes nothing.
 *
 * Exit codes:
 *   0  project created (or dry run planned)
 *   1  refused: invalid target, existing folder, or not a project root
 *   2  usage error
 *
 * No dependencies. Node 18+.
 */
import fs from 'node:fs'
import path from 'node:path'

const SCRIPT = process.argv[1] ? path.resolve(process.argv[1]) : 'scaffold.mjs'

const INTERACTION_STATES = ['default', 'hover', 'focus-visible', 'active', 'selected', 'disabled']
const DATA_STATES = ['loading', 'empty', 'error', 'populated', 'edge']

const PROFILES = {
  prototype: {
    label: 'Product prototype',
    entry: 'index.html',
    surface: 'runnable web prototype',
    viewports: ['375x812', '768x1024', '1440x900'],
    targetSizes: [],
    states: [...INTERACTION_STATES, 'loading', 'empty', 'error'],
    skills: ['design-brief', 'frontend-design', 'critique'],
    deliverables: [
      '`index.html` — primary flow, real controls and real states (single self-contained file).',
      '`tokens.css` — the token layer used by the artifact.',
    ],
    notes: 'Every control does what it says; a prototype is a working model, not a poster.',
  },
  landing: {
    label: 'Marketing / landing page',
    entry: 'index.html',
    surface: 'marketing page',
    viewports: ['375x812', '768x1024', '1440x900'],
    targetSizes: ['hero: 1440x900 viewport'],
    states: [...INTERACTION_STATES, 'loading', 'error'],
    skills: ['design-brief', 'frontend-design', 'critique'],
    deliverables: [
      '`index.html` — hero, proof and primary CTA; real content or labelled slots.',
      '`tokens.css` — the token layer used by the page.',
    ],
    notes: 'The hero fits the first viewport; no generic feature-three skeleton.',
  },
  dashboard: {
    label: 'Dashboard / data UI',
    entry: 'index.html',
    surface: 'dashboard or data surface',
    viewports: ['1440x900', '1024x768', '768x1024', '390x844'],
    targetSizes: ['145x188'],
    states: [...INTERACTION_STATES, ...DATA_STATES],
    skills: ['design-brief', 'frontend-design', 'state-board', 'critique'],
    deliverables: [
      '`index.html` — the operational surface with real data states.',
      '`tokens.css` — the token layer used by the artifact.',
    ],
    notes: 'One dominant region; five data states; tabular numerals for changing values.',
  },
  deck: {
    label: 'Presentation / deck',
    entry: 'deck.html',
    surface: '16:9 presentation',
    viewports: ['1920x1080'],
    targetSizes: ['1920x1080'],
    states: ['default'],
    skills: ['design-brief', 'frontend-design', 'critique'],
    deliverables: [
      '`deck.html` — one idea per slide, keyboard navigation, print/PDF fallback.',
      '`tokens.css` — the token layer used by the slides.',
    ],
    notes: 'Slide title states the takeaway; body text readable at presentation size.',
  },
  document: {
    label: 'Document / report',
    entry: 'report.html',
    surface: 'document or report',
    viewports: ['1440x900', '1024x900'],
    targetSizes: ['A4: 794x1123'],
    states: ['default', 'print'],
    skills: ['design-brief', 'frontend-design', 'critique'],
    deliverables: [
      '`report.html` — executive summary first; print/PDF behavior defined.',
      '`tokens.css` — the token layer used by the document.',
    ],
    notes: 'Body measure 50–75ch; headings form a readable outline; sources cited.',
  },
  email: {
    label: 'Email',
    entry: 'email.html',
    surface: 'HTML email',
    viewports: ['600x800', '375x800'],
    targetSizes: ['600x800'],
    states: ['default', 'dark-mode'],
    skills: ['design-brief', 'frontend-design', 'critique'],
    deliverables: [
      '`email.html` — table-safe layout, inline styles, max width 600px.',
      '`tokens.css` — token values mirrored inline where the client requires it.',
    ],
    notes: 'No external CSS dependency; alt text and dark-mode behavior stated.',
  },
  mobile: {
    label: 'Mobile app screen or flow',
    entry: 'app.html',
    surface: 'mobile app flow',
    viewports: ['390x844', '375x812', '360x800'],
    targetSizes: ['44x44 touch target'],
    states: [...INTERACTION_STATES, ...DATA_STATES],
    skills: ['design-brief', 'frontend-design', 'state-board', 'critique'],
    deliverables: [
      '`app.html` — screens with safe areas, tab/nav model and real states.',
      '`tokens.css` — the token layer used by the screens.',
    ],
    notes: 'Safe areas, 44x44 targets, no horizontal scroll, focus states preserved.',
  },
  'component-library': {
    label: 'Component library',
    entry: 'index.html',
    surface: 'component gallery and contract',
    viewports: ['1440x900'],
    targetSizes: [],
    states: INTERACTION_STATES,
    skills: ['design-brief', 'frontend-design', 'state-board', 'critique'],
    deliverables: [
      '`index.html` — component gallery with every variant and state rendered.',
      '`tokens.css` — the token layer every component consumes.',
    ],
    notes: 'One component = one job; variant axes and state matrix explicit; no one-off styles.',
  },
}

const MARKERS = ['.design-os', 'design', '.git', 'AGENTS.md', 'CLAUDE.md', 'package.json']
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

const args = process.argv.slice(2)
const command = args[0]
const isHelp = args.includes('--help') || args.includes('-h')
const getOption = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  if (i !== -1) {
    const next = args[i + 1]
    return next && !next.startsWith('--') ? next : true
  }
  return null
}
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const asJson = args.includes('--json')

function usage(exitCode) {
  console.log(`scaffold — create a design project folder

Usage: node scaffold.mjs new <slug> --profile=<profile> [options]
       node scaffold.mjs list

Profiles:
  ${Object.keys(PROFILES).join(', ')}

Options:
  --profile=<name>   Required for new; one of the profiles above.
  --root=<dir>       Project root (default: current directory).
  --force            Rewrite the scaffold files in an existing project folder
                     (ANNOTATIONS.json is always kept).
  --dry-run          Print the plan; write nothing.
  --json             Print a machine-readable result.
  --help             Show this help.

The target is <root>/design/<slug>. Traversal outside <root>/design is refused,
and a folder is never overwritten without --force.

Exit codes: 0 created, 1 refused, 2 usage error.`)
  process.exit(exitCode)
}

if (isHelp || !command) usage(isHelp ? 0 : 2)
if (command === 'list') {
  const rows = Object.entries(PROFILES).map(([id, p]) => ({
    id,
    label: p.label,
    entry: p.entry,
    viewports: p.viewports.join(', '),
    states: p.states.join(', '),
  }))
  if (asJson) {
    console.log(JSON.stringify({ profiles: rows }, null, 2))
  } else {
    const width = Math.max(...rows.map((r) => r.id.length))
    for (const row of rows) console.log(`${row.id.padEnd(width)}  ${row.label} — ${row.entry} [${row.viewports}]`)
  }
  process.exit(0)
}
if (command !== 'new') {
  console.error(`scaffold: unknown command "${command}". Use "new" or "list".`)
  usage(2)
}

const slug = args[1] && !args[1].startsWith('--') ? args[1] : ''
const profileId = String(getOption('profile') || '')
const rootArg = getOption('root')

if (!slug) {
  console.error('scaffold: missing <slug>.\n  node scaffold.mjs new <slug> --profile=<profile>')
  usage(2)
}
if (!profileId) {
  console.error(`scaffold: missing --profile. One of: ${Object.keys(PROFILES).join(', ')}`)
  usage(2)
}
const profile = PROFILES[profileId]
if (!profile) {
  console.error(`scaffold: unknown profile "${profileId}". One of: ${Object.keys(PROFILES).join(', ')}`)
  process.exit(2)
}
if (!SLUG_RE.test(slug)) {
  console.error(`scaffold: invalid slug "${slug}". Use lowercase letters, numbers and hyphens, 1–64 chars, no leading/trailing hyphen.`)
  process.exit(1)
}

const root = path.resolve(rootArg && rootArg !== true ? String(rootArg) : process.cwd())
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`scaffold: project root does not exist or is not a directory: ${root}`)
  process.exit(2)
}
if (!MARKERS.some((marker) => fs.existsSync(path.join(root, marker)))) {
  console.error(`scaffold: refusing to scaffold outside a project.\n  root: ${root}\n  no marker found (${MARKERS.join(', ')}). Run from the project root or pass --root.`)
  process.exit(1)
}

const realRoot = fs.realpathSync(root)
const designDir = path.join(root, 'design')
const target = path.join(designDir, slug)

if (fs.existsSync(designDir) && !fs.statSync(designDir).isDirectory()) {
  console.error(`scaffold: ${path.relative(process.cwd(), designDir)} exists and is not a directory.`)
  process.exit(1)
}

function inside(base, candidate) {
  const rel = path.relative(base, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
if (!inside(realRoot, target)) {
  console.error(`scaffold: refusing target outside the project: ${target}`)
  process.exit(1)
}
// A symlinked design/ folder must not point outside the project either.
if (fs.existsSync(designDir)) {
  const realDesign = fs.realpathSync(designDir)
  if (!inside(realRoot, realDesign)) {
    console.error(`scaffold: design/ resolves outside the project: ${realDesign}`)
    process.exit(1)
  }
}
if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
  console.error(`scaffold: ${path.relative(process.cwd(), target)} exists and is not a directory.`)
  process.exit(1)
}
const exists = fs.existsSync(target)
const existing = exists
  ? fs.readdirSync(target, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  : []

if (exists && !force) {
  console.error(`scaffold: ${path.relative(process.cwd(), target)} already exists; refusing to overwrite.`)
  if (existing.length) console.error(`  files: ${existing.join(', ')}`)
  console.error('  rerun with --force to rewrite the scaffold files (other files are kept).')
  process.exit(1)
}

const now = new Date().toISOString()
const project = {
  schema: 'dezign0/project/v1',
  slug,
  profile: profileId,
  created: now,
  updated: now,
  status: 'draft',
  systemPin: { id: null, source: null, version: null },
  skillPins: profile.skills,
  constraints: {
    surface: profile.surface,
    entry: profile.entry,
    viewports: profile.viewports,
    targetSizes: profile.targetSizes,
    states: profile.states,
    breakpoints: ['320', '375', '390', '768', '1024', '1440'],
    a11y: 'WCAG 2.2 AA',
    dependencies: 'none',
  },
  artifacts: [{ role: 'entry', path: profile.entry, status: 'planned' }],
  coverage: { notReviewed: [] },
}

const files = {
  'project.json': `${JSON.stringify(project, null, 2)}\n`,
  'BRIEF.md': briefMd(),
  'DESIGN-SPEC.md': designSpecMd(),
  'CRITIQUE.md': critiqueMd(),
  'HANDOVER.md': handoverMd(),
  'MEMORY.md': memoryMd(),
  'tokens.css': tokensCss(),
  'ANNOTATIONS.json': `${JSON.stringify(annotationsSkeleton(), null, 2)}\n`,
}

function briefMd() {
  return [
    `# ${slug} — design brief`,
    '',
    `Profile: \`${profileId}\` — ${profile.label}. Scaffolded ${now.slice(0, 10)}; status: draft.`,
    `Metadata: \`project.json\`. Full template: \`.design-os/briefs/BRIEF.md\`.`,
    '',
    'A brief is a measuring instrument. Fill every field with a number, a value or',
    'an explicit assumption. A brief with no numbers is not ready.',
    '',
    '## 1. What this is',
    '',
    '- Product / feature:',
    "- User complaint or goal, in the user's words:",
    '- Who this is for (audience, context of use):',
    '- What success looks like (one measurable sentence):',
    '',
    '## 2. Physical constraints (hard)',
    '',
    `- Surface / platform: ${profile.surface}`,
    `- Entry point: \`${profile.entry}\``,
    `- Target sizes: ${profile.targetSizes.length ? profile.targetSizes.join(', ') : 'enumerate every real size'}`,
    `- Viewports to check: ${profile.viewports.join(', ')}`,
    '- Grid / container / min-max:',
    '- Existing tokens / design system: `tokens.css` (starter; replace with the brand)',
    '- Dependencies allowed: none',
    '',
    '## 3. Visual system',
    '',
    '- Brand system (`DESIGN.md` path) or "propose one":',
    '- Design-language pin (`dezign0_design_systems` slug, optional):',
    '- Type pairing:',
    '- Spacing / radius / elevation:',
    '- One distinctive move:',
    '',
    '## 4. Content',
    '',
    '- Real copy supplied:',
    '- Data that must not be invented:',
    '- Sample-data policy and label:',
    '- Names / locales:',
    '',
    '## 5. Accessibility and states',
    '',
    '- Floor: WCAG 2.2 AA — 4.5:1 body, 3:1 large/UI, 24x24 minimum target, 44x44 touch',
    `- Required states: ${profile.states.join(', ')}`,
    '- Reduced motion:',
    '- RTL / forced colors (if relevant):',
    '',
    '## 6. Deliverables',
    '',
    ...profile.deliverables.map((line, i) => `${i + 1}. ${line}`),
    '- Format: single self-contained HTML unless the project says otherwise',
    '- Do not add unrequested deliverables',
    '',
    '## 7. Assumptions and exclusions',
    '',
    '- Assumption: — risk:',
    '- Out of scope:',
    '',
    '## 8. Check',
    '',
    '- Could a reviewer verify each line? Rewrite anything that is not measurable.',
    '- Record unresolved unknowns; do not silently fill them.',
    '',
    `Profile note: ${profile.notes}`,
    '',
  ].join('\n')
}

function designSpecMd() {
  const stateRows = profile.states.map((state) => `| ${state} | | | |`).join('\n')
  return [
    `# ${slug} — design spec`,
    '',
    `Profile: \`${profileId}\`. Freeze these values before markup; copy the final`,
    'values into `tokens.css`. If the artifact disagrees with this spec, the',
    'artifact is wrong unless the change is recorded here.',
    '',
    '## 1. Intent',
    '',
    '- Deliverable type:',
    '- One-line design read:',
    '- Dials (variance / motion / density):',
    '- Distinctive move:',
    '',
    '## 2. Palette',
    '',
    '| Token | Role | Light | Dark | Contrast pair |',
    '|---|---|---|---|---|',
    '| `--bg` | page ground | | | — |',
    '| `--surface` | card / panel | | | — |',
    '| `--fg` | primary ink | | | fg on bg: |',
    '| `--muted` | secondary ink | | | muted on surface: |',
    '| `--border` | hairline | | | decorative / structural |',
    '| `--accent` | single accent | | | accent on surface: |',
    '| `--accent-on` | ink on accent | | | |',
    '| `--success` | success | | | |',
    '| `--warn` | warning | | | |',
    '| `--danger` | error | | | |',
    '| `--focus-ring` | focus indicator | | | ≥3:1 vs adjacent |',
    '',
    '- Accent budget: at most two visible uses per screen.',
    '- Deliberate contrast exceptions (with reason):',
    '',
    '## 3. Type',
    '',
    '| Token | Size | Line height | Weight | Tracking | Use |',
    '|---|---|---|---|---|---|',
    '| `--display` | | | | | |',
    '| `--h1` | | | | | |',
    '| `--h2` | | | | | |',
    '| `--h3` | | | | | |',
    '| `--body` | | | | | |',
    '| `--small` | | | | | |',
    '| `--micro` | | | | | |',
    '',
    '- Families and fallback chain:',
    '',
    '## 4. Space, shape, depth',
    '',
    '- Base unit / steps: 4px; 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64',
    '- Radius scale:',
    '- Border logic:',
    '- Shadow scale:',
    '- Container / grid:',
    '',
    '## 5. Components and states',
    '',
    '- Components:',
    '',
    '| State | Trigger | Rendered as | Notes |',
    '|---|---|---|---|',
    stateRows,
    '',
    'Data surfaces additionally render loading, empty, error, populated and edge.',
    '',
    '## 6. Motion',
    '',
    '- Durations / easings:',
    '- What moves:',
    '- Reduced motion: remove translate/scale/parallax; keep opacity/color.',
    '',
    '## 7. Accessibility',
    '',
    '- Contrast pairs measured (light and dark):',
    '- Focus style and order:',
    '- Keyboard map:',
    '- Labels / live regions:',
    '- Target sizes:',
    '',
    '## 8. Responsive',
    '',
    `- Viewports: ${profile.viewports.join(', ')}`,
    '- Canonical breakpoints: 320 / 375 / 390 / 768 / 1024 / 1440',
    '- What reflows, what drops, what stays:',
    '- No horizontal scroll; nothing clipped (verify with `measure-artifact --a11y`).',
    '',
    '## 9. Content',
    '',
    '- Copy inventory:',
    '- Number / date / currency format:',
    '- Sample-data label:',
    '',
  ].join('\n')
}

function critiqueMd() {
  return [
    `# ${slug} — critique`,
    '',
    `Profile: \`${profileId}\`. Status: not run.`,
    '',
    'Read the artifact from disk; do not review from memory. Follow',
    '`.design-os/briefs/CRITIQUE.md`. Fill every scored line with evidence.',
    '',
    '## Method and scope',
    '',
    `- Artifact(s): \`${profile.entry}\``,
    `- Viewports: ${profile.viewports.join(', ')}`,
    '- Browser / Playwright:',
    '- Source access:',
    '- Artifact modified: no',
    '',
    '## Scores',
    '',
    '| Dimension | Score | Band | Evidence |',
    '|---|---|---|---|',
    '| Philosophy consistency | | | |',
    '| Visual hierarchy | | | |',
    '| Detail | | | |',
    '| Functionality | | | |',
    '| Innovation | | | |',
    '',
    'Composite: — (mean of scored dimensions; no scored dimension below 7).',
    '',
    '## Measured counters',
    '',
    '- ',
    '',
    '## What holds',
    '',
    '- ',
    '',
    '## What to fix',
    '',
    '- [P0] — selector — `file:line` — cause — fix',
    '- [P1] — selector — `file:line` — cause — fix',
    '',
    '## Quick wins',
    '',
    '- ',
    '',
    '## Not reviewed',
    '',
    '- ',
    '',
    '## Element anchors',
    '',
    'Record fix-list items that target an element in `ANNOTATIONS.json` (contract:',
    '`.design-os/briefs/ANNOTATIONS.md`), then bundle the review with',
    '`node .design-os/tools/bundle.mjs design/<slug>`.',
    '',
  ].join('\n')
}

function handoverMd() {
  return [
    `# ${slug} — handover`,
    '',
    `Profile: \`${profileId}\`. Written for the implementer, not the designer.`,
    '',
    'Read order: artifact → `tokens.css` → `CRITIQUE.md` → this file.',
    'Add `TOKENS.md` when the token roles are documented (copy',
    '`.design-os/briefs/TOKENS.md`).',
    '',
    '## 1. What ships',
    '',
    '| Output | Source | Notes |',
    '|---|---|---|',
    `| \`${profile.entry}\` | | entry point |`,
    '| `tokens.css` | | token layer |',
    '',
    '## 2. Platform / build blockers',
    '',
    '- ',
    '',
    '## 3. Scoping',
    '',
    '- Included:',
    '- Explicitly excluded:',
    '- Not to change:',
    '',
    '## 4. DOM / class contract',
    '',
    '```text',
    '.root',
    '├─ .region',
    '│  ├─ .title',
    '│  └─ .control',
    '```',
    '',
    '- Stable IDs / hooks (`data-od-id`):',
    '- Non-negotiable structure:',
    '',
    '## 5. Behavior contract',
    '',
    '| Input / event | Behavior | Notes |',
    '|---|---|---|',
    '| | | |',
    '',
    '## 6. State matrix',
    '',
    `| State | Trigger | Rendered as |`,
    '|---|---|---|',
    ...profile.states.map((state) => `| ${state} | | |`),
    '',
    '## 7. Storage / data',
    '',
    '- Schema / keys / migration:',
    '- Failure mode when storage is unavailable:',
    '',
    '## 8. Do not regress',
    '',
    '| Do not | Why |',
    '|---|---|',
    '| | |',
    '',
    '## 9. Acceptance checklist',
    '',
    'Numbered, measurable assertions:',
    '',
    `1. \`${profile.entry}\` opens from disk with no console errors.`,
    `2. No horizontal scroll at ${profile.viewports.join(', ')}.`,
    '3. Every state in section 6 renders and is reachable.',
    '4. Contrast measured: 4.5:1 body, 3:1 large/UI.',
    '5. Keyboard: every control reachable, focus visible.',
    '',
    '## 10. Known limits',
    '',
    '- Limit: — why accepted: — what to do if it becomes a requirement:',
    '',
    '## 11. Handoff record',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Artifact @ commit | |',
    '| Tokens @ commit | |',
    '| Approved deviations | |',
    '| Framework guide used | |',
    '',
  ].join('\n')
}

function memoryMd() {
  return [
    `# ${slug} — design memory index`,
    '',
    'One fact per file; this file only indexes them. Convention:',
    '`.design-os/briefs/MEMORY.md`. Keep the index short and keep durable rules',
    'out of chat history.',
    '',
    '## Facts',
    '',
    '- (none yet)',
    '',
    '## Decisions',
    '',
    'Consequential choices get an ADR instead of a memory fact:',
    '`decisions/ADR-0001-<slug>.md` (template: `.design-os/briefs/ADR.md`).',
    '',
    '## Format for a new fact',
    '',
    '```md',
    '---',
    'name: short-kebab-slug',
    'description: one sentence that makes the rule retrievable',
    'type: feedback | project | reference | profile',
    'updated: YYYY-MM-DD',
    '---',
    '',
    '**Rule.** One or two sentences.',
    '**Why.** The constraint or bug that produced it.',
    '**Applies to.** Product/artifact scope.',
    '```',
    '',
  ].join('\n')
}

function tokensCss() {
  return [
    `/* ${slug} — token layer (starter values; replace with the brand or chosen direction).`,
    ' * Roles are the contract. Component CSS consumes var(--role) only.',
    ' * Keep light and dark intentional; never invert one to make the other.',
    ' */',
    '',
    ':root {',
    '  color-scheme: light dark;',
    '',
    '  --bg: #fafafa;',
    '  --surface: #ffffff;',
    '  --fg: #16181a;',
    '  --muted: #5b6167;',
    '  --border: #e2e5e8;',
    '',
    '  --accent: #2f6feb;',
    '  --accent-on: #ffffff;',
    '  --focus-ring: #2f6feb;',
    '  --success: #12805c;',
    '  --warn: #a15c00;',
    '  --danger: #b3261e;',
    '',
    '  --font-display: ui-sans-serif, system-ui, sans-serif;',
    '  --font-body: ui-sans-serif, system-ui, sans-serif;',
    '  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;',
    '',
    '  --text-display: 48px;',
    '  --text-h1: 32px;',
    '  --text-h2: 24px;',
    '  --text-h3: 20px;',
    '  --text-body: 16px;',
    '  --text-small: 14px;',
    '  --text-micro: 12px;',
    '',
    '  --space-1: 4px;',
    '  --space-2: 8px;',
    '  --space-3: 12px;',
    '  --space-4: 16px;',
    '  --space-6: 24px;',
    '  --space-8: 32px;',
    '',
    '  --radius-sm: 4px;',
    '  --radius-md: 8px;',
    '  --radius-lg: 16px;',
    '',
    '  --motion-fast: 100ms;',
    '  --motion-base: 150ms;',
    '  --ease-ui: cubic-bezier(0.2, 0, 0, 1);',
    '}',
    '',
    '[data-theme="dark"] {',
    '  color-scheme: dark;',
    '',
    '  --bg: #0f1012;',
    '  --surface: #171a1d;',
    '  --fg: #f2f4f6;',
    '  --muted: #a3a9b0;',
    '  --border: #2a2f35;',
    '',
    '  --accent: #6f9bff;',
    '  --accent-on: #0f1012;',
    '  --focus-ring: #6f9bff;',
    '  --success: #47c79a;',
    '  --warn: #e0a33a;',
    '  --danger: #ff7b72;',
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    '    color-scheme: dark;',
    '    --bg: #0f1012;',
    '    --surface: #171a1d;',
    '    --fg: #f2f4f6;',
    '    --muted: #a3a9b0;',
    '    --border: #2a2f35;',
    '    --accent: #6f9bff;',
    '    --accent-on: #0f1012;',
    '    --focus-ring: #6f9bff;',
    '    --success: #47c79a;',
    '    --warn: #e0a33a;',
    '    --danger: #ff7b72;',
    '  }',
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  *, *::before, *::after {',
    '    transition-duration: 0.01ms !important;',
    '    animation-duration: 0.01ms !important;',
    '    animation-iteration-count: 1 !important;',
    '    scroll-behavior: auto !important;',
    '  }',
    '}',
    '',
    '/* TODO: replace starter values with the brand or chosen direction; keep role names. */',
    '',
  ].join('\n')
}

function annotationsSkeleton() {
  return {
    schema: 'dezign0/annotations/v1',
    project: slug,
    round: 1,
    updated: now,
    items: [],
  }
}

if (dryRun) {
  const annotationExists = existing.includes('ANNOTATIONS.json')
  const keptNames = existing.filter((name) => !(name in files) || (name === 'ANNOTATIONS.json' && annotationExists))
  const payload = {
    ok: true,
    dryRun: true,
    root,
    slug,
    profile: profileId,
    target,
    create: Object.keys(files),
    existing,
    overwrite: exists ? Object.keys(files).filter((name) => existing.includes(name) && name !== 'ANNOTATIONS.json') : [],
    kept: keptNames,
  }
  if (asJson) console.log(JSON.stringify(payload, null, 2))
  else {
    console.log(`scaffold: would create ${path.relative(process.cwd(), target)} (${profileId})`)
    for (const name of Object.keys(files)) {
      const action = !exists ? 'create' : name === 'ANNOTATIONS.json' && annotationExists ? 'keep' : existing.includes(name) ? 'overwrite' : 'create'
      console.log(`  ${action}: ${name}`)
    }
    for (const name of keptNames) if (!(name in files)) console.log(`  keep: ${name}`)
    console.log('scaffold: dry run, nothing written')
  }
  process.exit(0)
}

fs.mkdirSync(target, { recursive: true })
const realTarget = fs.realpathSync(target)
if (!inside(realRoot, realTarget)) {
  console.error(`scaffold: refusing target outside the project after resolution: ${realTarget}`)
  process.exit(1)
}

const created = []
const overwritten = []
const kept = existing.filter((name) => !(name in files))
try {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(target, name)
    // ANNOTATIONS.json accumulates review history; never rewrite it, even with
    // --force. Delete it by hand if a project genuinely needs a reset.
    if (name === 'ANNOTATIONS.json' && fs.existsSync(file)) {
      kept.push(name)
      continue
    }
    const existed = fs.existsSync(file)
    fs.writeFileSync(file, content)
    if (existed) overwritten.push(name)
    else created.push(name)
  }
} catch (error) {
  console.error(`scaffold: could not write ${path.relative(process.cwd(), target)}: ${error.message}`)
  console.error(`  files written before the failure: ${[...created, ...overwritten].join(', ') || 'none'}`)
  process.exit(1)
}
const result = {
  ok: true,
  root,
  slug,
  profile: profileId,
  target,
  created,
  overwritten,
  kept,
  project,
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`scaffold: created ${path.relative(process.cwd(), target)} (${profileId})`)
  for (const name of created) console.log(`  create: ${name}`)
  for (const name of overwritten) console.log(`  overwrite: ${name}`)
  for (const name of kept) console.log(`  keep: ${name}`)
  const toolsDir = path.dirname(SCRIPT)
  const rel = (p) => {
    const r = path.relative(root, p)
    return r.startsWith('..') ? p : r
  }
  const projectRel = rel(target)
  console.log('\nNext:')
  console.log(`  1. Fill ${path.join(projectRel, 'BRIEF.md')} (skill: design-brief).`)
  console.log(`  2. Freeze ${path.join(projectRel, 'DESIGN-SPEC.md')}, then build ${profile.entry}.`)
  console.log(`  3. Lint: node ${rel(path.join(toolsDir, 'design-lint.mjs'))} ${path.join(projectRel, profile.entry)}`)
  console.log(`  4. Bundle the review: node ${rel(path.join(toolsDir, 'bundle.mjs'))} ${projectRel}`)
}
process.exit(0)
