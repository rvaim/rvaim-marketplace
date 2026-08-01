# rvaim-marketplace

rvaim 的个人插件市场，同时维护 Claude Code 和 Codex 的 marketplace 元数据。插件源码直接放在本仓库 `plugins/` 目录下，以平台支持的本地相对路径方式引用。共享插件可同时面向两个平台，也允许只依赖某一平台运行时的专属插件。

## 当前插件

| 插件 | 用途 |
|---|---|
| `arkts-harmony` | ArkTS / HarmonyOS 迁移与审查规则，以及文档查询、代码智能、设备自动化 MCP。 |
| `harmonyos-design` | 华为官方 HarmonyOS 通用设计基础、设计 Token、跨设备界面设计与视觉审查。 |
| `plugin-creator` | 创建、审查和维护 Codex / Claude Code 双平台插件。 |
| `letta-mem` | 通过本机或自托管的新版 Letta App Server，为 Claude Code 与 Codex 提供按用户语言维护的工作区、共享或混合持久记忆。 |

## 目录结构

```text
rvaim-marketplace/
├── .claude-plugin/
│   └── marketplace.json          # Claude Code marketplace
├── .agents/
│   └── plugins/
│       └── marketplace.json      # Codex marketplace
├── plugins/                      # 插件源码
│   ├── arkts-harmony/
│   ├── harmonyos-design/
│   ├── plugin-creator/
│   └── letta-mem/
└── README.md
```

## Claude Code

添加 marketplace：

```text
/plugin marketplace add rvaim/rvaim-marketplace
```

本地开发时可直接用本地路径：

```text
/plugin marketplace add ./rvaim-marketplace
```

安装插件：

```text
/plugin install arkts-harmony@rvaim-marketplace
/plugin install harmonyos-design@rvaim-marketplace
/plugin install plugin-creator@rvaim-marketplace
/plugin install letta-mem@rvaim-marketplace
/reload-plugins
```

`letta-mem` 没有手动 skill 入口，启用后由生命周期 Hooks 自动工作。Claude Code 与 Codex 共用 `~/.letta-mem/config.json`；安装前请先阅读[本地 Letta 与插件配置](plugins/letta-mem/README.md)。

常用入口：

```text
/arkts-harmony:arkts-ts-rules
/arkts-harmony:harmonyos-docs
/harmonyos-design:harmonyos-design-guidelines
/plugin-creator:create-dual-plugin
/plugin-creator:review-plugin
```

更新 marketplace 和插件：

```text
/plugin marketplace update rvaim-marketplace
/plugin update arkts-harmony@rvaim-marketplace
/plugin update harmonyos-design@rvaim-marketplace
/plugin update plugin-creator@rvaim-marketplace
/plugin update letta-mem@rvaim-marketplace
/reload-plugins
```

## Codex

Codex CLI 可以通过 `codex plugin marketplace` 管理 marketplace source。

添加 marketplace：

```text
codex plugin marketplace add rvaim/rvaim-marketplace
```

也可以使用 Git URL、SSH URL 或本地 marketplace 根目录：

```text
codex plugin marketplace add https://github.com/rvaim/rvaim-marketplace
codex plugin marketplace add git@github.com:rvaim/rvaim-marketplace.git
codex plugin marketplace add /path/to/rvaim-marketplace
```

刷新 Git-backed marketplace：

```text
codex plugin marketplace upgrade rvaim-marketplace
```

移除 marketplace：

```text
codex plugin marketplace remove rvaim-marketplace
```

Codex marketplace 文件位于：

```text
.agents/plugins/marketplace.json
```

安装后常用入口：

```text
$arkts-ts-rules
$harmonyos-docs
$harmonyos-design-guidelines
$create-dual-plugin
$review-plugin
```

安装 `letta-mem`：

```text
codex plugin add letta-mem@rvaim-marketplace
```

安装后在 `/hooks` 中审查并信任插件 Hook。

如需测试 Codex hooks，确认 Codex 配置已开启：

```toml
[features]
hooks = true
```

## 维护规则

- Claude Code marketplace 写在 `.claude-plugin/marketplace.json`。
- Codex marketplace 写在 `.agents/plugins/marketplace.json`。
- 同时支持 Claude Code 和 Codex 的共享插件，应在两份 marketplace 中保持名称、版本和源路径一致。
- 平台专属插件只登记到对应 marketplace；支持双平台的插件需要分别提供有效清单和生命周期配置。
- 插件源码放在 `plugins/` 目录下；Claude Code 使用字符串 source（如 `"./plugins/<name>"`），Codex 使用 `{ "source": "local", "path": "./plugins/<name>" }`。
- 新增插件时补充本 README 的插件表与相应平台的安装入口；不要为不支持的平台伪造清单或 skill 入口。
- Codex CLI marketplace 命令参考：`https://developers.openai.com/codex/cli/reference`。
