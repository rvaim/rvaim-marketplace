import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
    expect(hooks).not.toContain('ArgumentList \"session-state\"');
    expect(hooks).toContain('"timeout": 2');
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
    expect(bootstrap).not.toContain("spawn(process.execPath");
    expect(bootstrap).toContain("letta-mem-hook-runtime.mjs");
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

  it("SessionStart 后台返回，其余 Windows Hook 复用同一 PowerShell runner", () => {
    const hooks = JSON.parse(readFileSync(
      join(pluginRoot, "hooks", "hooks.json"),
      "utf8",
    )) as {
      hooks: Record<string, Array<{
        hooks: Array<{ command: string; commandWindows?: string }>;
      }>>;
    };
    const sessionStartCommands = (hooks.hooks.SessionStart ?? [])
      .flatMap((group) => group.hooks);
    expect(sessionStartCommands).toHaveLength(1);
    expect(sessionStartCommands[0]?.commandWindows).toContain(
      '& "${CLAUDE_PLUGIN_ROOT}/bin/invoke-hook.ps1"',
    );
    expect(sessionStartCommands[0]?.commandWindows).toContain("--background");
    expect(sessionStartCommands[0]?.commandWindows).toContain(
      "exit $LASTEXITCODE",
    );

    const commands = Object.entries(hooks.hooks)
      .filter(([event]) => event !== "SessionStart")
      .flatMap(([, groups]) => groups)
      .flatMap((group) => group.hooks);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command.command).toContain(
        'node "${CLAUDE_PLUGIN_ROOT}/bin/bootstrap.cjs"',
      );
      expect(command.commandWindows).toContain(
        '& "${CLAUDE_PLUGIN_ROOT}/bin/invoke-hook.ps1"',
      );
      expect(command.commandWindows).toContain("exit $LASTEXITCODE");
      expect(command.commandWindows).not.toContain("Start-Process");
      expect(command.commandWindows).not.toContain("node");
    }

    expect(existsSync(join(pluginRoot, "bin", "invoke-hook.ps1"))).toBe(true);

    const preload = readFileSync(
      join(pluginRoot, "bin", "stdio-preload.cjs"),
      "utf8",
    );
    expect(existsSync(join(pluginRoot, "bin", "hook-launcher.cjs")))
      .toBe(false);
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
      command: "node",
      args: ["./bin/bootstrap.cjs", "mcp"],
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
    expect(launcherSource).toContain('arguments[0] == "--exec"');
    expect(launcherSource).toContain("ResolveNodeExecutable");
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
    expect(hookLauncherSource).toContain("CreateUnicodeEnvironment");
    expect(hookLauncherSource).toContain("JobObjectLimitKillOnJobClose");
    expect(hookLauncherSource).toContain("CleanupStaleTemporaryFiles");
    expect(hookLauncherSource).toContain("ResolveNodeExecutable");
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
      const fixtureDirectory = join(directory, "含 空格");
      mkdirSync(fixtureDirectory, { recursive: true });
      const fixture = join(fixtureDirectory, "fixture.cjs");
      const linkedNode = join(fixtureDirectory, "node 路径.exe");
      try {
        linkSync(process.execPath, linkedNode);
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
        const input = JSON.stringify({
          text: "测试输入 <&> !@#$%^&*()",
          payload: "内存".repeat(128 * 1024),
        });
        const result = spawnSync(
          join(pluginRoot, "bin", "letta-mem-hook-launcher.exe"),
          [linkedNode, fixture],
          {
            encoding: "utf8",
            env: { ...process.env, TEMP: directory, TMP: directory },
            input,
            maxBuffer: 4 * 1024 * 1024,
            windowsHide: true,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(7);
        expect(result.stdout).toBe(`stdout:${input}`);
        expect(result.stderr).toBe(`stderr:${input}`);
        expect(readdirSync(directory).filter(
          (name) => name.startsWith("letta-mem-hook-"),
        )).toEqual([]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "Codex PowerShell runner 复用同一进程并转发真实退出码",
    () => {
      const runner = join(pluginRoot, "bin", "invoke-hook.ps1");
      const fixture = join(
        pluginRoot,
        "tests",
        "fixtures",
        "windows-launcher-io.cjs",
      );
      const command = [
        `& ${JSON.stringify(runner)} ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}`,
        "; exit $LASTEXITCODE",
      ].join(" ");
      const result = spawnSync(
        "pwsh.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        {
          encoding: "utf8",
          input: "PowerShell 管道 <&>",
          windowsHide: true,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(7);
      expect(result.stdout).toBe("stdout:PowerShell 管道 <&>");
      expect(result.stderr).toBe("stderr:PowerShell 管道 <&>");
    },
  );

  it.runIf(process.platform === "win32")(
    "Windows 原生后台模式快速返回并保留 stdin",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "letta-mem-hook-background-"));
      const fixture = join(directory, "background.cjs");
      const resultPath = join(directory, "result.json");
      try {
        writeFileSync(
          fixture,
          [
            'const { writeFileSync } = require("node:fs");',
            '(async () => {',
            '  const chunks = [];',
            '  for await (const chunk of process.stdin) chunks.push(chunk);',
            '  await new Promise((resolve) => setTimeout(resolve, 500));',
            '  writeFileSync(process.argv[2], Buffer.concat(chunks));',
            '})();',
          ].join("\n"),
          "utf8",
        );
        const input = JSON.stringify({ text: "后台输入 中文 <&>" });
        const startedAt = Date.now();
        const result = spawnSync(
          join(pluginRoot, "bin", "letta-mem-hook-launcher.exe"),
          ["--background", process.execPath, fixture, resultPath],
          {
            encoding: "utf8",
            env: { ...process.env, TEMP: directory, TMP: directory },
            input,
            windowsHide: true,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        const deadline = Date.now() + 5_000;
        while (!existsSync(resultPath) && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
        expect(readFileSync(resultPath, "utf8")).toBe(input);
        expect(readdirSync(directory).filter(
          (name) => name.startsWith("letta-mem-hook-") && name.endsWith(".tmp"),
        )).toEqual([]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "Windows ConPTY 启动器允许空输出",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "letta-mem-hook-empty-"));
      const fixture = join(directory, "empty.cjs");
      try {
        writeFileSync(fixture, "process.exitCode = 0;\n", "utf8");
        const result = spawnSync(
          join(pluginRoot, "bin", "letta-mem-hook-launcher.exe"),
          [process.execPath, fixture],
          {
            encoding: "utf8",
            env: { ...process.env, TEMP: directory, TMP: directory },
            windowsHide: true,
          },
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        expect(readdirSync(directory)).toEqual(["empty.cjs"]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "Windows ConPTY 启动器被终止时同步 Node 不会残留",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "letta-mem-hook-timeout-"));
      const fixture = join(directory, "wait.cjs");
      const pidPath = join(directory, "pid.txt");
      try {
        writeFileSync(
          fixture,
          [
            'const { writeFileSync } = require("node:fs");',
            `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
            "setInterval(() => {}, 1000);",
          ].join("\n"),
          "utf8",
        );
        const launcher = spawn(
          join(pluginRoot, "bin", "letta-mem-hook-launcher.exe"),
          [process.execPath, fixture],
          {
            env: { ...process.env, TEMP: directory, TMP: directory },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        launcher.stdin.end();
        for (let attempt = 0; attempt < 100 && !existsSync(pidPath); attempt += 1) {
          await delay(20);
        }
        expect(existsSync(pidPath)).toBe(true);
        const nodePid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
        expect(processExists(nodePid)).toBe(true);
        const launcherClosed = new Promise<void>((resolvePromise) => launcher.once(
          "close",
          () => resolvePromise(),
        ));
        launcher.kill();
        await launcherClosed;
        for (let attempt = 0; attempt < 100 && processExists(nodePid); attempt += 1) {
          await delay(20);
        }
        expect(processExists(nodePid)).toBe(false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "Windows 后台子进程可脱离同步 Hook 生命周期继续运行",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "letta-mem-hook-detached-"));
      const parent = join(directory, "parent.cjs");
      const worker = join(directory, "worker.cjs");
      const marker = join(directory, "completed.txt");
      try {
        writeFileSync(
          worker,
          [
            'const { writeFileSync } = require("node:fs");',
            "setTimeout(() => {",
            `  writeFileSync(${JSON.stringify(marker)}, "完成", "utf8");`,
            "}, 300);",
          ].join("\n"),
          "utf8",
        );
        writeFileSync(
          parent,
          [
            'const { spawn } = require("node:child_process");',
            `const child = spawn(process.execPath, [${JSON.stringify(worker)}], {`,
            "  detached: true,",
            '  stdio: "ignore",',
            "  windowsHide: true,",
            "});",
            "child.unref();",
          ].join("\n"),
          "utf8",
        );
        const result = spawnSync(
          join(pluginRoot, "bin", "letta-mem-hook-launcher.exe"),
          [process.execPath, parent],
          {
            env: { ...process.env, TEMP: directory, TMP: directory },
            windowsHide: true,
          },
        );
        expect(result.status).toBe(0);
        for (let attempt = 0; attempt < 100 && !existsSync(marker); attempt += 1) {
          await delay(20);
        }
        expect(readFileSync(marker, "utf8")).toBe("完成");
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
