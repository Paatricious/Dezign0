#!/usr/bin/env node
/**
 * review.mjs — review workflow for a design project: git-backed history,
 * approval, anchored annotations and the select → instruction → patch protocol.
 *
 * Usage:
 *   node review.mjs history list <slug> [--root=.]
 *   node review.mjs history save <slug> [-m "message"] [--json]
 *   node review.mjs history restore <slug> <hash> --confirm=<hash> [--dry-run]
 *   node review.mjs approve <slug> [--artifact=index.html] [--by=Name] [--note=text]
 *   node review.mjs annotate add <slug> --selector=.cta --note="..." [options]
 *   node review.mjs annotate list <slug> [--status=open] [--severity=P0]
 *   node review.mjs annotate resolve <slug> <id> [--evidence="change ref"]
 *   node review.mjs protocol describe [--json]
 *   node review.mjs protocol validate <file|-> [--verify] [--json]
 *   node review.mjs --self-test
 *
 * Contract:
 *   - histories live under refs/dezign0/<slug>/<commit>; HEAD and the index are
 *     never touched, and snapshots include ignored files under design/<slug>;
 *   - approval writes the same approved_by/approved_at/artifact_hash pair into
 *     project.json and HANDOVER.md;
 *   - annotations follow .design-os/briefs/ANNOTATIONS.md exactly;
 *   - every path is resolved and checked inside the project root.
 *
 * Exit codes: 0 ok, 1 refused/invalid finding, 2 usage or environment error.
 * No dependencies. Node 18+.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const SELF = process.argv[1] ? path.resolve(process.argv[1]) : 'review.mjs'
const PROTOCOL_SCHEMA = 'dezign0/review-protocol/v1'
const ANNOTATIONS_SCHEMA = 'dezign0/annotations/v1'
const PROJECT_SCHEMA = 'dezign0/project/v1'
const SEVERITIES = ['P0', 'P1', 'P2', 'nit']
const STATUSES = ['open', 'in-progress', 'resolved', 'wontfix', 'accepted']
const PROTOCOL_TYPES = ['select', 'instruction', 'patch']
const PATCH_FORMATS = ['search-replace', 'unified-diff', 'full-file']
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const HASH_RE = /^[a-f0-9]{40,64}$/

class ReviewError extends Error {
  constructor(message, code = 2) {
    super(message)
    this.code = code
  }
}

// ── CLI parsing ────────────────────────────────────────────────────────────
const BOOL_FLAGS = new Set(['json', 'help', 'quiet', 'dry-run', 'verify', 'self-test', 'force'])
const VALUE_FLAGS = new Set([
  'root', 'message', 'confirm', 'by', 'at', 'artifact', 'note', 'selector', 'severity',
  'status', 'author', 'box', 'viewport', 'round', 'id', 'evidence', 'object',
])

function parseArgs(argv) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg === '-h') {
      flags.help = true
      continue
    }
    if (arg === '-j') {
      flags.json = true
      continue
    }
    if (arg === '-m') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new ReviewError('-m requires a message value')
      flags.message = value
      i += 1
      continue
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (BOOL_FLAGS.has(name)) {
      if (eq !== -1) throw new ReviewError(`--${name} does not take a value`)
      flags[name] = true
      continue
    }
    if (VALUE_FLAGS.has(name)) {
      const value = eq !== -1 ? arg.slice(eq + 1) : argv[i + 1]
      if (value === undefined || (eq === -1 && value.startsWith('--'))) {
        throw new ReviewError(`--${name} requires a value`)
      }
      if (eq === -1) i += 1
      flags[name] = value
      continue
    }
    throw new ReviewError(`unknown flag --${name}`)
  }
  return { flags, positionals }
}

function usage(exitCode) {
  console.log(`review — history, approval, annotations and the edit protocol

Usage:
  node review.mjs history list <slug> [--root=<dir>] [--json]
  node review.mjs history save <slug> [-m <message>] [--root=<dir>] [--json]
  node review.mjs history restore <slug> <hash> --confirm=<hash> [--dry-run] [--json]
  node review.mjs approve <slug> [--artifact=<file>] [--by=<name>] [--at=<iso>] [--note=<text>] [--json]
  node review.mjs annotate add <slug> --selector=<css> --note=<text> [--severity=P1]
                              [--artifact=<file>] [--box=x,y,w,h] [--viewport=145x188]
                              [--author=<name>] [--round=<n>] [--id=<id>] [--json]
  node review.mjs annotate list <slug> [--status=open] [--severity=P0] [--artifact=<file>] [--json]
  node review.mjs annotate resolve <slug> <id> [--status=resolved|wontfix|accepted] [--evidence=<text>] [--json]
  node review.mjs protocol describe [--json]
  node review.mjs protocol validate <file|-> [--verify] [--root=<dir>] [--json]

Options:
  --root=<dir>   Project root (default: current directory); the project is <root>/design/<slug>.
  --json         Machine-readable JSON on stdout.
  --quiet        Only the summary line on stdout.
  --help, -h     This help. --self-test runs the temp-dir test suite.

History is stored in refs/dezign0/<slug>/<commit>, so snapshots survive branch
switches without touching HEAD, the index or the working tree until restore.
Refs are local; remove one with: git update-ref -d <ref>.
Restore requires --confirm=<snapshot hash prefix> (minimum 7 characters).
Approval writes approved_by, approved_at and artifact_hash into project.json and
an "## Approval" section in HANDOVER.md. Annotations follow the project contract
in .design-os/briefs/ANNOTATIONS.md.

Exit codes: 0 ok, 1 refused/invalid input, 2 usage or environment error.`)
  process.exit(exitCode)
}

function emit(flags, payload) {
  if (flags.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function summary(flags, line) {
  if (flags.json || flags.quiet) return
  console.log(line)
}

// ── Files, paths and git ───────────────────────────────────────────────────
function readJson(file, { required = false, code = 2 } = {}) {
  if (!fs.existsSync(file)) {
    if (required) throw new ReviewError(`missing ${path.basename(file)}`, code)
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ReviewError(`${path.basename(file)} is not valid JSON: ${error.message}`, code)
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function isInside(parent, child) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

function realpathOrResolve(value) {
  try {
    return fs.realpathSync(value)
  } catch {
    return path.resolve(value)
  }
}

function resolveRoot(flags) {
  const root = path.resolve(flags.root || process.cwd())
  let stat
  try {
    stat = fs.statSync(root)
  } catch {
    throw new ReviewError(`project root not found: ${root}`)
  }
  if (!stat.isDirectory()) throw new ReviewError(`project root is not a directory: ${root}`)
  return root
}

function resolveProject(flags, slug, { mustExist = true } = {}) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new ReviewError('slug must be lowercase letters, digits and single hyphens (max 64)')
  }
  const root = resolveRoot(flags)
  const designDir = path.join(root, 'design')
  const projectDir = path.join(designDir, slug)
  if (!isInside(root, projectDir)) throw new ReviewError('project path escapes the root')
  if (mustExist) {
    let stat
    try {
      stat = fs.statSync(projectDir)
    } catch {
      throw new ReviewError(`project not found: ${path.join('design', slug)}`, 1)
    }
    if (!stat.isDirectory()) throw new ReviewError(`project is not a directory: ${path.join('design', slug)}`, 1)
    const real = fs.realpathSync(projectDir)
    if (!isInside(fs.realpathSync(root), real)) throw new ReviewError('project resolves outside the root')
    return { root, projectDir: real, slug }
  }
  return { root, projectDir, slug }
}

function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    input: options.input,
    encoding: options.encoding || 'utf8',
    maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  })
  if (result.error && result.error.code === 'ENOENT') {
    throw new ReviewError('git is not installed; history requires git')
  }
  return result
}

function gitOrThrow(cwd, args, options = {}) {
  const result = git(cwd, args, options)
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split('\n')[0]
    throw new ReviewError(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`)
  }
  return result
}

function gitIdentity(cwd) {
  const name = git(cwd, ['config', 'user.name']).stdout?.trim()
  const email = git(cwd, ['config', 'user.email']).stdout?.trim()
  return {
    name: name || process.env.GIT_AUTHOR_NAME || process.env.USER || process.env.USERNAME || 'dezign0',
    email: email || process.env.GIT_AUTHOR_EMAIL || 'dezign0@localhost',
  }
}

function repoRelative(projectDir) {
  const result = git(projectDir, ['rev-parse', '--is-inside-work-tree'])
  if (result.status !== 0 || result.stdout.trim() !== 'true') {
    throw new ReviewError('history is git-backed: run this inside a git worktree')
  }
  const repoRoot = gitOrThrow(projectDir, ['rev-parse', '--show-toplevel']).stdout.trim()
  // Ask git for the project's path relative to the worktree root. Comparing
  // realpaths here breaks on Windows short (8.3) temp paths, where os.tmpdir()
  // and git report the same directory with different spellings.
  const prefix = gitOrThrow(projectDir, ['rev-parse', '--show-prefix']).stdout.trim().replaceAll('\\', '/')
  const rel = prefix.replace(/\/+$/, '')
  if (!rel || rel.split('/').includes('..')) throw new ReviewError('project is outside the git worktree')
  return { repoRoot, rel }
}

function entryArtifact(projectDir, project) {
  if (project?.constraints?.entry) return project.constraints.entry
  const artifacts = Array.isArray(project?.artifacts) ? project.artifacts : []
  const entry = artifacts.find((item) => item && item.role === 'entry')
  if (entry?.path) return entry.path
  const found = fs.readdirSync(projectDir, { withFileTypes: true })
    .filter((item) => item.isFile() && /\.html?$/i.test(item.name))
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b))
  return found[0] || 'index.html'
}

function resolveArtifact(projectDir, artifact, { required = true } = {}) {
  if (typeof artifact !== 'string' || !artifact.trim()) throw new ReviewError('artifact must be a non-empty relative path')
  if (artifact.includes('\0')) throw new ReviewError('artifact path contains a null byte')
  const normalized = artifact.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new ReviewError(`artifact must stay inside the project: ${artifact}`)
  }
  const file = path.resolve(projectDir, normalized)
  if (!isInside(projectDir, file)) throw new ReviewError(`artifact escapes the project: ${artifact}`)
  if (fs.existsSync(file)) {
    const real = fs.realpathSync(file)
    if (!isInside(fs.realpathSync(projectDir), real)) throw new ReviewError(`artifact resolves outside the project: ${artifact}`)
    if (!fs.statSync(real).isFile()) throw new ReviewError(`artifact is not a file: ${artifact}`, 1)
    return real
  }
  if (required) throw new ReviewError(`artifact not found: ${artifact}`, 1)
  return file
}

// ── History ────────────────────────────────────────────────────────────────
function listSnapshots(slug, cwd) {
  const result = git(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%09%(objectname)%09%(committerdate:iso-strict)%09%(subject)', `refs/dezign0/${slug}/`])
  if (result.status !== 0) throw new ReviewError(`cannot read snapshot refs: ${(result.stderr || '').trim()}`)
  const prefix = `refs/dezign0/${slug}/`
  return String(result.stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, date, subject] = line.split('\t')
      return {
        ref: ref.replace('refs/', ''),
        refName: ref,
        hash,
        short: hash ? hash.slice(0, 12) : '',
        date: date || null,
        subject: subject || '',
        label: ref.startsWith(prefix) ? ref.slice(prefix.length) : ref,
      }
    })
}

function saveSnapshot(flags, slug) {
  const { projectDir } = resolveProject(flags, slug)
  const { repoRoot, rel } = repoRelative(projectDir)
  const indexFile = path.join(os.tmpdir(), `dezign0-index-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const env = { GIT_INDEX_FILE: indexFile }
  const identity = gitIdentity(repoRoot)
  const created = new Date().toISOString()
  const message = (flags.message || '').toString().trim()
  const subject = (message.split('\n')[0] || `snapshot ${slug}`).slice(0, 120)
  try {
    const head = git(repoRoot, ['rev-parse', '--verify', 'HEAD'])
    if (head.status === 0) gitOrThrow(repoRoot, ['read-tree', 'HEAD'], { env })
    else gitOrThrow(repoRoot, ['read-tree', '--empty'], { env })
    gitOrThrow(repoRoot, ['add', '-f', '-A', '--', rel], { env })
    const tree = gitOrThrow(repoRoot, ['write-tree'], { env }).stdout.trim()
    const commitMessage = `${message || subject}\n\nslug=${slug}\ncreated=${created}\n`
    const commitArgs = ['commit-tree', tree]
    if (head.status === 0) commitArgs.push('-p', head.stdout.trim())
    commitArgs.push('-m', commitMessage)
    const hash = gitOrThrow(repoRoot, commitArgs, {
      env: {
        ...env,
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
      },
    }).stdout.trim()
    const ref = `refs/dezign0/${slug}/${hash}`
    gitOrThrow(repoRoot, ['update-ref', ref, hash])
    const files = gitOrThrow(repoRoot, ['ls-tree', '-r', '--name-only', hash, '--', rel]).stdout
      .split('\n')
      .filter(Boolean).length
    const snapshot = { slug, hash, ref, tree, files, subject, created, repoRoot, project: rel }
    if (flags.json) emit(flags, { schema: 'dezign0/review-cli/v1', command: 'history', action: 'save', ok: true, ...snapshot })
    else summary(flags, `saved ${hash.slice(0, 12)} (${files} files) for design/${slug}`)
    return 0
  } finally {
    try {
      fs.rmSync(indexFile, { force: true })
    } catch {
      // Best effort: the temp index is outside the repository.
    }
  }
}

function resolveSnapshot(slug, hashArg, cwd) {
  const snapshots = listSnapshots(slug, cwd)
  const needle = String(hashArg || '').trim().toLowerCase()
  if (needle.length < 7) throw new ReviewError('snapshot hash must be at least 7 characters')
  const matches = snapshots.filter((snapshot) => snapshot.hash.startsWith(needle) || snapshot.label.startsWith(needle))
  if (!matches.length) throw new ReviewError(`no snapshot matches ${hashArg}`)
  if (matches.length > 1) throw new ReviewError(`snapshot hash is ambiguous: ${matches.map((item) => item.short).join(', ')}`)
  return { snapshot: matches[0], snapshots }
}

function walkProject(projectDir) {
  const files = []
  const dirs = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      const relative = path.relative(projectDir, absolute).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        files.push({ relative, absolute, symlink: true })
      } else if (entry.isDirectory()) {
        dirs.push({ relative, absolute })
        visit(absolute)
      } else {
        files.push({ relative, absolute })
      }
    }
  }
  visit(projectDir)
  return { files, dirs }
}

function restoreSnapshot(flags, slug, hashArg) {
  const { projectDir } = resolveProject(flags, slug)
  const { repoRoot } = repoRelative(projectDir)
  const { snapshot } = resolveSnapshot(slug, hashArg, repoRoot)
  const confirm = flags.confirm
  if (!confirm) {
    throw new ReviewError(`restore is destructive: pass --confirm=${snapshot.short} (the snapshot hash)`, 1)
  }
  const normalizedConfirm = String(confirm).trim().toLowerCase()
  if (normalizedConfirm.length < 7 || !snapshot.hash.startsWith(normalizedConfirm)) {
    throw new ReviewError(`confirmation does not match ${snapshot.short}`, 1)
  }
  const { rel } = repoRelative(projectDir)
  const listed = gitOrThrow(repoRoot, ['ls-tree', '-r', '-z', '--name-only', snapshot.hash, '--', rel]).stdout
    .split('\0')
    .filter(Boolean)
  const snapshotFiles = new Map()
  for (const repoPath of listed) {
    if (!repoPath.startsWith(`${rel}/`)) continue
    const relative = repoPath.slice(rel.length + 1)
    const destination = path.resolve(projectDir, relative)
    if (!isInside(projectDir, destination)) throw new ReviewError(`snapshot contains an unsafe path: ${relative}`)
    snapshotFiles.set(relative, { repoPath, destination })
  }
  const current = walkProject(projectDir)
  const extras = current.files.filter((file) => !snapshotFiles.has(file.relative)).map((file) => file.relative)
  const orderedDirs = current.dirs.map((dir) => dir.relative).sort((a, b) => b.length - a.length)
  if (flags['dry-run']) {
    const payload = {
      schema: 'dezign0/review-cli/v1', command: 'history', action: 'restore', ok: true,
      dryRun: true, slug, hash: snapshot.hash, ref: snapshot.ref, wouldRestore: [...snapshotFiles.keys()], wouldRemove: extras,
    }
    if (flags.json) emit(flags, payload)
    else summary(flags, `dry run: restore ${snapshotFiles.size} file(s), remove ${extras.length} file(s)`)
    return 0
  }
  let restored = 0
  for (const [relative, entry] of snapshotFiles) {
    const buffer = gitOrThrow(repoRoot, ['show', `${snapshot.hash}:${entry.repoPath}`], { encoding: 'buffer' })
    const destination = entry.destination
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    try {
      if (fs.lstatSync(destination).isSymbolicLink()) fs.rmSync(destination)
    } catch {
      // Destination does not exist yet.
    }
    fs.writeFileSync(destination, buffer.stdout)
    restored += 1
  }
  for (const relative of extras) {
    const absolute = path.resolve(projectDir, relative)
    if (!isInside(projectDir, absolute)) continue
    try {
      if (fs.lstatSync(absolute).isSymbolicLink()) fs.rmSync(absolute)
      else if (fs.statSync(absolute).isDirectory()) fs.rmdirSync(absolute)
      else fs.rmSync(absolute)
    } catch {
      // Already gone; restore still mirrors the snapshot.
    }
  }
  for (const relative of orderedDirs) {
    const absolute = path.resolve(projectDir, relative)
    if (!isInside(projectDir, absolute)) continue
    try {
      if (!fs.readdirSync(absolute).length) fs.rmdirSync(absolute)
    } catch {
      // Non-empty or already removed.
    }
  }
  const payload = {
    schema: 'dezign0/review-cli/v1', command: 'history', action: 'restore', ok: true,
    dryRun: false, slug, hash: snapshot.hash, ref: snapshot.ref, restored, removed: extras.length, files: [...snapshotFiles.keys()],
  }
  if (flags.json) emit(flags, payload)
  else summary(flags, `restored ${restored} file(s) from ${snapshot.short}; removed ${extras.length} extra file(s)`)
  return 0
}

function commandHistory(flags, positionals) {
  const action = positionals[0]
  const slug = positionals[1]
  if (!action || !['list', 'save', 'restore'].includes(action)) throw new ReviewError('history needs list|save|restore <slug>')
  if (!slug) throw new ReviewError(`history ${action} needs a slug`)
  if (action === 'save') return saveSnapshot(flags, slug)
  if (action === 'restore') {
    const hash = positionals[2]
    if (!hash) throw new ReviewError('history restore needs a snapshot hash')
    return restoreSnapshot(flags, slug, hash)
  }
  const { projectDir } = resolveProject(flags, slug)
  const { repoRoot } = repoRelative(projectDir)
  const snapshots = listSnapshots(slug, repoRoot)
  if (flags.json) {
    emit(flags, {
      schema: 'dezign0/review-cli/v1', command: 'history', action: 'list', ok: true,
      slug, count: snapshots.length, snapshots,
    })
    return 0
  }
  if (!flags.quiet) {
    if (!snapshots.length) console.log(`history: no snapshots for design/${slug}`)
    for (const snapshot of snapshots) console.log(`${snapshot.short}  ${snapshot.date || '?'}  ${snapshot.subject}`)
  }
  summary(flags, `history: ${snapshots.length} snapshot(s) for design/${slug}`)
  return 0
}

// ── Approval ───────────────────────────────────────────────────────────────
function approvalSection(data) {
  return [
    '## Approval',
    '',
    `- approved_by: ${data.by}`,
    `- approved_at: ${data.at}`,
    `- artifact: ${data.artifact}`,
    `- artifact_hash: ${data.hash}`,
    ...(data.note ? [`- note: ${data.note}`] : []),
    '',
  ].join('\n')
}

function upsertApproval(text, section) {
  const start = text.search(/^## Approval\b.*$/m)
  if (start === -1) {
    const base = text.trimEnd()
    return `${base}${base ? '\n\n' : ''}${section}`
  }
  const afterHeading = text.indexOf('\n', start)
  const bodyStart = afterHeading === -1 ? text.length : afterHeading + 1
  const nextHeading = text.slice(bodyStart).search(/^## /m)
  const end = nextHeading === -1 ? text.length : bodyStart + nextHeading
  const before = text.slice(0, start).replace(/\s+$/, '')
  const after = text.slice(end).replace(/^\s+/, '')
  return `${before}${before ? '\n\n' : ''}${section}${after ? `\n${after}` : ''}`
}

function commandApprove(flags, positionals) {
  const slug = positionals[0]
  if (!slug) throw new ReviewError('approve needs a slug')
  const { projectDir } = resolveProject(flags, slug)
  const projectFile = path.join(projectDir, 'project.json')
  const project = readJson(projectFile, { required: true, code: 1 })
  if (project.schema && project.schema !== PROJECT_SCHEMA) {
    throw new ReviewError(`project.json schema is "${project.schema}", expected ${PROJECT_SCHEMA}`, 1)
  }
  const artifactName = flags.artifact || entryArtifact(projectDir, project)
  const artifact = resolveArtifact(projectDir, artifactName)
  const by = (flags.by || gitIdentity(projectDir).name).toString().trim()
  if (!by) throw new ReviewError('approval needs an approver; pass --by=<name>')
  const at = flags.at ? new Date(flags.at) : new Date()
  if (Number.isNaN(at.getTime())) throw new ReviewError('--at must be an ISO 8601 date')
  const hash = sha256File(artifact)
  const note = flags.note ? String(flags.note).trim() : ''
  const approved = { by, at: at.toISOString(), artifact: artifactName.replaceAll('\\', '/'), hash, note }

  project.approved_by = approved.by
  project.approved_at = approved.at
  project.artifact_hash = approved.hash
  project.approved_artifact = approved.artifact
  project.status = 'approved'
  project.updated = approved.at
  writeJsonAtomic(projectFile, project)

  const handoverFile = path.join(projectDir, 'HANDOVER.md')
  const handover = fs.existsSync(handoverFile)
    ? fs.readFileSync(handoverFile, 'utf8')
    : `# ${slug} — handover\n\n`
  fs.writeFileSync(handoverFile, upsertApproval(handover, approvalSection(approved)))

  const payload = {
    schema: 'dezign0/review-cli/v1', command: 'approve', ok: true, slug,
    project: 'project.json', handover: 'HANDOVER.md',
    approved_by: approved.by, approved_at: approved.at, artifact: approved.artifact,
    artifact_hash: approved.hash, note: approved.note,
  }
  if (flags.json) emit(flags, payload)
  else summary(flags, `approved design/${slug}: ${approved.artifact} ${hash.slice(0, 12)} by ${by}`)
  return 0
}

// ── Annotations ────────────────────────────────────────────────────────────
function annotationsFile(projectDir) {
  return path.join(projectDir, 'ANNOTATIONS.json')
}

function loadAnnotations(projectDir, slug) {
  const file = annotationsFile(projectDir)
  let data = readJson(file)
  if (!data) {
    data = { schema: ANNOTATIONS_SCHEMA, project: slug, round: 1, updated: new Date().toISOString(), items: [] }
  }
  if (data.schema !== ANNOTATIONS_SCHEMA) {
    throw new ReviewError(`ANNOTATIONS.json schema is "${data.schema || 'missing'}", expected ${ANNOTATIONS_SCHEMA}`, 1)
  }
  if (!Array.isArray(data.items)) throw new ReviewError('ANNOTATIONS.json must contain an "items" array', 1)
  return { file, data }
}

function validateAnnotation(item, index) {
  const at = `item ${index + 1}`
  const errors = []
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [`${at}: not an object`]
  if (typeof item.selector !== 'string' || !item.selector.trim()) errors.push(`${at}: selector must be a non-empty string`)
  if (typeof item.note !== 'string' || !item.note.trim()) errors.push(`${at}: note must be a non-empty string`)
  if (typeof item.author !== 'string' || !item.author.trim()) errors.push(`${at}: author must be a non-empty string`)
  if (!Number.isInteger(item.round) || item.round < 1) errors.push(`${at}: round must be an integer >= 1`)
  if (!SEVERITIES.includes(item.severity)) errors.push(`${at}: severity must be one of ${SEVERITIES.join(', ')}`)
  if (!STATUSES.includes(item.status)) errors.push(`${at}: status must be one of ${STATUSES.join(', ')}`)
  if (!Object.prototype.hasOwnProperty.call(item, 'box')) {
    errors.push(`${at}: box is required; use null when the finding was not measured`)
  } else if (item.box != null) {
    const box = item.box
    const ok = box && typeof box === 'object' && ['x', 'y', 'width', 'height'].every((key) => typeof box[key] === 'number' && Number.isFinite(box[key]))
    if (!ok) errors.push(`${at}: box must be null or { x, y, width, height } numbers`)
  }
  if (item.artifact != null && (typeof item.artifact !== 'string' || !item.artifact.trim())) errors.push(`${at}: artifact must be a file name when present`)
  return errors
}

function parseBox(value) {
  if (value === undefined || value === null || value === 'null') return null
  const parts = String(value).split(',').map((entry) => Number(entry.trim()))
  if (parts.length !== 4 || parts.some((entry) => !Number.isFinite(entry))) {
    throw new ReviewError('--box must be null or x,y,width,height numbers')
  }
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

function nextAnnotationId(items) {
  let max = 0
  for (const item of items) {
    const match = /^ann-(\d+)$/.exec(String(item.id || ''))
    if (match) max = Math.max(max, Number(match[1]))
  }
  let next = max + 1
  let id = `ann-${String(next).padStart(3, '0')}`
  while (items.some((item) => item.id === id)) {
    next += 1
    id = `ann-${String(next).padStart(3, '0')}`
  }
  return id
}

function addAnnotation(flags, slug) {
  const { projectDir } = resolveProject(flags, slug)
  const project = readJson(path.join(projectDir, 'project.json'))
  if (!flags.selector) throw new ReviewError('annotate add needs --selector=<css selector>')
  const selector = String(flags.selector).trim()
  if (!selector || selector.length > 500 || /[\r\n]/.test(selector)) throw new ReviewError('--selector must be one line, 1-500 characters')
  const note = String(flags.note || '').trim()
  if (!note) throw new ReviewError('annotate add needs --note=<finding>')
  if (note.length > 4000) throw new ReviewError('--note must be 4000 characters or fewer')
  const severity = flags.severity || 'P1'
  if (!SEVERITIES.includes(severity)) throw new ReviewError(`--severity must be one of ${SEVERITIES.join(', ')}`)
  const status = flags.status || 'open'
  if (!STATUSES.includes(status)) throw new ReviewError(`--status must be one of ${STATUSES.join(', ')}`)
  const artifact = flags.artifact || entryArtifact(projectDir, project)
  resolveArtifact(projectDir, artifact)
  const box = parseBox(flags.box)
  if (flags.viewport && !/^\d{2,5}x\d{2,5}$/.test(String(flags.viewport))) throw new ReviewError('--viewport must look like 145x188')
  const round = flags.round === undefined ? undefined : Number(flags.round)
  if (round !== undefined && (!Number.isInteger(round) || round < 1)) throw new ReviewError('--round must be an integer >= 1')
  const author = (flags.author || gitIdentity(projectDir).name || 'agent').toString().trim()
  const { file, data } = loadAnnotations(projectDir, slug)
  const items = data.items
  const bad = items.flatMap((item, index) => validateAnnotation(item, index))
  if (bad.length) throw new ReviewError(`ANNOTATIONS.json is invalid; fix it first:\n  - ${bad.slice(0, 10).join('\n  - ')}`, 1)
  const id = flags.id ? String(flags.id) : nextAnnotationId(items)
  if (!ID_RE.test(id)) throw new ReviewError('--id must be lowercase letters, digits and hyphens')
  if (items.some((item) => item.id === id)) throw new ReviewError(`annotation id already exists: ${id}`, 1)
  const currentRound = Number.isInteger(data.round) && data.round > 0 ? data.round : 1
  const entryRound = round || Math.max(currentRound, ...items.map((item) => (Number.isInteger(item.round) ? item.round : 1)))
  const entry = {
    id,
    artifact: artifact.replaceAll('\\', '/'),
    selector,
    box,
    ...(flags.viewport ? { viewport: String(flags.viewport) } : {}),
    note,
    severity,
    status,
    author,
    round: entryRound,
    created_at: new Date().toISOString(),
  }
  items.push(entry)
  data.project = slug
  data.round = Math.max(entryRound, currentRound)
  data.updated = new Date().toISOString()
  writeJsonAtomic(file, data)
  const payload = { schema: 'dezign0/review-cli/v1', command: 'annotate', action: 'add', ok: true, slug, file: 'ANNOTATIONS.json', item: entry, total: items.length }
  if (flags.json) emit(flags, payload)
  else summary(flags, `added ${id} (${severity}, ${status}) to ANNOTATIONS.json`)
  return 0
}

function listAnnotations(flags, slug) {
  const { projectDir } = resolveProject(flags, slug)
  const { data } = loadAnnotations(projectDir, slug)
  const bad = data.items.flatMap((item, index) => validateAnnotation(item, index))
  if (bad.length) throw new ReviewError(`ANNOTATIONS.json is invalid:\n  - ${bad.slice(0, 10).join('\n  - ')}`, 1)
  let items = data.items
  if (flags.status) {
    if (!STATUSES.includes(flags.status)) throw new ReviewError(`--status must be one of ${STATUSES.join(', ')}`)
    items = items.filter((item) => item.status === flags.status)
  }
  if (flags.severity) {
    if (!SEVERITIES.includes(flags.severity)) throw new ReviewError(`--severity must be one of ${SEVERITIES.join(', ')}`)
    items = items.filter((item) => item.severity === flags.severity)
  }
  if (flags.artifact) {
    const artifact = flags.artifact.replaceAll('\\', '/')
    items = items.filter((item) => item.artifact === artifact)
  }
  if (flags.json) {
    emit(flags, { schema: 'dezign0/review-cli/v1', command: 'annotate', action: 'list', ok: true, slug, count: items.length, round: data.round, items })
    return 0
  }
  if (!flags.quiet) {
    for (const item of items) {
      const note = item.note.length > 90 ? `${item.note.slice(0, 89)}…` : item.note
      console.log(`${item.id}  ${String(item.severity).padEnd(3)} ${String(item.status).padEnd(11)} ${item.selector}  ${note}`)
    }
  }
  summary(flags, `annotations: ${items.length} of ${data.items.length} (round ${data.round})`)
  return 0
}

function resolveAnnotation(flags, slug, id) {
  if (!id) throw new ReviewError('annotate resolve needs an annotation id')
  const { projectDir } = resolveProject(flags, slug)
  const { file, data } = loadAnnotations(projectDir, slug)
  const item = data.items.find((entry) => entry.id === id)
  if (!item) throw new ReviewError(`annotation not found: ${id}`, 1)
  const nextStatus = flags.status || 'resolved'
  if (!STATUSES.includes(nextStatus)) throw new ReviewError(`--status must be one of ${STATUSES.join(', ')}`)
  item.status = nextStatus
  item.resolved_at = new Date().toISOString()
  if (flags.evidence) item.evidence = String(flags.evidence).trim()
  data.round = Math.max(Number.isInteger(data.round) ? data.round : 1, Number.isInteger(item.round) ? item.round : 1)
  data.updated = new Date().toISOString()
  writeJsonAtomic(file, data)
  const payload = { schema: 'dezign0/review-cli/v1', command: 'annotate', action: 'resolve', ok: true, slug, item, total: data.items.length }
  if (flags.json) emit(flags, payload)
  else summary(flags, `annotation ${id}: ${nextStatus}`)
  return 0
}

function commandAnnotate(flags, positionals) {
  const action = positionals[0]
  const slug = positionals[1]
  if (!action || !['add', 'list', 'resolve'].includes(action)) throw new ReviewError('annotate needs add|list|resolve <slug>')
  if (!slug) throw new ReviewError(`annotate ${action} needs a slug`)
  if (action === 'add') return addAnnotation(flags, slug)
  if (action === 'list') return listAnnotations(flags, slug)
  return resolveAnnotation(flags, slug, positionals[2])
}

// ── Protocol ───────────────────────────────────────────────────────────────
function normalizeProtocolArtifact(value, label) {
  if (typeof value !== 'string' || !value.trim()) return `${label} must be a non-empty artifact path`
  if (value.includes('\0')) return `${label} contains a null byte`
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
    return `${label} must be a project-relative path without ".."`
  }
  if (!/\.(html?|svg)$/i.test(normalized)) return `${label} must point at an HTML or SVG artifact`
  return null
}

function validateSelection(selection, label, errors) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    errors.push(`${label} must be an object with selector and optional box`)
    return
  }
  if (typeof selection.selector !== 'string' || !selection.selector.trim()) errors.push(`${label}.selector must be a non-empty CSS selector`)
  if (selection.box != null) {
    const box = selection.box
    const ok = box && typeof box === 'object' && ['x', 'y', 'width', 'height'].every((key) => typeof box[key] === 'number' && Number.isFinite(box[key]))
    if (!ok) errors.push(`${label}.box must be null or { x, y, width, height } numbers`)
  }
  if (selection.viewport != null && !/^\d{2,5}x\d{2,5}$/.test(String(selection.viewport))) errors.push(`${label}.viewport must look like 1440x900`)
  if (selection.text != null && typeof selection.text !== 'string') errors.push(`${label}.text must be a string`)
}

function validateProtocolMessage(message, index, context) {
  const errors = []
  const label = `message ${index + 1}`
  if (!message || typeof message !== 'object' || Array.isArray(message)) return [`${label}: not an object`]
  if (message.schema !== PROTOCOL_SCHEMA) errors.push(`${label}: schema must be "${PROTOCOL_SCHEMA}"`)
  if (!PROTOCOL_TYPES.includes(message.type)) errors.push(`${label}: type must be one of ${PROTOCOL_TYPES.join(', ')}`)
  if (typeof message.id !== 'string' || !ID_RE.test(message.id)) errors.push(`${label}: id must match ${ID_RE}`)
  const artifactError = normalizeProtocolArtifact(message.artifact, `${label}.artifact`)
  if (artifactError) errors.push(artifactError)
  if (message.author != null && (typeof message.author !== 'string' || !message.author.trim())) errors.push(`${label}.author must be a non-empty string`)
  if (message.created != null && Number.isNaN(Date.parse(message.created))) errors.push(`${label}.created must be an ISO 8601 timestamp`)

  if (message.type === 'select') {
    validateSelection(message.selection, `${label}.selection`, errors)
  } else if (message.type === 'instruction') {
    if (typeof message.instruction !== 'string' || !message.instruction.trim()) errors.push(`${label}.instruction must be a non-empty string`)
    else if (message.instruction.length > 8000) errors.push(`${label}.instruction must be 8000 characters or fewer`)
    if (!message.selection_id && !message.selection) errors.push(`${label}: instruction needs selection_id or an inline selection`)
    if (message.selection_id != null && (typeof message.selection_id !== 'string' || !ID_RE.test(message.selection_id))) errors.push(`${label}.selection_id must be a message id`)
    if (message.selection != null) validateSelection(message.selection, `${label}.selection`, errors)
  } else if (message.type === 'patch') {
    if (typeof message.base_hash !== 'string' || !/^[a-f0-9]{64}$/.test(message.base_hash)) errors.push(`${label}.base_hash must be a lowercase SHA-256 (64 hex)`)
    if (message.instruction_id != null && (typeof message.instruction_id !== 'string' || !ID_RE.test(message.instruction_id))) errors.push(`${label}.instruction_id must be a message id`)
    const patch = message.patch
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      errors.push(`${label}.patch must be an object`)
    } else {
      if (!PATCH_FORMATS.includes(patch.format)) errors.push(`${label}.patch.format must be one of ${PATCH_FORMATS.join(', ')}`)
      if (patch.format === 'search-replace') {
        if (typeof patch.find !== 'string' || !patch.find) errors.push(`${label}.patch.find must be a non-empty string`)
        if (typeof patch.replace !== 'string') errors.push(`${label}.patch.replace must be a string (may be empty)`)
      } else if (patch.format === 'unified-diff') {
        if (typeof patch.diff !== 'string' || !patch.diff.trim() || !patch.diff.includes('@@')) errors.push(`${label}.patch.diff must be a unified diff containing an @@ hunk`)
      } else if (patch.format === 'full-file') {
        if (typeof patch.content !== 'string' || !patch.content.trim()) errors.push(`${label}.patch.content must be non-empty file content`)
      }
      if (patch.path != null) {
        const target = normalizeProtocolArtifact(patch.path, `${label}.patch.path`)
        if (target) errors.push(target)
        else if (patch.path.replaceAll('\\', '/') !== message.artifact.replaceAll('\\', '/')) errors.push(`${label}.patch.path must equal artifact`)
      }
      if (patch.targets != null) {
        if (!Array.isArray(patch.targets)) errors.push(`${label}.patch.targets must be an array`)
        else for (const [targetIndex, target] of patch.targets.entries()) {
          if (typeof target !== 'string' || !target.trim()) errors.push(`${label}.patch.targets[${targetIndex}] must be a selector string`)
        }
      }
    }
  }
  if (context.strictRefs) {
    if (message.type === 'instruction' && message.selection_id) {
      const referenced = context.byId.get(message.selection_id)
      if (referenced && context.indexById.get(message.selection_id) >= index) errors.push(`${label}: selection_id must reference an earlier message`)
      else if (referenced && referenced.type !== 'select') errors.push(`${label}: selection_id must reference a select message`)
    }
    if (message.type === 'patch' && message.instruction_id) {
      const referenced = context.byId.get(message.instruction_id)
      if (referenced && context.indexById.get(message.instruction_id) >= index) errors.push(`${label}: instruction_id must reference an earlier message`)
      else if (referenced && referenced.type !== 'instruction') errors.push(`${label}: instruction_id must reference an instruction message`)
    }
  }
  return errors
}

function protocolExample(type) {
  const base = { schema: PROTOCOL_SCHEMA, type, id: `${type.slice(0, 3)}-001`, artifact: 'design/example/index.html', author: 'designer' }
  if (type === 'select') {
    return { ...base, selection: { selector: "[data-od-id='cta']", box: { x: 24, y: 640, width: 160, height: 44 }, viewport: '1440x900', text: 'Continue' } }
  }
  if (type === 'instruction') {
    return { ...base, selection_id: 'sel-001', instruction: 'Increase the CTA to the 44px target height and keep the label on one line.' }
  }
  return {
    ...base,
    instruction_id: 'ins-001',
    base_hash: '0'.repeat(64),
    patch: { format: 'search-replace', find: 'padding: 10px 16px', replace: 'padding: 12px 16px', targets: ["[data-od-id='cta']"] },
  }
}

function protocolDescription() {
  return {
    schema: PROTOCOL_SCHEMA,
    purpose: 'A host-agnostic select → instruction → patch exchange for design artifacts.',
    types: {
      select: 'The user or host selects an element and records its selector, measured box and viewport.',
      instruction: 'A human or agent states the change in words, referencing a select message.',
      patch: 'An agent proposes a replacement for the current artifact, bound to the pre-patch SHA-256.',
    },
    rules: [
      'Every message carries schema, type, a unique id and a project-relative HTML/SVG artifact.',
      'A patch must carry the SHA-256 of the artifact it was generated against in base_hash.',
      'Patch formats are search-replace, unified-diff and full-file; no other format is portable.',
      'References (selection_id, instruction_id) point at earlier messages when validating a batch.',
      'Validate a single message or an array/batch with: node review.mjs protocol validate <file|->.',
    ],
    examples: { select: protocolExample('select'), instruction: protocolExample('instruction'), patch: protocolExample('patch') },
  }
}

function readProtocolInput(file, flags) {
  let text
  if (file === '-') {
    text = fs.readFileSync(0, 'utf8')
  } else {
    const target = path.resolve(flags.root || process.cwd(), file)
    const root = path.resolve(flags.root || process.cwd())
    if (!isInside(root, target)) throw new ReviewError('protocol file must stay inside the project root')
    if (!fs.existsSync(target)) throw new ReviewError(`protocol file not found: ${file}`)
    text = fs.readFileSync(target, 'utf8')
  }
  if (text.length > 2 * 1024 * 1024) throw new ReviewError('protocol file is larger than 2 MB')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ReviewError(`protocol file is not valid JSON: ${error.message}`)
  }
  let messages
  if (Array.isArray(parsed)) messages = parsed
  else if (Array.isArray(parsed.messages)) messages = parsed.messages
  else messages = [parsed]
  return messages
}

function commandProtocol(flags, positionals) {
  const action = positionals[0]
  if (action === 'describe') {
    const description = protocolDescription()
    if (flags.json) emit(flags, { schema: 'dezign0/review-cli/v1', command: 'protocol', action: 'describe', ok: true, ...description })
    else {
      console.log(`protocol ${description.schema}\n\n${description.purpose}\n`)
      for (const [name, purpose] of Object.entries(description.types)) console.log(`${name}: ${purpose}`)
      console.log(`\nRules:\n${description.rules.map((rule) => `- ${rule}`).join('\n')}`)
      console.log('\nExample patch:')
      console.log(JSON.stringify(description.examples.patch, null, 2))
    }
    return 0
  }
  if (action !== 'validate') throw new ReviewError('protocol needs describe|validate')
  const file = positionals[1]
  if (!file) throw new ReviewError('protocol validate needs a JSON file or - for stdin')
  const messages = readProtocolInput(file, flags)
  if (!messages.length) throw new ReviewError('protocol batch is empty', 1)
  const byId = new Map()
  const indexById = new Map()
  messages.forEach((message, index) => {
    if (message && typeof message === 'object' && typeof message.id === 'string') {
      if (byId.has(message.id)) throw new ReviewError(`duplicate message id: ${message.id}`, 1)
      byId.set(message.id, message)
      indexById.set(message.id, index)
    }
  })
  const errors = messages.flatMap((message, index) => validateProtocolMessage(message, index, { byId, indexById, strictRefs: messages.length > 1 }))
  if (flags.verify) {
    const root = path.resolve(flags.root || process.cwd())
    for (const message of messages) {
      if (message.type !== 'patch' || typeof message.artifact !== 'string') continue
      const artifact = path.resolve(root, message.artifact.replaceAll('\\', '/'))
      if (!isInside(root, artifact) || !fs.existsSync(artifact)) {
        errors.push(`verify: artifact not found inside the root: ${message.artifact}`)
        continue
      }
      if (!isInside(fs.realpathSync(root), fs.realpathSync(artifact))) {
        errors.push(`verify: artifact resolves outside the root: ${message.artifact}`)
        continue
      }
      if (sha256File(artifact) !== message.base_hash) errors.push(`verify: base_hash does not match ${message.artifact}`)
    }
  }
  const payload = {
    schema: 'dezign0/review-cli/v1', command: 'protocol', action: 'validate',
    ok: errors.length === 0, valid: errors.length === 0,
    protocol: PROTOCOL_SCHEMA, count: messages.length,
    types: messages.map((message) => message?.type).filter(Boolean),
    errors,
  }
  if (flags.json) emit(flags, payload)
  else if (errors.length) {
    console.error('protocol validate: invalid')
    for (const error of errors.slice(0, 30)) console.error(`  - ${error}`)
  } else summary(flags, `protocol validate: ${messages.length} valid message(s)`)
  return errors.length ? 1 : 0
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dezign0-review-test-'))
  const dir = path.join(root, 'design', 'demo')
  let passed = 0
  const failures = []

  const cleanup = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      // Temp directory cleanup is best effort.
    }
  }

  const test = (name, fn) => {
    try {
      fn()
      passed += 1
      console.log(`ok   ${name}`)
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
      console.log(`FAIL ${name}: ${error.message}`)
    }
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n')
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body><button id="cta">Continue</button></body></html>\n')
    fs.writeFileSync(path.join(dir, 'project.json'), `${JSON.stringify({
      schema: PROJECT_SCHEMA, slug: 'demo', profile: 'prototype', created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z', status: 'draft',
      constraints: { entry: 'index.html' }, artifacts: [{ role: 'entry', path: 'index.html', status: 'done' }], coverage: { notReviewed: [] },
    }, null, 2)}\n`)
    fs.writeFileSync(path.join(dir, 'HANDOVER.md'), '# Demo — handover\n\n## 1. What ships\n\n| Output | Source |\n|---|---|\n')
    fs.writeFileSync(path.join(dir, 'ANNOTATIONS.json'), `${JSON.stringify({ schema: ANNOTATIONS_SCHEMA, project: 'demo', round: 1, updated: '2026-01-01T00:00:00.000Z', items: [] }, null, 2)}\n`)

    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
      return result.stdout.trim()
    }
    git('init', '-q')
    git('config', 'user.name', 'Review Tester')
    git('config', 'user.email', 'review@example.test')
    git('add', 'README.md')
    git('commit', '-q', '-m', 'initial')

    const run = (...args) => spawnSync(process.execPath, [SELF, ...args, '--root', root, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    const json = (result) => {
      if (!result.stdout) throw new Error(`no stdout; stderr: ${result.stderr.trim()}`)
      return JSON.parse(result.stdout)
    }

    let firstHash = ''

    test('history save creates two snapshots', () => {
      const headBefore = git('rev-parse', 'HEAD')
      const first = run('history', 'save', 'demo', '-m', 'first')
      if (first.status !== 0) throw new Error(first.stderr || first.stdout)
      const firstPayload = json(first)
      if (!HASH_RE.test(firstPayload.hash)) throw new Error('bad snapshot hash')
      firstHash = firstPayload.hash
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body><button id="cta">Ship it</button></body></html>\n')
      const second = run('history', 'save', 'demo', '-m', 'second')
      if (second.status !== 0) throw new Error(second.stderr)
      const listed = json(run('history', 'list', 'demo'))
      if (listed.count !== 2) throw new Error(`expected 2 snapshots, got ${listed.count}`)
      const subjects = listed.snapshots.map((snapshot) => snapshot.subject)
      if (!subjects.includes('first') || !subjects.includes('second')) throw new Error(`snapshot messages lost: ${subjects.join(', ')}`)
      if (git('rev-parse', 'HEAD') !== headBefore) throw new Error('HEAD changed')
      if (git('diff', '--cached', '--name-only')) throw new Error('snapshot staged files in the real index')
    })

    test('history restore is destructive without --confirm', () => {
      if (!firstHash) throw new Error('first snapshot missing')
      const refused = run('history', 'restore', 'demo', firstHash)
      if (refused.status !== 1) throw new Error(`expected exit 1, got ${refused.status}`)
      const wrong = run('history', 'restore', 'demo', firstHash, '--confirm=deadbeef')
      if (wrong.status !== 1) throw new Error(`expected wrong confirmation to exit 1, got ${wrong.status}`)
      const dry = run('history', 'restore', 'demo', firstHash, `--confirm=${firstHash.slice(0, 12)}`, '--dry-run')
      if (dry.status !== 0 || json(dry).dryRun !== true) throw new Error('dry run failed')
      const restored = run('history', 'restore', 'demo', firstHash, `--confirm=${firstHash.slice(0, 12)}`)
      if (restored.status !== 0) throw new Error(restored.stderr || restored.stdout)
      const content = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
      if (!content.includes('Continue')) throw new Error('artifact was not restored to the first snapshot')
      if (json(restored).restored < 1) throw new Error('restore reported no files')
    })

    test('approve writes project.json and HANDOVER.md', () => {
      const approved = run('approve', 'demo', '--by', 'Owner', '--at', '2026-02-03T04:05:06.000Z', '--note', 'ship it')
      if (approved.status !== 0) throw new Error(approved.stderr || approved.stdout)
      const payload = json(approved)
      const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
      if (project.approved_by !== 'Owner' || project.status !== 'approved') throw new Error('project approval fields missing')
      if (project.artifact_hash !== payload.artifact_hash) throw new Error('project artifact_hash mismatch')
      const handover = fs.readFileSync(path.join(dir, 'HANDOVER.md'), 'utf8')
      if (!/^## Approval$/m.test(handover) || !handover.includes('approved_by: Owner')) throw new Error('HANDOVER approval section missing')
      if (!handover.includes(payload.artifact_hash)) throw new Error('HANDOVER artifact_hash missing')
      const again = run('approve', 'demo', '--by', 'Owner2', '--at', '2026-02-04T00:00:00.000Z')
      if (again.status !== 0) throw new Error(again.stderr)
      const handover2 = fs.readFileSync(path.join(dir, 'HANDOVER.md'), 'utf8')
      if ((handover2.match(/^## Approval$/gm) || []).length !== 1) throw new Error('approval section was duplicated')
      if (!handover2.includes('approved_by: Owner2')) throw new Error('approval did not update')
    })

    test('annotate add, list and resolve follow the contract', () => {
      const added = run('annotate', 'add', 'demo', '--selector', '#cta', '--note', 'Target size is 32px, needs 44px.', '--severity', 'P1', '--author', 'Critic', '--box', '10,20,160,32')
      if (added.status !== 0) throw new Error(added.stderr || added.stdout)
      const item = json(added).item
      if (!item.id || item.status !== 'open' || item.box.width !== 160) throw new Error('annotation entry is wrong')
      const open = json(run('annotate', 'list', 'demo', '--status=open'))
      if (open.count !== 1) throw new Error('open annotation not listed')
      const resolved = run('annotate', 'resolve', 'demo', item.id, '--evidence', 'index.html:12')
      if (resolved.status !== 0) throw new Error(resolved.stderr)
      const done = json(run('annotate', 'list', 'demo', '--status=resolved'))
      if (done.count !== 1 || done.items[0].evidence !== 'index.html:12') throw new Error('resolved annotation not listed')
      const missing = run('annotate', 'resolve', 'demo', 'ann-999')
      if (missing.status !== 1) throw new Error('missing annotation should exit 1')
    })

    test('protocol describe and validate', () => {
      const described = run('protocol', 'describe')
      if (described.status !== 0 || !json(described).examples.patch) throw new Error('protocol describe failed')
      const good = path.join(root, 'good.json')
      fs.writeFileSync(good, JSON.stringify([
        { schema: PROTOCOL_SCHEMA, type: 'select', id: 'sel-001', artifact: 'design/demo/index.html', selection: { selector: '#cta', box: { x: 1, y: 2, width: 3, height: 4 }, viewport: '1440x900' } },
        { schema: PROTOCOL_SCHEMA, type: 'instruction', id: 'ins-001', artifact: 'design/demo/index.html', selection_id: 'sel-001', instruction: 'Raise the target height.' },
        { schema: PROTOCOL_SCHEMA, type: 'patch', id: 'pat-001', artifact: 'design/demo/index.html', instruction_id: 'ins-001', base_hash: 'a'.repeat(64), patch: { format: 'search-replace', find: '32px', replace: '44px' } },
      ], null, 2))
      const valid = run('protocol', 'validate', good)
      if (valid.status !== 0) throw new Error(valid.stderr || valid.stdout)
      const artifactHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'index.html'))).digest('hex')
      const verified = path.join(root, 'verified.json')
      fs.writeFileSync(verified, JSON.stringify({ schema: PROTOCOL_SCHEMA, type: 'patch', id: 'pat-003', artifact: 'design/demo/index.html', base_hash: artifactHash, patch: { format: 'full-file', content: '<!doctype html><html></html>\n' } }))
      if (run('protocol', 'validate', verified, '--verify').status !== 0) throw new Error('verified patch should pass')
      fs.writeFileSync(verified, JSON.stringify({ schema: PROTOCOL_SCHEMA, type: 'patch', id: 'pat-004', artifact: 'design/demo/index.html', base_hash: 'b'.repeat(64), patch: { format: 'full-file', content: '<!doctype html>\n' } }))
      if (run('protocol', 'validate', verified, '--verify').status !== 1) throw new Error('stale base_hash should fail')
      const bad = path.join(root, 'bad.json')
      fs.writeFileSync(bad, JSON.stringify({ schema: PROTOCOL_SCHEMA, type: 'patch', id: 'pat-002', artifact: '../escape.html', base_hash: 'nope', patch: { format: 'search-replace' } }))
      if (run('protocol', 'validate', bad).status !== 1) throw new Error('invalid protocol should exit 1')
    })

    test('path containment refuses escaped projects and artifacts', () => {
      const escaped = spawnSync(process.execPath, [SELF, 'history', 'list', '../escape', '--root', root, '--json'], { encoding: 'utf8' })
      if (escaped.status === 0) throw new Error('escaped slug was accepted')
      const outside = spawnSync(process.execPath, [SELF, 'annotate', 'add', 'demo', '--selector', '#id', '--note', 'x', '--artifact', '../outside.html', '--root', root, '--json'], { encoding: 'utf8' })
      if (outside.status === 0) throw new Error('escaped artifact was accepted')
    })
  } catch (error) {
    failures.push(`setup: ${error.message}`)
    console.log(`FAIL setup: ${error.message}`)
  } finally {
    cleanup()
  }

  console.log(`\nreview self-test: ${passed} passed, ${failures.length} failed`)
  return failures.length ? 1 : 0
}
// ── Main ───────────────────────────────────────────────────────────────────
function main(argv) {
  const wantsJson = argv.includes('--json') || argv.includes('-j')
  let flags = wantsJson ? { json: true } : {}
  try {
    const parsed = parseArgs(argv)
    flags = parsed.flags
    if (flags['self-test']) return selfTest()
    if (flags.help || !parsed.positionals.length) usage(flags.help ? 0 : 2)
    const command = parsed.positionals[0]
    const rest = parsed.positionals.slice(1)
    if (command === 'history') return commandHistory(flags, rest)
    if (command === 'approve') return commandApprove(flags, rest)
    if (command === 'annotate') return commandAnnotate(flags, rest)
    if (command === 'protocol') return commandProtocol(flags, rest)
    throw new ReviewError(`unknown command: ${command} (history|approve|annotate|protocol)`)
  } catch (error) {
    const code = error instanceof ReviewError ? error.code : 2
    const message = error instanceof Error ? error.message : String(error)
    if (flags.json) {
      emit(flags, { schema: 'dezign0/review-cli/v1', ok: false, exitCode: code, error: message })
    } else {
      console.error(`review: ${message}`)
    }
    return code
  }
}

process.exitCode = main(process.argv.slice(2))
