# templates

这个目录只放可复制模板，不放 `plugin-creator` 自身运行配置。

## 目录

```text
templates/
└── dual-plugin/
    ├── .claude-plugin/plugin.json
    ├── .codex-plugin/plugin.json
    ├── README.md
    ├── hooks/
    │   ├── claude-hooks.json
    │   └── codex-hooks.json
    └── skills/{{SKILL_NAME}}/SKILL.md
```

## 使用规则

1. `dual-plugin/` 是双平台插件骨架，可以整体复制。
2. 模板里的 `{{...}}` 都是必须替换的占位符。
3. `dual-plugin/hooks/` 是可选 hooks 模板，位于插件模板目录内，路径语义和目标插件一致。
4. hooks 仍然必须分平台保存为 `hooks/claude-hooks.json` 和 `hooks/codex-hooks.json`。
5. hooks 模板引用的 `bin/{{HOOK_SCRIPT_NAME}}.mjs` 需要按需创建，不要提前放进模板。
6. 不需要 hooks 时，不要在 manifest 里声明 `hooks` 字段。
7. 主页、仓库、品牌色和长描述用于发布面；没有真实值时删除字段，不要留下占位值。
8. license、privacyPolicyURL、termsOfServiceURL 只有在项目确实提供对应文件或页面时才填写。
