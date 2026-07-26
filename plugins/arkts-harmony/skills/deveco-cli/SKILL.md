---
name: deveco-cli
description: 使用上游官方 @deveco/deveco-cli 管理 HarmonyOS 应用开发全生命周期，包括工程脚手架、同步与构建、安装运行、多设备、多模块、模拟器实例与镜像、许可、hilog 与崩溃日志、本地文档、HarmonyOS Skills 和 ArkTS/C++ 静态检查。处理含 build-profile.json5 或 oh-package.json5 的工程，或用户提及 HarmonyOS、鸿蒙、DevEco、ArkTS、ArkUI、设备、模拟器、构建、运行、日志、文档或 Skills 时使用。
---

# DevEco CLI

优先使用上游官方 `@deveco/deveco-cli` 驱动 DevEco Studio 工具链。它统一封装 `ohpm`、`hvigor`、`hdc`、模拟器和 `hilog`，不要在已有 CLI 能力时直接拼接底层命令。

通过 `npx` 调用时不锁定版本：

```bash
npx -y @deveco/deveco-cli <command>
```

遵循以下原则：

1. 在包含 `build-profile.json5` 的工程根目录执行工程命令。
2. 参数不确定时先运行对应层级的 `--help`，不要猜测。
3. 不运行 `devecocli update`：`npx` 会解析 npm 当前正式版本。
4. 不运行 `init` 修改 Agent 配置：本插件已提供 Skill 与 MCP。
5. 需要完整参数时读取 [references/commands.md](references/commands.md)。

## 能力选择

| 场景 | 使用方式 |
|---|---|
| 创建 Empty Ability 工程 | `create` |
| 同步依赖、构建模块或产品 | `build` |
| 清理构建产物 | `build clean` |
| 构建、安装并启动一个或多个模块 | `run` |
| 复用已有产物部署 | `run --skip-build` |
| 设备列表和详情 | `device list`、`device view` |
| 模拟器实例启停与创建删除 | `emulator list/start/stop/create/delete` |
| 模拟器镜像与许可 | `emulator image`、`emulator license` |
| `hilog`、时间范围、关键词与崩溃日志 | `log` |
| 本地 HarmonyOS 文档 | `docs search/read/catalog` |
| HarmonyOS Skills | `skills list/find/add/remove` |
| `.ets`、C/C++ 静态检查 | 插件内 `deveco-cli` MCP 的 `check` 工具 |

`build` 和 `run` 会判断是否需要工程同步或重新构建；配置未变化时允许 CLI 跳过重复工作。`run --module` 支持多个模块，并兼容在线签名场景。

## 工作流

### 新工程到运行

1. 确认目标目录不存在或为空。
2. 使用 `create --app-name <name> --project-path <path>` 创建工程。
3. 进入工程根目录并运行 `build`。
4. 使用 `device list` 或 `emulator list` 确认目标。
5. 使用 `run --module <module> --device <name-or-serial>` 安装并启动。
6. 使用 `log --level E --bundle-name <bundle>` 检查错误。

### 已有工程迭代

1. 修改依赖、产品或构建配置后运行 `build`，让 CLI 处理必要同步。
2. 只需重新部署已有产物时使用 `run --skip-build`。
3. 多模块应用通过一次 `run --module <m1> <m2>` 部署。
4. 指定产品、构建模式、设备和 Ability，避免多目标工程中的隐式选择。

### 故障诊断

1. 构建失败时保留完整命令、产品、模块、构建模式和首个根因错误。
2. 设备问题先运行 `device list`、`device view -t <target>`。
3. 运行失败后查询 `log --level E --from 5m --tail 200`。
4. 崩溃时使用 `log --crash --bundle-name <bundle>`。
5. `error:install sign info inconsistent` 只有在用户允许清除旧应用数据时才使用 `run --uninstall`。

### 按需扩展官方 Skills

1. 遇到 ArkUI、ArkTS 检索、崩溃、卡死、内存泄漏、测试或多设备适配等专项任务时，先使用 `skills find <keyword>` 或 `skills list --long` 查找官方 Skill。
2. 只读查询可直接执行；安装前说明目标 Skill、安装位置和用途。
3. 用户确认后使用 `skills add --skill <name> --project <path>`，不要默认使用 `--all`。
4. 本插件已有同等能力时避免重复安装；移除 Skill 必须由用户明确要求。

## 工具分工

- 工程脚手架、构建、安装运行、设备、模拟器、镜像、许可、日志、本地文档和 Skills：使用本 Skill 调用官方 CLI。
- `.ets` 与 C/C++ 静态语法诊断：使用插件内官方 `deveco-cli` MCP 的 `check`，文件路径相对工程根目录。
- 定义、引用、悬浮信息、文件符号和调用层级：使用 `deveco-arkts-lsp`。
- UI 树、截图、点击、滑动、输入和页面状态等待：使用 `harmonyos-mcp`。
- HarmonyOS、iOS、Android 通用设备操作：使用 `deveco-mobile-mcp`。
- 最新版本、废弃、兼容性和本地文档未命中问题：使用 `arkts_knowledge_search`。
- 上游专项工作流：使用 `skills find/list` 发现，用户确认后再通过 `skills add` 安装。

## 安全边界

- `create` 前确认目标目录不存在或为空，避免覆盖用户文件。
- `build clean` 会删除构建产物，只在确需干净构建时使用。
- `run --uninstall` 会删除设备上的旧应用及其数据，只有用户明确要求或签名冲突确需处理时才使用。
- `emulator delete`、`emulator image remove`、`skills add/remove` 会修改外部状态，只在用户请求对应操作时执行。
- `emulator license accept` 必须由用户在交互式终端阅读并接受协议，Agent 不代替确认。
- 镜像下载可能耗时较长；失败后不要自动反复重试。
- `emulator create` 超时后不要修改 SDK 文件或反复创建；请用户打开 DevEco Studio 设备管理器确认。
- `log --follow` 是持续命令，完成诊断后及时停止；它不能与 `--to` 同时使用。
