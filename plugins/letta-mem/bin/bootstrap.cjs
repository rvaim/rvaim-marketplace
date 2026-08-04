#!/usr/bin/env node

const { randomUUID } = require("node:crypto");
const {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const PLUGIN_ROOT = resolve(__dirname, "..");
const DATA_DIR = process.env.CLAUDE_PLUGIN_DATA
  || process.env.PLUGIN_DATA
  || process.env.LETTA_MEM_DATA_DIR
  || join(homedir(), ".letta-mem", "data", "development");
const LOG_PATH = join(DATA_DIR, "logs", "letta-mem.log");
const WINDOWS_PROCESS_LAUNCHER = join(
  PLUGIN_ROOT,
  "bin",
  "letta-mem-launcher.exe",
);
const ACTIONS = new Set([
  "prepare-session-background",
  "prepare-session-worker",
  "inject-context",
  "sync-context",
  "update-memory-background",
  "drain-background",
  "mcp",
]);
const LOCK_STALE_MS = 15 * 60 * 1_000;
const LOCK_HEARTBEAT_MS = 30 * 1_000;

function sanitize(value) {
  let sanitized = String(value);
  for (const secret of [
    process.env.LETTA_APP_SERVER_TOKEN,
  ]) {
    if (secret) sanitized = sanitized.split(secret).join("[已隐藏]");
  }
  return sanitized
    .replace(/[\r\n]+/g, " ")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/(_authToken\s*[=:]\s*)\S+/gi, "$1[已隐藏]")
    .slice(0, 1_000);
}

function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // 权限修复失败时仍由外层故障开放处理。
  }
}

function log(event, detail = "") {
  try {
    ensurePrivateDirectory(dirname(LOG_PATH));
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size >= 1_000_000) {
      renameSync(LOG_PATH, `${LOG_PATH}.1`);
      chmodSync(`${LOG_PATH}.1`, 0o600);
    }
    const suffix = detail ? ` ${sanitize(detail)}` : "";
    appendFileSync(
      LOG_PATH,
      `${new Date().toISOString()} INFO ${sanitize(event)}${suffix}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    chmodSync(LOG_PATH, 0o600);
  } catch {
    // 引导日志失败不能影响编码宿主。
  }
}

function nodeIsSupported() {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((value) => Number.parseInt(value, 10));
  return major > 22 || (major === 22 && minor >= 19);
}

function acquireInstallLock(lockPath) {
  ensurePrivateDirectory(dirname(lockPath));
  try {
    if (existsSync(lockPath)) {
      const lockStat = statSync(lockPath);
      if (!lockStat.isDirectory()) {
        if (Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) return null;
        unlinkSync(lockPath);
      }
    }
    if (existsSync(lockPath)) {
      const ownerNames = readdirSync(lockPath)
        .filter((name) => name.startsWith("owner-"));
      const heartbeatPath = ownerNames.length === 1
        ? join(lockPath, ownerNames[0] || "")
        : lockPath;
      if (Date.now() - statSync(heartbeatPath).mtimeMs > LOCK_STALE_MS) {
        for (const ownerName of ownerNames) {
          try {
            unlinkSync(join(lockPath, ownerName));
          } catch {
            // 其他进程可能已开始清理同一个过期锁。
          }
        }
        try {
          rmdirSync(lockPath);
        } catch {
          // 非空目录表示已有新所有者，不得继续清理。
        }
      }
    }
  } catch {
    return null;
  }

  const token = randomUUID();
  const ownerPath = join(lockPath, `owner-${token}`);
  const owner = `${process.pid} ${Date.now()} ${token}\n`;
  let createdDirectory = false;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    createdDirectory = true;
    const descriptor = openSync(ownerPath, "wx", 0o600);
    try {
      writeFileSync(descriptor, owner, "utf8");
    } finally {
      closeSync(descriptor);
    }
    chmodSync(lockPath, 0o700);
    chmodSync(ownerPath, 0o600);
    const heartbeat = setInterval(() => {
      try {
        if (readFileSync(ownerPath, "utf8") !== owner) {
          clearInterval(heartbeat);
          return;
        }
        const now = new Date();
        utimesSync(ownerPath, now, now);
      } catch {
        clearInterval(heartbeat);
      }
    }, LOCK_HEARTBEAT_MS);
    heartbeat.unref();
    return () => {
      clearInterval(heartbeat);
      try {
        if (readFileSync(ownerPath, "utf8") !== owner) return;
        unlinkSync(ownerPath);
        try {
          rmdirSync(lockPath);
        } catch {
          // 新所有者已建立标记时，锁目录必须保留。
        }
      } catch {
        // 锁已被清理或接管时不得删除其他进程的锁。
      }
    };
  } catch {
    try {
      unlinkSync(ownerPath);
    } catch {
      // 所有者标记尚未创建时无需处理。
    }
    if (createdDirectory) {
      try {
        rmdirSync(lockPath);
      } catch {
        // 非空目录属于其他所有者。
      }
    }
    return null;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

let hookRuntimePromise;

async function runHook(action, input) {
  const entry = join(PLUGIN_ROOT, "dist", "letta-mem-hook-runtime.mjs");
  if (!existsSync(entry)) {
    throw new Error(`Hook runtime is missing: ${entry}`);
  }
  hookRuntimePromise ||= import(pathToFileURL(entry).href);
  const runtime = await hookRuntimePromise;
  if (typeof runtime.executeHookAction !== "function") {
    throw new Error("Hook runtime does not export executeHookAction");
  }
  return runtime.executeHookAction(action, input);
}

function startBackgroundAction(action, input = Buffer.from("")) {
  try {
    const command = process.platform === "win32"
      ? WINDOWS_PROCESS_LAUNCHER
      : process.execPath;
    const childArguments = process.platform === "win32"
      ? [action]
      : [__filename, action];
    const child = spawn(command, childArguments, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(process.platform === "win32"
          ? { LETTA_MEM_NODE_PATH: process.execPath }
          : {}),
      },
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {
      // 后台进程提前退出时忽略管道错误。
    });
    child.stdin.end(input);
    child.stdin.unref();
    child.unref();
  } catch (error) {
    log("background-start-failed", error);
  }
}

function startBackgroundDrain() {
  startBackgroundAction("drain-background");
}

function nextPendingRetryAt() {
  const stateRoot = join(DATA_DIR, "state");
  if (!existsSync(stateRoot)) return null;
  let selected = null;
  try {
    for (const namespaceName of readdirSync(stateRoot)) {
      const namespacePath = join(stateRoot, namespaceName);
      const failurePath = join(namespacePath, "failures.json");
      const pendingPath = join(namespacePath, "pending");
      if (!existsSync(pendingPath) || readdirSync(pendingPath).length === 0) {
        continue;
      }
      const candidates = [];
      if (existsSync(failurePath)) {
        const failure = JSON.parse(readFileSync(failurePath, "utf8"));
        if (typeof failure.retryAfter === "string") {
          candidates.push(failure.retryAfter);
        }
      }
      for (const name of readdirSync(pendingPath)) {
        try {
          const pending = JSON.parse(
            readFileSync(join(pendingPath, name), "utf8"),
          );
          if (typeof pending.retryAfter === "string") {
            candidates.push(pending.retryAfter);
          }
        } catch {
          // 单个待处理项损坏时交给正式状态读取路径处理。
        }
      }
      for (const value of candidates) {
        const timestamp = Date.parse(value);
        if (
          Number.isFinite(timestamp)
          && timestamp > Date.now()
          && (selected === null || timestamp < selected)
        ) {
          selected = timestamp;
        }
      }
    }
  } catch (error) {
    log("retry-scan-failed", error);
  }
  return selected;
}

async function waitForRetry(timestamp) {
  const delayMs = Math.max(0, Math.min(timestamp - Date.now(), 5 * 60_000));
  if (delayMs > 0) {
    log("retry-worker-scheduled", new Date(timestamp).toISOString());
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }
}

async function drainPending() {
  const release = acquireInstallLock(join(DATA_DIR, "locks", "drain-worker.lock"));
  if (!release) {
    log("drain-worker-busy");
    return;
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runHook("drain-pending", Buffer.from("{}"));
      const retryAt = nextPendingRetryAt();
      if (retryAt === null || attempt > 0) return;
      await waitForRetry(retryAt);
    }
  } finally {
    release();
  }
}

async function runMcpServer() {
  const entry = join(PLUGIN_ROOT, "dist", "letta-mem-mcp.mjs");
  if (!existsSync(entry)) {
    log("mcp-entry-unavailable");
    process.exitCode = 1;
    return;
  }
  await import(pathToFileURL(entry).href);
}

async function main() {
  const action = process.argv[2];
  if (!ACTIONS.has(action)) return;
  if (!nodeIsSupported()) {
    log("runtime-node-unsupported", process.versions.node);
    process.exitCode = 1;
    return;
  }
  if (action === "mcp") {
    await runMcpServer();
    return;
  }
  if (/^(?:1|true)$/i.test(process.env.LETTA_MEM_DISABLED || "")) return;
  const input = await readStdin();

  if (action === "inject-context" || action === "sync-context") {
    const output = await runHook(action, input);
    if (output && Buffer.byteLength(output, "utf8") <= 10_000) {
      process.stdout.write(output);
    } else if (output) {
      log("context-output-too-large");
    }
    if (action === "inject-context") startBackgroundDrain();
    return;
  }

  if (action === "prepare-session-background") {
    startBackgroundAction("prepare-session-worker", input);
    return;
  }

  if (action === "prepare-session-worker") {
    await runHook("session-start", input);
    await runHook("prepare-session", input);
    await runHook("drain-pending", Buffer.from("{}"));
    return;
  }

  if (action === "update-memory-background") {
    await runHook("enqueue-memory", input);
    if (process.platform !== "win32") startBackgroundDrain();
    return;
  }

  if (action === "drain-background") {
    await drainPending();
    return;
  }
}

main().then(() => {
  if (process.argv[2] === "mcp") return;
  const exitTimer = setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  exitTimer.unref();
}).catch((error) => {
  log("bootstrap-failed", error);
  process.stderr.write(`Letta memory bootstrap failed: ${sanitize(error)}\n`);
  process.exitCode = 1;
  const exitTimer = setTimeout(() => process.exit(1), 50);
  exitTimer.unref();
});
