# Agent Worker Leader / Reviewer Workflow

`agent-worker` 把主 agent 固定为 leader / reviewer：主 agent 负责拆任务、设边界、审查 diff、打回修订和最终应用；worker agent 负责消耗上下文较多的调查或实现。

## Runtime

插件声明 bundled MCP server：

```text
plugins/agent-worker/.mcp.json
```

启动时会运行：

```text
plugins/agent-worker/bin/agent-worker-mcp-launcher.mjs
```

launcher 会运行 npm 全局安装或更新：

```text
@rvaim/agent-worker-mcp@latest
acpx@latest
```

安装完成后，launcher 使用全局包内 `@rvaim/agent-worker-mcp/dist/index.js` 作为 stdio MCP server，并默认把全局安装的 `acpx` 二进制传给 MCP server。

`acpx@latest` 当前要求 Node.js 22.12+。如果 MCP 启动阶段全局 npm install 失败，优先检查 Codex / Claude Code 启动环境里的 Node.js 版本、npm 网络访问和全局 npm prefix 写入权限。

## Configuration

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

## Review Discipline

主 agent 必须读取 worker result、diff 和测试日志后再决策。不要因为 worker summary 看起来正确就接受结果。

推荐顺序：

1. `list_worker_agents`
2. `validate_acpx`
3. `run_worker`
4. `get_worker_status` 或 `watch_worker`
5. `read_worker_result`
6. `revise_worker`，如需打回
7. `apply_worker_patch`，仅审查通过后
8. `cleanup_worker`

对于复杂实现，默认使用 `isolate_worktree=true`，先在隔离 worktree 中完成改动，再由主 agent 应用 patch。
