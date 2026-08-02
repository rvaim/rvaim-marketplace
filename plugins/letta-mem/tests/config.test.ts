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
    LETTA_MEM_COORDINATION_DIR: "/tmp/letta-mem-tests-coordination",
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
  it("默认只配置 Letta 连接与模型，不声明存储策略", () => {
    const config = readRuntimeConfig(env());

    expect(config.serverUrl).toBe("http://127.0.0.1:4500");
    expect(config.autoStartServer).toBe(true);
    expect(config.model).toBe("auto");
    expect(config.coordinationDir).toBe("/tmp/letta-mem-tests-coordination");
    expect(config.namespace).toHaveLength(20);
    expect(config).not.toHaveProperty("serverBackend");
    expect(config).not.toHaveProperty("mixedMemory");
    expect(config).not.toHaveProperty("sharedMemory");
  });

  it("Claude Code 与 Codex 可以读取同一个共享配置文件", () => {
    const path = sharedConfig({
      serverUrl: "ws://127.0.0.1:4600/ws",
      autoStartServer: false,
      model: "deepseek/deepseek-v4-flash",
    });
    const config = readRuntimeConfig(env({ LETTA_MEM_CONFIG_PATH: path }));

    expect(config.serverUrl).toBe("http://127.0.0.1:4600");
    expect(config.autoStartServer).toBe(false);
    expect(config.model).toBe("deepseek/deepseek-v4-flash");
  });

  it("环境变量可以临时覆盖共享配置文件", () => {
    const path = sharedConfig({
      serverUrl: "http://127.0.0.1:4600",
      autoStartServer: false,
      model: "deepseek/deepseek-v4-flash",
    });
    const config = readRuntimeConfig(env({
      LETTA_MEM_CONFIG_PATH: path,
      LETTA_APP_SERVER_URL: "http://127.0.0.1:4700",
      LETTA_MEM_AUTO_START_SERVER: "true",
      LETTA_MEM_MODEL: "auto",
    }));

    expect(config.serverUrl).toBe("http://127.0.0.1:4700");
    expect(config.autoStartServer).toBe(true);
    expect(config.model).toBe("auto");
  });

  it("忽略旧版存储策略字段和环境变量", () => {
    const path = sharedConfig({
      serverBackend: "unsupported-backend",
      mixedMemory: "旧值不再解析",
      sharedMemory: { enabled: true },
    });
    const baseline = readRuntimeConfig(env({ LETTA_MEM_CONFIG_PATH: path }));
    const legacyOverrides = readRuntimeConfig(env({
      LETTA_MEM_CONFIG_PATH: path,
      LETTA_MEM_SERVER_BACKEND: "任意旧值",
      LETTA_MEM_MIXED_MEMORY: "任意旧值",
      LETTA_MEM_SHARED_MEMORY: "任意旧值",
    }));

    expect(legacyOverrides).toEqual(baseline);
  });

  it("模型变化不会切换本地状态命名空间", () => {
    const automatic = readRuntimeConfig(env({ LETTA_MEM_MODEL: "auto" }));
    const explicit = readRuntimeConfig(env({
      LETTA_MEM_MODEL: "deepseek/deepseek-v4-flash",
    }));

    expect(automatic.namespace).toBe(explicit.namespace);
  });

  it("切换自动启动不会改变本地状态命名空间", () => {
    const enabled = readRuntimeConfig(env({
      LETTA_MEM_AUTO_START_SERVER: "true",
    }));
    const disabled = readRuntimeConfig(env({
      LETTA_MEM_AUTO_START_SERVER: "false",
    }));

    expect(enabled.namespace).toBe(disabled.namespace);
  });

  it("继续使用旧版每工作区状态命名空间", () => {
    const config = readRuntimeConfig(env());
    expect(config.namespace).toBe("b576c18487a1cbb4b2d1");
  });

  it("将空模型和 auto 别名规范为 auto", () => {
    expect(readRuntimeConfig(env({ LETTA_MEM_MODEL: " " })).model).toBe("auto");
    expect(readRuntimeConfig(env({ LETTA_MEM_MODEL: "letta/auto" })).model)
      .toBe("auto");
    expect(readRuntimeConfig(env({ LETTA_MEM_MODEL: "AUTO" })).model)
      .toBe("auto");
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
