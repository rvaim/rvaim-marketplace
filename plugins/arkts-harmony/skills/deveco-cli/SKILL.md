---
name: deveco-cli
description: 使用上游官方 @deveco/deveco-cli 创建、构建、运行和调试 HarmonyOS 应用，并管理设备、模拟器、日志、本地文档和 HarmonyOS Skills。遇到 HarmonyOS 工程脚手架、构建部署、设备或模拟器、hilog、崩溃日志、本地文档或技能管理任务时使用。
---

# DevEco CLI

优先使用上游官方 `@deveco/deveco-cli` 驱动 DevEco Studio 工具链。通过 `npx` 调用时不锁定版本：

```bash
npx -y @deveco/deveco-cli <command>
```

不运行 `devecocli update`：`npx` 会解析 npm 当前正式版本。参数不确定时先运行对应命令的 `--help`，不要猜测。

## 能力选择

| 场景 | 使用方式 |
|---|---|
| 创建工程 | `create` |
| 构建或清理 | `build`、`build clean` |
| 构建、安装并启动 | `run` |
| 设备列表和详情 | `device list`、`device view` |
| 模拟器镜像和实例 | `emulator` |
| hilog 与崩溃日志 | `log` |
| 本地 HarmonyOS 文档 | `docs search/read/catalog` |
| HarmonyOS Skills | `skills list/find/add/remove` |
| `.ets`、C/C++ 静态检查 | 插件内 `deveco-cli` MCP 的 `check` 工具 |

语义导航继续使用 `deveco-arkts-lsp`；UI 树、点击、滑动、输入、截图和状态等待继续使用 `harmonyos-mcp`；跨 HarmonyOS、iOS、Android 的通用设备操作使用 `deveco-mobile-mcp`。

## 标准工作流

1. 在包含 `build-profile.json5` 的 HarmonyOS 工程根目录执行命令。
2. 新工程使用 `create --app-name <name> --project-path <path>`。
3. 首次运行或修改依赖后，先构建；需要部署时使用 `run`。
4. 多设备场景先执行 `device list`，再通过 `--device <name-or-serial>` 明确目标。
5. 运行失败时按顺序检查构建输出、`log --level E` 和 `log --crash`。
6. 需要操作页面时切换到 `harmonyos-mcp`，不要用日志猜测 UI 状态。

## 常用命令

```bash
# 创建
npx -y @deveco/deveco-cli create --app-name MyApp --project-path ./MyApp

# 构建
npx -y @deveco/deveco-cli build
npx -y @deveco/deveco-cli build --modules entry --build-mode release

# 运行
npx -y @deveco/deveco-cli run --module entry

# 设备和模拟器
npx -y @deveco/deveco-cli device list
npx -y @deveco/deveco-cli emulator list

# 日志
npx -y @deveco/deveco-cli log --level E --tail 200
npx -y @deveco/deveco-cli log --crash --bundle-name com.example.app

# 本地文档
npx -y @deveco/deveco-cli docs search UIAbility onCreate --format json
```

## 安全边界

- `create` 前确认目标目录不存在或为空，避免覆盖用户文件。
- `run --uninstall` 会删除设备上的旧应用及其数据，只有用户明确要求或签名冲突确需处理时才使用。
- `emulator delete`、`emulator image remove`、`skills remove` 和 `skills add` 会修改外部状态，只在用户请求对应操作时执行。
- 模拟器许可接受必须由用户在交互式终端完成。
- 镜像下载可能耗时较长；失败后不要自动反复重试。
- `log --follow` 是持续命令，完成诊断后及时停止。
- 不运行 `init` 修改 Agent 配置；本插件已经提供 Skill 与 MCP 配置。
