> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 通过市场发现和安装预构建插件

> 从市场发现和安装插件，以使用新 skills、agents 和功能扩展 Claude Code。

插件通过 skills、agents、hooks 和 MCP servers 扩展 Claude Code。插件市场是帮助您发现和安装这些扩展的目录，无需自己构建。

想要创建和分发自己的市场？请参阅[创建和分发插件市场](/zh-CN/plugin-marketplaces)。

## 市场如何工作

市场是他人创建和共享的插件目录。使用市场是一个两步过程：

<Steps>
  <Step title="添加市场">
    这会向 Claude Code 注册目录，以便您可以浏览可用内容。尚未安装任何插件。
  </Step>

  <Step title="安装单个插件">
    浏览目录并安装您想要的插件。
  </Step>
</Steps>

可以将其视为添加应用商店：添加商店让您可以访问浏览其集合，但您仍然需要单独选择要下载的应用。

## 官方 Anthropic 市场

官方 Anthropic 市场（`claude-plugins-official`）在您启动 Claude Code 时自动可用。运行 `/plugin` 并转到**发现**选项卡以浏览可用内容，或在 [claude.com/plugins](https://claude.com/plugins) 查看目录。

要从官方市场安装插件，请使用 `/plugin install <name>@claude-plugins-official`。例如，要安装 GitHub 集成：

```shell theme={null}
/plugin install github@claude-plugins-official
```

如果 Claude Code 报告在任何市场中找不到该插件，您的市场要么缺失，要么已过期。运行 `/plugin marketplace update claude-plugins-official` 以刷新它，或如果您之前未添加过，运行 `/plugin marketplace add anthropics/claude-plugins-official`。然后重试安装。

<Note>
  官方市场由 Anthropic 维护。要向官方市场提交插件，请使用应用内提交表单之一：

  * **Claude.ai**: [claude.ai/settings/plugins/submit](https://claude.ai/settings/plugins/submit)
  * **Console**: [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit)

  要独立分发插件，请[创建您自己的市场](/zh-CN/plugin-marketplaces)并与用户共享。
</Note>

官方市场包括多个插件类别：

### 代码智能

代码智能插件启用 Claude Code 的内置 LSP 工具，使 Claude 能够跳转到定义、查找引用并在编辑后立即查看类型错误。这些插件配置[语言服务器协议](https://microsoft.github.io/language-server-protocol/)连接，这是为 VS Code 代码智能提供支持的相同技术。

这些插件需要在您的系统上安装语言服务器二进制文件。如果您已经安装了语言服务器，当您打开项目时，Claude 可能会提示您安装相应的插件。

| 语言         | 插件                  | 所需二进制文件                      |
| :--------- | :------------------ | :--------------------------- |
| C/C++      | `clangd-lsp`        | `clangd`                     |
| C#         | `csharp-lsp`        | `csharp-ls`                  |
| Go         | `gopls-lsp`         | `gopls`                      |
| Java       | `jdtls-lsp`         | `jdtls`                      |
| Kotlin     | `kotlin-lsp`        | `kotlin-language-server`     |
| Lua        | `lua-lsp`           | `lua-language-server`        |
| PHP        | `php-lsp`           | `intelephense`               |
| Python     | `pyright-lsp`       | `pyright-langserver`         |
| Rust       | `rust-analyzer-lsp` | `rust-analyzer`              |
| Swift      | `swift-lsp`         | `sourcekit-lsp`              |
| TypeScript | `typescript-lsp`    | `typescript-language-server` |

您也可以[为其他语言创建自己的 LSP 插件](/zh-CN/plugins-reference#lsp-servers)。

<Note>
  如果在安装插件后在 `/plugin` 错误选项卡中看到 `Executable not found in $PATH`，请从上表安装所需的二进制文件。
</Note>

#### Claude 从代码智能插件获得的功能

安装代码智能插件并且其语言服务器二进制文件可用后，Claude 获得两项功能：

* **自动诊断**：在 Claude 进行的每次文件编辑后，语言服务器分析更改并自动报告错误和警告。Claude 看到类型错误、缺失导入和语法问题，无需运行编译器或 linter。如果 Claude 引入错误，它会注意到并在同一轮中修复问题。这不需要除安装插件外的任何配置。当"发现诊断"指示器出现时，您可以按 **Ctrl+O** 来内联查看诊断。
* **代码导航**：Claude 可以使用语言服务器跳转到定义、查找引用、获取悬停时的类型信息、列出符号、查找实现和追踪调用层次结构。这些操作为 Claude 提供比基于 grep 的搜索更精确的导航，尽管可用性可能因语言和环境而异。

如果遇到问题，请参阅[代码智能故障排除](#code-intelligence-issues)。

### 外部集成

这些插件捆绑预配置的 [MCP servers](/zh-CN/mcp)，以便您可以连接 Claude 到外部服务，无需手动设置：

* **源代码控制**：`github`、`gitlab`
* **项目管理**：`atlassian`（Jira/Confluence）、`asana`、`linear`、`notion`
* **设计**：`figma`
* **基础设施**：`vercel`、`firebase`、`supabase`
* **通信**：`slack`
* **监控**：`sentry`

### 开发工作流

为常见开发任务添加 skills 和 agents 的插件：

* **commit-commands**：Git 提交工作流，包括提交、推送和 PR 创建
* **pr-review-toolkit**：用于审查拉取请求的专门 agents
* **agent-sdk-dev**：使用 Claude Agent SDK 构建的工具
* **plugin-dev**：用于创建您自己的插件的工具包

### 输出样式

自定义 Claude 的响应方式：

* **explanatory-output-style**：关于实现选择的教育见解
* **learning-output-style**：用于技能构建的交互式学习模式

## 尝试：添加演示市场

Anthropic 还维护一个[演示插件市场](https://github.com/anthropics/claude-code/tree/main/plugins)（`claude-code-plugins`），其中包含展示插件系统可能性的示例插件。与官方市场不同，您需要手动添加此市场。

<Steps>
  <Step title="添加市场">
    在 Claude Code 中，为 `anthropics/claude-code` 市场运行 `plugin marketplace add` 命令：

    ```shell theme={null}
    /plugin marketplace add anthropics/claude-code
    ```

    这会下载市场目录并使其插件对您可用。
  </Step>

  <Step title="浏览可用插件">
    运行 `/plugin` 打开插件管理器。这会打开一个选项卡式界面，有四个选项卡，您可以使用 **Tab** 循环切换（或使用 **Shift+Tab** 向后切换）：

    * **发现**：从所有市场浏览可用插件
    * **已安装**：查看和管理已安装的插件
    * **市场**：添加、删除或更新已添加的市场
    * **错误**：查看任何插件加载错误

    转到**发现**选项卡以查看您刚添加的市场中的插件。
  </Step>

  <Step title="安装插件">
    选择一个插件以查看其详细信息，然后选择安装范围：

    * **用户范围**：在所有项目中为自己安装
    * **项目范围**：为此存储库上的所有协作者安装
    * **本地范围**：仅在此存储库中为自己安装

    例如，选择 **commit-commands**（添加 git 工作流 skills 的插件）并将其安装到您的用户范围。

    您也可以从命令行直接安装：

    ```shell theme={null}
    /plugin install commit-commands@anthropics-claude-code
    ```

    请参阅[配置范围](/zh-CN/settings#configuration-scopes)以了解有关范围的更多信息。
  </Step>

  <Step title="使用您的新插件">
    安装后，运行 `/reload-plugins` 以激活插件。插件 skills 由插件名称命名空间，因此 **commit-commands** 提供诸如 `/commit-commands:commit` 之类的 skills。

    通过对文件进行更改并运行来尝试：

    ```shell theme={null}
    /commit-commands:commit
    ```

    这会暂存您的更改、生成提交消息并创建提交。

    每个插件的工作方式不同。检查**发现**选项卡中的插件描述或其主页以了解它提供的 skills 和功能。
  </Step>
</Steps>

本指南的其余部分涵盖了添加市场、安装插件和管理配置的所有方式。

## 添加市场

使用 `/plugin marketplace add` 命令从不同来源添加市场。

<Tip>
  **快捷方式**：您可以使用 `/plugin market` 代替 `/plugin marketplace`，以及使用 `rm` 代替 `remove`。
</Tip>

* **GitHub 存储库**：`owner/repo` 格式（例如，`anthropics/claude-code`）
* **Git URL**：任何 git 存储库 URL（GitLab、Bitbucket、自托管）
* **本地路径**：目录或 `marketplace.json` 文件的直接路径
* **远程 URL**：托管 `marketplace.json` 文件的直接 URL

### 从 GitHub 添加

使用 `owner/repo` 格式添加包含 `.claude-plugin/marketplace.json` 文件的 GitHub 存储库，其中 `owner` 是 GitHub 用户名或组织，`repo` 是存储库名称。

例如，`anthropics/claude-code` 指的是由 `anthropics` 拥有的 `claude-code` 存储库：

```shell theme={null}
/plugin marketplace add anthropics/claude-code
```

### 从其他 Git 主机添加

通过提供完整 URL 添加任何 git 存储库。这适用于任何 Git 主机，包括 GitLab、Bitbucket 和自托管服务器。包括 `.git` 后缀，以便 Claude Code 克隆存储库，而不是将 URL 视为托管 `marketplace.json` 文件的直接链接。

使用 HTTPS：

```shell theme={null}
/plugin marketplace add https://gitlab.com/company/plugins.git
```

使用 SSH：

```shell theme={null}
/plugin marketplace add git@gitlab.com:company/plugins.git
```

要添加特定分支或标签，请在 `#` 后附加 ref：

```shell theme={null}
/plugin marketplace add https://gitlab.com/company/plugins.git#v1.0.0
```

### 从本地路径添加

添加包含 `.claude-plugin/marketplace.json` 文件的本地目录：

```shell theme={null}
/plugin marketplace add ./my-marketplace
```

您也可以添加 `marketplace.json` 文件的直接路径：

```shell theme={null}
/plugin marketplace add ./path/to/marketplace.json
```

### 从远程 URL 添加

通过 URL 添加远程 `marketplace.json` 文件：

```shell theme={null}
/plugin marketplace add https://example.com/marketplace.json
```

<Note>
  与基于 Git 的市场相比，基于 URL 的市场有一些限制。如果在安装插件时遇到"路径未找到"错误，请参阅[故障排除](/zh-CN/plugin-marketplaces#plugins-with-relative-paths-fail-in-url-based-marketplaces)。
</Note>

## 安装插件

添加市场后，您可以直接安装插件（默认安装到用户范围）：

```shell theme={null}
/plugin install plugin-name@marketplace-name
```

要选择不同的[安装范围](/zh-CN/settings#configuration-scopes)，请使用交互式 UI：运行 `/plugin`，转到**发现**选项卡，然后在插件上按 **Enter**。您将看到以下选项：

* **用户范围**（默认）：在所有项目中为自己安装
* **项目范围**：为此存储库上的所有协作者安装（添加到 `.claude/settings.json`）
* **本地范围**：仅在此存储库中为自己安装（不与协作者共享）

您也可能看到具有**托管**范围的插件——这些由管理员通过[托管设置](/zh-CN/settings#settings-files)安装，无法修改。

<Warning>
  在安装插件之前，请确保您信任该插件。Anthropic 不控制插件中包含的 MCP servers、文件或其他软件，也无法验证它们是否按预期工作。检查每个插件的主页以获取更多信息。
</Warning>

## 管理已安装的插件

运行 `/plugin` 并转到**已安装**选项卡以查看、启用、禁用或卸载您的插件。该列表按范围分组并排序，以便您首先看到问题：具有加载错误或未解决依赖项的插件出现在顶部，然后是您的收藏夹，禁用的插件折叠在底部的折叠标题后面。

从列表中您可以：

* 按 `f` 以收藏或取消收藏选定的插件
* 输入以按插件名称或描述筛选
* 按 Enter 打开插件的详细视图并启用、禁用或卸载它

当您安装声明依赖项的插件时，安装输出会列出哪些依赖项与其一起自动安装。

您也可以使用直接命令管理插件。

禁用插件而不卸载：

```shell theme={null}
/plugin disable plugin-name@marketplace-name
```

重新启用已禁用的插件：

```shell theme={null}
/plugin enable plugin-name@marketplace-name
```

完全删除插件：

```shell theme={null}
/plugin uninstall plugin-name@marketplace-name
```

`--scope` 选项允许您使用 CLI 命令针对特定范围：

```shell theme={null}
claude plugin install formatter@your-org --scope project
claude plugin uninstall formatter@your-org --scope project
```

### 应用插件更改而不重启

当您在会话期间安装、启用或禁用插件时，运行 `/reload-plugins` 以在不重启的情况下获取所有更改：

```shell theme={null}
/reload-plugins
```

Claude Code 重新加载所有活跃插件，并显示插件、skills、agents、hooks、插件 MCP servers 和插件 LSP servers 的计数。

## 管理市场

您可以通过交互式 `/plugin` 界面或 CLI 命令管理市场。

### 使用交互式界面

运行 `/plugin` 并转到**市场**选项卡以：

* 查看所有已添加的市场及其来源和状态
* 添加新市场
* 更新市场列表以获取最新插件
* 删除您不再需要的市场

### 使用 CLI 命令

您也可以使用直接命令管理市场。

列出所有配置的市场：

```shell theme={null}
/plugin marketplace list
```

刷新市场的插件列表：

```shell theme={null}
/plugin marketplace update marketplace-name
```

删除市场：

```shell theme={null}
/plugin marketplace remove marketplace-name
```

<Warning>
  删除市场将卸载您从中安装的任何插件。
</Warning>

### 配置自动更新

Claude Code 可以在启动时自动更新市场及其已安装的插件。为市场启用自动更新后，Claude Code 会刷新市场数据并将已安装的插件更新到最新版本。如果任何插件已更新，您将看到提示您运行 `/reload-plugins` 的通知。

通过 UI 为单个市场切换自动更新：

1. 运行 `/plugin` 打开插件管理器
2. 选择**市场**
3. 从列表中选择市场
4. 选择**启用自动更新**或**禁用自动更新**

官方 Anthropic 市场默认启用自动更新。第三方和本地开发市场默认禁用自动更新。

要完全禁用 Claude Code 和所有插件的所有自动更新，请设置 `DISABLE_AUTOUPDATER` 环境变量。有关详细信息，请参阅[自动更新](/zh-CN/setup#auto-updates)。

要在禁用 Claude Code 自动更新的同时保持插件自动更新启用，请设置 `FORCE_AUTOUPDATE_PLUGINS=1` 以及 `DISABLE_AUTOUPDATER`：

```bash theme={null}
export DISABLE_AUTOUPDATER=1
export FORCE_AUTOUPDATE_PLUGINS=1
```

当您想手动管理 Claude Code 更新但仍接收自动插件更新时，这很有用。

## 配置团队市场

团队管理员可以通过将市场配置添加到 `.claude/settings.json` 来为项目设置自动市场安装。当团队成员信任存储库文件夹时，Claude Code 会提示他们安装这些市场和插件。

将 `extraKnownMarketplaces` 添加到您项目的 `.claude/settings.json`：

```json theme={null}
{
  "extraKnownMarketplaces": {
    "my-team-tools": {
      "source": {
        "source": "github",
        "repo": "your-org/claude-plugins"
      }
    }
  }
}
```

有关完整配置选项（包括 `extraKnownMarketplaces` 和 `enabledPlugins`），请参阅[插件设置](/zh-CN/settings#plugin-settings)。

## 安全性

插件和市场是高度受信任的组件，可以使用您的用户权限在您的机器上执行任意代码。仅从您信任的来源安装插件和添加市场。组织可以使用[托管市场限制](/zh-CN/plugin-marketplaces#managed-marketplace-restrictions)限制用户允许添加的市场。

## 故障排除

### /plugin 命令无法识别

如果您看到"未知命令"或 `/plugin` 命令未出现：

1. **检查您的版本**：运行 `claude --version` 以查看安装的内容。
2. **更新 Claude Code**：
   * **Homebrew**：`brew upgrade claude-code`（或如果您安装了该 cask，则为 `brew upgrade claude-code@latest`）
   * **npm**：`npm install -g @anthropic-ai/claude-code@latest`
   * **本地安装程序**：从[设置](/zh-CN/setup)重新运行安装命令
3. **重启 Claude Code**：更新后，重启您的终端并再次运行 `claude`。

### 常见问题

* **市场未加载**：验证 URL 是否可访问以及 `.claude-plugin/marketplace.json` 是否存在于该路径
* **插件安装失败**：检查插件源 URL 是否可访问以及存储库是否公开（或您有访问权限）
* **安装后找不到文件**：插件被复制到缓存，因此引用插件目录外文件的路径将不起作用
* **插件 skills 未出现**：使用 `rm -rf ~/.claude/plugins/cache` 清除缓存，重启 Claude Code，然后重新安装插件。

有关详细的故障排除和解决方案，请参阅市场指南中的[故障排除](/zh-CN/plugin-marketplaces#troubleshooting)。有关调试工具，请参阅[调试和开发工具](/zh-CN/plugins-reference#debugging-and-development-tools)。

### 代码智能问题

* **语言服务器未启动**：验证二进制文件已安装且在您的 `$PATH` 中可用。检查 `/plugin` 错误选项卡以获取详细信息。
* **高内存使用**：`rust-analyzer` 和 `pyright` 等语言服务器在大型项目上可能消耗大量内存。如果您遇到内存问题，请使用 `/plugin disable <plugin-name>` 禁用插件，并改为依赖 Claude 的内置搜索工具。
* **monorepos 中的误报诊断**：如果工作区配置不正确，语言服务器可能会报告内部包的未解析导入错误。这些不会影响 Claude 编辑代码的能力。

## 后续步骤

* **构建您自己的插件**：请参阅[插件](/zh-CN/plugins)以创建 skills、agents 和 hooks
* **创建市场**：请参阅[创建插件市场](/zh-CN/plugin-marketplaces)以将插件分发给您的团队或社区
* **技术参考**：请参阅[插件参考](/zh-CN/plugins-reference)以获取完整规范
