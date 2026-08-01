import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimCachedContext,
  normalizeWorkspacePath,
} from "../src/context.js";
import {
  saveContextSnapshot,
  sha256,
} from "../src/state.js";
import type { RuntimeConfig } from "../src/types.js";

const temporaryDirectories: string[] = [];

function createConfig(): RuntimeConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "letta-mem-context-"));
  temporaryDirectories.push(dataDir);
  return {
    serverUrl: "ws://127.0.0.1:4500",
    dataDir,
    namespace: "context-tests",
    requestTimeoutMs: 1_000,
    maxContextChars: 8_000,
    maxBatchChars: 80_000,
    disabled: false,
  };
}

function saveSnapshot(
  config: RuntimeConfig,
  projectPath: string,
  revision: string,
  text: string,
): void {
  saveContextSnapshot(config, {
    version: 1,
    agentId: "agent-1",
    workspacePath: projectPath,
    revision,
    updatedAt: new Date().toISOString(),
    text,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("上下文快照注入", () => {
  it("同一 revision 对每个 Claude 会话只注入一次", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    saveSnapshot(config, projectPath, "revision-1", "第一版记忆");

    const first = await claimCachedContext(config, "session-a", projectPath);
    const duplicate = await claimCachedContext(config, "session-a", projectPath);
    const otherSession = await claimCachedContext(config, "session-b", projectPath);
    saveSnapshot(config, projectPath, "revision-2", "第二版记忆");
    const nextRevision = await claimCachedContext(config, "session-a", projectPath);

    expect(first).not.toBe("");
    expect(duplicate).toBe("");
    expect(otherSession).not.toBe("");
    expect(nextRevision).not.toBe("");
  });

  it("对注入内容进行 XML 转义", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    saveSnapshot(config, projectPath, "revision-xml", "甲<&>\"'乙");

    const output = await claimCachedContext(config, "session-xml", projectPath);
    const parsed = JSON.parse(output) as {
      hookSpecificOutput: { additionalContext: string };
    };

    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "甲&lt;&amp;&gt;&quot;&apos;乙",
    );
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("甲<&>");
  });

  it("会话状态损坏时仍能故障开放并重新建立状态", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const sessionId = "damaged-session";
    saveSnapshot(config, projectPath, "revision-damaged", "可用记忆");
    const sessionPath = join(
      config.dataDir,
      "state",
      config.namespace,
      "sessions",
      `${sha256(`${projectPath}\0${sessionId}`).slice(0, 24)}.json`,
    );
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, "{已损坏", "utf8");

    await expect(
      claimCachedContext(config, sessionId, projectPath),
    ).resolves.not.toBe("");
  });

  it("上下文快照损坏时静默跳过注入", async () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "project");
    const contextPath = join(
      config.dataDir,
      "state",
      config.namespace,
      "contexts",
      `${sha256(projectPath).slice(0, 24)}.json`,
    );
    mkdirSync(dirname(contextPath), { recursive: true });
    writeFileSync(contextPath, "{已损坏", "utf8");

    await expect(
      claimCachedContext(config, "session-damaged-context", projectPath),
    ).resolves.toBe("");
  });

  it("多字节长文本仍输出完整且不超过 Hook 限制的 JSON", async () => {
    const config = {
      ...createConfig(),
      maxContextChars: 100_000,
    };
    const projectPath = join(config.dataDir, "project");
    saveSnapshot(
      config,
      projectPath,
      "revision-large",
      "长上下文<&>\n".repeat(10_000),
    );

    const output = await claimCachedContext(config, "session-large", projectPath);

    expect(() => JSON.parse(output)).not.toThrow();
    expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(9_000);
    expect(output).toContain("上下文已截断");
  });

  it("工作区主目录不会被 Git 根目录替换", () => {
    const config = createConfig();
    const projectPath = join(config.dataDir, "git-project");
    const nestedPath = join(projectPath, "packages", "feature");
    mkdirSync(join(projectPath, ".git"), { recursive: true });
    mkdirSync(nestedPath, { recursive: true });

    expect(normalizeWorkspacePath(nestedPath)).not.toBe(
      normalizeWorkspacePath(projectPath),
    );
    expect(normalizeWorkspacePath(nestedPath)).toMatch(/packages\/feature$/);
  });
});
