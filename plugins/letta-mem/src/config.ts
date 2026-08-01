import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeConfig } from "./types.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:4500";

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
): string {
  const authScope = authToken ? `token:${authToken}` : "token:none";
  const source = `per-workspace-v1:app-server:${serverUrl}:${authScope}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 20);
}

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function readRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const serverUrl = normalizeServerUrl(firstNonEmpty(
    env.CLAUDE_PLUGIN_OPTION_LETTA_SERVER_URL,
    env.LETTA_APP_SERVER_URL,
  ) ?? DEFAULT_SERVER_URL);
  const authToken = firstNonEmpty(
    env.CLAUDE_PLUGIN_OPTION_LETTA_AUTH_TOKEN,
    env.LETTA_APP_SERVER_TOKEN,
  );
  const dataDir = firstNonEmpty(env.CLAUDE_PLUGIN_DATA, env.LETTA_MEM_DATA_DIR)
    ?? join(homedir(), ".claude", "plugins", "data", "letta-mem-development");

  return {
    serverUrl,
    ...(authToken ? { authToken } : {}),
    dataDir,
    namespace: namespaceFor(serverUrl, authToken),
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
