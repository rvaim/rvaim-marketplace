# 变更日志

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
