# Agent Worker

通过 `agent-worker-mcp` 把复杂任务委托给 worker agent，主 agent 保持 leader / reviewer 角色，只负责规划、审查、打回修改和最终应用。

## 包含内容

```text
agent-worker/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── .mcp.json
├── bin/agent-worker-mcp-launcher.mjs
├── docs/leader-worker-workflow.md
└── skills/agent-worker/
    ├── SKILL.md
    └── agents/openai.yaml
```

## 工作方式

插件注册 `agent-worker` MCP server。启动 MCP 时，launcher 会自动 clone 或更新：

```text
https://github.com/rvaim/agent-worker-mcp.git
```

随后安装依赖、构建并启动该 MCP server。MCP 暴露 `run_worker`、`revise_worker`、`read_worker_result`、`get_worker_status`、`watch_worker`、`apply_worker_patch`、`cancel_worker`、`cleanup_worker`、`validate_acpx` 和 `list_worker_agents` 等工具。

## 默认配置

- 默认 worker agent：`claude`
- 默认 allowlist：`claude,codex,gemini,opencode,qwen,kimi`
- 默认 acpx 命令：`npx -y acpx@latest`
- 默认权限：`all`
- 默认自动更新 `agent-worker-mcp`

Claude Code 用户可在安装插件时通过 `userConfig` 覆盖这些值。Codex 用户可通过同名环境变量覆盖。

## 使用入口

Claude Code：

```text
/agent-worker:agent-worker
```

Codex：

```text
$agent-worker
```

推荐让主 agent 使用该 skill 后，将复杂实现拆成小任务并通过 worker agent 完成。主 agent 必须读取 diff、测试日志和 policy violations 后再决定接受、打回或应用 patch。
