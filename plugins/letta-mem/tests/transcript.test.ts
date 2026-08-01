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
    expect(formatted).toContain("<memory_mode>workspace</memory_mode>");
    expect(formatted).toContain("请记住这个架构决定。");
    expect(formatted).toContain("Keep this preference in English.");
  });

  it("混合记忆任务会保留工作区来源并允许复用相关经验", () => {
    const formatted = formatTranscriptForAgent(
      "mixed-session",
      "/workspace/one",
      [{
        lineIndex: 0,
        role: "user",
        text: "记住这个决定。",
        digest: "mixed-user",
      }],
      true,
    );

    expect(formatted).toContain("<memory_mode>mixed</memory_mode>");
    expect(formatted).toContain("共享同一个 Agent 和 MemFS");
    expect(formatted).toContain("保留其 workspace_path");
    expect(formatted).toContain("不得把其他工作区事实当作当前工作区事实");
  });

  it("同一个工作区 Agent 自行区分原生共享与工作区记忆", () => {
    const formatted = formatTranscriptForAgent(
      "workspace-session",
      "/workspace/<one>",
      [{
        lineIndex: 0,
        role: "user",
        text: "所有项目都使用严格类型检查，但这个仓库使用 pnpm。",
        digest: "workspace-user",
      }],
      false,
      true,
    );

    expect(formatted).toContain("<shared_memory_enabled>true</shared_memory_enabled>");
    expect(formatted).toContain("<native_shared_memory_root>使用 Agent info 中 MEMORY_DIR 绝对路径的父目录</native_shared_memory_root>");
    expect(formatted).toContain("Shared Memory repository");
    expect(formatted).toContain("当前工作区 Agent 自身的 MemFS");
    expect(formatted).toContain("插件没有预先分类");
    expect(formatted).toContain("/workspace/&lt;one&gt;");
    expect(formatted).not.toContain("<shared_memory_context>");
  });

  it("混合 Agent 在共享功能开启时自行区分作用域", () => {
    const formatted = formatTranscriptForAgent(
      "mixed-shared-session",
      "/workspace/two",
      [{
        lineIndex: 0,
        role: "user",
        text: "记住规范和项目决定。",
        digest: "mixed-shared-user",
      }],
      true,
      true,
    );

    expect(formatted).toContain("<memory_mode>mixed</memory_mode>");
    expect(formatted).toContain("你必须自行判断每项信息的作用域");
    expect(formatted).toContain("Shared Memory repository");
    expect(formatted).not.toContain("<shared_memory_context>");
  });

  it("读取 Codex 记录时只采集原始用户消息和最终回答", async () => {
    const path = createTranscript([
      {
        type: "event_msg",
        payload: { type: "user_message", message: "Codex 用户问题" },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "中间进度" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "Codex 最终回答" }],
        },
      },
    ]);

    const batch = await readTranscriptIncrement(
      path,
      -1,
      [],
      undefined,
      80_000,
    );

    expect(batch.events.map((event) => [event.role, event.text])).toEqual([
      ["user", "Codex 用户问题"],
      ["assistant", "Codex 最终回答"],
    ]);
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
