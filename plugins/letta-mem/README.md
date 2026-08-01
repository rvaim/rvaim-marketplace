# letta-mem

`letta-mem` 是面向 Claude Code 与 Codex 的本地持久记忆插件。它监听编码对话，把新增的可见内容交给本机或自托管 Letta Agent 在后台整理，并在后续对话中自动注入相关上下文。

插件精确使用 `@letta-ai/letta-agent-sdk@0.6.0`。它不直接依赖旧版 Letta SDK，不调用旧版 `/v1` blocks、passages 或 archives 接口，不依赖 Letta Cloud，也不直接调用 DeepSeek 等模型供应商 API。

## 核心行为

- 使用新版 Letta Agent、Conversation、Session 与 MemFS 能力维护用户偏好、工作区事实、已确认决策和未完成事项。
- 默认每个工作区使用一个独立 Agent；一个工作区可以包含多个文件夹，只要宿主 Hook 提供的 `cwd` 是同一个工作区主目录，就会复用同一 Agent。
- 默认启用共享记忆：专用共享 Agent 根据语义自行判断哪些稳定偏好、通用编码规范和可复用经验适合跨工作区保存；项目事实、项目决定和本地待办仍留在工作区 Agent。
- 可开启混合记忆，让所有工作区及 Claude Code、Codex 两个宿主共同复用一个名为 `letta-mem` 的 Agent。
- 新建或实质修改的记忆跟随产生事实的用户消息语言：中文保存中文、英文保存英文，其他语言同理。
- 模型和供应商凭据由 Letta 管理。插件只把模型句柄交给 Letta，不读取或传递供应商 API key。
- Letta 未启动、断线、超时、鉴权失败、配置错误或模型不可用时，Hook 都故障开放并以成功状态结束，不阻塞 Claude Code 或 Codex。

## 前置条件

- Claude Code 或支持插件生命周期 Hook 的 Codex。
- `node >= 22.19.0` 和配套的 `npm` 位于宿主进程的 `PATH` 中。
- 一个可连接的新版 Letta App Server；默认地址是 `http://127.0.0.1:4500`。
- Letta 中至少配置了一个可用模型供应商。

可以安装与 Agent SDK `0.6.0` 配套的 Letta CLI：

```bash
npm install -g @letta-ai/letta-code@0.30.0
```

以 DeepSeek 为例，供应商凭据只配置给 Letta：

```bash
letta --backend local connect deepseek
letta server --backend local --listen ws://127.0.0.1:4500
```

Letta App 界面显示 `Local` 只表示 App 使用本地数据，不等于 App Server 已监听。使用插件时需要保持 `letta server` 进程运行。

## 唯一持久配置源

Claude Code 与 Codex 都读取：

```text
~/.letta-mem/config.json
```

插件不声明 Claude Code `userConfig`，也不会维护两份需要同步的配置。建议创建私有目录和配置文件：

```bash
mkdir -p ~/.letta-mem
chmod 700 ~/.letta-mem
```

默认配置等价于：

```json
{
  "serverUrl": "http://127.0.0.1:4500",
  "model": "auto",
  "mixedMemory": false,
  "sharedMemory": true
}
```

配置项：

| 字段 | 默认值 | 用途 |
|---|---|---|
| `serverUrl` | `http://127.0.0.1:4500` | 本机或自托管 App Server 基地址；支持 `http(s)`，也接受并规范化 `ws(s)` 和标准 `/ws` 后缀。 |
| `model` | `auto` | Letta Agent 使用的默认模型。`auto` 表示由 Letta 根据自身配置选择；也可填写 Letta 模型句柄。 |
| `mixedMemory` | `false` | `false` 为每个工作区独立 Agent；`true` 为所有工作区共享 `letta-mem` Agent。 |
| `sharedMemory` | `true` | 是否启用 Agent 自主共享判断。默认模式下会同时使用工作区 Agent 与专用共享 Agent；关闭后只维护工作区独立记忆。 |

指定已在 Letta 中可用的 DeepSeek 模型示例：

```json
{
  "serverUrl": "http://127.0.0.1:4500",
  "model": "deepseek/deepseek-v4-flash",
  "mixedMemory": false,
  "sharedMemory": true
}
```

修改文件后，从下一次 Hook 调用开始生效。模型变化时，插件通过新版 Agent SDK 更新现有 Agent，并为各本地会话创建使用新默认模型的 Conversation；Agent 的 MemFS 记忆不会被删除。`model` 不影响本地状态命名空间，因此不会因为切换模型丢失 Agent 映射。

`mixedMemory` 会切换到独立状态命名空间。开启后，所有工作区共享 Letta Agent 与 MemFS，但 Conversation、转录游标、待处理队列和可注入上下文快照仍按工作区与宿主会话隔离。关闭后会恢复原先的每工作区映射，不会把两种模式的本地状态混在一起。

`sharedMemory` 不切换本地状态命名空间。开关它不会丢失工作区 Agent 映射；重新开启后会继续复用 Letta 服务器上带有共享作用域标签的 Agent。模型变化会同时更新工作区 Agent 和共享 Agent。

### 临时和部署覆盖

环境变量只作为运行时覆盖，不会写回配置文件：

| 环境变量 | 用途 |
|---|---|
| `LETTA_MEM_CONFIG_PATH` | 覆盖共享配置文件路径。 |
| `LETTA_APP_SERVER_URL` | 临时覆盖 `serverUrl`。 |
| `LETTA_APP_SERVER_TOKEN` | App Server 可选能力令牌；不写入 JSON。 |
| `LETTA_MEM_MODEL` | 临时覆盖 `model`。 |
| `LETTA_MEM_MIXED_MEMORY` | 临时覆盖 `mixedMemory`，接受 `true`、`false`、`1`、`0`。 |
| `LETTA_MEM_SHARED_MEMORY` | 临时覆盖 `sharedMemory`，接受 `true`、`false`、`1`、`0`。 |
| `LETTA_MEM_DATA_DIR` | 仅用于开发；宿主未提供插件数据目录时覆盖运行状态目录。 |
| `LETTA_MEM_DISABLED=1` | 临时停用记忆功能但不卸载插件。 |
| `LETTA_MEM_REQUEST_TIMEOUT_MS` | 覆盖 Letta 请求超时。 |
| `LETTA_MEM_MAX_CONTEXT_CHARS` | 覆盖单次注入的最大字符数。 |
| `LETTA_MEM_MAX_BATCH_CHARS` | 覆盖单次后台更新批次的最大字符数。 |

配置优先级是“环境变量 > `~/.letta-mem/config.json` > 默认值”。能力令牌建议通过进程环境或系统服务环境注入，避免写进普通 JSON 文件。

## Agent 与工作区规则

### 默认模式与共享记忆

`mixedMemory=false` 时，Agent 名称为：

```text
letta-mem · <工作区主目录名> · <工作区指纹>
```

工作区身份由 Hook 的 `cwd` 规范化成真实绝对路径，不向上查找 Git 根目录，也不会因为对话访问工作区内的第二个文件夹而新建 Agent。不同工作区主目录使用不同 Agent。

`sharedMemory=true` 时还会复用一个名称精确为以下内容的共享 Agent：

```text
letta-mem · shared
```

每个转录批次先发送给共享 Agent。它根据内容语义自行判断作用域，只把跨工作区仍成立的稳定用户偏好、通用编码或安全规范、工具习惯和可复用经验写入共享 MemFS；工作区路径、项目架构、项目专属决定、本地待办和临时问题不会进入共享记忆。共享 Agent 返回的相关上下文随后作为候选上下文交给工作区 Agent，工作区 Agent 维护项目独立记忆并避免重复保存纯共享信息。

Claude Code 与 Codex 以及不同工作区都通过服务器端名称和 `letta-mem-memory-scope:shared-v1` 标签复用同一个共享 Agent。每个宿主会话仍拥有独立的共享 Agent Conversation，因此转录游标和会话恢复不会互相覆盖。

`sharedMemory=false` 时不创建或调用共享 Agent，只保留每工作区独立记忆。

当前 `@letta-ai/letta-agent-sdk@0.6.0` 的 App Server 管理接口没有提供独立共享 Block 的完整创建、挂载与更新生命周期。为保持只使用新版 SDK、支持本地 App Server，并避免恢复旧 `/v1/blocks` REST 代码，插件使用专用共享 Agent 与 MemFS 实现跨工作区记忆。作用域判断由 Letta Agent 完成，插件只负责调用顺序、隔离和上下文传递。

### 混合记忆模式

`mixedMemory=true` 时，所有工作区使用一个名称精确为 `letta-mem` 的 Agent。发送给 Letta 的每个批次都包含来源 `workspace_path`；后台提示要求在可能混淆时保留来源，不得把其他工作区事实误当作当前工作区事实。

混合模式本身已让所有内容位于同一个 Agent 与 MemFS，因此即使 `sharedMemory=true` 也不会再创建第二个共享 Agent。此时由混合 Agent 在同一 MemFS 中自行区分跨工作区共享原则和带 `workspace_path` 的独立事实。若需要物理隔离的工作区记忆，应保持 `mixedMemory=false`。

Agent 的发现依赖 Letta 服务器上的插件与作用域标签，不依赖 Claude Code 或 Codex 各自的本地安装实例。因此两个宿主连接同一个 App Server 时，会复用同一个对应 Agent。

### 记忆语言

- 判断语言时只参考用户消息，不跟随助手、系统摘要、工具结果或 Letta 模型的默认语言。
- 用户用简体中文表达的事实保存为简体中文；英文事实保存为英文；其他语言使用对应语言。
- 混合语言消息使用用户的主要叙述语言，代码标识符、库名、API 名、路径和命令保持原样。
- 切换对话语言不会批量翻译无关的既有记忆。

## 安装

### Claude Code

```bash
claude plugin marketplace add rvaim/rvaim-marketplace
claude plugin install letta-mem@rvaim-marketplace
```

安装后启动新会话。`SessionStart` 和 `Stop` Hook 会快速落盘任务并启动后台工作进程来准备运行时和更新记忆；`UserPromptSubmit` 只读取本地缓存，不等待网络。

### Codex

```bash
codex plugin marketplace add rvaim/rvaim-marketplace
codex plugin add letta-mem@rvaim-marketplace
```

Codex 安装后需要在 `/hooks` 中审查并信任插件 Hook。Hook 功能使用规范配置键：

```toml
[features]
hooks = true
```

Codex 当前不执行异步命令 Hook，因此插件的 `Stop` Hook 只同步落盘待处理项，然后启动脱离前台的本地工作进程；Letta 请求不会阻塞正常对话。

## 数据流

| 事件 | 行为 |
|---|---|
| `SessionStart` | 初始化或恢复本地会话状态，并在后台准备 Agent SDK 运行时和恢复持久队列。 |
| `UserPromptSubmit` | 只读取本地上下文快照，把当前会话尚未接收的新版本作为 `additionalContext` 注入；不请求 Letta。 |
| `Stop` | 先原子写入待处理项，再由后台进程读取转录增量；共享功能开启时先让共享 Agent 判断并更新共享 MemFS，再让工作区 Agent 更新独立 MemFS，最后保存下一轮上下文。 |

Claude Code 转录会过滤隐藏思考并截断工具输出。Codex 转录只采集原始 `user_message` 和 `final_answer`，忽略中间推理与进度消息；如果最终回答尚未写入转录，则使用 `Stop` 提供的回退文本并通过内容指纹去重。

待处理队列按工作区和会话排序并持久化。崩溃、超时、依赖安装或并发占锁时不会丢弃队列；后续 `Stop` 或 `SessionStart` 会继续处理。单批过大时按最早未处理记录分段提交。

## 运行时与本地状态

插件优先复用安装目录中精确版本的 Agent SDK。宿主未准备依赖时，引导器会使用锁文件把生产依赖安装到宿主提供的可写插件数据目录；安装时禁用依赖生命周期脚本。

运行状态位于 `${CLAUDE_PLUGIN_DATA}` 或 `${PLUGIN_DATA}`，包括：

```text
runtime/<generation>/
state/<server-and-mode-namespace>/
├── agents/
├── sessions/
├── contexts/
├── pending/
└── locks/
logs/
├── letta-mem.log
└── letta-mem.log.1
```

Claude Code 与 Codex 的本地数据目录彼此独立，但会通过 Letta 标签复用服务器端工作区 Agent、混合 Agent 和共享 Agent。状态目录和日志目录使用 `0700`，文件使用 `0600`。更换 App Server 地址或能力令牌会使用独立命名空间，令牌只参与哈希，不写入名称和状态内容。

## 隐私与安全

插件只向 `serverUrl` 指定的 App Server 发送数据。发送内容可能包括用户和助手的可见文本、经过截断的工具摘要、工作区主目录路径和会话标识；不会采集隐藏推理。默认共享模式下，同一转录批次会依次发送给同一 App Server 上的共享 Agent 和工作区 Agent。插件自身不连接 Letta Cloud，也不直接调用模型供应商 API；Letta Server 会按用户配置的供应商处理 Agent 请求。

后台 Agent 只允许使用 `memory` 与 `memory_apply_patch`，不获得工程读写或网络工具。转录被明确标记为不可信数据。用户若把密钥直接粘贴到可见对话，仍可能进入待处理内容，因此不应在编码对话中提供不必要的凭据。

## 故障开放与排查

| 现象 | 检查方向 |
|---|---|
| 首轮没有记忆 | Agent 在第一次可处理的 `Stop` 后才创建，下一轮才可能注入。 |
| Letta App 中没有 Agent | 确认 `letta server` 正在监听，并完成至少一轮对话。 |
| Letta 报告无可用模型 | 在 Letta 中配置供应商；`model=auto` 由 Letta 选择，显式模型必须使用 Letta 可用句柄。 |
| Codex 没有运行 Hook | 打开 `/hooks` 审查并信任插件 Hook，确认 `[features].hooks=true`。 |
| 日志提示 Node 版本过低 | 将宿主可见的 `node` 升级到 `22.19.0` 或更高版本。 |
| 宿主正常但没有记忆更新 | 这是故障开放行为；检查 App Server、配置和宿主插件数据目录下的 `logs/letta-mem.log`。 |

## 开发与验证

```bash
cd plugins/letta-mem
npm ci
npm run verify
claude plugin validate --strict .
```

测试覆盖共享配置、共享 Agent 自主作用域判断、跨宿主复用、模型迁移、混合与工作区模式、Claude Code 和 Codex 转录、队列、会话恢复、上下文注入与故障开放。业务源码不直接声明或导入旧版 SDK；`@letta-ai/letta-agent-sdk` 的内部传递依赖由 Letta 官方包管理。

## 上游与许可

本插件基于 [Letta `claude-subconscious`](https://github.com/letta-ai/claude-subconscious) 的核心产品思路重新实现。新版架构没有保留上游旧 SDK、Cloud、raw REST、`.af` 导入或旧版兼容代码。

项目使用 MIT License。上游归属见 [NOTICE.md](NOTICE.md)，完整条款见 [LICENSE](LICENSE)。
