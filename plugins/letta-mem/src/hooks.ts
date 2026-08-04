import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  claimCachedContext,
  formatContextForHook,
  normalizeWorkspacePath,
} from "./context.js";
import {
  resolveConversationTitle,
} from "./conversation-title.js";
import type {
  ResolvedConversationTitle,
} from "./conversation-title.js";
import {
  agentScopeKey,
  createAgentClient,
  findExistingAgentId,
  openAgentSession,
  resolveAgentId,
  sendAgentUpdateWithResult,
} from "./letta.js";
import { isLettaSetupError } from "./app-server.js";
import type {
  AgentClientFactory,
  AgentConversationMessage,
  AgentSession,
  AgentUpdateResult,
} from "./letta.js";
import { errorDetail } from "./logger.js";
import {
  acquireLock,
  agentRunLockPath,
  bindSessionWorkspace,
  clearAgentReference,
  clearFailureState,
  deferPendingUpdate,
  findActivatedSessionWorkspace,
  loadGuidanceReference,
  loadFailureState,
  listPendingUpdates,
  loadSessionState,
  loadSessionWorkspaceBinding,
  removePendingUpdate,
  saveContextSnapshot,
  saveFailureState,
  saveGuidanceReference,
  savePendingUpdate,
  sha256,
  updateSessionState,
} from "./state.js";
import {
  formatTranscriptForAgent,
  readTranscriptIncrement,
  transcriptTailLineIndex,
} from "./transcript.js";
import type {
  HookInput,
  LogFunction,
  PendingUpdate,
  RuntimeConfig,
} from "./types.js";

function validSessionId(input: HookInput): string | null {
  const value = input.session_id?.trim();
  return value || null;
}

type SessionWorkspaceSource = "bound" | "migrated" | "current";
const SESSION_START_DEDUPLICATION_MS = 30_000;

function resolveSessionWorkspace(
  config: RuntimeConfig,
  sessionId: string,
  cwd: string | undefined,
): { workspacePath: string; source: SessionWorkspaceSource } {
  const binding = loadSessionWorkspaceBinding(config, sessionId);
  if (binding) {
    return { workspacePath: binding.workspacePath, source: "bound" };
  }
  const migrated = findActivatedSessionWorkspace(config, sessionId);
  if (migrated) {
    return { workspacePath: migrated, source: "migrated" };
  }
  return {
    workspacePath: normalizeWorkspacePath(cwd),
    source: "current",
  };
}

async function activateSessionWorkspace(
  config: RuntimeConfig,
  sessionId: string,
  cwd: string | undefined,
  log: LogFunction,
): Promise<string> {
  const resolved = resolveSessionWorkspace(config, sessionId, cwd);
  if (resolved.source === "bound") return resolved.workspacePath;
  const binding = await bindSessionWorkspace(
    config,
    sessionId,
    resolved.workspacePath,
    2_000,
  );
  const workspacePath = binding?.workspacePath ?? resolved.workspacePath;
  log(
    "info",
    resolved.source === "migrated"
      ? "session-workspace-migrated"
      : "session-workspace-bound",
    workspacePath,
  );
  return workspacePath;
}

function normalizeTranscriptPath(
  value: string | undefined,
  cwd: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  if (isAbsolute(trimmed)) return resolve(trimmed);
  return resolve(cwd?.trim() || process.cwd(), trimmed);
}

function escapeXmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function formatSessionStartForAgent(
  sessionId: string,
  workspacePath: string,
): string {
  return `<coding_session_start>
<session_id>${escapeXmlText(sessionId)}</session_id>
<workspace_path>${escapeXmlText(workspacePath)}</workspace_path>
<timestamp>${new Date().toISOString()}</timestamp>
<context>新的编码会话已经开始，后续将发送该会话的增量更新。</context>
</coding_session_start>`;
}

function isRetryBlocked(config: RuntimeConfig): boolean {
  const state = loadFailureState(config);
  if (!state) return false;
  const retryAt = Date.parse(state.retryAfter);
  return Number.isFinite(retryAt) && retryAt > Date.now();
}

function recordFailure(config: RuntimeConfig): void {
  const previous = loadFailureState(config);
  const failures = (previous?.failures ?? 0) + 1;
  const exponent = Math.min(failures - 1, 6);
  const delayMs = Math.min(5_000 * (2 ** exponent), 5 * 60_000);
  const now = Date.now();
  saveFailureState(config, {
    version: 1,
    failures,
    retryAfter: new Date(now + delayMs).toISOString(),
    updatedAt: new Date(now).toISOString(),
  });
}

function pendingRetryDelay(pending: PendingUpdate): number {
  const exponent = Math.min(pending.attempts ?? 0, 6);
  return Math.min(5_000 * (2 ** exponent), 5 * 60_000);
}

function recentDigests(current: string[], additions: string[]): string[] {
  return Array.from(new Set([...current, ...additions])).slice(-300);
}

function reconcileAssistantDigests(
  current: string[],
  consumed: string[],
  additions: string[],
): string[] {
  const remaining = [...current];
  for (const digest of consumed) {
    const index = remaining.indexOf(digest);
    if (index >= 0) remaining.splice(index, 1);
  }
  return [...remaining, ...additions].slice(-100);
}

function normalizedGuidance(guidance: string, maxChars: number): string {
  const trimmed = guidance.trim().slice(0, maxChars * 2);
  const semantic = trimmed
    .replace(/[\s。、，,.!！?？:：;；*_`#>\-]+/g, "")
    .toLowerCase();
  if ([
    "空",
    "无",
    "无内容",
    "无新增内容",
    "无相关上下文",
    "没有新增内容",
    "没有相关上下文",
    "none",
    "null",
    "na",
  ].includes(semantic)) return "";
  if ([
    "没有新的长期价值信息需要返回给下一轮claudecode",
    "没有新增价值信息需要返回给下一轮claudecode",
    "没有新增价值需要返回给下一轮claudecode",
    "没有新的相关上下文需要返回给下一轮claudecode",
    "没有新的上下文需要返回给下一轮claudecode",
    "没有相关上下文需要返回给下一轮claudecode",
  ].some((signal) => semantic.includes(signal))) return "";
  return trimmed;
}

function isMissingLettaResource(error: Error | string): boolean {
  const message = error instanceof Error ? error.message : error;
  return /not found|does not exist|unknown (?:agent|conversation)|failed to retrieve conversation|conversation does not belong to expected agent/i
    .test(message);
}

async function openSessionWithRecovery(
  config: RuntimeConfig,
  client: Awaited<ReturnType<AgentClientFactory>>,
  scopeKey: string,
  initialAgentId: string,
  conversationId: string | undefined,
  workspacePath: string,
  resolveCurrentAgentId: () => Promise<string>,
  log: LogFunction,
): Promise<{
  agentId: string;
  session: AgentSession;
  conversationId: string;
  latestMessageId?: string;
}> {
  let lastError: Error | string = "Letta 会话恢复失败";
  try {
    const opened = await openAgentSession(
      client,
      initialAgentId,
      conversationId,
      workspacePath,
    );
    return { agentId: initialAgentId, ...opened };
  } catch (error) {
    lastError = error instanceof Error ? error : String(error);
    if (!isMissingLettaResource(lastError)) throw error;
  }

  if (conversationId) {
    try {
      const opened = await openAgentSession(
        client,
        initialAgentId,
        undefined,
        workspacePath,
      );
      log("warn", "conversation-recreated", conversationId);
      return { agentId: initialAgentId, ...opened };
    } catch (error) {
      lastError = error instanceof Error ? error : String(error);
      if (!isMissingLettaResource(lastError)) throw error;
    }
  }

  if (!clearAgentReference(
    config,
    scopeKey,
    initialAgentId,
  )) {
    throw lastError instanceof Error ? lastError : new Error(lastError);
  }
  const recoveredAgentId = await resolveCurrentAgentId();
  const opened = await openAgentSession(
    client,
    recoveredAgentId,
    undefined,
    workspacePath,
  );
  log("warn", "agent-reference-recreated", initialAgentId);
  return { agentId: recoveredAgentId, ...opened };
}

interface MappedAgentSession {
  client: Awaited<ReturnType<AgentClientFactory>>;
  agentId: string;
  conversationId: string;
  session: AgentSession;
}

async function openMappedAgentSession(
  config: RuntimeConfig,
  workspacePath: string,
  input: HookInput,
  log: LogFunction,
  clientFactory: AgentClientFactory,
): Promise<MappedAgentSession> {
  const sessionId = validSessionId(input);
  if (!sessionId) throw new Error("缺少编码会话标识");
  const state = loadSessionState(config, workspacePath, sessionId);
  const client = await clientFactory(config);
  const resolvedAgentId = await resolveAgentId(
    config,
    client,
    workspacePath,
    log,
  );
  const resumableConversation = state.agentId === resolvedAgentId
      && (state.agentModel ?? "auto") === config.model
    ? state.conversationId
    : undefined;
  const opened = await openSessionWithRecovery(
    config,
    client,
    agentScopeKey(config, workspacePath),
    resolvedAgentId,
    resumableConversation,
    workspacePath,
    () => resolveAgentId(config, client, workspacePath, log),
    log,
  );
  const mapped = await updateSessionState(
    config,
    workspacePath,
    sessionId,
    (latest) => ({
      ...latest,
      agentId: opened.agentId,
      agentModel: config.model,
      conversationId: opened.conversationId,
      ...(!latest.lastSeenConversationMessageId && opened.latestMessageId
        ? { lastSeenConversationMessageId: opened.latestMessageId }
        : {}),
    }),
    2_000,
  );
  if (!mapped) {
    opened.session.close();
    throw new Error("无法保存 Letta 会话映射");
  }
  await syncConversationTitle(
    config,
    workspacePath,
    sessionId,
    client,
    opened.conversationId,
    resolveConversationTitle(input),
    log,
  );
  return {
    client,
    agentId: opened.agentId,
    conversationId: opened.conversationId,
    session: opened.session,
  };
}

async function syncConversationTitle(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  client: MappedAgentSession["client"],
  conversationId: string,
  resolved: ResolvedConversationTitle | undefined,
  log: LogFunction,
): Promise<void> {
  if (!resolved || !client.conversations?.update) return;
  const state = loadSessionState(config, workspacePath, sessionId);
  if (
    state.conversationTitle === resolved.value
    && state.conversationTitleSource === resolved.source
  ) return;
  if (
    state.conversationTitleSource !== undefined
    && state.conversationTitleSource !== "prompt"
    && resolved.source === "prompt"
  ) return;

  try {
    await withOperationTimeout(
      client.conversations.update(conversationId, {
        summary: resolved.value,
      }),
      Math.min(Math.max(config.requestTimeoutMs, 500), 3_000),
      "Letta Conversation 标题同步超时",
    );
    await updateSessionState(
      config,
      workspacePath,
      sessionId,
      (latest) => ({
        ...latest,
        conversationTitle: resolved.value,
        conversationTitleSource: resolved.source,
      }),
      2_000,
    );
    log("info", "conversation-title-synced", conversationId);
  } catch (error) {
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    log("warn", "conversation-title-sync-failed", detail);
  }
}

function messageContentText(message: AgentConversationMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part.text ?? part.content ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return message.text?.trim() ?? "";
}

async function markGuidanceRevision(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  revision: string,
): Promise<boolean> {
  let selected = false;
  const updated = await updateSessionState(
    config,
    workspacePath,
    sessionId,
    (state) => {
      if (state.lastInjectedContextRevision === revision) return state;
      selected = true;
      return {
        ...state,
        lastInjectedContextRevision: revision,
      };
    },
    2_000,
  );
  return Boolean(updated && selected);
}

async function withOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readPreparedGuidance(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  agentId: string,
  client: MappedAgentSession["client"],
  log: LogFunction,
  hookEventName: "UserPromptSubmit" | "PreToolUse",
): Promise<string> {
  const reference = loadGuidanceReference(config, workspacePath);
  if (!reference || reference.agentId !== agentId) return "";
  const state = loadSessionState(config, workspacePath, sessionId);
  if (state.lastInjectedContextRevision === reference.revision) return "";
  if (reference.empty) {
    await markGuidanceRevision(
      config,
      workspacePath,
      sessionId,
      reference.revision,
    );
    log("info", "memory-guidance-empty", sessionId);
    return "";
  }
  if (!reference.messageId) return "";
  if (!client.conversations) {
    throw new Error("Letta 客户端不支持读取已完成的下一轮指导消息");
  }

  const page = await withOperationTimeout(
    client.conversations.listMessages(reference.conversationId, {
      order: "desc",
      limit: 100,
    }),
    Math.min(Math.max(config.requestTimeoutMs, 500), 5_000),
    "Letta 下一轮指导读取超时",
  );
  const message = page.messages.find((candidate) => (
    candidate.id === reference.messageId
    && candidate.message_type === "assistant_message"
  ));
  if (!message) throw new Error("Letta 中找不到已完成的下一轮指导消息");
  const context = normalizedGuidance(
    messageContentText(message),
    config.maxContextChars,
  );
  if (!context) {
    await markGuidanceRevision(
      config,
      workspacePath,
      sessionId,
      reference.revision,
    );
    return "";
  }
  if (!await markGuidanceRevision(
    config,
    workspacePath,
    sessionId,
    reference.revision,
  )) return "";

  saveContextSnapshot(config, {
    version: 1,
    agentId,
    workspacePath,
    revision: reference.revision,
    updatedAt: new Date().toISOString(),
    text: context,
  });
  log("info", "memory-guidance-read", sessionId);
  return formatContextForHook(
    context,
    config.maxContextChars,
    "prepared-guidance",
    hookEventName,
  );
}

async function savePreparedGuidance(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  agentId: string,
  conversationId: string,
  client: Awaited<ReturnType<AgentClientFactory>>,
  turn: AgentUpdateResult,
  log: LogFunction,
  preserveExistingOnEmpty: boolean = false,
): Promise<boolean> {
  const trimmedGuidance = normalizedGuidance(
    turn.guidance,
    config.maxContextChars,
  );
  if (!trimmedGuidance && preserveExistingOnEmpty) {
    log("info", "session-guidance-empty", sessionId);
    return false;
  }
  let guidanceMessageId = turn.messageId;
  if (trimmedGuidance && client.conversations) {
    const page = await client.conversations.listMessages(
      conversationId,
      { order: "desc", limit: 100 },
    );
    const exactStreamMessage = guidanceMessageId
      ? page.messages.find((candidate) => (
          candidate.id === guidanceMessageId
          && candidate.message_type === "assistant_message"
          && messageContentText(candidate) === trimmedGuidance
        ))
      : undefined;
    guidanceMessageId = exactStreamMessage?.id
      ?? page.messages.find((candidate) => (
        candidate.message_type === "assistant_message"
        && messageContentText(candidate) === trimmedGuidance
      ))?.id;
  }
  const guidanceRevision = sha256([
    agentId,
    workspacePath,
    conversationId,
    guidanceMessageId ?? "empty",
    trimmedGuidance,
  ].join("\0"));
  saveContextSnapshot(config, {
    version: 1,
    agentId,
    workspacePath,
    revision: guidanceRevision,
    updatedAt: new Date().toISOString(),
    text: trimmedGuidance,
  });
  if (!trimmedGuidance || guidanceMessageId) {
    saveGuidanceReference(config, {
      version: 1,
      agentId,
      workspacePath,
      conversationId,
      ...(guidanceMessageId ? { messageId: guidanceMessageId } : {}),
      revision: guidanceRevision,
      empty: !trimmedGuidance,
      updatedAt: new Date().toISOString(),
    });
    log(
      "info",
      trimmedGuidance ? "memory-guidance-prepared" : "memory-guidance-empty",
      sessionId,
    );
    return Boolean(trimmedGuidance);
  }
  log("warn", "memory-guidance-message-missing", sessionId);
  return false;
}

async function claimSessionStartPreparation(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
): Promise<boolean> {
  const now = Date.now();
  let claimed = false;
  const updated = await updateSessionState(
    config,
    workspacePath,
    sessionId,
    (state) => {
      const previous = Date.parse(state.lastSessionStartPreparationAt ?? "");
      if (
        Number.isFinite(previous)
        && now - previous < SESSION_START_DEDUPLICATION_MS
      ) return state;
      claimed = true;
      return {
        ...state,
        lastSessionStartPreparationAt: new Date(now).toISOString(),
      };
    },
    2_000,
  );
  return Boolean(updated && claimed);
}

export async function handleSessionStart(
  config: RuntimeConfig,
  input: HookInput,
): Promise<string> {
  const sessionId = validSessionId(input);
  if (!sessionId || config.disabled) return "";
  const { workspacePath } = resolveSessionWorkspace(
    config,
    sessionId,
    input.cwd,
  );
  const transcriptPath = normalizeTranscriptPath(
    input.transcript_path,
    workspacePath,
  );
  const forkTail = input.source === "fork"
    ? await transcriptTailLineIndex(transcriptPath)
    : -1;
  await updateSessionState(
    config,
    workspacePath,
    sessionId,
    (state) => {
      if (input.source !== "compact" && input.source !== "fork") return state;
      return {
        version: 1,
        sessionId: state.sessionId,
        workspacePath: state.workspacePath,
        ...(state.agentId !== undefined ? { agentId: state.agentId } : {}),
        ...(state.agentModel !== undefined
          ? { agentModel: state.agentModel }
          : {}),
        ...(state.conversationId !== undefined
          ? { conversationId: state.conversationId }
          : {}),
        ...(state.conversationTitle !== undefined
          ? { conversationTitle: state.conversationTitle }
          : {}),
        ...(state.conversationTitleSource !== undefined
          ? { conversationTitleSource: state.conversationTitleSource }
          : {}),
        ...(state.activatedAt !== undefined
          ? { activatedAt: state.activatedAt }
          : {}),
        ...(state.lastSeenConversationMessageId !== undefined
          ? {
              lastSeenConversationMessageId:
                state.lastSeenConversationMessageId,
            }
          : {}),
        ...(state.lastSessionStartPreparationAt !== undefined
          ? {
              lastSessionStartPreparationAt:
                state.lastSessionStartPreparationAt,
            }
          : {}),
        lastProcessedLine: Math.max(state.lastProcessedLine, forkTail),
        recentDigests: state.recentDigests,
        pendingAssistantDigests: state.pendingAssistantDigests ?? [],
      };
    },
    250,
  );
  return "";
}

export async function handlePrepareSession(
  config: RuntimeConfig,
  input: HookInput,
  log: LogFunction,
  clientFactory: AgentClientFactory = createAgentClient,
): Promise<string> {
  const sessionId = validSessionId(input);
  if (!sessionId || config.disabled) return "";
  const { workspacePath } = resolveSessionWorkspace(
    config,
    sessionId,
    input.cwd,
  );
  if (!await claimSessionStartPreparation(
    config,
    workspacePath,
    sessionId,
  )) {
    log("info", "session-prepare-skipped-duplicate", sessionId);
    return "";
  }

  let agentSession: AgentSession | undefined;
  let release: (() => void) | null = null;
  try {
    const client = await clientFactory(config);
    const agentId = await findExistingAgentId(
      config,
      client,
      workspacePath,
      log,
    );
    if (!agentId) return "";

    const binding = await bindSessionWorkspace(
      config,
      sessionId,
      workspacePath,
      2_000,
    );
    if (binding?.workspacePath !== workspacePath) {
      log("warn", "session-prepare-skipped-workspace-changed", sessionId);
      return "";
    }

    release = acquireLock(
      agentRunLockPath(config, agentScopeKey(config, workspacePath)),
    );
    if (!release) {
      log("info", "session-prepare-skipped-agent-busy", sessionId);
      return "";
    }

    const state = loadSessionState(config, workspacePath, sessionId);
    const resumableConversation = state.agentId === agentId
      ? state.conversationId
      : undefined;
    let opened;
    try {
      opened = await openAgentSession(
        client,
        agentId,
        resumableConversation,
        workspacePath,
      );
    } catch (error) {
      const detail = error instanceof Error ? error : String(error);
      if (!resumableConversation || !isMissingLettaResource(detail)) {
        throw error;
      }
      opened = await openAgentSession(
        client,
        agentId,
        undefined,
        workspacePath,
      );
      log("warn", "conversation-recreated", resumableConversation);
    }
    agentSession = opened.session;

    const mapped = await updateSessionState(
      config,
      workspacePath,
      sessionId,
      (latest) => ({
        ...latest,
        agentId,
        agentModel: config.model,
        conversationId: opened.conversationId,
        ...(!latest.lastSeenConversationMessageId && opened.latestMessageId
          ? { lastSeenConversationMessageId: opened.latestMessageId }
          : {}),
      }),
      2_000,
    );
    if (!mapped) throw new Error("无法保存 SessionStart 的 Letta 会话映射");

    await syncConversationTitle(
      config,
      workspacePath,
      sessionId,
      client,
      opened.conversationId,
      resolveConversationTitle(input),
      log,
    );
    const turn = await sendAgentUpdateWithResult(
      opened.session,
      formatSessionStartForAgent(sessionId, workspacePath),
    );
    const prepared = await savePreparedGuidance(
      config,
      workspacePath,
      sessionId,
      agentId,
      opened.conversationId,
      client,
      turn,
      log,
      true,
    );
    if (prepared) log("info", "session-guidance-prepared", sessionId);
  } catch (error) {
    if (isLettaSetupError(error)) throw error;
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    log("warn", "session-prepare-failed", detail);
  } finally {
    try {
      agentSession?.close();
    } catch (error) {
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      log("warn", "session-close-failed", detail);
    }
    release?.();
  }
  return "";
}

export async function handleInjectContext(
  config: RuntimeConfig,
  input: HookInput,
  log: LogFunction = () => {},
  clientFactory: AgentClientFactory = createAgentClient,
): Promise<string> {
  const sessionId = validSessionId(input);
  if (!sessionId || config.disabled) return "";
  const prompt = input.prompt?.trim();
  if (!prompt) {
    const { workspacePath } = resolveSessionWorkspace(
      config,
      sessionId,
      input.cwd,
    );
    log("info", "memory-read-fallback", "missing-prompt");
    return claimCachedContext(config, sessionId, workspacePath);
  }

  const workspacePath = await activateSessionWorkspace(
    config,
    sessionId,
    input.cwd,
    log,
  );

  const activated = await updateSessionState(
    config,
    workspacePath,
    sessionId,
    (state) => ({
      ...state,
      activatedAt: state.activatedAt ?? new Date().toISOString(),
    }),
    2_000,
  );
  if (!activated) {
    log("warn", "session-activation-failed", sessionId);
    return claimCachedContext(config, sessionId, workspacePath);
  }

  log("info", "memory-guidance-read-started", sessionId);
  let agentSession: AgentSession | undefined;
  try {
    const opened = await openMappedAgentSession(
      config,
      workspacePath,
      input,
      log,
      clientFactory,
    );
    agentSession = opened.session;
    return await readPreparedGuidance(
      config,
      workspacePath,
      sessionId,
      opened.agentId,
      opened.client,
      log,
      "UserPromptSubmit",
    );
  } catch (error) {
    if (isLettaSetupError(error)) throw error;
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    log("warn", "memory-read-fallback", detail);
    return claimCachedContext(config, sessionId, workspacePath);
  } finally {
    try {
      agentSession?.close();
    } catch (error) {
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      log("warn", "session-close-failed", detail);
    }
  }
}

export async function handleSyncContext(
  config: RuntimeConfig,
  input: HookInput,
  log: LogFunction,
  clientFactory: AgentClientFactory = createAgentClient,
): Promise<string> {
  const sessionId = validSessionId(input);
  if (!sessionId || config.disabled) return "";
  const { workspacePath } = resolveSessionWorkspace(
    config,
    sessionId,
    input.cwd,
  );
  const state = loadSessionState(config, workspacePath, sessionId);
  if (!state.conversationId || !state.agentId) return "";

  try {
    const client = await clientFactory(config);
    await syncConversationTitle(
      config,
      workspacePath,
      sessionId,
      client,
      state.conversationId,
      resolveConversationTitle(input),
      log,
    );
    return await readPreparedGuidance(
      config,
      workspacePath,
      sessionId,
      state.agentId,
      client,
      log,
      "PreToolUse",
    );
  } catch (error) {
    if (isLettaSetupError(error)) throw error;
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    log("warn", "memory-guidance-sync-failed", detail);
    return "";
  }
}

async function advanceEmptyBatch(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  batch: Awaited<ReturnType<typeof readTranscriptIncrement>>,
): Promise<void> {
  const advanced = await updateSessionState(
    config,
    workspacePath,
    sessionId,
    (state) => ({
      ...state,
      lastProcessedLine: Math.max(state.lastProcessedLine, batch.lastLineIndex),
      pendingAssistantDigests: reconcileAssistantDigests(
        state.pendingAssistantDigests ?? [],
        batch.consumedAssistantDigests,
        batch.addedAssistantDigests,
      ),
    }),
    2_000,
  );
  if (!advanced) throw new Error("无法提交空 transcript 批次游标");
}

function pendingInput(pending: PendingUpdate): HookInput {
  return {
    session_id: pending.sessionId,
    ...(pending.transcriptPath
      ? { transcript_path: pending.transcriptPath }
      : {}),
    cwd: pending.workspacePath,
    ...(pending.lastAssistantMessage
      ? { last_assistant_message: pending.lastAssistantMessage }
      : {}),
  };
}

export async function handleEnqueueMemory(
  config: RuntimeConfig,
  input: HookInput,
  log: LogFunction,
): Promise<string> {
  const sessionId = validSessionId(input);
  if (!sessionId || config.disabled) return "";
  const { workspacePath } = resolveSessionWorkspace(
    config,
    sessionId,
    input.cwd,
  );
  const transcriptPath = normalizeTranscriptPath(
    input.transcript_path,
    workspacePath,
  );
  const state = loadSessionState(config, workspacePath, sessionId);
  if (!state.activatedAt) {
    log("info", "memory-update-skipped-inactive", sessionId);
    return "";
  }
  const transcriptEndLine = await transcriptTailLineIndex(transcriptPath);
  const revision = randomUUID();
  const enqueuedAt = new Date();
  savePendingUpdate(config, {
    version: 1,
    revision,
    sessionId,
    workspacePath,
    ...(transcriptPath ? { transcriptPath } : {}),
    transcriptEndLine,
    ...(input.last_assistant_message?.trim()
      ? { lastAssistantMessage: input.last_assistant_message }
      : {}),
    enqueuedAt: enqueuedAt.toISOString(),
    enqueuedOrder: `${process.hrtime.bigint().toString().padStart(24, "0")}-${revision}`,
  });
  log("info", "memory-update-queued", sessionId);
  return "";
}

async function processPendingUpdate(
  config: RuntimeConfig,
  pending: PendingUpdate,
  log: LogFunction,
  clientFactory: AgentClientFactory,
): Promise<void> {
  const input = pendingInput(pending);
  const sessionId = pending.sessionId;
  const workspacePath = pending.workspacePath;
  let agentSession: AgentSession | undefined;
  let agentClient: Awaited<ReturnType<AgentClientFactory>> | undefined;
  try {
    let state = loadSessionState(config, workspacePath, sessionId);
    let agentId = state.agentId;
    let conversationId = state.conversationId;

    while (true) {
      const batch = await readTranscriptIncrement(
        input.transcript_path,
        state.lastProcessedLine,
        state.recentDigests,
        input.last_assistant_message,
        config.maxBatchChars,
        pending.transcriptEndLine,
        state.pendingAssistantDigests ?? [],
      );

      if (batch.events.length === 0) {
        await advanceEmptyBatch(config, workspacePath, sessionId, batch);
        clearFailureState(config);
        return;
      }

      if (!agentSession) {
        const client = await clientFactory(config);
        agentClient = client;
        const resolvedAgentId = await resolveAgentId(
          config,
          client,
          workspacePath,
          log,
        );
        const stateModel = state.agentModel ?? "auto";
        const resumableConversation = state.agentId === resolvedAgentId
            && stateModel === config.model
          ? state.conversationId
          : undefined;
        const opened = await openSessionWithRecovery(
          config,
          client,
          agentScopeKey(config, workspacePath),
          resolvedAgentId,
          resumableConversation,
          workspacePath,
          () => resolveAgentId(config, client, workspacePath, log),
          log,
        );
        agentSession = opened.session;
        const openedAgentId = opened.agentId;
        const openedConversationId = opened.conversationId;
        agentId = openedAgentId;
        conversationId = openedConversationId;

        const mapped = await updateSessionState(
          config,
          workspacePath,
          sessionId,
          (latest) => ({
            ...latest,
            agentId: openedAgentId,
            agentModel: config.model,
            conversationId: openedConversationId,
          }),
          2_000,
        );
        if (!mapped) throw new Error("无法保存 Letta 会话映射");
        state = mapped;
        await syncConversationTitle(
          config,
          workspacePath,
          sessionId,
          client,
          openedConversationId,
          resolveConversationTitle(input),
          log,
        );
      }

      if (!agentId || !conversationId) {
        throw new Error("Letta 会话映射不完整");
      }
      const activeAgentId = agentId;
      const activeConversationId = conversationId;
      const message = formatTranscriptForAgent(
        sessionId,
        workspacePath,
        batch.events,
      );
      const turn = await sendAgentUpdateWithResult(agentSession, message);
      if (!agentClient) throw new Error("Letta Agent 客户端尚未初始化");
      await savePreparedGuidance(
        config,
        workspacePath,
        sessionId,
        activeAgentId,
        activeConversationId,
        agentClient,
        turn,
        log,
      );

      const committed = await updateSessionState(
        config,
        workspacePath,
        sessionId,
        (latest) => ({
          ...latest,
          agentId: activeAgentId,
          agentModel: config.model,
          conversationId: activeConversationId,
          lastProcessedLine: Math.max(
            latest.lastProcessedLine,
            batch.lastLineIndex,
          ),
          recentDigests: recentDigests(
            latest.recentDigests,
            batch.events.map((event) => event.digest),
          ),
          pendingAssistantDigests: reconcileAssistantDigests(
            latest.pendingAssistantDigests ?? [],
            batch.consumedAssistantDigests,
            batch.addedAssistantDigests,
          ),
        }),
        2_000,
      );
      if (!committed) throw new Error("无法提交 transcript 处理游标");
      state = committed;
      clearFailureState(config);
      log("info", "memory-updated", sessionId);
      if (!batch.hasMore) break;
    }
  } finally {
    try {
      agentSession?.close();
    } catch (error) {
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      log("warn", "session-close-failed", detail);
    }
  }
}

export async function handleDrainPending(
  config: RuntimeConfig,
  log: LogFunction,
  clientFactory: AgentClientFactory = createAgentClient,
): Promise<string> {
  if (config.disabled) return "";
  if (isRetryBlocked(config)) {
    log("info", "update-deferred-backoff");
    return "";
  }

  let failures = 0;
  while (true) {
    const pendingUpdates = listPendingUpdates(config);
    if (pendingUpdates.length === 0) break;
    let progressed = false;

    for (const pending of pendingUpdates) {
      const scopeKey = agentScopeKey(config, pending.workspacePath);
      const release = acquireLock(agentRunLockPath(config, scopeKey));
      if (!release) {
        log("info", "update-deferred-agent-busy", pending.sessionId);
        continue;
      }
      try {
        const stillPending = listPendingUpdates(config, true).some(
          (candidate) => candidate.revision === pending.revision,
        );
        if (!stillPending) continue;
        try {
          await processPendingUpdate(config, pending, log, clientFactory);
        } catch (error) {
          recordFailure(config);
          deferPendingUpdate(
            config,
            pending,
            pendingRetryDelay(pending),
          );
          const detail = error instanceof Error
            ? errorDetail(error)
            : String(error);
          log("error", "memory-update-failed", detail);
          failures += 1;
          progressed = true;
          if (failures >= 3) return "";
          continue;
        }

        if (!removePendingUpdate(
          config,
          pending.workspacePath,
          pending.sessionId,
          pending.revision,
        )) {
          log("info", "pending-update-retained", pending.sessionId);
          return "";
        }
        progressed = true;
      } finally {
        release();
      }
    }
    if (!progressed) break;
  }
  return "";
}

export async function handleUpdateMemory(
  config: RuntimeConfig,
  input: HookInput,
  log: LogFunction,
  clientFactory: AgentClientFactory = createAgentClient,
): Promise<string> {
  try {
    await handleEnqueueMemory(config, input, log);
    await handleDrainPending(config, log, clientFactory);
  } catch (error) {
    recordFailure(config);
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    log("error", "memory-update-failed", detail);
  }
  return "";
}
