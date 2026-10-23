# Upstream design-system notes

This pack contains **152 portable design-system packages** derived from an
upstream Apache-2.0 catalog.

Each package follows the same machine-readable shape:

```text
design-systems/<slug>/
├── manifest.json
├── DESIGN.md
├── tokens.css
└── ...components, preview, source and usage files
```

- `manifest.json` owns discovery metadata, provenance and declared paths.
- `DESIGN.md` is the canonical design prose for agents.
- `tokens.css` is the canonical compiled semantic-token stylesheet.

The package catalog is scanned by `index.json`. The upstream license and
attribution are preserved in [LICENSE](LICENSE), [NOTICE](NOTICE) and
[ATTRIBUTION.md](ATTRIBUTION.md). Upstream MIT license texts are in `licenses/`.

Brand-referencing packages are aesthetic inspirations, not official brand
assets. Their inclusion does not imply endorsement.
