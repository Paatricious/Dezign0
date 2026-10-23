---
name: figma-to-code
description: Turn a Figma selection into implementable tokens and code through the Figma bridge addon and the user's Figma MCP tools. Use when Figma is the source of truth for a UI that must be built.
---

# Figma to code

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

This skill is a pipeline: Figma evidence -> mapping document -> design spec ->
code. It never guesses values from a thumbnail and never claims a Figma API that
was not available.

## 1. Read the Figma node

Use the `figma-context` skill to read the smallest node that contains the task
(metadata, design context, screenshot, variables). Record file key, node ID,
selection name and tool used. If no Figma MCP tool is available, ask for a
screenshot plus the copied design context/variables; grade everything you get
below as PARTIAL.

## 2. Load the bridge

Call `dezign0_addons`:

- `{ "action": "list", "section": "figma" }` to confirm what the pack contains;
- `{ "action": "get", "id": "figma-bridge" }` for the mapping rules;
- `{ "action": "search", "section": "figma", "query": "variables" }` if the pack
  revision differs and the id is unknown.

In a source checkout the bridge is `design-languages/figma/bridge.md`. If the
pack is missing, continue with the node evidence and say the bridge was not
loaded.

## 3. Map, do not eyeball

Write `design/<slug>/FIGMA.md` as the capture record. It needs the source
(`url`, `fileKey`, `nodeId`, selection, frame size), the capture (`tool`, client,
timestamp, modes read), and the mapping:

- variables and styles -> token roles and values, with the Figma variable name;
- auto-layout -> flex/grid, including gaps, padding and constraints;
- component variants and properties -> props and states;
- text styles -> type scale, weights, line heights and tracking;
- assets -> exported files or labelled placeholder slots, with licences.

Every value carries a grade: SOURCE (metadata/context/variables), PARTIAL
(screenshot or incomplete context) or GUESS. A GUESS lives only in a clearly
separated "proposed" section, never in `tokens.css`.

## 4. Freeze the spec, then build or hand off

Copy the mapped values into `.design-os/briefs/DESIGN-SPEC.md`, then build per
`frontend-design`. Use the node's exact frame size and every target size from the
brief; for a fixed widget cell verify the rendered box, not the nominal value.
When another agent implements the result, continue with `code-handoff` and the
handoff contract.

## 5. Verify against the node and the bridge

- Compare the built artifact with the Figma screenshot at the same size and theme.
- Run `dezign0_lint`, and `dezign0_measure` with `a11y: true` when a browser is
  available.
- For a widget cell, measure the exact box (for example `145x188`) and report the
  delta; a difference is a finding, not rounding.
- Walk the bridge's acceptance checklist by group (evidence, tokens, layout,
  type/components/assets, workflow) and list every item that is unverified.

## Evidence

Report: file key, node ID, selection, MCP tools used (or absent), every token
with its grade, the mapping table location, measured geometry, and what could not
be read. Screenshot-only work is PARTIAL and must say so.

## Anti-patterns

- Inventing spacing or colors from a compressed screenshot.
- Claiming Code Connect or the Variables REST API was used.
- Dumping the whole Figma file instead of the selected node.
- Hardcoding Figma node IDs or auto-layout artifacts into product code.
- Treating a screenshot as the spec when the node context exists.

## When not to use

Do not use when there is no Figma source; use `design-system-extract`,
`redesign` or `visual-review`. Do not use for a generic style choice with no
file; use `design-language`. If there is no Figma access, no screenshot and no
exported context, stop and ask for one.
