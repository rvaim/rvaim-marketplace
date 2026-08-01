import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  claimCachedContext,
  formatContextForHook,
  normalizeWorkspacePath,
} from "./context.js";
import {
  agentScopeKey,
  createAgentClient,
  formatMemoryContextRequest,
  openAgentSession,
  resolveAgentId,
  sendAgentUpdate,
} from "./letta.js";
import type {
  AgentClientFactory,
  AgentConversationMessage,
  AgentSession,
} from "./letta.js";
import { errorDetail } from "./logger.js";
import {
  acquireLock,
  agentRunLockPath,
  clearAgentReference,
  clearFailureState,
  deferPendingUpdate,
  loadFailureState,
  listPendingUpdates,
  loadSessionState,
  removePendingUpdate,
  saveContextSnapshot,
  saveFailureState,
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForAgentRunLock(
  config: RuntimeConfig,
  scopeKey: string,
  waitMs: number = Math.min(
    Math.max(config.requestTimeoutMs + 10_000, 1_000),
    160_000,
  ),
): Promise<(() => void) | null> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await delay(25);
    const release = acquireLock(agentRunLockPath(config, scopeKey));
    if (release) return release;
  }
  return null;
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
  sessionId: string,
  log: LogFunction,
  clientFactory: AgentClientFactory,
): Promise<MappedAgentSession> {
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
  return {
    client,
    agentId: opened.agentId,
    conversationId: opened.conversationId,
    session: opened.session,
  };
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

async function updateConversationCursor(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  client: MappedAgentSession["client"],
  conversationId: string,
): Promise<void> {
  if (!client.conversations) return;
  const page = await withOperationTimeout(
    client.conversations.listMessages(conversationId, {
      order: "desc",
      limit: 1,
    }),
    Math.min(Math.max(config.requestTimeoutMs, 500), 3_000),
    "Letta Conversation 游标同步超时",
  );
  const latestMessageId = page.messages.find(
    (message) => typeof message.id === "string" && message.id,
  )?.id;
  if (!latestMessageId) return;
  await updateSessionState(
    config,
    workspacePath,
    sessionId,
    (state) => ({
      ...state,
      lastSeenConversationMessageId: latestMessageId,
    }),
    2_000,
  );
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

async function sendAgentUpdateWithTimeout(
  session: AgentSession,
  message: string,
  timeoutMs: number,
): Promise<string> {
  return withOperationTimeout(
    sendAgentUpdate(session, message),
    timeoutMs,
    "Letta 实时记忆检索超时",
  );
}

export async function handleSessionStart(
  config: RuntimeConfig,
  input: HookInput,
): Promise<string> {
  const sessionId = validSessionId(input);
  if (!sessionId || config.disabled) return "";
  const workspacePath = normalizeWorkspacePath(input.cwd);
  const transcriptPath = normalizeTranscriptPath(
    input.transcript_path,
    input.cwd,
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
        ...(state.lastSeenConversationMessageId !== undefined
          ? {
              lastSeenConversationMessageId:
                state.lastSeenConversationMessageId,
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
  const workspacePath = normalizeWorkspacePath(input.cwd);
  const scopeKey = agentScopeKey(config, workspacePath);
  const release = acquireLock(agentRunLockPath(config, scopeKey));
  if (!release) {
    log("info", "session-prepare-deferred-agent-busy", sessionId);
    return "";
  }

  let agentSession: AgentSession | undefined;
  try {
    const opened = await openMappedAgentSession(
      config,
      workspacePath,
      sessionId,
      log,
      clientFactory,
    );
    agentSession = opened.session;
    log(
      "info",
      "session-prepared",
      `${opened.agentId}:${opened.conversationId}`,
    );
  } catch (error) {
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    log("warn", "session-prepare-failed", detail);
  } finally {
    try {
      agentSession?.close();
    } catch (error) {
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      log("warn", "session-close-failed", detail);
    }
    release();
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
  const workspacePath = normalizeWorkspacePath(input.cwd);
  const prompt = input.prompt?.trim();
  if (!prompt) {
    log("info", "memory-read-fallback", "missing-prompt");
    return claimCachedContext(config, sessionId, workspacePath);
  }

  const scopeKey = agentScopeKey(config, workspacePath);
  log("info", "memory-read-started", sessionId);
  let release = acquireLock(agentRunLockPath(config, scopeKey));
  if (!release) {
    release = await waitForAgentRunLock(
      config,
      scopeKey,
      Math.min(Math.max(config.requestTimeoutMs, 1_000), 5_000),
    );
  }
  if (!release) {
    log("info", "memory-read-fallback", "agent-busy");
    return claimCachedContext(config, sessionId, workspacePath);
  }

  let agentSession: AgentSession | undefined;
  try {
    const opened = await openMappedAgentSession(
      config,
      workspacePath,
      sessionId,
      log,
      clientFactory,
    );
    agentSession = opened.session;
    const request = formatMemoryContextRequest(
      sessionId,
      workspacePath,
      prompt,
    );
    const guidance = await sendAgentUpdateWithTimeout(
      opened.session,
      request,
      Math.min(Math.max(config.requestTimeoutMs, 1_000), 30_000),
    );
    const context = normalizedGuidance(guidance, config.maxContextChars);
    try {
      await updateConversationCursor(
        config,
        workspacePath,
        sessionId,
        opened.client,
        opened.conversationId,
      );
    } catch (error) {
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      log("warn", "conversation-cursor-update-failed", detail);
    }
    if (!context) {
      log("info", "memory-read-empty", sessionId);
      return "";
    }

    const revision = sha256(
      `${opened.agentId}\0${workspacePath}\0${context}`,
    );
    saveContextSnapshot(config, {
      version: 1,
      agentId: opened.agentId,
      workspacePath,
      revision,
      updatedAt: new Date().toISOString(),
      text: context,
    });
    await updateSessionState(
      config,
      workspacePath,
      sessionId,
      (state) => ({
        ...state,
        lastInjectedContextRevision: revision,
      }),
      2_000,
    );
    log("info", "memory-read-live", sessionId);
    return formatContextForHook(
      context,
      config.maxContextChars,
      "live-agent",
    );
  } catch (error) {
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    const event = detail.includes("实时记忆检索超时")
      ? "memory-read-timeout"
      : "memory-read-fallback";
    log("warn", event, detail);
    const closingSession = agentSession;
    agentSession = undefined;
    try {
      closingSession?.close();
    } catch {
      // 超时后的关闭仅用于尽快释放 SDK 会话。
    }
    return claimCachedContext(config, sessionId, workspacePath);
  } finally {
    try {
      agentSession?.close();
    } catch (error) {
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      log("warn", "session-close-failed", detail);
    }
    release();
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
  const workspacePath = normalizeWorkspacePath(input.cwd);
  const state = loadSessionState(config, workspacePath, sessionId);
  if (!state.conversationId || !state.agentId) return "";

  try {
    const client = await clientFactory(config);
    if (!client.conversations) return "";
    if (!state.lastSeenConversationMessageId) {
      await updateConversationCursor(
        config,
        workspacePath,
        sessionId,
        client,
        state.conversationId,
      );
      return "";
    }
    const page = await withOperationTimeout(
      client.conversations.listMessages(
        state.conversationId,
        {
          after: state.lastSeenConversationMessageId,
          order: "asc",
          limit: 100,
        },
      ),
      Math.min(Math.max(config.requestTimeoutMs, 500), 5_000),
      "Letta Conversation 增量同步超时",
    );
    const latestMessageId = page.messages.at(-1)?.id;
    if (latestMessageId) {
      await updateSessionState(
        config,
        workspacePath,
        sessionId,
        (latest) => ({
          ...latest,
          lastSeenConversationMessageId: latestMessageId,
        }),
        2_000,
      );
    }
    const messages = page.messages
      .filter((message) => message.message_type === "assistant_message")
      .map(messageContentText)
      .map((message) => normalizedGuidance(message, config.maxContextChars))
      .filter(Boolean);
    if (messages.length === 0) return "";
    log("info", "memory-read-conversation-sync", sessionId);
    return formatContextForHook(
      messages.join("\n\n"),
      config.maxContextChars,
      "conversation-sync",
      "PreToolUse",
    );
  } catch (error) {
    const detail = error instanceof Error ? errorDetail(error) : String(error);
    log("warn", "memory-read-conversation-sync-failed", detail);
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
  const transcriptPath = normalizeTranscriptPath(
    input.transcript_path,
    input.cwd,
  );
  const workspacePath = normalizeWorkspacePath(input.cwd);
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
      const guidance = await sendAgentUpdate(agentSession, message);
      const trimmedGuidance = normalizedGuidance(
        guidance,
        config.maxContextChars,
      );
      if (trimmedGuidance) {
        saveContextSnapshot(config, {
          version: 1,
          agentId: activeAgentId,
          workspacePath,
          revision: sha256(
            `${activeAgentId}\0${workspacePath}\0${trimmedGuidance}`,
          ),
          updatedAt: new Date().toISOString(),
          text: trimmedGuidance,
        });
      }

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
