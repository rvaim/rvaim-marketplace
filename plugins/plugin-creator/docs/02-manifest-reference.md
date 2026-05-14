# Manifest 参考

## Claude Code manifest

路径：

```text
<plugin>/.claude-plugin/plugin.json
```

最小示例：

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "中文描述。",
  "author": {
    "name": "Your Team"
  },
  "homepage": "https://github.com/owner/my-plugin",
  "repository": "https://github.com/owner/my-plugin",
  "keywords": [
    "plugin",
    "skill"
  ],
  "skills": "./skills/"
}
```

常用字段：

| 字段 | 说明 |
|---|---|
| `$schema` | 编辑器补全和校验提示；Claude Code 加载时会忽略。 |
| `name` | 必需，kebab-case，作为命名空间。 |
| `version` | 建议填写；发布更新时提升版本。 |
| `description` | 插件列表中显示的一句话说明。 |
| `author` | 作者或团队信息。 |
| `homepage` | 文档或项目主页。 |
| `repository` | 源代码仓库。 |
| `keywords` | 发现和分类标签。 |
| `skills` | 共享 skills 目录，通常为 `./skills/`。 |
| `mcpServers` | 只有确实捆绑 MCP server 配置时填写。 |
| `lspServers` | 只有确实捆绑 LSP server 配置时填写。 |
| `agents` / `commands` | 只有确实提供 Claude agent 或 command 时填写。 |
| `userConfig` | 需要安装时提示用户输入配置时填写。 |
| `dependencies` | 依赖其他插件时填写。 |
| `experimental.monitors` | 需要后台 monitor 时填写。 |

如需用户配置：

```json
{
  "userConfig": {
    "api_token": {
      "type": "string",
      "title": "API token",
      "description": "用于访问团队 API 的令牌。",
      "sensitive": true,
      "required": true
    }
  }
}
```

`userConfig` 适合 API endpoint、token、目录、文件路径等启用时必须由用户提供的值。敏感值使用 `sensitive: true`，不要要求用户手动编辑 token 到文档里。

如需 LSP server：

```json
{
  "lspServers": "./.lsp.json"
}
```

`.lsp.json` 放在插件根目录，声明语言服务器命令和文件扩展名映射。插件只配置如何连接语言服务器，不应假设用户已经安装二进制；README 或 skill 输出中必须写清前置安装要求。

如需 MCP server：

```json
{
  "mcpServers": "./.mcp.json"
}
```

`.mcp.json` 放在插件根目录。需要 token、endpoint 或本地路径时，优先通过 `userConfig` 注入，不要把用户私密配置写死到模板。

如需后台 monitor：

```json
{
  "experimental": {
    "monitors": "./monitors/monitors.json"
  }
}
```

monitor 会在插件激活时运行后台命令。只有插件确实需要持续观察日志、状态或外部事件时才生成，普通 skill 插件不要默认添加。

如需依赖其他插件：

```json
{
  "dependencies": [
    "helper-plugin",
    {
      "name": "secrets-vault",
      "version": "~2.1.0"
    }
  ]
}
```

依赖适合复用另一个插件提供的 skills、MCP servers 或运行时能力。能复制一小段说明解决的问题，不要引入插件依赖。

如需 Claude 插件默认设置：

```text
<plugin>/settings.json
```

`settings.json` 是插件根目录文件，可用于 Claude Code 支持的插件默认设置。只在确实需要启用默认 agent 或状态行等行为时创建；未知设置可能被忽略，不能把它当作通用配置仓库。

## Codex manifest

路径：

```text
<plugin>/.codex-plugin/plugin.json
```

最小示例：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "中文描述。",
  "author": {
    "name": "Your Team"
  },
  "homepage": "https://github.com/owner/my-plugin",
  "repository": "https://github.com/owner/my-plugin",
  "keywords": [
    "plugin",
    "skill"
  ],
  "skills": "./skills/",
  "interface": {
    "displayName": "我的插件",
    "shortDescription": "中文短描述。",
    "longDescription": "面向安装界面的详细说明。",
    "developerName": "Your Team",
    "category": "Development",
    "capabilities": [
      "Read",
      "Write"
    ],
    "websiteURL": "https://github.com/owner/my-plugin",
    "brandColor": "#2563EB",
    "defaultPrompt": [
      "使用我的插件完成指定工作。"
    ]
  }
}
```

Codex `interface` 常用字段：

| 字段 | 说明 |
|---|---|
| `displayName` | 插件目录中显示的名称。 |
| `shortDescription` | 列表页短描述。 |
| `longDescription` | 详情页长描述。 |
| `developerName` | 开发者名。 |
| `category` | 分类，例如 `Development`、`Productivity`。 |
| `capabilities` | 面向用户的能力提示，例如 `Read`、`Write`。 |
| `websiteURL` | 主页或文档。 |
| `privacyPolicyURL` / `termsOfServiceURL` | 只有真实页面存在时填写。 |
| `brandColor` | 品牌色，建议使用稳定十六进制颜色。 |
| `composerIcon` / `logo` / `screenshots` | 真实资产路径，通常放在 `./assets/`。 |
| `defaultPrompt` | 安装后可直接尝试的提示词数组。 |

如需 Codex app / connector 映射：

```json
{
  "apps": "./.app.json"
}
```

`.app.json` 只在插件确实绑定 app 或 connector 时创建。普通 instruction-only skill 插件不需要该文件，也不需要在 manifest 中声明 `apps`。

## Codex skill UI 元数据

Codex skills 可以在 skill 目录下添加：

```text
skills/<skill-name>/agents/openai.yaml
```

示例：

```yaml
interface:
  display_name: "插件创建器"
  short_description: "创建和审查双平台插件。"
  icon_small: "./assets/small-logo.svg"
  icon_large: "./assets/large-logo.png"
  brand_color: "#2563EB"
  default_prompt: "使用插件创建器创建一个双平台插件。"

policy:
  allow_implicit_invocation: false

dependencies:
  tools:
    - type: "mcp"
      value: "openaiDeveloperDocs"
      description: "OpenAI Docs MCP server"
      transport: "streamable_http"
      url: "https://developers.openai.com/mcp"
```

`agents/openai.yaml` 是 skill 级别的 Codex 元数据，不替代插件根目录 `.codex-plugin/plugin.json`。只有需要控制隐式调用、展示图标或声明工具依赖时才生成。

## 组件路径速查

| 组件 | 推荐位置 | manifest 字段 | 默认策略 |
|---|---|---|---|
| Skills | `./skills/` | `skills` | 默认生成。 |
| MCP servers | `./.mcp.json` | `mcpServers` | 按需生成。 |
| Codex apps | `./.app.json` | `apps` | 按需生成。 |
| LSP servers | `./.lsp.json` | `lspServers` | 按需生成，并说明外部二进制依赖。 |
| Claude monitors | `./monitors/monitors.json` | `experimental.monitors` | 按需生成。 |
| Claude settings | `./settings.json` | 根目录文件 | 按需生成，不写进 manifest。 |
| Codex skill metadata | `./skills/<skill>/agents/openai.yaml` | skill 内文件 | 按需生成。 |

## 双平台注意事项

- 两边 `name` 建议一致。
- `skills` 指向同一个 `./skills/`。
- 没有脚本时，不要创建 `bin/`。
- 所有路径字段相对于插件根目录，并以 `./` 开头。
- `skills`、`docs`、`templates` 位于插件根目录，不要放进 `.claude-plugin/` 或 `.codex-plugin/`。
- 配置字段要真实：没有 license 文件时不要写 license；没有公开隐私政策时不要写 privacy URL。
- `commands`、`agents`、`apps`、`mcpServers`、`lspServers`、`userConfig`、`dependencies`、`experimental.monitors` 只有真实存在时才声明。
- 需要安装时输入密钥或路径时优先用 `userConfig`，不要把用户配置硬编码进 MCP 或 LSP 命令。
- Codex 的 `agents/openai.yaml` 是 skill 元数据；Claude Code 不读取它，双平台插件仍需保证 `SKILL.md` 自身描述清楚。
