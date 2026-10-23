#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: lint HTML written or edited by the agent.
 * Exit 2 blocks the action and shows the P0 findings to the model.
 */
import { fileFromHook, lint, p0Report, readStdin } from "./hook-lib.mjs";

const input = readStdin();
const file = fileFromHook(input);
if (!file || !file.startsWith(process.cwd())) process.exit(0);

const result = lint(file);
if (!result) process.exit(0);

const report = p0Report(result, file);
if (!report) process.exit(0);

console.error(report);
process.exit(2);
