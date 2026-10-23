#!/usr/bin/env node
/**
 * Test the Dezign0 MCP server and the Agent Plugins package.
 *
 *   node scripts/test-mcp.mjs
 *
 * What it proves:
 *   1. agent-plugin/plugin.json and mcp.json conform to the Agent Plugins
 *      1.0.0 closed schemas (names, fields, placeholder args).
 *   2. agent-plugin/skills/ is a byte-for-byte copy of design-os/skills/.
 *   3. mcp/server.mjs contains no shell, no network import and no exec.
 *   4. The stdio server answers initialize, tools/list (exactly seven tools),
 *      ping, errors (-32601/-32602/-32700) and survives invalid input.
 *   5. tools/call works on a temporary project: doctor, lint on a defect
 *      fixture (exit 1), lint on a clean fixture (exit 0), path-escape
 *      rejection, and graceful "not shipped" results for content/token tools.
 *   6. The process exits 0 on stdin close and stdout carried only JSON-RPC.
 *
 * No dependencies, no network. Writes only inside a temp directory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SERVER = path.join(ROOT, "mcp", "server.mjs");
const AGENT = path.join(ROOT, "agent-plugin");
const KIT_SKILLS = path.join(ROOT, "design-os", "skills");
const EXPECTED_TOOLS = [
  "dezign0_lint",
  "dezign0_measure",
  "dezign0_doctor",
  "dezign0_design_systems",
  "dezign0_addons",
  "dezign0_content_lint",
  "dezign0_token_export",
];
const results = [];

function fail(message) {
  throw new Error(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "", ms: Date.now() - started });
    process.stdout.write(`ok   ${name}${detail ? ` — ${detail}` : ""}\n`);
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error), ms: Date.now() - started });
    process.stdout.write(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

// ── MCP client ──────────────────────────────────────────────────────────────

function startClient(projectDir, entry = SERVER) {
  const child = spawn(process.execPath, [entry, "--project", projectDir], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, DEZIGN0_MCP_DEBUG: "" },
  });
  const inbox = [];
  let rawLines = 0;
  let parseFailures = 0;
  let buffer = "";
  let stderr = "";
  let exited = null;
  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      exited = { code, signal };
      resolve(exited);
    });
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      rawLines += 1;
      try {
        inbox.push(JSON.parse(line));
      } catch {
        parseFailures += 1;
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let nextId = 1;
  const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

  async function waitFor(predicate, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = inbox.findIndex(predicate);
      if (index !== -1) return inbox.splice(index, 1)[0];
      if (exited) {
        throw new Error(`server exited early (code ${exited.code})${stderr ? `: ${stderr.trim().slice(0, 400)}` : ""}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for response; inbox=${JSON.stringify(inbox).slice(0, 600)} stderr=${stderr.slice(0, 400)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return {
    child,
    inbox,
    write,
    get stderr() {
      return stderr;
    },
    get rawLines() {
      return rawLines;
    },
    get parseFailures() {
      return parseFailures;
    },
    get exited() {
      return exited;
    },
    async request(method, params) {
      const id = nextId++;
      write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
      const response = await waitFor((message) => message.id === id);
      return response;
    },
    notify(method, params) {
      write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    },
    writeRaw(line) {
      child.stdin.write(`${line}\n`);
    },
    async close() {
      child.stdin.end();
      const timeout = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 5000));
      const outcome = await Promise.race([exitPromise, timeout]);
      if (outcome.timeout) {
        child.kill("SIGTERM");
        await exitPromise;
        throw new Error("server did not exit after stdin close");
      }
      return outcome;
    },
  };
}

function toolText(response) {
  const content = response?.result?.content;
  if (!Array.isArray(content) || !content.length) fail(`response has no content: ${JSON.stringify(response).slice(0, 400)}`);
  if (content[0].type !== "text" || typeof content[0].text !== "string") fail("first content item is not text");
  return content[0].text;
}

// ── fixtures ────────────────────────────────────────────────────────────────

const DEFECT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Defect fixture</title>
<style>:root { --accent: #0f766e; } body { font-family: system-ui; }</style>
</head>
<body>
<h1>Launch faster</h1>
<p>Trusted by 10,000+ teams. 10x faster than the old way.</p>
<div style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); padding: 24px;">Hero</div>
</body>
</html>
`;

const CLEAN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Clean fixture</title>
<style>:root { --surface: #ffffff; --ink: #111827; --accent: #0f766e; }</style>
</head>
<body>
<h1>Billing settings</h1>
<p>Change your plan and download invoices from this page.</p>
</body>
</html>
`;

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dezign0-mcp-"));
  const project = path.join(temp, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "defect.html"), DEFECT_HTML);
  fs.writeFileSync(path.join(project, "clean.html"), CLEAN_HTML);
  fs.writeFileSync(
    path.join(project, "tokens.css"),
    ":root { --color-surface: #ffffff; --color-ink: #111827; --space-4: 16px; --radius-card: 12px; }\n",
  );
  fs.writeFileSync(path.join(temp, "escape.html"), DEFECT_HTML);

  let client = null;
  try {
    // ── static package checks ──────────────────────────────────────────────
    await step("agent-plugin/plugin.json is a valid Agent Plugins 1.0.0 manifest", () => {
      const manifest = readJson(path.join(AGENT, "plugin.json"));
      const allowed = new Set(["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]);
      for (const key of Object.keys(manifest)) if (!allowed.has(key)) fail(`unknown manifest field: ${key}`);
      if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") fail("wrong $schema");
      if (typeof manifest.name !== "string" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(manifest.name)) fail("invalid plugin name");
      if (/--|\.\./.test(manifest.name)) fail("plugin name has repeated separators");
      if (manifest.author) {
        for (const key of Object.keys(manifest.author)) if (!["name", "email", "url"].includes(key)) fail(`invalid author field: ${key}`);
      }
      const core = readJson(path.join(ROOT, "package.json"));
      if (manifest.version !== core.version) fail(`manifest version ${manifest.version} != package.json ${core.version}`);
      return `${manifest.name} ${manifest.version}`;
    });

    await step("agent-plugin/mcp.json declares one stdio server with ${PLUGIN_ROOT} args", () => {
      const config = readJson(path.join(AGENT, "mcp.json"));
      const keys = Object.keys(config);
      if (keys.length !== 2 || !keys.includes("$schema") || !keys.includes("mcpServers")) fail("mcp.json must contain only $schema and mcpServers");
      if (config.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json") fail("wrong mcp $schema");
      const servers = config.mcpServers;
      if (!servers || typeof servers !== "object" || Array.isArray(servers)) fail("mcpServers must be an object");
      const names = Object.keys(servers);
      if (names.length !== 1) fail(`expected one server, found ${names.length}`);
      const server = servers[names[0]];
      if (server.type !== "stdio") fail("server type must be stdio");
      if (typeof server.command !== "string" || !server.command) fail("command is required");
      if (!Array.isArray(server.args) || !server.args.some((arg) => arg === "${PLUGIN_ROOT}/server.mjs")) fail("args must point at ${PLUGIN_ROOT}/server.mjs");
      for (const key of Object.keys(server)) if (!["type", "command", "args", "env", "cwd"].includes(key)) fail(`unknown server field: ${key}`);
      if (!fs.existsSync(path.join(AGENT, "server.mjs"))) fail("agent-plugin/server.mjs is missing");
      return names[0];
    });

    await step("agent-plugin/skills is an exact copy of design-os/skills (13 skills)", () => {
      const core = fs.readdirSync(KIT_SKILLS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      const copyRoot = path.join(AGENT, "skills");
      if (!fs.existsSync(copyRoot)) fail("agent-plugin/skills is missing");
      const copy = fs.readdirSync(copyRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      if (core.length !== 13) fail(`expected 13 core skills, found ${core.length}`);
      if (copy.join(",") !== core.join(",")) fail(`skill sets differ: core=${core.join(",")} copy=${copy.join(",")}`);

      const walk = (root) => {
        const files = [];
        const visit = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(full);
            else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join("/"));
          }
        };
        visit(root);
        return files.sort();
      };

      let compared = 0;
      for (const name of core) {
        const coreFiles = walk(path.join(KIT_SKILLS, name));
        const copyFiles = walk(path.join(copyRoot, name));
        if (coreFiles.join(",") !== copyFiles.join(",")) {
          fail(`file sets differ for skill ${name}: core=${coreFiles.join(",")} copy=${copyFiles.join(",")}`);
        }
        if (!coreFiles.includes("SKILL.md")) fail(`SKILL.md missing for ${name}`);
        for (const relative of coreFiles) {
          const a = path.join(KIT_SKILLS, name, relative);
          const b = path.join(copyRoot, name, relative);
          if (sha256(a) !== sha256(b)) fail(`agent-plugin copy drifted for ${name}/${relative}; recopy design-os/skills -> agent-plugin/skills`);
          compared += 1;
        }
        const frontmatter = fs.readFileSync(path.join(KIT_SKILLS, name, "SKILL.md"), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const declared = frontmatter && /\nname:\s*([^\n]+)/.exec(`\n${frontmatter[1]}`);
        if (!declared || declared[1].trim() !== name) fail(`skill ${name} frontmatter name mismatch`);
      }
      return `13/13 skills, ${compared} files identical`;
    });

    await step("mcp/server.mjs has no shell, no network and no writes", () => {
      const source = fs.readFileSync(SERVER, "utf8");
      const forbidden = [
        [/\bexecSync\s*\(/, "execSync"],
        [/(?<![A-Za-z0-9_])exec\s*\(/, "exec()"],
        [/(?<![A-Za-z0-9_.])spawn\s*\(/, "spawn()"],
        [/shell\s*:\s*true/, "shell:true"],
        [/node:(http|https|net|tls|dgram)/, "network module"],
        [/(?<![A-Za-z0-9_.])fetch\s*\(/, "fetch()"],
        [/XMLHttpRequest/, "XMLHttpRequest"],
        [/require\(["'](http|https|net|tls)["']\)/, "network require"],
      ];
      for (const [pattern, label] of forbidden) if (pattern.test(source)) fail(`server source contains ${label}`);
      if (!/execFile\s*\(/.test(source)) fail("server should run checks through execFile");
      return "clean";
    });

    // ── runtime protocol checks ────────────────────────────────────────────
    client = startClient(project);

    await step("initialize negotiates a protocol and advertises tools", async () => {
      const response = await client.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "dezign0-test", version: "0.0.0" },
      });
      if (response.error) fail(`initialize error: ${JSON.stringify(response.error)}`);
      const result = response.result;
      if (result.protocolVersion !== "2025-06-18") fail(`unexpected protocolVersion ${result.protocolVersion}`);
      if (result.serverInfo?.name !== "dezign0") fail("serverInfo.name must be dezign0");
      if (!result.serverInfo?.version) fail("serverInfo.version is required");
      if (!result.capabilities?.tools) fail("capabilities.tools is required");
      client.notify("notifications/initialized");
      return `${result.serverInfo.name} ${result.serverInfo.version}, protocol ${result.protocolVersion}`;
    });

    await step("ping answers after the initialized notification", async () => {
      const response = await client.request("ping");
      if (response.error) fail(`ping error: ${JSON.stringify(response.error)}`);
      return "pong";
    });

    await step("tools/list returns exactly the seven tools with JSON Schemas", async () => {
      const response = await client.request("tools/list");
      if (response.error) fail(`tools/list error: ${JSON.stringify(response.error)}`);
      const tools = response.result?.tools;
      if (!Array.isArray(tools)) fail("tools is not an array");
      const names = tools.map((tool) => tool.name).sort();
      if (names.join(",") !== [...EXPECTED_TOOLS].sort().join(",")) {
        fail(`tool names differ: ${names.join(",")}`);
      }
      for (const tool of tools) {
        if (!tool.description || typeof tool.description !== "string") fail(`${tool.name} has no description`);
        if (tool.inputSchema?.type !== "object") fail(`${tool.name} inputSchema is not an object schema`);
        if (tool.annotations && typeof tool.annotations.readOnlyHint !== "boolean") fail(`${tool.name} readOnlyHint is not boolean`);
      }
      return `${tools.length} tools`;
    });

    await step("tools/call dezign0_doctor reports a healthy install", async () => {
      const response = await client.request("tools/call", { name: "dezign0_doctor", arguments: {} });
      const text = toolText(response);
      for (const needle of ["dezign0 mcp doctor", "skills: 13/13", "tools: 7", `project: ${fs.realpathSync(project)}`, "ok: true", "agent plugin: ok"]) {
        if (!text.includes(needle)) fail(`doctor output missing ${JSON.stringify(needle)}:\n${text}`);
      }
      if (fs.existsSync(path.join(ROOT, "design-os", "tools", "content-lint.mjs")) && !/content ok/.test(text)) fail("doctor should report content lint as ok");
      if (fs.existsSync(path.join(ROOT, "design-os", "tools", "token-export.mjs")) && !/token ok/.test(text)) fail("doctor should report token export as ok");
      return "ok: true";
    });

    await step("tools/call dezign0_lint flags a defect fixture (exit 1)", async () => {
      const response = await client.request("tools/call", { name: "dezign0_lint", arguments: { path: "defect.html" } });
      if (response.error) fail(`lint protocol error: ${JSON.stringify(response.error)}`);
      const text = toolText(response);
      if (!/P0/.test(text)) fail(`expected a P0 finding:\n${text}`);
      if (!/purple-gradient|invented-metric/.test(text)) fail(`expected a known rule id:\n${text}`);
      if (!/exit 1/.test(text)) fail(`expected exit 1:\n${text}`);
      if (response.result.isError === true) fail("lint findings must not be reported as a tool execution error");
      return "P0 found, exit 1";
    });

    await step("tools/call dezign0_lint passes a clean fixture (exit 0)", async () => {
      const response = await client.request("tools/call", { name: "dezign0_lint", arguments: { path: "clean.html" } });
      const text = toolText(response);
      if (!/exit 0/.test(text)) fail(`expected exit 0:\n${text}`);
      if (/\b[1-9]\d* P0\b/.test(text)) fail(`clean fixture produced a P0:\n${text}`);
      return "exit 0";
    });

    await step("path escapes and missing files are refused without crashing", async () => {
      const escape = await client.request("tools/call", { name: "dezign0_lint", arguments: { path: "../escape.html" } });
      const escapeText = toolText(escape);
      if (escape.result.isError !== true) fail("escape should be a tool error");
      if (!/outside the project/i.test(escapeText)) fail(`escape message unclear: ${escapeText}`);
      const absolute = await client.request("tools/call", { name: "dezign0_lint", arguments: { path: path.join(project, "clean.html") } });
      if (absolute.result.isError !== true) fail("absolute path should be refused");
      const missing = await client.request("tools/call", { name: "dezign0_lint", arguments: { path: "nope.html" } });
      if (missing.result.isError !== true) fail("missing file should be a tool error");
      return "3 refusals";
    });

    await step("content lint and token export run when their scripts ship", async () => {
      const hasContent = fs.existsSync(path.join(ROOT, "design-os", "tools", "content-lint.mjs"));
      const hasToken = fs.existsSync(path.join(ROOT, "design-os", "tools", "token-export.mjs"));
      const content = await client.request("tools/call", { name: "dezign0_content_lint", arguments: { path: "defect.html" } });
      const contentText = toolText(content);
      if (hasContent) {
        if (!/exit [0-2]/.test(contentText)) fail(`content lint should run:\n${contentText}`);
        if (!/P[0-2]/.test(contentText)) fail(`content lint should report findings on the defect fixture:\n${contentText}`);
      } else if (content.result.isError !== true || !/not available in this build/i.test(contentText)) {
        fail(`content lint fallback unclear: ${contentText}`);
      }
      const tokens = await client.request("tools/call", {
        name: "dezign0_token_export",
        arguments: { source: "tokens.css", format: "dtcg" },
      });
      const tokenText = toolText(tokens);
      if (hasToken) {
        if (!/exit 0/.test(tokenText)) fail(`token export should succeed:\n${tokenText}`);
        if (!/"\$value"/.test(tokenText)) fail(`token export should return DTCG JSON:\n${tokenText.slice(0, 400)}`);
      } else if (tokens.result.isError !== true || !/not available in this build/i.test(tokenText)) {
        fail(`token export fallback unclear: ${tokenText}`);
      }
      const noSource = await client.request("tools/call", { name: "dezign0_token_export", arguments: { source: "missing.css" } });
      if (noSource.result.isError !== true) fail("missing token source should be a tool error");
      return hasContent && hasToken ? "content + DTCG export" : "fallbacks verified";
    });

    await step("agent-plugin/server.mjs bootstrap serves the same tools", async () => {
      const bootstrap = startClient(project, path.join(AGENT, "server.mjs"));
      try {
        const init = await bootstrap.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
        if (init.result?.serverInfo?.name !== "dezign0") fail("bootstrap did not initialize the server");
        const list = await bootstrap.request("tools/list");
        const count = list.result?.tools?.length;
        if (count !== 7) fail(`bootstrap listed ${count} tools`);
        const exit = await bootstrap.close();
        if (exit.code !== 0) fail(`bootstrap exited ${exit.code}`);
        return "bootstrap ok, 7 tools";
      } finally {
        if (bootstrap.exited === null) bootstrap.child.kill("SIGKILL");
      }
    });

    await step("protocol errors use JSON-RPC codes and the server keeps working", async () => {
      const unknownTool = await client.request("tools/call", { name: "dezign0_nope", arguments: {} });
      if (unknownTool.error?.code !== -32602) fail(`unknown tool should be -32602, got ${JSON.stringify(unknownTool.error)}`);
      const unknownMethod = await client.request("tools/nope");
      if (unknownMethod.error?.code !== -32601) fail(`unknown method should be -32601, got ${JSON.stringify(unknownMethod.error)}`);
      client.writeRaw("{this is not json");
      const parseError = await (async () => {
        const deadline = Date.now() + 5000;
        for (;;) {
          const index = client.inbox.findIndex((message) => message.error?.code === -32700);
          if (index !== -1) return client.inbox.splice(index, 1)[0];
          if (Date.now() > deadline) fail("no -32700 parse error response");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      })();
      if (parseError.id !== null) fail("parse error should carry a null id");
      const ping = await client.request("ping");
      if (ping.error) fail("server did not survive invalid JSON");
      return "-32602, -32601, -32700";
    });

    await step("stdout carried only JSON-RPC and the process exits 0 on stdin close", async () => {
      const exit = await client.close();
      if (exit.code !== 0) fail(`unexpected exit code ${exit.code} (signal ${exit.signal})`);
      if (client.parseFailures !== 0) fail(`stdout had ${client.parseFailures} non-JSON line(s): ${client.stderr.slice(0, 300)}`);
      if (client.rawLines < 8) fail(`expected at least 8 JSON-RPC messages, saw ${client.rawLines}`);
      if (client.child.exitCode !== 0) fail("child exitCode is not 0");
      return `${client.rawLines} messages, exit 0`;
    });
  } finally {
    if (client && client.exited === null) {
      try {
        await client.close();
      } catch {
        client.child.kill("SIGKILL");
      }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length) {
    process.stdout.write(`\nFailures:\n${failed.map((result) => `  - ${result.name}: ${result.detail}`).join("\n")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`test-mcp crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
