# OpenChamber / OpenCode plugin

`dezign0` is a zero-dependency OpenCode 2 plugin. Install it from OpenChamber's
**Settings → Plugins → Add plugin** screen, or from `opencode.json`.

On load it:

1. copies the bundled kit to `<project>/.design-os` (only if it does not exist);
2. registers six skills: `dezign0-design-brief`, `dezign0-frontend-design`,
   `dezign0-redesign`, `dezign0-critique`, `dezign0-design-system-extract`,
   `dezign0-state-board`.

It does not register tools, run commands or edit source files. The skills tell
the agent when to read `DESIGN-OS.md`, create a brief, run a critique and produce
a handover.

## Install in OpenChamber

**From local path:**

1. Download the repo somewhere permanent.
2. Settings → Plugins → Add plugin → **From local path**.
3. Spec: the absolute path to the repo **root directory**. OpenCode requires a
   directory here; do not point it at `plugin/index.js`.
4. Scope: **User** (all projects) or **Project** (this repo only).
5. Add, then restart or reload OpenChamber. The plugin should show **Loaded**.
6. Open a session; the six `dezign0-*` skills should appear in Skills.

**From npm (after publishing):**

1. Publish once from the repo root:
   ```bash
   npm login
   npm publish --access public
   ```
2. Settings → Plugins → Add plugin → **From npm**.
3. Spec: `dezign0` (or `dezign0@0.3.0`).
4. Reload.

Full guide: [docs/PUBLISHING.md](../docs/PUBLISHING.md).

**From `opencode.json`:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["dezign0"]
}
```

For a local install, use the absolute path instead of `dezign0`. OpenChamber
writes this list for you.

## Verified

Tested against the OpenChamber-managed OpenCode **2.1.3** binary with
`opencode run --standalone` in a temporary project:

- User/custom config and project `.opencode/opencode.json` both load the plugin.
- `.design-os/` is created in the project.
- Six `SKILL.md` files are present under `.design-os/skills/`.

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

## What it does not do

- It does not install Playwright or any npm dependency.
- It does not overwrite an existing `.design-os`.
- It does not bundle third-party design systems, templates or skill bodies.
- It does not register slash commands. Use the skills conversationally, or use
  the OpenCode 1.x installer for `/design-new`, `/design-review`, `/design-ship`.

## Development

```bash
npm run plugin:test
npm pack --dry-run
```

The smoke test uses a mock OpenCode context: it verifies kit copying and six
skill registrations without starting a server.
