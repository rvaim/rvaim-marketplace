import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfig } from "../src/config.js";

const temporaryDirectories: string[] = [];
const missingConfigPath = join(
  tmpdir(),
  `letta-mem-config-missing-${process.pid}.json`,
);

function env(values: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CLAUDE_PLUGIN_DATA: "/tmp/letta-mem-tests",
    LETTA_MEM_CONFIG_PATH: missingConfigPath,
    ...values,
  };
}

function sharedConfig(value: object): string {
  const directory = mkdtempSync(join(tmpdir(), "letta-mem-config-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "config.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("运行配置", () => {
  it("默认连接本机的远程 App Server", () => {
    const config = readRuntimeConfig(env());

    expect(config.serverUrl).toBe("http://127.0.0.1:4500");
    expect(config.autoStartServer).toBe(true);
    expect(config.model).toBe("auto");
    expect(config.mixedMemory).toBe(false);
    expect(config.sharedMemory).toBe(true);
    expect(config.namespace).toHaveLength(20);
  });

  it("Claude Code 与 Codex 可以读取同一个共享配置文件", () => {
    const path = sharedConfig({
      serverUrl: "ws://127.0.0.1:4600/ws",
      autoStartServer: false,
      model: "deepseek/deepseek-v4-flash",
      mixedMemory: true,
      sharedMemory: false,
    });
    const config = readRuntimeConfig(env({ LETTA_MEM_CONFIG_PATH: path }));

    expect(config.serverUrl).toBe("http://127.0.0.1:4600");
    expect(config.autoStartServer).toBe(false);
    expect(config.model).toBe("deepseek/deepseek-v4-flash");
    expect(config.mixedMemory).toBe(true);
    expect(config.sharedMemory).toBe(false);
  });

  it("环境变量可以临时覆盖共享配置文件", () => {
    const path = sharedConfig({
      serverUrl: "http://127.0.0.1:4600",
      autoStartServer: false,
      model: "deepseek/deepseek-v4-flash",
      mixedMemory: true,
      sharedMemory: false,
    });
    const config = readRuntimeConfig(env({
      LETTA_MEM_CONFIG_PATH: path,
      LETTA_APP_SERVER_URL: "http://127.0.0.1:4700",
      LETTA_MEM_AUTO_START_SERVER: "true",
      LETTA_MEM_MODEL: "auto",
      LETTA_MEM_MIXED_MEMORY: "false",
      LETTA_MEM_SHARED_MEMORY: "true",
    }));

    expect(config.serverUrl).toBe("http://127.0.0.1:4700");
    expect(config.autoStartServer).toBe(true);
    expect(config.model).toBe("auto");
    expect(config.mixedMemory).toBe(false);
    expect(config.sharedMemory).toBe(true);
  });

  it("模型变化复用状态，混合记忆模式使用独立命名空间", () => {
    const automatic = readRuntimeConfig(env({ LETTA_MEM_MODEL: "auto" }));
    const explicit = readRuntimeConfig(env({
      LETTA_MEM_MODEL: "deepseek/deepseek-v4-flash",
    }));
    const mixed = readRuntimeConfig(env({
      LETTA_MEM_MODEL: "deepseek/deepseek-v4-flash",
      LETTA_MEM_MIXED_MEMORY: "true",
    }));

    expect(automatic.namespace).toBe(explicit.namespace);
    expect(mixed.namespace).not.toBe(explicit.namespace);
  });

  it("切换共享记忆不会丢失原工作区状态命名空间", () => {
    const enabled = readRuntimeConfig(env({
      LETTA_MEM_SHARED_MEMORY: "true",
    }));
    const disabled = readRuntimeConfig(env({
      LETTA_MEM_SHARED_MEMORY: "false",
    }));

    expect(enabled.namespace).toBe(disabled.namespace);
  });

  it("切换自动启动不会改变记忆状态命名空间", () => {
    const enabled = readRuntimeConfig(env({
      LETTA_MEM_AUTO_START_SERVER: "true",
    }));
    const disabled = readRuntimeConfig(env({
      LETTA_MEM_AUTO_START_SERVER: "false",
    }));

    expect(enabled.namespace).toBe(disabled.namespace);
  });

  it("将空模型和 auto 别名规范为 auto", () => {
    expect(readRuntimeConfig(env({ LETTA_MEM_MODEL: " " })).model).toBe("auto");
    expect(readRuntimeConfig(env({ LETTA_MEM_MODEL: "letta/auto" })).model)
      .toBe("auto");
    expect(readRuntimeConfig(env({ LETTA_MEM_MODEL: "AUTO" })).model)
      .toBe("auto");
  });

  it("拒绝无效的混合记忆布尔值", () => {
    expect(() => readRuntimeConfig(env({
      LETTA_MEM_MIXED_MEMORY: "yes",
    }))).toThrow("混合记忆配置必须是");
  });

  it("拒绝无效的共享记忆布尔值", () => {
    expect(() => readRuntimeConfig(env({
      LETTA_MEM_SHARED_MEMORY: "yes",
    }))).toThrow("共享记忆配置必须是");
  });

  it("拒绝无效的自动启动布尔值", () => {
    expect(() => readRuntimeConfig(env({
      LETTA_MEM_AUTO_START_SERVER: "yes",
    }))).toThrow("App Server 自动启动配置必须是");
  });

  it("拒绝共享配置中类型错误的 autoStartServer", () => {
    const path = sharedConfig({ autoStartServer: "true" });

    expect(() => readRuntimeConfig(env({ LETTA_MEM_CONFIG_PATH: path })))
      .toThrow("共享配置 autoStartServer 必须是布尔值");
  });

  it("拒绝共享配置中类型错误的 sharedMemory", () => {
    const path = sharedConfig({ sharedMemory: "true" });

    expect(() => readRuntimeConfig(env({ LETTA_MEM_CONFIG_PATH: path })))
      .toThrow("共享配置 sharedMemory 必须是布尔值");
  });

  it("接受 App Server 的 WebSocket 地址并规范为 HTTP 根地址", () => {
    const config = readRuntimeConfig(env({
      LETTA_APP_SERVER_URL: "ws://127.0.0.1:4500/ws",
    }));

    expect(config.serverUrl).toBe("http://127.0.0.1:4500");
  });

  it("切换 App Server 地址时使用独立状态命名空间", () => {
    const first = readRuntimeConfig(env({
      LETTA_APP_SERVER_URL: "http://127.0.0.1:4500",
    }));
    const second = readRuntimeConfig(env({
      LETTA_APP_SERVER_URL: "ws://127.0.0.1:4600",
    }));

    expect(first.namespace).not.toBe(second.namespace);
  });

  it("切换 App Server 令牌时隔离本地状态", () => {
    const first = readRuntimeConfig(env({
      LETTA_APP_SERVER_TOKEN: "first-capability-token",
    }));
    const second = readRuntimeConfig(env({
      LETTA_APP_SERVER_TOKEN: "second-capability-token",
    }));

    expect(first.namespace).not.toBe(second.namespace);
    expect(first.namespace).not.toContain("first-capability-token");
  });

  it.each([
    ["不支持的协议", { LETTA_APP_SERVER_URL: "ftp://127.0.0.1:4500" }],
    ["带路径的 WebSocket 地址", { LETTA_APP_SERVER_URL: "ws://127.0.0.1:4500/v1" }],
    ["内嵌凭据的地址", { LETTA_APP_SERVER_URL: "ws://token@127.0.0.1:4500" }],
    ["带查询参数的地址", { LETTA_APP_SERVER_URL: "ws://127.0.0.1:4500?token=value" }],
  ])("拒绝%s", (_name, values) => {
    expect(() => readRuntimeConfig(env(values))).toThrow();
  });
});
