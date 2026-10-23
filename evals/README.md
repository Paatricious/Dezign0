# Dezign0 evals

A harness for comparing artifacts produced **with** the kit installed against
artifacts produced **without** it, using a deterministic grader.

**This is harness output, not a benchmark.** It grades whatever adapter you
supply. It makes no model calls and no network calls, and it cannot tell you that
one agent is better than another. It exists so a change to the kit (a skill, a
brief, a lint rule) can be checked for a measurable effect on real artifacts.

## Layout

```text
evals/
  README.md
  run.mjs               # the harness: runs an adapter, grades, writes JSON + MD
  grader.mjs            # deterministic grader (Node built-ins only)
  adapters/mock.mjs     # reference adapter used by the self-test; not an agent
  tasks/<id>/           # one brief per profile
    prompt.md
    expected.json
  fixtures/             # reference artifacts used by the mock adapter
  results/              # default output directory (gitignored)
```

Eight tasks cover the deliverable profiles: prototype, landing, dashboard, deck,
document, email, mobile and component-library.

| Task | Profile | Artifact |
|---|---|---|
| `prototype-01` | prototype | `index.html` |
| `landing-01` | landing | `index.html` |
| `dashboard-01` | dashboard | `index.html` |
| `deck-01` | deck | `deck.html` |
| `document-01` | document | `report.html` |
| `email-01` | email | `email.html` |
| `mobile-01` | mobile | `index.html` |
| `component-library-01` | component-library | `components.html` |

## The adapter contract

An adapter is any command that can read a brief and write one HTML file. The
harness runs it once per task, in each mode.

Arguments are appended when the command contains no placeholders:

```text
<adapter> --task <id> --mode with|without --prompt <prompt.md>
          --out <artifact.html> --workspace <dir>
```

Placeholders can be used instead (`{task}`, `{mode}`, `{prompt}`, `{out}`,
`{workspace}`, `{kit}`); when present, nothing is appended.

| Item | Value |
|---|---|
| Working directory | `<out>/work/<task>/<mode>/` |
| Prompt | the same brief in both modes; WITH mode appends a short pointer to the installed kit |
| Artifact | must be written to `--out` (the exact path) |
| Kit (WITH only) | copied to `<workspace>/.design-os/` |
| Env | `DEZIGN0_EVAL_TASK`, `DEZIGN0_EVAL_MODE`, `DEZIGN0_EVAL_PROMPT`, `DEZIGN0_EVAL_OUT`, `DEZIGN0_EVAL_WORKSPACE`, `DEZIGN0_EVAL_KIT` |
| Timeout | `--timeout` ms (default 120000) |
| Exit code | recorded; a non-zero exit does not stop the run |

Adapters run with the per-task workspace as their working directory, so a
relative script path such as `node my-agent.mjs` is resolved against the
directory you invoked `run.mjs` from (falling back to the workspace). Asset paths
passed as arguments should be absolute or workspace-relative.

The harness does not prompt the adapter, does not read its prose, and does not
invoke the kit's tools for it. The kit is simply available at `.design-os/`; using
it is the adapter's job. That is what the WITH/WITHOUT comparison measures.

## Run it

```bash
# Any agent command that implements the contract
node evals/run.mjs --adapter "node my-agent.mjs"

# Subset, custom output directory, longer timeout
node evals/run.mjs --adapter "node my-agent.mjs" --tasks landing-01,deck-01 \
  --out /tmp/eval-run --timeout 300000

# Placeholder form
node evals/run.mjs --adapter "my-agent --task {task} --out {out} --mode {mode}"

# The bundled mock adapter (copies fixtures; proves the pipeline)
node evals/run.mjs --adapter "node evals/adapters/mock.mjs"
```

Output:

- `<out>/results.json` — machine-readable run: per task WITH, WITHOUT and DELTA
  scores, every check, adapter exit codes and durations, lint counts, artifact
  hashes, aggregate totals, disclaimers.
- `<out>/results.md` — human-readable report with the summary table, the "what
  changed" list and per-task dimension breakdowns.
- `<out>/work/<task>/<mode>/` — prompt, artifact, adapter log, and `.design-os/`
  in WITH mode.

Exit codes: `0` run completed (adapter failures are recorded, not fatal), `2` usage
error, `3` kit directory missing.

## Grading

Deterministic, dependency-free, integer scores out of 100. Each dimension has a
weight; task defaults are:

| Dimension | Weight | Rule |
|---|---:|---|
| Must-have | 45 | One regex per brief requirement; matches below `min` lose the item's share |
| Forbidden | 20 | Any match loses a share; `max` can allow a bounded number |
| Lint | 15 | `design-os/tools/design-lint.mjs --json`: any P0 zeroes the dimension, P1/P2 subtract |
| Content audit | 10 | Placeholder copy, unfinished markers, invented metrics, dead links, placeholder assets, empty sources |
| Static a11y | 5 | `lang`, one `h1`, image alt, button names, input labels, landmarks, `:focus-visible`, reduced motion (per-task applicability) |
| Structure | 5 | DOCTYPE, html root, viewport (opt-out), no remote assets, minimum size, closed body |

When a task sets `"a11y": false`, its a11y share moves to must-have so the total
stays 100. `expected.json` may override weights with `"weights"` summing to 100.

Task `expected.json` shape:

```json
{
  "schema": "dezign0/eval-task/v1",
  "id": "landing-01",
  "profile": "landing",
  "title": "Landing page for an invoicing tool",
  "artifact": "index.html",
  "a11y": true,
  "interactive": true,
  "motion": false,
  "structure": { "minBytes": 4500 },
  "mustHave": [
    { "id": "main", "pattern": "<main[\\s>]", "description": "Main landmark" }
  ],
  "forbidden": [
    { "id": "placeholder", "pattern": "lorem ipsum", "description": "No placeholder copy" }
  ]
}
```

Optional pattern fields: `flags` (regex flags, default `i`), `min` (must-have
minimum match count, default 1), `max` (forbidden maximum, default 0).

What the grade deliberately does **not** include: rendered measurement, visual
comparison, taste, copy quality beyond mechanical audits, or whether the artifact
works in a browser. Use `design-os/tools/measure-artifact.mjs` and the critique
loop for those.

## Self-test

```bash
node scripts/test-evals.mjs
```

The test validates every brief and expected file, proves the eight reference
fixtures score 100 and the no-kit fixture fails, runs the full harness twice with
the mock adapter to prove WITH/WITHOUT/DELTA computation and determinism,
exercises placeholder commands and the missing-artifact path, and asserts the
harness source contains no network or model-call APIs.

`evals/adapters/mock.mjs` is the reference implementation of the adapter
contract. It is a fixture copier, not an agent: WITH mode copies the good fixture,
WITHOUT mode copies `_without.html`, and `DEZIGN0_MOCK_FAIL=1` writes nothing.

## Adding a task

1. Create `evals/tasks/<profile>-NN/prompt.md` with a small, self-contained brief,
   the artifact filename, the required content and the quality floor.
2. Create `expected.json` with at least four must-have and three forbidden checks.
   Encode only requirements the prompt states.
3. Add a reference fixture at `evals/fixtures/<id>.html` that scores 100. The
   self-test enforces this, so a broken regex or a lint-hostile fixture fails CI
   rather than silently skewing a run.
4. Keep one task per profile unless you are deliberately adding coverage; run the
   self-test.

A task is not a benchmark case. It is a repeatable, mechanically checkable brief.

## Limits

- The adapter is trusted to follow the contract; nothing verifies how it used the
  kit. A WITH score is an upper bound on the kit's availability, not proof of
  attribution.
- Scores compare two runs of the same adapter. Comparing adapters or publishing
  "model X scores Y" is out of scope and unsupported by this harness.
- Static a11y checks are cheap proxies, not an audit. They catch missing
  attributes, not bad interaction design.
- The reference fixtures are authored artifacts, not model output; they prove the
  grader discriminates, not that an agent will reach those scores.
