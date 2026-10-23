# Dezign0 review action

Composite action that reviews a design artifact with the Dezign0 CLI:

1. runs static lint with `--strict`;
2. renders the artifact at `1440x900`, `390x844` and `145x188` with `--a11y`;
3. uploads full-page screenshots as a workflow artifact;
4. writes a sticky-comment Markdown body to the job summary and to the
   `comment-body` / `body-file` outputs.

Only the standard `actions/setup-node` and `actions/upload-artifact` actions are
used. The caller runs `actions/checkout`.

## Usage

```yaml
name: design-review
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - id: dezign0
        uses: ./.github/actions/dezign0-review
        with:
          artifact: design/billing-settings/artifact.html
          working-directory: .
          viewports: 1440x900,390x844,145x188

      - name: Post sticky comment
        if: always()
        env:
          GH_TOKEN: ${{ github.token }}
          BODY_FILE: ${{ steps.dezign0.outputs.body-file }}
        run: |
          gh pr comment "${{ github.event.pull_request.number }}" --body-file "$BODY_FILE"
```

The body starts with `<!-- dezign0-review -->`. If your workflow updates an
existing comment instead of adding one, find the comment containing that marker
and replace its body with `${{ steps.dezign0.outputs.comment-body }}`.

The action fails the job when lint or measurement exits non-zero. Set
`fail-on-findings: false` to publish the review without blocking the PR.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `artifact` (required) | — | Artifact path relative to `working-directory`, or a URL. |
| `working-directory` | `.` | Project directory containing the artifact and Playwright. |
| `viewports` | `1440x900,390x844,145x188` | Comma-separated `WIDTHxHEIGHT` list. |
| `screenshots-directory` | `.dezign0/screenshots` | Screenshot output inside the project. |
| `node-version` | `20` | Node.js version. |
| `install-playwright` | `true` | Install Playwright + Chromium before measuring. |
| `fail-on-findings` | `true` | Fail the job on non-zero lint/measure exits. |
| `dezign0-cli` | auto | Path to a Dezign0 checkout, package root, or `bin/dezign0.mjs`. |
| `dezign0-version` | `latest` | npm fallback when no local CLI is found. |
| `title` | `Dezign0 design review` | Sticky-comment heading. |

## Outputs

| Output | Purpose |
| --- | --- |
| `comment-body` | Markdown body including the sticky marker. |
| `body-file` | File containing the same body (use with `gh pr comment --body-file`). |
| `verdict` | `Pass`, `Findings` or `Error`. |
| `lint-exit-code` | Exit code from `dezign0 lint --strict`. |
| `measure-exit-code` | Exit code from `dezign0 measure --a11y`. |

## Requirements

- The repository must expose `bin/dezign0.mjs`: auto-detected from the workspace,
  `node_modules/dezign0/bin/dezign0.mjs`, or `dezign0-cli`. A published package
  must list `bin/` in its `files` and `bin` map; that packaging change is owned
  outside this action.
- Playwright is installed by the action by default. It can load local assets and
  external URLs the artifact requests; review untrusted HTML accordingly.
- Measurement exits `2` when Playwright is unavailable. Either let the action
  install it or use `install-playwright: false` with `fail-on-findings: false`
  for lint-only reporting.
