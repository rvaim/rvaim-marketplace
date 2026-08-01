import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  claimCachedContext,
  normalizeWorkspacePath,
} from "./context.js";
import {
  agentScopeKey,
  createAgentClient,
  openAgentSession,
  resolveAgentId,
  resolveSharedAgentId,
  sendAgentUpdate,
  sharedAgentScopeKey,
} from "./letta.js";
import type {
  AgentClientFactory,
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
  formatTranscriptForSharedAgent,
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

function combinedGuidance(
  workspaceGuidance: string,
  sharedGuidance: string,
  maxChars: number,
): string {
  if (!workspaceGuidance) return sharedGuidance.slice(0, maxChars);
  if (!sharedGuidance || workspaceGuidance.includes(sharedGuidance)) {
    return workspaceGuidance.slice(0, maxChars);
  }
  const workspaceLabel = "工作区记忆：\n";
  const sharedLabel = "\n\n共享记忆：\n";
  const available = Math.max(
    0,
    maxChars - workspaceLabel.length - sharedLabel.length,
  );
  const workspaceLimit = Math.ceil(available * 0.6);
  const sharedLimit = available - workspaceLimit;
  const workspaceContext = workspaceGuidance.slice(0, workspaceLimit);
  const sharedContext = sharedGuidance.slice(0, sharedLimit);
  return `${workspaceLabel}${workspaceContext}${sharedLabel}${sharedContext}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForAgentRunLock(
  config: RuntimeConfig,
): Promise<(() => void) | null> {
  const waitMs = Math.min(
    Math.max(config.requestTimeoutMs + 10_000, 1_000),
    160_000,
  );
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await delay(25);
    const release = acquireLock(agentRunLockPath(config));
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
  resolveCurrentAgentId: () => Promise<string>,
  log: LogFunction,
): Promise<{
  agentId: string;
  session: AgentSession;
  conversationId: string;
}> {
  let lastError: Error | string = "Letta 会话恢复失败";
  try {
    const opened = await openAgentSession(
      client,
      initialAgentId,
      conversationId,
    );
    return { agentId: initialAgentId, ...opened };
  } catch (error) {
    lastError = error instanceof Error ? error : String(error);
    if (!isMissingLettaResource(lastError)) throw error;
  }

  if (conversationId) {
    try {
      const opened = await openAgentSession(client, initialAgentId, undefined);
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
  const opened = await openAgentSession(client, recoveredAgentId, undefined);
  log("warn", "agent-reference-recreated", initialAgentId);
  return { agentId: recoveredAgentId, ...opened };
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
        ...(state.sharedAgentId !== undefined
          ? { sharedAgentId: state.sharedAgentId }
          : {}),
        ...(state.sharedAgentModel !== undefined
          ? { sharedAgentModel: state.sharedAgentModel }
          : {}),
        ...(state.sharedConversationId !== undefined
          ? { sharedConversationId: state.sharedConversationId }
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

export async function handleInjectContext(
  config: RuntimeConfig,
  input: HookInput,
): Promise<string> {
  const sessionId = validSessionId(input);
  if (!sessionId || config.disabled) return "";
  return claimCachedContext(
    config,
    sessionId,
    normalizeWorkspacePath(input.cwd),
  );
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
  const useDedicatedSharedAgent = config.sharedMemory && !config.mixedMemory;
  let agentSession: AgentSession | undefined;
  let sharedAgentSession: AgentSession | undefined;
  try {
    let state = loadSessionState(config, workspacePath, sessionId);
    let agentId = state.agentId;
    let conversationId = state.conversationId;
    let sharedAgentId = state.sharedAgentId;
    let sharedConversationId = state.sharedConversationId;

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
        if (useDedicatedSharedAgent && !sharedAgentSession) {
          const resolvedSharedAgentId = await resolveSharedAgentId(
            config,
            client,
            log,
          );
          const sharedStateModel = state.sharedAgentModel ?? "auto";
          const resumableSharedConversation = (
            state.sharedAgentId === resolvedSharedAgentId
            && sharedStateModel === config.model
          )
            ? state.sharedConversationId
            : undefined;
          const openedShared = await openSessionWithRecovery(
            config,
            client,
            sharedAgentScopeKey(),
            resolvedSharedAgentId,
            resumableSharedConversation,
            () => resolveSharedAgentId(config, client, log),
            log,
          );
          sharedAgentSession = openedShared.session;
          sharedAgentId = openedShared.agentId;
          sharedConversationId = openedShared.conversationId;

          const sharedMapped = await updateSessionState(
            config,
            workspacePath,
            sessionId,
            (latest) => ({
              ...latest,
              sharedAgentId: openedShared.agentId,
              sharedAgentModel: config.model,
              sharedConversationId: openedShared.conversationId,
            }),
            2_000,
          );
          if (!sharedMapped) throw new Error("无法保存 Letta 共享会话映射");
          state = sharedMapped;
        }

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
      if (
        useDedicatedSharedAgent
        && (!sharedAgentSession || !sharedAgentId || !sharedConversationId)
      ) {
        throw new Error("Letta 共享会话映射不完整");
      }
      const activeAgentId = agentId;
      const activeConversationId = conversationId;
      let sharedGuidance = "";
      if (useDedicatedSharedAgent && sharedAgentSession) {
        const sharedMessage = formatTranscriptForSharedAgent(
          sessionId,
          workspacePath,
          batch.events,
        );
        sharedGuidance = normalizedGuidance(
          await sendAgentUpdate(sharedAgentSession, sharedMessage),
          config.maxContextChars,
        );
      }
      const message = formatTranscriptForAgent(
        sessionId,
        workspacePath,
        batch.events,
        config.mixedMemory,
        config.sharedMemory,
        sharedGuidance,
      );
      const guidance = await sendAgentUpdate(agentSession, message);
      const trimmedGuidance = normalizedGuidance(
        guidance,
        config.maxContextChars,
      );
      const contextGuidance = combinedGuidance(
        trimmedGuidance,
        sharedGuidance,
        config.maxContextChars,
      );

      if (contextGuidance) {
        saveContextSnapshot(config, {
          version: 1,
          agentId: activeAgentId,
          workspacePath,
          revision: sha256(
            `${activeAgentId}\0${workspacePath}\0${contextGuidance}`,
          ),
          updatedAt: new Date().toISOString(),
          text: contextGuidance,
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
          ...(useDedicatedSharedAgent
            ? {
              sharedAgentId,
              sharedAgentModel: config.model,
              sharedConversationId,
            }
            : {}),
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
    try {
      sharedAgentSession?.close();
    } catch (error) {
      const detail = error instanceof Error ? errorDetail(error) : String(error);
      log("warn", "shared-session-close-failed", detail);
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

  let release = acquireLock(agentRunLockPath(config));
  if (!release) {
    log("info", "update-waiting-agent-busy");
    release = await waitForAgentRunLock(config);
  }
  if (!release) {
    log("info", "update-deferred-agent-busy");
    return "";
  }

  try {
    while (true) {
      const pendingUpdates = listPendingUpdates(config);
      if (pendingUpdates.length === 0) break;

      let failures = 0;
      for (const pending of pendingUpdates) {
        try {
          await processPendingUpdate(config, pending, log, clientFactory);
        } catch (error) {
          recordFailure(config);
          deferPendingUpdate(
            config,
            pending,
            pendingRetryDelay(pending),
          );
          const detail = error instanceof Error ? errorDetail(error) : String(error);
          log("error", "memory-update-failed", detail);
          failures += 1;
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
      }
    }
  } finally {
    release();
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
