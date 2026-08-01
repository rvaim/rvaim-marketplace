# 变更日志

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
