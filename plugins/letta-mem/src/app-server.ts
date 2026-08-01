import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { acquireLock } from "./state.js";
import type { LogFunction, RuntimeConfig } from "./types.js";

const STARTUP_TIMEOUT_MS = 15_000;
const READY_PROBE_TIMEOUT_MS = 750;
const READY_POLL_INTERVAL_MS = 100;
const MAX_SERVER_LOG_BYTES = 1_000_000;
const SUPPORTED_APP_SERVER_PROTOCOL = 1;

interface AppServerInfo {
  type?: string;
  request_id?: string;
  success?: boolean;
  backend?: string;
  letta_code_version?: string;
  protocol_version?: number;
  capabilities?: {
    agent_management?: boolean;
    conversation_management?: boolean;
    memory_management?: boolean;
    runtime_start?: boolean;
    split_channels?: boolean;
  };
}

export type AppServerEnsureResult =
  | "ready"
  | "started"
  | "skipped"
  | "failed";

interface AppServerLaunch {
  pid?: number;
  exited: Promise<string>;
}

export interface AppServerDependencies {
  probeReady: (serverUrl: string, timeoutMs: number) => Promise<boolean>;
  resolveLettaCodeEntry: () => string | null;
  launch: (
    entry: string,
    listenUrl: string,
  ) => AppServerLaunch;
  acquireLock: (path: string) => (() => void) | null;
  delay: (milliseconds: number) => Promise<void>;
  startupTimeoutMs: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function automaticListenUrl(config: RuntimeConfig): string | null {
  if (!config.autoStartServer || config.authToken) return null;
  const parsed = new URL(config.serverUrl);
  const hostname = parsed.hostname.toLowerCase();
  const loopback = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
  if (parsed.protocol !== "http:" || !loopback || !parsed.port) return null;
  return `ws://${parsed.host}`;
}

async function probeReady(
  serverUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/app-server-info`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) return false;
    const info = await response.json() as AppServerInfo;
    return info.type === "app_server_info_response"
      && typeof info.request_id === "string"
      && info.request_id.length > 0
      && info.success === true
      && (info.backend === "local" || info.backend === "api")
      && typeof info.letta_code_version === "string"
      && info.protocol_version === SUPPORTED_APP_SERVER_PROTOCOL
      && info.capabilities?.agent_management === true
      && info.capabilities.conversation_management === true
      && info.capabilities.memory_management === true
      && info.capabilities.runtime_start === true
      && info.capabilities.split_channels === false;
  } catch {
    return false;
  }
}

function resolveLettaCodeEntry(): string | null {
  const configured = process.env.LETTA_MEM_LETTA_CODE_ENTRY?.trim();
  if (configured) {
    const entry = isAbsolute(configured) ? configured : resolve(configured);
    return existsSync(entry) ? entry : null;
  }

  const requireBases: string[] = [];
  const sdkEntry = process.env.LETTA_MEM_SDK_ENTRY?.trim();
  if (sdkEntry && isAbsolute(sdkEntry)) {
    requireBases.push(pathToFileURL(sdkEntry).href);
  }
  requireBases.push(import.meta.url);

  for (const base of requireBases) {
    try {
      const entry = createRequire(base).resolve("@letta-ai/letta-code");
      if (existsSync(entry)) return entry;
    } catch {
      // 当前运行时没有配套入口时继续尝试下一个解析基点。
    }
  }
  return null;
}

function serverRuntimeRoot(): string {
  return join(homedir(), ".letta-mem", "server");
}

function serverLockPath(serverUrl: string): string {
  const digest = createHash("sha256")
    .update(serverUrl)
    .digest("hex")
    .slice(0, 24);
  return join(serverRuntimeRoot(), "locks", `app-server-${digest}.lock`);
}

function serverLogPath(): string {
  return join(serverRuntimeRoot(), "logs", "app-server.log");
}

function prepareServerLog(): string {
  const path = serverLogPath();
  const directory = join(serverRuntimeRoot(), "logs");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  try {
    if (existsSync(path) && statSync(path).size >= MAX_SERVER_LOG_BYTES) {
      renameSync(path, `${path}.1`);
      chmodSync(`${path}.1`, 0o600);
    }
  } catch {
    // 日志轮转失败不应阻止本地服务启动。
  }
  return path;
}

function launch(
  entry: string,
  listenUrl: string,
): AppServerLaunch {
  const logPath = prepareServerLog();
  const descriptor = openSync(logPath, "a", 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    const excludedEnvironmentKeys = new Set([
      "LETTA_APP_SERVER_TOKEN",
      "LETTA_MEM_SDK_ENTRY",
      "LETTA_MEM_LETTA_CODE_ENTRY",
    ]);
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !excludedEnvironmentKeys.has(key),
      ),
    );
    child = spawn(
      process.execPath,
      [
        entry,
        "server",
        "--listen",
        listenUrl,
      ],
      {
        cwd: homedir(),
        detached: true,
        env: environment,
        shell: false,
        stdio: ["ignore", descriptor, descriptor],
        windowsHide: true,
      },
    );
  } finally {
    closeSync(descriptor);
  }
  chmodSync(logPath, 0o600);

  const exited = new Promise<string>((resolvePromise) => {
    child.once("error", (error) => {
      resolvePromise(`无法创建进程：${error.message}`);
    });
    child.once("exit", (code, signal) => {
      resolvePromise(
        `进程提前退出：code=${String(code)} signal=${String(signal)}`,
      );
    });
  });
  child.unref();
  return {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    exited,
  };
}

const DEFAULT_DEPENDENCIES: AppServerDependencies = {
  probeReady,
  resolveLettaCodeEntry,
  launch,
  acquireLock,
  delay,
  startupTimeoutMs: STARTUP_TIMEOUT_MS,
};

async function waitUntilReady(
  serverUrl: string,
  dependencies: AppServerDependencies,
  launched: AppServerLaunch | null,
): Promise<{ ready: boolean; exitDetail?: string }> {
  const deadline = Date.now() + dependencies.startupTimeoutMs;
  let exitDetail: string | undefined;
  launched?.exited.then((detail) => {
    exitDetail = detail;
  }).catch((error) => {
    exitDetail = String(error);
  });

  while (Date.now() < deadline) {
    if (await dependencies.probeReady(
      serverUrl,
      READY_PROBE_TIMEOUT_MS,
    )) {
      return { ready: true };
    }
    if (exitDetail) return { ready: false, exitDetail };
    await dependencies.delay(READY_POLL_INTERVAL_MS);
  }
  return { ready: false, ...(exitDetail ? { exitDetail } : {}) };
}

export async function ensureLocalAppServer(
  config: RuntimeConfig,
  log: LogFunction,
  overrides: Partial<AppServerDependencies> = {},
): Promise<AppServerEnsureResult> {
  const listenUrl = automaticListenUrl(config);
  if (!listenUrl) return "skipped";
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };

  try {
    if (await dependencies.probeReady(
      config.serverUrl,
      READY_PROBE_TIMEOUT_MS,
    )) {
      return "ready";
    }

    const release = dependencies.acquireLock(serverLockPath(config.serverUrl));
    if (!release) {
      const waited = await waitUntilReady(
        config.serverUrl,
        dependencies,
        null,
      );
      if (waited.ready) return "ready";
      log("warn", "app-server-start-busy-timeout", config.serverUrl);
      return "failed";
    }

    try {
      if (await dependencies.probeReady(
        config.serverUrl,
        READY_PROBE_TIMEOUT_MS,
      )) {
        return "ready";
      }
      const entry = dependencies.resolveLettaCodeEntry();
      if (!entry) {
        log("warn", "app-server-entry-missing");
        return "failed";
      }

      const launched = dependencies.launch(
        entry,
        listenUrl,
      );
      log(
        "info",
        "app-server-starting",
        `${listenUrl}${launched.pid ? ` pid=${launched.pid}` : ""}`,
      );
      const waited = await waitUntilReady(
        config.serverUrl,
        dependencies,
        launched,
      );
      if (waited.ready) {
        log("info", "app-server-started", listenUrl);
        return "started";
      }
      log(
        "warn",
        "app-server-start-failed",
        waited.exitDetail ?? `等待 ${dependencies.startupTimeoutMs}ms 后仍未就绪`,
      );
      return "failed";
    } finally {
      release();
    }
  } catch (error) {
    log(
      "warn",
      "app-server-start-failed",
      error instanceof Error ? error.message : String(error),
    );
    return "failed";
  }
}
