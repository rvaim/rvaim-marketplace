---
name: create-hooks
description: 按需为插件生成 Claude Code hooks 或 Codex hooks。适用于用户明确要求自动执行、工具调用前后检查、命令拦截、保存后扫描、生成 hooks.json、解释 hooks 字段时。
---

# Create Hooks

你是双平台 hooks 配置生成器。

## 使用时机

只有用户明确要求自动执行、工具调用前后检查、保存后扫描、命令拦截、生成 hooks 配置或解释 hooks 字段时使用本 skill。

如果用户只是创建普通插件，不要主动启用 hooks；只说明可以按需添加。

## 重要原则

1. 不要默认生成 hooks。
2. 不要让 Claude Code 和 Codex 共用一个 `hooks/hooks.json`。
3. Claude hooks 写到 `hooks/claude-hooks.json`。
4. Codex hooks 写到 `hooks/codex-hooks.json`。
5. 脚本只在确实需要时生成到目标插件的 `bin/`。
6. 不要在模板里预置大量脚本；只根据用户当前需求生成最小脚本。
7. 可参考 `templates/dual-plugin/hooks/`，复制到目标插件后必须保持为 `hooks/` 目录，并替换 `{{PLUGIN_NAME}}` 和 `{{HOOK_SCRIPT_NAME}}`。
8. 生成前确认目标平台：Claude、Codex 或两者都要。两者都要时输出两份配置。
9. 命令脚本必须能独立运行，错误输出要简洁，不能依赖插件根目录外的相对路径。

## Claude Code hooks 生成规则

Claude Code 可使用：

- `type: "command"`
- `type: "http"`
- `type: "mcp_tool"`
- `type: "prompt"`
- `type: "agent"`

保守默认使用 `command`。

Claude 插件脚本路径优先使用：

```text
${CLAUDE_PLUGIN_ROOT}/bin/<script>.mjs
```

Claude 专用字段可以使用：

- `if`
- `async`
- `asyncRewake`
- `shell`

Claude manifest 声明：

```json
{
  "hooks": "./hooks/claude-hooks.json"
}
```

## Codex hooks 生成规则

Codex 需要提醒用户启用：

```toml
[features]
codex_hooks = true
```

Codex 保守默认使用 `command` handler。插件 hooks 的脚本路径优先使用 `${PLUGIN_ROOT}/bin/<script>.mjs`，不要写 workspace 相对路径，也不要依赖 Claude 的 `if` 字段。

Codex manifest 声明：

```json
{
  "hooks": "./hooks/codex-hooks.json"
}
```

Codex hooks 命令应使用对插件安装目录稳定的路径：

```text
${PLUGIN_ROOT}/bin/<script>.mjs
```

不要生成 `./plugins/<plugin-name>/...` 这类依赖 marketplace/workspace 布局的命令。

## 输出要求

生成 hooks 时必须包含：

1. `plugin.json` 里如何声明 hooks。
2. `hooks/claude-hooks.json` 或 `hooks/codex-hooks.json` 内容。
3. 必要脚本内容。
4. 测试命令。
5. 风险说明。
6. 确认没有把 hook snippet 留在 `templates/dual-plugin/` 默认骨架内。
7. 确认没有生成共享的 `hooks/hooks.json`。
8. 确认没有默认创建不被 hook 调用的脚本。

需要详细字段时，先读取：

- `docs/04-hooks-authoring-guide.md`
- `docs/05-claude-hooks-reference.md`
- `docs/06-codex-hooks-reference.md`
- `docs/07-hooks-difference-matrix.md`
