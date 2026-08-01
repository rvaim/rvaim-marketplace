import { describe, expect, it, vi } from "vitest";
import {
  ensureLocalAppServer,
} from "../src/app-server.js";
import type { AppServerDependencies } from "../src/app-server.js";
import type { LogFunction, RuntimeConfig } from "../src/types.js";

function createConfig(
  serverUrl: string = "http://127.0.0.1:4500",
): RuntimeConfig {
  return {
    serverUrl,
    autoStartServer: true,
    serverBackend: "api",
    model: "auto",
    mixedMemory: false,
    sharedMemory: true,
    dataDir: "/tmp/letta-mem-app-server-tests",
    namespace: "app-server-tests",
    requestTimeoutMs: 1_000,
    maxContextChars: 8_000,
    maxBatchChars: 80_000,
    disabled: false,
  };
}

function neverExits(): Promise<string> {
  return new Promise(() => {});
}

function createDependencies(
  probeReady: AppServerDependencies["probeReady"],
): {
  dependencies: Partial<AppServerDependencies>;
  resolveLettaCodeEntry: ReturnType<typeof vi.fn>;
  launch: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const resolveLettaCodeEntry = vi.fn(() => "/runtime/letta.js");
  const launch = vi.fn(() => ({
    pid: 1234,
    exited: neverExits(),
  }));
  const release = vi.fn();
  return {
    dependencies: {
      probeReady,
      resolveLettaCodeEntry,
      launch,
      acquireLock: vi.fn(() => release),
      delay: vi.fn(async () => {}),
      startupTimeoutMs: 50,
    },
    resolveLettaCodeEntry,
    launch,
    release,
  };
}

describe("本地 App Server 自动启动", () => {
  it("已就绪时直接复用现有服务", async () => {
    const probeReady = vi.fn(async () => true);
    const setup = createDependencies(probeReady);
    const log = vi.fn() as LogFunction;

    await expect(ensureLocalAppServer(
      createConfig(),
      log,
      setup.dependencies,
    )).resolves.toBe("ready");

    expect(setup.resolveLettaCodeEntry).not.toHaveBeenCalled();
    expect(setup.launch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("本机服务不可用时启动运行时自带的匹配版本", async () => {
    const probeReady = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const setup = createDependencies(probeReady);
    const log = vi.fn() as LogFunction;

    await expect(ensureLocalAppServer(
      createConfig(),
      log,
      setup.dependencies,
    )).resolves.toBe("started");

    expect(setup.launch).toHaveBeenCalledWith(
      "/runtime/letta.js",
      "ws://127.0.0.1:4500",
      "api",
    );
    expect(setup.release).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "info",
      "app-server-started",
      "ws://127.0.0.1:4500",
    );
  });

  it("其他宿主正在启动时等待并复用其服务", async () => {
    const probeReady = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const setup = createDependencies(probeReady);
    setup.dependencies.acquireLock = vi.fn(() => null);
    const log = vi.fn() as LogFunction;

    await expect(ensureLocalAppServer(
      createConfig(),
      log,
      setup.dependencies,
    )).resolves.toBe("ready");

    expect(setup.launch).not.toHaveBeenCalled();
  });

  it.each([
    ["关闭自动启动", { autoStartServer: false }],
    ["配置能力令牌", { authToken: "secret-token" }],
  ])("%s时不创建本地服务", async (_label, values) => {
    const config = { ...createConfig(), ...values };
    const probeReady = vi.fn(async () => false);
    const setup = createDependencies(probeReady);

    await expect(ensureLocalAppServer(
      config,
      vi.fn() as LogFunction,
      setup.dependencies,
    )).resolves.toBe("skipped");

    expect(probeReady).not.toHaveBeenCalled();
    expect(setup.launch).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1:4500",
    "http://192.168.1.20:4500",
    "https://letta.example.test",
  ])("远程或非明文本机地址只连接不自动启动：%s", async (serverUrl) => {
    const probeReady = vi.fn(async () => false);
    const setup = createDependencies(probeReady);

    await expect(ensureLocalAppServer(
      createConfig(serverUrl),
      vi.fn() as LogFunction,
      setup.dependencies,
    )).resolves.toBe("skipped");

    expect(probeReady).not.toHaveBeenCalled();
    expect(setup.launch).not.toHaveBeenCalled();
  });

  it("缺少配套入口时记录故障并静默返回", async () => {
    const probeReady = vi.fn(async () => false);
    const setup = createDependencies(probeReady);
    setup.dependencies.resolveLettaCodeEntry = vi.fn(() => null);
    const log = vi.fn() as LogFunction;

    await expect(ensureLocalAppServer(
      createConfig(),
      log,
      setup.dependencies,
    )).resolves.toBe("failed");

    expect(setup.launch).not.toHaveBeenCalled();
    expect(setup.release).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("warn", "app-server-entry-missing");
  });

  it("启动异常时释放锁且不向宿主抛错", async () => {
    const probeReady = vi.fn(async () => false);
    const setup = createDependencies(probeReady);
    setup.dependencies.launch = vi.fn(() => {
      throw new Error("模拟启动失败");
    });
    const log = vi.fn() as LogFunction;

    await expect(ensureLocalAppServer(
      createConfig(),
      log,
      setup.dependencies,
    )).resolves.toBe("failed");

    expect(setup.release).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "warn",
      "app-server-start-failed",
      "模拟启动失败",
    );
  });
});
