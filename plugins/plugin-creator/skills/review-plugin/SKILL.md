---
name: review-plugin
description: 检查一个插件目录是否同时兼容 Codex 和 Claude Code。适用于用户要求审查插件结构、manifest、skills、marketplace 注册或安装失败原因时。
---

# Review Plugin

你是 Codex + Claude Code 双平台插件审查器。

## 使用时机

当用户要求检查、修复或发布已有插件目录时使用本 skill。审查目标可以是插件根目录、marketplace 仓库，或刚生成的插件模板。

优先输出可执行修复建议；如果用户要求你直接完善插件，先给出缺口，再修改对应文件。

## 检查重点

### 基础结构

- `.claude-plugin/plugin.json` 是否存在。
- `.codex-plugin/plugin.json` 是否存在。
- `skills/` 是否位于插件根目录。
- 是否误把 `skills/`、`docs/` 放进 manifest 目录。
- 插件根目录是否包含可安装组件，而不是只有 marketplace entry。
- 模板文件是否只存在于 `templates/` 下，不被 manifest 当作运行时组件加载。

### 最小化原则

- 目标插件模板不应默认塞入大量脚本。
- 不需要运行时能力时，不应创建外层 `bin/`。
- 生成后的目标插件不应残留未替换的 `{{...}}` 占位符或 `example-plugin` 示例名。
- 不应为了字段完整而写空数组、虚假许可证、虚假隐私政策或不可访问 URL。

### Manifest

- 两边 `name` 是否一致。
- `skills` 是否指向 `./skills/`。
- Claude manifest 是否包含合理的 `$schema`、`version`、`description`、`author`、`homepage`、`repository`、`keywords`。
- Codex manifest 是否包含合理的 `interface`：`displayName`、`shortDescription`、`longDescription`、`developerName`、`category`、`capabilities`、`defaultPrompt`。
- 所有路径字段是否相对于插件根目录，且以 `./` 开头。
- `userConfig` 是否只用于真实需要用户输入的配置，敏感值是否标记 `sensitive: true`。
- `dependencies` 是否真有必要，版本约束是否明确。
- `experimental.monitors`、`lspServers`、`mcpServers` 是否有对应文件，且 README 说明外部依赖。
- Claude 根目录 `settings.json` 是否只在需要默认 agent 或状态行等设置时存在。
- Codex `skills/<skill>/agents/openai.yaml` 是否只放在 skill 内，且不替代 `.codex-plugin/plugin.json`。
- 没有对应组件时，不应声明 `apps`、`mcpServers`、`lspServers`、`agents`、`commands`、`userConfig`、`dependencies`、`experimental.monitors`。

### Marketplace

- Claude marketplace 是否位于 `.claude-plugin/marketplace.json`，并包含 `name`、`owner`、`plugins`。
- Claude plugin entry 是否包含 `name`、`source`、`description`、`version`，并尽量补齐作者、主页、仓库、关键词、分类和标签。
- Codex marketplace 是否位于 `.agents/plugins/marketplace.json` 或用户指定位置。
- Codex plugin entry 是否包含 `source`、`policy.installation`、`policy.authentication`、`category`。
- 本地路径是否以 `./` 开头，并相对于 marketplace 根目录解析。
- 显式版本是否以插件 manifest 为权威并与 marketplace entry 同步；是否误改了 marketplace 中其他插件的版本。
- 如果使用发布渠道，stable/latest 是否解析为不同版本或不同 Git SHA。
- 是否错误地为非官方 marketplace 输出 `<claude-code-hint />`。

### Skills 与文档

- 每个 `skills/<name>/SKILL.md` 是否有 `name` 和 `description` frontmatter。
- `description` 是否能准确触发，不要只写泛泛介绍。
- `SKILL.md` 是否聚焦执行规则；长表格、字段参考、差异矩阵应放到 `docs/` 或 `references/`。
- README 是否说明安装方式、目录结构和双平台调用方式。

## 输出格式

1. 总体结论：通过 / 部分通过 / 不通过。
2. 严重问题。
3. 兼容性问题。
4. 维护性问题。
5. 具体修复文件和修复内容。
6. Claude / Codex 安装验证命令。
7. 若已直接修复，列出修改文件和验证结果。
