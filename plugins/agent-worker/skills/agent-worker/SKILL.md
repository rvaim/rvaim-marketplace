---
name: agent-worker
description: 使用 agent-worker-mcp 把复杂任务委托给 Claude Code、Codex、Gemini、OpenCode、Qwen、Kimi 等 worker agent。适用于用户要求使用子代理、节省主上下文 token、leader/reviewer 工作流、复杂实现拆分、worker 修订或审查隔离 worktree 时。
---

# Agent Worker

你是 leader / reviewer。你的核心职责是规划、分派、审查和打回修改，而不是在主上下文里吞下所有实现细节。

本插件通过 bundled MCP server `agent-worker` 调用 `@rvaim/agent-worker-mcp`。MCP launcher 会在 server 启动前自动运行 npm 全局安装或更新 `@rvaim/agent-worker-mcp@latest` 和 `acpx@latest`，然后启动全局包内 `dist/index.js`。默认 worker agent 是 `claude`；如果用户配置了 `default_worker_agent` 或在对话中明确指定 worker，则按配置或用户指定值使用。

## 什么时候使用

遇到这些情况时优先使用 agent-worker MCP：

- 用户明确要求子代理、worker agent、delegate、节省主 agent token 或 leader/reviewer 模式。
- 任务涉及多个文件、较长调查、复杂实现、回归测试或需要反复修改。
- 你能把工作拆成边界清晰的小任务，并用 `allowed_files`、`forbidden_files`、验收标准描述清楚。
- 你需要让 worker 在隔离 worktree 中先做实现，然后由主 agent 审查 diff 后再应用。

这些情况不要委托：

- 一两行修改或主 agent 已经完全掌握上下文。
- 用户要求你亲自逐行解释、直接运行某条命令，或任务必须在当前 shell 状态中完成。
- 没有足够信息写出清晰任务边界，且猜测会有破坏性风险。

## 首次使用检查

1. 确认 MCP 工具可用：`list_worker_agents` 应返回默认 worker、allowlist 和常见 agent key。
2. 使用前或环境可疑时调用 `validate_acpx`，默认 `worker_agent` 为 `claude`，`cwd` 为当前仓库。
3. 如果 MCP 工具不可见，说明插件或 MCP server 尚未加载；要求用户重载插件或检查 MCP 启动日志，不要假装已经委托。
4. 如果 `validate_acpx` 失败，优先报告 `acpx`/worker agent 认证或命令兼容问题；不要把问题归咎于任务本身。

## Leader 工作流

1. 将目标拆成 1 个或多个小任务。每个任务必须包含：
   - `task_id`：稳定、唯一、kebab-case。
   - `cwd`：目标仓库绝对路径。
   - `instructions`：具体目标、修改边界、验收标准、输出格式。
   - `allowed_files`：worker 可改路径，能收窄就必须收窄。
   - `forbidden_files`：至少包含 `.env`、密钥、构建产物、无关目录。
   - `test_command`：可运行且与任务相关时提供结构化 `{ "cmd": "...", "args": [...] }`。
2. 默认用 `run_worker`。复杂实现优先设置：
   - `worker_agent`: 配置值或 `claude`
   - `mode`: `exec`
   - `no_wait`: `true`
   - `isolate_worktree`: `true`
   - `capture_diff`: `true`
3. `no_wait=true` 后使用低频轮询，不要反复追问 worker：
   - 启动后等待 15 分钟，期间不要查询状态；之后若仍无响应，每隔 5 分钟查询一次。
   - 默认用 `get_worker_status` 且限制 `recent_lines`，不要频繁使用 `watch_worker` 复制长日志。
4. 完成后调用 `read_worker_result`，并请求 `include_diff=true`、`include_test_log=true`。
5. 主 agent 必须亲自审查 changed files、diff、测试日志和 policy violations。worker 的自然语言总结不能作为接受依据。
6. 有阻塞问题时调用 `revise_worker`，反馈必须具体到文件、行为和验收差距。默认最多 3 轮修订。
7. 隔离 worktree 的结果只有在审查通过后才能调用 `apply_worker_patch`；先用 `check_only=true` 做可应用性检查。
8. 接受或放弃后按需要调用 `cleanup_worker` 清理任务产物和 worktree。

## Token 节省规则

- 给 worker 的上下文只传必要文件。优先用 `context_files` 和 `skill_paths` 精准注入，不要复制整个代码库说明。
- 指令要短而完整：目标、边界、测试、输出格式，比背景叙述更重要。
- worker 输出要求结构化、精简。主 agent 只读取 result、diff 和必要日志 tail。
- 多个独立任务可以并行委托，但每个 worker 的写入范围必须互不重叠。

## 推荐 run_worker 模板

```json
{
  "worker_agent": "claude",
  "task_id": "feature-slice-001",
  "cwd": "/absolute/path/to/repo",
  "instructions": "Implement the bounded change. Only touch the allowed files. Keep the patch minimal. Return summary, changed files, tests run, and risks.",
  "allowed_files": [
    "src/example.ts",
    "tests/example.test.ts"
  ],
  "forbidden_files": [
    ".env",
    "dist/**",
    "node_modules/**"
  ],
  "approval": "all",
  "mode": "exec",
  "no_wait": true,
  "isolate_worktree": true,
  "capture_diff": true,
  "test_command": {
    "cmd": "npm",
    "args": [
      "test",
      "--",
      "example"
    ]
  }
}
```

## 审查标准

只有同时满足这些条件才能接受 worker 结果：

- diff 与任务目标直接相关，没有无关重构。
- 未修改 forbidden files，未越过 allowed files。
- 测试通过；如果测试未运行或失败，原因必须可信且已告知用户。
- 代码风格匹配当前仓库。
- 没有把敏感信息、长日志或临时路径写进仓库。
- 隔离 worktree patch 已通过 `apply_worker_patch` 的 `check_only` 检查。
