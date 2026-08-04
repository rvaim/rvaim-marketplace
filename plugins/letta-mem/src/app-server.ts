import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireLock } from "./state.js";
import type { LogFunction, RuntimeConfig } from "./types.js";

const STARTUP_TIMEOUT_MS = 20_000;
const READY_PROBE_TIMEOUT_MS = 1_000;
const READY_POLL_INTERVAL_MS = 150;
const MAX_SERVER_LOG_BYTES = 1_000_000;
const SUPPORTED_APP_SERVER_PROTOCOL = 1;
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_PROCESS_LAUNCHER = join(
  PLUGIN_ROOT,
  "bin",
  "letta-mem-launcher.exe",
);
const WINDOWS_CHILD_PROCESS_PRELOAD = join(
  PLUGIN_ROOT,
  "bin",
  "stdio-preload.cjs",
);

interface AppServerInfo {
  type?: string;
  request_id?: string;
  success?: boolean;
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

interface LettaCommand {
  command: string;
  argsPrefix: string[];
  displayName: string;
}

interface ServerProbe {
  ready: boolean;
  incompatible?: string;
}

interface AppServerLaunch {
  pid?: number;
  exited: Promise<string>;
}

export type AppServerEnsureResult = "ready" | "started" | "skipped";

export class LettaSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LettaSetupError";
  }
}

export function isLettaSetupError(error: unknown): error is LettaSetupError {
  return error instanceof LettaSetupError
    || (
      error instanceof Error
      && error.name === "LettaSetupError"
    );
}

export interface AppServerDependencies {
  probe: (serverUrl: string, timeoutMs: number) => Promise<ServerProbe>;
  resolveLettaCommand: () => LettaCommand | null;
  launch: (command: LettaCommand, listenUrl: string) => AppServerLaunch;
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

async function probeAppServer(
  serverUrl: string,
  timeoutMs: number,
): Promise<ServerProbe> {
  try {
    const response = await fetch(`${serverUrl}/app-server-info`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) return { ready: false };
    const info = await response.json() as AppServerInfo;
    const protocolCompatible = info.type === "app_server_info_response"
      && typeof info.request_id === "string"
      && info.request_id.length > 0
      && info.success === true
      && typeof info.letta_code_version === "string"
      && info.protocol_version === SUPPORTED_APP_SERVER_PROTOCOL
      && info.capabilities?.agent_management === true
      && info.capabilities.conversation_management === true
      && info.capabilities.memory_management === true
      && info.capabilities.runtime_start === true
      && info.capabilities.split_channels === false;
    if (protocolCompatible) return { ready: true };
    return {
      ready: false,
      incompatible: `端口上的服务不是兼容的 Letta App Server（协议版本 ${String(info.protocol_version ?? "未知")}）`,
    };
  } catch {
    return { ready: false };
  }
}

export function commandFromPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): LettaCommand | null {
  const extension = extname(path).toLowerCase();
  if (
    platform === "win32"
    && ["", ".cmd", ".bat", ".ps1"].includes(extension)
  ) {
    const npmPrefix = dirname(path);
    const cliEntry = join(
      npmPrefix,
      "node_modules",
      "@letta-ai",
      "letta-code",
      "letta.js",
    );
    if (!existsSync(cliEntry)) return null;
    const bundledNode = join(npmPrefix, "node.exe");
    return {
      command: existsSync(bundledNode) ? bundledNode : process.execPath,
      argsPrefix: [cliEntry],
      displayName: cliEntry,
    };
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return {
      command: process.execPath,
      argsPrefix: [path],
      displayName: path,
    };
  }
  if (platform === "win32" && ![".exe", ".com"].includes(extension)) {
    return null;
  }
  return {
    command: path,
    argsPrefix: [],
    displayName: path,
  };
}

function commandCandidates(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const key = Object.keys(environment)
    .find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key ? environment[key] : undefined;
}

export function findWindowsCommandsOnPath(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const pathValue = environmentValue(environment, "PATH") ?? "";
  const configuredExtensions = (environmentValue(environment, "PATHEXT")
    ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const extensions = Array.from(new Set([
    ...configuredExtensions,
    ".cmd",
    ".bat",
    ".ps1",
    "",
  ]));
  const candidates: string[] = [];
  for (const rawDirectory of pathValue.split(";")) {
    const directory = rawDirectory.trim().replace(/^"|"$/g, "");
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (existsSync(candidate) && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function resolveLettaCommand(): LettaCommand | null {
  const configured = process.env.LETTA_MEM_LETTA_COMMAND?.trim();
  if (configured) {
    const path = isAbsolute(configured) ? configured : resolve(configured);
    return existsSync(path) ? commandFromPath(path) : null;
  }

  if (process.platform === "win32") {
    for (const path of findWindowsCommandsOnPath("letta")) {
      const command = commandFromPath(path);
      if (command) return command;
    }
    return null;
  }

  const locator = "which";
  const result = spawnSync(locator, ["letta"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  for (const path of commandCandidates(result.stdout)) {
    if (!existsSync(path)) continue;
    const command = commandFromPath(path);
    if (command) return command;
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

export function appServerLogPath(): string {
  return join(serverRuntimeRoot(), "logs", "app-server.log");
}

function prepareServerLog(): string {
  const path = appServerLogPath();
  const directory = join(serverRuntimeRoot(), "logs");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
    if (existsSync(path) && statSync(path).size >= MAX_SERVER_LOG_BYTES) {
      renameSync(path, `${path}.1`);
      chmodSync(`${path}.1`, 0o600);
    }
  } catch {
    // 日志权限或轮转失败不阻止服务启动。
  }
  return path;
}

function launchAppServer(
  executable: LettaCommand,
  listenUrl: string,
): AppServerLaunch {
  const logPath = prepareServerLog();
  const descriptor = openSync(logPath, "a", 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    const environment = { ...process.env };
    delete environment.LETTA_APP_SERVER_TOKEN;
    delete environment.LETTA_MEM_LETTA_COMMAND;
    if (process.platform === "win32") {
      environment.LETTA_MEM_NODE_PATH = process.execPath;
      environment.LETTA_MEM_HIDE_CHILD_WINDOWS = "1";
    }
    const nodeArguments = process.platform === "win32"
      && basename(executable.command).toLowerCase() === "node.exe"
      ? ["--require", WINDOWS_CHILD_PROCESS_PRELOAD]
      : [];
    const serverArguments = [
      ...nodeArguments,
      ...executable.argsPrefix,
      "--backend",
      "local",
      "server",
      "--listen",
      listenUrl,
    ];
    if (process.platform === "win32" && !existsSync(WINDOWS_PROCESS_LAUNCHER)) {
      throw new Error(
        `Windows 静默启动器缺失：${WINDOWS_PROCESS_LAUNCHER}`,
      );
    }
    const command = process.platform === "win32"
      ? WINDOWS_PROCESS_LAUNCHER
      : executable.command;
    const args = process.platform === "win32"
      ? ["--exec", executable.command, ...serverArguments]
      : serverArguments;
    child = spawn(
      command,
      args,
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
  try {
    chmodSync(logPath, 0o600);
  } catch {
    // Windows ACL 不支持 POSIX mode 时忽略。
  }

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
  probe: probeAppServer,
  resolveLettaCommand,
  launch: launchAppServer,
  acquireLock,
  delay,
  startupTimeoutMs: STARTUP_TIMEOUT_MS,
};

async function waitUntilReady(
  serverUrl: string,
  dependencies: AppServerDependencies,
  launched: AppServerLaunch | null,
): Promise<ServerProbe & { exitDetail?: string }> {
  const deadline = Date.now() + dependencies.startupTimeoutMs;
  let exitDetail: string | undefined;
  launched?.exited.then((detail) => {
    exitDetail = detail;
  }).catch((error) => {
    exitDetail = String(error);
  });

  while (Date.now() < deadline) {
    const probe = await dependencies.probe(
      serverUrl,
      READY_PROBE_TIMEOUT_MS,
    );
    if (probe.ready || probe.incompatible) return probe;
    if (exitDetail) return { ready: false, exitDetail };
    await dependencies.delay(READY_POLL_INTERVAL_MS);
  }
  return { ready: false, ...(exitDetail ? { exitDetail } : {}) };
}

function installMessage(): string {
  return "未检测到 Letta Code CLI。请先执行 npm install -g @letta-ai/letta-code，然后运行 letta 完成模型配置。";
}

export async function ensureAppServer(
  config: RuntimeConfig,
  log: LogFunction,
  overrides: Partial<AppServerDependencies> = {},
): Promise<AppServerEnsureResult> {
  const listenUrl = automaticListenUrl(config);
  if (!listenUrl) return "skipped";
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const executable = dependencies.resolveLettaCommand();
  if (!executable) {
    log("error", "letta-cli-missing");
    throw new LettaSetupError(installMessage());
  }

  const initialProbe = await dependencies.probe(
    config.serverUrl,
    READY_PROBE_TIMEOUT_MS,
  );
  if (initialProbe.ready) return "ready";
  if (initialProbe.incompatible) {
    throw new LettaSetupError(initialProbe.incompatible);
  }

  const release = dependencies.acquireLock(serverLockPath(config.serverUrl));
  if (!release) {
    const waited = await waitUntilReady(config.serverUrl, dependencies, null);
    if (waited.ready) return "ready";
    throw new LettaSetupError(
      waited.incompatible
        ?? `其他进程启动 Letta App Server 超时，请检查 ${appServerLogPath()}`,
    );
  }

  try {
    const afterLock = await dependencies.probe(
      config.serverUrl,
      READY_PROBE_TIMEOUT_MS,
    );
    if (afterLock.ready) return "ready";
    if (afterLock.incompatible) {
      throw new LettaSetupError(afterLock.incompatible);
    }

    const launched = dependencies.launch(executable, listenUrl);
    log(
      "info",
      "app-server-starting",
      `${basename(executable.displayName)} ${listenUrl}${launched.pid ? ` pid=${launched.pid}` : ""}`,
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
    const detail = waited.incompatible
      ?? waited.exitDetail
      ?? `等待 ${dependencies.startupTimeoutMs}ms 后仍未就绪`;
    log("error", "app-server-start-failed", detail);
    throw new LettaSetupError(
      `Letta App Server 启动失败：${detail}。日志：${appServerLogPath()}`,
    );
  } finally {
    release();
  }
}
