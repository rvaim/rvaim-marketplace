import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { LettaSetupError } from "../src/app-server.js";
import { createRecallMcpServer } from "../src/mcp.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("letta-memory MCP", () => {
  it("通过 MCP 协议公开并执行 letta_recall", async () => {
    const calls: Array<{ query: string; workspacePath: string }> = [];
    const server = createRecallMcpServer(async (query, workspacePath) => {
      calls.push({ query, workspacePath });
      return { status: "ok", memory: "已召回的项目决定" };
    });
    const client = new Client({ name: "letta-mem-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("letta_recall");

    const result = await client.callTool({
      name: "letta_recall",
      arguments: {
        query: "之前为何选择这个架构？",
        workspace_path: "/tmp/project-root",
      },
    });
    expect(calls).toEqual([{
      query: "之前为何选择这个架构？",
      workspacePath: "/tmp/project-root",
    }]);
    expect(result.content).toEqual([{
      type: "text",
      text: "已召回的项目决定",
    }]);
    expect(result.structuredContent).toEqual({
      status: "ok",
      memory: "已召回的项目决定",
    });
  });

  it("将 Letta 安装或启动错误直接返回给用户", async () => {
    const server = createRecallMcpServer(async () => {
      throw new LettaSetupError(
        "未检测到 Letta CLI。请先运行 npm install -g @letta-ai/letta-code。",
      );
    });
    const client = new Client({ name: "letta-mem-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });

    const result = await client.callTool({
      name: "letta_recall",
      arguments: {
        query: "召回项目记忆",
        workspace_path: "/tmp/project-root",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: "text",
      text: "未检测到 Letta CLI。请先运行 npm install -g @letta-ai/letta-code。",
    }]);
  });
});
