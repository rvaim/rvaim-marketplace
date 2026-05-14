# {{PLUGIN_NAME}}

这是一个 Codex + Claude Code 双平台插件模板。

模板目录包含：

```text
.claude-plugin/plugin.json
.codex-plugin/plugin.json
skills/{{SKILL_NAME}}/SKILL.md
```

模板不包含 hooks 或运行时脚本，manifest 也不声明 hooks。

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

不要默认添加无用脚本。如果目标插件确实需要自动执行能力，请在目标插件中单独设计运行时脚本和平台专用配置。

如果插件暂时没有公开主页或仓库，不要保留占位 URL；删除对应字段，等发布前再补。不要为了字段完整而伪造 license、privacyPolicyURL 或 termsOfServiceURL。
