# Codex hooks.json 参考

## 1. Feature flag

Codex hooks 需要开启：

```toml
[features]
codex_hooks = true
```

如果用户测试 hooks 不生效，先检查这个配置。

## 2. 配置位置

插件中建议：

```text
<plugin>/hooks/codex-hooks.json
```

并在：

```text
<plugin>/.codex-plugin/plugin.json
```

声明：

```json
{
  "hooks": "./hooks/codex-hooks.json"
}
```

如果没有 hooks，不要声明该字段。

Codex 也可能默认检查插件根目录 `./hooks/hooks.json`。双平台插件不建议使用这个默认文件名，以免误以为两边共用。

## 3. 基本结构

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "node ${PLUGIN_ROOT}/bin/check.mjs",
            "timeout": 30,
            "statusMessage": "正在检查"
          }
        ]
      }
    ]
  }
}
```

## 4. Codex 常用事件

| 事件 | 用途 |
|---|---|
| `SessionStart` | 会话开始时触发。 |
| `UserPromptSubmit` | 用户提交 prompt 后触发。 |
| `PreToolUse` | 工具调用前触发。 |
| `PermissionRequest` | 权限请求时触发。 |
| `PostToolUse` | 工具调用成功后触发。 |
| `Stop` | 回合停止时触发。 |

## 5. Codex matcher

Codex 的 matcher 是 regex string。常见：

```text
Bash
apply_patch
Edit|Write|apply_patch
mcp__filesystem__.*
```

`UserPromptSubmit` 和 `Stop` 不支持 matcher。

## 6. Codex command handler 字段

保守使用：

| 字段 | 说明 |
|---|---|
| `type` | 通常为 `command`。 |
| `command` | 执行命令。 |
| `timeout` | 超时时间，秒。 |
| `statusMessage` | 状态提示。 |

Codex 插件 hooks 中的脚本路径优先使用：

```text
${PLUGIN_ROOT}/bin/script.mjs
```

`${PLUGIN_ROOT}` 指向安装后的插件根目录，比 `./plugins/<plugin-name>/...` 这类 workspace 相对路径更稳定。不要新写 Claude 命名的路径变量；如果遇到旧插件使用 `${CLAUDE_PLUGIN_ROOT}`，只把它视为兼容遗留写法。

不要在 Codex hooks 里使用 Claude 专有字段：

- `if`
- `async`
- `asyncRewake`
- `shell`

除非 Codex 官方文档明确支持。

## 7. Codex 输出

PreToolUse 可用：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "阻止原因"
  }
}
```

也可使用兼容旧形态：

```json
{
  "decision": "block",
  "reason": "阻止原因"
}
```

PostToolUse 可返回 `systemMessage`，用于给 Codex 补充上下文。

PermissionRequest 可返回：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "阻止原因"
    }
  }
}
```

也可以返回 `behavior: "allow"` 允许请求继续执行。没有明确返回 allow 或 deny 时，Codex 使用正常审批流程。

## 8. TOML 配置格式

Codex 除了 `hooks.json`，也支持在 `config.toml` 中写 hooks。插件打包时仍建议使用 `hooks/codex-hooks.json` 并由 `.codex-plugin/plugin.json` 声明；TOML 示例主要用于解释用户级或 repo 级 hooks。

```toml
[features]
codex_hooks = true

[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = 'node "${PLUGIN_ROOT}/bin/check.mjs"'
timeout = 30
statusMessage = "Checking Bash command"
```

写入 TOML 时注意：

- `[[hooks.<Event>]]` 表示一个 matcher group。
- `[[hooks.<Event>.hooks]]` 表示该 group 下的一个 handler。
- 插件内仍优先使用 JSON 文件；不要同时在同一层既写 `hooks.json` 又写内联 TOML，避免合并行为难以理解。
