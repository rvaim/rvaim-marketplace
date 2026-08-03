import { describe, expect, it, vi } from "vitest";
import {
  agentClientOptions,
  sendAgentUpdate,
  sendAgentUpdateWithResult,
} from "../src/letta.js";
import type { AgentSession } from "../src/letta.js";
import type { RuntimeConfig } from "../src/types.js";

function createConfig(
  values: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  return {
    serverUrl: "http://127.0.0.1:4500",
    autoStartServer: true,
    model: "auto",
    dataDir: "/tmp/letta-mem-letta-tests",
    coordinationDir: "/tmp/letta-mem-letta-tests-coordination",
    namespace: "letta-tests",
    requestTimeoutMs: 1_000,
    maxContextChars: 8_000,
    maxBatchChars: 80_000,
    disabled: false,
    ...values,
  };
}

describe("Letta Agent SDK 连接", () => {
  it("默认把 App Server 生命周期交给 SDK 且不传 backend", () => {
    const options = agentClientOptions(createConfig());

    expect(options).toEqual({
      appServer: {
        requestTimeoutMs: 1_000,
      },
    });
    expect(options).not.toHaveProperty("backend");
    expect(options).not.toHaveProperty("url");
  });

  it("显式关闭自动管理时连接用户提供的 App Server", () => {
    expect(agentClientOptions(createConfig({
      autoStartServer: false,
      serverUrl: "https://letta.example.test",
      authToken: "capability-token",
    }))).toEqual({
      backend: "remote",
      url: "https://letta.example.test",
      authToken: "capability-token",
      requestTimeoutMs: 1_000,
    });
  });

  it("非本机地址只连接现有 App Server", () => {
    expect(agentClientOptions(createConfig({
      serverUrl: "https://letta.example.test",
    }))).toMatchObject({
      backend: "remote",
      url: "https://letta.example.test",
    });
  });
});

describe("Letta Agent 流式响应", () => {
  it("按原始顺序连续拼接 assistant 增量片段", async () => {
    const session: AgentSession = {
      send: vi.fn(async () => {}),
      async *stream() {
        yield { type: "assistant", content: "下一" };
        yield { type: "assistant", content: "轮 " };
        yield { type: "assistant", content: "Claude Code" };
        yield { type: "assistant", content: " 需要此上下文。" };
        yield { type: "result", success: true };
      },
      async bootstrapState() {
        return { agentId: "agent-test", conversationId: "conversation-test" };
      },
      close: vi.fn(),
    };

    await expect(sendAgentUpdate(session, "测试消息"))
      .resolves.toBe("下一轮 Claude Code 需要此上下文。");
  });

  it("等待原生记忆工具返回后才确认本轮完成", async () => {
    const session: AgentSession = {
      send: vi.fn(async () => {}),
      async *stream() {
        yield {
          type: "assistant",
          content: "我先检查记忆。",
          uuid: "message-process",
        };
        yield {
          type: "tool_call",
          toolCallId: "memory-call-1",
          toolName: "memory",
        };
        yield {
          type: "tool_result",
          toolCallId: "memory-call-1",
          content: "记忆已更新",
          isError: false,
        };
        yield {
          type: "assistant",
          content: "下一轮需要的上下文",
          uuid: "message-guidance",
        };
        yield { type: "result", success: true, stopReason: "end_turn" };
      },
      async bootstrapState() {
        return { agentId: "agent-test", conversationId: "conversation-test" };
      },
      async getDeviceStatus() {
        return { isProcessing: false, pendingControlRequests: [] };
      },
      close: vi.fn(),
    };

    await expect(sendAgentUpdateWithResult(session, "测试写记忆"))
      .resolves.toEqual({
        guidance: "下一轮需要的上下文",
        messageId: "message-guidance",
      });
  });

  it("工具调用后没有最终 assistant 消息时不使用聚合结果冒充指导", async () => {
    const session: AgentSession = {
      send: vi.fn(async () => {}),
      async *stream() {
        yield {
          type: "assistant",
          content: "我先检查并更新记忆。",
          uuid: "message-process",
        };
        yield {
          type: "tool_call",
          toolCallId: "memory-call-no-guidance",
          toolName: "memory",
        };
        yield {
          type: "tool_result",
          toolCallId: "memory-call-no-guidance",
          isError: false,
        };
        yield {
          type: "result",
          success: true,
          stopReason: "end_turn",
          result: "我先检查并更新记忆。记忆已经更新完成。",
        };
      },
      async bootstrapState() {
        return { agentId: "agent-test", conversationId: "conversation-test" };
      },
      async getDeviceStatus() {
        return { isProcessing: false, pendingControlRequests: [] };
      },
      close: vi.fn(),
    };

    await expect(sendAgentUpdateWithResult(session, "测试写记忆"))
      .resolves.toEqual({ guidance: "" });
  });

  it("SDK 把待审批误报为成功时仍判定本轮失败", async () => {
    const session: AgentSession = {
      send: vi.fn(async () => {}),
      async *stream() {
        yield {
          type: "tool_call",
          toolCallId: "memory-call-pending",
          toolName: "memory",
        };
        yield {
          type: "result",
          success: true,
          stopReason: "requires_approval",
        };
      },
      async bootstrapState() {
        return { agentId: "agent-test", conversationId: "conversation-test" };
      },
      async getDeviceStatus() {
        return {
          isProcessing: false,
          pendingControlRequests: [{
            requestId: "approval-1",
            toolName: "memory",
            toolCallId: "memory-call-pending",
          }],
        };
      },
      close: vi.fn(),
    };

    await expect(sendAgentUpdate(session, "测试待审批"))
      .rejects.toThrow("Letta Session 仍有待审批工具请求: memory");
  });

  it("运行时已清空审批但工具没有返回时仍判定失败", async () => {
    const session: AgentSession = {
      send: vi.fn(async () => {}),
      async *stream() {
        yield {
          type: "tool_call",
          toolCallId: "memory-call-lost",
          toolName: "memory",
        };
        yield { type: "result", success: true };
      },
      async bootstrapState() {
        return { agentId: "agent-test", conversationId: "conversation-test" };
      },
      async getDeviceStatus() {
        return { isProcessing: false, pendingControlRequests: [] };
      },
      close: vi.fn(),
    };

    await expect(sendAgentUpdate(session, "测试丢失工具结果"))
      .rejects.toThrow("Letta Session 存在未完成工具调用: memory");
  });

  it("成功结果后的短暂处理中状态会等待到真正结束", async () => {
    let statusReads = 0;
    const session: AgentSession = {
      send: vi.fn(async () => {}),
      async *stream() {
        yield {
          type: "assistant",
          content: "召回到的记忆",
          uuid: "message-after-settle",
        };
        yield { type: "result", success: true, stopReason: "end_turn" };
      },
      async bootstrapState() {
        return { agentId: "agent-test", conversationId: "conversation-test" };
      },
      async getDeviceStatus() {
        statusReads += 1;
        return {
          isProcessing: statusReads === 1,
          pendingControlRequests: [],
        };
      },
      close: vi.fn(),
    };

    await expect(sendAgentUpdateWithResult(
      session,
      "测试短暂状态延迟",
      { deviceSettleTimeoutMs: 100, deviceSettlePollMs: 0 },
    )).resolves.toEqual({
      guidance: "召回到的记忆",
      messageId: "message-after-settle",
    });
    expect(statusReads).toBe(2);
  });

  it("超过等待上限仍在处理时继续判定失败", async () => {
    const session: AgentSession = {
      send: vi.fn(async () => {}),
      async *stream() {
        yield { type: "result", success: true, stopReason: "end_turn" };
      },
      async bootstrapState() {
        return { agentId: "agent-test", conversationId: "conversation-test" };
      },
      async getDeviceStatus() {
        return { isProcessing: true, pendingControlRequests: [] };
      },
      close: vi.fn(),
    };

    await expect(sendAgentUpdateWithResult(
      session,
      "测试持续处理中",
      { deviceSettleTimeoutMs: 0 },
    )).rejects.toThrow("Letta Session 返回完成后仍在处理");
  });
});
