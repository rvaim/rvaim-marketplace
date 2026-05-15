# Agent Worker

通过 `agent-worker-mcp` 把复杂任务委托给 worker agent，主 agent 保持 leader / reviewer 角色，只负责规划、审查、打回修改和最终应用。这个插件的核心收益是把实现细节、长日志和中间推理尽量留在 worker 侧，减少主上下文 token 消耗。

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

## 为什么能省 token

插件真正节省 token 的方式，不只是“用了子代理”，而是默认把大部分重内容留在 worker 侧：

- `run_worker` 可配合 `response_mode="summary"`，只返回紧凑摘要。
- `context_files` 默认应使用 `context_mode="reference"`，只给 worker 文件路径，由它按需读取，避免把大文件全文同时塞进主 agent 和 worker prompt。
- `read_worker_result` 先看 `view="summary"`，审查时再切 `view="review"`；`view="full"` 只用于调试 MCP 产物本身。
- `get_worker_status` 应限制 `recent_lines`，`watch_worker` 只在诊断卡住时使用。
- `no_wait=true` 适合长任务，主 agent 不需要阻塞等待，也不需要高频查询。

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

## 推荐默认用法

如果目标是节省主 agent token，优先采用这组参数：

```json
{
  "mode": "exec",
  "no_wait": true,
  "isolate_worktree": true,
  "capture_diff": true,
  "context_mode": "reference",
  "response_mode": "summary"
}
```

完成后建议按这个顺序读取结果：

1. `read_worker_result(view="summary")`
2. `read_worker_result(view="review", include_diff=true, include_test_log=true)`
3. 只有需要排查 MCP 产物时才使用 `view="full"`

## 自动触发

Codex 侧通过 `agents/openai.yaml` 允许隐式调用该 skill。普通对话里出现"子代理、worker agent、delegate、leader/reviewer、节省 token"等请求时，Codex 可以自动召回 Agent Worker。

如果自动触发仍不生效，先确认 Codex 已安装并启用新版 `agent-worker` 插件，重启 Codex App，然后再用 `$agent-worker` 显式调用验证 skill 是否可见。

## 状态轮询门控

当 `run_worker` 使用 `no_wait=true` 时，plugin launcher 会在 MCP 传输层强制限制 `get_worker_status` 和 `watch_worker`：

- 第一次状态查询前必须等待 `300` 秒。
- 后续每次状态查询之间也至少等待 `300` 秒。
- 这个等待在 launcher 内部执行，主 agent 不能通过“自己估算已经过了多久”来绕过。

如果主 agent 提前发起状态查询，请求不会立刻转发给 `agent-worker-mcp`，而是会被 launcher 延迟到 300 秒窗口满足后再发送。
