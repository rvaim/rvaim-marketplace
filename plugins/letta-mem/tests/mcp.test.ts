import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LettaSetupError } from "../src/app-server.js";
import { createRecallMcpServer } from "../src/mcp.js";

const cleanups: Array<() => Promise<void>> = [];
const temporaryDirectories: string[] = [];
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("letta-memory MCP", () => {
  it("插件清单入口可直接完成 stdio initialize", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "letta-mem-mcp-bootstrap-"));
    temporaryDirectories.push(dataDir);
    const manifest = JSON.parse(readFileSync(
      join(pluginRoot, ".mcp.json"),
      "utf8",
    )) as {
      mcpServers: Record<string, {
        command: string;
        args: string[];
        cwd?: string;
      }>;
    };
    const server = manifest.mcpServers["letta-memory"];
    if (!server) throw new Error(".mcp.json 缺少 letta-memory 配置");
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: pluginRoot,
      env: {
        ...getDefaultEnvironment(),
        LETTA_MEM_DATA_DIR: dataDir,
        LETTA_MEM_COORDINATION_DIR: join(dataDir, "coordination"),
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "letta-mem-bootstrap-test", version: "1.0.0" });
    await client.connect(transport);
    cleanups.push(async () => client.close());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("letta_recall");
    expect(existsSync(join(dataDir, "runtime"))).toBe(false);
  });

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
