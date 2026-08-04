export type HookAction =
  | "session-start"
  | "prepare-session"
  | "inject-context"
  | "sync-context"
  | "enqueue-memory"
  | "drain-pending";

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  prompt?: string;
  title?: string;
  thread_title?: string;
  conversation_title?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}

export interface RuntimeConfig {
  serverUrl: string;
  authToken?: string;
  autoStartServer: boolean;
  model: string;
  dataDir: string;
  coordinationDir: string;
  namespace: string;
  requestTimeoutMs: number;
  maxContextChars: number;
  maxBatchChars: number;
  disabled: boolean;
}

export interface TranscriptEvent {
  lineIndex: number;
  digest: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface SessionState {
  version: 1;
  sessionId: string;
  workspacePath: string;
  agentId?: string;
  agentModel?: string;
  conversationId?: string;
  conversationTitle?: string;
  conversationTitleSource?: "hook" | "codex" | "prompt";
  activatedAt?: string;
  lastProcessedLine: number;
  recentDigests: string[];
  pendingAssistantDigests?: string[];
  lastSessionStartPreparationAt?: string;
  lastInjectedContextRevision?: string;
  lastSeenConversationMessageId?: string;
}

export interface SessionWorkspaceBinding {
  version: 1;
  sessionId: string;
  workspacePath: string;
  boundAt: string;
}

export interface AgentReference {
  version: 1;
  agentId: string;
  scopeKey: string;
  model: string;
  definitionVersion?: number;
  updatedAt: string;
}

export interface ContextSnapshot {
  version: 1;
  agentId: string;
  workspacePath: string;
  revision: string;
  updatedAt: string;
  text: string;
}

export interface GuidanceReference {
  version: 1;
  agentId: string;
  workspacePath: string;
  conversationId: string;
  messageId?: string;
  revision: string;
  empty: boolean;
  updatedAt: string;
}

export interface RecallConversationReference {
  version: 1;
  agentId: string;
  workspacePath: string;
  conversationId: string;
  updatedAt: string;
}

export interface FailureState {
  version: 1;
  failures: number;
  retryAfter: string;
  updatedAt: string;
}

export interface PendingUpdate {
  version: 1;
  revision: string;
  sessionId: string;
  workspacePath: string;
  transcriptPath?: string;
  transcriptEndLine: number;
  lastAssistantMessage?: string;
  enqueuedAt: string;
  enqueuedOrder?: string;
  attempts?: number;
  retryAfter?: string;
}

export type LogLevel = "info" | "warn" | "error";

export type LogFunction = (
  level: LogLevel,
  event: string,
  detail?: string,
) => void;
