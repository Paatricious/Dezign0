/**
 * Shared helpers for Claude Code lifecycle hooks.
 *
 * Hooks are deliberately narrow: only HTML artifacts are linted, only P0
 * findings block, and the scripts never write files or call the network.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
export const CLI = path.join(ROOT, "bin", "dezign0.mjs");

export function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

export function fileFromHook(input) {
  const candidate =
    input?.tool_input?.file_path ||
    input?.tool_input?.path ||
    input?.tool_input?.filePath ||
    "";
  if (!candidate) return null;
  const file = path.resolve(process.cwd(), candidate);
  if (!/\.(html?|xhtml)$/i.test(file)) return null;
  if (file.includes(`${path.sep}.design-os${path.sep}`)) return null;
  return file;
}

export function lint(file) {
  if (!fs.existsSync(CLI)) return null;
  try {
    const stdout = execFileSync(process.execPath, [CLI, "lint", "--json", file], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    // The CLI exits 1 when findings exist; its JSON is still on stdout.
    if (error?.stdout) {
      try {
        return JSON.parse(String(error.stdout));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function p0Report(result, file) {
  if (!result || !Array.isArray(result.findings)) return "";
  const p0 = result.findings.filter((finding) => finding.severity === "P0");
  if (p0.length === 0) return "";
  const lines = p0.slice(0, 8).map((finding) => {
    const where = finding.line ? `:${finding.line}` : "";
    return `  ${path.relative(process.cwd(), file)}${where} [${finding.id}] ${finding.message}`;
  });
  return `Dezign0 found ${p0.length} blocking P0 design issue(s):\n${lines.join("\n")}\nFix these before continuing, or explain why the finding is a false positive.`;
}

export function recentHtmlFiles(limit = 12) {
  const candidates = [];
  const roots = [path.join(process.cwd(), "design"), process.cwd()];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir, depth) => {
      if (depth > 3) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".design-os" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (/\.(html?|xhtml)$/i.test(entry.name)) {
          try {
            candidates.push({ file: full, mtime: fs.statSync(full).mtimeMs });
          } catch {
            // Ignore a file that disappears mid-scan.
          }
        }
      }
    };
    walk(root, 0);
  }
  return [...new Map(candidates.map((item) => [item.file, item])).values()]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((item) => item.file);
}
