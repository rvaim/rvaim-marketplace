# DevEco CLI 命令参考

本参考依据官方 `@deveco/deveco-cli` 1.2.0 的 `--help`、npm 包内 `SKILL.md`、`README.md` 与 `CHANGELOG.md` 整理。插件通过 `npx -y @deveco/deveco-cli` 使用 npm 当前正式版本；命令发生变化时，以当前版本的 `--help` 为准。

## 目录

- [运行环境](#运行环境)
- [工程创建](#工程创建)
- [构建与清理](#构建与清理)
- [安装与运行](#安装与运行)
- [设备](#设备)
- [模拟器](#模拟器)
- [日志](#日志)
- [本地文档](#本地文档)
- [HarmonyOS Skills](#harmonyos-skills)
- [静态检查 MCP](#静态检查-mcp)
- [插件内禁用的维护命令](#插件内禁用的维护命令)

## 运行环境

- 操作系统：macOS 或 Windows。
- Node.js：18 或更高版本。
- DevEco Studio：6.1.0 或更高版本。
- macOS 的 DevEco Studio 应位于 `/Applications` 或用户的 `Applications` 目录。
- 工程命令应在包含 `build-profile.json5` 的根目录执行。

## 工程创建

```bash
npx -y @deveco/deveco-cli create \
  --app-name MyApp \
  --project-path ./MyApp \
  --bundle-name com.example.myapp \
  --api-level 23
```

- 当前只创建 Empty Ability 模板。
- `--app-name` 必填，以字母开头，只使用字母、数字和下划线。
- `--project-path` 缺省为 `./<app-name>`，目标目录必须不存在或为空。
- `--bundle-name` 缺省为 `com.example.<app-name-lowercase>`。
- `--api-level` 最低为 17，缺省时从本地 SDK 自动选择。

## 构建与清理

```bash
npx -y @deveco/deveco-cli build
npx -y @deveco/deveco-cli build --modules entry library@phone
npx -y @deveco/deveco-cli build --product oversea --build-mode release
npx -y @deveco/deveco-cli build clean
```

- `--product` 缺省为 `default`。
- `--build-mode` 缺省为 `debug`。
- `--modules` 接受 `module` 或 `module@target`。
- 只指定产品时构建 `.app`；指定模块时构建对应 `.hap`、`.hsp` 或 `.har`。
- 模块依赖由 CLI 自动解析。
- 1.2.0 起会检测配置变化，未变化时可跳过重复同步或构建。

## 安装与运行

```bash
npx -y @deveco/deveco-cli run
npx -y @deveco/deveco-cli run --module entry feature --device 127.0.0.1:5555
npx -y @deveco/deveco-cli run --product oversea --build-mode release
npx -y @deveco/deveco-cli run --ability EntryAbility
npx -y @deveco/deveco-cli run --skip-build
```

- `--module` 支持一个或多个模块，也支持 `module@target`。
- 多设备时必须通过 `--device` 指定名称或序列号。
- `--ability` 缺省使用 `module.json5` 的 `mainElement`。
- `--skip-build` 只部署已有产物。
- 1.2.0 起支持多包运行和在线签名。
- `--uninstall` 会先卸载旧应用并删除其数据，只在用户明确允许时使用。

## 设备

```bash
npx -y @deveco/deveco-cli device list
npx -y @deveco/deveco-cli device view
npx -y @deveco/deveco-cli device view -t 127.0.0.1:5555
```

- `device list` 同时列出真机和运行中的模拟器；未获模拟器授权时只处理真机结果。
- `device view` 返回序列号、名称、设备类型和系统版本等信息。
- 多设备时使用 `-t` 或 `--target`。
- 未授权设备会被过滤；遇到权限拒绝时让用户在设备侧完成授权。

## 模拟器

### 默认禁用规则

- 默认不调用任何模拟器命令，包括只读查询。只有用户明确提到要查看或使用模拟器时，才进入相应流程。
- 普通构建、运行、测试或设备选择请求不授权使用模拟器；真机不可用时不得自动回退到模拟器。
- `device list` 可能被动显示已经运行的模拟器；未获授权时忽略这些目标，只处理真机结果。
- “使用模拟器运行”只允许使用已在运行的实例。启动、停止、创建、删除、镜像下载删除和许可接受都需要用户分别明确要求。
- 镜像下载和实例创建会大量读写磁盘。执行前先报告目标、磁盘影响和可获得的空间信息，并再次取得明确同意。
- 创建实例时如果缺少镜像，停止并单独询问是否下载；创建授权不得包含或暗示下载授权。
- 本节约束同时适用于 `harmonyos-mcp`、底层命令及其他模拟器工具，不得换用其他入口绕过。

### 许可

```bash
npx -y @deveco/deveco-cli emulator license view
npx -y @deveco/deveco-cli emulator license accept
```

`license view` 只读。`license accept` 必须由用户在交互式终端完成。

### 镜像

```bash
npx -y @deveco/deveco-cli emulator image list --all --format json
npx -y @deveco/deveco-cli emulator image download \
  --device-type phone \
  --os-version "HarmonyOS 6.0.1(21)"
npx -y @deveco/deveco-cli emulator image remove \
  --device-type phone \
  --os-version "HarmonyOS 6.0.1(21)"
```

- 设备类型：`phone`、`foldable`、`widefold`、`triplefold`、`tablet`、`2in1`、`2in1 foldable`、`wearable`、`tv`。
- `image list --all` 同时显示本地与远程镜像。
- 下载可能超过 30 分钟；失败或超时后不要自动重试。
- 用户未明确要求下载并在了解磁盘影响后再次同意时，不得执行 `image download`。
- `phone`、`foldable`、`widefold`、`triplefold` 可能共享同一镜像，同一系统版本只下载或删除一次。

### 实例

```bash
npx -y @deveco/deveco-cli emulator list
npx -y @deveco/deveco-cli emulator create MyPhone \
  --device-type phone \
  --os-version "HarmonyOS 6.0.1(21)"
npx -y @deveco/deveco-cli emulator start MyPhone
npx -y @deveco/deveco-cli emulator stop MyPhone
npx -y @deveco/deveco-cli emulator delete MyPhone
```

- `start` 和 `stop` 支持多个实例名称；带空格的名称需要引号。
- `stop` 也接受 `127.0.0.1:<port>` 形式的序列号。
- 用户未明确要求创建并在了解磁盘影响后再次同意时，不得执行 `create`。
- 所需镜像不存在时停止并单独申请下载授权，不得由 `create` 自动触发下载。
- `create --force` 可覆盖同名实例，使用前必须确认。
- `delete` 删除本地实例，属于外部状态变更。

## 日志

```bash
npx -y @deveco/deveco-cli log --level E --tail 200
npx -y @deveco/deveco-cli log --bundle-name com.example.app --keyword Init
npx -y @deveco/deveco-cli log --from 5m --to 2m
npx -y @deveco/deveco-cli log --crash --bundle-name com.example.app
npx -y @deveco/deveco-cli log --follow --bundle-name com.example.app
```

- 日志级别：`D`、`I`、`W`、`E`、`F`。
- `--device` 在多设备环境中必填。
- `--from`、`--to` 使用相对当前时间的 `s` 或 `m`。
- `--follow` 不能与 `--to` 同时使用，诊断结束后及时停止。

## 本地文档

```bash
npx -y @deveco/deveco-cli docs catalog --format json
npx -y @deveco/deveco-cli docs search UIAbility onCreate \
  --catalog harmonyos-guides \
  --format json \
  --limit 10
npx -y @deveco/deveco-cli docs read <documentId>
```

目录包括版本说明、开发指南、API 参考、最佳实践、FAQ 和路线图。先用 `search` 获取 `documentId`，再用 `read` 核对完整内容。

## HarmonyOS Skills

```bash
npx -y @deveco/deveco-cli skills list --long
npx -y @deveco/deveco-cli skills find <keyword>
npx -y @deveco/deveco-cli skills add --skill <name> --project <path>
npx -y @deveco/deveco-cli skills remove --skill <name> --project <path>
```

- `list` 和 `find` 是只读操作。
- `add`、`remove` 会修改 Agent 或项目配置，必须由用户请求。
- `--all`、`--force` 会扩大修改范围，使用前确认目标。
- 官方目录包含 ArkUI、ArkTS 知识检索、JS/C++ 崩溃、卡死、内存泄漏、本地与真机测试、多设备适配等专项 Skill；目录会独立更新，使用 `find` 获取当前结果。
- 优先按项目安装单个 Skill，避免把所有上游 Skill 无差别写入 Agent。

## 静态检查 MCP

启动命令：

```bash
npx -y @deveco/deveco-cli serve mcp
```

MCP 暴露 `check` 工具：

- 输入字段为 `files` 数组。
- 文件路径相对工程根目录。
- 同一次调用可混合 `.ets` 与 C/C++ 文件。
- 可使用 `PROJECT_PATH` 指定工程根目录。
- 可使用 `DEVECO_PATH` 指定 DevEco Studio 路径。
- `NODE_MAX_OLD_SPACE_SIZE` 控制内部 Node.js 老生代内存，缺省为 8192。
- `DEBUG=1` 用于诊断启动问题，避免在普通运行中启用。

## 插件内禁用的维护命令

- 不运行 `update`：插件通过未锁版本的 `npx` 使用 npm 当前正式版本。
- 不运行 `init`：插件已经提供 `deveco-cli` Skill 和 MCP 配置，避免重复覆盖 Agent 配置。
