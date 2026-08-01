#!/usr/bin/env node

const { createHash, randomUUID } = require("node:crypto");
const {
  appendFileSync,
  chmodSync,
  copyFileSync,
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
const RUNTIME_ROOT = join(DATA_DIR, "runtime");
const PLUGIN_SDK_ENTRY = join(
  PLUGIN_ROOT,
  "node_modules",
  "@letta-ai",
  "letta-agent-sdk",
  "dist",
  "index.js",
);
const LOG_PATH = join(DATA_DIR, "logs", "letta-mem.log");
const ACTIONS = new Set([
  "session-state",
  "prepare-session-background",
  "prepare-session-worker",
  "prepare-runtime",
  "inject-context",
  "sync-context",
  "update-memory",
  "prepare-runtime-background",
  "update-memory-background",
  "drain-background",
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

function manifestHash() {
  const packageJson = readFileSync(join(PLUGIN_ROOT, "package.json"));
  const packageLock = readFileSync(join(PLUGIN_ROOT, "package-lock.json"));
  return createHash("sha256")
    .update(packageJson)
    .update(packageLock)
    .digest("hex");
}

function runtimePaths(expectedHash) {
  const generation = [
    expectedHash.slice(0, 24),
    process.versions.node,
    process.platform,
    process.arch,
  ].join("-").replace(/[^a-zA-Z0-9._-]/g, "_");
  const runtimeDir = join(RUNTIME_ROOT, generation);
  return {
    runtimeDir,
    installLock: join(DATA_DIR, "locks", `runtime-${generation}.lock`),
    stampPath: join(runtimeDir, ".letta-mem-runtime.json"),
    sdkEntry: join(
      runtimeDir,
      "node_modules",
      "@letta-ai",
      "letta-agent-sdk",
      "dist",
      "index.js",
    ),
  };
}

async function sdkEntryUsable(entry) {
  if (!existsSync(entry)) return false;
  try {
    await import(`${pathToFileURL(entry).href}?probe=${randomUUID()}`);
    return true;
  } catch {
    return false;
  }
}

async function runtimeReady(paths, expectedHash) {
  try {
    const stamp = JSON.parse(readFileSync(paths.stampPath, "utf8"));
    return stamp.version === 2
      && stamp.manifestHash === expectedHash
      && stamp.node === process.versions.node
      && stamp.platform === process.platform
      && stamp.arch === process.arch
      && await sdkEntryUsable(paths.sdkEntry);
  } catch {
    return false;
  }
}

function pluginRuntimeReady() {
  try {
    const pluginManifest = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"),
    );
    const sdkManifest = JSON.parse(
      readFileSync(
        join(
          PLUGIN_ROOT,
          "node_modules",
          "@letta-ai",
          "letta-agent-sdk",
          "package.json",
        ),
        "utf8",
      ),
    );
    return existsSync(PLUGIN_SDK_ENTRY)
      && pluginManifest.dependencies?.["@letta-ai/letta-agent-sdk"]
        === sdkManifest.version;
  } catch {
    return false;
  }
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

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const { input = "", ...spawnOptions } = options;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      ...spawnOptions,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const collectStdout = (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-12_000);
    };
    const collectStderr = (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-12_000);
    };
    child.stdout.on("data", collectStdout);
    child.stderr.on("data", collectStderr);
    child.stdin.on("error", () => {
      // 子进程提前退出时忽略管道错误，保持故障开放。
    });
    child.on("error", (error) => resolvePromise({
      code: -1,
      stdout: "",
      diagnostics: String(error),
    }));
    child.on("close", (code) => resolvePromise({
      code: code ?? -1,
      stdout,
      diagnostics: `${stdout}${stderr}`,
    }));
    child.stdin.end(input);
  });
}

async function ensureRuntime() {
  if (!nodeIsSupported()) {
    log("runtime-node-unsupported", process.versions.node);
    return null;
  }

  // 宿主可能已为 marketplace 插件准备依赖，优先复用以避免重复安装。
  if (pluginRuntimeReady() && await sdkEntryUsable(PLUGIN_SDK_ENTRY)) {
    return PLUGIN_SDK_ENTRY;
  }

  let expectedHash;
  try {
    expectedHash = manifestHash();
  } catch (error) {
    log("runtime-manifest-missing", error);
    return null;
  }
  const paths = runtimePaths(expectedHash);
  if (await runtimeReady(paths, expectedHash)) return paths.sdkEntry;

  const release = acquireInstallLock(paths.installLock);
  if (!release) {
    log("runtime-install-busy");
    return null;
  }

  try {
    if (await runtimeReady(paths, expectedHash)) return paths.sdkEntry;
    ensurePrivateDirectory(paths.runtimeDir);
    copyFileSync(
      join(PLUGIN_ROOT, "package.json"),
      join(paths.runtimeDir, "package.json"),
    );
    copyFileSync(
      join(PLUGIN_ROOT, "package-lock.json"),
      join(paths.runtimeDir, "package-lock.json"),
    );
    chmodSync(join(paths.runtimeDir, "package.json"), 0o600);
    chmodSync(join(paths.runtimeDir, "package-lock.json"), 0o600);

    const npmArguments = [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ];
    const npmCommand = process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : "npm";
    const npmCommandArguments = process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", ...npmArguments]
      : npmArguments;
    const npmEnvironment = {
      ...process.env,
      npm_config_loglevel: "error",
    };
    delete npmEnvironment.LETTA_APP_SERVER_TOKEN;
    const result = await runCommand(
      npmCommand,
      npmCommandArguments,
      {
        cwd: paths.runtimeDir,
        env: npmEnvironment,
      },
    );
    if (result.code !== 0 || !await sdkEntryUsable(paths.sdkEntry)) {
      log("runtime-install-failed", result.diagnostics);
      return null;
    }

    const temporary = `${paths.stampPath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(
      temporary,
      `${JSON.stringify({
        version: 2,
        manifestHash: expectedHash,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        installedAt: new Date().toISOString(),
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    chmodSync(temporary, 0o600);
    renameSync(temporary, paths.stampPath);
    chmodSync(paths.stampPath, 0o600);
    log("runtime-installed");
    return paths.sdkEntry;
  } catch (error) {
    log("runtime-install-failed", error);
    return null;
  } finally {
    release();
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function runHook(action, input, sdkEntry) {
  const entry = join(PLUGIN_ROOT, "dist", "letta-mem.mjs");
  if (!existsSync(entry)) return "";
  const env = { ...process.env };
  if (sdkEntry) env.LETTA_MEM_SDK_ENTRY = sdkEntry;
  const result = await runCommand(process.execPath, [entry, action], {
    cwd: process.cwd(),
    env,
    input,
  });
  if (result.code !== 0) {
    log("hook-child-failed", `${action} ${result.diagnostics}`);
    return "";
  }
  return result.stdout;
}

function startBackgroundAction(action, input = Buffer.from("")) {
  try {
    const child = spawn(process.execPath, [__filename, action], {
      cwd: process.cwd(),
      env: { ...process.env },
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {
      // 后台进程提前退出时忽略管道错误。
    });
    child.stdin.end(input);
    child.unref();
  } catch (error) {
    log("background-start-failed", error);
  }
}

function startBackgroundDrain() {
  startBackgroundAction("drain-background");
}

async function drainPending() {
  const sdkEntry = await ensureRuntime();
  if (sdkEntry) {
    await runHook("drain-pending", Buffer.from("{}"), sdkEntry);
  }
}

async function main() {
  const action = process.argv[2];
  if (!ACTIONS.has(action)) return;
  if (/^(?:1|true)$/i.test(process.env.LETTA_MEM_DISABLED || "")) return;
  const input = await readStdin();

  if (action === "inject-context" || action === "sync-context") {
    const sdkEntry = await ensureRuntime();
    const output = await runHook(action, input, sdkEntry);
    if (output && Buffer.byteLength(output, "utf8") <= 10_000) {
      process.stdout.write(output);
    } else if (output) {
      log("context-output-too-large");
    }
    return;
  }

  if (action === "session-state") {
    await runHook("session-start", input, null);
    return;
  }

  if (action === "prepare-session-background") {
    startBackgroundAction("prepare-session-worker", input);
    return;
  }

  if (action === "prepare-session-worker") {
    const sdkEntry = await ensureRuntime();
    if (!sdkEntry) return;
    await runHook("prepare-session", input, sdkEntry);
    await runHook("drain-pending", Buffer.from("{}"), sdkEntry);
    return;
  }

  if (action === "prepare-runtime-background") {
    startBackgroundDrain();
    return;
  }

  if (action === "update-memory-background") {
    await runHook("enqueue-memory", input, null);
    startBackgroundDrain();
    return;
  }

  if (action === "drain-background") {
    await drainPending();
    return;
  }

  if (action === "prepare-runtime") {
    await drainPending();
    return;
  }

  await runHook("enqueue-memory", input, null);
  const sdkEntry = await ensureRuntime();
  if (!sdkEntry) return;
  await runHook("drain-pending", Buffer.from("{}"), sdkEntry);
}

main().catch((error) => log("bootstrap-failed", error));
