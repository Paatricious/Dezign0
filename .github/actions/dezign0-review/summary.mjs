/**
 * Build the Dezign0 review body for a GitHub composite action.
 *
 * Reads the CLI JSON reports written by action.yml, appends a Markdown summary
 * to $GITHUB_STEP_SUMMARY, and exports a sticky-comment body plus a body file.
 * Deliberately dependency-free and tolerant of missing/corrupt inputs: the
 * action's gate step decides pass/fail, not this script.
 */
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const MARKER = "<!-- dezign0-review -->";

function readJson(file) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function walk(dir, base = dir, limit = 500) {
  const files = [];
  if (!dir || !fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (files.length >= limit) break;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, base, limit - files.length));
    else files.push(path.relative(base, absolute).split(path.sep).join("/"));
  }
  return files;
}

function cell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function status(exitCode) {
  if (String(exitCode) === "0") return "pass";
  if (String(exitCode) === "1") return "findings";
  return "error";
}

const lint = readJson(env.LINT_JSON);
const measure = readJson(env.MEASURE_JSON);
const artifact = env.ARTIFACT || "(not set)";
const title = env.TITLE || "Dezign0 design review";
const lintExit = env.LINT_EXIT ?? "?";
const measureExit = env.MEASURE_EXIT ?? "?";
const shots = walk(env.SHOTS);
const lintState = status(lintExit);
const measureState = status(measureExit);
const verdict = lintState === "pass" && measureState === "pass"
  ? "✅ Pass"
  : lintState === "findings" || measureState === "findings"
    ? "⚠️ Findings"
    : "⛔ Error";

const lines = [];
lines.push(MARKER);
lines.push(`## ${title}`);
lines.push("");
lines.push(`**Artifact:** \`${artifact}\`  `);
lines.push(`**Verdict:** ${verdict}  `);
lines.push("");

lines.push("| Gate | Exit | Result |");
lines.push("| --- | --- | --- |");
lines.push(`| Static lint (\`--strict\`) | ${lintExit} | ${lintState} |`);
lines.push(`| Rendered measurement (\`--a11y\`) | ${measureExit} | ${measureState} |`);
lines.push("");

if (lint) {
  const counts = lint.counts || {};
  lines.push("### Static lint");
  lines.push("");
  lines.push(`**${counts.P0 || 0} P0 · ${counts.P1 || 0} P1 · ${counts.P2 || 0} P2** across ${(lint.files || []).length} file(s).`);
  const findings = Array.isArray(lint.findings) ? lint.findings : [];
  if (findings.length) {
    lines.push("");
    lines.push("| Severity | Rule | Location | Message |");
    lines.push("| --- | --- | --- | --- |");
    for (const finding of findings.slice(0, 15)) {
      const file = finding.file ? path.basename(String(finding.file)) : "";
      const location = finding.line ? `${file}:${finding.line}` : file;
      lines.push(`| ${cell(finding.severity)} | ${cell(finding.id)} | ${cell(location)} | ${cell(finding.message)} |`);
    }
    if (findings.length > 15) lines.push(`| … | | | +${findings.length - 15} more |`);
  } else {
    lines.push("");
    lines.push("No findings.");
  }
  lines.push("");
} else {
  lines.push("### Static lint");
  lines.push("");
  lines.push(`Lint did not return JSON (exit ${lintExit}). See the job log.`);
  lines.push("");
}

if (measure) {
  const results = Array.isArray(measure.results) ? measure.results : [];
  lines.push("### Rendered measurement");
  lines.push("");
  if (results.length) {
    lines.push("| Viewport | Scroll width | Clipped | Contrast | A11y | Type sizes | Tab stops |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const result of results) {
      lines.push(`| ${cell(result.label || `${result.width}x${result.height}`)} | ${cell(result.scrollWidth)} | ${cell(result.clippedCount)} | ${cell(result.contrastCount)} | ${cell(result.a11yCount ?? "—")} | ${cell(result.typeSizeCount)} | ${cell(result.tabStops)} |`);
    }
  } else {
    lines.push("No viewport results were returned.");
  }
  const errors = (measure.consoleErrors || []).length + (measure.pageErrors || []).length;
  lines.push("");
  lines.push(`Browser errors: **${errors}**. External requests: **${(measure.requests || []).length}**.`);
  lines.push("");
} else {
  lines.push("### Rendered measurement");
  lines.push("");
  lines.push(measureExit === "?"
    ? "Measurement did not run."
    : `Measurement did not return JSON (exit ${measureExit}). Install Playwright in the project, or set \`install-playwright: false\` to lint only.`);
  lines.push("");
}

if (shots.length) {
  lines.push("### Screenshots");
  lines.push("");
  lines.push(`Uploaded ${shots.length} screenshot(s) as the \`dezign0-review-screenshots\` artifact.`);
  lines.push("");
  lines.push("<details><summary>Files</summary>");
  lines.push("");
  for (const file of shots.slice(0, 20)) lines.push(`- \`${file}\``);
  if (shots.length > 20) lines.push(`- … +${shots.length - 20} more`);
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

if (!lint || !measure) {
  lines.push("<details><summary>Raw output</summary>");
  lines.push("");
  for (const [name, value] of [["lint", env.LINT_JSON], ["measure", env.MEASURE_JSON]]) {
    let raw = "";
    try {
      raw = value ? fs.readFileSync(value, "utf8") : "";
    } catch {
      raw = "";
    }
    if (raw) {
      lines.push(`**${name}**`);
      lines.push("");
      lines.push("```json");
      lines.push(raw.slice(0, 4000));
      lines.push("```");
      lines.push("");
    }
  }
  lines.push("</details>");
  lines.push("");
}

lines.push("---");
lines.push("Generated by the Dezign0 composite action. Lint is static; measurement uses Playwright and is optional.");

const body = `${lines.join("\n")}\n`;
const summaryPath = env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  try {
    fs.appendFileSync(summaryPath, body);
  } catch {
    // A missing summary file must not fail the review.
  }
}

const bodyFile = path.join(env.RUNNER_TEMP || process.cwd(), "dezign0-comment.md");
try {
  fs.writeFileSync(bodyFile, body);
} catch {
  // The output below still carries the body.
}

const outputPath = env.GITHUB_OUTPUT;
if (outputPath) {
  const delimiter = "DEZIGN0_BODY_EOF";
  try {
    fs.appendFileSync(outputPath, `comment-body<<${delimiter}\n${body}${delimiter}\n`);
    fs.appendFileSync(outputPath, `body-file=${bodyFile}\n`);
    fs.appendFileSync(outputPath, `verdict=${verdict.replace(/[^\w ]/g, "").trim()}\n`);
  } catch {
    // Outputs are best-effort; the step summary already has the body.
  }
}
