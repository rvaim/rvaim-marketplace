import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeWorkspacePath } from "../src/context.js";
import {
  agentScopeKey,
} from "../src/letta.js";
import type {
  AgentClient,
  AgentSession,
} from "../src/letta.js";
import {
  formatMemoryRecallRequest,
  parseMemoryRecallResponse,
  recallMemory,
} from "../src/recall.js";
import {
  acquireLock,
  agentRunLockPath,
  loadRecallConversationReference,
  sha256,
} from "../src/state.js";
import type { RuntimeConfig } from "../src/types.js";

const temporaryDirectories: string[] = [];

function createConfig(): RuntimeConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "letta-mem-recall-"));
  temporaryDirectories.push(dataDir);
  return {
    serverUrl: "http://127.0.0.1:4500",
    autoStartServer: false,
    model: "auto",
    dataDir,
    coordinationDir: join(dataDir, "coordination"),
    namespace: "recall-tests",
    requestTimeoutMs: 1_000,
    maxContextChars: 8_000,
    maxBatchChars: 80_000,
    disabled: false,
  };
}

function createSession(
  conversationId: string,
  finalMemory: string,
  finalMessageId: string,
): AgentSession & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: vi.fn(async (message: string) => {
      sent.push(message);
    }),
    async *stream() {
      yield {
        type: "assistant",
        content: "准备检索",
        uuid: `${conversationId}-process`,
      };
      yield {
        type: "tool_call",
        toolCallId: `${conversationId}-search`,
        toolName: "conversation_search",
      };
      yield {
        type: "tool_result",
        toolCallId: `${conversationId}-search`,
      };
      yield {
        type: "assistant",
        content: finalMemory,
        uuid: finalMessageId,
      };
      yield { type: "result", success: true };
    },
    async bootstrapState() {
      return { agentId: "agent-recall", conversationId };
    },
    async getDeviceStatus() {
      return { isProcessing: false, pendingControlRequests: [] };
    },
    close: vi.fn(),
  };
}

function createClient(
  workspacePath: string,
  first: AgentSession,
  resumed: AgentSession,
): AgentClient & {
  createAgent: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  resumeSession: ReturnType<typeof vi.fn>;
} {
  const workspaceTag = `letta-mem-workspace:${sha256(workspacePath).slice(0, 24)}`;
  const createAgent = vi.fn(async () => "unexpected-agent");
  const createSession = vi.fn(() => first);
  const resumeSession = vi.fn(() => resumed);
  return {
    createAgent,
    createSession,
    resumeSession,
    agents: {
      list: vi.fn(async () => [{
        id: "agent-recall",
        model: "auto",
        tags: ["letta-mem", workspaceTag],
      }]),
      update: vi.fn(async () => ({
        id: "agent-recall",
        model: "auto",
        tags: ["letta-mem", workspaceTag],
      })),
    },
    conversations: {
      update: vi.fn(async () => ({})),
      listMessages: vi.fn(async (conversationId: string) => ({
        messages: conversationId === "conversation-recall"
          ? [
              {
                id: "message-first",
                content: "<memory_context>第一轮精确记忆</memory_context>",
              },
              {
                id: "message-second",
                content: "英文过程文本\n<memory_context>第二轮精确记忆</memory_context>\n标签外文本",
              },
            ]
          : [],
      })),
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("按需记忆召回", () => {
  it("只发送最小查询并复用固定 Conversation", async () => {
    const config = createConfig();
    const workspacePath = normalizeWorkspacePath(config.dataDir);
    const first = createSession(
      "conversation-recall",
      "<memory_context>第一轮流式记忆</memory_context>",
      "message-first",
    );
    const resumed = createSession(
      "conversation-recall",
      "<memory_context>第二轮流式记忆</memory_context>",
      "message-second",
    );
    const client = createClient(workspacePath, first, resumed);
    const factory = vi.fn(async () => client);

    const firstResult = await recallMemory(
      config,
      { query: "之前决定用哪个方案？", workspacePath },
      () => {},
      factory,
    );
    const secondResult = await recallMemory(
      config,
      { query: "<&第二个问题>", workspacePath },
      () => {},
      factory,
    );

    expect(firstResult).toEqual({ status: "ok", memory: "第一轮精确记忆" });
    expect(secondResult).toEqual({ status: "ok", memory: "第二轮精确记忆" });
    expect(client.createAgent).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.resumeSession).toHaveBeenCalledTimes(1);
    expect(first.sent[0]).toBe(formatMemoryRecallRequest(
      workspacePath,
      "之前决定用哪个方案？",
    ));
    expect(resumed.sent[0]).toContain("&lt;&amp;第二个问题&gt;");
    expect(resumed.sent[0]).not.toContain("记忆作用域规则");
    expect(loadRecallConversationReference(config, workspacePath)).toMatchObject({
      agentId: "agent-recall",
      conversationId: "conversation-recall",
      workspacePath,
    });
    expect(client.conversations?.update).toHaveBeenCalledTimes(1);
  });

  it("只提取结构化包络内的最终记忆", () => {
    expect(parseMemoryRecallResponse(
      "English process\n<memory_context>中文记忆正文</memory_context>\n其他过程",
    )).toBe("中文记忆正文");
    expect(parseMemoryRecallResponse("只有过程文本")).toBeNull();
    expect(parseMemoryRecallResponse("<memory_context></memory_context>"))
      .toBe("");
  });

  it("优先使用 Session 返回工具提交的结构化记忆", async () => {
    const config = createConfig();
    const workspacePath = normalizeWorkspacePath(config.dataDir);
    const workspaceTag = `letta-mem-workspace:${sha256(workspacePath).slice(0, 24)}`;
    const createSession = vi.fn((
      _agentId: string,
      options: Parameters<AgentClient["createSession"]>[1],
    ) => {
      const tool = options.tools?.[0];
      const session: AgentSession = {
        send: vi.fn(async () => {}),
        async *stream() {
          if (!tool) throw new Error("缺少召回结果提交工具");
          yield {
            type: "tool_call",
            toolCallId: "submit-memory-1",
            toolName: tool.name,
          };
          await tool.execute("submit-memory-1", {
            memory: "通过工具提交的中文记忆",
          });
          yield {
            type: "tool_result",
            toolCallId: "submit-memory-1",
          };
          yield {
            type: "assistant",
            content: "English process that must be ignored",
            uuid: "message-process-only",
          };
          yield { type: "result", success: true, stopReason: "end_turn" };
        },
        async bootstrapState() {
          return {
            agentId: "agent-recall-tool",
            conversationId: "conversation-recall-tool",
          };
        },
        async getDeviceStatus() {
          return { isProcessing: false, pendingControlRequests: [] };
        },
        close: vi.fn(),
      };
      return session;
    });
    const client: AgentClient = {
      createAgent: vi.fn(async () => "unexpected-agent"),
      createSession,
      resumeSession: vi.fn(),
      agents: {
        list: vi.fn(async () => [{
          id: "agent-recall-tool",
          model: "auto",
          tags: ["letta-mem", workspaceTag],
        }]),
        update: vi.fn(async () => ({
          id: "agent-recall-tool",
          model: "auto",
          tags: ["letta-mem", workspaceTag],
        })),
      },
      conversations: {
        listMessages: vi.fn(async () => ({
          messages: [{
            id: "message-process-only",
            content: "English process that must be ignored",
          }],
        })),
      },
    };

    await expect(recallMemory(
      config,
      { query: "召回架构决定", workspacePath },
      () => {},
      async () => client,
    )).resolves.toEqual({
      status: "ok",
      memory: "通过工具提交的中文记忆",
    });
    expect(createSession.mock.calls[0]?.[1].tools?.[0]?.name)
      .toBe("submit_memory_context");
  });

  it("找不到已有 Agent 时不会创建任何 Letta 资源", async () => {
    const config = createConfig();
    const createAgent = vi.fn(async () => "unexpected-agent");
    const createSession = vi.fn();
    const client: AgentClient = {
      createAgent,
      createSession,
      resumeSession: vi.fn(),
      agents: {
        list: vi.fn(async () => []),
        update: vi.fn(),
      },
    };

    await expect(recallMemory(
      config,
      { query: "召回历史决定", workspacePath: config.dataDir },
      () => {},
      async () => client,
    )).resolves.toEqual({ status: "agent_not_found", memory: "" });
    expect(createAgent).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("工作区 Agent 正忙时不并发建立 SDK Session", async () => {
    const config = createConfig();
    const workspacePath = normalizeWorkspacePath(config.dataDir);
    const release = acquireLock(agentRunLockPath(
      config,
      agentScopeKey(config, workspacePath),
    ));
    expect(release).not.toBeNull();
    const factory = vi.fn();
    try {
      await expect(recallMemory(
        config,
        { query: "召回历史决定", workspacePath },
        () => {},
        factory,
        { lockWaitMs: 0 },
      )).resolves.toEqual({ status: "busy", memory: "" });
      expect(factory).not.toHaveBeenCalled();
    } finally {
      release?.();
    }
  });
});
