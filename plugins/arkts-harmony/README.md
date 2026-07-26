# arkts-harmony 插件

这是 `rvaim-marketplace` 中的鸿蒙 ArkTS / TypeScript 双平台插件，兼容 Claude Code 和 Codex。

## 提供能力

- ArkTS / TS 迁移规则 skill：Claude Code 使用 `/arkts-harmony:arkts-ts-rules`，Codex 使用 `$arkts-ts-rules`
- HarmonyOS/OpenHarmony 开发文档查阅 skill：Claude Code 使用 `/arkts-harmony:harmonyos-docs`，Codex 使用 `$harmonyos-docs`
- DevEco CLI skill：优先使用上游官方 CLI 完成工程脚手架、同步构建、多模块安装运行、在线签名、设备、日志、本地文档和 Skills 管理；模拟器实例、镜像与许可默认禁用，仅在用户明确要求后使用
- ArkTS Knowledge Search MCP：独立提供 DevEco Code `arkts_knowledge_search` 在线知识查询
- DevEco CLI MCP：使用上游官方 `.ets` 与 C/C++ 静态检查服务
- ArkTS LSP MCP：查找定义、引用、悬浮信息、文件符号和调用层级
- DevEco Mobile MCP：连接 HarmonyOS 设备并执行应用安装、启动、交互和截图
- HarmonyOS MCP：驱动 DevEco 工具链完成构建、安装、UI 自动化和日志检查；其中模拟器管理同样默认禁用
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
│   ├── deveco-cli/
│   │   ├── SKILL.md
│   │   ├── agents/openai.yaml
│   │   └── references/commands.md
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

插件声明五个 MCP server：

| server | 用途 | 启动方式 |
|---|---|---|
| `arkts-knowledge-search` | ArkTS/HarmonyOS 在线知识查询与独立登录 | `npx -y @rvaim/arkts_knowledge_search` |
| `deveco-cli` | 上游官方 `.ets` 与 C/C++ 静态检查 | `npx -y @deveco/deveco-cli serve mcp` |
| `deveco-arkts-lsp` | ArkTS 定义、引用、悬浮信息、符号与调用层级 | `npx -y @rvaim/deveco-arkts-lsp` |
| `deveco-mobile-mcp` | HarmonyOS/iOS/Android 设备自动化 | `npx -y @rvaim/deveco-mobile-mcp` |
| `harmonyos-mcp` | DevEco 构建、安装、启动、UI 自动化与日志；模拟器能力仅按明确授权使用 | `npx -y harmonyos-mcp` |

所有启动命令均不锁定具体版本，由 npm 解析当前正式版本。`@rvaim/arkts_knowledge_search` 不安装或启动 DevEco Code，也不包含 `@deveco/deveco-cli`；两者是相互独立的插件依赖。

### DevEco CLI 与能力分工

插件的 `deveco-cli` skill 使用以下命令入口：

```bash
npx -y @deveco/deveco-cli <command>
```

- `create`、`build`、`run`、`device`、`log`、`docs` 和 `skills` 优先使用上游官方 CLI；`emulator` 仅在用户明确要求对应操作后使用。
- 官方 CLI 会封装 `ohpm`、`hvigor`、`hdc`、模拟器和 `hilog`，在已有对应能力时不直接拼接底层命令。
- `build` 与 `run` 会判断是否需要重新同步或构建；`run` 支持一次部署多个模块并兼容在线签名。
- `.ets` 与 C/C++ 静态检查使用官方 `deveco-cli` MCP。
- 定义、引用、悬浮和调用层级使用 `deveco-arkts-lsp`。
- UI 树、截图、点击、滑动、输入和页面状态等待使用 `harmonyos-mcp`。
- 跨 HarmonyOS、iOS、Android 的通用设备操作使用 `deveco-mobile-mcp`。

官方 CLI 在插件中的完整能力：

| 场景 | 命令 |
|---|---|
| 创建 Empty Ability 工程 | `create` |
| 构建模块、Target 或产品 | `build` |
| 清理构建产物 | `build clean` |
| 构建、安装并启动一个或多个模块 | `run` |
| 部署已有产物 | `run --skip-build` |
| 查询连接设备；未获授权时只处理真机 | `device list/view` |
| 用户明确要求后管理模拟器实例 | `emulator list/start/stop/create/delete` |
| 用户明确要求后管理系统镜像与许可 | `emulator image`、`emulator license` |
| 查询、筛选、追踪 `hilog` 与崩溃日志 | `log` |
| 查询内置 HarmonyOS 文档 | `docs search/read/catalog` |
| 查询和管理 HarmonyOS Skills | `skills list/find/add/remove` |
| 检查 `.ets` 与 C/C++ 语法 | `serve mcp` |

官方 Skills 目录可以按需发现 ArkUI、ArkTS 检索、崩溃、卡死、内存泄漏、测试和多设备适配等专项能力。插件只执行 `skills list/find` 做只读发现；安装或移除前需要用户确认，不自动使用 `skills add --all`，也不把全部上游 Skill 源码复制进本插件。

模拟器能力默认完全禁用，普通的构建、运行、测试或设备选择请求不会触发模拟器查询、启停、创建、镜像下载或许可操作，也不会在真机不可用时自动回退到模拟器。用户明确要求使用模拟器后仍按操作逐项授权；镜像下载和实例创建需要分别说明磁盘影响并再次确认，创建缺少镜像时不能自动下载。该约束同时适用于官方 CLI、`harmonyos-mcp` 和底层命令。

详细参数和安全边界由 `deveco-cli` skill 提供。插件不会运行 `devecocli update` 或 `init`：前者由未锁版本的 `npx` 替代，后者会重复修改 Agent 配置。

### 文档来源与在线登录

`harmonyos-docs` skill 在插件层选择两个独立来源：

- API、组件、Kit、参数、返回值与示例优先使用 `@deveco/deveco-cli docs` 本地文档。
- 最新版本、新增、废弃、兼容性、路线图和本地未命中问题使用 `arkts_knowledge_search` 在线知识。
- 构建错误、异常和复杂故障可同时使用两种来源。

首次使用在线查询时，可以调用 `arkts_knowledge_login`，或在终端执行：

```bash
npx -y @rvaim/arkts_knowledge_search login
```

登录只会打开华为官方 OAuth 页面。JWT 加密保存在 `~/.config/arkts-knowledge-search/`，短期 `accessToken` 只保存在进程内存中。

### 前置条件

- Node.js 20 或更高版本，并可使用 `npm` 和 `npx`。
- 首次启动外部 MCP 或 DevEco CLI 时可以访问 npm registry。
- 在线知识查询需要中国站华为账号与网络连接；不登录时 DevEco CLI 本地文档仍可独立使用。
- 使用 DevEco CLI 工具链和官方静态检查 MCP 时已安装 DevEco Studio 6.1 或更高版本。
- 使用 `deveco-arkts-lsp` 时已安装 DevEco Studio 或 HarmonyOS SDK；默认把 MCP 进程当前目录作为项目目录，也可设置 `PROJECT_PATH`。
- 使用 `deveco-mobile-mcp` 操作 HarmonyOS 设备时，已安装并配置 `hdc`，且设备或模拟器可连接。
- 使用 `harmonyos-mcp` 时已安装 DevEco Studio，并可使用 `hdc`、`hvigorw` 和 Emulator；非标准安装路径可通过 `DEVECO_STUDIO_HOME` 指定。

启用插件后，不再使用原 `@deveco-codegenie/mcp@beta`。在线知识由 `@rvaim/arkts_knowledge_search` 提供，本地文档和工具链由上游官方 `@deveco/deveco-cli` 独立提供。
