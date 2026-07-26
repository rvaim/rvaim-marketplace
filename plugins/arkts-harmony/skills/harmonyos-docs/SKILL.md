---
name: harmonyos-docs
description: 查阅 HarmonyOS/OpenHarmony 应用开发文档。仅在不确定 API、组件、Kit、版本变化或错误解决方式时使用；按场景选择 @deveco/deveco-cli 本地文档或 arkts_knowledge_search 在线知识查询。已知知识直接回答。
---

# HarmonyOS 应用开发文档查阅

仅在不确定 HarmonyOS/OpenHarmony API、组件、Kit、版本或错误结论时查询。ArkTS 语法限制优先使用 `arkts-ts-rules`。

## 两个独立来源

本地文档来自官方 DevEco CLI：

```bash
npx -y @deveco/deveco-cli docs search <keywords...> --format json
npx -y @deveco/deveco-cli docs read <documentId>
```

在线知识使用插件 MCP 工具：

```text
arkts_knowledge_search
```

在线 MCP 包为 `@rvaim/arkts_knowledge_search`，只负责在线查询和独立登录，不包含或依赖 `@deveco/deveco-cli`。

## 来源选择

1. API、组件、Kit、参数、返回值、示例和稳定指南优先查询本地文档。
2. 最新版本、新增、废弃、兼容性、路线图和本地未命中的问题查询在线知识。
3. 构建错误、运行异常和复杂故障可同时查询本地文档与在线知识。
4. 用户明确指定来源时严格遵循。
5. 本地查询返回 `documentId` 时，用 `docs read` 核对完整原文。
6. 在线工具只返回语义检索内容，不将其伪装成具有稳定文档 ID 的原文。

## 在线登录

在线查询提示未登录时，先使用 `arkts_knowledge_status` 检查状态。确需在线内容时调用 `arkts_knowledge_login`，并说明将打开华为官方登录页面。

不得索取、展示或记录 JWT、`accessToken`、`refreshToken`。

## 查询要求

- 关键词保持短而精确，包含 API、组件、Kit、装饰器、生命周期、错误文本或现象。
- 多个互不依赖的问题可分别查询，不把不相关内容塞进同一个问题。
- 回答中标明使用了“DevEco CLI 本地文档”“在线知识”或“两者”，并保留相关标题、`documentId` 或在线来源类型。
- 查询失败时明确说明缺失来源，再给出基于现有知识的保守建议。
- 不使用 raw GitHub URL、手动拼接文档路径或非官方搜索作为静默兜底。
