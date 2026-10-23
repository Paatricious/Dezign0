# Publishing Dezign0 to npm

The repository is an npm package (`dezign0`) **and** an OpenCode 2 plugin. Once
published, OpenChamber can install it from **Settings → Plugins → Add plugin →
From npm** with the spec `dezign0`.

The package is `96.5 kB` packed / `268.9 kB` unpacked and includes `server.js`,
`plugin/`, the kit and docs. It does **not** include third-party design systems,
templates or skill bodies.

## One-time setup

```bash
cd "<path-to-Dezign0>"

npm login
npm whoami
npm publish --dry-run --access public
```

`npm login` opens the browser or asks for username/password/OTP. Use the same
account that owns the package name.

## Publish

```bash
npm publish --access public
```

If npm asks for a one-time code:

```bash
npm publish --access public --otp=123456
```

`prepublishOnly` runs `npm run check` first: syntax checks and the plugin smoke
test. A failure stops the publish.

Verify:

```bash
npm view dezign0 version
npm view dezign0 dist.tarball
```

### New-package staging

For a package name that has never been published, npm may first create a
`0.0.0-stage` placeholder and process the real version asynchronously. The
publish command exits successfully while the registry briefly still shows the
placeholder. Poll until the real version appears:

```bash
npm view dezign0 version
```

This can take a few minutes. The `dezign0@0.5.2` release is the current example.

## Install in OpenChamber

1. **Settings → Plugins → Add plugin**
2. **From npm**
3. Spec:

```text
dezign0
```

Pin a version if you want reproducibility:

```text
dezign0@0.5.2
```

4. Scope: **User** or **Project**
5. Add, then reload/restart OpenChamber.
6. The card should show **Loaded**. The project gets `.design-os/`; seven
   `dezign0-*` skills appear in Skills.

## Versioning

The package version lives in `package.json`. Bump it before publishing:

```bash
npm version patch   # 0.5.2 -> 0.5.3
# or: npm version minor / major
git push --follow-tags
npm publish --access public
```

OpenCode caches npm plugins. After a new version:

```bash
opencode plugin check
opencode plugin update
```

or use OpenChamber's plugin update action.

## Optional: GitHub Actions release workflow

The repo includes `.github/workflows/publish.yml`, triggered manually. A git tag
is not required for release.

1. Create an npm **automation** token:
   <https://www.npmjs.com/settings/~/tokens>
2. Add it to GitHub: **Settings → Secrets and variables → Actions → New
   repository secret** named `NPM_TOKEN`.
3. Run **Actions → publish → Run workflow**, or push a tag:

```bash
npm version patch
git push --follow-tags
```

The workflow runs `npm publish --provenance --access public`. Provenance requires
`id-token: write`, which is set in the workflow.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ENEEDAUTH` | `npm login` first |
| `EOTP` | Add `--otp=<code>` |
| `403 You do not have permission to publish` | Package name belongs to another account/scope; rename in `package.json` |
| OpenChamber From npm cannot find it | `npm view dezign0 version` first; registry propagation can take a minute |
| Plugin shows Loaded but no `.design-os` | Open a session; setup runs when a location is activated |
| Local path works but npm does not | Check the published tarball contains `server.js` and `plugin/`: `npm pack --dry-run` |
| Old version still loads | `opencode plugin update` or clear the plugin cache |

## Why `server.js` matters

OpenCode 2 resolves a plugin directory by trying `<dir>/server` first. For npm
packages it resolves the package directory too; shipping `server.js` at the root
makes both local and registry installs resolve the same entrypoint. The npm
`main` still points at `plugin/index.js` for normal imports.
