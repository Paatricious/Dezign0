/**
 * Deterministic grader for Dezign0 eval artifacts.
 *
 * No network, no model calls, no third-party dependencies. Every point is earned
 * by a rule that produces the same result for the same artifact bytes: expected
 * patterns, forbidden patterns, the kit's static linter, a content audit, static
 * accessibility checks and structural checks.
 *
 * Used by run.mjs and scripts/test-evals.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const SCHEMA = "dezign0/eval-task/v1";

export const DEFAULT_WEIGHTS = Object.freeze({
  mustHave: 45,
  forbidden: 20,
  lint: 15,
  content: 10,
  a11y: 5,
  structure: 5,
});

const MAX_PATTERN_BYTES = 512;

/** Content-audit rules. Each distinct rule can lose points once per artifact. */
export const CONTENT_RULES = Object.freeze([
  {
    id: "placeholder-copy",
    description: "No placeholder or lorem copy",
    pattern: /lorem ipsum|dolor sit amet|your (?:text|content|headline) here|placeholder (?:text|copy)/i,
  },
  {
    id: "work-markers",
    description: "No TODO/FIXME/XXX left in the artifact",
    pattern: /\b(?:TODO|FIXME|XXX)\b/,
  },
  {
    id: "invented-metrics",
    description: "No invented metrics or social proof",
    pattern:
      /\btrusted by\s+\d|\b\d{1,3}(?:\.\d+)?%\s*(?:uptime|faster|more|less|conversion|accuracy)|\b\d+(?:\.\d+)?\s*[x×]\s*(?:faster|more)|(?:\d{1,3},)?\d{3,}\+?\s+(?:teams|companies|customers|users)/i,
  },
  {
    id: "dead-links",
    description: "No href=\"#\" or javascript: links",
    pattern: /href\s*=\s*["']#["']|href\s*=\s*["']javascript:/i,
  },
  {
    id: "placeholder-assets",
    description: "No placeholder image services or example.com assets",
    pattern: /placehold\.co|via\.placeholder\.com|picsum\.photos|loremflickr|(?:src|href)\s*=\s*["'][^"']*example\.com/i,
  },
  {
    id: "empty-sources",
    description: "No empty src or src=\"#\" attributes",
    pattern: /\b(?:src|poster)\s*=\s*["'](?:|#)["']/i,
  },
]);

/** Static accessibility checks. `applies(task)` decides whether a check counts. */
export const A11Y_CHECKS = Object.freeze([
  {
    id: "lang",
    description: "Root html element declares a language",
    applies: () => true,
    run: (text) => /<html[^>]*\blang\s*=\s*["'][a-z]{2,}/i.test(text),
  },
  {
    id: "single-h1",
    description: "Exactly one h1",
    applies: () => true,
    run: (text) => count(text, /<h1[\s>]/gi) === 1,
  },
  {
    id: "image-alt",
    description: "Every img has an alt attribute",
    applies: () => true,
    run: (text) => {
      const imgs = text.match(/<img\b[^>]*>/gi) ?? [];
      return imgs.every((tag) => /\balt\s*=\s*["']/i.test(tag));
    },
  },
  {
    id: "button-name",
    description: "No unlabelled or empty buttons",
    applies: () => true,
    run: (text) => {
      if (/<button\b[^>]*>\s*<\/button>/i.test(text)) return false;
      if (/<button\b[^>]*>\s*<svg\b/i.test(text) && !/<button\b[^>]*aria-label\s*=/i.test(text)) {
        return false;
      }
      return true;
    },
  },
  {
    id: "input-label",
    description: "Every visible input has a label, aria-label or aria-labelledby",
    applies: () => true,
    run: (text) => {
      const inputs = text.match(/<input\b[^>]*>/gi) ?? [];
      for (const tag of inputs) {
        if (/\btype\s*=\s*["'](?:hidden|submit|button|reset|image)["']/i.test(tag)) continue;
        if (/\baria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(tag)) continue;
        const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
        if (!id) return false;
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${escaped}["']`, "i").test(text)) return false;
      }
      return true;
    },
  },
  {
    id: "landmarks",
    description: "Page exposes main content and a landmark",
    applies: () => true,
    run: (text) => /<main\b/i.test(text) && /<(?:nav|header|footer)\b/i.test(text),
  },
  {
    id: "focus-visible",
    description: "Interactive artifact styles :focus-visible",
    applies: (task) => task.interactive !== false,
    run: (text) => /:focus-visible/.test(text),
  },
  {
    id: "reduced-motion",
    description: "Animated artifact honours prefers-reduced-motion",
    applies: (task) => task.motion !== false,
    run: (text) => /prefers-reduced-motion/.test(text),
  },
]);

/** Structural checks. `run` returns true when the artifact passes. */
export const STRUCTURE_CHECKS = Object.freeze([
  {
    id: "doctype",
    description: "Starts with <!doctype html>",
    run: (text) => /^\s*<!doctype html>/i.test(text),
  },
  {
    id: "html-root",
    description: "Has an html root and closes it",
    run: (text) => /<html[\s>]/i.test(text) && /<\/html>\s*$/i.test(text),
  },
  {
    id: "viewport",
    description: "Declares a viewport meta tag (unless the task opts out)",
    run: (text, task) => task.structure?.viewport === false || /<meta[^>]*name\s*=\s*["']viewport["']/i.test(text),
  },
  {
    id: "offline-assets",
    description: "No remote script/img/stylesheet assets",
    run: (text) =>
      !/<(?:img|script|link)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i.test(text),
  },
  {
    id: "min-bytes",
    description: "Artifact is not a stub",
    run: (text, task) => text.length >= (task.structure?.minBytes ?? 1200),
  },
  {
    id: "closed-body",
    description: "Body is closed",
    run: (text) => /<\/body>/i.test(text),
  },
]);

function count(text, re) {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function compile(pattern, flags = "i", where = "pattern") {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error(`${where}: pattern must be a non-empty string`);
  }
  if (Buffer.byteLength(pattern) > MAX_PATTERN_BYTES) {
    throw new Error(`${where}: pattern is too long`);
  }
  if (new RegExp(pattern, flags).source.length === 0) {
    throw new Error(`${where}: empty pattern`);
  }
  return new RegExp(pattern, flags);
}

function distribute(total, count) {
  if (count <= 0) return { each: total, remainder: 0 };
  const each = Math.floor(total / count);
  return { each, remainder: total - each * count };
}

/**
 * Validate one expected.json document. Throws with a precise message so a broken
 * task fails the test suite instead of producing misleading scores.
 */
export function validateTask(task, source = "task") {
  if (!task || typeof task !== "object") throw new Error(`${source}: expected an object`);
  if (task.schema !== SCHEMA) throw new Error(`${source}: schema must be ${SCHEMA}`);
  if (!/^[a-z0-9-]+$/.test(task.id ?? "")) throw new Error(`${source}: invalid id`);
  if (!/^[a-z0-9-]+$/.test(task.profile ?? "")) throw new Error(`${source}: invalid profile`);
  if (typeof task.title !== "string" || task.title.trim() === "") throw new Error(`${source}: title required`);
  if (typeof task.artifact !== "string" || !/^[a-z0-9._-]+\.html$/i.test(task.artifact)) {
    throw new Error(`${source}: artifact must be a simple .html filename`);
  }
  if (task.artifact.includes("..") || task.artifact.includes("/") || task.artifact.includes("\\")) {
    throw new Error(`${source}: artifact path must not escape the out directory`);
  }
  for (const field of ["mustHave", "forbidden"]) {
    const items = task[field];
    if (!Array.isArray(items) || items.length === 0) throw new Error(`${source}: ${field} must be a non-empty array`);
    const ids = new Set();
    for (const [index, item] of items.entries()) {
      const where = `${source}: ${field}[${index}]`;
      if (!item || typeof item !== "object") throw new Error(`${where}: expected an object`);
      if (!/^[a-z0-9-]+$/.test(item.id ?? "")) throw new Error(`${where}: invalid id`);
      if (ids.has(item.id)) throw new Error(`${where}: duplicate id ${item.id}`);
      ids.add(item.id);
      if (typeof item.description !== "string" || item.description.trim() === "") {
        throw new Error(`${where}: description required`);
      }
      compile(item.pattern, item.flags, where);
      if (item.min !== undefined && (!Number.isInteger(item.min) || item.min < 1)) {
        throw new Error(`${where}: min must be an integer >= 1`);
      }
      if (item.max !== undefined && (!Number.isInteger(item.max) || item.max < 0)) {
        throw new Error(`${where}: max must be an integer >= 0`);
      }
      if (field === "mustHave" && item.max !== undefined) {
        throw new Error(`${where}: max is only meaningful for forbidden patterns`);
      }
      if (field === "forbidden" && item.min !== undefined) {
        throw new Error(`${where}: min is only meaningful for mustHave patterns`);
      }
    }
  }
  if (task.a11y !== undefined && typeof task.a11y !== "boolean") throw new Error(`${source}: a11y must be boolean`);
  if (task.interactive !== undefined && typeof task.interactive !== "boolean") {
    throw new Error(`${source}: interactive must be boolean`);
  }
  if (task.motion !== undefined && typeof task.motion !== "boolean") throw new Error(`${source}: motion must be boolean`);
  const weights = resolveWeights(task);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum !== 100) throw new Error(`${source}: weights must sum to 100 (got ${sum})`);
  if (weights.mustHave > 0 && task.mustHave.length > 0 && weights.mustHave < task.mustHave.length) {
    throw new Error(`${source}: mustHave weight is smaller than its item count`);
  }
  return true;
}

/** Merge defaults with task overrides and move the a11y share when a11y is off. */
export function resolveWeights(task) {
  const weights = { ...DEFAULT_WEIGHTS };
  if (task.a11y === false) {
    weights.mustHave += weights.a11y;
    weights.a11y = 0;
  }
  if (task.weights) {
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      if (task.weights[key] === undefined) continue;
      if (!Number.isInteger(task.weights[key]) || task.weights[key] < 0) {
        throw new Error(`weights.${key} must be a non-negative integer`);
      }
      weights[key] = task.weights[key];
    }
  }
  return weights;
}

function runLint(artifactPath, lintPath) {
  if (!lintPath || !fs.existsSync(lintPath)) {
    return { available: false, error: `linter not found: ${lintPath ?? "(unset)"}`, counts: null, findings: [] };
  }
  const result = spawnSync(process.execPath, [lintPath, "--json", artifactPath], {
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object" || !parsed.counts) throw new Error("missing counts");
    return {
      available: true,
      counts: {
        P0: Number(parsed.counts.P0) || 0,
        P1: Number(parsed.counts.P1) || 0,
        P2: Number(parsed.counts.P2) || 0,
      },
      findings: Array.isArray(parsed.findings)
        ? parsed.findings.slice(0, 50).map((f) => ({
            severity: f.severity,
            id: f.id,
            line: f.line,
            message: f.message,
          }))
        : [],
      status: result.status,
    };
  } catch (error) {
    return {
      available: false,
      error: `linter output was not JSON (${error instanceof Error ? error.message : String(error)})`,
      counts: null,
      findings: [],
      status: result.status,
    };
  }
}

function patternDimension(text, items, weight, mode) {
  const share = distribute(weight, items.length);
  const results = items.map((item, index) => {
    const flags = item.flags ?? "i";
    compile(item.pattern, flags, `${mode}:${item.id}`);
    const countRe = compile(item.pattern, flags.includes("g") ? flags : `${flags}g`, `${mode}:${item.id}`);
    const matches = text.match(countRe) ?? [];
    const itemWeight = share.each + (index < share.remainder ? 1 : 0);
    const min = item.min ?? 1;
    const max = item.max ?? 0;
    const pass = mode === "mustHave" ? matches.length >= min : matches.length <= max;
    return {
      id: item.id,
      description: item.description,
      pass,
      weight: itemWeight,
      detail:
        mode === "mustHave"
          ? `${matches.length} match(es), need >= ${min}${matches[0] ? ` — ${JSON.stringify(matches[0].slice(0, 60))}` : ""}`
          : `${matches.length} match(es), allowed <= ${max}${matches[0] ? ` — ${JSON.stringify(matches[0].slice(0, 60))}` : ""}`,
    };
  });
  const gained = results.filter((item) => item.pass).reduce((sum, item) => sum + item.weight, 0);
  return { score: gained, max: weight, items: results };
}

function lintDimension(lint, weight) {
  const items = [];
  if (!lint.available) {
    return {
      score: 0,
      max: weight,
      items: [{ id: "lint-unavailable", description: lint.error, pass: false, weight, detail: lint.error }],
      counts: null,
    };
  }
  const p1Penalty = Math.ceil(weight / 5);
  const p2Penalty = Math.ceil(weight / 15);
  let score = weight;
  if (lint.counts.P0 > 0) score = 0;
  else score = Math.max(0, score - lint.counts.P1 * p1Penalty - lint.counts.P2 * p2Penalty);
  items.push({
    id: "p0",
    description: "No P0 lint findings",
    pass: lint.counts.P0 === 0,
    weight,
    detail: `${lint.counts.P0} P0`,
  });
  items.push({
    id: "p1",
    description: "Limited P1 lint findings",
    pass: lint.counts.P1 === 0,
    weight: 0,
    detail: `${lint.counts.P1} P1 (-${Math.min(weight, lint.counts.P1 * p1Penalty)})`,
  });
  items.push({
    id: "p2",
    description: "Limited P2 lint findings",
    pass: lint.counts.P2 === 0,
    weight: 0,
    detail: `${lint.counts.P2} P2 (-${Math.min(weight, lint.counts.P2 * p2Penalty)})`,
  });
  return { score, max: weight, items, counts: lint.counts, findings: lint.findings };
}

function contentDimension(text, weight) {
  const hits = CONTENT_RULES.map((rule) => {
    const match = rule.pattern.exec(text);
    return {
      id: rule.id,
      description: rule.description,
      pass: !match,
      weight: 0,
      detail: match ? `matched ${JSON.stringify(match[0].slice(0, 80))}` : "clean",
    };
  });
  const penalty = Math.ceil(weight / Math.max(1, CONTENT_RULES.length - 1));
  const score = Math.max(0, weight - hits.filter((hit) => !hit.pass).length * penalty);
  return { score, max: weight, items: hits };
}

function a11yDimension(text, task, weight) {
  const checks = A11Y_CHECKS.filter((check) => check.applies(task));
  const share = distribute(weight, checks.length);
  const items = checks.map((check, index) => {
    const pass = check.run(text);
    return {
      id: check.id,
      description: check.description,
      pass,
      weight: share.each + (index < share.remainder ? 1 : 0),
      detail: pass ? "pass" : "fail",
    };
  });
  const score = items.filter((item) => item.pass).reduce((sum, item) => sum + item.weight, 0);
  return { score, max: weight, items };
}

function structureDimension(text, task, weight) {
  const checks = STRUCTURE_CHECKS;
  const share = distribute(weight, checks.length);
  const items = checks.map((check, index) => {
    const pass = check.run(text, task);
    return {
      id: check.id,
      description: check.description,
      pass,
      weight: share.each + (index < share.remainder ? 1 : 0),
      detail: pass ? "pass" : "fail",
    };
  });
  const score = items.filter((item) => item.pass).reduce((sum, item) => sum + item.weight, 0);
  return { score, max: weight, items };
}

/**
 * Grade one artifact. Returns an integer score out of 100 plus every check.
 *
 * @param {{artifactPath: string, task: object, lintPath?: string}} options
 */
export function gradeArtifact({ artifactPath, task, lintPath }) {
  const weights = resolveWeights(task);
  const base = {
    schema: "dezign0/eval-grade/v1",
    task: task.id,
    profile: task.profile,
    artifactPath: null,
    score: 0,
    max: 100,
    error: null,
    artifact: null,
    dimensions: null,
  };

  let stat;
  try {
    stat = fs.statSync(artifactPath);
  } catch {
    return { ...base, error: "missing-artifact", dimensions: emptyDimensions(weights) };
  }
  if (!stat.isFile() || stat.size === 0) {
    return { ...base, error: "empty-artifact", dimensions: emptyDimensions(weights) };
  }

  let text;
  try {
    text = fs.readFileSync(artifactPath, "utf8");
  } catch (error) {
    return {
      ...base,
      error: `unreadable-artifact: ${error instanceof Error ? error.message : String(error)}`,
      dimensions: emptyDimensions(weights),
    };
  }

  const lint = runLint(artifactPath, lintPath);
  const dimensions = {
    mustHave: patternDimension(text, task.mustHave, weights.mustHave, "mustHave"),
    forbidden: patternDimension(text, task.forbidden, weights.forbidden, "forbidden"),
    lint: lintDimension(lint, weights.lint),
    content: contentDimension(text, weights.content),
    a11y: weights.a11y > 0 ? a11yDimension(text, task, weights.a11y) : null,
    structure: structureDimension(text, task, weights.structure),
  };
  const score = Object.values(dimensions)
    .filter(Boolean)
    .reduce((sum, dimension) => sum + dimension.score, 0);

  const sha256 = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  return {
    ...base,
    artifactPath,
    score: Math.min(100, Math.max(0, score)),
    artifact: { bytes: stat.size, sha256 },
    dimensions,
    lint: lint.available ? { counts: lint.counts, findings: lint.findings } : { error: lint.error },
  };
}

function emptyDimensions(weights) {
  return {
    mustHave: { score: 0, max: weights.mustHave, items: [] },
    forbidden: { score: 0, max: weights.forbidden, items: [] },
    lint: { score: 0, max: weights.lint, items: [] },
    content: { score: 0, max: weights.content, items: [] },
    a11y: weights.a11y > 0 ? { score: 0, max: weights.a11y, items: [] } : null,
    structure: { score: 0, max: weights.structure, items: [] },
  };
}

/** Load, parse and validate an expected.json file. */
export function loadTask(taskDir) {
  const expectedPath = path.join(taskDir, "expected.json");
  const task = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  validateTask(task, expectedPath);
  return task;
}

/** Load a prompt.md file, failing loudly when it is empty. */
export function loadPrompt(taskDir) {
  const promptPath = path.join(taskDir, "prompt.md");
  const text = fs.readFileSync(promptPath, "utf8").trim();
  if (text.length < 60) throw new Error(`${promptPath}: prompt is too short to be a real brief`);
  return text;
}
