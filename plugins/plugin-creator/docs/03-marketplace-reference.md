# Marketplace 参考

## Claude Code marketplace

路径：

```text
<repo>/.claude-plugin/marketplace.json
```

示例：

```json
{
  "name": "rvaim-marketplace",
  "version": "1.0.0",
  "description": "团队或个人插件市场。",
  "owner": {
    "name": "rvaim"
  },
  "plugins": [
    {
      "name": "plugin-creator",
      "description": "创建和审查 Codex / Claude Code 双兼容插件。",
      "version": "1.0.0",
      "author": {
        "name": "rvaim"
      },
      "source": "./plugins/plugin-creator",
      "category": "development",
      "homepage": "https://github.com/rvaim/rvaim-marketplace/blob/main/plugins/plugin-creator/README.md",
      "repository": "https://github.com/rvaim/plugin-creator",
      "keywords": [
        "codex",
        "claude-code",
        "plugin"
      ],
      "tags": [
        "dual-platform",
        "skills"
      ],
      "strict": true
    }
  ]
}
```

Claude marketplace 要点：

- 根对象必须有 `name`、`owner`、`plugins`。
- `owner.name` 必填，`owner.email` 可选。
- plugin entry 必须有 `name` 和 `source`。
- 相对路径 source 必须以 `./` 开头，并相对于 marketplace 根目录。
- plugin entry 可以补齐 manifest 元数据，便于安装前展示。
- `strict: true` 表示以插件自己的 `plugin.json` 作为组件定义权威。

## Codex marketplace

路径：

```text
<repo>/.agents/plugins/marketplace.json
```

示例：

```json
{
  "name": "rvaim-marketplace",
  "interface": {
    "displayName": "rvaim 插件市场"
  },
  "plugins": [
    {
      "name": "plugin-creator",
      "source": {
        "source": "local",
        "path": "./plugins/plugin-creator"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Development",
      "interface": {
        "displayName": "插件创建器",
        "shortDescription": "创建和审查 Codex / Claude Code 双兼容插件。",
        "developerName": "rvaim",
        "capabilities": [
          "Read",
          "Write"
        ]
      }
    }
  ]
}
```

Codex marketplace 要点：

- 根对象使用 `name` 标识 marketplace。
- `interface.displayName` 是 Codex 插件目录里显示的 marketplace 名称。
- 每个 plugin entry 至少包含 `name`、`source`、`policy`、`category`。
- 本地插件使用 `{ "source": "local", "path": "./plugins/<plugin-name>" }`。
- `policy.installation` 常用 `AVAILABLE`、`INSTALLED_BY_DEFAULT`、`NOT_AVAILABLE`。
- `policy.authentication` 根据插件是否需要连接外部服务选择，普通 skill 插件可用 `ON_INSTALL`。
- `interface` 可以覆盖列表页展示，但插件自身 `.codex-plugin/plugin.json` 仍应保持完整。
- Git-backed 插件可以使用 `source: "url"` 或 `source: "git-subdir"`；本地汇总仓库调试时优先使用 `source: "local"` + `path`。

## 路径规则

`source` / `source.path` 都按 marketplace 根目录解析，也就是仓库根目录，不是按 `.claude-plugin/` 或 `.agents/plugins/` 解析。

不要使用 `../` 指向 marketplace 根目录外的插件。安装时平台会复制或缓存插件目录，插件内部也不应依赖目录外文件。

## 发布验证

Claude Code：

```shell
/plugin marketplace add ./rvaim-marketplace
/plugin install plugin-creator@rvaim-marketplace
```

Codex CLI：

```bash
codex plugin marketplace add ./rvaim-marketplace
codex plugin marketplace upgrade rvaim-marketplace
```

本地 workspace marketplace：

```text
.agents/plugins/marketplace.json
plugins/<plugin-name>/
```

## 版本策略

Claude Code 解析插件版本的优先级：

1. 插件自身 `.claude-plugin/plugin.json` 的 `version`。
2. marketplace entry 的 `version`。
3. Git 源的提交 SHA。

如果 manifest 里写了显式 `version`，每次发布都必须提升它；只改 marketplace entry 但忘记改 manifest，用户可能仍然拿到旧缓存。对于快速迭代或内部插件，可以考虑省略显式版本，让 Git SHA 作为版本。

Claude Code 中 `plugin.json` 的版本优先于 marketplace entry。为了减少漂移，二选一：

- 公开发布且需要稳定版本号：在 `plugin.json` 中维护语义化版本，marketplace entry 可以省略版本，或确保它始终同步。
- 内部快速迭代：省略 manifest 和 entry 版本，使用 Git SHA。

双平台插件如果同时面向 Codex marketplace 展示版本，则发布时仍要检查 Claude manifest、Codex manifest 和 marketplace entry 是否一致，避免一个平台显示旧版本。

不要在一个发布里误改其他插件版本。多插件 marketplace 中升级 `plugin-creator` 时，只改 `plugin-creator` entry，保持 `arkts-harmony` 等其他 entry 不变。

## 发布渠道

需要 stable / latest 两个渠道时，使用两个 marketplace 或两个 entry 指向不同 Git ref / sha。每个渠道解析出的版本必须不同：

- 使用显式版本时，不同 ref 上的 `plugin.json` 必须有不同 `version`。
- 省略版本时，不同 Git SHA 自然区分渠道。
- 如果两个渠道解析为同一个版本字符串，客户端可能认为无需更新。

## 组织和离线部署

Claude Code 的 managed settings 可以限制或预注册 marketplace：

- `strictKnownMarketplaces`：限制用户只能添加允许的 marketplace。
- `blockedMarketplaces`：阻止指定 marketplace。
- `extraKnownMarketplaces`：预注册团队 marketplace，通常和 `strictKnownMarketplaces` 配合使用。

容器或 CI 环境可以使用 `CLAUDE_CODE_PLUGIN_SEED_DIR` 预填充 marketplace 和 plugin cache，减少运行时克隆。这个机制适合离线或受控环境，不适合普通插件模板默认生成。

## CLI Plugin Hint

如果你维护 CLI 或 SDK，并且插件位于官方 Anthropic marketplace，可以在 CLI 检测到 `CLAUDECODE` 环境变量时向 `stderr` 输出：

```text
<claude-code-hint v="1" type="plugin" value="plugin-name@claude-plugins-official" />
```

限制：

- 只适用于官方 Anthropic marketplace。
- 必须单独一行。
- 用户仍需确认安装，Claude Code 不会自动安装。
- 普通个人或团队 marketplace 不应生成这个提示。
