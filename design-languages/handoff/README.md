# Implementation handoff

Turn a finished, critiqued Dezign0 HTML artifact into framework components without
losing the design contract. This addon is framework guidance, not a generator and
not a scaffold. It contains no third-party framework code.

Original Dezign0 content; it is not derived from the upstream catalog packages in
`design-languages/design-systems/`.

## Where this fits

Dezign0's loop ends with a handover document and frozen tokens
(`design-os/DESIGN-OS.md` §10). This directory is the next step for teams that
implement in code:

```text
artifact.html + tokens.css + HANDOVER.md + TOKENS.md
        │
        ├─ contract.md      framework-agnostic translation rules
        │
        ├─ react.md         React SPA mechanics
        ├─ next.md          Next.js App Router mechanics
        └─ vue.md           Vue 3 SFC mechanics
```

Use it after the artifact is final. If the design is still moving, the port is a
rewrite and the freeze rule in [`contract.md`](contract.md) cannot hold.

## Read order

1. `design/<slug>/HANDOVER.md` — the design agent's DOM/class and behavior
   contract, written for the implementer.
2. `design/<slug>/artifact.html` — the rendered source of truth.
3. `design/<slug>/tokens.css` — values copied verbatim from the artifact.
4. `TOKENS.md` — roles, contrast, motion, exclusions.
5. [`contract.md`](contract.md) — component tree, props, state, tokens,
   accessibility and parity rules.
6. One framework guide: [`react.md`](react.md), [`next.md`](next.md) or
   [`vue.md`](vue.md).

The `code-handoff` skill walks the same order. In the addon pack it loads these
files through `dezign0_addons` as `handoff-contract`, `handoff-react`,
`handoff-next` and `handoff-vue`
([addons/index.json](../addons/index.json)); in a source checkout the paths above
are canonical.

If the design came from Figma, read
[`../figma/bridge.md`](../figma/bridge.md) before step 1: it defines how Figma
variables, auto-layout, variants and text styles became the artifact's tokens and
structure.

## Choose a framework

| Project | Guide |
|---|---|
| React SPA (Vite, CRA-style, React Router) | [`react.md`](react.md) |
| Next.js 15+ App Router | [`next.md`](next.md) |
| Vue 3.4+ SPA (Vite, Vue Router) | [`vue.md`](vue.md) |
| Nuxt | [`vue.md`](vue.md) plus the project's routing/data rules |
| Angular, Svelte, Web Components, server-rendered PHP/Rails | [`contract.md`](contract.md) only |

The contract is the portable part. The framework guides exist to prevent
framework-specific mistakes (server/client boundaries in Next, scoped-style
leakage in Vue, effect abuse in React) — not to prescribe a stack.

## Preconditions

- The artifact is final and the critique is closed.
- `tokens.css` matches the artifact; no open token changes.
- Every state in the handover matrix is either designed or explicitly accepted as
  missing.
- Framework, styling approach and dependency budget are agreed before the port
  starts. Adding a component library mid-port invalidates the parity checks.
- Accessibility floor is accepted as non-negotiable (see `contract.md` §6).

## Workflow

1. **Inventory.** Classify the artifact into page, regions, components and
   primitives (`contract.md` §1). Write the component tree before code.
2. **Decide the API.** Map variation to props, state to owners, classes to hooks
   (`contract.md` §2–3). Record the decisions in the handoff record.
3. **Map tokens once.** Decide how `tokens.css` is imported and, if the project
   uses a utility theme, how it is generated from the same tokens
   (`contract.md` §4). Never hand-maintain a second palette.
4. **Port in order.** Primitives, composites, sections, page shell. One component,
   then review, then the next (`react.md` §10, `vue.md` §10).
5. **Verify parity.** Side-by-side at the artifact's breakpoints, computed styles
   against tokens, all states reachable, keyboard path, axe, contrast per mode
   (`contract.md` §8).
6. **Record and sign off.** Attach the handoff record and list every approved
   deviation (`contract.md` §10).

## What this addon will not do

- It will not generate a project, install dependencies, or choose a stack for you.
- It will not "improve" the design: no normalised radii, no rewritten copy, no
  added animation.
- It will not replace the artifact as the source of truth. The port is checked
  against the artifact, not against this prose.
- It will not carry asset or font licences for you. Provenance from the design
  handover must survive into the repo.

## Acceptance, in one paragraph

A port is accepted when it renders the artifact's layout and states at every
breakpoint, consumes only tokens for design values, passes keyboard and
accessibility checks, matches the measured contrast per mode, adds no unapproved
dependency, and ships with a filled handoff record. The detailed criteria are in
`contract.md` §8 and each framework guide; run them before opening the PR, not
after review.
