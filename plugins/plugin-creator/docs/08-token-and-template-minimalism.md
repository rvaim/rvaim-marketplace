# 模板最小化与 token 控制

## 为什么模板里不放大量脚本

模板中的文件很容易被用户复制到每个插件里。如果模板默认携带多个脚本，会带来：

1. 每个新插件都有无用脚本。
2. 审查插件时要额外读取无关内容。
3. 后续维护时不清楚脚本是否真的被使用。
4. 自动化配置可能误引用不存在或不必要的脚本。

## 推荐策略

目标插件模板只放最小可运行结构：

```text
<plugin>/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
└── skills/{{SKILL_NAME}}/SKILL.md
```

需要文档，再加 `docs/`。

模板中的具体值使用 `{{...}}` 占位符，避免复制后留下 `example-plugin`、`example-skill` 这类示例名。

## plugin-creator 的处理

`plugin-creator` 本身只提供：

- skill 指令。
- 详细文档。
- 最小模板。

不提供：

- 外层 `bin/`。
- 模板中的预置脚本。

这样安装后更干净，也避免模型每次看到一堆无关脚本。
