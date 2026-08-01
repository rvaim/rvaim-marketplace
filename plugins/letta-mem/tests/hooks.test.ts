import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleDrainPending,
  handleEnqueueMemory,
  handleInjectContext,
  handleSessionStart,
  handleUpdateMemory,
} from "../src/hooks.js";
import type {
  AgentClient,
  AgentClientFactory,
  AgentSession,
} from "../src/letta.js";
import {
  agentScopeKey,
  resolveAgentId,
  resolveSharedAgentId,
  sharedAgentScopeKey,
} from "../src/letta.js";
import {
  acquireLock,
  agentRunLockPath,
  loadContextSnapshot,
  loadFailureState,
  loadAgentReference,
  loadSessionState,
  listPendingUpdates,
  saveAgentReference,
  saveSessionState,
  sha256,
} from "../src/state.js";
import type {
  LogFunction,
  RuntimeConfig,
} from "../src/types.js";

const temporaryDirectories: string[] = [];

function createConfig(): RuntimeConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "letta-mem-hooks-"));
  temporaryDirectories.push(dataDir);
  return {
    serverUrl: "ws://127.0.0.1:4500",
    autoStartServer: false,
    model: "auto",
    mixedMemory: false,
    sharedMemory: false,
    dataDir,
    namespace: "hook-tests",
    requestTimeoutMs: 1_000,
    maxContextChars: 8_000,
    maxBatchChars: 80_000,
    disabled: false,
  };
}

function createTranscript(
  config: RuntimeConfig,
  text: string,
  filename: string = "transcript.jsonl",
): string {
  const path = join(config.dataDir, filename);
  writeFileSync(
    path,
    `${JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text }] },
    })}\n`,
    "utf8",
  );
  return path;
}

function createSession(
  conversationId: string,
  guidance: string,
  agentId: string = "agent-1",
): {
  session: AgentSession;
  sent: string[];
  close: ReturnType<typeof vi.fn>;
} {
  const sent: string[] = [];
  const close = vi.fn();
  const session: AgentSession = {
    async send(message) {
      sent.push(message);
    },
    async *stream() {
      yield { type: "assistant", content: guidance };
      yield { type: "result", success: true };
    },
    async bootstrapState() {
      return { agentId, conversationId };
    },
    close,
  };
  return { session, sent, close };
}

function createBootstrapFailure(message: string): {
  session: AgentSession;
  close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const session: AgentSession = {
    async send() {},
    async *stream() {},
    async bootstrapState() {
      throw new Error(message);
    },
    close,
  };
  return { session, close };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("后台记忆 Hook", () => {
  it("创建 Agent 会话、恢复会话并提交游标与上下文缓存", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const transcriptPath = createTranscript(config, "第一次消息");
    const first = createSession("conversation-1", "第一版相关上下文");
    const resumed = createSession("conversation-1", "第二版相关上下文");
    const createAgent = vi.fn(async (
      _options: Parameters<AgentClient["createAgent"]>[0],
    ) => "agent-1");
    let firstSessionOptions: Parameters<AgentClient["createSession"]>[1] | undefined;
    const createAgentSession = vi.fn((
      _agentId: string,
      options: Parameters<AgentClient["createSession"]>[1],
    ) => {
      firstSessionOptions = options;
      return first.session;
    });
    const resumeAgentSession = vi.fn(() => resumed.session);
    const client: AgentClient = {
      createAgent,
      createSession: createAgentSession,
      resumeSession: resumeAgentSession,
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const clientFactory = vi.fn(async () => client) as AgentClientFactory;
    const log = vi.fn() as LogFunction;
    const input = {
      session_id: "claude-session-1",
      transcript_path: transcriptPath,
      cwd: projectPath,
    };

    await expect(
      handleUpdateMemory(config, input, log, clientFactory),
    ).resolves.toBe("");

    const firstState = loadSessionState(
      config,
      projectPath,
      "claude-session-1",
    );
    expect(createAgent).toHaveBeenCalledOnce();
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      cwd: projectPath,
      memfs: true,
      baseTools: [],
    }));
    const createdAgentOptions = createAgent.mock.calls[0]?.[0];
    expect(createdAgentOptions?.systemPrompt)
      .toContain("判断语言时只参考 role=\"user\" 的消息");
    expect(createdAgentOptions?.memory.every((block) => block.value === ""))
      .toBe(true);
    expect(createdAgentOptions?.memory.every(
      (block) => block.description === undefined,
    )).toBe(true);
    expect(createAgentSession).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        cwd: projectPath,
        allowedTools: ["memory", "memory_apply_patch"],
        permissionMode: "strict",
        skillSources: [],
        canUseTool: expect.any(Function),
      }),
    );
    expect(await firstSessionOptions?.canUseTool("memory", {})).toEqual({
      behavior: "allow",
    });
    expect(await firstSessionOptions?.canUseTool("Bash", {})).toEqual({
      behavior: "deny",
      message: "letta-mem 只允许修改 Letta MemFS",
      interrupt: false,
    });
    expect(firstState).toMatchObject({
      agentId: "agent-1",
      conversationId: "conversation-1",
      lastProcessedLine: 0,
    });
    expect(firstState.recentDigests).toHaveLength(1);
    expect(first.sent[0]).toContain("第一次消息");
    expect(first.close).toHaveBeenCalledOnce();
    expect(loadContextSnapshot(config, projectPath)?.text).toBe("第一版相关上下文");

    const injected = await handleInjectContext(config, input);
    expect(injected).toContain("第一版相关上下文");
    await expect(handleInjectContext(config, input)).resolves.toBe("");

    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "第二次消息" }] },
      })}\n`,
      "utf8",
    );
    await expect(
      handleUpdateMemory(config, input, log, clientFactory),
    ).resolves.toBe("");

    const resumedState = loadSessionState(
      config,
      projectPath,
      "claude-session-1",
    );
    expect(resumeAgentSession).toHaveBeenCalledWith(
      "conversation-1",
      expect.objectContaining({
        cwd: projectPath,
        permissionMode: "strict",
      }),
    );
    expect(resumedState.lastProcessedLine).toBe(1);
    expect(resumedState.recentDigests).toHaveLength(2);
    expect(resumed.sent[0]).toContain("第二次消息");
    expect(resumed.sent[0]).not.toContain("第一次消息");
    expect(resumed.close).toHaveBeenCalledOnce();
    expect(loadContextSnapshot(config, projectPath)?.text).toBe("第二版相关上下文");
  });

  it("共享记忆默认流程先由共享 Agent 判断再交给工作区 Agent", async () => {
    const config = { ...createConfig(), sharedMemory: true };
    const workspacePath = join(config.dataDir, "shared-workspace");
    const transcriptPath = createTranscript(
      config,
      "所有项目都禁用 any，但这个仓库使用 pnpm。",
    );
    const shared = createSession(
      "conversation-shared",
      "跨工作区规范：禁止使用 <any>。",
      "agent-shared",
    );
    const workspace = createSession(
      "conversation-workspace",
      "当前工作区使用 pnpm，并遵守禁用 any 的共享规范。",
      "agent-workspace",
    );
    const creationOrder: string[] = [];
    const createAgent = vi.fn(async (
      options: Parameters<AgentClient["createAgent"]>[0],
    ) => {
      creationOrder.push(options.name);
      return options.name === "letta-mem · shared"
        ? "agent-shared"
        : "agent-workspace";
    });
    const createAgentSession = vi.fn((agentId: string) => (
      agentId === "agent-shared" ? shared.session : workspace.session
    ));
    const client: AgentClient = {
      createAgent,
      createSession: createAgentSession,
      resumeSession: vi.fn((conversationId: string) => (
        conversationId === "conversation-shared"
          ? shared.session
          : workspace.session
      )),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;

    await expect(handleUpdateMemory(config, {
      session_id: "shared-session",
      transcript_path: transcriptPath,
      cwd: workspacePath,
    }, log, vi.fn(async () => client) as AgentClientFactory)).resolves.toBe("");

    expect(creationOrder).toEqual([
      "letta-mem · shared",
      expect.stringContaining("shared-workspace"),
    ]);
    expect(createAgent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cwd: workspacePath,
      name: "letta-mem · shared",
      tags: expect.arrayContaining(["letta-mem-memory-scope:shared-v1"]),
      systemPrompt: expect.stringContaining("自行判断哪些信息真正适合跨工作区复用"),
    }));
    expect(createAgentSession).toHaveBeenNthCalledWith(
      1,
      "agent-shared",
      expect.objectContaining({ cwd: workspacePath }),
    );
    expect(createAgentSession).toHaveBeenNthCalledWith(
      2,
      "agent-workspace",
      expect.objectContaining({ cwd: workspacePath }),
    );
    expect(shared.sent[0]).toContain("<shared_memory_update>");
    expect(workspace.sent[0]).toContain("<shared_memory_context>");
    expect(workspace.sent[0]).toContain("禁止使用 &lt;any&gt;");
    expect(shared.close).toHaveBeenCalledOnce();
    expect(workspace.close).toHaveBeenCalledOnce();
    expect(loadSessionState(config, workspacePath, "shared-session"))
      .toMatchObject({
        agentId: "agent-workspace",
        conversationId: "conversation-workspace",
        sharedAgentId: "agent-shared",
        sharedConversationId: "conversation-shared",
        lastProcessedLine: 0,
      });
    expect(loadAgentReference(config, sharedAgentScopeKey()))
      .toMatchObject({ agentId: "agent-shared" });
    expect(loadContextSnapshot(config, workspacePath)?.text)
      .toContain("当前工作区使用 pnpm，并遵守禁用 any 的共享规范。");
    expect(loadContextSnapshot(config, workspacePath)?.text)
      .toContain("跨工作区规范：禁止使用 <any>。");
  });

  it("Claude Code 与 Codex 的独立数据目录复用服务器端共享 Agent", async () => {
    const firstConfig = { ...createConfig(), sharedMemory: true };
    const secondConfig = { ...createConfig(), sharedMemory: true };
    let storedAgent: {
      id: string;
      name: string;
      tags: string[];
      model: string;
    } | undefined;
    const createAgent = vi.fn(async (
      options: Parameters<AgentClient["createAgent"]>[0],
    ) => {
      storedAgent = {
        id: "agent-shared-cross-host",
        name: options.name,
        tags: options.tags,
        model: "deepseek/deepseek-v4-flash",
      };
      return storedAgent.id;
    });
    const renameStoredAgent = (): void => {
      if (storedAgent) storedAgent.name = "用户重命名后的共享记忆";
    };
    const client: AgentClient = {
      createAgent,
      createSession: vi.fn(() => createSession("unused", "").session),
      resumeSession: vi.fn(() => createSession("unused", "").session),
      agents: {
        list: vi.fn(async () => storedAgent ? [storedAgent] : []),
      },
    };
    const log = vi.fn() as LogFunction;

    const firstAgentId = await resolveSharedAgentId(
      firstConfig,
      client,
      "/workspace/first",
      log,
    );
    renameStoredAgent();
    const secondAgentId = await resolveSharedAgentId(
      secondConfig,
      client,
      "/workspace/second",
      log,
    );

    expect(firstAgentId).toBe("agent-shared-cross-host");
    expect(secondAgentId).toBe("agent-shared-cross-host");
    expect(createAgent).toHaveBeenCalledOnce();
    expect(client.agents.list).toHaveBeenCalledTimes(2);
    expect(client.agents.list).toHaveBeenLastCalledWith({
      tags: ["letta-mem", "letta-mem-memory-scope:shared-v1"],
      matchAllTags: true,
      limit: 10,
      order: "desc",
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      "shared-agent-reused",
      "agent-shared-cross-host",
    );
  });

  it("模型变化时更新共享 Agent 而不新建共享记忆", async () => {
    const config = {
      ...createConfig(),
      model: "deepseek/deepseek-v4-flash",
      sharedMemory: true,
    };
    saveAgentReference(
      config,
      sharedAgentScopeKey(),
      "agent-shared-existing",
      "auto",
    );
    const update = vi.fn(async () => ({
      id: "agent-shared-existing",
      model: "deepseek/deepseek-v4-flash",
    }));
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-shared-unused"),
      createSession: vi.fn(() => createSession("unused", "").session),
      resumeSession: vi.fn(() => createSession("unused", "").session),
      agents: {
        list: vi.fn(async () => []),
        update,
      },
    };
    const log = vi.fn() as LogFunction;

    await expect(resolveSharedAgentId(
      config,
      client,
      "/workspace/model-update",
      log,
    ))
      .resolves.toBe("agent-shared-existing");

    expect(update).toHaveBeenCalledWith("agent-shared-existing", {
      model: "deepseek/deepseek-v4-flash",
    });
    expect(client.createAgent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "info",
      "shared-agent-model-updated",
      "agent-shared-existing:deepseek/deepseek-v4-flash",
    );
  });

  it("相同 Claude 会话 ID 在不同工作区中创建不同 Agent", async () => {
    const config = createConfig();
    const firstWorkspace = join(config.dataDir, "first-workspace");
    const secondWorkspace = join(config.dataDir, "second-workspace");
    const firstTranscript = createTranscript(
      config,
      "第一项目消息",
      "first-transcript.jsonl",
    );
    const secondTranscript = createTranscript(
      config,
      "第二项目消息",
      "second-transcript.jsonl",
    );
    let sequence = 0;
    const createAgent = vi.fn(async (
      _options: Parameters<AgentClient["createAgent"]>[0],
    ) => `agent-${++sequence}`);
    const createAgentSession = vi.fn((agentId: string) => createSession(
      `conversation-${agentId}`,
      `上下文-${agentId}`,
      agentId,
    ).session);
    const client: AgentClient = {
      createAgent,
      createSession: createAgentSession,
      resumeSession: vi.fn((conversationId: string) => createSession(
        conversationId,
        "恢复上下文",
      ).session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const clientFactory = vi.fn(async () => client) as AgentClientFactory;
    const log = vi.fn() as LogFunction;

    const workspaces: Array<[string, string]> = [
      [firstWorkspace, firstTranscript],
      [secondWorkspace, secondTranscript],
    ];
    for (const [cwd, transcriptPath] of workspaces) {
      await handleUpdateMemory(config, {
        session_id: "same-claude-session",
        transcript_path: transcriptPath,
        cwd,
      }, log, clientFactory);
    }

    expect(createAgent).toHaveBeenCalledTimes(2);
    const firstOptions = createAgent.mock.calls[0]?.[0];
    const secondOptions = createAgent.mock.calls[1]?.[0];
    expect(firstOptions?.name).toContain("first-workspace");
    expect(secondOptions?.name).toContain("second-workspace");
    expect(firstOptions?.name).not.toBe(secondOptions?.name);
    expect(firstOptions?.tags).not.toEqual(secondOptions?.tags);
    expect(loadSessionState(
      config,
      firstWorkspace,
      "same-claude-session",
    ).agentId).toBe("agent-1");
    expect(loadSessionState(
      config,
      secondWorkspace,
      "same-claude-session",
    ).agentId).toBe("agent-2");
  });

  it("同一工作区的不同文件夹与会话共享一个 Agent", async () => {
    const config = createConfig();
    const workspacePath = join(config.dataDir, "workspace-primary");
    const firstTranscript = createTranscript(
      config,
      "前端文件夹消息",
      "frontend-transcript.jsonl",
    );
    const secondTranscript = createTranscript(
      config,
      "后端文件夹消息",
      "backend-transcript.jsonl",
    );
    const createAgent = vi.fn(async () => "agent-workspace");
    let conversationSequence = 0;
    const createAgentSession = vi.fn((agentId: string) => createSession(
      `conversation-${++conversationSequence}`,
      "工作区上下文",
      agentId,
    ).session);
    const client: AgentClient = {
      createAgent,
      createSession: createAgentSession,
      resumeSession: vi.fn((conversationId: string) => createSession(
        conversationId,
        "恢复上下文",
        "agent-workspace",
      ).session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const clientFactory = vi.fn(async () => client) as AgentClientFactory;
    const log = vi.fn() as LogFunction;
    const chats: Array<[string, string]> = [
      ["frontend-chat", firstTranscript],
      ["backend-chat", secondTranscript],
    ];

    for (const [sessionId, transcriptPath] of chats) {
      await handleUpdateMemory(config, {
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: workspacePath,
      }, log, clientFactory);
    }

    expect(createAgent).toHaveBeenCalledOnce();
    expect(createAgentSession).toHaveBeenCalledTimes(2);
    expect(createAgentSession).toHaveBeenNthCalledWith(
      1,
      "agent-workspace",
      expect.any(Object),
    );
    expect(createAgentSession).toHaveBeenNthCalledWith(
      2,
      "agent-workspace",
      expect.any(Object),
    );
    expect(loadSessionState(config, workspacePath, "frontend-chat").agentId)
      .toBe("agent-workspace");
    expect(loadSessionState(config, workspacePath, "backend-chat").agentId)
      .toBe("agent-workspace");
  });

  it("工作区 Agent 被重命名后仍按作用域标签复用", async () => {
    const firstConfig = createConfig();
    const secondConfig = createConfig();
    const workspacePath = "/workspace/stable-project";
    let storedAgent: {
      id: string;
      name: string;
      tags: string[];
      model: string;
    } | undefined;
    const createAgent = vi.fn(async (
      options: Parameters<AgentClient["createAgent"]>[0],
    ) => {
      storedAgent = {
        id: "agent-workspace-cross-host",
        name: options.name,
        tags: options.tags,
        model: "auto",
      };
      return storedAgent.id;
    });
    const renameStoredAgent = (): void => {
      if (storedAgent) storedAgent.name = "用户在 Letta App 中修改的名称";
    };
    const client: AgentClient = {
      createAgent,
      createSession: vi.fn(() => createSession("unused", "").session),
      resumeSession: vi.fn(() => createSession("unused", "").session),
      agents: {
        list: vi.fn(async () => storedAgent ? [storedAgent] : []),
      },
    };
    const log = vi.fn() as LogFunction;

    const firstAgentId = await resolveAgentId(
      firstConfig,
      client,
      workspacePath,
      log,
    );
    renameStoredAgent();
    const secondAgentId = await resolveAgentId(
      secondConfig,
      client,
      workspacePath,
      log,
    );

    expect(firstAgentId).toBe("agent-workspace-cross-host");
    expect(secondAgentId).toBe("agent-workspace-cross-host");
    expect(createAgent).toHaveBeenCalledOnce();
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      cwd: workspacePath,
    }));
    expect(client.agents.list).toHaveBeenLastCalledWith({
      tags: [
        "letta-mem",
        `letta-mem-workspace:${sha256(workspacePath).slice(0, 24)}`,
      ],
      matchAllTags: true,
      limit: 10,
      order: "desc",
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      "agent-reused",
      "agent-workspace-cross-host",
    );
  });

  it("混合记忆模式让不同工作区共享名为 letta-mem 的 Agent", async () => {
    const config = {
      ...createConfig(),
      model: "deepseek/deepseek-v4-flash",
      mixedMemory: true,
      sharedMemory: true,
    };
    const firstWorkspace = join(config.dataDir, "mixed-first");
    const secondWorkspace = join(config.dataDir, "mixed-second");
    const transcripts = [
      createTranscript(config, "第一个工作区消息", "mixed-first.jsonl"),
      createTranscript(config, "第二个工作区消息", "mixed-second.jsonl"),
    ];
    const openedSessions: ReturnType<typeof createSession>[] = [];
    let conversationSequence = 0;
    const createAgent = vi.fn(async () => "agent-mixed");
    const createAgentSession = vi.fn((agentId: string) => {
      const opened = createSession(
        `mixed-conversation-${++conversationSequence}`,
        `混合上下文-${conversationSequence}`,
        agentId,
      );
      openedSessions.push(opened);
      return opened.session;
    });
    const client: AgentClient = {
      createAgent,
      createSession: createAgentSession,
      resumeSession: vi.fn((conversationId: string) => createSession(
        conversationId,
        "恢复的混合上下文",
        "agent-mixed",
      ).session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;
    const clientFactory = vi.fn(async () => client) as AgentClientFactory;

    const workspaces: Array<[string, string, string]> = [
      [firstWorkspace, transcripts[0] ?? "", "mixed-session-first"],
      [secondWorkspace, transcripts[1] ?? "", "mixed-session-second"],
    ];
    for (const [cwd, transcriptPath, sessionId] of workspaces) {
      await handleUpdateMemory(config, {
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd,
      }, log, clientFactory);
    }

    expect(createAgent).toHaveBeenCalledOnce();
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      cwd: firstWorkspace,
      name: "letta-mem",
      model: "deepseek/deepseek-v4-flash",
      tags: expect.arrayContaining(["letta-mem-memory-mode:mixed"]),
      systemPrompt: expect.stringContaining("自行判断共享与独立作用域"),
    }));
    expect(createAgentSession).toHaveBeenCalledTimes(2);
    expect(createAgentSession.mock.calls.map((call) => call[0]))
      .toEqual(["agent-mixed", "agent-mixed"]);
    expect(createAgentSession).toHaveBeenNthCalledWith(
      1,
      "agent-mixed",
      expect.objectContaining({ cwd: firstWorkspace }),
    );
    expect(createAgentSession).toHaveBeenNthCalledWith(
      2,
      "agent-mixed",
      expect.objectContaining({ cwd: secondWorkspace }),
    );
    expect(openedSessions[0]?.sent[0]).toContain("<memory_mode>mixed</memory_mode>");
    expect(openedSessions[0]?.sent[0])
      .toContain("<shared_memory_enabled>true</shared_memory_enabled>");
    expect(openedSessions[0]?.sent[0])
      .toContain("你必须自行判断每项信息的作用域");
    expect(openedSessions[0]?.sent[0]).not.toContain("<shared_memory_context>");
    expect(openedSessions[0]?.sent[0]).toContain(firstWorkspace);
    expect(openedSessions[1]?.sent[0]).toContain(secondWorkspace);
    expect(loadContextSnapshot(config, firstWorkspace)?.text).toBe("混合上下文-1");
    expect(loadContextSnapshot(config, secondWorkspace)?.text).toBe("混合上下文-2");
    expect(loadSessionState(config, firstWorkspace, "mixed-session-first").agentId)
      .toBe("agent-mixed");
    expect(loadSessionState(config, secondWorkspace, "mixed-session-second").agentId)
      .toBe("agent-mixed");
  });

  it("Claude Code 与 Codex 的独立本地数据目录会复用服务器端共享 Agent", async () => {
    const firstConfig = { ...createConfig(), mixedMemory: true };
    const secondConfig = { ...createConfig(), mixedMemory: true };
    let storedAgent: {
      id: string;
      name: string;
      tags: string[];
      model: string;
    } | undefined;
    const createAgent = vi.fn(async (
      options: Parameters<AgentClient["createAgent"]>[0],
    ) => {
      storedAgent = {
        id: "agent-cross-host",
        name: options.name,
        tags: options.tags,
        model: "deepseek/deepseek-v4-pro",
      };
      return storedAgent.id;
    });
    const renameStoredAgent = (): void => {
      if (storedAgent) storedAgent.name = "用户重命名后的混合记忆";
    };
    const client: AgentClient = {
      createAgent,
      createSession: vi.fn(() => createSession("unused", "").session),
      resumeSession: vi.fn(() => createSession("unused", "").session),
      agents: {
        list: vi.fn(async () => storedAgent ? [storedAgent] : []),
      },
    };
    const log = vi.fn() as LogFunction;

    const firstAgentId = await resolveAgentId(
      firstConfig,
      client,
      "/workspace/shared",
      log,
    );
    renameStoredAgent();
    const secondAgentId = await resolveAgentId(
      secondConfig,
      client,
      "/workspace/another",
      log,
    );

    expect(firstAgentId).toBe("agent-cross-host");
    expect(secondAgentId).toBe("agent-cross-host");
    expect(createAgent).toHaveBeenCalledOnce();
    expect(client.agents.list).toHaveBeenCalledTimes(2);
    expect(client.agents.list).toHaveBeenLastCalledWith({
      tags: ["letta-mem", "letta-mem-memory-mode:mixed"],
      matchAllTags: true,
      limit: 10,
      order: "desc",
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      "agent-reused",
      "agent-cross-host",
    );
  });

  it("默认模型配置变化时更新现有 Agent 而不丢失记忆", async () => {
    const config = {
      ...createConfig(),
      model: "deepseek/deepseek-v4-flash",
    };
    const workspacePath = join(config.dataDir, "model-workspace");
    const transcriptPath = createTranscript(config, "模型切换后的消息");
    saveAgentReference(config, workspacePath, "agent-existing", "auto");
    saveSessionState(config, {
      version: 1,
      sessionId: "model-session",
      workspacePath,
      agentId: "agent-existing",
      conversationId: "conversation-before-model-update",
      lastProcessedLine: -1,
      recentDigests: [],
    });
    const opened = createSession(
      "conversation-after-model-update",
      "模型更新后的上下文",
      "agent-existing",
    );
    const update = vi.fn(async () => ({
      id: "agent-existing",
      model: "deepseek/deepseek-v4-flash",
    }));
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => opened.session),
      resumeSession: vi.fn(() => opened.session),
      agents: {
        list: vi.fn(async () => []),
        update,
      },
    };
    const log = vi.fn() as LogFunction;

    await handleUpdateMemory(config, {
      session_id: "model-session",
      transcript_path: transcriptPath,
      cwd: workspacePath,
    }, log, vi.fn(async () => client) as AgentClientFactory);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith("agent-existing", {
      model: "deepseek/deepseek-v4-flash",
    });
    expect(client.createAgent).not.toHaveBeenCalled();
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledWith(
      "agent-existing",
      expect.any(Object),
    );
    expect(loadSessionState(config, workspacePath, "model-session"))
      .toMatchObject({
        agentModel: "deepseek/deepseek-v4-flash",
        conversationId: "conversation-after-model-update",
      });
    expect(loadAgentReference(
      config,
      agentScopeKey(config, workspacePath),
    )).toMatchObject({
      agentId: "agent-existing",
      model: "deepseek/deepseek-v4-flash",
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      "agent-model-updated",
      "agent-existing:deepseek/deepseek-v4-flash",
    );
  });

  it("客户端异常时不抛错并记录指数退避", async () => {
    const config = createConfig();
    const transcriptPath = createTranscript(config, "需要记忆的消息");
    const clientFactory = vi.fn(async () => {
      throw new Error("模拟连接失败");
    });
    const log = vi.fn() as LogFunction;
    const input = {
      session_id: "claude-session-failure",
      transcript_path: transcriptPath,
      cwd: join(config.dataDir, "project"),
    };

    await expect(
      handleUpdateMemory(config, input, log, clientFactory),
    ).resolves.toBe("");

    const failure = loadFailureState(config);
    expect(failure?.failures).toBe(1);
    expect(Date.parse(failure?.retryAfter ?? "")).toBeGreaterThan(Date.now());
    expect(log).toHaveBeenCalledWith(
      "error",
      "memory-update-failed",
      expect.stringContaining("模拟连接失败"),
    );

    await expect(
      handleUpdateMemory(config, input, log, clientFactory),
    ).resolves.toBe("");
    expect(clientFactory).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("info", "update-deferred-backoff");
  });

  it("共享 Agent 处理失败时保留待处理项且不影响宿主", async () => {
    const config = { ...createConfig(), sharedMemory: true };
    const workspacePath = join(config.dataDir, "shared-failure-workspace");
    const transcriptPath = createTranscript(config, "需要判断作用域的记忆");
    const sharedClose = vi.fn();
    const sharedFailure: AgentSession = {
      async send() {},
      async *stream() {
        yield {
          type: "result",
          success: false,
          error: "模拟共享 Agent 失败",
        };
      },
      async bootstrapState() {
        return {
          agentId: "agent-shared-failure",
          conversationId: "conversation-shared-failure",
        };
      },
      close: sharedClose,
    };
    const workspace = createSession(
      "conversation-workspace-unused",
      "不应写入",
      "agent-workspace-unused",
    );
    const client: AgentClient = {
      createAgent: vi.fn(async (options) => (
        options.name === "letta-mem · shared"
          ? "agent-shared-failure"
          : "agent-workspace-unused"
      )),
      createSession: vi.fn((agentId: string) => (
        agentId === "agent-shared-failure"
          ? sharedFailure
          : workspace.session
      )),
      resumeSession: vi.fn(() => workspace.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;

    await expect(handleUpdateMemory(
      config,
      {
        session_id: "shared-failure-session",
        transcript_path: transcriptPath,
        cwd: workspacePath,
      },
      log,
      vi.fn(async () => client) as AgentClientFactory,
    )).resolves.toBe("");

    expect(workspace.sent).toHaveLength(0);
    expect(sharedClose).toHaveBeenCalledOnce();
    expect(workspace.close).toHaveBeenCalledOnce();
    expect(loadSessionState(
      config,
      workspacePath,
      "shared-failure-session",
    ).lastProcessedLine).toBe(-1);
    expect(listPendingUpdates(config, true)).toHaveLength(1);
    expect(loadFailureState(config)?.failures).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "error",
      "memory-update-failed",
      expect.stringContaining("模拟共享 Agent 失败"),
    );
  });

  it("Agent 已创建但 MemFS 后置初始化报错时会恢复该 Agent", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const transcriptPath = createTranscript(config, "恢复后仍需处理的消息");
    const recoveredSession = createSession(
      "conversation-recovered",
      "恢复成功",
      "agent-recovered",
    );
    const list = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "agent-recovered",
        name: `letta-mem · project · ${sha256(projectPath).slice(0, 8)}`,
        tags: [
          "letta-mem",
          "claude-code-memory",
          `letta-mem-workspace:${sha256(projectPath).slice(0, 24)}`,
        ],
      }]);
    const client: AgentClient = {
      createAgent: vi.fn(async () => {
        throw new Error("模拟 MemFS 后置初始化失败");
      }),
      createSession: vi.fn(() => recoveredSession.session),
      resumeSession: vi.fn(() => recoveredSession.session),
      agents: {
        list,
      },
    };
    const log = vi.fn() as LogFunction;

    await expect(handleUpdateMemory(
      config,
      {
        session_id: "claude-session-recovered",
        transcript_path: transcriptPath,
        cwd: projectPath,
      },
      log,
      vi.fn(async () => client) as AgentClientFactory,
    )).resolves.toBe("");

    expect(list).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "agent-create-recovered",
      "agent-recovered",
    );
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-recovered",
    )).toMatchObject({
      agentId: "agent-recovered",
      conversationId: "conversation-recovered",
      lastProcessedLine: 0,
    });
  });

  it("缓存会话已被 Letta 清理时会在同一 Agent 上新建会话", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const transcriptPath = createTranscript(config, "会话失效后的新消息");
    saveAgentReference(config, projectPath, "agent-1");
    saveSessionState(config, {
      version: 1,
      sessionId: "claude-session-stale-conversation",
      workspacePath: projectPath,
      agentId: "agent-1",
      conversationId: "conversation-stale",
      lastProcessedLine: -1,
      recentDigests: [],
    });

    const stale = createBootstrapFailure("Conversation not found");
    const recreated = createSession("conversation-new", "已恢复会话上下文");
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => recreated.session),
      resumeSession: vi.fn(() => stale.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;

    await expect(handleUpdateMemory(
      config,
      {
        session_id: "claude-session-stale-conversation",
        transcript_path: transcriptPath,
        cwd: projectPath,
      },
      log,
      vi.fn(async () => client) as AgentClientFactory,
    )).resolves.toBe("");

    expect(client.resumeSession).toHaveBeenCalledWith(
      "conversation-stale",
      expect.objectContaining({ permissionMode: "strict" }),
    );
    expect(client.createSession).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ permissionMode: "strict" }),
    );
    expect(stale.close).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "warn",
      "conversation-recreated",
      "conversation-stale",
    );
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-stale-conversation",
    )).toMatchObject({
      agentId: "agent-1",
      conversationId: "conversation-new",
      lastProcessedLine: 0,
    });
    expect(loadFailureState(config)).toBeNull();
  });

  it("缓存 Agent 已被 Letta 删除时会清理引用并重建 Agent", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const transcriptPath = createTranscript(config, "Agent 失效后的新消息");
    saveAgentReference(config, projectPath, "agent-stale");

    const stale = createBootstrapFailure("Agent does not exist");
    const recreated = createSession(
      "conversation-new-agent",
      "已恢复 Agent 上下文",
      "agent-new",
    );
    const createAgent = vi.fn(async () => "agent-new");
    const createAgentSession = vi.fn((agentId: string) => (
      agentId === "agent-stale" ? stale.session : recreated.session
    ));
    const client: AgentClient = {
      createAgent,
      createSession: createAgentSession,
      resumeSession: vi.fn(() => stale.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;

    await expect(handleUpdateMemory(
      config,
      {
        session_id: "claude-session-stale-agent",
        transcript_path: transcriptPath,
        cwd: projectPath,
      },
      log,
      vi.fn(async () => client) as AgentClientFactory,
    )).resolves.toBe("");

    expect(createAgentSession).toHaveBeenNthCalledWith(
      1,
      "agent-stale",
      expect.objectContaining({ permissionMode: "strict" }),
    );
    expect(createAgent).toHaveBeenCalledOnce();
    expect(createAgentSession).toHaveBeenNthCalledWith(
      2,
      "agent-new",
      expect.objectContaining({ permissionMode: "strict" }),
    );
    expect(stale.close).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "warn",
      "agent-reference-recreated",
      "agent-stale",
    );
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-stale-agent",
    )).toMatchObject({
      agentId: "agent-new",
      conversationId: "conversation-new-agent",
      lastProcessedLine: 0,
    });
    expect(loadFailureState(config)).toBeNull();
  });

  it("复用的 conversation ID 属于其他 Agent 时会拒绝并新建会话", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const transcriptPath = createTranscript(config, "不得发给错误 Agent 的消息");
    saveAgentReference(config, projectPath, "agent-1");
    saveSessionState(config, {
      version: 1,
      sessionId: "claude-session-reused-conversation",
      workspacePath: projectPath,
      agentId: "agent-1",
      conversationId: "conversation-reused",
      lastProcessedLine: -1,
      recentDigests: [],
    });

    const mismatched = createSession(
      "conversation-reused",
      "错误 Agent 的上下文",
      "agent-other",
    );
    const recreated = createSession(
      "conversation-safe",
      "正确 Agent 的上下文",
      "agent-1",
    );
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => recreated.session),
      resumeSession: vi.fn(() => mismatched.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;

    await expect(handleUpdateMemory(
      config,
      {
        session_id: "claude-session-reused-conversation",
        transcript_path: transcriptPath,
        cwd: projectPath,
      },
      log,
      vi.fn(async () => client) as AgentClientFactory,
    )).resolves.toBe("");

    expect(mismatched.sent).toHaveLength(0);
    expect(mismatched.close).toHaveBeenCalledOnce();
    expect(recreated.sent[0]).toContain("不得发给错误 Agent 的消息");
    expect(log).toHaveBeenCalledWith(
      "warn",
      "conversation-recreated",
      "conversation-reused",
    );
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-reused-conversation",
    )).toMatchObject({
      agentId: "agent-1",
      conversationId: "conversation-safe",
      lastProcessedLine: 0,
    });
    expect(loadContextSnapshot(
      config,
      projectPath,
    )?.text).toBe("正确 Agent 的上下文");
  });

  it("Agent 正忙时等待全局锁并在释放后继续处理", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const transcriptPath = createTranscript(config, "等待锁后仍需记忆的消息");
    const opened = createSession("conversation-after-wait", "等待后已更新");
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-1"),
      createSession: vi.fn(() => opened.session),
      resumeSession: vi.fn(() => opened.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;
    const release = acquireLock(agentRunLockPath(config));
    expect(release).not.toBeNull();
    const releaseTimer = setTimeout(() => release?.(), 30);

    try {
      await expect(handleUpdateMemory(
        config,
        {
          session_id: "claude-session-waiting",
          transcript_path: transcriptPath,
          cwd: projectPath,
        },
        log,
        vi.fn(async () => client) as AgentClientFactory,
      )).resolves.toBe("");
    } finally {
      clearTimeout(releaseTimer);
      release?.();
    }

    expect(log).toHaveBeenCalledWith(
      "info",
      "update-waiting-agent-busy",
    );
    expect(log).not.toHaveBeenCalledWith(
      "info",
      "update-deferred-agent-busy",
    );
    expect(opened.sent[0]).toContain("等待锁后仍需记忆的消息");
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-waiting",
    )).toMatchObject({
      conversationId: "conversation-after-wait",
      lastProcessedLine: 0,
    });
  });

  it("同一会话的连续 Stop 按冻结上界入队并依次处理", async () => {
    const config = createConfig();
    const transcriptPath = createTranscript(config, "第一行消息");
    const projectPath = join(config.dataDir, "project");
    const first = createSession("conversation-queue", "第一版上下文");
    const second = createSession("conversation-queue", "第二版上下文");
    saveAgentReference(config, projectPath, "agent-1");
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => first.session),
      resumeSession: vi.fn(() => second.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const clientFactory = vi.fn(async () => client) as AgentClientFactory;
    const log = vi.fn() as LogFunction;

    await handleEnqueueMemory(config, {
      session_id: "claude-session-queue",
      transcript_path: transcriptPath,
      cwd: projectPath,
    }, log);
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "第二行消息" }] },
      })}\n`,
      "utf8",
    );
    await handleEnqueueMemory(config, {
      session_id: "claude-session-queue",
      transcript_path: transcriptPath,
      cwd: projectPath,
      stop_hook_active: true,
    }, log);

    expect(listPendingUpdates(config, true).map((pending) => (
      pending.transcriptEndLine
    ))).toEqual([0, 1]);

    await expect(
      handleDrainPending(config, log, clientFactory),
    ).resolves.toBe("");

    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]).toContain("第一行消息");
    expect(first.sent[0]).not.toContain("第二行消息");
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0]).toContain("第二行消息");
    expect(second.sent[0]).not.toContain("第一行消息");
    expect(listPendingUpdates(config, true)).toHaveLength(0);
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-queue",
    )).toMatchObject({
      conversationId: "conversation-queue",
      lastProcessedLine: 1,
    });
  });

  it("fork 会话从继承转录尾部开始且只发送新增消息", async () => {
    const config = createConfig();
    const transcriptPath = createTranscript(config, "继承的第一行");
    const projectPath = join(config.dataDir, "fork-project");
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "继承的第二行" }] },
      })}\n`,
      "utf8",
    );

    await handleSessionStart(config, {
      session_id: "claude-session-fork",
      transcript_path: transcriptPath,
      cwd: projectPath,
      source: "fork",
    });
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-fork",
    ).lastProcessedLine)
      .toBe(1);

    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "user",
        message: { content: [{ type: "text", text: "分叉后的新增消息" }] },
      })}\n`,
      "utf8",
    );
    const opened = createSession("conversation-fork", "分叉后的上下文");
    saveAgentReference(config, projectPath, "agent-1");
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => opened.session),
      resumeSession: vi.fn(() => opened.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };

    await handleUpdateMemory(
      config,
      {
        session_id: "claude-session-fork",
        transcript_path: transcriptPath,
        cwd: projectPath,
      },
      vi.fn() as LogFunction,
      vi.fn(async () => client) as AgentClientFactory,
    );

    expect(opened.sent).toHaveLength(1);
    expect(opened.sent[0]).toContain("分叉后的新增消息");
    expect(opened.sent[0]).not.toContain("继承的第一行");
    expect(opened.sent[0]).not.toContain("继承的第二行");
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-fork",
    ).lastProcessedLine)
      .toBe(2);
  });

  it("compact 时保留工作区与共享 Agent 的会话映射", async () => {
    const config = { ...createConfig(), sharedMemory: true };
    const workspacePath = join(config.dataDir, "compact-shared-workspace");
    saveSessionState(config, {
      version: 1,
      sessionId: "compact-shared-session",
      workspacePath,
      agentId: "agent-workspace",
      agentModel: "auto",
      conversationId: "conversation-workspace",
      sharedAgentId: "agent-shared",
      sharedAgentModel: "auto",
      sharedConversationId: "conversation-shared",
      lastProcessedLine: 4,
      recentDigests: ["digest-one"],
      pendingAssistantDigests: [],
    });

    await handleSessionStart(config, {
      session_id: "compact-shared-session",
      cwd: workspacePath,
      source: "compact",
    });

    expect(loadSessionState(
      config,
      workspacePath,
      "compact-shared-session",
    )).toMatchObject({
      agentId: "agent-workspace",
      conversationId: "conversation-workspace",
      sharedAgentId: "agent-shared",
      sharedConversationId: "conversation-shared",
      lastProcessedLine: 4,
    });
  });

  it("入队时将相对 transcript 路径规范为绝对路径", async () => {
    const config = createConfig();
    const transcriptPath = createTranscript(config, "相对路径消息");

    await handleEnqueueMemory(config, {
      session_id: "claude-session-relative-path",
      transcript_path: "transcript.jsonl",
      cwd: config.dataDir,
    }, vi.fn() as LogFunction);

    const pending = listPendingUpdates(config, true);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.transcriptPath).toBe(transcriptPath);
    expect(pending[0]?.transcriptEndLine).toBe(0);
  });

  it("单个 pending 超过批次限制时会完整分批发送", async () => {
    const config = createConfig();
    config.maxBatchChars = 80;
    const projectPath = join(config.dataDir, "batch-project");
    const transcriptPath = createTranscript(config, "第一批消息");
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "第二批消息" }] },
      })}\n${JSON.stringify({
        type: "user",
        message: { content: [{ type: "text", text: "第三批消息" }] },
      })}\n`,
      "utf8",
    );
    const opened = createSession("conversation-batches", "分批更新上下文");
    saveAgentReference(config, projectPath, "agent-1");
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => opened.session),
      resumeSession: vi.fn(() => opened.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const log = vi.fn() as LogFunction;

    await handleEnqueueMemory(config, {
      session_id: "claude-session-batches",
      transcript_path: transcriptPath,
      cwd: projectPath,
    }, log);
    expect(listPendingUpdates(config, true)).toHaveLength(1);

    await handleDrainPending(
      config,
      log,
      vi.fn(async () => client) as AgentClientFactory,
    );

    expect(opened.sent).toHaveLength(3);
    expect(opened.sent[0]).toContain("第一批消息");
    expect(opened.sent[0]).not.toContain("第二批消息");
    expect(opened.sent[1]).toContain("第二批消息");
    expect(opened.sent[1]).not.toContain("第三批消息");
    expect(opened.sent[2]).toContain("第三批消息");
    expect(loadSessionState(
      config,
      projectPath,
      "claude-session-batches",
    ).lastProcessedLine)
      .toBe(2);
    expect(listPendingUpdates(config, true)).toHaveLength(0);
    expect(client.createSession).toHaveBeenCalledOnce();
    expect(client.resumeSession).not.toHaveBeenCalled();
  });

  it("队首失败时不会越过同一会话的后续 pending", async () => {
    const config = createConfig();
    const transcriptPath = createTranscript(config, "队首消息");
    const log = vi.fn() as LogFunction;
    const input = {
      session_id: "claude-session-ordered-retry",
      transcript_path: transcriptPath,
      cwd: join(config.dataDir, "first-project"),
    };

    await handleEnqueueMemory(config, input, log);
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "user",
        message: { content: [{ type: "text", text: "后续消息" }] },
      })}\n`,
      "utf8",
    );
    await handleEnqueueMemory(config, input, log);

    const clientFactory = vi.fn(async () => {
      throw new Error("模拟队首处理失败");
    }) as AgentClientFactory;
    await handleDrainPending(config, log, clientFactory);

    expect(clientFactory).toHaveBeenCalledOnce();
    expect(listPendingUpdates(config, true)).toHaveLength(2);
    expect(listPendingUpdates(config)).toHaveLength(0);
    expect(loadSessionState(
      config,
      input.cwd,
      "claude-session-ordered-retry",
    ).lastProcessedLine).toBe(-1);
  });

  it("最终助手消息稍后写入转录时只交付一次", async () => {
    const config = createConfig();
    const transcriptPath = createTranscript(config, "本轮问题");
    const projectPath = join(config.dataDir, "assistant-fallback-project");
    const opened = createSession("conversation-fallback", "已记录回答");
    saveAgentReference(config, projectPath, "agent-1");
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => opened.session),
      resumeSession: vi.fn(() => opened.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const clientFactory = vi.fn(async () => client) as AgentClientFactory;
    const log = vi.fn() as LogFunction;
    const input = {
      session_id: "claude-session-assistant-fallback",
      transcript_path: transcriptPath,
      cwd: projectPath,
      last_assistant_message: "尚未写入 JSONL 的最终回答",
    };

    await handleUpdateMemory(config, input, log, clientFactory);
    expect(opened.sent).toHaveLength(1);
    expect(opened.sent[0]).toContain("尚未写入 JSONL 的最终回答");
    expect(loadSessionState(
      config,
      projectPath,
      input.session_id,
    ).pendingAssistantDigests).toHaveLength(1);

    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "尚未写入 JSONL 的最终回答" }],
        },
      })}\n`,
      "utf8",
    );
    await handleUpdateMemory(config, input, log, clientFactory);

    expect(clientFactory).toHaveBeenCalledOnce();
    expect(opened.sent).toHaveLength(1);
    expect(loadSessionState(config, projectPath, input.session_id)).toMatchObject({
      lastProcessedLine: 1,
      pendingAssistantDigests: [],
    });
    expect(listPendingUpdates(config, true)).toHaveLength(0);
  });

  it("Agent 返回空上下文时保留上一版可注入快照", async () => {
    const config = createConfig();
    const transcriptPath = createTranscript(config, "第一轮需要保留的消息");
    const projectPath = join(config.dataDir, "empty-guidance-project");
    const first = createSession("conversation-empty", "应继续保留的上下文");
    const second = createSession(
      "conversation-empty",
      "该会话包含重要决策，需要更新记忆文件。已完成更新。没有新的上下文需要返回给下一轮 Claude Code——这些信息已持久化。\n",
    );
    saveAgentReference(config, projectPath, "agent-1");
    const client: AgentClient = {
      createAgent: vi.fn(async () => "agent-unused"),
      createSession: vi.fn(() => first.session),
      resumeSession: vi.fn(() => second.session),
      agents: {
        list: vi.fn(async () => []),
      },
    };
    const input = {
      session_id: "claude-session-empty-guidance",
      transcript_path: transcriptPath,
      cwd: projectPath,
    };
    const clientFactory = vi.fn(async () => client) as AgentClientFactory;
    const log = vi.fn() as LogFunction;

    await handleUpdateMemory(config, input, log, clientFactory);
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "user",
        message: { content: [{ type: "text", text: "没有新增记忆价值" }] },
      })}\n`,
      "utf8",
    );
    await handleUpdateMemory(config, input, log, clientFactory);

    expect(second.sent).toHaveLength(1);
    expect(loadContextSnapshot(config, projectPath)?.text)
      .toBe("应继续保留的上下文");
    expect(loadSessionState(
      config,
      projectPath,
      input.session_id,
    ).lastProcessedLine).toBe(1);
  });
});
