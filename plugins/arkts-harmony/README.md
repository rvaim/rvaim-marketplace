# arkts-harmony 插件

这是 `rvaim-marketplace` 中的鸿蒙 ArkTS / TypeScript 双平台插件，兼容 Claude Code 和 Codex。

## 提供能力

- ArkTS / TS 迁移规则 skill：Claude Code 使用 `/arkts-harmony:arkts-ts-rules`，Codex 使用 `$arkts-ts-rules`
- HarmonyOS/OpenHarmony 开发文档查阅 skill：Claude Code 使用 `/arkts-harmony:harmonyos-docs`，Codex 使用 `$harmonyos-docs`
- DevEco CodeGenie MCP：查询 HarmonyOS/OpenHarmony 开发文档
- ArkTS LSP MCP：查找定义、引用、悬浮信息、文件符号和调用层级
- DevEco Mobile MCP：连接 HarmonyOS 设备并执行应用安装、启动、交互和截图
- HarmonyOS MCP：驱动 DevEco 工具链完成模拟器管理、构建、安装、UI 自动化和日志检查
- 修改 `.ets`、`.ts`、`.tsx` 文件后的轻量自动检查 hooks
- 完整保留四份原始 Markdown 资料
- 中文规则索引与资料清单

## 目录结构

```text
arkts-harmony/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── .mcp.json
├── skills/
│   ├── arkts-ts-rules/
│   └── harmonyos-docs/
├── hooks/
│   ├── hooks.json
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

Codex 通过默认 `hooks/hooks.json`，在使用 `Edit`、`Write`、`apply_patch` 修改文件后触发：

```bash
node ${PLUGIN_ROOT}/bin/arkts-ts-post-edit.mjs
```

Codex 测试 hooks 前需要确认：

```toml
[features]
codex_hooks = true
```

脚本只做轻量扫描，不会替代编译器或完整代码审查。

## MCP 服务

插件声明四个 MCP server：

| server | 用途 | 启动方式 |
|---|---|---|
| `deveco-mcp` | HarmonyOS/OpenHarmony 文档查询 | `npx -y @deveco-codegenie/mcp@beta` |
| `deveco-arkts-lsp` | ArkTS 定义、引用、悬浮信息、符号与调用层级 | `npx -y @rvaim/deveco-arkts-lsp` |
| `deveco-mobile-mcp` | HarmonyOS/iOS/Android 设备自动化 | `npx -y @rvaim/deveco-mobile-mcp` |
| `harmonyos-mcp` | DevEco 模拟器、构建、安装、启动、UI 自动化与日志 | `npx -y harmonyos-mcp` |

上述两个 `@rvaim` MCP 依赖不锁定具体版本，由 npm 的 `latest` 标签解析当前正式版本。两个包的功能源码来自对应上游仓库，未修改其业务代码。

### 前置条件

- Node.js 20 或更高版本，并可使用 `npm` 和 `npx`。
- 使用 `deveco-arkts-lsp` 时已安装 DevEco Studio 或 HarmonyOS SDK；默认把 MCP 进程当前目录作为项目目录，也可设置 `PROJECT_PATH`。
- 使用 `deveco-mobile-mcp` 操作 HarmonyOS 设备时，已安装并配置 `hdc`，且设备或模拟器可连接。
- 使用 `harmonyos-mcp` 时已安装 DevEco Studio，并可使用 `hdc`、`hvigorw` 和 Emulator；非标准安装路径可通过 `DEVECO_STUDIO_HOME` 指定。
- 首次启动外部 MCP 时可以访问 npm registry。

启用插件后，`harmonyos-docs` skill 会优先使用 `deveco-mcp` 暴露的文档查询工具，不再维护 raw GitHub 文档 URL 或华为开发者搜索兜底流程。
