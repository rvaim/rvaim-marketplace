> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 从您的 CLI 推荐您的插件

> 从您的 CLI 发出一行标记，以便 Claude Code 提示用户安装您的官方插件。

如果您维护 CLI 或 SDK，并在官方 Anthropic 市场中拥有插件，您的工具可以提示 Claude Code 用户安装该插件。当您的 CLI 检测到它在 Claude Code 内运行时，会向 stderr 写入一行标记。Claude Code 读取该标记，将其从输出中删除，并向用户显示一次性安装提示。

Claude Code 在将命令输出发送给模型之前会从命令输出中删除提示行，因此标记永远不会出现在对话中，也不会计入令牌使用量。该协议不需要额外命令，也不会改变您的 CLI 为 Claude Code 外部用户打印的内容。

本页面适用于 CLI 和 SDK 维护者。如果您正在寻找安装插件，请参阅[发现和安装插件](/zh-CN/discover-plugins)。

## 工作原理

Claude Code 为通过 Bash 和 PowerShell 工具运行的每个命令设置 [`CLAUDECODE`](/zh-CN/env-vars) 环境变量为 `1`。当您的 CLI 看到该变量时，它会向 stderr 写入一个自闭合的 `<claude-code-hint />` 标签。

当 Claude Code 接收到命令输出时，它会：

1. 扫描提示行并在输出到达模型之前将其删除
2. 检查提示是否针对官方 Anthropic 市场中的插件
3. 检查插件是否尚未安装且之前未提示过
4. 向用户显示安装提示，其中包含发出提示的命令的名称

Claude Code 永远不会自动安装插件。用户始终需要确认。

## 发出提示

在 `CLAUDECODE` 环境变量上进行门控，以便标记永远不会出现在人类用户的终端中。然后将标签写入 stderr，单独占一行。

以下示例为官方市场中名为 `example-cli` 的插件发出提示：

<CodeGroup>
  ```javascript Node.js theme={null}
  if (process.env.CLAUDECODE) {
    process.stderr.write(
      '<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />\n',
    )
  }
  ```

  ```python Python theme={null}
  import os, sys

  if os.environ.get("CLAUDECODE"):
      print(
          '<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />',
          file=sys.stderr,
      )
  ```

  ```go Go theme={null}
  if os.Getenv("CLAUDECODE") != "" {
      fmt.Fprintln(os.Stderr,
          `<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />`)
  }
  ```

  ```shell Shell theme={null}
  [ -n "$CLAUDECODE" ] &&
    printf '%s\n' '<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />' >&2
  ```
</CodeGroup>

将 `example-cli` 替换为您在官方市场中的插件名称。

## 选择发出位置

您可以控制哪些代码路径发出提示。Claude Code 按插件进行去重，因此在每次调用时发出提示没有缺点。效果良好的接触点包括：

| 位置          | 为什么有效                      |
| :---------- | :------------------------- |
| `--help` 输出 | Claude 在探索不熟悉的 CLI 时经常运行帮助 |
| 未知子命令错误     | 到达 Claude 对您的界面感到困惑的时刻     |
| 登录或身份验证成功   | 用户已经处于设置心态                 |
| 首次运行欢迎消息    | 自然的入门时刻                    |

## 用户看到的内容

当提示通过所有检查时，Claude Code 会显示如下提示：

```text theme={null}
─────────────────────────────────────────────────────────────
  Plugin Recommendation

    The example-cli command suggests installing a plugin.

    Plugin: example-cli
    Marketplace: claude-plugins-official
    Official integration for example-cli deployments

    Would you like to install it?
    ❯ 1. Yes, install example-cli
      2. No
      3. No, and don't show plugin installation hints again

─────────────────────────────────────────────────────────────
```

提示会显示生成提示的命令的名称，以便用户可以发现工具与其推荐的插件之间的不匹配。如果用户在 30 秒内没有响应，提示会作为**否**关闭。

提示频率受限：

* **每个插件一次**：显示提示后，Claude Code 会记录该插件，无论用户的答案如何，都不会再次提示该插件。
* **每个会话一次**：在机器上的所有 CLI 中，每个 Claude Code 会话最多出现一个提示。

选择**是**会将插件安装到用户范围。选择**否，不再显示插件安装提示**会禁用用户的所有未来提示。

## 提示格式

提示是一个具有三个必需属性的自闭合标签。

```text theme={null}
<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />
```

| 属性      | 必需 | 描述                          |
| :------ | :- | :-------------------------- |
| `v`     | 是  | 协议版本。`1` 是唯一支持的值            |
| `type`  | 是  | 提示类型。`plugin` 是唯一支持的值       |
| `value` | 是  | `name@marketplace` 形式的插件标识符 |

属性值可以用双引号引用或不引用。未引用的值不能包含空格。不支持转义序列。

## 要求

Claude Code 在对提示进行操作之前强制执行两个条件。未通过任一检查的提示将被丢弃：

* **单独一行**：标签必须占据自己的一行。嵌入在行中间的标签，例如在日志语句内，会被忽略。允许行前后有空格。
* **官方市场**：`value` 必须引用 Anthropic 控制的市场中的插件，例如 `claude-plugins-official`。指向其他市场的提示会被静默丢弃。

提示行始终在到达模型之前从输出中删除，即使版本或类型无法识别，因此标记永远不会计入令牌使用量。

其余指导是推荐的但不强制的。Claude Code 无法观察您的 CLI 是否遵循它：

* **写入 stderr**：stderr 将标签保留在 shell 管道之外，例如 `example-cli deploy | jq`。Claude Code 扫描两个流，因此 stdout 也可以工作。
* **在 `CLAUDECODE` 上进行门控**：仅在设置 `CLAUDECODE` 环境变量时发出。这可以防止标记出现在直接运行您的 CLI 的用户面前。

## 将您的插件放入官方市场

提示协议仅对在官方 Anthropic 市场中列出的插件生效。要提交插件，请使用应用内提交表单之一：

* **Claude.ai**：[claude.ai/settings/plugins/submit](https://claude.ai/settings/plugins/submit)
* **Console**：[platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit)

如果您正在与 Anthropic 合作伙伴联系合作，请与他们联系以协调列表。

## 另请参阅

* [创建插件](/zh-CN/plugins)：构建您的 CLI 推荐的插件
* [创建和分发插件市场](/zh-CN/plugin-marketplaces)：在官方市场外托管插件
* [环境变量](/zh-CN/env-vars)：`CLAUDECODE` 和相关变量的完整参考
