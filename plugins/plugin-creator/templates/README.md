# templates

这个目录只放可复制模板，不放 `plugin-creator` 自身运行配置。

## 目录

```text
templates/
└── dual-plugin/
    ├── .claude-plugin/plugin.json
    ├── .codex-plugin/plugin.json
    ├── README.md
    └── skills/{{SKILL_NAME}}/SKILL.md
```

## 使用规则

1. `dual-plugin/` 是双平台插件骨架，可以整体复制。
2. 模板里的 `{{...}}` 都是必须替换的占位符。
3. 模板不包含 hooks 或运行时脚本；需要自动执行能力时由目标插件单独设计。
4. 主页、仓库、品牌色和长描述用于发布面；没有真实值时删除字段，不要留下占位值。
5. license、privacyPolicyURL、termsOfServiceURL 只有在项目确实提供对应文件或页面时才填写。
