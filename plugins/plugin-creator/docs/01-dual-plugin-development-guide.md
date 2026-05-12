# Codex + Claude Code 双平台插件开发指南

## 1. 推荐形态

一个插件目录同时支持两边：

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── my-skill/
│       └── SKILL.md
└── docs/
```

不要拆成：

```text
plugins/claude/my-plugin
plugins/codex/my-plugin
```

除非两边逻辑完全不同，否则拆分会导致 skill、文档、示例重复维护。

判断是否应该拆分：

- 如果两边只是在 manifest、marketplace 或 hooks schema 上不同，不拆分。
- 如果两边共享同一套 skills、docs、templates，不拆分。
- 如果某个平台需要独占 MCP server、LSP server 或 hooks，可以只在该平台 manifest 中声明对应组件。
- 只有当两个平台的用户体验、脚本依赖、核心能力完全不同，才考虑维护两个插件。

## 2. 目录职责

| 目录 | 职责 |
|---|---|
| `.claude-plugin/` | 只放 Claude Code manifest；marketplace 仓库根目录可放 `.claude-plugin/marketplace.json`。 |
| `.codex-plugin/` | 只放 Codex manifest。 |
| `skills/` | 共享 skill。 |
| `docs/` | 长文档、规范、说明；简单插件可以不创建。 |
| `templates/` | 生成其他插件时用的可复制骨架和按需片段。 |
| `hooks/` | 只有插件自身需要自动执行时才创建。 |
| `bin/` | 只有插件自身或目标插件确实需要脚本时才创建。 |
| `assets/` | 只有存在真实图标、logo、截图时才创建。 |

Codex repo marketplace 通常放在仓库根目录的 `.agents/plugins/marketplace.json`。这个文件不属于某个插件本体，而属于插件目录所在的 marketplace 或工作区。

## 3. 最小化原则

插件不要为了“看起来完整”而添加脚本。每个脚本都会带来维护成本，并可能被模型读取或误用。

对于 `plugin-creator` 这种脚手架插件：

- 外层不需要 `bin/`。
- 外层不需要 `hooks/`。
- 模板里默认也不需要 `bin/`。
- hooks 模板如果存在，应放在插件模板目录下的 `hooks/`，不要作为 `templates/` 的兄弟级公共目录。
- 模板使用 `{{PLUGIN_NAME}}` 这类显式占位符，复制后必须替换。
- hooks 和脚本应由 `create-hooks` skill 按需生成。

字段也要最小真实：

- 可以补齐真实的 `author`、`homepage`、`repository`、`keywords`、`interface`。
- 不要伪造 `license`、`privacyPolicyURL`、`termsOfServiceURL`。
- 没有真实资产时不要声明 `composerIcon`、`logo`、`screenshots`。
- 没有组件时不要写空的 `hooks`、`apps`、`mcpServers`、`lspServers`。

## 4. Shared Skill 规则

共享 skill 的 `SKILL.md` 推荐只使用两边都能理解的 frontmatter：

```yaml
---
name: my-skill
description: 明确说明什么时候使用这个 skill。
---
```

大段规则放 `docs/` 或 `references/`，不要直接堆到 `SKILL.md`。

写 description 时优先包含触发词和边界，例如：

```yaml
description: 创建一个同时兼容 Codex 和 Claude Code 的插件骨架。适用于创建插件、manifest、marketplace、skill 模板时；不适用于只生成 hooks。
```

`SKILL.md` 的主体应说明：

- 何时使用。
- 必须读取哪些参考文档。
- 需要收集哪些输入。
- 输出哪些文件或审查结论。
- 哪些事情默认不做。

## 5. 推荐新增插件流程

1. 用 `templates/dual-plugin/` 复制一个最小骨架。
2. 替换 `{{PLUGIN_NAME}}`、`{{PLUGIN_DESCRIPTION}}`、`{{SKILL_NAME}}` 等占位符。
3. 编写 `skills/<skill-name>/SKILL.md`。
4. 需要长文档时再创建 `docs/` 或 `skills/<skill>/references/`。
5. 需要 hooks 时再运行 `create-hooks`，或使用 `templates/dual-plugin/hooks/` 中的模板后按目标插件调整。
6. 在 Claude marketplace 和 Codex marketplace 中注册插件。
7. 验证 JSON、占位符、路径和 hooks 分平台规则。
8. 用平台命令安装或加载本地插件做一次真实检查。

## 6. 发布前检查清单

- `.claude-plugin/plugin.json` 和 `.codex-plugin/plugin.json` 的 `name` 一致。
- `version` 已按发布节奏更新。
- `skills` 使用 `./skills/`。
- 所有 manifest 路径都以 `./` 开头，并相对于插件根目录。
- 没有把 `skills/`、`docs/`、`hooks/` 放进 `.claude-plugin/` 或 `.codex-plugin/`。
- 没有未替换的 `{{...}}` 或 `example-plugin`。
- 没有共享的 `hooks/hooks.json`。
- Codex marketplace entry 有 `policy.installation`、`policy.authentication`、`category`。
- Claude marketplace entry 有 `owner`、`source` 和必要的 plugin 元数据。
