# plugin-creator

`plugin-creator` 是一个用于创建和审查 **Codex + Claude Code 双平台插件** 的中文辅助插件。

## 设计原则

- 插件本体只包含 `skills/`、`docs/`、`templates/`。
- 默认不启用 hooks。
- 默认不携带外层 `bin/` 脚本，避免把“目标插件模板脚本”误认为 `plugin-creator` 自己的运行时能力。
- 模板默认不预置脚本；需要 hooks 脚本时，通过 `create-hooks` skill 按需生成。
- 模板使用 `{{...}}` 占位符，不使用 `example-plugin` 这类容易漏改的示例值。
- 一个目标插件目录下可以同时放 `.claude-plugin/` 和 `.codex-plugin/`，共享 `skills/`、`docs/`、`templates/`。
- Claude Code hooks 和 Codex hooks 不共用配置文件；分别生成 `hooks/claude-hooks.json` 和 `hooks/codex-hooks.json`。

## Skills

Claude Code：

```text
/plugin-creator:create-dual-plugin
/plugin-creator:review-plugin
/plugin-creator:create-hooks
```

Codex：

```text
$create-dual-plugin
$review-plugin
$create-hooks
```

## 能力范围

- 创建双平台插件目录结构。
- 生成或完善 `.claude-plugin/plugin.json` 和 `.codex-plugin/plugin.json`。
- 生成 Claude Code marketplace entry 和 Codex marketplace entry。
- 审查 skills、hooks、templates、docs 是否放在正确目录。
- 按需生成 Claude Code hooks 或 Codex hooks；默认不启用 hooks。
- 解释 manifest、marketplace、hooks 的平台差异。

这个插件不包含 MCP server、app connector、默认 hooks 或运行时脚本。它是一个指令和模板插件，安装后即可使用 skills。

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

`templates/dual-plugin/` 是目标插件模板。它内部包含 `hooks/claude-hooks.json` 和 `hooks/codex-hooks.json` 模板文件，但 manifest 默认不声明 hooks。如果目标插件需要自动执行，再按 `docs/04-hooks-authoring-guide.md` 启用 hooks 并创建脚本。

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
- 没有外层 `hooks/` 或 `bin/`，除非插件自身真的需要运行时自动化。
- 没有共享 `hooks/hooks.json`。
- 模板里的 `{{...}}` 只存在于 `templates/` 目录中。
- marketplace entry 使用真实 source，不依赖插件目录外文件。
