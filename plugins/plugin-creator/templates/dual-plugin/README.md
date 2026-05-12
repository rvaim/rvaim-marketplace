# {{PLUGIN_NAME}}

这是一个 Codex + Claude Code 双平台插件模板。

模板目录包含：

```text
.claude-plugin/plugin.json
.codex-plugin/plugin.json
skills/{{SKILL_NAME}}/SKILL.md
hooks/claude-hooks.json
hooks/codex-hooks.json
```

其中 `hooks/` 是可选 hooks 模板，manifest 默认不声明 hooks。

复制模板后先替换这些占位符：

```text
{{PLUGIN_NAME}}
{{PLUGIN_DISPLAY_NAME}}
{{PLUGIN_DESCRIPTION}}
{{PLUGIN_LONG_DESCRIPTION}}
{{PLUGIN_HOMEPAGE}}
{{PLUGIN_REPOSITORY}}
{{PLUGIN_BRAND_COLOR}}
{{DEVELOPER_NAME}}
{{SKILL_NAME}}
{{SKILL_DISPLAY_NAME}}
{{SKILL_DESCRIPTION}}
```

如果需要 hooks，请按需新增脚本：

```text
bin/<script>.mjs
```

不要默认添加无用脚本。`hooks/` 里的配置是模板文件；只有确实需要 hooks 时，才在 manifest 中声明 `./hooks/claude-hooks.json` 或 `./hooks/codex-hooks.json`，并按目标插件路径调整命令。

如果插件暂时没有公开主页或仓库，不要保留占位 URL；删除对应字段，等发布前再补。不要为了字段完整而伪造 license、privacyPolicyURL 或 termsOfServiceURL。
