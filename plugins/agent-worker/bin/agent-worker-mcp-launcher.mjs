#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_AGENT_WORKER_PACKAGE = "@rvaim/agent-worker-mcp@latest";
const DEFAULT_ACPX_PACKAGE = "acpx@latest";

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

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function npmOutput(args) {
  const result = spawnSync("npm", args, {
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result.stdout.trim();
}

function globalBinDir(prefix) {
  return process.platform === "win32" ? prefix : path.join(prefix, "bin");
}

async function ensurePackages(root) {
  const autoUpdate = boolOption("AGENT_WORKER_MCP_AUTO_UPDATE", true);
  const agentWorkerPackage = option("AGENT_WORKER_MCP_PACKAGE", DEFAULT_AGENT_WORKER_PACKAGE);
  const acpxPackage = option("AGENT_WORKER_ACPX_PACKAGE", DEFAULT_ACPX_PACKAGE);

  await mkdir(root, { recursive: true });

  const globalRoot = npmOutput(["root", "-g"]);
  const globalPrefix = npmOutput(["prefix", "-g"]);
  const globalBin = globalBinDir(globalPrefix);
  const server = path.join(globalRoot, "@rvaim", "agent-worker-mcp", "dist", "index.js");
  const acpx = path.join(globalBin, process.platform === "win32" ? "acpx.cmd" : "acpx");

  if (!autoUpdate && existsSync(server) && existsSync(acpx)) {
    return { server, acpx, globalBin, globalRoot };
  }

  log(`installing globally ${agentWorkerPackage} and ${acpxPackage}`);
  run("npm", ["install", "-g", "--no-audit", "--no-fund", agentWorkerPackage, acpxPackage]);

  if (!existsSync(server)) {
    throw new Error(`global agent-worker-mcp server was not installed at ${server}`);
  }
  if (!existsSync(acpx)) {
    throw new Error(`global acpx binary was not installed at ${acpx}`);
  }

  return { server, acpx, globalBin, globalRoot };
}

function prepareWorkerEnv(globalBin, acpx) {
  const configuredAcpx = option("ACPX_BIN", "auto");
  const resolvedAcpx = configuredAcpx.toLowerCase() === "auto" ? acpx : configuredAcpx;

  process.env.PATH = `${globalBin}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.ACPX_BIN = resolvedAcpx;
  process.env.DEFAULT_WORKER_AGENT = option("DEFAULT_WORKER_AGENT", "claude");
  process.env.ALLOWED_WORKER_AGENTS = option("ALLOWED_WORKER_AGENTS", "claude,codex,gemini,opencode,qwen,kimi");
  process.env.ACPX_APPROVAL = option("ACPX_APPROVAL", "all");
  process.env.WORKER_MAX_TIMEOUT_SECONDS = option("WORKER_MAX_TIMEOUT_SECONDS", "3600");
}

async function main() {
  const root = dataRoot();
  process.env.npm_config_cache ??= path.join(root, "npm-cache");
  process.env.NPM_CONFIG_CACHE ??= process.env.npm_config_cache;

  const { server, acpx, globalBin, globalRoot } = await ensurePackages(root);
  prepareWorkerEnv(globalBin, acpx);

  const packageJson = await readJson(path.join(globalRoot, "@rvaim", "agent-worker-mcp", "package.json"));
  log(`starting ${packageJson?.name ?? "@rvaim/agent-worker-mcp"}@${packageJson?.version ?? "unknown"}`);
  const child = spawn(process.execPath, [server], {
    cwd: root,
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
