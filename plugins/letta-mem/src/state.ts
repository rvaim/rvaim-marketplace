import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  AgentReference,
  ContextSnapshot,
  FailureState,
  PendingUpdate,
  RuntimeConfig,
  SessionState,
} from "./types.js";

const LOCK_STALE_MS = 7 * 60 * 1_000;
const LOCK_HEARTBEAT_MS = 30 * 1_000;

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // 目录权限修复失败时，后续实际读写仍会按故障开放处理。
  }
}

function hash(value: string, length = 24): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function namespaceDir(config: RuntimeConfig): string {
  const stateRoot = join(config.dataDir, "state");
  const path = join(stateRoot, config.namespace);
  ensurePrivateDirectory(stateRoot);
  ensurePrivateDirectory(path);
  return path;
}

function coordinationNamespaceDir(config: RuntimeConfig): string {
  const path = join(config.coordinationDir, config.namespace);
  ensurePrivateDirectory(config.coordinationDir);
  ensurePrivateDirectory(path);
  return path;
}

function readJson<T>(path: string): T | null {
  try {
    chmodSync(path, 0o600);
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, value: object): void {
  ensurePrivateDirectory(dirname(path));
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

function sessionPath(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
): string {
  return join(
    namespaceDir(config),
    "sessions",
    `${hash(`${workspacePath}\0${sessionId}`)}.json`,
  );
}

export function sessionLockPath(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
): string {
  return join(
    namespaceDir(config),
    "locks",
    `session-${hash(`${workspacePath}\0${sessionId}`)}.lock`,
  );
}

export function agentRunLockPath(
  config: RuntimeConfig,
  scopeKey: string = "global",
): string {
  return join(
    coordinationNamespaceDir(config),
    "locks",
    `agent-run-${hash(scopeKey)}.lock`,
  );
}

export function agentLockPath(
  config: RuntimeConfig,
  scopeKey: string = "global",
): string {
  return join(
    coordinationNamespaceDir(config),
    "locks",
    `agent-${hash(scopeKey)}.lock`,
  );
}

export function loadSessionState(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
): SessionState {
  const value = readJson<SessionState>(
    sessionPath(config, workspacePath, sessionId),
  );
  if (
    value?.version === 1
    && value.sessionId === sessionId
    && value.workspacePath === workspacePath
    && Number.isInteger(value.lastProcessedLine)
    && Array.isArray(value.recentDigests)
  ) {
    return {
      version: 1,
      sessionId,
      workspacePath,
      ...(typeof value.agentId === "string"
        ? { agentId: value.agentId }
        : {}),
      ...(typeof value.agentModel === "string"
        ? { agentModel: value.agentModel }
        : {}),
      ...(typeof value.conversationId === "string"
        ? { conversationId: value.conversationId }
        : {}),
      ...(typeof value.conversationTitle === "string"
        ? { conversationTitle: value.conversationTitle }
        : {}),
      ...(value.conversationTitleSource === "hook"
          || value.conversationTitleSource === "codex"
          || value.conversationTitleSource === "prompt"
        ? { conversationTitleSource: value.conversationTitleSource }
        : {}),
      ...(typeof value.activatedAt === "string"
        ? { activatedAt: value.activatedAt }
        : {}),
      ...(typeof value.lastInjectedContextRevision === "string"
        ? { lastInjectedContextRevision: value.lastInjectedContextRevision }
        : {}),
      ...(typeof value.lastSeenConversationMessageId === "string"
        ? {
            lastSeenConversationMessageId:
              value.lastSeenConversationMessageId,
          }
        : {}),
      lastProcessedLine: value.lastProcessedLine,
      recentDigests: value.recentDigests.filter(
        (digest): digest is string => typeof digest === "string",
      ).slice(-300),
      pendingAssistantDigests: Array.isArray(value.pendingAssistantDigests)
        ? value.pendingAssistantDigests.filter(
          (digest): digest is string => typeof digest === "string",
        ).slice(-100)
        : [],
    };
  }
  return {
    version: 1,
    sessionId,
    workspacePath,
    lastProcessedLine: -1,
    recentDigests: [],
    pendingAssistantDigests: [],
  };
}

export function saveSessionState(
  config: RuntimeConfig,
  state: SessionState,
): void {
  writeJsonAtomic(
    sessionPath(config, state.workspacePath, state.sessionId),
    state,
  );
}

function agentReferencePath(
  config: RuntimeConfig,
  scopeKey: string,
): string {
  return join(
    coordinationNamespaceDir(config),
    "agents",
    `${hash(scopeKey)}.json`,
  );
}

function legacyAgentReferencePath(
  config: RuntimeConfig,
  scopeKey: string,
): string {
  return join(
    namespaceDir(config),
    "agents",
    `${hash(scopeKey)}.json`,
  );
}

interface StoredAgentReference {
  version: 1;
  agentId: string;
  scopeKey?: string;
  workspacePath?: string;
  model?: string;
  definitionVersion?: number;
  updatedAt: string;
}

function loadAgentReferenceAtPath(
  path: string,
  scopeKey: string,
): AgentReference | null {
  const value = readJson<StoredAgentReference>(path);
  const storedScopeKey = value?.scopeKey ?? value?.workspacePath;
  if (
    value?.version !== 1
    || storedScopeKey !== scopeKey
    || typeof value.agentId !== "string"
  ) return null;
  return {
    version: 1,
    agentId: value.agentId,
    scopeKey,
    model: typeof value.model === "string" ? value.model : "auto",
    ...(Number.isInteger(value.definitionVersion)
      ? { definitionVersion: value.definitionVersion }
      : {}),
    updatedAt: value.updatedAt,
  };
}

export function loadSharedAgentReference(
  config: RuntimeConfig,
  scopeKey: string,
): AgentReference | null {
  return loadAgentReferenceAtPath(agentReferencePath(config, scopeKey), scopeKey);
}

export function loadAgentReference(
  config: RuntimeConfig,
  scopeKey: string,
): AgentReference | null {
  return loadSharedAgentReference(config, scopeKey)
    ?? loadAgentReferenceAtPath(
      legacyAgentReferencePath(config, scopeKey),
      scopeKey,
    );
}

export function saveAgentReference(
  config: RuntimeConfig,
  scopeKey: string,
  agentId: string,
  model: string = "auto",
): void {
  writeJsonAtomic(agentReferencePath(config, scopeKey), {
    version: 1,
    agentId,
    scopeKey,
    model,
    definitionVersion: 6,
    updatedAt: new Date().toISOString(),
  } satisfies AgentReference);
}

export function clearAgentReference(
  config: RuntimeConfig,
  scopeKey: string,
  expectedAgentId: string,
): boolean {
  let removed = false;
  for (const path of [
    agentReferencePath(config, scopeKey),
    legacyAgentReferencePath(config, scopeKey),
  ]) {
    const current = loadAgentReferenceAtPath(path, scopeKey);
    if (current?.agentId !== expectedAgentId) continue;
    try {
      unlinkSync(path);
      removed = true;
    } catch {
      // 文件已被其他进程清理时继续检查另一个引用。
    }
  }
  return removed;
}

function contextPath(config: RuntimeConfig, workspacePath: string): string {
  return join(namespaceDir(config), "contexts", `${hash(workspacePath)}.json`);
}

export function loadContextSnapshot(
  config: RuntimeConfig,
  workspacePath: string,
): ContextSnapshot | null {
  const value = readJson<ContextSnapshot>(contextPath(config, workspacePath));
  return value?.version === 1
      && value.workspacePath === workspacePath
      && typeof value.text === "string"
      && typeof value.revision === "string"
    ? value
    : null;
}

export function saveContextSnapshot(
  config: RuntimeConfig,
  snapshot: ContextSnapshot,
): void {
  writeJsonAtomic(contextPath(config, snapshot.workspacePath), snapshot);
}

export function loadFailureState(config: RuntimeConfig): FailureState | null {
  const value = readJson<FailureState>(join(namespaceDir(config), "failures.json"));
  return value?.version === 1 && Number.isInteger(value.failures) ? value : null;
}

export function saveFailureState(config: RuntimeConfig, state: FailureState): void {
  writeJsonAtomic(join(namespaceDir(config), "failures.json"), state);
}

export function clearFailureState(config: RuntimeConfig): void {
  try {
    unlinkSync(join(namespaceDir(config), "failures.json"));
  } catch {
    // 文件不存在或删除失败时无需影响主流程。
  }
}

function pendingDirectory(config: RuntimeConfig): string {
  return join(namespaceDir(config), "pending");
}

function pendingPath(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  revision: string,
): string {
  return join(
    pendingDirectory(config),
    `${hash(`${workspacePath}\0${sessionId}`)}-${revision}.json`,
  );
}

export function savePendingUpdate(
  config: RuntimeConfig,
  pending: PendingUpdate,
): void {
  writeJsonAtomic(
    pendingPath(
      config,
      pending.workspacePath,
      pending.sessionId,
      pending.revision,
    ),
    pending,
  );
}

function pendingSessionKey(value: Pick<PendingUpdate, "workspacePath" | "sessionId">): string {
  return `${value.workspacePath}\0${value.sessionId}`;
}

function orderPendingUpdates(values: PendingUpdate[]): PendingUpdate[] {
  const orderKey = (value: PendingUpdate): string => (
    value.enqueuedOrder ?? `${value.enqueuedAt}-${value.revision}`
  );
  const groups = new Map<string, PendingUpdate[]>();
  for (const value of values) {
    const key = pendingSessionKey(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const byOrder = orderKey(left).localeCompare(orderKey(right));
      return byOrder || left.revision.localeCompare(right.revision);
    });
  }

  const ordered: PendingUpdate[] = [];
  while (groups.size > 0) {
    let selectedSessionKey = "";
    let selected: PendingUpdate | undefined;
    for (const [sessionKey, group] of groups) {
      const candidate = group[0];
      if (!candidate) continue;
      if (
        !selected
        || orderKey(candidate) < orderKey(selected)
        || (
          orderKey(candidate) === orderKey(selected)
          && sessionKey < selectedSessionKey
        )
      ) {
        selected = candidate;
        selectedSessionKey = sessionKey;
      }
    }
    if (!selected) break;
    ordered.push(selected);
    const group = groups.get(selectedSessionKey);
    group?.shift();
    if (!group || group.length === 0) groups.delete(selectedSessionKey);
  }
  return ordered;
}

export function listPendingUpdates(
  config: RuntimeConfig,
  includeDeferred: boolean = false,
): PendingUpdate[] {
  const directory = pendingDirectory(config);
  try {
    ensurePrivateDirectory(directory);
    const now = Date.now();
    const values = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<PendingUpdate>(join(directory, name)))
      .filter((value): value is PendingUpdate => (
        value?.version === 1
        && typeof value.revision === "string"
        && typeof value.sessionId === "string"
        && typeof value.workspacePath === "string"
        && Number.isInteger(value.transcriptEndLine)
        && typeof value.enqueuedAt === "string"
      ));
    const ordered = orderPendingUpdates(values);
    if (includeDeferred) return ordered;

    // 每个会话一次只暴露最早项；头项退避时必须阻塞该会话的后续项。
    const seenSessions = new Set<string>();
    return ordered.filter((value) => {
      const key = pendingSessionKey(value);
      if (seenSessions.has(key)) return false;
      seenSessions.add(key);
      if (!value.retryAfter) return true;
      const retryAt = Date.parse(value.retryAfter);
      return !Number.isFinite(retryAt) || retryAt <= now;
    });
  } catch {
    return [];
  }
}

export function deferPendingUpdate(
  config: RuntimeConfig,
  pending: PendingUpdate,
  delayMs: number,
): void {
  savePendingUpdate(config, {
    ...pending,
    attempts: (pending.attempts ?? 0) + 1,
    retryAfter: new Date(Date.now() + delayMs).toISOString(),
  });
}

export function removePendingUpdate(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  expectedRevision: string,
): boolean {
  const path = pendingPath(config, workspacePath, sessionId, expectedRevision);
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(lockPath: string): (() => void) | null {
  ensurePrivateDirectory(dirname(lockPath));

  try {
    if (existsSync(lockPath)) {
      const lockStat = statSync(lockPath);
      if (!lockStat.isDirectory()) {
        if (Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) return null;
        unlinkSync(lockPath);
      }
    }
    if (existsSync(lockPath)) {
      const ownerNames = readdirSync(lockPath)
        .filter((name) => name.startsWith("owner-"));
      const heartbeatPath = ownerNames.length === 1
        ? join(lockPath, ownerNames[0] ?? "")
        : lockPath;
      if (Date.now() - statSync(heartbeatPath).mtimeMs > LOCK_STALE_MS) {
        for (const ownerName of ownerNames) {
          try {
            unlinkSync(join(lockPath, ownerName));
          } catch {
            // 其他进程可能已开始清理同一个过期锁。
          }
        }
        try {
          rmdirSync(lockPath);
        } catch {
          // 非空目录表示已有新所有者，不得继续清理。
        }
      }
    }
  } catch {
    return null;
  }

  const token = randomUUID();
  const ownerPath = join(lockPath, `owner-${token}`);
  const owner = `${process.pid} ${Date.now()} ${token}\n`;
  let createdDirectory = false;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    createdDirectory = true;
    const descriptor = openSync(ownerPath, "wx", 0o600);
    try {
      writeFileSync(descriptor, owner, "utf8");
    } finally {
      closeSync(descriptor);
    }
    chmodSync(lockPath, 0o700);
    chmodSync(ownerPath, 0o600);
    const heartbeat = setInterval(() => {
      try {
        if (readFileSync(ownerPath, "utf8") !== owner) {
          clearInterval(heartbeat);
          return;
        }
        const now = new Date();
        utimesSync(ownerPath, now, now);
      } catch {
        clearInterval(heartbeat);
      }
    }, LOCK_HEARTBEAT_MS);
    heartbeat.unref();
    return () => {
      clearInterval(heartbeat);
      try {
        if (readFileSync(ownerPath, "utf8") !== owner) return;
        unlinkSync(ownerPath);
        try {
          rmdirSync(lockPath);
        } catch {
          // 新所有者已建立标记时，锁目录必须保留。
        }
      } catch {
        // 锁已被清理或接管时不得删除其他进程的锁。
      }
    };
  } catch {
    try {
      unlinkSync(ownerPath);
    } catch {
      // 所有者标记尚未创建时无需处理。
    }
    if (createdDirectory) {
      try {
        rmdirSync(lockPath);
      } catch {
        // 非空目录属于其他所有者。
      }
    }
    return null;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function updateSessionState(
  config: RuntimeConfig,
  workspacePath: string,
  sessionId: string,
  updater: (state: SessionState) => SessionState,
  waitMs: number = 0,
): Promise<SessionState | null> {
  const deadline = Date.now() + waitMs;
  let release = acquireLock(sessionLockPath(config, workspacePath, sessionId));
  while (!release && Date.now() < deadline) {
    await delay(25);
    release = acquireLock(sessionLockPath(config, workspacePath, sessionId));
  }
  if (!release) return null;

  try {
    const updated = updater(loadSessionState(config, workspacePath, sessionId));
    saveSessionState(config, updated);
    return updated;
  } finally {
    release();
  }
}
