# Hooks 编写总则

## 1. 默认不要生成 hooks

只有用户明确要求以下能力时才生成 hooks：

- 修改文件后自动检查。
- 执行 Bash 前拦截危险命令。
- 用户提交 prompt 前做扫描。
- 会话开始时注入上下文。
- 工具执行失败后追加错误分析。

## 2. 双平台必须分文件

推荐：

```text
hooks/
├── claude-hooks.json
└── codex-hooks.json
```

不要：

```text
hooks/hooks.json
```

原因：

- Claude Code 和 Codex 事件集合不完全一致。
- handler 类型不完全一致。
- 输入和输出协议不完全一致。
- Claude 优先使用 `${CLAUDE_PLUGIN_ROOT}`。
- Codex 插件 hooks 优先使用 `${PLUGIN_ROOT}`，不要依赖 workspace 相对路径。
- Claude 支持 `if`、`async`、`shell` 等专用字段，Codex 不应直接照抄。

## 3. 脚本按需生成

如果只是提供知识，不要创建脚本。

如果需要 hooks，再创建：

```text
bin/<script>.mjs
```

脚本应遵循：

- 从 stdin 读取 JSON。
- stdout 只输出 JSON。
- 调试信息写 stderr。
- 不要输出无关文本，避免破坏 JSON 解析。
- 尽量只做最小检查。

`templates/dual-plugin/hooks/` 提供可选 hooks 模板，路径语义和目标插件一致。复制后必须替换 `{{PLUGIN_NAME}}` 和 `{{HOOK_SCRIPT_NAME}}`；只有确实需要 hooks 时，才在 manifest 中声明对应 hooks 文件。

## 4. 最小 Claude hooks 示例

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

## 5. 最小 Codex hooks 示例

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

Codex 测试 hooks 前，还要确认：

```toml
[features]
codex_hooks = true
```
