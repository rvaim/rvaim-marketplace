import {
  handleDrainPending,
  handleEnqueueMemory,
  handleInjectContext,
  handlePrepareSession,
  handleSessionStart,
  handleSyncContext,
} from "./hooks.js";
import { readRuntimeConfig } from "./config.js";
import { formatHookSystemMessage } from "./context.js";
import { isLettaSetupError } from "./app-server.js";
import { createLogger, errorDetail } from "./logger.js";
import type { HookAction, HookInput } from "./types.js";

export const MAX_HOOK_INPUT_BYTES = 2_000_000;

function parseAction(value: string | undefined): HookAction | null {
  if (
    value === "session-start"
    || value === "prepare-session"
    || value === "inject-context"
    || value === "sync-context"
    || value === "enqueue-memory"
    || value === "drain-pending"
  ) {
    return value;
  }
  return null;
}

function parseInput(input: Uint8Array): HookInput {
  if (input.byteLength > MAX_HOOK_INPUT_BYTES) {
    throw new Error("Hook 输入超过 2 MB 限制");
  }
  if (input.byteLength === 0) return {};
  const parsed = JSON.parse(Buffer.from(input).toString("utf8")) as HookInput;
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function recoverHookError(error: unknown): string {
  let output = "";
  if (isLettaSetupError(error)) {
    output = formatHookSystemMessage(error.message);
  }
  try {
    const config = readRuntimeConfig();
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    createLogger(config)("error", "hook-failed", detail);
  } catch {
    // 配置或日志本身失败时也必须静默放行。
  }
  return output;
}

export async function executeHookAction(
  actionValue: string | undefined,
  rawInput: Uint8Array,
): Promise<string> {
  let output = "";
  try {
    const action = parseAction(actionValue);
    if (!action) return "";
    const config = readRuntimeConfig();
    const log = createLogger(config);
    const input = parseInput(rawInput);

    if (action === "session-start") {
      output = await handleSessionStart(config, input);
    } else if (action === "prepare-session") {
      output = await handlePrepareSession(config, input, log);
    } else if (action === "inject-context") {
      output = await handleInjectContext(config, input, log);
    } else if (action === "sync-context") {
      output = await handleSyncContext(config, input, log);
    } else if (action === "enqueue-memory") {
      output = await handleEnqueueMemory(config, input, log);
    } else {
      output = await handleDrainPending(config, log);
    }
  } catch (error) {
    output = recoverHookError(error);
  }

  return output;
}
