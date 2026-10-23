#!/usr/bin/env node
/**
 * install.mjs — install the Design OS kit into a project or harness.
 *
 * Usage:
 *   node install.mjs --harness=opencode --target=../my-app
 *   node install.mjs --harness=dsh --scope=global --target=../my-app
 *   node install.mjs --harness=claude --target=../my-app --with-agents
 *   node install.mjs --harness=files --target=../my-app --upgrade
 *
 * What it does:
 *   1. copies this kit to <target>/.design-os/
 *   2. installs the seven workflow skills where the harness looks for them
 *   3. for OpenCode, adds /design-new, /design-review, /design-ship commands
 *   4. writes the harness instruction block (only with --with-agents)
 *
 * It never deletes anything. --force overwrites; --upgrade only adds missing
 * files. It does not install Playwright or any global dependency.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const KIT = path.dirname(fileURLToPath(import.meta.url))
const ADAPTER_DIR = path.join(KIT, 'adapters')
const ADAPTERS = Object.fromEntries(
  fs.readdirSync(ADAPTER_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const adapter = JSON.parse(fs.readFileSync(path.join(ADAPTER_DIR, name), 'utf8'))
      return [adapter.id, adapter]
    }),
)
const HARNESSES = Object.keys(ADAPTERS).sort()
const BOOLEAN = new Set(['dry-run', 'with-agents', 'force', 'upgrade', 'help', 'h'])
const VALUE = new Set(['harness', 'scope', 'target'])

function usage() {
  console.log(`Design OS installer

Usage: node install.mjs --harness=<${HARNESSES.join('|')}> [options]

Options:
  --target=<dir>           Project directory (required in practice; default:
                           current directory). Use the app you are designing,
                           not the Dezign0 checkout.
  --scope=project|global   Install skills for this project (default) or globally
  --with-agents            Append the design instructions to the harness instruction file
  --force                  Overwrite existing skill/command files and kit files
  --upgrade                Copy only missing kit/skill files (never overwrite)
  --dry-run                Print what would happen, write nothing
  --help                   Show this help

Notes:
  - The kit is always copied to <target>/.design-os.
  - Skills are copied to the harness's native directory. The path and the
    instruction file come from design-os/adapters/<harness>.json.
  - OpenCode also gets /design-new, /design-review and /design-ship commands.
  - Restart the harness after installing so it rescans skills.`)
}

function parseArgs(argv) {
  const out = {
    harness: 'files',
    scope: 'project',
    target: process.cwd(),
    dryRun: false,
    withAgents: false,
    force: false,
    upgrade: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    if (raw === '-h' || raw === '--help') {
      out.help = true
      continue
    }
    if (!raw.startsWith('--')) throw new Error(`unexpected argument: ${raw}`)
    const eq = raw.indexOf('=')
    const name = eq === -1 ? raw.slice(2) : raw.slice(2, eq)
    let value = eq === -1 ? undefined : raw.slice(eq + 1)
    if (BOOLEAN.has(name)) {
      if (value === undefined) {
        out[name === 'dry-run' ? 'dryRun' : name === 'with-agents' ? 'withAgents' : name] = true
      } else if (value === 'true' || value === 'false') {
        out[name === 'dry-run' ? 'dryRun' : name === 'with-agents' ? 'withAgents' : name] = value === 'true'
      } else {
        throw new Error(`--${name} must be true or false, got "${value}"`)
      }
      continue
    }
    if (!VALUE.has(name)) throw new Error(`unknown option: --${name}`)
    if (value === undefined) {
      value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`)
      i += 1
    }
    if (name === 'harness') out.harness = String(value).toLowerCase()
    else if (name === 'scope') out.scope = String(value).toLowerCase()
    else out.target = path.resolve(String(value))
  }
  if (out.help) return out
  if (!HARNESSES.includes(out.harness)) {
    throw new Error(`--harness must be one of: ${HARNESSES.join(', ')}`)
  }
  if (!['project', 'global'].includes(out.scope)) {
    throw new Error('--scope must be project or global')
  }
  if (out.force && out.upgrade) throw new Error('use either --force or --upgrade, not both')
  return out
}

function isInside(root, candidate) {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return 0
  }
  const { harness, scope, target, dryRun, withAgents, force, upgrade } = args
  const adapter = ADAPTERS[harness]

  if (target === KIT || isInside(KIT, target)) {
    throw new Error('target is inside the Dezign0 kit. Run with --target pointing at the app you are designing.')
  }
  if (target === path.dirname(KIT) && path.basename(KIT) === 'design-os' && fs.existsSync(path.join(target, 'package.json'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
    if (pkg.name === 'dezign0') {
      throw new Error('target is the Dezign0 package itself. Pass --target=<your-app>.')
    }
  }

  const kitTarget = path.join(target, '.design-os')
  if (fs.existsSync(kitTarget) && !fs.statSync(kitTarget).isDirectory()) {
    throw new Error(`${kitTarget} exists and is not a directory. Move it aside or remove it.`)
  }
  if (kitTarget === KIT) {
    console.log(`Kit already installed at ${kitTarget}; use --upgrade to add missing files.`)
    return 0
  }

  const actions = []
  const log = (msg) => { actions.push(msg); console.log(msg) }
  const rel = (p) => path.relative(process.cwd(), p) || p

  function copyTree(from, to, overwrite) {
    const stat = fs.statSync(from)
    if (stat.isDirectory()) {
      if (!dryRun) fs.mkdirSync(to, { recursive: true })
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        copyTree(path.join(from, entry.name), path.join(to, entry.name), overwrite)
      }
      return
    }
    if (fs.existsSync(to) && !overwrite) {
      log(`skip (exists): ${rel(to)}`)
      return
    }
    log(`${fs.existsSync(to) ? 'update' : 'copy'}: ${rel(from)} -> ${rel(to)}`)
    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
    }
  }

  function write(to, content, allowOverwrite = force || upgrade) {
    if (fs.existsSync(to) && !allowOverwrite) {
      log(`skip (exists): ${rel(to)}`)
      return
    }
    log(`${fs.existsSync(to) ? 'update' : 'write'}: ${rel(to)}`)
    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.writeFileSync(to, content)
    }
  }

  // 1. Kit
  if (fs.existsSync(kitTarget) && !force && !upgrade) {
    log(`skip (exists): ${rel(kitTarget)} (use --upgrade to add missing files or --force to replace)`)
  } else {
    if (!dryRun) fs.mkdirSync(kitTarget, { recursive: true })
    copyTree(KIT, kitTarget, force)
  }

  // 2. Skills
  const skillsDir = path.join(KIT, 'skills')
  const skills = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, 'SKILL.md')))
    : []
  const expandHome = (value) => value?.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value
  const projectSkillRoot = adapter.skills?.project?.[0]
  const globalSkillRoot = adapter.skills?.global?.[0]
  const skillRoot = adapter.skills
    ? (scope === 'global' ? expandHome(globalSkillRoot) : path.join(target, projectSkillRoot))
    : null
  if (skillRoot) {
    for (const name of skills) {
      const from = path.join(skillsDir, name)
      const to = path.join(skillRoot, name)
      if (fs.existsSync(to) && !force && !upgrade) {
        log(`skip (exists): ${rel(to)}`)
        continue
      }
      copyTree(from, to, force)
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

Write project artifacts under \`design/<slug>/\`; never edit \`.design-os/\`.
Use \`.design-os/briefs/BRIEF.md\` before writing code, \`.design-os/briefs/CRITIQUE.md\`
before calling work done, and \`.design-os/tools/design-lint.mjs\` plus
\`.design-os/tools/measure-artifact.mjs\` for mechanical checks. If the harness has
no browser, say the review is source-only. Do not invent metrics or filler copy.
`
  write(path.join(kitTarget, 'AGENTS.fragment.md'), fragment)

  const agentsPath = path.join(target, adapter.instructions.file)
  if (withAgents) {
    const start = '<!-- design-os:start -->'
    const end = '<!-- design-os:end -->'
    const block = `\n${start}\n${fragment}${end}\n`
    if (!fs.existsSync(agentsPath)) {
      write(agentsPath, `# AGENTS.md\n${block}`)
    } else {
      const existing = fs.readFileSync(agentsPath, 'utf8')
      if (existing.includes(start) && existing.includes(end)) {
        if (!force && !upgrade) {
          log(`skip: ${adapter.instructions.file} already contains the design-os block`)
        } else {
          const next = existing.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block.trim())
          log(`update: ${rel(agentsPath)} (managed design-os block)`)
          if (!dryRun) fs.writeFileSync(agentsPath, next)
        }
      } else if (existing.includes(start)) {
        throw new Error(`${adapter.instructions.file} has a design-os start marker but no end marker; fix it manually`)
      } else {
        log(`append: ${rel(agentsPath)}`)
        if (!dryRun) fs.appendFileSync(agentsPath, block)
      }
    }
  }

  // 5. Next steps
  console.log('\nInstalled into: ' + target)
  if (skillRoot) {
    console.log('Skills: ' + rel(skillRoot) + ` (${skills.length})`)
  } else {
    console.log(`Skills: not installed (${adapter.label} has no skill directory)`)
  }
  console.log('\nNext:')
  let step = 1
  if (!withAgents && harness !== 'files') {
    console.log(`  ${step++}. Add .design-os/AGENTS.fragment.md to ${adapter.instructions.file}, or rerun with --with-agents.`)
  }
  console.log(`  ${step++}. Restart the harness (or start a new session) so it rescans skills.`)
  console.log(`  ${step++}. In the project: "Read .design-os/DESIGN-OS.md and use the design-brief skill for: ..."`)
  if (harness === 'dsh' && scope === 'project') {
    console.log('  Note: if this DSH build only discovers global skills, rerun with --scope=global.')
  }
  if (['cursor','windsurf','cline','roo','openhands'].includes(harness)) {
    console.log('  Note: this harness also reads compatibility skill directories; see its adapter JSON.')
  }
  if (harness === 'opencode') {
    console.log(`  ${step++}. Try /design-new, /design-review, /design-ship in OpenCode.`)
  }
  if (dryRun) console.log('\n(dry run: no files were written)')
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`install: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
