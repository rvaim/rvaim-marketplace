---
name: harmonyos-docs
description: 查阅 HarmonyOS/OpenHarmony 应用开发文档。仅在你不确定或不知道某个 API、组件、Kit 用法时使用，通过 DevEco CodeGenie MCP 查询开发指南和 API 参考。已知的知识直接回答即可。
---

# HarmonyOS 应用开发文档查阅

仅在 **不确定或不知道** HarmonyOS/OpenHarmony 的 API、组件、Kit 开发指南时才查文档。已知规则（如 ArkTS 语法限制）直接使用已有知识回答，不要重复查询。

## 查询入口

使用插件内置的 DevEco CodeGenie MCP 查询文档。

插件 MCP 配置位于 `plugins/arkts-harmony/.mcp.json`，server 名称为 `deveco_mcp`：

```json
{
  "command": "npx",
  "args": [
    "-y",
    "@deveco-codegenie/mcp@beta"
  ]
}
```

## 使用策略

1. 先判断问题是否确实需要查文档：API 签名、参数、返回值、组件属性、Kit 用法、版本差异、示例代码等需要查询；ArkTS 基础语法约束优先使用 `arkts-ts-rules`。
2. 通过 MCP 查找 HarmonyOS/OpenHarmony 文档。Codex 环境中如需发现工具，先用 `tool_search` 搜索 `HarmonyOS docs`、`DevEco`、`CodeGenie` 或 `deveco_mcp`；Claude Code 环境中查看已启用 MCP 工具列表。
3. 如果 MCP 暴露 `harmonyos_knowledge_search` 或同等语义工具，优先使用该工具。
4. 查询关键词保持短而精确，包含组件/API/Kit 名称和问题类型，例如 `Navigation titleMode API`、`List contentStartOffset`、`AbilityStage onCreate`。
5. 需要区分指南和 API 时，在关键词中显式加入 `开发指南`、`API 参考`、`参数`、`返回值`、`示例` 等限定词。
6. MCP 返回多条结果时，优先采用官方 API 参考、开发指南、最佳实践、版本变更说明；对不确定的信息标注为推断，不要伪装成已确认结论。
7. MCP 查询不到或工具不可用时，直接说明 MCP 未返回可用结果，并给出基于现有知识的保守建议；不要改用 raw GitHub URL、手动拼接文档路径或华为开发者搜索兜底。

## 回答要求

- 简要说明使用了 MCP 查询，列出最相关的文档标题或来源类型。
- API 类问题要回答接口名、参数、返回值、约束和最小示例。
- 组件/ArkUI 类问题要回答适用组件、属性或方法、状态管理注意点、常见限制。
- 迁移/编译错误类问题要结合 `arkts-ts-rules`，把文档结论转化成可执行改法。
- 不确定时明确说不确定，并说明 MCP 返回结果缺少哪类信息。

## 重要规则

- **已知知识不查**：ArkTS 语法规则（如不用 `any`、不用 `var`）已在 `arkts-ts-rules` skill 中覆盖，不要重复查询。
- **只走 MCP**：文档查询通过 DevEco CodeGenie MCP 完成，不再使用 raw GitHub 文档、手动 URL 拼接或华为开发者搜索兜底。
- **短查询、少结果、再细化**：先查精确关键词，再根据 MCP 结果追加模块名、API 名或错误信息二次查询。
- **来源可追溯**：回答中保留 MCP 返回的文档标题、模块名或来源类型，避免只给无来源结论。
