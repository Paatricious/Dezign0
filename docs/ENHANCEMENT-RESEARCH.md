# Dezign0 enhancement research

**Version studied:** 0.7.1 (local `package.json`, git `f50c41d`)
**Date:** 23 October 2026
**Scope:** expanded features, integrations and improvements that follow from the
project's own architecture plus the 2025–2026 tooling landscape.
**Status of this document:** research input, not a roadmap commitment. Nothing
here is implemented.

---

## 0. How to read this

Every item is tagged with:

- **Effort** — S (≤1 week), M (2–4 weeks), L (6+ weeks), for one engineer who
  already knows the codebase.
- **Priority** — P0 (removes a current failure or unlocks adoption), P1 (clear
  value, sequence after P0), P2 (worth doing, not now).
- **Evidence** — `repo` for a verified file/behaviour in this repository,
  `doc` for a vendor/standards page opened during this research, `lane` for a
  claim returned by a parallel research pass and not independently re-opened.

Claims marked `lane` are directionally useful but should be re-checked before
they are used in public copy. In the tables, **‡** marks an item whose primary
external evidence came from a research lane and was not independently re-opened;
unmarked items rest on repository files or pages opened directly.

---

## 1. Executive summary

Dezign0's content is stronger than its delivery. The Design OS, craft rules and
critique protocol are unusually rigorous for this category; the weakest parts are
the seams around them — how the kit is installed, how checks are enforced, what
the checks actually cover, and what happens to the output after critique.

The twelve changes with the highest leverage:

1. **Ship a `dezign0 mcp` server** and an **Agent Plugins 1.0 package**. One
   portable artifact replaces twelve bespoke installers and makes the tools
   callable without per-harness glue. *(D01, D02)*
2. **Add a real CLI** (`dezign0 lint|measure|audit|new|doctor`) with stable exit
   codes and JSON output. The scripts exist; the entry point does not. A CLI is
   the prerequisite for CI, hooks and a GitHub Action. *(V01)*
3. **Publish a GitHub Action** that runs lint + measurement on pull requests,
   uploads screenshots and posts one sticky comment. This is where design review
   becomes enforceable rather than advisory. *(V02)*
4. **Fix release hygiene.** `package.json` is 0.7.1 but npm `latest` is 0.7.0,
   so the documented "install from npm" path delivers an older toolset. Publish
   0.7.1 and move to npm trusted publishing (OIDC). *(D09)*
5. **Make measurement deterministic.** Playwright is not resolvable in a clean
   checkout, so rendered checks are unavailable until the user installs it. Add
   `doctor --fix` with a pinned Playwright and fail loudly when a requested check
   cannot run. *(V11)*
6. **Enforce instead of advise.** Claude Code `PostToolUse`/`Stop` hooks and
   OpenCode `tool.execute.after`/`session.idle` can gate on P0 findings. Today
   the plugin only registers tools and a `SessionStart` bootstrap. *(D03, D04)*
7. **Replace the seven hand-rolled a11y checks with axe-core**, mapped to WCAG
   2.2 success criteria, keeping the existing measured counters. *(A01, A02)*
8. **Build the token export pipeline.** `tokens.css` is the end of the line
   today; teams need Tailwind v4 `@theme`, shadcn CSS variables and DTCG JSON.
   *(S01–S03)*
9. **Publish plugin evals with a WITH/WITHOUT delta.** The category is full of
   claims; a measured delta is the only credible proof that the kit helps.
   *(E01)*
10. **Deliver the promised project scaffold.** `ARCHITECTURE.md` documents
    `project.json` and a standard project folder; no template or command exists.
    *(P01)*
11. **Add an AI-tell detector.** Anthropic now publishes the exact generic
    patterns to avoid; Dezign0 has them as prose only. Mechanical detection is a
    sharp, defensible differentiator. *(C02)*
12. **Close the studio gap without building a studio.** A documented
    select → comment → patch protocol plus element-anchored critique gives most
    of the value at a fraction of the cost. *(R01, R02)*

---

## 2. Method and confidence

- Read the repository at 0.7.1: `README`, `package.json`, `CHANGELOG`,
  `docs/ARCHITECTURE.md`, `docs/ADOPTION.md`, `docs/VERIFICATION.md`,
  `docs/figma.md`, `design-os/**`, `plugin/index.js`, `hooks/hooks.json`,
  `.claude-plugin/**`, `design-languages/**`, `scripts/**`, `.github/workflows/**`.
- Checked the published package: `npm view dezign0 version dist-tags` → `0.7.0`.
- Opened vendor and standards pages directly where an item depends on a specific
  API or specification (Anthropic's frontend-design skill, v0 Design Mode,
  Agent Plugins 1.0, Builder.io's design-system enforcement write-up,
  the upstream catalog, Claude Code plugin evals).
- Ran three parallel research passes (AI design tools, design-QA tooling, agent
  distribution ecosystem) to widen coverage; their items are marked `lane`.
- Deliberately excluded: pricing/revenue analysis, non-English ecosystems,
  and anything requiring a Dezign0-hosted service.

**What this document is not:** a competitive teardown of the upstream catalog. Dezign0
shares an upstream catalog with it and is deliberately narrower; copying its
surface area would contradict Dezign0's own non-goals.

---

## 3. Verified baseline

### 3.1 What exists today

| Capability | Reality at 0.7.1 | Evidence |
|---|---|---|
| Design process | 8-stage loop: read, brief, direction, spec, build, critique, fix, handover | `design-os/DESIGN-OS.md` |
| Craft rules | 8 rule files incl. anti-AI-slop, motion, content | `design-os/craft/` |
| Skills | 13, portable, one `SKILL.md` each | `design-os/skills/` |
| Tools | 5 read-only: lint, measure, doctor, design-systems, addons | `plugin/index.js:49` |
| Static lint | Dependency-free HTML checks, P0/P1/P2, `--json`, `--strict` | `design-os/tools/design-lint.mjs` |
| Rendered measure | Playwright: clipped content, contrast, type sizes, focusables, pixel baseline, selector scope | `measure-artifact.mjs` |
| A11y checks | 7 hand-rolled: img alt, control name, input label, h1, heading order, main landmark, positive tabindex | `measure-artifact.mjs` |
| Harness installers | 12 adapters | `design-os/adapters/*.json` |
| OpenCode plugin | Kit copy, 13 skills, 5 tools, drift/doctor | `plugin/index.js` |
| Claude plugin | Manifest, marketplace, `SessionStart` hook only | `.claude-plugin/`, `hooks/hooks.json` |
| Design languages | 152 optional packages, manifest + tokens + components + preview | `design-languages/` |
| Addons | 13: 3 templates, Figma bridge, 3 handoff contracts, review, media | `design-languages/addons/index.json` |
| Deliverable profiles | 5: prototype, landing, dashboard, deck, document | `briefs/DELIVERABLE-PROFILES.md` |
| CI | `npm run check` on ubuntu + windows; manual npm publish | `.github/workflows/` |
| Studio / CLI / MCP / Action | None. `ARCHITECTURE.md` says "planned". | `docs/ARCHITECTURE.md:9,85,105` |

### 3.2 Documentation drift (fix before adding features)

These are small but they undermine an evidence-first product.

| Defect | Evidence |
|---|---|
| `SECURITY.md` says the plugin "registers six skills and three tools"; it registers 13 and 5 | `SECURITY.md:12,19` vs `plugin/index.js:49` |
| `ARCHITECTURE.md` describes `project.json` and `design/<slug>/project.json`; no template or scaffolder exists | `docs/ARCHITECTURE.md:53`; `briefs/` has no `PROJECT.md`/`project.json` |
| `ARCHITECTURE.md` describes `dezign0 studio`; no CLI exists | `docs/ARCHITECTURE.md:96` |
| README status says the CLI and studio are "next"; no tracking issue, milestone or design note | `README.md:8-9` |
| `docs/README.md` still lists "content packs and brand-extraction workflow" as not built, though both exist | `docs/README.md:27-29` vs `design-languages/`, `skills/design-system-extract/` |
| npm `latest` is 0.7.0 while the repo is 0.7.1 | `npm view dezign0 version`; `package.json` |
| Addon pack version (0.2.1) and core version (0.7.1) have no compatibility statement | `design-languages/addons/index.json:3` |
| The design-systems tool returns only `DESIGN.md` + `tokens.css`, though each package ships `design-tokens.json`, `tailwind-v4.css`, `components.html` and `components.manifest.json` | `plugin/index.js` `dezign0_design_systems`; `design-languages/README.md:13-25` |

A single machine-readable capability manifest read by docs, plugin and doctor
would prevent most of this class of drift *(O01, O04)*.

---

## 4. Findings by theme

### 4.1 Verification and quality gates

The lint/measure pair is the strongest mechanical asset. It is also where the
product stops: checks run when an agent chooses to run them, on one file, in one
browser, with no PR surface.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| V01 | **`dezign0` CLI** — `lint`, `measure`, `audit`, `new`, `doctor`, `export`, `eval`; `--json`, stable exit codes, config file | Scripts are only callable by path; no stable contract for hooks/CI | M | **P0** |
| V02 | **`dezign0-review` GitHub Action** — lint `--strict`, measure 3 viewports, upload PNGs, one sticky PR comment, fail on P0 | Design checks never block a merge; review lives in chat | M | **P0** |
| V03 | **Pre-commit hook** — lint changed HTML only, fast path (no browser) | Catches P0 defects before they reach a PR | S | P1 |
| V04 | **Baseline approval workflow** — `measure --baseline approve`, stores intent, approver and commit in a sidecar | Pixel baselines exist but approving one is manual and untracked | S | P1 |
| V16 | **Deterministic capture** — freeze animations, caret and clock, pin DPR, mask volatile regions before screenshots | Flaky baselines are why teams switch visual tests off | S | P1 |
| V17 | **Semantic visual diff** — anchor changed regions to DOM landmarks ("header", "card 2"), filter anti-aliasing noise | "412 pixels changed" is not actionable | L | P2 |
| V18 | **Stylelint plugin** — expose the heuristic rules to ordinary CSS/SCSS pipelines with autofix | Reaches teams that will never run a standalone linter | M | P2 |
| V19 | **CI interop** — ingest Pa11y and Lighthouse JSON, emit JUnit XML as well as SARIF | Meet teams inside dashboards they already have | S | P2 |
| V05 | **Cross-browser matrix** — Chromium, WebKit, Firefox, one viewport each by default | Chromium-only measurement misses real Safari/Firefox failures | M | P1 |
| V06 | **Forced-colors / high-contrast mode** — emulate `forced-colors: active`, check borders, icons, focus | Windows HCM is a common failure mode and is unchecked | S | P1 |
| V07 | **Zoom and reflow** — 200% text zoom, 400% reflow, 320 CSS px (WCAG 1.4.4, 1.4.10) | Current viewport sweep is not a zoom/reflow test | S | P1 |
| V08 | **Motion audit** — `prefers-reduced-motion`, layout-shift-causing animation, autoplay, infinite loops | Motion craft rules exist; nothing measures them | M | P2 |
| V09 | **Print/PDF profile** — page breaks, orphans, ink coverage, dark-mode leakage | `document` profile is a first-class deliverable but print is untested | S | P1 |
| V10 | **Runtime budget** — console errors (exists), failed requests, external origins, total transferred bytes, LCP candidate | Artifacts can silently depend on remote assets and trackers | S | P1 |
| V11 | **`doctor --fix`** — pinned Playwright into a cache dir, browser install, and a loud failure when measurement is requested but unavailable | Playwright is not resolvable in a clean checkout; doctor can only report it, measure explains it, and neither fixes it | S | **P0** |
| V12 | **SARIF output** — findings as SARIF for GitHub code scanning | P0/P1 findings cannot appear in the security/code-scanning tab | S | P2 |
| V13 | **Multi-page crawl mode** — lint/measure every HTML entry in a folder, aggregate by page | Multi-page sites are checked one file at a time | M | P2 |
| V14 | **Watch mode** — re-measure on save, terminal summary | Manual loop; agents re-run the whole command each time | S | P2 |
| V15 | **Coverage receipt** — every run records what was checked, skipped and why | `VALIDATION.md` shows reviewers already ask "what could not be reviewed" | S | P1 |

### 4.2 Accessibility and compliance

The current `--a11y` flag is honest but narrow: seven checks, no rule IDs, no
success-criterion mapping, no keyboard traversal, no screen-reader semantics, no
document-level audit. For a kit that sells review rigor, this is the largest
credibility gap after enforcement.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| A01 | **axe-core integration** — inject axe in the measurement page, merge `violations` with existing counters, dedupe | Hand-rolled checks cover a fraction of WCAG failures | M | **P0** |
| A02 | **WCAG 2.2 criterion map** — pass/fail/not-tested per SC, every finding carries SC number, level and help URL; cover the nine SCs new in 2.2 (2.4.11–2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7–3.3.9) and note that 4.1.1 was removed | Findings say "contrast" without saying which obligation | S | **P0** |
| A03 | **Keyboard traversal script** — tab order, visible focus, trap detection, return focus, skip link, no keyboard-only dead ends | The critique protocol requires this; nothing runs it | M | P1 |
| A04 | **ARIA snapshot diff** — Playwright `ariaSnapshot()` before/after state changes | Screen-reader structure is invisible to pixel checks | S | P1 |
| A05‡ | **EN 301 549 / EAA report profile** — map findings to the European harmonised standard; note EAA applicability (28 June 2025) | European teams need this framing to ship | M | P2 |
| A06‡ | **ACR/VPAT draft generator** — pre-filled VPAT 2.5 conformance report (or machine-readable OpenACR YAML) from measured evidence, clearly marked draft | Procurement asks for ACRs; nobody wants to write them by hand | M | P2 |
| A07 | **Colour-vision simulation** — deuteranopia/protanopia/tritanopia renders + "information lost" check | Palette review is currently contrast-only | S | P2 |
| A08 | **Text-spacing test** — WCAG 1.4.12 overrides applied and re-measured | Common failure for dense dashboards | S | P2 |
| A09 | **Target-size check** — WCAG 2.5.8 (24×24 CSS px minimum, exceptions) | Current tool counts focusables but not target size | S | P1 |
| A10 | **Accessibility statement scaffold** — per-artifact statement template with measured evidence and known gaps | Useful for public-sector and EU work | S | P2 |
| A11‡ | **WCAG-EM 2 evidence pack** — structured sample selection, per-SC evidence, evaluator notes, exportable report | Audits are increasingly expected to follow an evaluation methodology, not ad-hoc checks | L | P2 |
| A12 | **Non-text contrast (1.4.11)** — sample borders, icons, toggle states and focus indicators against 3:1 | Text contrast is measured; everything that is not text is not | M | P1 |
| A13‡ | **Second-engine triangulation** — optionally run IBM Equal Access and promote only findings both engines agree on | Cuts the false-positive load that makes teams ignore reports | M | P2 |

Notes:
- Keep `--a11y` working without new dependencies; axe-core is small and can be
  an optional peer, injected only when present.
- Do not claim "WCAG compliant". Report **measured coverage** and **unchecked
  criteria**; the existing "what I could not review" convention already models
  the right behaviour.

### 4.3 Design systems and tokens

The optional pack is rich — 152 systems, each with `DESIGN.md`, `tokens.css`,
`design-tokens.json`, `tailwind-v4.css`, `components.html`, preview and source.
Almost none of that reaches the agent: the tool returns two files, and no export
path exists for the project's own output.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| S01 | **DTCG JSON as the canonical token export** — read/write W3C Design Tokens Community Group format | `design-tokens.json` exists in the pack but the kit neither reads nor writes the standard | M | P1 |
| S02 | **Tailwind v4 `@theme` export** — emit `@theme { --color-…: … }` from `tokens.css` | Pack ships `tailwind-v4.css`; project artifacts do not | S | **P0** |
| S03 | **shadcn CSS-variable export** — map roles to shadcn's expected variable names | Most React teams consume tokens this way | S | P1 |
| S04 | **Platform exports** — SwiftUI, Jetpack Compose, Flutter constants | Handoff stops at web | M | P2 |
| S05 | **Token lint** — hard-coded hex/px, off-scale spacing, undeclared colours, duplicate values, missing dark-mode pairs | Static lint catches some source patterns; not token discipline | M | **P0** |
| S06 | **System conformance check** — artifact vs `DESIGN.md`/`tokens.css`, including computed styles vs declared tokens: undeclared tokens, hard-coded values, one-off components, variant drift | Handoff is one-way; nothing verifies the port or that the DOM uses the system | M | P1 |
| S07 | **`dezign0 ds validate`** — package contract check: required files, manifest schema, token coverage, component states, preview renders, licence present | Pack quality is assumed, not checked | M | P1 |
| S08 | **Component inventory matrix** — list components × states × variants, flag missing states | `components.manifest.json` exists but is not surfaced or validated | S | P1 |
| S09 | **Theme parity check** — light/dark/high-contrast token parity and contrast per mode | Dark mode is a craft rule, not a test | S | P1 |
| S10 | **Design-language preview gallery** — static, self-contained page per system; searchable by category, density and type | 152 systems are invisible unless the agent already knows the slug | M | P1 |
| S11 | **Licence and provenance report** — per system, per asset; flag unknown licences | Pack carries upstream attribution; no report is generated | S | P2 |
| S12 | **Return the full package** — `dezign0_design_systems get` should expose component HTML/manifest, token JSON and Tailwind file, not two truncated files | Agents cannot use what they cannot read | S | **P0** |
| S13 | **User-supplied system registration** — `design-systems/<slug>/` validated by the same contract | Teams with in-house systems must fork the pack today | S | P1 |
| S14 | **Pairwise contrast gate** — compute every foreground/background token pair at build and fail CI | Catches the pairing once, before it reaches forty pages | S | P1 |

### 4.4 Process and Design OS depth

The loop is sound. What is missing is scaffolding, traceability and the
multi-page/multi-direction cases that real briefs hit.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| P01 | **`project.json` + `dezign0 new`** — profile, system pin, skill pins, constraints, status; creates `design/<slug>/` from templates | Promised in `ARCHITECTURE.md`, absent in practice | S | **P0** |
| P02 | **Design decision record** — short ADR-style file per consequential choice (direction, type pairing, motion posture) with alternatives and reason | Decisions live in chat and are lost | S | P1 |
| P03 | **Living spec with append-only log** — spec gains `Decisions`, `Deviations`, `Open questions` sections updated during build | Spec is frozen and then silently diverges from the artifact | S | P1 |
| P04 | **Sitemap/IA stage** — page inventory, hierarchy, nav model, per-page intent before visual direction | Multi-page products get inconsistent structure | M | P1 |
| P05 | **Direction tournament** — 3 distinct directions scored against the brief, one chosen and recorded | Single-direction work anchors too early; lane A reports this as a common competitor pattern | M | P1 |
| P06 | **Critique calibration set** — 3–5 golden artifacts with known, human-agreed scores and findings | Scores are not comparable across runs or agents | M | P1 |
| P07 | **More deliverable profiles** — email, mobile app, design-system package, social/marketing, video/animation, print/PDF, component library | Five profiles do not cover common briefs | S | P1 |
| P08 | **Copy pass skill** — microcopy, error/empty states, tone, reading level, CTA naming consistency | Copy is a craft rule, not a workflow step | S | P1 |
| P09 | **Acceptance-test generator** — turn `HANDOVER.md` into a checklist or Playwright assertions | Handoff has acceptance checks in prose only | M | P1 |
| P10 | **Memory hygiene** — `dezign0 memory promote / dedupe / stale` over `design-memory/` | Memory convention exists; no maintenance path | S | P2 |
| P11 | **Coverage manifest** — machine-readable list of what the critique reviewed, skipped and assumed | "What I could not review" is prose today | S | P1 |
| P12 | **Optional second-opinion mode** — a clearly labelled second critique pass with a different rubric weighting, not a panel | The project lists "no design jury" as a non-goal; a single optional second pass preserves that | S | P2 |

### 4.5 Input and context

Every Dezign0 artifact currently begins with text. Competitors begin with the
thing the user already has: a URL, a screenshot, a repo, a PRD.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| I01 | **URL → artifact skeleton** — capture a live page (local or public), extract structure and computed tokens, emit an editable starting artifact with provenance | No path from "make it like this page" to a real artifact | M | **P0** |
| I02 | **Repo ingestion → deterministic `DESIGN.md`** — scan CSS/theme files, component names, spacing and radius scales, icon set, font stack; output with evidence per value | Brand extraction is model judgement, not measurement | M | **P0** |
| I03 | **`dezign0 extract` command** — the existing skill as a repeatable scanner with confidence per token and a gap list | Same skill varies per run; no confidence artefact | M | P1 |
| I04 | **Reference board** — screenshots/URLs as first-class inputs, shown beside the artifact, one provenance line each | References are pasted into chat and lost | M | P1 |
| I05 | **Screenshot → spec** — infer type scale, palette, spacing and structure from an image, grade each inference | "Match this screenshot" is a common brief; today it is guesswork | M | P1 |
| I06 | **PRD/transcript ingestion** — pull goals, users, constraints and content into `BRIEF.md` fields | Briefs are hand-written from a long document | S | P2 |
| I07 | **Design-language browser** — a static catalog page with search and live specimen | 152 systems have no discovery surface | M | P1 |
| I08 | **Figma MCP acceptance wrapper** — treat Figma's own MCP output as input evidence; add grading, conflict resolution and acceptance criteria instead of re-implementing extraction | Figma ships its own MCP server and skills; a hand-rolled bridge will lag | S | P1 |

### 4.6 Review, authoring and collaboration

The studio is correctly a non-goal. The useful 20% is a contract for selection,
anchored comments and restorable versions — all of which can live in files and
the host's existing preview.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| R01 | **Headless edit protocol** — documented `select → instruction → patch` message shape; any host can implement a UI | No studio means no direct manipulation at all | M | **P0** |
| R02 | **Element-anchored annotations** — `ANNOTATIONS.json` with selector, box, note, severity, status; critique emits them, build consumes them | Fix lists lose their anchor in prose | S | P1 |
| R03 | **Version history without a new format** — git-backed snapshots (`design/<slug>/.history/` or commits) with restore | Overwrites are silent | S | P1 |
| R04 | **Artifact safety scan** — external scripts, trackers, secret-like strings, unsafe embeds, remote fonts, licence unknown | Generated HTML is a trust boundary nobody checks | M | P1 |
| R05 | **Self-contained review bundle** — one HTML file with artifact, screenshots, findings and coverage manifest; no server | Sharing a review means zipping a folder | S | P1 |
| R06‡ | **OpenChamber element payload skill** — consume preview selection (screenshot, computed styles, box, console errors) and return a scoped fix | OpenChamber already emits this; no skill uses it | M | P1 |
| R07 | **Approval state** — `HANDOVER.md` gains `approved_by`, `approved_at`, `artifact_hash` | "Approved" is a chat message today | S | P1 |
| R08‡ | **Comment import** — ingest Figma/GitHub PR comments into anchored annotations | Feedback arrives in three places | M | P2 |

### 4.7 Interoperability and handoff

The React/Next/Vue contracts are good prose. What is missing is the machine
artefact the receiving build actually consumes, and the reverse mapping to real
components.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| X01 | **Export bundle** — `tokens.css` + framework token file + component stubs + mapping table, one command | Handoff ends at a document | M | **P0** |
| X02 | **Component mapping in handoff** — each artifact region names the target repo component and props | Implementers re-build instead of reusing | M | P1 |
| X03‡ | **Code Connect template generator** — emit `.figma.ts` templates from tokens + component inventory | Nobody in this space does the reverse direction | M | P2 |
| X04‡ | **Storybook manifest consumer** — read the component manifest, compose real components, emit stories | Critique is grounded in screenshots rather than shipped components | L | P2 |
| X05‡ | **shadcn registry publication** — each design language as a registry item (`tokens.css` + `DESIGN.md` + rule) | Distribution borrowed from an ecosystem teams already use | M | P2 |
| X06‡ | **Penpot adapter** — same loop for Figma-free/OSS teams via Penpot's MCP | Excludes a real audience | M | P2 |
| X07‡ | **Figma write-back** — push approved artifacts as frames/variables | Attractive but large; Figma's write surface is moving | L | P2 |
| X08 | **HTML → React/Svelte/Web Components converter** | Tempting, but generic converters are commoditised; the handoff contract is the differentiator | L | P2 |

### 4.8 Distribution and harness integration

This is the adoption ceiling. Twelve installers, three scripts and two native
plugins all carry the same content in different shapes; every new harness adds
maintenance and version drift.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| D01 | **Agent Plugins 1.0 package** — root `plugin.json` + `skills/` + `mcp.json` beside `.claude-plugin/` | One portable artifact instead of twelve bespoke installers | M | **P0** |
| D02 | **`dezign0 mcp` server** — tools: lint, measure, doctor, systems, addons, extract; resources: DESIGN-OS, craft rules, templates | Skills alone leave agents guessing which script to run | M | **P0** |
| D03‡ | **Claude Code enforcement hooks** — `PostToolUse` on `Edit`/`Write` lints changed HTML; `Stop` blocks with P0 findings | Hooks exist only for `SessionStart` bootstrap | S | **P0** |
| D04‡ | **OpenCode lifecycle hooks** — `tool.execute.after` measure, `session.idle` critique prompt, `tui.toast.show` pass/fail | Plugin registers tools but never reacts to work | S | P1 |
| D05‡ | **Command/subagent parity** — `/design-critique`, `/design-handoff`, `/design-fix`; read-only reviewer subagent | 13 skills, 3 commands, no delegated critic | S | P1 |
| D06‡ | **Codex-native skill path** — also write `.agents/skills` (repo-discovered), not only an `AGENTS.md` fragment | Codex discovery differs from the current adapter | S | P1 |
| D07‡ | **Registry and directory submissions** — MCP registry, Claude/Cursor marketplaces, `llms.txt` | No discovery surface beyond npm and the repo | S | P2 |
| D08 | **Per-harness quickstarts** — verified screenshots/commands per host, one page each | `ADOPTION.md` is generic after the OpenCode section | S | P1 |
| D09‡ | **Release hygiene** — publish 0.7.1, adopt npm trusted publishing (OIDC), tag/version/changelog check in CI | npm `latest` is 0.7.0; publish uses a long-lived token | S | **P0** |
| D10 | **Installer self-verification** — after install, assert skill count, tool registration, kit version, pack presence | Install failures surface later as "why is nothing happening" | S | P1 |
| D11 | **Drift reporting** — kit version vs package version vs pack version, with a compatibility table | Three independently versioned artefacts | S | P1 |
| D12 | **macOS CI leg** — current matrix is ubuntu + windows | Path/case issues on the third major OS | S | P2 |

### 4.9 Evaluation and trust

The repository's own `VALIDATION.md` is the right instinct — a fresh agent, one
task, a real score, and an honest list of gaps. It is a single anecdote. The
category is saturated with unmeasured claims; measured deltas are cheap
differentiation.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| E01 | **Plugin evals with WITH/WITHOUT delta** — a fixed task set, graders, `--json`, CI threshold; publish the delta per release | No evidence the kit improves output | M | **P0** |
| E02 | **Golden task benchmark** — 20 briefs across profiles, scored by the kit's rubric plus an independent grader | One validation anecdote is not a benchmark | M | P1 |
| E03 | **Per-release scorecard** — lint pass rate, critique mean, handoff completeness, time-to-first-artifact | Quality regressions are invisible | S | P1 |
| E04 | **Linter fixture corpus** — one positive and one negative fixture per rule, run in CI | Rules can silently stop firing | S | P1 |
| E05 | **Human agreement study** — compare critique scores with 2–3 designers on the same artifacts | Scoring credibility is assumed | M | P2 |
| E06 | **Public "known failure modes" page** — where the kit reliably underperforms | Trust is built by stated limits, which the docs already do well | S | P1 |

### 4.10 Content, copy and media

Craft rules cover copy and imagery, but nothing mechanical touches them. This is
where AI-generated work is most recognisable.

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| C01 | **Copy lint** — filler ("seamlessly", "elevate", "unlock"), em-dash density, sentence length, CTA verb consistency, error-message quality | Copy rules are prose only | S | P1 |
| C02 | **AI-tell detector** — flag the published generic patterns: near `#F4F1EA` + serif + terracotta, near-black + acid accent, uniform rounded card kits, all-caps eyebrows, middot meta strings, mono micro-labels, `→` on every CTA | Anthropic now enumerates these exact tells; mechanical detection is defensible and unique | S | **P0** |
| C03 | **Asset budget** — total bytes, image formats, largest asset, missing dimensions, LCP candidate | Artifacts ship 4 MB hero images unnoticed | S | P1 |
| C04 | **Font audit** — licences, remote vs self-hosted, fallback stack, FOUT risk | Fonts are the most common licensing mistake in generated work | S | P1 |
| C05 | **Icon consistency** — mixed icon sets, stroke-width drift, inconsistent sizing | Common in agent-assembled UI | S | P2 |
| C06 | **Media brief → optional provider hook** — keep briefs model-free, add an opt-in adapter for image/video generation | The pack stops at prompts; some users want the asset | M | P2 |
| C07 | **Content realism check** — lorem ipsum, placeholder names, fake metrics without a label | Placeholder data leaks into demos | S | P1 |

### 4.11 Operations and maintenance

| ID | Enhancement | Gap it closes | Effort | Pri |
|---|---|---|---|---|
| O01 | **Doc consistency check** — counts, tool names, versions and paths verified against the code in CI | `SECURITY.md` is already stale | S | **P0** |
| O02 | **`capabilities.json`** — single source for skills, tools, adapters, pack versions; docs and plugin read it | Hand-maintained lists drift | S | P1 |
| O03 | **Migration notes generator** — changelog entry → upgrade steps for `.design-os` consumers | Upgrades are "copy again and hope" | S | P1 |
| O04 | **Attribution audit** — verify every pack asset has a licence and notice | Legal risk grows with the pack | S | P1 |
| O05 | **Context-cost report** — bytes/tokens per skill and craft file; flag files too large for always-on use | 13 skills plus craft rules can flood a context window | S | P1 |
| O06 | **Deprecation policy** — skill/tool rename path with one release of aliases | Renames will break saved prompts | S | P2 |

---

## 5. Prioritized catalog

P0 only, in dependency order. Everything else is in the theme tables.

| Order | ID | Item | Depends on | Why now |
|---|---|---|---|---|
| 1 | D09 | Publish 0.7.1, OIDC publishing, version check | — | The documented install path is stale today |
| 2 | O01 | Doc consistency check | O02 | Cheap, stops credibility leaks |
| 3 | V11 | `doctor --fix` Playwright | — | Playwright is absent in a clean checkout; doctor only reports it |
| 4 | V01 | CLI | — | Unblocks V02, D03, D04, E01 |
| 5 | V02 | GitHub Action | V01 | Makes checks enforceable |
| 6 | S02 | Tailwind v4 + shadcn token export | V01 | Output teams can consume |
| 7 | A01–A02 | axe-core + WCAG mapping | V01 | Largest review-quality gap |
| 8 | S05/C02 | Token lint + AI-tell detector | V01 | Mechanical differentiation |
| 9 | D02 | MCP server | V01 | One integration instead of twelve |
| 10 | D01 | Agent Plugins package | D02 | Collapses installer matrix |
| 11 | D03 | Claude Code hook gate | V01 | Advice → gate |
| 12 | E01 | Evals with delta | V01 | Proof the kit helps |
| 13 | P01 | `project.json` + `dezign0 new` | V01 | Promised scaffold |
| 14 | R01 | Headless edit protocol | P01 | Studio value without a studio |
| 15 | S12/I01/I02 | Full package access, URL and repo ingestion | V01 | Removes "blank page" start |

---

## 6. Roadmap shape

### Now — 2–3 weeks, one engineer

Release fix (D09), doc/capability consistency (O01/O02), Playwright repair (V11),
CLI skeleton (V01), token exports (S02/S12), AI-tell and token lint
(C02/S05), axe-core behind a flag (A01/A02).

The theme: **make what exists trustworthy and callable.**

### Next — 4–8 weeks

GitHub Action (V02), hooks (D03/D04), MCP server (D02), Agent Plugins package
(D01), evals (E01), `project.json` (P01), full pack access (S12), reference and
repo ingestion (I01/I02), cross-browser and forced-colors (V05/V06), profiles
(P07).

The theme: **enforce, measure and distribute without per-harness glue.**

### Later — a quarter or more

Studio-lite protocol (R01/R02), Storybook and shadcn bridges (X04/X05),
platform token exports (S04), Penpot (X06), Figma write-back (X07), compliance
reports (A05/A06), benchmark and agreement study (E02/E05).

The theme: **deepen the ecosystem only where the contract is stable.**

### Sequencing logic

- CLI before Action, hooks or evals: all three need a stable command and exit
  codes.
- MCP before Agent Plugins: the package is mostly a wrapper around skills + MCP.
- axe before WCAG mapping: map real findings, not an empty schema.
- `project.json` before the edit protocol: the protocol needs a stable project
  root and metadata.
- Do not start Figma write-back until the read path is a thin wrapper over
  Figma's own MCP; otherwise it will chase a moving target.

---

## 7. What not to build

These are consistent with Dezign0's stated non-goals and with what the market
already does well.

| Not this | Why |
|---|---|
| **Electron/desktop app or a full studio** | Explicit non-goal; hosts already provide preview, selection and diffs. Ship a protocol, not an editor. |
| **A design jury / multi-agent panel by default** | Explicit non-goal, and it multiplies cost without improving the rubric. Offer one optional second pass instead. |
| **One-shot prompt-to-UI** | Commoditised and improving monthly. Dezign0's claim is traceability from brief to handoff, not generation speed. |
| **A 1,000-component marketplace** | Curation treadmill; real systems live in customer repos. Ship validation and import instead. |
| **Infinite canvas with a proprietary document format** | Contradicts plain-HTML portability and produces undiffable files. |
| **Full-stack generation, auth, hosting, billing** | Would swamp a portable design layer and add support surface the project cannot carry. |
| **Real-time multiplayer editing** | CRDT infrastructure for a one-author-plus-one-agent workflow. Git is enough. |
| **SOC 2 / SSO / SCIM** | Premature; matters only after enterprise deals exist. |
| **Telemetry** | The project's no-network stance is a feature. Keep evals local and publish aggregate results voluntarily. |
| **A generic HTML→framework converter** | Competes with free, well-funded tools and weakens the "contract, not conversion" positioning. |

---

## 8. Open questions

These need a product decision, not more research.

1. **Does Dezign0 want to be a kit or a platform?** The MCP server and Agent
   Plugins package push toward platform; the no-daemon, no-studio stance pulls
   back. The honest middle is "kit plus one optional server process".
2. **How much can the core grow before the 13-skill context cost hurts?** A
   context-cost budget (O05) should be set before adding skills 14–20.
3. **Is the optional 152-system pack part of the product or a companion?** Its
   versioning, licensing and quality bar are separate from the core, but users
   experience it as one thing.
4. **Who is the buyer for compliance output?** ACR/EAA reports imply a different
   customer and a support burden; decide before building A05/A06.
5. **What is the acceptance bar for "measurement"?** If Playwright is optional,
   every claim needs a "not measured" state. If it is required, installation
   must own it.
6. **Should critique scores be comparable across models?** The calibration set
   (P06) is the prerequisite; without it, cross-model scores are noise.

---

## 9. Sources

### Verified directly in this repository

- `README.md`, `package.json`, `CHANGELOG.md`, `SECURITY.md`
- `docs/ARCHITECTURE.md`, `docs/ADOPTION.md`, `docs/VERIFICATION.md`, `docs/figma.md`
- `design-os/DESIGN-OS.md`, `design-os/README.md`, `design-os/VALIDATION.md`
- `design-os/briefs/*` (BRIEF, DESIGN-SPEC, CRITIQUE, HANDOVER, TOKENS, MEMORY,
  DELIVERABLE-PROFILES)
- `design-os/craft/*`, `design-os/skills/*`, `design-os/tools/README.md`,
  `design-os/tools/measure-artifact.mjs`, `design-os/install.mjs`
- `plugin/index.js`, `plugin/README.md`, `hooks/hooks.json`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- `design-languages/index.json`, `design-languages/README.md`,
  `design-languages/addons/index.json`
- `.github/workflows/validate.yml`, `.github/workflows/publish.yml`
- `npm view dezign0 version dist-tags --json` → `0.7.0` / `latest: 0.7.0`

### External pages opened during this research

- Anthropic, `frontend-design` skill (AI-tell list, two-pass process):
  https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- v0 Design Mode (select → edit → apply as new version; `createDesignModeBridge`,
  `parseDesignModeMessage`): https://v0.app/docs/design-mode
- Agent Plugins 1.0 (portable `plugin.json` + skills + MCP):
  https://agent-plugins.org/
- Claude Code plugin evals (WITH/WITHOUT/Δ, CI gating):
  https://code.claude.com/docs/en/plugin-evals
- Builder.io, "How to Make AI Agents Follow Your Design System" (restricted
  imports, typed props, deterministic token enforcement, golden directory,
  verification loop): https://www.builder.io/blog/how-to-make-ai-agents-follow-your-design-system
- upstream catalog (244 skills, 265 templates, 451+ plugins, 152 systems,
  comparisons, agent guides): https://open-design.ai/ ,
  https://open-design.ai/plugins/ , https://open-design.ai/skills/ ,
  https://open-design.ai/agents/ , https://open-design.ai/compare/
- W3C, WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Directive (EU) 2019/2102 (European Accessibility Act):
  https://eur-lex.europa.eu/eli/dir/2019/2102/oj

### Reported by research lanes, not independently re-opened here

Treat these as pointers; verify before quoting publicly.

- Codex skill discovery and context limits: `learn.chatgpt.com/docs/build-skills`
- Cursor CLI, browser tooling and marketplace: `cursor.com/cli`,
  `cursor.com/docs/agent/tools/browser`, `cursor.com/marketplace/publish`
- Claude Code plugins, hooks, marketplaces: `code.claude.com/docs/en/plugins`,
  `code.claude.com/docs/en/hooks-guide`
- OpenCode plugins and OpenChamber preview payloads: `opencode.ai/docs/plugins`,
  `github.com/openchamber/openchamber`
- Figma MCP, Code Connect, live-UI capture:
  `figma.com/blog/introducing-figma-mcp-server`,
  `developers.figma.com/docs/code-connect`,
  `help.figma.com/hc/en-us/articles/32132100833559`
- Storybook MCP and component manifests: `storybook.js.org/docs/ai/mcp/overview`
- shadcn registry and MCP: `ui.shadcn.com/docs/mcp`, `ui.shadcn.com/docs/registry`
- Penpot MCP: `github.com/penpot/penpot-mcp`
- Accessibility engines and standards detail: `github.com/dequelabs/axe-core/releases`
  (axe-core 4.14.0, EN 301 549 tags), `w3.org/WAI/test-evaluate/conformance/wcag-em/`
  (WCAG-EM), `github.com/IBMa/equal-access`,
  `github.com/pa11y/pa11y`, `github.com/GoogleChrome/lighthouse/releases`
- Playwright behaviour: `playwright.dev/docs/test-snapshots`,
  `playwright.dev/docs/aria-snapshots`, `playwright.dev/docs/emulation`
- CSS platform behaviour: `developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors`,
  `developer.mozilla.org/en-US/docs/Web/CSS/@page`
- Token tooling: `styledictionary.com/info/tokens/`, `tailwindcss.com/blog/tailwindcss-v4`,
  `ui.shadcn.com/docs/registry`, `docs.tokens.studio/`
- Procurement artefacts: `itic.org/policy/accessibility/vpat` (VPAT 2.5),
  `github.com/GSA/openacr`
- EAA applicability: `accessible-eu-centre.ec.europa.eu` (EAA in effect 28 June 2025)
- Competitor product pages: Subframe, Onlook, Magic Patterns, Superdesign,
  Relume, Framer, Lovable, Webflow, OpenUI (URLs as returned by lane A)
- npm trusted publishing: `docs.npmjs.com/trusted-publishers`
- Chromatic PR checks: `chromatic.com/docs/ci`
- MCP registry: `registry.modelcontextprotocol.io`

---

## 10. One-paragraph conclusion

Dezign0 already contains the hard part: a defensible design process, checkable
craft rules, and a critique protocol that refuses to grade what it did not
inspect. The next version should stop adding documentation and start adding
**enforcement and interfaces** — a CLI, one portable package, one MCP surface,
axe-backed accessibility, real token exports, and a published eval delta. That
combination would make Dezign0 the kit that can prove its claims, which is a
rarer position than having more templates.
