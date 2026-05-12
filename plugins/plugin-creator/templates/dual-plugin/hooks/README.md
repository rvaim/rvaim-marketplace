# hooks

这里保存按需启用的 hooks 模板。它们位于插件模板目录内，所以复制 `dual-plugin/` 后目标路径仍然是 `hooks/`。

目标路径为：

```text
hooks/
├── claude-hooks.json
└── codex-hooks.json
```

使用前必须替换：

```text
{{PLUGIN_NAME}}
{{HOOK_SCRIPT_NAME}}
```

Claude hooks 模板使用 `${CLAUDE_PLUGIN_ROOT}`，只能复制到 Claude hooks 配置中。

Codex hooks 模板优先使用 `${PLUGIN_ROOT}`，引用安装后的插件根目录，例如：

```text
${PLUGIN_ROOT}/bin/{{HOOK_SCRIPT_NAME}}.mjs
```

Codex 测试 hooks 前还要确认：

```toml
[features]
codex_hooks = true
```
