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

插件注册 `agent-worker` MCP server。启动 MCP 时，launcher 会自动全局安装或更新：

```text
@rvaim/agent-worker-mcp@latest
acpx@latest
```

随后启动全局 `@rvaim/agent-worker-mcp` 包内的 stdio MCP server，并默认使用全局安装的 `acpx`。MCP 暴露 `run_worker`、`revise_worker`、`read_worker_result`、`get_worker_status`、`watch_worker`、`apply_worker_patch`、`cancel_worker`、`cleanup_worker`、`validate_acpx` 和 `list_worker_agents` 等工具。

## 默认配置

- Node.js 要求：`acpx@latest` 当前要求 Node.js 22.12+。
- 默认 worker agent：`claude`
- 默认 allowlist：`claude,codex,gemini,opencode,qwen,kimi`
- 默认 acpx 命令：`auto`，即使用插件启动时全局安装的 `acpx`
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
