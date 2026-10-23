# content-lint fixtures

Self-test inputs for `design-os/tools/content-lint.mjs`. Every file here is
original and intentionally small; each one isolates a rule family so a broken
detector fails loudly instead of drifting silently.

Run:

```bash
node design-os/tools/content-lint.mjs --self-test
```

Exit 0 means every fixture matched `expected.json`. Exit 1 names the fixture and
the missing/unexpected ids. Exit 2 means the fixture directory is unavailable
(for example when the tool is run from an installed kit without this repo).

## Fixtures

| File | Purpose | Expected |
|---|---|---|
| `clean-interface.html` | Realistic product screen: tokenised surfaces, sentence-case CTAs, real error and empty states, descriptive alt text, labelled metric | No findings |
| `clean-technical-doc.html` | Legitimate technical copy that must NOT trip the marketing-phrase rule: "unlock the account", "elevate permissions", "empowers users to opt out", `unlock()` in code, `seamlessly` inside `<code>`, a `data-no-lint` block, `--bg: #111` without an acid accent | No findings |
| `ai-cream-terracotta.html` | The documented generated-design cluster (cream `#f4f1ea` + serif + terracotta `#d97757`), ALL-CAPS eyebrow, middot metadata, monospace labels, arrows on every CTA, uniform card kit, four generic marketing phrases, em-dash density | All eight AI-tell ids, no copy P0s |
| `ai-night-acid.html` | Near-black `#0b0b0b` surface with an acid `#ccff00` accent, monospace micro-label (rule and inline style), ALL-CAPS eyebrow, middot metadata, arrows on both CTAs | `ai-near-black-acid` plus the four style tells |
| `copy-failures.html` | Content failures only: lorem, filler, three unlabelled metrics, TODO, placeholder identity, placeholder image and alt, placeholder links, vague/inconsistent/mixed-case CTAs, vague and generic error copy, two thin empty states, a 51-word sentence, em-dash density | 5 P0, 9 P1, 7 P2 (ids in `expected.json`) |
| `false-positive-guards.html` | Every documented guard on one page: cream surface without the serif/terracotta cluster, only two cards, one arrow CTA, non-CTA `href="#"`, missing alt and `alt=""`, a single middot, a functioning error and empty state, technical "unlock/elevate/empowers" copy, `unlock()`/`seamlessly()` in code, a `data-no-lint` block | No findings |

`expected.json` lists, per fixture, the ids that must appear and the ids that must
not. `expectClean: true` additionally requires zero findings.

## Adding a fixture

1. Write the HTML with a single intent, and keep legitimate-copy guards explicit
   (real links, descriptive alt, sentence-case CTAs) so anything the tool reports
   is the thing under test.
2. Run the tool on it directly and read every finding. If a finding is a false
   positive, fix the rule and its guard rather than the fixture — the fixture is
   the regression test for the guard.
3. Add the file to `expected.json` with `mustInclude` / `mustExclude`.
4. Re-run `--self-test`.

These fixtures are also useful as a manual demo: `node
design-os/tools/content-lint.mjs scripts/fixtures/content/copy-failures.html`
shows the full human output with line references.
