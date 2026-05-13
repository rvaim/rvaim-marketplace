#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REPO_URL = "https://github.com/rvaim/agent-worker-mcp.git";

function rawOption(name) {
  return process.env[name] ?? process.env[`CLAUDE_PLUGIN_OPTION_${name}`] ?? process.env[`CLAUDE_PLUGIN_OPTION_${name.toUpperCase()}`];
}

function isPlaceholder(value) {
  return typeof value === "string" && value.includes("${user_config.");
}

function option(name, fallback) {
  const value = rawOption(name);
  if (value === undefined || value === null || value === "" || isPlaceholder(value)) return fallback;
  return String(value);
}

function boolOption(name, fallback) {
  const value = option(name, fallback ? "true" : "false").toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function dataRoot() {
  const configured = process.env.AGENT_WORKER_MCP_DATA || process.env.CLAUDE_PLUGIN_DATA || process.env.CODEX_PLUGIN_DATA;
  if (configured && !isPlaceholder(configured)) return configured;
  return path.join(os.homedir(), ".cache", "rvaim-agent-worker");
}

function log(message) {
  process.stderr.write(`[agent-worker] ${message}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function ensureSource(sourceDir) {
  const repo = process.env.AGENT_WORKER_MCP_REPO || REPO_URL;
  const autoUpdate = boolOption("AGENT_WORKER_MCP_AUTO_UPDATE", true);

  await mkdir(path.dirname(sourceDir), { recursive: true });

  if (!existsSync(path.join(sourceDir, ".git"))) {
    log(`cloning ${repo}`);
    run("git", ["clone", "--depth", "1", repo, sourceDir]);
    return true;
  }

  if (!autoUpdate) return false;

  const before = await readText(path.join(sourceDir, ".git", "HEAD"));
  log("updating agent-worker-mcp");
  run("git", ["fetch", "--depth", "1", "origin", "HEAD"], { cwd: sourceDir });
  run("git", ["reset", "--hard", "FETCH_HEAD"], { cwd: sourceDir });
  const after = await readText(path.join(sourceDir, ".git", "HEAD"));
  return before !== after;
}

async function currentRevision(sourceDir) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceDir,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

async function ensureBuilt(sourceDir, root, sourceChanged) {
  const dist = path.join(sourceDir, "dist", "index.js");
  const stamp = path.join(root, "agent-worker-mcp.stamp");
  const revision = await currentRevision(sourceDir);
  const previous = await readText(stamp);
  const needsBuild = sourceChanged || previous.trim() !== revision || !existsSync(dist);

  if (!needsBuild) return dist;

  log("installing dependencies");
  if (existsSync(path.join(sourceDir, "package-lock.json"))) {
    run("npm", ["ci"], { cwd: sourceDir });
  } else {
    run("npm", ["install"], { cwd: sourceDir });
  }

  log("building agent-worker-mcp");
  run("npm", ["run", "build"], { cwd: sourceDir });
  await writeFile(stamp, `${revision}\n`, "utf8");
  return dist;
}

function prepareWorkerEnv() {
  process.env.ACPX_BIN = option("ACPX_BIN", "npx -y acpx@latest");
  process.env.DEFAULT_WORKER_AGENT = option("DEFAULT_WORKER_AGENT", "claude");
  process.env.ALLOWED_WORKER_AGENTS = option("ALLOWED_WORKER_AGENTS", "claude,codex,gemini,opencode,qwen,kimi");
  process.env.ACPX_APPROVAL = option("ACPX_APPROVAL", "all");
  process.env.WORKER_MAX_TIMEOUT_SECONDS = option("WORKER_MAX_TIMEOUT_SECONDS", "3600");
}

async function main() {
  prepareWorkerEnv();

  const root = dataRoot();
  const sourceDir = path.join(root, "agent-worker-mcp");
  await mkdir(root, { recursive: true });
  process.env.npm_config_cache ??= path.join(root, "npm-cache");
  process.env.NPM_CONFIG_CACHE ??= process.env.npm_config_cache;

  const sourceChanged = await ensureSource(sourceDir);
  const server = await ensureBuilt(sourceDir, root, sourceChanged);

  log(`starting ${server}`);
  const child = spawn(process.execPath, [server], {
    cwd: sourceDir,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  process.stderr.write(`[agent-worker] startup failed: ${error.stack || error.message}\n`);
  process.exit(1);
});
