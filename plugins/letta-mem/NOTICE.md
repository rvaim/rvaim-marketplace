# 上游归属说明

`letta-mem` 基于 Letta 开源项目 [`letta-ai/claude-subconscious`](https://github.com/letta-ai/claude-subconscious) 的核心产品思路进行新版改写。上游项目由 Letta, Inc. 发布，并使用 MIT License。

本改写保留“监听编码对话、后台更新记忆、在后续对话中注入上下文”的核心功能，并扩展到 Claude Code 与 Codex。实现已针对新版 Letta Agent SDK 与 App Server 重新设计，不再使用上游中的旧 SDK、旧 REST API、Letta Cloud 配置和旧版兼容层。

本项目同样使用 MIT License。完整许可条款和版权声明见同目录下的 `LICENSE`。

相关上游项目：

- [`letta-ai/claude-subconscious`](https://github.com/letta-ai/claude-subconscious)
- [`letta-ai/letta-agent-sdk`](https://github.com/letta-ai/letta-agent-sdk)
- [`letta-ai/letta-code`](https://github.com/letta-ai/letta-code)
