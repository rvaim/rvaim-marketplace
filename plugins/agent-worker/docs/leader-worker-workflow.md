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

launcher 会把 `https://github.com/rvaim/agent-worker-mcp.git` clone 到插件数据目录，后续启动时 fetch/reset 到远端 HEAD，然后执行 `npm ci` 和 `npm run build`。构建完成后启动 `dist/index.js` 作为 stdio MCP server。

## Configuration

Claude Code 安装插件时可以配置：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `default_worker_agent` | `claude` | 默认 worker agent。 |
| `allowed_worker_agents` | `claude,codex,gemini,opencode,qwen,kimi` | 允许调用的 worker agent allowlist。 |
| `acpx_bin` | `npx -y acpx@latest` | 启动 acpx 的命令。 |
| `acpx_approval` | `all` | worker 默认权限模式。 |
| `auto_update_agent_worker_mcp` | `true` | MCP 启动前是否自动更新 agent-worker-mcp。 |
| `worker_max_timeout_seconds` | `3600` | worker 任务默认最大运行秒数。 |

Codex 侧如果暂不支持插件安装时的 `userConfig`，可以通过同名环境变量覆盖：

```text
DEFAULT_WORKER_AGENT=claude
ALLOWED_WORKER_AGENTS=claude,codex
ACPX_BIN="npx -y acpx@latest"
ACPX_APPROVAL=all
WORKER_MAX_TIMEOUT_SECONDS=3600
AGENT_WORKER_MCP_AUTO_UPDATE=true
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
