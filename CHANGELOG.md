# Changelog

All notable changes are recorded here. The format follows Keep a Changelog and
the project uses semantic versioning.

## [0.8.0] - 2026-10-23

### Added

- `dezign0` CLI: lint, measure, audit, doctor, systems, addons, new, export;
  JSON envelopes and stable exit codes.
- GitHub composite action with sticky review output, screenshots and P0 gate.
- MCP stdio server with seven tools and an Agent Plugins 1.0 package.
- Optional axe-core, WCAG 2.2 mapping, target size, non-text contrast, reflow,
  text spacing, forced-colors, print, runtime and keyboard/ARIA checks.
- Token export to DTCG, Tailwind v4, shadcn, SwiftUI, Compose and Flutter;
  token lint and design-system package validation.
- AI-tell and content lint.
- Project scaffold, annotations, review bundle and ADR template.
- Eval harness with WITH/WITHOUT delta.
- `capabilities.json`, doc consistency check and expanded CI smoke suite.

### Changed

- Core 0.8.0 pairs with addon pack 0.2.1.
- CLI/MCP tests, content fixtures and evals are in the expanded check suite.

## [0.7.1] - 2026-10-23

### Changed

- Removed upstream product branding from package metadata, docs, skills and all
  152 design-system packages.
- Upstream license and attribution are preserved in `LICENSE`, `NOTICE`,
  `ATTRIBUTION.md` and `licenses/` without the upstream product name.
- Addon pack bumped to 0.2.1 for the white-label build.

## [0.7.0] - 2026-10-23

### Added

- Five addon workflows: `template-start`, `figma-to-code`, `code-handoff`,
  `visual-review` and `media-brief`.
- `dezign0_addons` tool for the optional catalog.
- Original starter templates: deck, live dashboard and mobile prototype.
- Figma bridge and React/Next/Vue handoff contracts.
- Visual review playbooks and exact-size, selector-scoped, accessibility checks
  (`--viewports=145x188`, `--selector`, `--a11y`).
- Original image prompt and video storyboard packs.
- Optional pack v0.2.0: 152 design languages plus all addon sections.

### Changed

- Thirteen skills and five tools; core tarball remains ~109 kB packed.

## [0.6.0] - 2026-10-23

### Added

- Optional `design-languages` pack: all **152** the upstream catalog design-system
  packages, pinned at `e03d5c23f308c39f4de7c057568df66c29a84385`, with Apache-2.0
  license, NOTICE, attribution and upstream MIT license texts.
- `dezign0_design_systems` tool: list, search and get a design language.
- `design-language` skill: choose one prebuilt language and apply it.
- `docs/figma.md` and Figma context skill from the research round.
- Harness adapters and Claude Code bootstrap from 0.5.x.

### Changed

- Core package remains small; the 4.8 MB (packed) / 32.5 MB (unpacked) catalog
  installs separately.
- Eight skills and four tools.

## [0.5.2] - 2026-10-23

### Added

- Doctor reports kit drift and whether Playwright resolves from the project.
- Missing files in a current-version kit are repaired on setup.

### Fixed

- Doctor now distinguishes the project kit from the packaged lint/measure
  scripts, so "doctor says missing, tool works" cannot happen silently.

## [0.5.1] - 2026-10-23

### Fixed

- `dezign0_measure` now resolves Playwright from the **project**, not from the
  bundled plugin directory. The MCP tool works when Playwright is installed in
  the project.
- The installer writes `.design-os/.dezign0-kit.json` for every install mode,
  including `--harness=files`.
- The plugin repairs a legacy kit that has no metadata and upgrades a stale
  `.design-os` on version mismatch, preserving modified files and backing up
  overwritten ones under `.design-os/.backup-<timestamp>/`.
- The doctor now reports that lint/measure scripts come from the packaged kit.

## [0.5.0] - 2026-10-23

### Added

- `figma-context` skill: read a Figma file/frame through the user's MCP server,
  grade evidence SOURCE/PARTIAL/GUESS and write `design/<slug>/FIGMA.md`.
- Harness adapter registry for 12 targets: OpenCode, Claude Code, Codex, Cursor,
  Windsurf/Devin, Cline, Roo, OpenHands, Aider, DSH, Gemini CLI and files-only.
- Claude Code `SessionStart` hook that materialises `.design-os/` in the project.
- Visual-review protocol for screenshots, annotations and before/after shots.
- `docs/figma.md`, adapter checks and Codex path regression test.

### Fixed

- Codex now installs to `.codex/skills`, not `.agents/skills`.
- Claude Code marketplace installs no longer leave skills pointing at a missing
  `.design-os/` kit.

## [0.4.0] - 2026-10-23

### Added

- OpenCode tools: `dezign0_lint`, `dezign0_measure`, `dezign0_doctor`.
- `.design-os/.dezign0-kit.json` version and per-file hash metadata; doctor
  reports drift.
- Claude Code plugin and marketplace manifests (`.claude-plugin/`).
- `SECURITY.md`.
- Installer `--upgrade`, strict boolean parsing, target pre-flight and a
  Windows/Linux installer regression test.
- CI now runs on Ubuntu and Windows.

### Changed

- Plugin no longer guesses a working directory when `ctx.location.directory` is
  absent; it registers package skills only.
- Skill bodies reference kit files under `.design-os/`.
- Critique gate is dimensional: no scored dimension below 7 and composite ≥8.0.
- Responsive breakpoints are canonical: 320 / 375 / 390 / 768 / 1024 / 1440.
- Installer examples pass `--target` explicitly.

### Fixed

- `--force=false` and `--dry-run=false` no longer act as true.
- `.design-os` as a file and installing into the Dezign0 checkout now fail with
  clear errors instead of stack traces.
- Missing measurement artifact in documented commands.
- Dead `templates/` reference.
- Installer can refresh a managed `AGENTS.md` block with `--force` or
  `--upgrade`.

## [0.3.0] - 2026-10-23

### Added

- Public npm package `dezign0`, initial OpenChamber/OpenCode 2 install path.
- Kit copy, six skills, local and npm install docs.

## [0.2.0]

- OpenCode 2 plugin packaging and smoke test.

## [0.1.0]

- Initial Design OS kit, installer and review tools.
