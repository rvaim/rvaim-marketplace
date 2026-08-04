import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { isLettaSetupError } from "./app-server.js";
import { readRuntimeConfig } from "./config.js";
import { createLogger, errorDetail } from "./logger.js";
import {
  recallMemory,
} from "./recall.js";
import type {
  MemoryRecallResult,
} from "./recall.js";

export type MemoryRecallHandler = (
  query: string,
  workspacePath: string,
) => Promise<MemoryRecallResult>;

async function defaultRecallHandler(
  query: string,
  workspacePath: string,
): Promise<MemoryRecallResult> {
  const config = readRuntimeConfig();
  return recallMemory(
    config,
    { query, workspacePath },
    createLogger(config),
  );
}

function resultText(result: MemoryRecallResult): string {
  if (result.status === "ok") return result.memory;
  if (result.status === "empty") return "未召回到与当前问题相关的记忆。";
  if (result.status === "agent_not_found") {
    return "当前工作区尚无 letta-mem 对应的 Letta Agent，因此没有可召回的记忆。";
  }
  if (result.status === "busy") {
    return "Letta Agent 当前正处理该工作区的其他记忆任务，本次未执行召回。";
  }
  if (result.status === "invalid_response") {
    return "Letta Agent 未按记忆召回协议返回结果，本次未注入任何内容。";
  }
  return "letta-mem 已禁用，本次未执行记忆召回。";
}

export function createRecallMcpServer(
  handler: MemoryRecallHandler = defaultRecallHandler,
): McpServer {
  const server = new McpServer({
    name: "letta-memory",
    version: "2.10.3",
  });

  server.registerTool("letta_recall", {
    title: "召回 Letta 记忆",
    description: "按当前问题让已有的工作区 Letta Agent 主动检索相关长期记忆和历史会话。只负责召回，不创建 Agent，不指定共享或工作区作用域，也不管理记忆存储。workspace_path 必须是当前任务的工作区根目录。",
    inputSchema: {
      query: z.string().trim().min(1).max(12_000)
        .describe("需要结合历史记忆回答的当前问题或上下文缺口"),
      workspace_path: z.string().trim().min(1).max(4_096)
        .refine((value) => isAbsolute(value), {
          message: "workspace_path 必须是绝对路径",
        })
        .describe("当前任务工作区根目录的绝对路径，不是临时子目录或当前命令目录"),
    },
    outputSchema: {
      status: z.enum([
        "ok",
        "empty",
        "agent_not_found",
        "busy",
        "disabled",
        "invalid_response",
      ]),
      memory: z.string(),
    },
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ query, workspace_path }) => {
    try {
      const result = await handler(query, workspace_path);
      return {
        content: [{ type: "text", text: resultText(result) }],
        structuredContent: result,
      };
    } catch (error) {
      const detail = errorDetail(
        error instanceof Error ? error : String(error),
      );
      try {
        const config = readRuntimeConfig();
        createLogger(config)("error", "memory-recall-mcp-failed", detail);
      } catch {
        // 配置失败时无法写入插件日志。
      }
      return {
        content: [{
          type: "text",
          text: isLettaSetupError(error)
            ? error.message
            : "Letta 记忆召回失败，请检查 Letta App Server 与插件日志。",
        }],
        isError: true,
      };
    }
  });

  return server;
}
