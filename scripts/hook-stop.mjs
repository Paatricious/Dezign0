#!/usr/bin/env node
/**
 * Claude Code Stop hook: check recently touched HTML artifacts for P0 findings.
 * It never blocks twice in a row (stop_hook_active).
 */
import { lint, p0Report, readStdin, recentHtmlFiles } from "./hook-lib.mjs";

const input = readStdin();
if (input?.stop_hook_active) process.exit(0);

const reports = [];
for (const file of recentHtmlFiles(8)) {
  const result = lint(file);
  const report = p0Report(result, file);
  if (report) reports.push(report);
}

if (reports.length === 0) process.exit(0);
console.error(`Dezign0 review gate:\n\n${reports.slice(0, 3).join("\n\n")}`);
process.exit(2);
