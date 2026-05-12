# Claude Code hooks 与 Codex hooks 差异矩阵

| 项目 | Claude Code | Codex |
|---|---|---|
| 是否需要 feature flag | 不需要 | 需要 `[features] codex_hooks = true` |
| 插件 hooks 默认路径 | `hooks/hooks.json` 或 manifest 指定 | manifest 指定或 `hooks/hooks.json` |
| 推荐双平台路径 | `hooks/claude-hooks.json` | `hooks/codex-hooks.json` |
| handler 类型 | `command`、`http`、`mcp_tool`、`prompt`、`agent` | 保守使用 `command` |
| command 路径变量 | `${CLAUDE_PLUGIN_ROOT}` | 首选 `${PLUGIN_ROOT}` |
| 条件过滤 | 支持 `if` | 不建议写 Claude 风格 `if` |
| 异步 | 支持 `async`、`asyncRewake` | 不按 Claude 写法假设 |
| matcher | 工具名、启动方式等，支持 exact / `|` / regex | regex string；部分事件不支持 matcher |
| 文件编辑工具名 | `Write`、`Edit`、`MultiEdit` | 常见 `apply_patch`，可匹配 `Edit` / `Write` alias |
| 输出 | `hookSpecificOutput`、exit code 等 | `systemMessage`、`hookSpecificOutput`、兼容旧 block 形态 |

## 结论

双平台插件可以共享：

```text
skills/
docs/
templates/
```

按需共享：

```text
bin/ 里的具体脚本
```

不要共享：

```text
hooks/hooks.json
```

正确做法：

```text
hooks/
├── claude-hooks.json
└── codex-hooks.json
```

对于 `plugin-creator` 本身：

- 不创建外层 `hooks/`。
- 不创建外层 `bin/`。
- 模板不预置脚本。
- `templates/dual-plugin/hooks/` 只作为按需启用的可选 hooks 模板，不代表目标插件默认启用 hooks。
- 需要 hooks/scripts 时由 skill 按需生成。
