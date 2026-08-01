import { describe, expect, it, vi } from "vitest";
import { sendAgentUpdate } from "../src/letta.js";
import type { AgentSession } from "../src/letta.js";

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
