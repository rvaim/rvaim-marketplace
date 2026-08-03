import type {
  AgentClient,
  AgentClientFactory,
  AgentConversationMessage,
  AgentSession,
  AgentSessionOverrides,
} from "./letta.js";
import {
  agentScopeKey,
  createAgentClient,
  openAgentSession,
  prepareExistingAgentId,
  sendAgentUpdateWithResult,
} from "./letta.js";
import { errorDetail } from "./logger.js";
import {
  acquireLock,
  agentRunLockPath,
  loadRecallConversationReference,
  saveRecallConversationReference,
} from "./state.js";
import { normalizeWorkspacePath } from "./context.js";
import type {
  LogFunction,
  RuntimeConfig,
} from "./types.js";

export type MemoryRecallStatus =
  | "ok"
  | "empty"
  | "agent_not_found"
  | "busy"
  | "disabled"
  | "invalid_response";

export interface MemoryRecallResult extends Record<string, unknown> {
  status: MemoryRecallStatus;
  memory: string;
}

export interface MemoryRecallRequest {
  query: string;
  workspacePath: string;
}

interface MemoryRecallOptions {
  lockWaitMs?: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

export function formatMemoryRecallRequest(
  workspacePath: string,
  query: string,
): string {
  return `<memory_context_request>
<workspace_path>${escapeXml(workspacePath)}</workspace_path>
<query>${escapeXml(query)}</query>
<response_tool>submit_memory_context</response_tool>
</memory_context_request>`;
}

function isMissingLettaResource(error: Error | string): boolean {
  const message = error instanceof Error ? error.message : error;
  return /not found|does not exist|unknown (?:agent|conversation)|failed to retrieve conversation|conversation does not belong to expected agent/i
    .test(message);
}

function messageText(message: AgentConversationMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part.text ?? part.content ?? "")
      .join("")
      .trim();
  }
  return message.text?.trim() ?? "";
}

export function parseMemoryRecallResponse(value: string): string | null {
  const matches = [...value.matchAll(
    /<memory_context>([\s\S]*?)<\/memory_context>/g,
  )];
  const last = matches.at(-1);
  return last ? (last[1] ?? "").trim() : null;
}

function createRecallSubmission(): {
  overrides: AgentSessionOverrides;
  submittedMemory(): string | null;
} {
  let memory: string | null = null;
  return {
    overrides: {
      tools: [{
        label: "提交记忆召回结果",
        name: "submit_memory_context",
        description: "仅在处理 memory_context_request 时调用一次。完成 Letta 原生记忆检索后，把与当前 query 直接相关的最终记忆正文放入 memory；没有相关记忆时提交空字符串。此工具只返回结果，不保存或修改记忆。",
        parameters: {
          type: "object",
          properties: {
            memory: {
              type: "string",
              description: "只包含与当前问题直接相关的最终记忆正文，不含计划、分析、状态或检索过程",
            },
          },
          required: ["memory"],
          additionalProperties: false,
        },
        async execute(_toolCallId, args) {
          if (
            !args
            || typeof args !== "object"
            || typeof (args as { memory?: unknown }).memory !== "string"
          ) {
            return {
              content: [{ type: "text", text: "memory 参数必须是字符串。" }],
              isError: true,
            };
          }
          memory = (args as { memory: string }).memory;
          return {
            content: [{ type: "text", text: "记忆召回结果已提交。" }],
            details: { accepted: true },
          };
        },
      }],
    },
    submittedMemory: () => memory,
  };
}

async function finalRecallText(
  client: AgentClient,
  conversationId: string,
  messageId: string | undefined,
  fallback: string,
  log: LogFunction,
): Promise<string> {
  if (!messageId || !client.conversations) return fallback.trim();
  try {
    const page = await client.conversations.listMessages(conversationId, {
      order: "desc",
      limit: 100,
    });
    const exact = page.messages.find((message) => message.id === messageId);
    return exact ? messageText(exact) : fallback.trim();
  } catch (error) {
    log(
      "warn",
      "memory-recall-message-read-failed",
      errorDetail(error instanceof Error ? error : String(error)),
    );
    return fallback.trim();
  }
}

async function acquireRunLock(
  config: RuntimeConfig,
  workspacePath: string,
  waitMs: number,
): Promise<(() => void) | null> {
  const deadline = Date.now() + waitMs;
  const path = agentRunLockPath(
    config,
    agentScopeKey(config, workspacePath),
  );
  let release = acquireLock(path);
  while (!release && Date.now() < deadline) {
    await delay(50);
    release = acquireLock(path);
  }
  return release;
}

async function setRecallConversationTitle(
  client: AgentClient,
  conversationId: string,
  log: LogFunction,
): Promise<void> {
  if (!client.conversations?.update) return;
  try {
    await client.conversations.update(conversationId, {
      summary: "按需记忆召回",
      description: "供编码助手按当前问题召回 Letta 已有记忆的固定会话。",
    });
  } catch (error) {
    log(
      "warn",
      "memory-recall-title-update-failed",
      errorDetail(error instanceof Error ? error : String(error)),
    );
  }
}

export async function recallMemory(
  config: RuntimeConfig,
  request: MemoryRecallRequest,
  log: LogFunction = () => {},
  clientFactory: AgentClientFactory = createAgentClient,
  options: MemoryRecallOptions = {},
): Promise<MemoryRecallResult> {
  if (config.disabled) return { status: "disabled", memory: "" };
  const query = request.query.trim();
  if (!query) return { status: "empty", memory: "" };
  const workspacePath = normalizeWorkspacePath(request.workspacePath);
  const release = await acquireRunLock(
    config,
    workspacePath,
    options.lockWaitMs ?? 10_000,
  );
  if (!release) {
    log("info", "memory-recall-skipped-agent-busy", workspacePath);
    return { status: "busy", memory: "" };
  }

  let session: AgentSession | undefined;
  try {
    const client = await clientFactory(config);
    const agentId = await prepareExistingAgentId(
      config,
      client,
      workspacePath,
      log,
    );
    if (!agentId) return { status: "agent_not_found", memory: "" };

    const reference = loadRecallConversationReference(config, workspacePath);
    const resumableConversation = reference?.agentId === agentId
      ? reference.conversationId
      : undefined;
    let opened;
    let created = !resumableConversation;
    const submission = createRecallSubmission();
    try {
      opened = await openAgentSession(
        client,
        agentId,
        resumableConversation,
        workspacePath,
        submission.overrides,
      );
    } catch (error) {
      if (!resumableConversation || !isMissingLettaResource(
        error instanceof Error ? error : String(error),
      )) throw error;
      opened = await openAgentSession(
        client,
        agentId,
        undefined,
        workspacePath,
        submission.overrides,
      );
      created = true;
      log("warn", "memory-recall-conversation-recreated", resumableConversation);
    }
    session = opened.session;
    saveRecallConversationReference(config, {
      version: 1,
      agentId,
      workspacePath,
      conversationId: opened.conversationId,
      updatedAt: new Date().toISOString(),
    });
    if (created) {
      await setRecallConversationTitle(client, opened.conversationId, log);
    }

    const turn = await sendAgentUpdateWithResult(
      opened.session,
      formatMemoryRecallRequest(workspacePath, query.slice(0, 12_000)),
    );
    const rawResponse = await finalRecallText(
      client,
      opened.conversationId,
      turn.messageId,
      turn.guidance,
      log,
    );
    const submitted = submission.submittedMemory();
    const parsed = submitted ?? parseMemoryRecallResponse(rawResponse);
    if (parsed === null) {
      if (rawResponse.trim()) {
        log("warn", "memory-recall-response-invalid", workspacePath);
      }
      return { status: "invalid_response", memory: "" };
    }
    const memory = parsed.slice(0, config.maxContextChars).trim();
    log(
      "info",
      memory ? "memory-recall-completed" : "memory-recall-empty",
      workspacePath,
    );
    return {
      status: memory ? "ok" : "empty",
      memory,
    };
  } finally {
    try {
      session?.close();
    } catch (error) {
      log(
        "warn",
        "memory-recall-session-close-failed",
        errorDetail(error instanceof Error ? error : String(error)),
      );
    }
    release();
  }
}
