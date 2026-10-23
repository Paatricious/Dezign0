# OpenChamber / OpenCode plugin

`dezign0` is a zero-dependency OpenCode 2 plugin. Install it from OpenChamber's
**Settings → Plugins → Add plugin** screen, or from `opencode.json`.

On load it:

1. copies the bundled kit to `<project>/.design-os` (only if it does not exist);
2. registers eight skills: `dezign0-design-brief`, `dezign0-frontend-design`,
   `dezign0-redesign`, `dezign0-critique`, `dezign0-design-system-extract`,
   `dezign0-state-board`, `dezign0-figma-context`, `dezign0-design-language`.

It registers three read-only tools for the mechanical checks and does not edit
source files. The skills tell the agent when to read `DESIGN-OS.md`, create a
brief, run a critique and produce a handover.

## Tools

| Tool | What it does |
|---|---|
| `dezign0_lint` | Runs `design-lint.mjs` on an artifact inside the project. |
| `dezign0_measure` | Runs Playwright measurements; explains clearly if Playwright is missing. |
| `dezign0_doctor` | Reports plugin/kit version, skill count, lint/measure scripts, Playwright and design-language count. |
| `dezign0_design_systems` | Lists, searches and returns a package from the optional design-language catalog. |

All tools resolve paths with `realpath` and reject anything outside the current
project. They spawn Node with a fixed script and argument list; there is no
shell.

## Install in OpenChamber

**From local path:**

1. Download the repo somewhere permanent.
2. Settings → Plugins → Add plugin → **From local path**.
3. Spec: the absolute path to the repo **root directory**. OpenCode requires a
   directory here; do not point it at `plugin/index.js`.
4. Scope: **User** (all projects) or **Project** (this repo only).
5. Add, then restart or reload OpenChamber. The plugin should show **Loaded**.
6. Open a session; the eight `dezign0-*` skills appear in Skills and the four
   `dezign0_*` tools appear in the tool list.

**From npm (after publishing):**

1. Publish once from the repo root:
   ```bash
   npm login
   npm publish --access public
   ```
2. Settings → Plugins → Add plugin → **From npm**.
3. Spec: `dezign0` (or a pinned version such as `dezign0@0.6.0`).
4. Reload.

The live npm `0.5.0` package has seven skills and the tools. The `0.6.0` git tag adds the design-language skill, the 152-package catalog and the 0.5.x fixes.

**From git (tool-enabled, no npm auth):**

```text
github:Paatricious/Dezign0#v0.6.0
```

Use this in the **From npm** spec field, or in `opencode.json`:

```json
{ "plugins": ["github:Paatricious/Dezign0#v0.6.0"] }
```

This installs the tagged public repository and includes `dezign0_lint`,
`dezign0_measure` and `dezign0_doctor`.

Full guide: [docs/PUBLISHING.md](../docs/PUBLISHING.md).

**From `opencode.json`:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["dezign0"]
}
```

For a local install, use the absolute path instead of `dezign0` and use forward
slashes in JSON, e.g. `"C:/Users/me/Dezign0"`. OpenChamber writes this list for you.

Options:

```json
{
  "plugins": [
    { "package": "dezign0", "options": { "copyKit": false, "tools": false } }
  ]
}
```

`copyKit: false` registers the package skills without creating `.design-os/`;
`tools: false` skips the three tools. **User scope** copies the kit into every
project you open, so use Project scope (or `copyKit: false`) if you do not want
that.

## Verified

Tested against the OpenChamber-managed OpenCode **2.1.3** binary with
`opencode run --standalone` in a temporary project:

- User/custom config and project `.opencode/opencode.json` both load the plugin.
- `.design-os/` is created in the project.
- Eight `SKILL.md` files are present under `.design-os/skills/`.

The plugin does not need npm dependencies, a build step or Playwright.

## Requirements

- OpenCode 2.x. OpenChamber 2.5.1 manages OpenCode 2.1.3.
- OpenCode 1.x uses the kit installer instead:
  `node design-os/install.mjs --harness=opencode`.
- Playwright is optional. The kit's `measure-artifact` tool uses it; lint works
  without it.

## Verify

After reload:

```text
Settings -> Plugins -> dezign0 = Loaded
New session -> Skills -> dezign0-design-brief, dezign0-critique, ...
The project now has .design-os/DESIGN-OS.md
```

If it is not loaded, check the OpenCode/OpenChamber log for the plugin import
error. OpenCode resolves a local plugin directory by trying `<dir>/server` first,
which is why the repo root has `server.js`; that file re-exports
`plugin/index.js`.

## Uninstall

Remove `.design-os/` from the project and delete the plugin entry in OpenChamber
or `opencode.json`. The plugin does not remove project files automatically.

## What it does not do

- It does not install Playwright or any npm dependency.
- It does not overwrite an existing `.design-os`.
- The core plugin does not bundle third-party design systems, templates or
  skill bodies. Install the optional catalog for all 152 languages:

```bash
npm install https://github.com/Paatricious/Dezign0/releases/download/v0.6.0/dezign0-design-languages-0.1.0.tgz
```
- It does not register slash commands. Use the skills conversationally, or use
  the OpenCode 1.x installer for `/design-new`, `/design-review`, `/design-ship`.
- It does not delete or rewrite existing source files. It only creates
  `.design-os/` when the kit is missing.

## Development

```bash
npm run plugin:test
npm pack --dry-run
```

The smoke test uses a mock OpenCode context: it verifies kit copying and eight
skill registrations without starting a server.
