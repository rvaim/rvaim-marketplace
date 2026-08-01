# letta-mem

`letta-mem` 是面向 Claude Code 与 Codex 的持久记忆插件。它监听编码对话，把新增的可见内容交给 Letta Agent 在后台整理，并在后续对话中自动注入相关上下文。

插件精确使用 `@letta-ai/letta-agent-sdk@0.6.0` 与配套的 `@letta-ai/letta-code@0.30.0`。它不直接依赖旧版 Letta SDK，不调用旧版 blocks、passages 或 archives 接口，也不直接调用 DeepSeek 等模型供应商 API。

## 核心行为

- 使用新版 Letta Agent、Conversation、Session 与 MemFS 能力维护用户偏好、工作区事实、已确认决策和未完成事项。
- 默认每个工作区使用一个独立 Agent；一个工作区可以包含多个文件夹，只要宿主 Hook 提供的 `cwd` 是同一个工作区主目录，就会复用同一 Agent。
- 创建 Agent 以及每次新建或恢复 Conversation 时，都会把当前工作区的规范化绝对路径作为 Agent SDK `cwd`，使 Letta 运行时工作目录对应当前文件夹。
- 默认启用 Letta Code 原生 Shared Memory repository：同一个工作区 Agent 根据语义自行判断哪些信息写入已挂载的共享仓库，哪些留在自身 MemFS。插件不创建第二个共享 Agent，也不预分类或复制记忆。
- 可开启混合记忆，让所有工作区及 Claude Code、Codex 两个宿主共同复用一个名为 `letta-mem` 的 Agent。
- 新建或实质修改的记忆跟随产生事实的用户消息语言：中文保存中文、英文保存英文，其他语言同理。
- 模型和供应商凭据由 Letta 管理。插件只把模型句柄交给 Letta，不读取或传递供应商 API key。
- 默认自动启动与 Agent SDK 版本匹配、使用 `api` backend 的本地 App Server；已有服务会被直接复用，不需要全局安装 Letta CLI 或手动保持终端进程。
- Letta 未启动、断线、超时、鉴权失败、配置错误或模型不可用时，Hook 都故障开放并以成功状态结束，不阻塞 Claude Code 或 Codex。

## 前置条件

- Claude Code 或支持插件生命周期 Hook 的 Codex。
- `node >= 22.19.0` 和配套的 `npm` 位于宿主进程的 `PATH` 中。
- Letta 中至少配置了一个可用模型供应商。
- 使用原生 Shared Memory 时，Letta Code 必须已登录并能使用 `api` backend；目标 Shared Memory repository 必须已挂载到对应工作区 Agent。

## 本地 App Server

默认配置下，插件会先探测 `http://127.0.0.1:4500`。如果已有兼容 App Server 正在运行就直接复用；如果没有，则从插件生产运行时解析 Agent SDK 配套的 `@letta-ai/letta-code@0.30.0`，在后台执行等价命令：

```bash
letta --backend api server --listen ws://127.0.0.1:4500
```

因此不需要全局安装 `@letta-ai/letta-code`，也不需要手动保持终端窗口。`api` backend 使 Agent 能使用 Letta Code 原生 Shared Memory repository；Letta 官方包负责 Agent、MemFS、共享仓库同步和模型调用，插件本身不读取模型供应商密钥。

`serverBackend=local` 仍可用于完全本地的工作区记忆，但 Letta Code 的原生 Shared Memory repository 不适用于该 backend，因此必须同时设置 `sharedMemory=false`。

Letta App 的 `Local` 状态、`Allow remote access`、后台运行和登录时启动开关都不会开放 App Server 端口；插件自动启动的是独立的本地监听进程。服务退出后，后续 `SessionStart` 或 `Stop` 会再次检查并按需恢复。

自动启动仅适用于满足以下全部条件的地址：

- `autoStartServer=true`；
- `serverUrl` 使用 `http`；
- 主机是 `127.0.0.1`、`localhost` 或 `::1`，并显式指定端口；
- 未设置 `LETTA_APP_SERVER_TOKEN`。

远程、自托管、`https` 或带能力令牌的 App Server 只会被连接，插件不会为它们创建进程。若希望完全自行管理本地服务，可设置 `autoStartServer=false`，再手动运行：

```bash
letta --backend api server --listen ws://127.0.0.1:4500
```

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
  "autoStartServer": true,
  "serverBackend": "api",
  "model": "auto",
  "mixedMemory": false,
  "sharedMemory": true
}
```

配置项：

| 字段 | 默认值 | 用途 |
|---|---|---|
| `serverUrl` | `http://127.0.0.1:4500` | 本机或自托管 App Server 基地址；支持 `http(s)`，也接受并规范化 `ws(s)` 和标准 `/ws` 后缀。 |
| `autoStartServer` | `true` | 本机回环地址不可用时，是否自动启动插件运行时自带的匹配版本；远程、加密或带鉴权地址不会自动启动。 |
| `serverBackend` | `api` | 自动启动的 Letta Code backend，也用于校验已有 App Server。原生 Shared Memory 需要 `api`；`local` 仅能与 `sharedMemory=false` 一起使用。 |
| `model` | `auto` | Letta Agent 使用的默认模型。`auto` 表示由 Letta 根据自身配置选择；也可填写 Letta 模型句柄。 |
| `mixedMemory` | `false` | `false` 为每个工作区独立 Agent；`true` 为所有工作区共享 `letta-mem` Agent。 |
| `sharedMemory` | `true` | 是否允许同一个 Agent 使用已由 Letta Code 挂载的原生 Shared Memory repository。插件不负责创建或挂载仓库。 |

指定已在 Letta 中可用的 DeepSeek 模型示例：

```json
{
  "serverUrl": "http://127.0.0.1:4500",
  "autoStartServer": true,
  "serverBackend": "api",
  "model": "deepseek/deepseek-v4-flash",
  "mixedMemory": false,
  "sharedMemory": true
}
```

修改文件后，从下一次 Hook 调用开始生效。模型变化时，插件通过新版 Agent SDK 更新现有 Agent，并为各本地会话创建使用新默认模型的 Conversation；Agent 的 MemFS 记忆不会被删除。`model` 不影响本地状态命名空间，因此不会因为切换模型丢失 Agent 映射。

`mixedMemory` 会切换到独立状态命名空间。开启后，所有工作区共享 Letta Agent 与 MemFS，但 Conversation、转录游标、待处理队列和可注入上下文快照仍按工作区与宿主会话隔离。关闭后会恢复原先的每工作区映射，不会把两种模式的本地状态混在一起。

`sharedMemory` 不切换本地状态命名空间。开关它不会丢失工作区 Agent 映射；它只控制后台会话是否允许访问当前 Agent 已挂载的 Shared Memory repository。模型变化只更新同一个工作区或混合 Agent。

`serverBackend` 会切换本地状态命名空间，避免 `api` 与 `local` backend 的 Agent 映射混用。插件会读取 App Server 实际 backend；与配置不一致时故障开放并记录错误，不会静默退化成插件自建共享存储。

### 临时和部署覆盖

环境变量只作为运行时覆盖，不会写回配置文件：

| 环境变量 | 用途 |
|---|---|
| `LETTA_MEM_CONFIG_PATH` | 覆盖共享配置文件路径。 |
| `LETTA_APP_SERVER_URL` | 临时覆盖 `serverUrl`。 |
| `LETTA_APP_SERVER_TOKEN` | App Server 可选能力令牌；不写入 JSON。 |
| `LETTA_MEM_AUTO_START_SERVER` | 临时覆盖 `autoStartServer`，接受 `true`、`false`、`1`、`0`。 |
| `LETTA_MEM_SERVER_BACKEND` | 临时覆盖 `serverBackend`，接受 `api` 或 `local`。 |
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

Agent 名称只用于在 Letta App 中展示，不作为记忆身份。插件先按本地作用域映射取得 `agentId`；需要从服务器重新发现时，只匹配 `letta-mem` 与 `letta-mem-workspace:<工作区指纹>` 标签。即使在 Letta App 中手动重命名 Agent，也会继续复用原来的 Agent 与 MemFS，不会另建一份记忆。

新版 Agent SDK 没有可持久写入 Agent 数据库的“工作区文件夹”字段，`cwd` 属于运行时 Conversation。插件因此在首次创建 Agent、每次新建 Conversation 和每次恢复 Conversation 时都传入当前工作区路径；混合 Agent 在不同工作区中使用时，也会为各自的 Conversation 设置对应的当前路径。

`sharedMemory=true` 不会创建任何额外 Agent。一个转录批次只发送一次给当前工作区 Agent；该 Agent 同时拥有两类记忆位置：

- 自身 MemFS：保存当前工作区专用偏好、工作区事实、架构决定和本地待办。
- Letta Code 原生 Shared Memory repository：保存跨工作区仍成立的稳定偏好、通用规范和可复用经验。

作用域判断完全由这个 Letta Agent 根据语义完成。插件不按关键词或规则拆分转录，不先生成共享上下文，也不把同一批内容转发两次。

Shared Memory repository 的生命周期和 Agent 关系由用户或 Letta Code 维护。插件不会创建、挂载、删除、复制仓库，也不会记录仓库 ID。目标 repository 必须事先挂载到当前 Agent；Letta Code 会把它投影到 Agent 自身 `memory` 目录旁边。插件只允许后台 Agent 读取和编辑该投影，并仅放行作用于该共享仓库的受限 Git 命令，工程目录仍不可写。

如果没有已挂载的 Shared Memory repository，Agent 不会伪造一个插件私有共享层，而是把仍有长期价值的信息留在自身 MemFS。`sharedMemory=false` 则完全不开放共享仓库文件与 Git 工具，只维护 Agent 自身记忆。

### 混合记忆模式

`mixedMemory=true` 时，所有工作区使用一个名称精确为 `letta-mem` 的 Agent。发送给 Letta 的每个批次都包含来源 `workspace_path`；后台提示要求在可能混淆时保留来源，不得把其他工作区事实误当作当前工作区事实。

混合模式本身让所有工作区使用同一个 Agent。开启 `sharedMemory` 后，该 Agent 仍自行区分原生 Shared Memory repository 和自身 MemFS 中带 `workspace_path` 的工作区事实；插件同样不创建第二个 Agent。若需要物理隔离的工作区记忆，应保持 `mixedMemory=false`。

Agent 的发现依赖 Letta 服务器上的插件与作用域标签，不依赖 Agent 名称，也不依赖 Claude Code 或 Codex 各自的本地安装实例。因此两个宿主连接同一个 App Server 时，会复用同一个对应 Agent。

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
| `SessionStart` | 初始化或恢复本地会话状态，在后台准备 Agent SDK 运行时、确保本地 App Server 可用并恢复持久队列。 |
| `UserPromptSubmit` | 只读取本地上下文快照，把当前会话尚未接收的新版本作为 `additionalContext` 注入；不请求 Letta。 |
| `Stop` | 先原子写入待处理项，再由后台进程读取转录增量；整个批次只交给当前工作区或混合 Agent 一次，由该 Agent 自行更新自身 MemFS 与已挂载的原生 Shared Memory repository，最后保存下一轮上下文。 |

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

自动启动进程的跨宿主锁和独立日志位于：

```text
~/.letta-mem/server/
├── locks/
└── logs/
    ├── app-server.log
    └── app-server.log.1
```

Claude Code 与 Codex 的本地数据目录彼此独立，但会通过 Letta 标签复用服务器端工作区 Agent 或混合 Agent。Shared Memory repository 的挂载关系和内容不保存在插件本地状态中。状态目录和日志目录使用 `0700`，文件使用 `0600`。更换 App Server 地址、backend 或能力令牌会使用独立命名空间，令牌只参与哈希，不写入名称和状态内容。

## 隐私与安全

插件只把转录批次发送一次给 `serverUrl` 指定的 App Server。内容可能包括用户和助手的可见文本、经过截断的工具摘要、工作区主目录路径和会话标识；不会采集隐藏推理。`api` backend 会按 Letta Code 的原生机制与 Letta API 同步 Agent MemFS 和已挂载的 Shared Memory repository；插件不自行实现共享存储，也不直接调用模型供应商 API。

共享功能关闭时，后台 Agent 只允许使用 `memory` 与 `memory_apply_patch`。共享功能开启时，还可读取当前 Agent 的原生记忆根目录、编辑其中已挂载的共享 repository，并运行限定于该仓库的 `git status`、`diff`、`log`、`pull`、`add`、`commit` 与 `push`；工程文件、其他 Agent 记忆、任意 Shell 命令和网络工具仍被拒绝。转录被明确标记为不可信数据。用户若把密钥直接粘贴到可见对话，仍可能进入待处理内容，因此不应在编码对话中提供不必要的凭据。

## 故障开放与排查

| 现象 | 检查方向 |
|---|---|
| 首轮没有记忆 | Agent 在第一次可处理的 `Stop` 后才创建，下一轮才可能注入。 |
| Letta App 中没有 Agent | 完成至少一轮对话，然后检查插件日志中的 `app-server-started` 或 `app-server-start-failed`；自动服务日志位于 `~/.letta-mem/server/logs/app-server.log`。 |
| 共享记忆没有更新 | 确认 `serverBackend=api`、Letta Code 已登录，并在 Letta 中把目标 Shared Memory repository 挂载到当前工作区 Agent。插件不会代为创建或挂载。 |
| 日志提示 backend 不一致 | 停止端口上已有的 App Server，或把 `serverBackend` 改成其实际 backend；原生 Shared Memory 不能使用 `local`。 |
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

测试覆盖共享配置、App Server backend 校验与自动启动、单 Agent 自主作用域判断、原生共享仓库权限边界、跨宿主复用、模型与提示迁移、混合与工作区模式、Claude Code 和 Codex 转录、队列、会话恢复、上下文注入与故障开放。业务源码不声明或导入旧版 SDK。

## 上游与许可

本插件基于 [Letta `claude-subconscious`](https://github.com/letta-ai/claude-subconscious) 的核心产品思路重新实现。新版架构没有保留上游旧 SDK、raw REST、`.af` 导入或旧版兼容代码。

项目使用 MIT License。上游归属见 [NOTICE.md](NOTICE.md)，完整条款见 [LICENSE](LICENSE)。
