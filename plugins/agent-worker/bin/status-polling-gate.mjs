export const STATUS_POLL_INTERVAL_MS = 300_000;

const STATUS_TOOLS = new Set(["get_worker_status", "watch_worker"]);
const GLOBAL_GATE_KEY = "__global__";

function normalizeTaskId(args) {
  if (!args || typeof args !== "object") return GLOBAL_GATE_KEY;
  const value = args.task_id ?? args.taskId;
  if (typeof value === "string" && value.trim()) return value.trim();
  return GLOBAL_GATE_KEY;
}

export function extractToolCall(message) {
  if (!message || typeof message !== "object") return null;
  if (message.method !== "tools/call") return null;

  const params = message.params;
  if (!params || typeof params !== "object") return null;
  if (typeof params.name !== "string" || !params.name) return null;

  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  return {
    name: params.name,
    args,
  };
}

export class StatusPollingGate {
  constructor({ intervalMs = STATUS_POLL_INTERVAL_MS, now = Date.now } = {}) {
    this.intervalMs = intervalMs;
    this.now = now;
    this.nextAllowedAtByTask = new Map();
  }

  observeToolCall(name, args = {}) {
    if (name === "run_worker" && args.no_wait === true) {
      const taskId = normalizeTaskId(args);
      this.nextAllowedAtByTask.set(taskId, this.now() + this.intervalMs);
      return 0;
    }

    if (!STATUS_TOOLS.has(name)) return 0;

    const taskId = normalizeTaskId(args);
    const now = this.now();
    const nextAllowedAt = this.nextAllowedAtByTask.get(taskId) ?? now;
    const waitMs = Math.max(0, nextAllowedAt - now);
    const forwardedAt = now + waitMs;
    this.nextAllowedAtByTask.set(taskId, forwardedAt + this.intervalMs);
    return waitMs;
  }

  observeMessage(message) {
    const toolCall = extractToolCall(message);
    if (!toolCall) return { waitMs: 0, toolName: null, taskId: null };

    const waitMs = this.observeToolCall(toolCall.name, toolCall.args);
    return {
      waitMs,
      toolName: toolCall.name,
      taskId: normalizeTaskId(toolCall.args),
    };
  }
}
