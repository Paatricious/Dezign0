---
name: design-language
description: Choose and apply one of the optional prebundled OpenDesign design languages, or a user-installed design-systems package. Use when the user wants a known visual style, or when a project has a design-system catalog but no active DESIGN.md.
---

# Design language

Kit root: `.design-os/`.
Read `.design-os/DESIGN-OS.md` first. Write project artifacts under
`design/<slug>/`; never edit `.design-os/`.

This skill selects one prebuilt language. It does not invent one and does not
mix two.

## 1. Find the catalog

Call `dezign0_design_systems` with `action: "list"`. If no pack is installed,
stop and ask the user to install `dezign0-design-languages` or copy a
`design-systems/` folder into the project.

The local pack is optional; the core plugin works without it.

## 2. Choose one language

Use `action: "search"` with a concrete query (sector, density, mood, typography,
color) and pick the best match. State why in one sentence.

Then call `action: "get"` with the chosen `slug`. Read:

- `DESIGN.md` for intent, constraints and anti-patterns;
- `tokens.css` for values;
- `USAGE.md` and `components.html` when present.

Record the slug, OpenDesign source commit, package path and any missing files in
`design/<slug>/DESIGN-LANGUAGE.md`.

## 3. Apply it

1. Copy the selected package into `design-systems/<slug>/` if the project needs
   a durable copy. Do not edit the source package.
2. Put the language's `tokens.css` into the artifact, or map its roles into the
   project's existing tokens. Preserve role names.
3. Use its component inventory as the allowed vocabulary; do not mix a second
   design language into the same artifact.
4. Fill `design/<slug>/DESIGN-SPEC.md`, then build.

If the user supplies a brand system, the brand wins over the prebuilt language.
If the user says "surprise me", choose one language and name the tradeoff.

## 4. Evidence

Report:

- slug and package source;
- files used;
- values you copied vs inferred;
- what was missing;
- whether the artifact was rendered and measured.

## When not to use

Do not use when the user has a brand system or a specific existing UI; use
`design-system-extract` or `redesign`. Do not use when no pack is installed and
the user does not want one.
