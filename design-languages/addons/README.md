# Dezign0 addons

This directory is the addon index for the optional Dezign0 content pack.

Sections:

- `templates/` — starting points for decks, live dashboards and prototypes
- `figma/` — Figma variables/styles/components to DESIGN.md and code
- `handoff/` — HTML artifact to React, Next.js or Vue delivery contracts
- `review/` — visual, responsive and accessibility review playbooks
- `media/` — image prompts and video storyboards (briefs only; no model calls)

The plugin exposes these through `dezign0_addons`:

```text
action=list
action=search query="deck"
action=get id="template-deck"
```

Content is original to Dezign0 unless a file says otherwise. The design languages
catalog lives beside this directory under `design-systems/` and keeps its own
OpenDesign attribution and license.
