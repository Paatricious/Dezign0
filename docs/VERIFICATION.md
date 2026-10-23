# Verification receipt

This is a point-in-time record, not a guarantee. Re-run the commands and record
the date/commit for a release.

## 2026-10-23 — plugin and package

- **OpenCode 2.1.3** (managed by OpenChamber 2.5.1) loaded the published
  `dezign0@0.3.0` from npm in a temp project.
- `.design-os/` was created; six `dezign0-*` skills appeared.
- A local-directory install loaded the same way.
- `npm view dezign0 version` returned `0.3.0`; anonymous download of the tarball
  worked.
- The public package has no third-party design systems, templates, fonts or
  images.

Git release `v0.4.0` (public repository) additionally verified:

- Anonymous `npm pack github:Paatricious/Dezign0#v0.4.0` succeeded.
- OpenCode 2 installed that git spec, loaded the kit and reported
  `kit version: 0.4.0`, `skills: 6/6`.
- `dezign0_lint`, `dezign0_measure`, `dezign0_doctor` are registered and
  callable through OpenCode 2.
- `dezign0_lint` returns P0/P1 findings for a fixture and rejects paths outside
  the project.
- Installer regression test covers dry-run, install with spaces, `--force=false`,
  file conflict at `.design-os`, and `--upgrade`.
- CI runs `npm run check` on Ubuntu and Windows; both pass.
- `claude plugin validate . --strict` passes.

## Known limits

- `measure-artifact` needs Playwright; it is optional and not bundled.
- Skill triggering was sampled on three realistic prompts, not a full benchmark.
- The npm registry still serves `0.3.0`; `0.4.0` is available via the public
  GitHub tag because npm publishing needs 2FA. Installing the git spec needs no
  authentication.

## Reproduce

```bash
npm run check
npm pack --dry-run
claude plugin validate . --strict   # if Claude Code is installed
```

For the live OpenCode check, use a temp project with
`{"plugins":["dezign0"]}` and run a small `opencode run --standalone` prompt.
