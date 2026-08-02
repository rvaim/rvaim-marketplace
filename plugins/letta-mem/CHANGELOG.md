# 变更日志

## 2.8.0

- 参考 `letta-ai/claude-subconscious` 恢复 `SessionStart` 记忆预热：找到已有工作区 Agent 后，在后台创建或恢复当前编码会话的 Conversation，并发送精简的 `<coding_session_start>`。
- `SessionStart` 使用工作区标签精确发现 Agent；找不到时静默结束，严格禁止创建 Agent、更新 Agent 定义或创建 Conversation，避免 Claude Desktop 预加载未使用工作区时产生垃圾 Agent。
- 启动事件只包含会话 ID、工作区路径、时间和新会话通知；检索方式、久远会话召回和最终指导选择仍全部交给 Letta Agent 及其原生能力。
- 启动预热的最终 `assistant_message` 与 `Stop` 指导使用同一套消息 ID 引用和注入流程，不把 Agent 的分析、检索过程或工具状态传给编码助手。
- 启动预热返回空内容时保留上一轮 `Stop` 的有效指导，不用缺少针对性问题时产生的空结果覆盖待注入上下文。
- 同一编码会话 30 秒内的重复 `SessionStart` 会被抑制；预热使用工作区 Agent 运行锁，且不会把未收到真实用户消息的会话标记为已激活。
- Agent system prompt 新增 `<coding_session_start>` 协议：只检索和准备已有记忆，不因启动通知本身创建长期记忆。

## 2.7.0

- 读取流程改为消费上一轮 `Stop` 已完成的下一轮指导；`UserPromptSubmit` 和 `PreToolUse` 不再向 Letta Agent 发送当前问题、检索请求或任何新提示词，也不等待新的模型推理。
- `SessionStart` 继续保持纯本地，避免 Claude Desktop 预加载工作区时创建无效 Agent；第一条真实用户消息只负责固定工作区、激活会话和建立 Agent/Conversation 映射。
- `Stop` 后台 Agent turn 同时负责使用 Letta 原生能力更新记忆，并在最终响应中准备下一轮编码助手需要的简短指导；没有有用指导时允许返回空内容。
- 语言、作用域、安全边界和响应规则只保存在 Agent system prompt 中；每个 transcript 批次只发送会话数据和一句简短任务，不再重复注入完整策略。
- 插件记录已完成最终 `assistant_message` 的 Agent、Conversation、消息 ID 和 revision；下一轮按消息 ID 精确读取，不再扫描或拼接任意新增 assistant 消息。
- Agent 工具调用前的计划、分析、进度和记忆状态不会作为下一轮上下文；响应提取以最后一次工具调用后的最终 assistant 内容为结构边界，不进行英文文本过滤。
- Claude Code、Claude Desktop 与 Codex 通过协调目录共享最新指导引用；本地正文快照仍只用于 Letta 读取失败时的有限故障回退，不是记忆数据库。
- 新增跨宿主指导引用、`Stop` 到下一会话读取、前台零 `session.send()`、短批次提示和最终消息选择的回归测试。

## 2.6.2

- SDK Session 现在显式提供自动工具审批回调，避免 `unrestricted` 模式下的短暂 `WAITING_ON_APPROVAL` 被 SDK 提前当成本轮结束。
- 不再只相信 SDK 的 `result.success`：插件会跟踪 `tool_call` 与 `tool_result`、检查权威设备状态，并拒绝仍在处理、仍有待审批请求或存在未完成工具调用的结果。
- 未完成的记忆工具调用不会推进 transcript 游标，也不会删除待处理项；后续 drain 会继续重试，避免出现 App 卡在 `Updating memory`、日志却误报 `memory-updated` 的情况。
- 新增正常记忆工具完成、审批误报成功、审批已清空但工具结果丢失，以及 Hook 保留队列四类回归测试。

## 2.6.1

- 首条非空 `UserPromptSubmit` 现在会把规范化工作区根目录与 `sessionId` 稳定绑定；后续 Hook 不再用可能已经变化的当前 `cwd` 重新推导工作区身份。
- 修复编码任务进入生成的子目录后，`Stop` 找不到原会话激活状态、跳过 `<coding_session_update>`，从而导致会话结束记忆没有写入 Letta 的问题。
- `PreToolUse`、`Stop`、待处理队列、Agent/Conversation 恢复、SDK Session `cwd` 和提示中的 `workspace_path` 全部复用首次绑定的工作区根目录。
- 兼容升级前已经激活但没有工作区绑定索引的会话；插件会从现有状态中选择最早激活的工作区并建立绑定，不迁移或修改 Letta 记忆。

## 2.6.0

- 移除 `SessionStart` 的 Letta 后台预热；打开、恢复、扫描或预加载工作区时只恢复插件本地状态，不再查找或创建 Agent、Conversation。
- 将第一条非空 `UserPromptSubmit` 设为真实激活点，在同一次 Hook 内创建或复用工作区 Agent 与 Conversation，并完成实时记忆读取；后续每条用户消息继续实时检索。
- `Stop` 只为已由真实用户消息激活的会话创建待处理项，避免宿主为未使用的历史工作区触发后台写入并补建 Agent。
- 新增默认位于 `~/.letta-mem/coordination` 的跨宿主协调目录，使 Claude Code、Claude Desktop、Codex 和不同插件安装身份共享规范 Agent ID、初始化锁与工作区运行锁；这些文件只保存协调元数据，不保存 Letta 记忆。
- Agent 发现遇到多个相同工作区标签时按 ID 稳定选择一个并记录 `agent-duplicates-detected`；不会自动删除、合并或迁移已有重复 Agent。
- 兼容读取旧版各宿主插件数据目录中的 Agent ID，并在首次真实使用时迁移为共享引用；Letta Agent、Conversation 和实际记忆不受改动。

## 2.5.1

- 将语言约束扩展到 Letta Agent 处理记忆时产生的全部自然语言，包括分析说明、工具调用前后说明、记忆标题、摘要、正文和最终返回；每轮以对应用户消息的主要语言为准。
- 将 Codex 当前任务标题同步为对应 Letta Conversation 的 `summary`，解决 Letta App 列表长期显示 `No summary` 的问题；Codex Hook 未直接提供标题时，只读查询本地任务索引，查不到再使用首条用户消息回退。
- Conversation 标题变更后会在后续 Hook 中再次同步；插件仅保存上次同步标记用于去重，不接管 Letta Conversation 或记忆的持久化。
- 明确工作区 `cwd` 是 SDK Session 的执行属性：插件创建和恢复的后台会话始终使用当前工作区；Letta App 手动打开同一 Conversation 时显示的是 App 自己新建的前台会话目录。

## 2.5.0

- `UserPromptSubmit` 不再把插件本地 `contexts` 快照作为正常读取来源；现在会把当前问题、工作区路径和作用域约束实时交给对应 Letta Agent，由 Agent 使用其当前拥有的原生记忆能力返回相关上下文。
- `SessionStart` 新增后台会话预热，提前解析工作区 Agent 并创建或恢复当前编码会话的 Letta Conversation，使第一条用户问题也能读取记忆。
- 新增 `PreToolUse` Conversation 增量同步，通过消息游标注入后台稍后完成的 Agent 上下文，并避免重复注入历史消息。
- 将提示词明确分成 `context_retrieval` 与 `session_update`：前者只把当前问题作为不可信的相关性查询条件，不直接回答；后者处理完整转录并由 Agent 自行决定记忆价值、共享或工作区作用域及实际保存位置。
- 本地上下文快照降级为 Letta 不可用、超时或同工作区 Agent 正忙时的有限故障回退，并在注入元数据中区分 `live-agent`、`conversation-sync` 与 `local-fallback`。
- Agent 运行锁改为按工作区作用域隔离；同一个 Agent 的实时读取与后台写入保持有序，不同工作区不再共用一把全局运行锁。
- 新增实时读取、空结果、超时、回退和 Conversation 同步日志，并补充首轮读取、预热、游标去重、故障回退与作用域边界测试。

## 2.4.4

- 修复工作区 Agent 的执行目录被 SDK 服务进程当前目录污染的问题；创建 Agent、新建 Session 和恢复 Session 时都会显式传入对应工作区的规范化绝对路径作为 `cwd`。
- 明确 `cwd` 只约束 Agent 的代码执行上下文，不指定记忆存储位置、共享范围或 backend；共享记忆与工作区记忆仍完全由 Letta Agent 按语义自行区分。
- 新增跨工作区回归检查，确保同一后台队列依次处理多个工作区时，每个 Agent Session 都使用自己的工作区目录。

## 2.4.3

- 修复默认连接错误进入 `APIBackend`、因缺少 `LETTA_API_KEY` 导致工作区 Agent 和记忆无法创建的问题。
- 移除插件自行执行的固定端口 `letta server`；默认把 App Server 的启动、临时端口和生命周期交给 Letta Agent SDK，复用 Letta App 的标准本地数据目录 `~/.letta/lc-local-backend`。
- 默认连接不再向 SDK 传 `backend` 或 `harnessBackend`，由 SDK 使用自身默认客户端行为；显式关闭 `autoStartServer` 时仍可连接用户管理的 App Server，其实际存储后端由 Letta 决定。
- 保留原状态命名空间与待处理队列；连接恢复后会重新处理此前失败的记忆更新。

## 2.4.2

- 移除 `pinGlobalAgent: false`，新建工作区 Agent 恢复使用 Letta SDK 的默认全局登记行为，可在 Letta App 的 Agent 列表中显示。
- 新增回归检查，禁止插件再次把工作区 Agent 显式设置为不固定。

## 2.4.1

- 保留插件对 Letta Agent 的详细记忆作用域约束：稳定且脱离当前代码库仍成立的信息可跨工作区共享，项目事实、决定、配置、待办和例外必须限定于当前工作区。
- 同时包含通用原则与项目细节的信息由 Agent 拆分作用域；证据不足时默认限定于当前工作区，不得把其他工作区事实当成当前工作区事实。
- 作用域约束只描述语义判断，不指定 Shared Memory repository、MemFS、block、archive、文件路径或其他存储实现。
- 不再覆盖新 Agent 的 `baseTools`；后台 Session 使用 `unrestricted`，不提供工具白名单、skills 白名单或审批回调，让 Letta Agent 能调用当前环境实际提供的原生记忆能力。
- 继续保持 backend 中立：插件不选择、不校验、不拒绝 Letta 当前使用的本地、云端或自托管 backend。

## 2.4.0

- 明确插件只负责把编码会话与约束交给 Letta Agent；记忆价值、作用域、组织方式、存储位置和同步操作全部由 Letta 自行决定。
- 移除 `serverBackend`、`mixedMemory`、`sharedMemory` 运行配置及对应环境变量的行为；遗留字段会被忽略，不再影响 Agent 或存储。
- 自动启动 Letta Code App Server 时不再传 `--backend`，也不检查或拒绝服务当前选择的 backend。
- 移除 Shared Memory repository 路径发现、文件权限、Git 命令和专用工具白名单；后台 Session 不再覆盖 Letta 的默认工具集与 skills。
- 创建新 Agent 时不再传入插件定义的 `memory`、`memfs` 或 `cwd`，不预建任何记忆块或目录结构。
- 转录任务只描述长期记忆目标、工作区上下文、语言规则与安全约束，不再携带 memory mode、共享开关或存储机制提示。
- 恢复不含 backend 的原每工作区状态命名空间，以继续处理升级前的 Agent 映射与待处理队列。
- 移除对 `@letta-ai/letta-code/app-server-client` 的直接运行时导入，修复插件缓存目录缺少该包时无法创建 Agent 的问题。

## 2.3.0

- 移除插件维护的 `letta-mem · shared` Agent、第二条 Conversation、共享上下文转发和本地共享会话映射；每个转录批次现在只发送给当前工作区或混合 Agent 一次。
- 改用 Letta Code 原生 Shared Memory repository。共享仓库必须由用户或 Letta Code 预先挂载；插件不创建、挂载、删除、复制仓库，也不保存仓库 ID。
- 由同一个 Letta Agent 根据语义自行决定把长期信息写入自身 MemFS 还是已挂载的 Shared Memory repository；插件不预分类记忆。
- 共享模式默认使用并校验 `api` backend；`local` backend 仅能在 `sharedMemory=false` 时使用。
- 共享模式只开放当前 Agent 记忆根目录中的共享仓库文件，以及限定于该仓库的 Git 读取、提交与同步命令；工程目录、其他 Agent 记忆和任意 Shell 命令仍被拒绝。
- 现有工作区或混合 Agent 会更新到新的单 Agent 提示；旧 `letta-mem · shared` Agent 不再调用，也不会由插件自动删除或迁移，以免擅自改动用户记忆。

## 2.2.1

- 创建工作区、共享或混合 Agent 时，把当前工作区的规范化绝对路径作为 Agent SDK `cwd`；新建和恢复 Conversation 时也会重新传入，确保 Letta 运行时工作目录始终对应本次调用的工作区。
- Agent 复用改为只依赖 Letta 服务器上的插件标签与记忆作用域标签，不再要求 Agent 名称匹配；用户在 Letta App 中重命名 Agent 后仍会继续使用原有记忆。

## 2.2.0

- 默认自动启动与 Agent SDK 配套的本地 Letta App Server，不再要求用户全局安装 `@letta-ai/letta-code` 或长期保持手动终端进程。
- 启动前优先探测并复用已经运行的 App Server；Claude Code 与 Codex 并发启动时使用共享锁避免重复拉起。
- 自动启动只适用于无能力令牌的本机回环 `http` 地址；远程、自托管、加密或带鉴权的服务仍只连接，不创建本地进程。
- 新增 `autoStartServer` 配置并默认开启，可通过 `LETTA_MEM_AUTO_START_SERVER` 临时覆盖。
- 本地服务使用插件运行时中与 `@letta-ai/letta-agent-sdk@0.6.0` 配套的 `@letta-ai/letta-code@0.30.0`，并显式选择本地后端以复用 Letta App 的本地 Agent、记忆和模型供应商配置。
- App Server 启动、超时、入口缺失或端口冲突全部故障开放，待处理记忆继续留在持久队列中。

## 2.1.0

- 新增 `sharedMemory` 配置并默认开启；关闭时只维护每工作区独立记忆。
- 默认模式新增服务器端唯一的 `letta-mem · shared` Agent，由 Letta 根据语义自行判断是否把稳定偏好、通用规范和可复用经验保存为跨工作区共享记忆。
- 共享 Agent 与工作区 Agent 使用独立 Conversation；共享上下文先生成，再交给工作区 Agent 组合为后续会话上下文。
- Claude Code 与 Codex 通过共享作用域标签复用同一个共享 Agent，不依赖各自的本地安装目录。
- 混合模式不创建第二个共享 Agent；启用共享判断时由混合 Agent 在同一 MemFS 中区分共享原则与带来源的独立事实。
- 共享 Agent 不可用或处理失败时保留待处理项并故障开放，不影响 Claude Code 或 Codex 正常使用。
- 继续只使用新版 Letta Agent SDK、App Server、Conversation 与 MemFS，不恢复旧版 Block REST 或 Cloud 兼容代码。

## 2.0.0

- 新增 Codex 插件清单、生命周期 Hook 与当前 Codex 转录格式支持。
- 使用 `~/.letta-mem/config.json` 作为 Claude Code 与 Codex 唯一的持久配置源，并移除 Claude Code `userConfig`。
- 新增 `model` 配置；默认 `auto`，也可使用 Letta 提供的显式模型句柄。
- 新增 `mixedMemory` 配置；默认关闭，开启后所有工作区和宿主共享名为 `letta-mem` 的 Agent。
- 模型变化时更新现有 Agent，并刷新本地 Conversation，同时保留 Agent MemFS 记忆。
- Agent 发现改为基于服务器端作用域标签，避免 Claude Code 与 Codex 为同一作用域重复创建 Agent。
- 保持 Conversation、转录游标、待处理队列和上下文快照按工作区及会话隔离。
- 继续按用户消息语言保存记忆，并保持所有 Hook 故障开放。

## 1.1.1

- 按用户消息语言保存记忆。
- 同一工作区中的多个会话共享一个 Agent。

## 1.1.0

- 改用新版 Letta Agent SDK 与 App Server。
- 为每个 Claude Code 工作区创建独立 Agent。
