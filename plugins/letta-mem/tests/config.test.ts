import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "../src/config.js";

function env(values: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CLAUDE_PLUGIN_DATA: "/tmp/letta-mem-tests",
    ...values,
  };
}

describe("运行配置", () => {
  it("默认连接本机的远程 App Server", () => {
    const config = readRuntimeConfig(env());

    expect(config.serverUrl).toBe("http://127.0.0.1:4500");
    expect(config.namespace).toHaveLength(20);
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
