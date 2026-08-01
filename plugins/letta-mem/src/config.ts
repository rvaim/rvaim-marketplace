import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { RuntimeConfig } from "./types.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:4500";
const DEFAULT_MODEL = "auto";

interface SharedConfigFile {
  serverUrl?: string;
  model?: string;
  mixedMemory?: boolean;
  sharedMemory?: boolean;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeServerUrl(raw: string): string {
  const parsed = new URL(raw);
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error("Letta App Server 地址必须使用 http、https、ws 或 wss 协议");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Letta App Server 地址不能包含凭据、查询参数或片段");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname !== "/ws") {
    throw new Error("Letta App Server 地址只能使用根路径或 /ws");
  }
  parsed.pathname = "";
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  return parsed.toString().replace(/\/$/, "");
}

function namespaceFor(
  serverUrl: string,
  authToken: string = "",
  mixedMemory = false,
): string {
  const authScope = authToken ? `token:${authToken}` : "token:none";
  const memoryScope = mixedMemory ? "mixed-memory-v1" : "per-workspace-v1";
  const source = `${memoryScope}:app-server:${serverUrl}:${authScope}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 20);
}

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function parseBooleanOption(
  value: string | undefined,
  fallback: boolean,
  label: string,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${label}配置必须是 true、false、1 或 0`);
}

function normalizeModel(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_MODEL;
  const automatic = normalized.toLowerCase();
  if (automatic === "auto" || automatic === "letta/auto") {
    return DEFAULT_MODEL;
  }
  return normalized;
}

function sharedConfigPath(env: NodeJS.ProcessEnv): string {
  const configured = firstNonEmpty(env.LETTA_MEM_CONFIG_PATH);
  if (!configured) return join(homedir(), ".letta-mem", "config.json");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return join(homedir(), configured.slice(2));
  }
  return isAbsolute(configured) ? configured : resolve(configured);
}

function readSharedConfig(env: NodeJS.ProcessEnv): SharedConfigFile {
  const path = sharedConfigPath(env);
  if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, "utf8")) as SharedConfigFile;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("letta-mem 共享配置必须是 JSON 对象");
  }
  if (value.serverUrl !== undefined && typeof value.serverUrl !== "string") {
    throw new Error("共享配置 serverUrl 必须是字符串");
  }
  if (value.model !== undefined && typeof value.model !== "string") {
    throw new Error("共享配置 model 必须是字符串");
  }
  if (
    value.mixedMemory !== undefined
    && typeof value.mixedMemory !== "boolean"
  ) {
    throw new Error("共享配置 mixedMemory 必须是布尔值");
  }
  if (
    value.sharedMemory !== undefined
    && typeof value.sharedMemory !== "boolean"
  ) {
    throw new Error("共享配置 sharedMemory 必须是布尔值");
  }
  return value;
}

export function readRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const shared = readSharedConfig(env);
  const serverUrl = normalizeServerUrl(firstNonEmpty(
    env.LETTA_APP_SERVER_URL,
    shared.serverUrl,
  ) ?? DEFAULT_SERVER_URL);
  const authToken = firstNonEmpty(
    env.LETTA_APP_SERVER_TOKEN,
  );
  const model = normalizeModel(firstNonEmpty(
    env.LETTA_MEM_MODEL,
    shared.model,
  ));
  const mixedMemory = parseBooleanOption(
    firstNonEmpty(
      env.LETTA_MEM_MIXED_MEMORY,
      shared.mixedMemory === undefined ? undefined : String(shared.mixedMemory),
    ),
    false,
    "混合记忆",
  );
  const sharedMemory = parseBooleanOption(
    firstNonEmpty(
      env.LETTA_MEM_SHARED_MEMORY,
      shared.sharedMemory === undefined ? undefined : String(shared.sharedMemory),
    ),
    true,
    "共享记忆",
  );
  const dataDir = firstNonEmpty(
    env.CLAUDE_PLUGIN_DATA,
    env.PLUGIN_DATA,
    env.LETTA_MEM_DATA_DIR,
  )
    ?? join(homedir(), ".letta-mem", "data", "development");

  return {
    serverUrl,
    ...(authToken ? { authToken } : {}),
    model,
    mixedMemory,
    sharedMemory,
    dataDir,
    namespace: namespaceFor(serverUrl, authToken, mixedMemory),
    requestTimeoutMs: parsePositiveInteger(
      env.LETTA_MEM_REQUEST_TIMEOUT_MS,
      150_000,
    ),
    maxContextChars: parsePositiveInteger(
      env.LETTA_MEM_MAX_CONTEXT_CHARS,
      8_000,
    ),
    maxBatchChars: parsePositiveInteger(
      env.LETTA_MEM_MAX_BATCH_CHARS,
      80_000,
    ),
    disabled: isEnabled(env.LETTA_MEM_DISABLED),
  };
}
