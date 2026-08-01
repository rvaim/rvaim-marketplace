import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatTranscriptForAgent,
  readTranscriptIncrement,
} from "../src/transcript.js";

const temporaryDirectories: string[] = [];

function createTranscript(lines: object[]): string {
  const directory = mkdtempSync(join(tmpdir(), "letta-mem-transcript-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "transcript.jsonl");
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("转录增量读取", () => {
  it("更新任务只按用户消息语言保存中文或英文记忆", () => {
    const formatted = formatTranscriptForAgent(
      "language-session",
      "/workspace",
      [
        {
          lineIndex: 0,
          role: "user",
          text: "请记住这个架构决定。",
          digest: "chinese-user",
        },
        {
          lineIndex: 1,
          role: "assistant",
          text: "I will save it in English.",
          digest: "english-assistant",
        },
        {
          lineIndex: 2,
          role: "user",
          text: "Keep this preference in English.",
          digest: "english-user",
        },
      ],
    );

    expect(formatted).toContain("判断语言时只参考 role=\"user\" 的消息");
    expect(formatted).toContain("用户用简体中文表达的事实用简体中文保存");
    expect(formatted).toContain("用户用英文表达的事实用英文保存");
    expect(formatted).toContain("不得跟随助手、系统、工具输出");
    expect(formatted).toContain("请记住这个架构决定。");
    expect(formatted).toContain("Keep this preference in English.");
  });

  it("只读取游标之后的记录并忽略 thinking 内容", async () => {
    const path = createTranscript([
      {
        type: "user",
        message: { content: [{ type: "text", text: "旧消息" }] },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", text: "隐藏推理不得进入记忆" },
            { type: "text", text: "新的回答" },
          ],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "text", text: "新的问题" }] },
      },
    ]);

    const batch = await readTranscriptIncrement(path, 0, [], undefined, 80_000);

    expect(batch.lastLineIndex).toBe(2);
    expect(batch.events.map((event) => event.text)).toEqual([
      "新的回答",
      "新的问题",
    ]);
    expect(batch.events.some((event) => event.text.includes("隐藏推理"))).toBe(false);
  });

  it("使用 tool_use 的 block.id 关联工具结果", async () => {
    const path = createTranscript([
      {
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: "toolu_123",
            name: "Read",
            input: { file_path: "/tmp/example.ts" },
          }],
        },
      },
      {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: "文件内容",
          }],
        },
      },
    ]);

    const batch = await readTranscriptIncrement(path, -1, [], undefined, 80_000);

    expect(batch.events.map((event) => event.text)).toEqual([
      "[调用工具：Read] /tmp/example.ts",
      "[工具结果：Read]\n文件内容",
    ]);
    expect(batch.events[1]?.text).not.toContain("toolu_123");
  });

  it("不会重复采集 last_assistant_message 中已有的助手消息", async () => {
    const path = createTranscript([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "最终回答" }] },
      },
    ]);

    const batch = await readTranscriptIncrement(
      path,
      -1,
      [],
      "最终回答",
      80_000,
    );

    expect(batch.events.filter((event) => event.text === "最终回答")).toHaveLength(1);
  });

  it("批次超限时按最早未处理记录推进且不丢弃重复文本", async () => {
    const path = createTranscript([
      {
        type: "user",
        message: { content: [{ type: "text", text: "完全相同的消息" }] },
      },
      {
        type: "user",
        message: { content: [{ type: "text", text: "完全相同的消息" }] },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "最后一条消息" }] },
      },
    ]);

    const first = await readTranscriptIncrement(path, -1, [], undefined, 80);
    const second = await readTranscriptIncrement(
      path,
      first.lastLineIndex,
      first.events.map((event) => event.digest),
      undefined,
      80,
    );
    const third = await readTranscriptIncrement(
      path,
      second.lastLineIndex,
      [
        ...first.events.map((event) => event.digest),
        ...second.events.map((event) => event.digest),
      ],
      undefined,
      80,
    );

    expect(first.events.map((event) => event.text)).toEqual(["完全相同的消息"]);
    expect(first.lastLineIndex).toBe(0);
    expect(second.events.map((event) => event.text)).toEqual(["完全相同的消息"]);
    expect(second.lastLineIndex).toBe(1);
    expect(third.events.map((event) => event.text)).toEqual(["最后一条消息"]);
    expect(third.lastLineIndex).toBe(2);
  });

  it("不会越过仍在写入的 JSONL 尾行", async () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-mem-transcript-tail-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "transcript.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({
        type: "user",
        message: { content: [{ type: "text", text: "完整首行" }] },
      })}\n{"type":"assistant","message":{"content":[{"type":"text","text":"后补`,
      "utf8",
    );

    const partial = await readTranscriptIncrement(path, -1, [], undefined, 80_000);
    expect(partial.events.map((event) => event.text)).toEqual(["完整首行"]);
    expect(partial.lastLineIndex).toBe(0);

    appendFileSync(path, `完整"}]}}\n`, "utf8");
    const completed = await readTranscriptIncrement(
      path,
      partial.lastLineIndex,
      partial.events.map((event) => event.digest),
      undefined,
      80_000,
    );
    expect(completed.events.map((event) => event.text)).toEqual(["后补完整"]);
    expect(completed.lastLineIndex).toBe(1);
  });
});
