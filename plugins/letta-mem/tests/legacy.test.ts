import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if ([".ts", ".js", ".mjs", ".cjs", ".json"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

describe("新版 Letta 边界", () => {
  it("双宿主清单使用共享 Hook 且不声明 Claude userConfig", () => {
    const claudeManifest = JSON.parse(readFileSync(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      "utf8",
    )) as Record<string, object>;
    const codexManifest = JSON.parse(readFileSync(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      "utf8",
    )) as Record<string, object>;
    const hooks = readFileSync(
      join(pluginRoot, "hooks", "hooks.json"),
      "utf8",
    );

    expect(claudeManifest).not.toHaveProperty("userConfig");
    expect(codexManifest).not.toHaveProperty("hooks");
    expect(hooks).toContain("prepare-session-background");
    expect(hooks).toContain("UserPromptSubmit");
    expect(hooks).toContain("PreToolUse");
    expect(hooks).toContain("update-memory-background");
    expect(readFileSync(join(pluginRoot, "src", "app-server.ts"), "utf8"))
      .toContain("npm install -g @letta-ai/letta-code");
  });

  it("只直接依赖新版 Agent SDK，但运行时要求用户安装 Letta Code CLI", () => {
    const packageJson = JSON.parse(
      readFileSync(join(pluginRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const directDependencies = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    });

    expect(directDependencies).toContain("@letta-ai/letta-agent-sdk");
    expect(directDependencies).not.toContain("@letta-ai/letta-code");
    expect(directDependencies).not.toContain("@letta-ai/letta-code-sdk");
    expect(directDependencies).not.toContain("@letta-ai/letta-client");
    expect(directDependencies).not.toContain("letta-client");

    const bootstrap = readFileSync(
      join(pluginRoot, "bin", "bootstrap.cjs"),
      "utf8",
    );
    const buildScript = readFileSync(
      join(pluginRoot, "scripts", "build.mjs"),
      "utf8",
    );
    expect(bootstrap).not.toContain("npm ci");
    expect(bootstrap).not.toContain("ensureRuntime");
    expect(bootstrap).not.toContain("LETTA_MEM_SDK_ENTRY");
    expect(buildScript).not.toContain("external:");
  });

  it("Windows 后台 worker 复用 GUI 启动器且不保留 VBS 兼容链", () => {
    const bootstrap = readFileSync(
      join(pluginRoot, "bin", "bootstrap.cjs"),
      "utf8",
    );

    expect(bootstrap).toContain('process.platform === "win32"');
    expect(bootstrap).toContain('"letta-mem-launcher.exe"');
    expect(bootstrap).toContain("WINDOWS_PROCESS_LAUNCHER");
    expect(bootstrap).toContain("stdio: [\"pipe\", \"ignore\", \"ignore\"]");
    expect(bootstrap).not.toContain("wscript.exe");
    expect(bootstrap).not.toContain("--background-input");
    expect(existsSync(join(pluginRoot, "bin", "launch-hidden.vbs"))).toBe(false);
  });

  it("生产入口不再暴露旧同步 update-memory 动作", () => {
    const bootstrap = readFileSync(
      join(pluginRoot, "bin", "bootstrap.cjs"),
      "utf8",
    );
    const cli = readFileSync(join(pluginRoot, "src", "cli.ts"), "utf8");
    const hooks = readFileSync(join(pluginRoot, "src", "hooks.ts"), "utf8");

    expect(bootstrap).not.toContain('"update-memory",');
    expect(cli).not.toContain('"update-memory"');
    expect(hooks).not.toContain("handleUpdateMemory");
  });

  it("同步 Hook 使用 ConPTY 无窗口入口且 MCP 保留长连接入口", () => {
    const hooks = JSON.parse(readFileSync(
      join(pluginRoot, "hooks", "hooks.json"),
      "utf8",
    )) as {
      hooks: Record<string, Array<{
        hooks: Array<{ command: string; commandWindows?: string }>;
      }>>;
    };
    const commands = Object.values(hooks.hooks)
      .flatMap((groups) => groups)
      .flatMap((group) => group.hooks);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command.command).toContain(
        'node "${CLAUDE_PLUGIN_ROOT}/bin/hook-launcher.cjs"',
      );
      expect(command.commandWindows).toBeUndefined();
    }

    const hookWrapper = readFileSync(
      join(pluginRoot, "bin", "hook-launcher.cjs"),
      "utf8",
    );
    const preload = readFileSync(
      join(pluginRoot, "bin", "stdio-preload.cjs"),
      "utf8",
    );
    expect(hookWrapper).toContain('"letta-mem-hook-launcher.exe"');
    expect(hookWrapper).toContain('stdio: "inherit"');
    expect(hookWrapper.match(/require\(bootstrapPath\)/g)).toHaveLength(1);
    expect(hookWrapper).not.toContain("existsSync");
    expect(preload).toContain("LETTA_MEM_HOOK_STDIN_FILE");
    expect(preload).toContain("LETTA_MEM_HOOK_STDOUT_FILE");
    expect(preload).toContain("LETTA_MEM_HOOK_STDERR_FILE");

    const mcp = JSON.parse(readFileSync(
      join(pluginRoot, ".mcp.json"),
      "utf8",
    )) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(mcp.mcpServers["letta-memory"]).toMatchObject({
      command: "./bin/letta-mem-launcher",
      args: ["mcp"],
    });

    const executable = readFileSync(
      join(pluginRoot, "bin", "letta-mem-launcher.exe"),
    );
    expect(executable.subarray(0, 2).toString("ascii")).toBe("MZ");
    const peOffset = executable.readInt32LE(0x3c);
    const optionalHeaderOffset = peOffset + 24;
    expect(executable.readUInt16LE(optionalHeaderOffset + 68)).toBe(2);

    const launcherSource = readFileSync(
      join(pluginRoot, "scripts", "windows-launcher.cs"),
      "utf8",
    );
    expect(launcherSource).toContain("CreateNoWindow");
    expect(launcherSource).toContain("StartfUseStdHandles");
    expect(launcherSource).toContain('"bootstrap.cjs"');
    const expectedSourceHash = readFileSync(
      join(pluginRoot, "bin", "letta-mem-launcher.source.sha256"),
      "ascii",
    ).trim();
    expect(createHash("sha256").update(launcherSource).digest("hex"))
      .toBe(expectedSourceHash);

    const hookExecutable = readFileSync(
      join(pluginRoot, "bin", "letta-mem-hook-launcher.exe"),
    );
    expect(hookExecutable.subarray(0, 2).toString("ascii")).toBe("MZ");
    const hookPeOffset = hookExecutable.readInt32LE(0x3c);
    const hookOptionalHeaderOffset = hookPeOffset + 24;
    expect(hookExecutable.readUInt16LE(hookOptionalHeaderOffset + 68)).toBe(2);

    const hookLauncherSource = readFileSync(
      join(pluginRoot, "scripts", "windows-hook-launcher.cs"),
      "utf8",
    );
    expect(hookLauncherSource).toContain("CreatePseudoConsole");
    expect(hookLauncherSource).toContain("CreateNoWindow");
    expect(hookLauncherSource).not.toContain("StartfUseStdHandles");
    const expectedHookSourceHash = readFileSync(
      join(pluginRoot, "bin", "letta-mem-hook-launcher.source.sha256"),
      "ascii",
    ).trim();
    expect(createHash("sha256").update(hookLauncherSource).digest("hex"))
      .toBe(expectedHookSourceHash);
  });

  it.runIf(process.platform === "win32")(
    "Windows ConPTY 启动器透传 stdin、stdout、stderr 和退出码",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "letta-mem-hook-launcher-"));
      const fixture = join(directory, "fixture.cjs");
      try {
        writeFileSync(
          fixture,
          [
            '(async () => {',
            '  const chunks = [];',
            '  for await (const chunk of process.stdin) chunks.push(chunk);',
            '  const input = Buffer.concat(chunks).toString("utf8");',
            '  process.stdout.write(`stdout:${input}`);',
            '  process.stderr.write(`stderr:${input}`);',
            '  process.exitCode = 7;',
            '})();',
          ].join("\n"),
          "utf8",
        );
        const result = spawnSync(
          join(pluginRoot, "bin", "letta-mem-hook-launcher.exe"),
          [process.execPath, fixture],
          {
            encoding: "utf8",
            input: "测试输入",
            windowsHide: true,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(7);
        expect(result.stdout).toBe("stdout:测试输入");
        expect(result.stderr).toBe("stderr:测试输入");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("源码不包含旧 API、Cloud 或模型供应商密钥配置", () => {
    const roots = ["src", "bin", "scripts", "hooks"];
    const combined = roots
      .flatMap((root) => sourceFiles(join(pluginRoot, root)))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const forbidden = [
      /@letta-ai\/letta-(?:code-sdk|client)/i,
      /\bletta[_-]client\b/i,
      /\bMemGPT\b/i,
      /\/v1(?:\/|\b)/i,
      /\bcloud\b/i,
      /\b(?:api|app)\.letta\.com\b/i,
      /\b(?:LETTA|OPENAI|ANTHROPIC|DEEPSEEK|GEMINI|MISTRAL|GROQ)_API_KEY\b/,
      /pinGlobalAgent\s*:\s*false/,
      /ensureLocalAppServer/,
    ];

    for (const pattern of forbidden) {
      expect(combined, `发现禁用痕迹：${pattern.source}`).not.toMatch(pattern);
    }
  });
});
