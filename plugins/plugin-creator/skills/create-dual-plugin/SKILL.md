---
name: create-dual-plugin
description: 创建一个同时兼容 Codex 和 Claude Code 的插件骨架。适用于用户要求创建插件、插件市场、skill、manifest、marketplace.json、双平台插件模板时。
---

# Create Dual Plugin

你是一个 Codex + Claude Code 双平台插件创建器。

## 使用时机

当用户要求创建、改造、打包或发布插件时使用本 skill。典型请求包括：

- 创建一个 Codex / Claude Code 都能安装的插件。
- 把现有 skill 打包成插件。
- 生成或完善 `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`。
- 生成 Claude marketplace entry 或 Codex marketplace entry。
- 检查插件目录是否应该拆分、合并或补齐模板。

如果用户只要求为已有插件生成 hooks，转用 `create-hooks`；如果用户要求审查已有插件，优先使用 `review-plugin`。

## 默认策略

1. 生成一个插件根目录，不拆成 `codex/` 和 `claude/` 两份。
2. 同一个插件根目录同时包含：
   - `.codex-plugin/plugin.json`
   - `.claude-plugin/plugin.json`
   - `skills/`
   - `docs/`
3. 默认不启用 hooks，manifest 不声明 `hooks` 字段。
4. 默认不生成 `bin/`。
5. `templates/dual-plugin/hooks/` 可以提供 hooks 模板文件，但只有用户明确要求“自动执行、工具调用前后检查、保存后扫描、拦截命令、运行脚本”时，才启用 hooks 并生成脚本。
6. 文档默认中文。
7. 插件名、skill 名使用 kebab-case。
8. 大型资料放到 `docs/` 或 `skills/<skill>/references/`，不要塞进 `SKILL.md`。
9. 使用 `templates/dual-plugin/` 时必须替换所有 `{{...}}` 占位符，不要留下模板值。
10. 配置字段尽量完整，但不能伪造不存在的 homepage、repository、license、privacyPolicyURL 或 termsOfServiceURL。
11. 发布面信息优先放在 manifest 和 marketplace：名称、描述、作者、主页、仓库、关键词、分类、能力、默认提示。

## 最小目标结构

```text
<plugin-name>/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
└── docs/
```

## 需要 hooks 时再追加

```text
<plugin-name>/
├── hooks/
│   ├── claude-hooks.json
│   └── codex-hooks.json
└── bin/
    └── <hook-script>.mjs
```

## 必填输入

开始生成前确认或合理推断这些值：

- `plugin-name`：kebab-case，作为命名空间和安装标识。
- `displayName`：给用户看的名称，中文插件可用中文。
- `description`：一句话说明插件能力。
- `developerName`：作者或团队名。
- `skill-name`：kebab-case。
- `skill-description`：明确什么时候触发该 skill。
- `source`：本地路径、Git URL、GitHub repo 或 npm 包。

无法确定的公开链接字段不要写占位 URL；在输出中标注“待发布前补齐”即可。

## Manifest 生成规则

Claude Code manifest 写到 `.claude-plugin/plugin.json`：

- 推荐字段：`$schema`、`name`、`version`、`description`、`author`、`homepage`、`repository`、`keywords`、`skills`。
- `skills` 使用 `./skills/`。
- 只有确实需要 Claude hooks 时才写 `hooks: "./hooks/claude-hooks.json"`。
- 只有确实需要 MCP、LSP、agents、commands、monitors、userConfig、dependencies 时才写对应字段。
- 需要用户输入 token、endpoint、文件或目录时优先生成 `userConfig`，不要把用户值硬编码进命令。
- 需要默认 agent 或状态行时再创建根目录 `settings.json`。

Codex manifest 写到 `.codex-plugin/plugin.json`：

- 推荐字段：`name`、`version`、`description`、`author`、`homepage`、`repository`、`keywords`、`skills`、`interface`。
- `interface` 尽量补齐 `displayName`、`shortDescription`、`longDescription`、`developerName`、`category`、`capabilities`、`websiteURL`、`brandColor`、`defaultPrompt`。
- 只有真实存在资产时才写 `composerIcon`、`logo`、`screenshots`。
- 只有确实需要 Codex hooks 时才写 `hooks: "./hooks/codex-hooks.json"`。
- 需要 Codex skill 展示元数据、隐式调用策略或工具依赖时，在对应 skill 下生成 `agents/openai.yaml`，不要把它放到插件根目录。

## Marketplace 生成规则

Claude Code marketplace entry：

- 字段包括 `name`、`description`、`version`、`author`、`homepage`、`repository`、`keywords`、`category`、`tags`、`source`、`strict`。
- 本地 source 用 `"./plugins/<plugin-name>"`。
- GitHub 或 Git URL source 使用对象，不要写成本地路径。

Codex marketplace entry：

- 字段包括 `name`、`source`、`policy`、`category`，必要时补 `interface`。
- 本地 source 使用 `{ "source": "local", "path": "./plugins/<plugin-name>" }`。
- `policy.installation` 默认 `AVAILABLE`；`policy.authentication` 默认 `ON_INSTALL`。
- `source.path` 必须相对于 marketplace 根目录，并以 `./` 开头。
- 显式写 `version` 时，以插件 manifest 为权威；如果 marketplace entry 也写版本，必须同步提升。选择 Git SHA 版本策略时，不要在 manifest 或 entry 中写固定版本。
- 只有官方 Anthropic marketplace 插件才输出 `<claude-code-hint />` 方案；普通个人 marketplace 不生成 CLI hint。

## 输出要求

创建插件时输出：

1. 目录结构。
2. `.claude-plugin/plugin.json`。
3. `.codex-plugin/plugin.json`。
4. 主 `SKILL.md`。
5. Claude marketplace entry。
6. Codex marketplace entry。
7. 安装命令。
8. 已替换的模板占位符清单。
9. 如果用户要求 hooks，再输出分平台 hooks 配置和必要脚本。
10. 如果用户要求 LSP、MCP、monitors、userConfig、dependencies、openai.yaml 或 settings.json，输出对应文件和不默认生成的理由。
11. 验证清单：JSON 是否有效、manifest 路径是否以 `./` 开头、是否存在未替换占位符、是否误用了 `hooks/hooks.json`、版本是否同步。

## 参考文档

需要详细规则时，读取：

- `docs/01-dual-plugin-development-guide.md`
- `docs/02-manifest-reference.md`
- `docs/03-marketplace-reference.md`
- `docs/04-hooks-authoring-guide.md`
- `docs/05-claude-hooks-reference.md`
- `docs/06-codex-hooks-reference.md`
- `docs/07-hooks-difference-matrix.md`
