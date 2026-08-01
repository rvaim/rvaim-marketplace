# letta-mem

`letta-mem` 是一个仅面向 Claude Code 的持久记忆插件。它监听 Claude Code 会话，为每个工作区在本机或自托管 App Server 中自动创建独立的新版 Letta Agent，把新增的可见对话交给对应 Agent 整理，再在该工作区的后续对话中自动注入相关上下文。

插件精确使用 `@letta-ai/letta-agent-sdk@0.6.0`，不直接依赖旧版 Letta SDK，不调用旧版 `/v1` blocks、passages 或 archives 接口，也不依赖 Letta Cloud。

实现与部署方式以 Letta 官方的 [Agent SDK 部署文档](https://docs.letta.com/agent-sdk/deployment) 和 [Agent SDK 接口参考](https://docs.letta.com/agent-sdk/reference) 为准。

## 功能边界

- 使用 Hook 提供的规范化工作目录识别工作区，并为每个工作区自动复用或创建独立 Agent，不用 Git 根目录拆分或合并记忆。
- 使用新版 Letta Agent、Conversation 和 Session 能力维护用户偏好、工作区事实、已确认决策和未完成事项。
- 每条新建或实质修改的记忆跟随产生该事实的用户消息语言：中文用户内容保存为简体中文，英文用户内容保存为英文，其他语言同理。
- 通过新版 Agent SDK 连接用户自行管理生命周期的本机或自托管 App Server；插件不在短生命周期 Hook 中启动常驻服务。
- 模型和模型供应商完全由 Letta 管理。DeepSeek 等供应商的 API key 只配置给 Letta，插件不读取、不保存、不传递这些密钥，也不直接调用任何模型 API。
- Letta 未启动、断线、超时、鉴权失败或返回异常时，所有 Hooks 都保持故障开放：静默跳过记忆功能并以成功状态结束，不阻塞 Claude Code 的正常使用。

## 前置条件

- Claude Code 可用。
- `node >= 22.19.0` 和配套的 `npm` 可在 Claude Code 运行环境的 `PATH` 中找到。
- 如果当前 Claude Code 没有随插件安装运行时依赖，首次会话需要访问 npm 软件包注册表，以便异步补装精确锁定的 Agent SDK。
- 需要一个可连接的新版 Letta App Server；默认使用官方 Agent SDK 格式连接本机 `http://127.0.0.1:4500`。
- Letta 中已配置可用的模型供应商。

## 准备自托管 Letta

### 本机或自托管 App Server

插件统一使用 Agent SDK 的 App Server transport，连接由用户管理生命周期的服务。这样可以可靠支持本机部署，又不会因 Claude Code Hook 进程退出而遗留孤儿 App Server。可安装与 Agent SDK `0.6.0` 配套的 Letta CLI：

```bash
npm install -g @letta-ai/letta-code@0.30.0
```

以 DeepSeek 为例，先在 Letta 中配置供应商：

```bash
letta --backend local connect deepseek
```

密钥由 Letta 自己的安全交互流程收集和保管。插件没有 DeepSeek 或其他模型供应商的配置项。

然后启动新版 App Server：

```bash
letta server --backend local --listen ws://127.0.0.1:4500
```

`letta_server_url` 使用 Agent SDK `0.6.0` 官方推荐的 App Server HTTP 基地址，例如 `http://127.0.0.1:4500`。插件也接受 `https://`、`ws://` 或 `wss://`；WebSocket 地址及标准 `/ws` 后缀会规范为等价的 HTTP(S) 基地址，再由 SDK 建立协议连接。它不是旧版 Letta REST API 地址。

Letta App 界面底部显示 `Local` 只表示 App 正在使用本地数据，不代表 Agent SDK 的 WebSocket App Server 已经监听。请保持上述 `letta server` 进程运行；插件会通过这个服务创建 Agent，创建结果会出现在 Letta App 的 Agent 列表中。

如果 App Server 监听在非回环地址，应启用能力令牌（`capability token`）：

```bash
letta server \
  --backend local \
  --listen ws://0.0.0.0:4500 \
  --ws-auth capability-token \
  --ws-token-file /absolute/path/to/token
```

在插件配置界面将该令牌填入 `letta_auth_token`。该值只用于访问自托管 App Server，不是模型 API key。

## 安装

添加 marketplace：

```bash
claude plugin marketplace add rvaim/rvaim-marketplace
```

使用本机自托管 App Server：

```bash
claude plugin install letta-mem@rvaim-marketplace \
  --config letta_server_url=http://127.0.0.1:4500
```

也可以在 Claude Code 的 `/plugin` 界面中安装并填写配置。含令牌的配置建议使用该界面输入，避免将敏感值留在命令行历史中。

安装后启动一个新 Claude Code 会话。插件会优先复用 Claude Code 已为插件准备的运行时依赖；如果依赖尚未准备，`SessionStart` Hook 会在后台异步补装，Claude Code 不会等待。补装期间待处理更新会保留在本地队列；依赖就绪后，下一个对话轮次或新会话会自动恢复处理。

## 配置

| 配置项 | 默认值 | 用途 |
|---|---|---|
| `letta_server_url` | `http://127.0.0.1:4500` | 用户管理的本机或自托管 App Server 基地址；支持 `http(s)`，也兼容并规范化 `ws(s)`。 |
| `letta_auth_token` | 空 | 自托管 App Server 的可选能力令牌；Claude Code 按敏感值存储。 |

插件不提供共享 Agent ID 配置。这样可以保证不同工作区不会意外写入同一个 Agent。Agent 会在工作区第一次产生可处理的 `Stop` 事件时懒创建，可见名称格式为 `letta-mem · <工作区主目录名> · <工作区指纹>`。同一工作区中的所有 Claude Code 会话共享这个 Agent；即使工作区挂载多个文件夹，只要 Hook 的 `cwd` 保持为同一个工作区主目录，就不会拆成多个 Agent。不同主目录使用不同 Agent。

### 记忆语言

- 判断语言时只参考用户消息，不跟随 Claude、系统摘要、工具结果或 Letta 模型的默认语言。
- 用户用简体中文表达的事实保存为简体中文；用户用英文表达的事实保存为英文；其他语言也使用对应语言。
- 混合语言消息使用用户的主要叙述语言，代码标识符、库名、API 名、路径和命令保持原样。
- 同一工作区可以包含不同语言的记忆。切换对话语言不会批量翻译无关的既有记忆；没有用户消息或无法可靠判断时保留相关记忆的现有语言。

用户配置优先于下列开发环境变量：

| 环境变量 | 用途 |
|---|---|
| `LETTA_APP_SERVER_URL` | 覆盖自托管 App Server 端点。 |
| `LETTA_APP_SERVER_TOKEN` | 覆盖 App Server 能力令牌。 |
| `LETTA_MEM_DATA_DIR` | 仅用于开发或手工加载；当 `CLAUDE_PLUGIN_DATA` 未设置时覆盖本地状态目录。 |
| `LETTA_MEM_DISABLED=1` | 临时停用所有记忆行为，但不卸载插件。 |
| `LETTA_MEM_REQUEST_TIMEOUT_MS` | 覆盖 Letta 请求超时。 |
| `LETTA_MEM_MAX_CONTEXT_CHARS` | 覆盖单次注入的最大字符数。 |
| `LETTA_MEM_MAX_BATCH_CHARS` | 覆盖单次后台更新批次的最大字符数。 |

## Hooks 数据流

| Claude Code 事件 | 执行方式 | 行为 |
|---|---|---|
| `SessionStart` | 同步状态恢复 + 异步运行时准备 | 短超时同步步骤先初始化本地会话状态，并在 fork 时跳过继承的历史记录；独立异步步骤再检查运行时、补装缺失依赖并恢复持久队列。Agent 和 Conversation 在首次有对话增量需要处理时懒创建。 |
| `UserPromptSubmit` | 同步，短超时 | 只读取本地上下文缓存，把尚未向当前 Claude Code 会话交付的新版本作为 `additionalContext` 注入当前轮次；不等待网络请求。 |
| `Stop` | 异步 | 先持久化带转录上界的待处理项，再读取 Claude Code JSONL 的未处理增量，通过 Agent Session 发送给 Letta，完整消费流式结果，依次提交本地上下文快照和会话游标。 |

每个工作区拥有一个持久 Agent；该工作区内每个 Claude Code `session_id` 对应一个 Letta Conversation。工作区身份由 Hook 的 `cwd` 规范化为真实绝对路径后生成，不向上查找 Git 根目录，也不向 Letta 发送工作区文件。每次 Stop 会先把待处理项原子写入带工作区身份的持久队列，再由持有 Agent 锁的后台进程串行消费；崩溃、超时、安装依赖或并发占锁时，队列会保留到后续 Stop 或 SessionStart 恢复。同一工作区、同一会话严格按入队顺序处理，失败头项在退避期间会阻塞该会话的后续项，但不会混淆其他工作区或会话。单次增量超过批次上限时按最早未处理记录分批推进，先落盘上下文快照，再提交已成功处理的游标，后续内容不会因截断而丢失。Claude Code 尚未把最终助手回答写入 JSONL 时，插件会使用 Stop 提供的回退文本，并在真实记录稍后出现时通过一次性内容指纹去重。各状态文件采用原子替换，但跨文件语义是可重试的至少一次交付，而不是单个跨文件事务。

## 运行时依赖准备

不同 Claude Code 版本和安装方式对 npm 依赖的准备行为可能不同。为了兼容 marketplace 安装、旧版 Claude Code 和手工开发目录，`letta-mem` 使用一个故障开放的异步引导器：

1. 如果 `${CLAUDE_PLUGIN_ROOT}/node_modules` 中已有精确版本的 Agent SDK，引导器直接复用，不重复安装。
2. 如果插件目录没有依赖，`SessionStart` 立即让 Claude Code 继续运行，引导器在后台把 `@letta-ai/letta-agent-sdk@0.6.0` 及所需运行时依赖补装到 `${CLAUDE_PLUGIN_DATA}/runtime/<generation>`；安装时禁用依赖生命周期脚本。
3. 更新插件或 Node.js 运行环境后，回退运行时会根据锁定依赖、Node 版本、平台和架构判断是否需要重新安装。
4. 依赖未就绪或安装失败时，需要 Letta 的业务处理直接跳过；后续 `SessionStart` 或异步 `Stop` 会再次尝试。纯本地缓存的 `UserPromptSubmit` 不等待依赖安装。

插件自身不会修改 `${CLAUDE_PLUGIN_ROOT}`；只有 Claude Code 安装器可能在安装阶段准备其中的依赖。正常安装的运行状态保存在 `${CLAUDE_PLUGIN_DATA}`；仅在手工开发场景未提供该变量时，才使用 `LETTA_MEM_DATA_DIR` 或开发默认目录。

## 隐私与安全

插件只把数据发往用户配置的 Letta App Server，代码中没有 Letta Cloud 默认地址或 Cloud API key 流程。

后台记忆更新可能包含：

- 用户和助手的可见文本。
- Claude Code 生成的会话摘要。
- 工具名称、经过截断的关键输入与工具结果。
- 当前工作区主目录路径和会话标识。

插件不采集、不发送 Claude 的 `thinking` 或其他隐藏推理内容。但是，如果用户或工具把密钥、个人信息等敏感内容直接写入可见对话，这些内容仍可能进入待处理数据。请不要在 Claude Code 对话中粘贴不必要的凭据，并根据自己的数据边界选择 App Server 部署位置。

后台 Agent 不获得 Claude 工程读写工具，会话记录内容被包裹为不可信数据，不应被当作要执行的指令。

## 状态与日志

正常安装时，插件所有持久数据都位于 `${CLAUDE_PLUGIN_DATA}`。从 `rvaim-marketplace` 安装时，通常对应：

```text
~/.claude/plugins/data/letta-mem-rvaim-marketplace/
├── runtime/<generation>/          # 按锁文件、Node 与平台分代的回退运行时
├── state/<server-namespace>/     # 按 App Server 和能力令牌隔离
│   ├── agents/                   # 工作区主目录到 Letta Agent 的映射
│   ├── sessions/                 # 工作区与 Claude 会话到 Conversation 的映射和游标
│   ├── contexts/                 # 每个工作区最近可注入的上下文快照
│   ├── pending/                  # 带工作区身份、由 Stop 先落盘的待处理队列
│   └── locks/                    # 进程间 Agent、会话和队列锁
└── logs/
    ├── letta-mem.log
    └── letta-mem.log.1
```

日志只用于诊断、不写入 stdout，避免污染 Hook JSON。单个日志达到约 1 MB 后会轮转，配置的能力令牌和日志中的 `Bearer` 凭据都会被隐藏。查看日志：

```bash
tail -f ~/.claude/plugins/data/letta-mem-rvaim-marketplace/logs/letta-mem.log
```

更换 App Server 端点或能力令牌时，插件使用独立状态命名空间，避免错用其他服务器的 Agent、Conversation 与上下文缓存；令牌本身不会写入命名空间名称。工作区主目录只以哈希形式出现在文件名中，映射内容保存在本机私有状态文件。状态、队列和日志目录使用 `0700`，文件使用 `0600`。

## 更新与卸载

更新 marketplace 和插件：

```bash
claude plugin marketplace update rvaim-marketplace
claude plugin update letta-mem@rvaim-marketplace
```

Claude Code CLI 会提示重启后应用更新。插件升级时 `${CLAUDE_PLUGIN_DATA}` 保留，因此会话映射、缓存和回退运行时不会因插件缓存目录变化而丢失。

卸载插件并删除其本地状态：

```bash
claude plugin uninstall letta-mem@rvaim-marketplace
```

如需保留本地状态，便于以后重新安装：

```bash
claude plugin uninstall letta-mem@rvaim-marketplace --keep-data
```

卸载只影响 Claude Code 本地的插件数据。插件创建在 Letta App Server 中的 Agent 和 Conversation 不会被自动删除，如需彻底清理，应使用 Letta 自身的管理能力确认后处理。

## 故障开放与排查

| 现象 | 检查方向 |
|---|---|
| 首个会话没有记忆 | Agent 在第一次 Stop 时才创建，首轮之前没有可注入内容；也可能是安装器仍在异步准备依赖。检查日志后继续下一轮。 |
| Letta App 中没有新 Agent | 确认 `letta server` WebSocket 服务正在运行，并在工作区内完成至少一轮 Claude Code 对话；仅打开 Letta App 不会自动暴露该服务。 |
| 日志提示 Node 版本过低 | 将 Claude Code 可见的 `node` 升级到 `22.19.0` 或更高版本。 |
| App Server 连接失败 | 确认服务正在运行，优先填写 `http://` / `https://` 基地址，并检查地址、端口与能力令牌是否匹配。 |
| Letta 报告无可用模型 | 使用 Letta CLI 配置供应商，不要向插件添加模型密钥。 |
| Claude Code 正常但没有记忆更新 | 这是预期的故障开放行为；检查 `letta-mem.log`、服务器状态和当前配置。 |

## 开发与测试

在插件目录中安装开发依赖并执行完整验证：

```bash
cd plugins/letta-mem
npm ci
npm run verify
claude plugin validate --strict .
```

`npm run verify` 依次执行 TypeScript 静态检查、单元测试和生产构建。现有单元测试使用伪 Agent SDK 客户端覆盖 Hook 状态机、增量会话记录、持久队列顺序、分批、上下文注入、状态恢复和故障开放，不依赖 Letta Cloud。发布前另执行隔离安装、连接拒绝和本机 App Server 冒烟测试。

使用本地插件目录进行 Claude Code 加载测试：

```bash
LETTA_APP_SERVER_URL=http://127.0.0.1:4500 \
claude --plugin-dir . --debug
```

发布前还应确认业务源码、Hooks 和直接依赖中没有旧版 API 与 Cloud 配置：

```bash
rg -n 'letta-code-sdk|@letta-ai/letta-client|/v1|api\.letta\.com|app\.letta\.com|LETTA_API_KEY|llm_config' \
  src hooks package.json
```

`@letta-ai/letta-agent-sdk` 的内部传递依赖由 Letta 官方包自行管理；本项目的约束是插件不直接声明、导入或调用旧 SDK。

## 上游与许可

本插件基于 [Letta 的 `claude-subconscious`](https://github.com/letta-ai/claude-subconscious) 所建立的核心产品思路：监听 Claude Code 对话、在后台更新 Letta 记忆、并把相关上下文交给后续对话。

为了适配新版 Letta Agent SDK 与 App Server，本实现重新设计了 Agent、Conversation、Session、异步引导、本地状态和故障开放流程，没有保留上游的旧 SDK、Cloud、raw REST、`.af` 导入或旧版兼容代码。

项目使用 MIT License。上游归属说明见 [NOTICE.md](NOTICE.md)，完整条款见 [LICENSE](LICENSE)。
