# plugin-creator

`plugin-creator` 是一个用于创建和审查 **Codex + Claude Code 双平台插件** 的中文辅助插件。

## 设计原则

- 插件本体只包含 `skills/`、`docs/`、`templates/`。
- 默认不携带外层 `bin/` 脚本，避免把“目标插件模板脚本”误认为 `plugin-creator` 自己的运行时能力。
- 模板默认不预置脚本或 hooks；需要自动执行能力时由目标插件单独设计。
- 模板使用 `{{...}}` 占位符，不使用 `example-plugin` 这类容易漏改的示例值。
- 一个目标插件目录下可以同时放 `.claude-plugin/` 和 `.codex-plugin/`，共享 `skills/`、`docs/`、`templates/`。
- Codex 侧 skills 通过 `agents/openai.yaml` 设置为手动触发，不做隐式自动召回。

## Skills

Claude Code：

```text
/plugin-creator:create-dual-plugin
/plugin-creator:review-plugin
```

Codex：

```text
$create-dual-plugin
$review-plugin
```

## 能力范围

- 创建双平台插件目录结构。
- 生成或完善 `.claude-plugin/plugin.json` 和 `.codex-plugin/plugin.json`。
- 生成 Claude Code marketplace entry 和 Codex marketplace entry。
- 审查 skills、templates、docs 是否放在正确目录。
- 解释 manifest、marketplace 和双平台目录差异。

这个插件不包含 MCP server、app connector、hooks 或运行时脚本。它是一个手动触发的指令和模板插件，安装后即可使用 skills。

## 目录

```text
plugin-creator/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── skills/
├── docs/
└── templates/
    └── dual-plugin/
```

`templates/dual-plugin/` 是目标插件模板。模板不包含 hooks 或运行时脚本。

## 本地安装验证

Claude Code：

```shell
/plugin marketplace add ./rvaim-marketplace
/plugin install plugin-creator@rvaim-marketplace
```

Codex：

```bash
codex plugin marketplace add ./rvaim-marketplace
```

在 Codex workspace 中也可以使用仓库根目录的 `.agents/plugins/marketplace.json` 作为本地插件目录入口。

## 发布前检查

- 两个平台的 manifest `name` 保持一致。
- `skills` 指向 `./skills/`。
- 没有外层 `hooks/` 或 `bin/`。
- 模板里的 `{{...}}` 只存在于 `templates/` 目录中。
- marketplace entry 使用真实 source，不依赖插件目录外文件。
