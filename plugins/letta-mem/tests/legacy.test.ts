import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
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
