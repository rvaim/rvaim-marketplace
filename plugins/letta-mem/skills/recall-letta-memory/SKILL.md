---
name: recall-letta-memory
description: 通过 letta-memory MCP 按当前问题召回已有工作区 Letta Agent 中的相关记忆。当前任务依赖跨会话的项目决定、用户偏好、历史排障结论、未完成状态或当前上下文缺失的既有约束时使用；问候、独立通用知识问题或当前对话已提供充分上下文时不要使用。
---

# 召回 Letta 记忆

1. 确定当前任务的工作区根目录。即使正在子目录或临时目录执行命令，也必须传入任务所属的工作区根目录绝对路径。
2. 调用 `letta_recall`，以当前问题或明确的上下文缺口作为 `query`，以工作区根目录作为 `workspace_path`。
3. 通常每个任务只调用一次；只有任务推进后出现新的历史信息缺口时才再次调用。
4. 把返回内容当作历史参考。若与当前用户消息或工程现状冲突，以当前信息为准并说明冲突。
5. 若未找到 Agent、没有相关记忆、插件已禁用或 Agent 正忙，继续处理当前任务，不循环重试。

不要用这个工具保存记忆、选择共享或工作区作用域、指定 memory block、MemFS、archive、Shared Memory repository 或 backend；这些决定始终由 Letta Agent 自己完成。
