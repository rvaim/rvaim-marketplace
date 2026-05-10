# rvaim-marketplace

rvaim 的个人插件市场入口，同时维护 Claude Code 和 Codex 的 marketplace 元数据。这个仓库只负责插件市场清单；具体插件源码放在独立插件仓库中。

## 当前插件

| 插件 | 用途 | 源码 |
|---|---|---|
| `arkts-harmony` | ArkTS / TypeScript / HarmonyOS 迁移规则、代码审查规则和自动后置检查。 | `https://github.com/rvaim/arkts-harmony` |
| `plugin-creator` | 创建、审查和维护 Codex / Claude Code 双平台插件。 | `https://github.com/rvaim/plugin-creator` |

## 目录结构

```text
rvaim-marketplace/
├── .claude-plugin/
│   └── marketplace.json          # Claude Code marketplace
├── .agents/
│   └── plugins/
│       └── marketplace.json      # Codex marketplace
└── README.md
```

## Claude Code

添加 marketplace：

```text
/plugin marketplace add rvaim/rvaim-marketplace
```

安装插件：

```text
/plugin install arkts-harmony@rvaim-marketplace
/plugin install plugin-creator@rvaim-marketplace
/reload-plugins
```

常用入口：

```text
/arkts-harmony:arkts-ts-rules
/arkts-harmony:harmonyos-docs
/plugin-creator:create-dual-plugin
/plugin-creator:review-plugin
/plugin-creator:create-hooks
```

更新 marketplace 和插件：

```text
/plugin marketplace update rvaim-marketplace
/plugin update arkts-harmony@rvaim-marketplace
/plugin update plugin-creator@rvaim-marketplace
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
$create-dual-plugin
$review-plugin
$create-hooks
```

如需测试 Codex hooks，确认 Codex 配置已开启：

```toml
[features]
codex_hooks = true
```

## 维护规则

- Claude Code marketplace 写在 `.claude-plugin/marketplace.json`。
- Codex marketplace 写在 `.agents/plugins/marketplace.json`。
- 两份 marketplace 的插件列表应保持一致。
- 插件源码使用 `source: url` 指向独立仓库，不在本仓库复制插件源码。
- 新增插件时同时补充本 README 的插件表、Claude Code 安装命令和 Codex skill 入口。
- Codex CLI marketplace 命令参考：`https://developers.openai.com/codex/cli/reference`。
