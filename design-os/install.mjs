#!/usr/bin/env node
/**
 * install.mjs — install the Design OS kit into a project or harness.
 *
 * Usage:
 *   node install.mjs --harness=opencode
 *   node install.mjs --harness=dsh --scope=global
 *   node install.mjs --harness=claude --target=../my-app
 *   node install.mjs --harness=files --with-agents
 *   node install.mjs ... --dry-run
 *
 * What it does:
 *   1. copies this kit to <target>/.design-os/
 *   2. installs the six workflow skills where the harness looks for them
 *   3. for OpenCode, adds /design-new, /design-review, /design-ship commands
 *   4. writes an AGENTS.md fragment (and appends it only with --with-agents)
 *
 * It never deletes anything and never overwrites without --force. It does not
 * install Playwright or any global dependency.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const KIT = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = args.findIndex((a) => a === `--${name}`)
  if (i !== -1) return args[i + 1] ?? true
  const m = args.find((a) => a.startsWith(`--${name}=`))
  if (!m) return fallback
  return m.slice(name.length + 3)
}
const harness = String(flag('harness', 'files')).toLowerCase()
const scope = String(flag('scope', 'project')).toLowerCase()
const target = path.resolve(String(flag('target', process.cwd())))
const dry = !!flag('dry-run', false)
const withAgents = !!flag('with-agents', false)
const force = !!flag('force', false)
const validHarness = ['dsh', 'opencode', 'claude', 'codex', 'files']

if (args.includes('--help') || args.includes('-h') || !validHarness.includes(harness)) {
  console.log(`Design OS installer

Usage: node install.mjs --harness=<dsh|opencode|claude|codex|files> [options]

Options:
  --scope=project|global   Install skills for this project (default) or globally
  --target=<dir>           Project directory (default: current directory)
  --with-agents            Append the design instructions to AGENTS.md
  --force                  Overwrite existing skill/command files
  --dry-run                Print what would happen, write nothing
  --help                   Show this help

Notes:
  - The kit is always copied to <target>/.design-os.
  - Skills are copied to the harness's native directory:
      opencode: .opencode/skills/<name>/SKILL.md (or ~/.config/opencode/skills)
      dsh:      .agents/skills/<name>/SKILL.md   (or ~/.agents/skills)
      claude:   .claude/skills/<name>/SKILL.md   (or ~/.claude/skills)
      codex:    .agents/skills/<name>/SKILL.md
      files:    no skill copy
  - OpenCode also gets /design-new, /design-review and /design-ship commands.
  - Restart the harness after installing so it rescans skills.`)
  process.exit(validHarness.includes(harness) ? 0 : 2)
}

const stamp = () => new Date().toISOString()
const actions = []
const log = (msg) => { actions.push(msg); console.log(msg) }
const doCopy = (from, to) => {
  if (fs.existsSync(to) && !force) {
    log(`skip (exists): ${path.relative(process.cwd(), to)}`)
    return
  }
  log(`copy: ${path.relative(process.cwd(), from)} -> ${path.relative(process.cwd(), to)}`)
  if (dry) return
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}.git`),
  })
}
const write = (to, content) => {
  if (fs.existsSync(to) && !force) {
    log(`skip (exists): ${path.relative(process.cwd(), to)}`)
    return
  }
  log(`write: ${path.relative(process.cwd(), to)}`)
  if (dry) return
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.writeFileSync(to, content)
}

// 1. Kit
doCopy(KIT, path.join(target, '.design-os'))

// 2. Skills
const skillRoots = {
  opencode: scope === 'global' ? path.join(os.homedir(), '.config', 'opencode', 'skills') : path.join(target, '.opencode', 'skills'),
  dsh: scope === 'global' ? path.join(os.homedir(), '.agents', 'skills') : path.join(target, '.agents', 'skills'),
  claude: scope === 'global' ? path.join(os.homedir(), '.claude', 'skills') : path.join(target, '.claude', 'skills'),
  codex: scope === 'global' ? path.join(os.homedir(), '.agents', 'skills') : path.join(target, '.agents', 'skills'),
  files: null,
}
const skillsDir = path.join(KIT, 'skills')
const skills = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, 'SKILL.md')))
  : []
if (skillRoots[harness]) {
  for (const name of skills) {
    doCopy(path.join(skillsDir, name), path.join(skillRoots[harness], name))
  }
}

// 3. OpenCode commands
if (harness === 'opencode') {
  const commandRoot = scope === 'global'
    ? path.join(os.homedir(), '.config', 'opencode', 'commands')
    : path.join(target, '.opencode', 'commands')
  write(path.join(commandRoot, 'design-new.md'), `---
description: Start a design task from a checkable brief
agent: build
---
Read .design-os/DESIGN-OS.md and .design-os/skills/design-brief/SKILL.md.
Create a numeric brief and design read for: $ARGUMENTS.
Do not write code in this turn. Stop after the brief and assumptions.
`)
  write(path.join(commandRoot, 'design-review.md'), `---
description: Run an evidence-based design critique
agent: build
---
Read .design-os/DESIGN-OS.md, .design-os/skills/critique/SKILL.md and
.design-os/briefs/CRITIQUE.md. Review the artifact at: $ARGUMENTS.
Read from disk; measure with .design-os/tools/measure-artifact.mjs if Playwright
is available; otherwise say "source-only review". Score five dimensions, cite
file:line or measured values, and keep the artifact read-only.
`)
  write(path.join(commandRoot, 'design-ship.md'), `---
description: Fix critique findings and produce a handover
agent: build
---
Read .design-os/DESIGN-OS.md, the current critique and the artifact at: $ARGUMENTS.
Fix the artifact for every must-fix item, re-read from disk, re-score, then
produce HANDOVER.md, TOKENS.md and tokens.css using the kit templates.
`)
}

// 4. AGENTS fragment
const fragment = `## Design work

Before any UI, page, component, widget, deck or visual artifact, read
\`.design-os/DESIGN-OS.md\` and follow its loop:

Design Read -> Brief -> Direction/Design System -> Design Spec -> Build ->
Self-check -> Critique -> Fix -> Handover -> Memory.

Use \`.design-os/briefs/BRIEF.md\` before writing code, \`.design-os/briefs/CRITIQUE.md\`
before calling work done, and \`.design-os/tools/design-lint.mjs\` plus
\`.design-os/tools/measure-artifact.mjs\` for mechanical checks. If the harness has
no browser, say the review is source-only. Do not invent metrics or filler copy.
`
const fragmentPath = path.join(target, '.design-os', 'AGENTS.fragment.md')
write(fragmentPath, fragment)

const agentsPath = path.join(target, 'AGENTS.md')
if (withAgents) {
  const start = '<!-- design-os:start -->'
  const end = '<!-- design-os:end -->'
  const block = `\n${start}\n${fragment}${end}\n`
  if (!fs.existsSync(agentsPath)) {
    write(agentsPath, `# AGENTS.md\n${block}`)
  } else {
    const existing = fs.readFileSync(agentsPath, 'utf8')
    if (existing.includes(start)) {
      log('skip: AGENTS.md already contains the design-os block')
    } else {
      log(`append: ${path.relative(process.cwd(), agentsPath)}`)
      if (!dry) fs.appendFileSync(agentsPath, block)
    }
  }
}

// 5. Next steps
console.log('\nInstalled into: ' + target)
if (skillRoots[harness]) {
  console.log('Skills: ' + path.relative(process.cwd(), skillRoots[harness]) + ` (${skills.length})`)
} else {
  console.log('Skills: not installed (harness=files)')
}
console.log('\nNext:')
let step = 1
if (!withAgents && harness !== 'files') {
  console.log(`  ${step++}. Add .design-os/AGENTS.fragment.md to your AGENTS.md, or rerun with --with-agents.`)
}
console.log(`  ${step++}. Restart the harness (or start a new session) so it rescans skills.`)
console.log(`  ${step++}. In the project: "Read .design-os/DESIGN-OS.md and use the design-brief skill for: ..."`)
if (harness === 'dsh' && scope === 'project') {
  console.log('  Note: if this DSH build only discovers global skills, rerun with --scope=global.')
}
if (harness === 'opencode') {
  console.log(`  ${step++}. Try /design-new, /design-review, /design-ship in OpenCode.`)
}
if (dry) console.log('\n(dry run: no files were written)')
