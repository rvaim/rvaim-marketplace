import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  readCodexConversationTitle,
  resolveConversationTitle,
} from "../src/conversation-title.js";

const temporaryDirectories: string[] = [];

function createCodexStateDatabase(): {
  directory: string;
  database: DatabaseSync;
} {
  const directory = mkdtempSync(join(tmpdir(), "letta-mem-codex-state-"));
  temporaryDirectories.push(directory);
  const database = new DatabaseSync(join(directory, "state_5.sqlite"));
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      name TEXT
    )
  `);
  return { directory, database };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Letta Conversation 标题", () => {
  it("从 Codex 本地任务索引读取当前任务标题且优先使用手动名称", () => {
    const { directory, database } = createCodexStateDatabase();
    database.prepare(
      "INSERT INTO threads (id, title, name) VALUES (?, ?, ?)",
    ).run("session-title", "自动标题", "用户手动名称");
    database.close();

    expect(readCodexConversationTitle("session-title", [directory]))
      .toBe("用户手动名称");
  });

  it("Hook 未提供标题且 Codex 索引不可用时使用当前首条消息回退", () => {
    const resolved = resolveConversationTitle({
      session_id: "missing-session-title",
      prompt: "  修复   当前插件的记忆读取流程  ",
    });

    expect(resolved).toEqual({
      value: "修复 当前插件的记忆读取流程",
      source: "prompt",
    });
  });

  it("宿主直接提供标题时不读取其他来源", () => {
    expect(resolveConversationTitle({
      session_id: "session-hook-title",
      thread_title: "当前 Codex 任务名称",
      prompt: "这不是标题",
    })).toEqual({
      value: "当前 Codex 任务名称",
      source: "hook",
    });
  });
});
