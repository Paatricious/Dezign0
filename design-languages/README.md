# Dezign0 addons

Optional content pack containing all **152 design-system packages** from
[OpenDesign](https://github.com/nexu-io/open-design), pinned at commit
`e03d5c23f308c39f4de7c057568df66c29a84385`.

This is intentionally separate from the core `dezign0` plugin. The core plugin
stays small; this pack adds the design-language library and the five addon
workflows.

Each package follows OpenDesign's portable design-system shape:

```text
design-systems/<slug>/
  manifest.json
  DESIGN.md
  tokens.css
  components.html
  components.manifest.json
  design-tokens.json
  tailwind-v4.css
  USAGE.md
  preview/
  source/
```

`index.json` is a lightweight catalog: 152 entries with slug, name, category,
description, files and source metadata. The full package files stay on disk.

## Addon library

The same pack also carries original Dezign0 addons:

- `templates/` — deck, live-dashboard and mobile-prototype starters
- `figma/` — Figma-to-DESIGN/tokens/code bridge
- `handoff/` — React, Next.js and Vue delivery contracts
- `review/` — visual, exact-size and accessibility review playbooks
- `media/` — image prompt and video storyboard packs (briefs only)
- `addons/index.json` — machine-readable catalog used by `dezign0_addons`

## Install

From this repo, the plugin discovers the sibling pack automatically when it is
run from the source checkout:

```text
<repo>/design-languages/design-systems
```

For an installed plugin, install this pack in the project:

```bash
npm install https://github.com/Paatricious/Dezign0/releases/download/v0.7.0/dezign0-design-languages-0.2.0.tgz
```

This works without npm authentication because the tarball is a public GitHub
release asset. The npm name `dezign0-design-languages` is reserved for a future
registry release.

The plugin searches:

1. `DEZIGN0_DESIGN_LANGUAGES` environment variable
2. `<project>/design-systems`
3. `<project>/node_modules/dezign0-design-languages/design-systems`
4. `<dezign0 package>/../design-languages/design-systems` (source checkout)

The `dezign0_design_systems` tool lists, searches and returns a selected
`DESIGN.md`/`tokens.css` pair. The `design-language` skill uses it.

## Licensing

The OpenDesign repository is Apache-2.0. This pack preserves its `LICENSE`,
`NOTICE`, `ATTRIBUTION.md` and `OPEN-DESIGN-README.md`. Brand-referencing
packages are aesthetic inspirations, not official brand assets.

Upstream license texts are preserved under `licenses/`.

Major upstream sources credited by OpenDesign include
`VoltAgent/awesome-design-md` (MIT), `bergside/awesome-design-skills`,
`tw93/kami` (MIT) and `Tom-Opencart/tom-modern-html-style-rule` (MIT). See
`NOTICE` and each package's `manifest.json`/`source/` evidence.
