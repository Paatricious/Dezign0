# Verification receipt

This is a point-in-time record, not a guarantee. Re-run the commands and record
the date/commit for a release.

## 2026-10-23 — plugin and package

- **OpenCode 2.1.3** (managed by OpenChamber 2.5.1) loaded the published
  `dezign0@0.3.0` from npm in a temp project.
- `.design-os/` was created; six `dezign0-*` skills appeared (the 0.3.0 release).
- A local-directory install loaded the same way.
- `npm view dezign0 version` returned `0.3.0`; anonymous download of the tarball
  worked.
- The public package has no third-party design systems, templates, fonts or
  images.

Git release `v0.7.0` (public repository) additionally verified:

- Anonymous `npm pack github:Paatricious/Dezign0#v0.7.0` succeeded.
- OpenCode 2 installed that git spec, loaded the kit and reported
  `kit version: 0.7.0`, `skills: 13/13`, design languages: 152, addons: 13.
- `dezign0_lint`, `dezign0_measure`, `dezign0_doctor` are registered and
  callable through OpenCode 2.
- `dezign0_lint` returns P0/P1 findings for a fixture and rejects paths outside
  the project.
- `dezign0_measure` resolves Playwright from the project `node_modules` and
  succeeds through the plugin path.
- A legacy `.design-os` with no metadata is refreshed, and a 0.5.0 project kit
  upgrades while preserving local edits.
- The optional pack contains all 152 design systems, indexed from OpenDesign
  commit `e03d5c23f308c39f4de7c057568df66c29a84385`.
- Installer regression test covers dry-run, install with spaces, `--force=false`,
  file conflict at `.design-os`, and `--upgrade`.
- CI runs `npm run check` on Ubuntu and Windows; both pass.
- `claude plugin validate . --strict` passes; `claude plugin details` shows 13 skills and 1 SessionStart hook.
- The installer adapter check covers 12 harness targets and the Codex path regression.

## Known limits

- `measure-artifact` needs Playwright; it is optional and not bundled.
- Skill triggering was sampled on three realistic prompts, not a full benchmark.
- The npm registry serves `0.5.0`; `0.7.0` is available via the public GitHub tag
  until it is published. Installing the git spec needs no authentication.

## Reproduce

```bash
npm run check
npm pack --dry-run
claude plugin validate . --strict   # if Claude Code is installed
```

For the live OpenCode check, use a temp project with
`{"plugins":["dezign0"]}` and run a small `opencode run --standalone` prompt.
