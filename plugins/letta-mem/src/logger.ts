import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { LogFunction, RuntimeConfig } from "./types.js";

const MAX_LOG_BYTES = 1_000_000;

function sanitize(value: string, secrets: string[]): string {
  let sanitized = value;
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join("[已隐藏]");
  }
  return sanitized
    .replace(/[\r\n]+/g, " ")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/(_authToken\s*[=:]\s*)\S+/gi, "$1[已隐藏]")
    .slice(0, 800);
}

function rotateIfNeeded(logPath: string): void {
  try {
    if (existsSync(logPath) && statSync(logPath).size >= MAX_LOG_BYTES) {
      renameSync(logPath, `${logPath}.1`);
      chmodSync(`${logPath}.1`, 0o600);
    }
  } catch {
    // 日志轮转失败不能影响 Claude Code。
  }
}

export function createLogger(config: RuntimeConfig): LogFunction {
  const logPath = join(config.dataDir, "logs", "letta-mem.log");
  const secrets = config.authToken ? [config.authToken] : [];

  return (level, event, detail = "") => {
    try {
      mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
      chmodSync(dirname(logPath), 0o700);
      rotateIfNeeded(logPath);
      const suffix = detail ? ` ${sanitize(detail, secrets)}` : "";
      appendFileSync(
        logPath,
        `${new Date().toISOString()} ${level.toUpperCase()} ${sanitize(event, secrets)}${suffix}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      chmodSync(logPath, 0o600);
    } catch {
      // 任何日志错误都必须静默忽略。
    }
  };
}

export function errorDetail(
  error: Error | string | number | boolean | object | null | undefined,
): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
