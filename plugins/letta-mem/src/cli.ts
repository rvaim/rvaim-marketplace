import {
  handleDrainPending,
  handleEnqueueMemory,
  handleInjectContext,
  handleSessionStart,
  handleUpdateMemory,
} from "./hooks.js";
import { readRuntimeConfig } from "./config.js";
import { ensureLocalAppServer } from "./app-server.js";
import { createLogger, errorDetail } from "./logger.js";
import type { HookAction, HookInput } from "./types.js";

async function readInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 2_000_000) throw new Error("Hook 输入超过 2 MB 限制");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function parseAction(value: string | undefined): HookAction | null {
  if (
    value === "session-start"
    || value === "ensure-server"
    || value === "inject-context"
    || value === "enqueue-memory"
    || value === "drain-pending"
    || value === "update-memory"
  ) {
    return value;
  }
  return null;
}

async function main(): Promise<void> {
  let output = "";
  try {
    const action = parseAction(process.argv[2]);
    if (!action) return;
    const config = readRuntimeConfig();
    const log = createLogger(config);
    const input = await readInput();

    if (action === "ensure-server") {
      await ensureLocalAppServer(config, log);
    } else if (action === "session-start") {
      output = await handleSessionStart(config, input);
    } else if (action === "inject-context") {
      output = await handleInjectContext(config, input);
    } else if (action === "enqueue-memory") {
      output = await handleEnqueueMemory(config, input, log);
    } else if (action === "drain-pending") {
      output = await handleDrainPending(config, log);
    } else {
      output = await handleUpdateMemory(config, input, log);
    }
  } catch (error) {
    try {
      const config = readRuntimeConfig();
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      createLogger(config)("error", "hook-failed", detail);
    } catch {
      // 配置或日志本身失败时也必须静默放行。
    }
  }

  if (output) process.stdout.write(output);
}

await main();

// SDK 初始化异常可能遗留 App Server 句柄；业务完成后强制兜底退出。
const exitTimer = setTimeout(() => process.exit(0), 50);
exitTimer.unref();
