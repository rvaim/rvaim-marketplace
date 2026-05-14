# Agent Worker

通过 `agent-worker-mcp` 把复杂任务委托给 worker agent，主 agent 保持 leader / reviewer 角色，只负责规划、审查、打回修改和最终应用。

## 包含内容

```text
agent-worker/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── .mcp.json
├── assets/icon.png
├── bin/agent-worker-mcp-launcher.mjs
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

`acpx@latest` 当前要求 Node.js 22.12+。如果 MCP 启动阶段全局 npm install 失败，优先检查 Codex / Claude Code 启动环境里的 Node.js 版本、npm 网络访问和全局 npm prefix 写入权限。

## 配置

Claude Code 安装插件时可以配置：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `default_worker_agent` | `claude` | 默认 worker agent。 |
| `allowed_worker_agents` | `claude,codex,gemini,opencode,qwen,kimi` | 允许调用的 worker agent allowlist。 |
| `acpx_bin` | `auto` | 启动 acpx 的命令。`auto` 表示使用插件启动时全局安装的 acpx。 |
| `acpx_approval` | `all` | worker 默认权限模式。 |
| `auto_update_agent_worker_mcp` | `true` | MCP 启动前是否自动全局安装或更新 `@rvaim/agent-worker-mcp` 和 `acpx`。 |
| `worker_max_timeout_seconds` | `3600` | worker 任务默认最大运行秒数。 |

Codex 侧如果暂不支持插件安装时的 `userConfig`，可以通过同名环境变量覆盖：

```text
DEFAULT_WORKER_AGENT=claude
ALLOWED_WORKER_AGENTS=claude
ACPX_BIN=auto
ACPX_APPROVAL=all
WORKER_MAX_TIMEOUT_SECONDS=3600
AGENT_WORKER_MCP_AUTO_UPDATE=true
AGENT_WORKER_MCP_PACKAGE="@rvaim/agent-worker-mcp@latest"
AGENT_WORKER_ACPX_PACKAGE="acpx@latest"
```

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

## 审查流程

主 agent 必须读取 worker result、diff 和测试日志后再决策。不要因为 worker summary 看起来正确就接受结果。

推荐顺序：

1. `list_worker_agents`
2. `validate_acpx`
3. `run_worker`
4. 低频调用 `get_worker_status` 或 `watch_worker`
5. `read_worker_result`
6. `revise_worker`，如需打回
7. `apply_worker_patch`，仅审查通过后
8. `cleanup_worker`

对于复杂实现，默认使用 `isolate_worktree=true`，先在隔离 worktree 中完成改动，再由主 agent 应用 patch。

## 状态轮询

`run_worker` 使用 `no_wait=true` 后，主 agent 不应高频询问状态。核心目的是减少主 agent 的 token 消耗——每次状态查询都会把 worker 输出注入主上下文，频繁查询会迅速耗尽 token 预算。

推荐节奏：

- 启动后等待 15 分钟，期间不要查询状态；之后若仍无响应，每隔 5 分钟查询一次。

默认使用 `get_worker_status`，并限制 `recent_lines`。`watch_worker` 只在需要看更长日志 tail 或诊断卡住原因时使用，避免把 worker 日志大量注入主上下文。

## 自动触发

Codex 侧通过 `agents/openai.yaml` 允许隐式调用该 skill。普通对话里出现"子代理、worker agent、delegate、leader/reviewer、节省 token"等请求时，Codex 可以自动召回 Agent Worker。

如果自动触发仍不生效，先确认 Codex 已安装并启用新版 `agent-worker` 插件，重启 Codex App，然后再用 `$agent-worker` 显式调用验证 skill 是否可见。
