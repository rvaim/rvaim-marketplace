# Claude Code hooks.json 参考

## 1. 配置位置

插件中建议：

```text
<plugin>/hooks/claude-hooks.json
```

并在：

```text
<plugin>/.claude-plugin/plugin.json
```

声明：

```json
{
  "hooks": "./hooks/claude-hooks.json"
}
```

如果插件没有自动执行需求，不要声明 hooks。

## 2. 基本结构

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/bin/check.mjs",
            "timeout": 30,
            "statusMessage": "正在检查"
          }
        ]
      }
    ]
  }
}
```

## 3. Claude Code 常用事件

| 事件 | 用途 |
|---|---|
| `SessionStart` | 会话开始或恢复时触发。 |
| `UserPromptSubmit` | 用户提交 prompt 后、模型处理前触发。 |
| `PreToolUse` | 工具调用前触发，可阻止。 |
| `PostToolUse` | 工具调用成功后触发。 |
| `PostToolUseFailure` | 工具调用失败后触发。 |
| `Stop` | 响应即将结束时触发。 |

Claude Code 事件比 Codex 更多，还支持更多高级生命周期事件。写双平台插件时不要假设 Codex 也支持全部 Claude 事件。

## 4. Claude handler 类型

Claude Code 支持多种 handler：

| type | 说明 |
|---|---|
| `command` | 执行 shell 命令。 |
| `http` | 调用 HTTP endpoint。 |
| `mcp_tool` | 调用 MCP tool。 |
| `prompt` | 执行 prompt hook。 |
| `agent` | 调用 agent hook。 |

双平台默认只用 `command`。其他类型属于 Claude 专用增强能力。

## 5. Claude command handler 字段

| 字段 | 说明 |
|---|---|
| `type` | 通常为 `command`。 |
| `command` | 执行命令。 |
| `timeout` | 超时时间，秒。 |
| `statusMessage` | 执行提示。 |
| `if` | Claude 专用条件过滤。 |
| `async` | Claude 专用异步执行。 |
| `asyncRewake` | Claude 专用异步唤醒。 |
| `shell` | Claude 专用 shell 指定。 |

## 6. Claude 专用路径变量

插件脚本优先使用：

```text
${CLAUDE_PLUGIN_ROOT}/bin/script.mjs
```

不要把这个变量写进 Codex hooks。

## 7. Claude 输出

PostToolUse 可返回：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "检查结果..."
  }
}
```

PreToolUse 可返回 deny：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "阻止原因"
  }
}
```
