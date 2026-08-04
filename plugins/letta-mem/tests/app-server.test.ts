import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  commandFromPath,
  ensureAppServer,
  LettaSetupError,
} from "../src/app-server.js";
import type { AppServerDependencies } from "../src/app-server.js";
import type { LogFunction, RuntimeConfig } from "../src/types.js";

function createConfig(
  values: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  return {
    serverUrl: "http://127.0.0.1:4500",
    autoStartServer: true,
    model: "auto",
    dataDir: "/tmp/letta-mem-app-server-tests",
    coordinationDir: "/tmp/letta-mem-app-server-tests-coordination",
    namespace: "app-server-tests",
    requestTimeoutMs: 1_000,
    maxContextChars: 8_000,
    maxBatchChars: 80_000,
    disabled: false,
    ...values,
  };
}

function neverExits(): Promise<string> {
  return new Promise(() => {});
}

function setup(
  probes: Array<{ ready: boolean; incompatible?: string }>,
): {
  dependencies: Partial<AppServerDependencies>;
  resolveLettaCommand: ReturnType<typeof vi.fn>;
  launch: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const probe = vi.fn(async () => probes.shift() ?? { ready: false });
  const resolveLettaCommand = vi.fn(() => ({
    command: "/usr/local/bin/letta",
    argsPrefix: [],
    displayName: "/usr/local/bin/letta",
  }));
  const launch = vi.fn(() => ({ pid: 1234, exited: neverExits() }));
  const release = vi.fn();
  return {
    dependencies: {
      probe,
      resolveLettaCommand,
      launch,
      acquireLock: vi.fn(() => release),
      delay: vi.fn(async () => {}),
      startupTimeoutMs: 50,
    },
    resolveLettaCommand,
    launch,
    release,
  };
}

describe("常驻 Letta App Server", () => {
  it("Windows 将 npm 的无扩展名 shim 映射到 letta.cmd", () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-command-"));
    try {
      const shim = join(directory, "letta");
      writeFileSync(shim, "#!/bin/sh\n");
      writeFileSync(`${shim}.cmd`, "@echo off\r\n");

      expect(commandFromPath(shim, "win32")).toEqual({
        command: process.env.ComSpec || "cmd.exe",
        argsPrefix: ["/d", "/s", "/c", `${shim}.cmd`],
        displayName: `${shim}.cmd`,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("macOS 直接执行无扩展名 letta，不读取 Windows shim", () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-command-"));
    try {
      const shim = join(directory, "letta");
      writeFileSync(shim, "#!/bin/sh\n");
      writeFileSync(`${shim}.cmd`, "@echo off\r\n");

      expect(commandFromPath(shim, "darwin")).toEqual({
        command: shim,
        argsPrefix: [],
        displayName: shim,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("要求本机自动启动模式存在用户安装的 letta 命令", async () => {
    const current = setup([]);
    current.dependencies.resolveLettaCommand = vi.fn(() => null);

    await expect(ensureAppServer(
      createConfig(),
      vi.fn() as LogFunction,
      current.dependencies,
    )).rejects.toThrow("npm install -g @letta-ai/letta-code");

    expect(current.launch).not.toHaveBeenCalled();
  });

  it("已运行时直接复用且不创建新进程", async () => {
    const current = setup([{ ready: true }]);

    await expect(ensureAppServer(
      createConfig(),
      vi.fn() as LogFunction,
      current.dependencies,
    )).resolves.toBe("ready");

    expect(current.resolveLettaCommand).toHaveBeenCalledOnce();
    expect(current.launch).not.toHaveBeenCalled();
  });

  it("服务未运行时使用用户命令启动固定端口并保持进程独立", async () => {
    const current = setup([
      { ready: false },
      { ready: false },
      { ready: true },
    ]);

    await expect(ensureAppServer(
      createConfig(),
      vi.fn() as LogFunction,
      current.dependencies,
    )).resolves.toBe("started");

    expect(current.launch).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "/usr/local/bin/letta" }),
      "ws://127.0.0.1:4500",
    );
    expect(current.release).toHaveBeenCalledOnce();
  });

  it("并发启动时等待另一个宿主完成", async () => {
    const current = setup([
      { ready: false },
      { ready: true },
    ]);
    current.dependencies.acquireLock = vi.fn(() => null);

    await expect(ensureAppServer(
      createConfig(),
      vi.fn() as LogFunction,
      current.dependencies,
    )).resolves.toBe("ready");

    expect(current.launch).not.toHaveBeenCalled();
  });

  it("端口被不兼容服务占用时明确报错", async () => {
    const current = setup([{
      ready: false,
      incompatible: "协议版本不兼容",
    }]);

    await expect(ensureAppServer(
      createConfig(),
      vi.fn() as LogFunction,
      current.dependencies,
    )).rejects.toEqual(expect.objectContaining<Partial<LettaSetupError>>({
      name: "LettaSetupError",
      message: "协议版本不兼容",
    }));
  });

  it.each([
    ["关闭自动启动", { autoStartServer: false }],
    ["使用能力令牌", { authToken: "secret" }],
    ["远程地址", { serverUrl: "https://letta.example.test" }],
  ])("%s时只交给远程客户端连接", async (_label, values) => {
    const current = setup([]);

    await expect(ensureAppServer(
      createConfig(values),
      vi.fn() as LogFunction,
      current.dependencies,
    )).resolves.toBe("skipped");

    expect(current.resolveLettaCommand).not.toHaveBeenCalled();
    expect(current.launch).not.toHaveBeenCalled();
  });
});
