import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HookInput } from "./types.js";

const MAX_CONVERSATION_TITLE_CHARS = 200;

export type ConversationTitleSource = "hook" | "codex" | "prompt";

export interface ResolvedConversationTitle {
  value: string;
  source: ConversationTitleSource;
}

function normalizedTitle(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return Array.from(normalized)
    .slice(0, MAX_CONVERSATION_TITLE_CHARS)
    .join("");
}

function codexDataDirectories(): string[] {
  const configured = process.env.CODEX_HOME?.trim();
  const defaultDirectory = join(homedir(), ".codex");
  return [...new Set([
    ...(configured ? [configured] : []),
    defaultDirectory,
  ])];
}

export function readCodexConversationTitle(
  sessionId: string,
  dataDirectories: string[] = codexDataDirectories(),
): string | undefined {
  for (const directory of dataDirectories) {
    for (const databasePath of [
      join(directory, "state_5.sqlite"),
      join(directory, "sqlite", "state_5.sqlite"),
    ]) {
      if (!existsSync(databasePath)) continue;
      let database: DatabaseSync | undefined;
      try {
        database = new DatabaseSync(databasePath, {
          readOnly: true,
          timeout: 100,
        });
        const row = database.prepare(
          "SELECT title, name FROM threads WHERE id = ? LIMIT 1",
        ).get(sessionId) as {
          title?: unknown;
          name?: unknown;
        } | undefined;
        const title = normalizedTitle(
          typeof row?.name === "string" && row.name.trim()
            ? row.name
            : typeof row?.title === "string"
              ? row.title
              : undefined,
        );
        if (title) return title;
      } catch {
        // Codex 状态库不可用时继续尝试其他位置或首条消息回退。
      } finally {
        try {
          database?.close();
        } catch {
          // 只读查询已经结束，关闭失败不应阻断记忆 Hook。
        }
      }
    }
  }
  return undefined;
}

export function resolveConversationTitle(
  input: HookInput,
): ResolvedConversationTitle | undefined {
  const hookTitle = normalizedTitle(
    input.thread_title ?? input.conversation_title ?? input.title,
  );
  if (hookTitle) return { value: hookTitle, source: "hook" };

  const sessionId = input.session_id?.trim();
  if (sessionId) {
    const codexTitle = readCodexConversationTitle(sessionId);
    if (codexTitle) return { value: codexTitle, source: "codex" };
  }

  const promptTitle = normalizedTitle(input.prompt);
  return promptTitle
    ? { value: promptTitle, source: "prompt" }
    : undefined;
}
