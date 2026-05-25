# arkts-harmony 插件

这是 `rvaim-marketplace` 中的鸿蒙 ArkTS / TypeScript 双平台插件，兼容 Claude Code 和 Codex。

## 提供能力

- ArkTS / TS 迁移规则 skill：Claude Code 使用 `/arkts-harmony:arkts-ts-rules`，Codex 使用 `$arkts-ts-rules`
- HarmonyOS/OpenHarmony 开发文档查阅 skill：Claude Code 使用 `/arkts-harmony:harmonyos-docs`，Codex 使用 `$harmonyos-docs`
- 文档查阅优先使用中文 OpenHarmony docs，中文入口或链接不可用时自动切换到英文应用开发文档入口
- 修改 `.ets`、`.ts`、`.tsx` 文件后的轻量自动检查 hooks
- 完整保留四份原始 Markdown 资料
- 中文规则索引与资料清单

## 目录结构

```text
arkts-harmony/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── skills/
│   ├── arkts-ts-rules/
│   └── harmonyos-docs/
├── hooks/
│   ├── claude-hooks.json
│   └── codex-hooks.json
└── bin/
    └── arkts-ts-post-edit.mjs
```

## 资料位置

```text
skills/arkts-ts-rules/references/original-docs/
```

包含：

```text
arkts-migration-background.md
typescript-to-arkts-migration-guide.md
arkts-more-cases.md
arkts-high-performance-programming.md
```

## 自动检查

Claude Code 使用 `Write`、`Edit`、`MultiEdit` 修改 `.ets`、`.ts`、`.tsx` 文件后，会触发：

```bash
node ${CLAUDE_PLUGIN_ROOT}/bin/arkts-ts-post-edit.mjs
```

Codex 使用 `Edit`、`Write`、`apply_patch` 修改文件后，会触发：

```bash
node ${PLUGIN_ROOT}/bin/arkts-ts-post-edit.mjs
```

Codex 测试 hooks 前需要确认：

```toml
[features]
codex_hooks = true
```

脚本只做轻量扫描，不会替代编译器或完整代码审查。
