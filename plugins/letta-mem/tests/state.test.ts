import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  agentRunLockPath,
  bindSessionWorkspace,
  findActivatedSessionWorkspace,
  loadAgentReference,
  loadGuidanceReference,
  loadSessionWorkspaceBinding,
  loadSharedAgentReference,
  listPendingUpdates,
  saveAgentReference,
  saveGuidanceReference,
  savePendingUpdate,
  saveSessionState,
  sha256,
} from "../src/state.js";
import { createLogger } from "../src/logger.js";
import type { RuntimeConfig } from "../src/types.js";

const temporaryDirectories: string[] = [];

function createConfig(values: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "letta-mem-state-"));
  temporaryDirectories.push(dataDir);
  return {
    serverUrl: "ws://127.0.0.1:4500",
    autoStartServer: false,
    model: "auto",
    dataDir,
    coordinationDir: join(dataDir, "coordination"),
    namespace: "state-tests",
    requestTimeoutMs: 1_000,
    maxContextChars: 8_000,
    maxBatchChars: 80_000,
    disabled: false,
    ...values,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("本地状态", () => {
  it("会话工作区首次绑定后不会被后续 cwd 覆盖", async () => {
    const config = createConfig();
    const first = await bindSessionWorkspace(
      config,
      "stable-session",
      "/tmp/project-root",
      250,
    );
    const second = await bindSessionWorkspace(
      config,
      "stable-session",
      "/tmp/project-root/generated-child",
      250,
    );

    expect(first?.workspacePath).toBe("/tmp/project-root");
    expect(second?.workspacePath).toBe("/tmp/project-root");
    expect(loadSessionWorkspaceBinding(config, "stable-session")?.workspacePath)
      .toBe("/tmp/project-root");
  });

  it("旧会话迁移时选择最早激活的工作区状态", () => {
    const config = createConfig();
    saveSessionState(config, {
      version: 1,
      sessionId: "legacy-stable-session",
      workspacePath: "/tmp/project-root/generated-child",
      activatedAt: "2026-08-02T08:10:00.000Z",
      lastProcessedLine: -1,
      recentDigests: [],
    });
    saveSessionState(config, {
      version: 1,
      sessionId: "legacy-stable-session",
      workspacePath: "/tmp/project-root",
      activatedAt: "2026-08-02T08:00:00.000Z",
      lastProcessedLine: -1,
      recentDigests: [],
    });

    expect(findActivatedSessionWorkspace(config, "legacy-stable-session"))
      .toBe("/tmp/project-root");
  });

  it("不同宿主数据目录共享同一工作区的 Agent 引用和运行锁", () => {
    const coordinationDir = mkdtempSync(join(tmpdir(), "letta-mem-shared-"));
    temporaryDirectories.push(coordinationDir);
    const first = createConfig({ coordinationDir });
    const second = createConfig({ coordinationDir });
    const workspacePath = "/tmp/shared-workspace";

    saveAgentReference(first, workspacePath, "agent-shared");

    expect(loadSharedAgentReference(second, workspacePath)?.agentId)
      .toBe("agent-shared");
    expect(agentRunLockPath(first, workspacePath))
      .toBe(agentRunLockPath(second, workspacePath));
    const release = acquireLock(agentRunLockPath(first, workspacePath));
    expect(release).not.toBeNull();
    expect(acquireLock(agentRunLockPath(second, workspacePath))).toBeNull();
    release?.();
  });

  it("兼容读取旧版按工作区保存的 Agent 引用", () => {
    const config = createConfig();
    const workspacePath = "/tmp/legacy-workspace";
    const agentsPath = join(
      config.dataDir,
      "state",
      config.namespace,
      "agents",
    );
    mkdirSync(agentsPath, { recursive: true });
    writeFileSync(
      join(agentsPath, `${sha256(workspacePath).slice(0, 24)}.json`),
      `${JSON.stringify({
        version: 1,
        agentId: "agent-legacy",
        workspacePath,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    expect(loadAgentReference(config, workspacePath)).toEqual({
      version: 1,
      agentId: "agent-legacy",
      scopeKey: workspacePath,
      model: "auto",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("旧锁被接管后原所有者不能删除新锁", () => {
    const config = createConfig();
    const lockPath = agentRunLockPath(config);
    const releaseOld = acquireLock(lockPath);
    expect(releaseOld).not.toBeNull();

    const oldOwner = readdirSync(lockPath)[0];
    expect(oldOwner).toBeDefined();
    const staleTime = new Date(Date.now() - 8 * 60_000);
    utimesSync(join(lockPath, oldOwner ?? ""), staleTime, staleTime);

    const releaseNew = acquireLock(lockPath);
    expect(releaseNew).not.toBeNull();
    releaseOld?.();

    expect(existsSync(lockPath)).toBe(true);
    expect(readdirSync(lockPath)).toHaveLength(1);
    releaseNew?.();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("不同宿主数据目录共享下一轮指导的 Letta 消息引用", () => {
    const coordinationDir = mkdtempSync(join(tmpdir(), "letta-mem-guidance-"));
    temporaryDirectories.push(coordinationDir);
    const first = createConfig({ coordinationDir });
    const second = createConfig({ coordinationDir });
    const workspacePath = "/tmp/shared-guidance-workspace";

    saveGuidanceReference(first, {
      version: 1,
      agentId: "agent-guidance",
      workspacePath,
      conversationId: "conversation-guidance",
      messageId: "message-guidance",
      revision: "revision-guidance",
      empty: false,
      updatedAt: "2026-08-02T00:00:00.000Z",
    });

    expect(loadGuidanceReference(second, workspacePath)).toEqual({
      version: 1,
      agentId: "agent-guidance",
      workspacePath,
      conversationId: "conversation-guidance",
      messageId: "message-guidance",
      revision: "revision-guidance",
      empty: false,
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("状态目录和队列文件使用私有权限", () => {
    const config = createConfig();
    savePendingUpdate(config, {
      version: 1,
      revision: "permission-revision",
      sessionId: "permission-session",
      workspacePath: "/tmp/permission-workspace",
      transcriptEndLine: -1,
      enqueuedAt: new Date().toISOString(),
    });

    const pending = listPendingUpdates(config, true);
    expect(pending).toHaveLength(1);
    const namespacePath = join(config.dataDir, "state", config.namespace);
    const pendingPath = join(namespacePath, "pending");
    const pendingFile = join(pendingPath, readdirSync(pendingPath)[0] ?? "");
    expect(existsSync(pendingFile)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(namespacePath).mode & 0o777).toBe(0o700);
      expect(statSync(pendingPath).mode & 0o777).toBe(0o700);
      expect(statSync(pendingFile).mode & 0o777).toBe(0o600);
    }
  });

  it("同名 Claude 会话在不同工作区中拥有独立队列", () => {
    const config = createConfig();
    const updates: Array<[string, string]> = [
      ["revision-first", "/tmp/project-first"],
      ["revision-second", "/tmp/project-second"],
    ];
    for (const [revision, workspacePath] of updates) {
      savePendingUpdate(config, {
        version: 1,
        revision,
        sessionId: "shared-session",
        workspacePath,
        transcriptEndLine: 0,
        enqueuedAt: new Date().toISOString(),
      });
    }

    expect(listPendingUpdates(config)).toHaveLength(2);
    expect(new Set(
      listPendingUpdates(config).map((pending) => pending.workspacePath),
    )).toEqual(new Set(["/tmp/project-first", "/tmp/project-second"]));
  });

  it("日志不会写入 App Server 访问令牌", () => {
    const config = {
      ...createConfig(),
      authToken: "capability-token-sensitive-value",
    };
    createLogger(config)(
      "error",
      "auth-failed",
      "capability-token-sensitive-value 无效",
    );

    const content = readFileSync(
      join(config.dataDir, "logs", "letta-mem.log"),
      "utf8",
    );
    expect(content).not.toContain("capability-token-sensitive-value");
    expect(content).toContain("[已隐藏]");
  });
});
