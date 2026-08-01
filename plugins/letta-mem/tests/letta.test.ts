import { describe, expect, it, vi } from "vitest";
import {
  agentClientOptions,
  sendAgentUpdate,
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
});
