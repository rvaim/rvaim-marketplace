---
name: harmonyos-docs
description: 查阅 HarmonyOS/OpenHarmony 应用开发文档。仅在你不确定或不知道某个 API、组件、Kit 用法时使用，涵盖开发指南和 API 参考两大类文档。已知的知识直接回答即可。
---

# HarmonyOS 应用开发文档查阅

仅在 **不确定或不知道** HarmonyOS/OpenHarmony 的 API、组件、Kit 开发指南时才查文档。已知规则（如 ArkTS 语法限制）直接使用已有知识回答，不要重复查询。

## 两类文档入口

### 开发指南（应用开发）

中文入口：

```
https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/zh-cn/application-dev/Readme-CN.md
```

中文基 URL：`https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/zh-cn/application-dev/`

英文兜底入口：

```
https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/en/application-dev/Readme-EN.md
```

英文基 URL：`https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/en/application-dev/`

涵盖：Ability Kit、ArkUI、ArkTS、ArkData、媒体、图形、安全、网络、AI 等所有 Kit 的开发指南和设计说明。

官方搜索兜底：

```
https://developer.huawei.com/consumer/cn/doc/search?type=guides&val={关键词}
```

### API 参考

中文入口：

```
https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/zh-cn/application-dev/reference/Readme-CN.md
```

中文基 URL：`https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/zh-cn/application-dev/reference/`

英文兜底入口：

```
https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/en/application-dev/reference/Readme-EN.md
```

英文基 URL：`https://raw.githubusercontent.com/rvaim/openharmony-docs/refs/heads/master/en/application-dev/reference/`

涵盖：所有模块的 API 接口定义、参数说明、返回值、枚举等精确接口文档。

官方搜索兜底：

```
https://developer.huawei.com/consumer/cn/doc/search?type=API&val={关键词}
```

## 选入口策略

- 用户问 "怎么用 X"、"如何实现 Y"、"X 是什么" → 开发指南
- 用户问 "X 的参数是什么"、"Y 返回什么类型"、"Z 接口签名" → API 参考
- 不确定属于哪类 → 先查开发指南，目录中会有 API 参考的交叉链接
- 中英文 raw 文档都没有结果 → 按同一问题类型使用华为开发者官方搜索；不确定属于哪类时同时查 guides 和 API

## 查找策略

1. 根据问题类型选择上述两个中文入口之一，用 WebFetch 拉取目录页。
2. 解析页面中所有 Markdown 链接 `[文本](URL)`。
3. 匹配链接文本中的关键词（Kit 名、组件名、API 模块名）。
4. `Readme-CN.md` 结尾 → 子目录索引，继续下钻。
5. 其他 `.md` 结尾 → 目标文档，拼接完整 URL 拉取内容。
6. 如果中文入口、中文目录链接或中文目标文档拉取不到、返回 404、目录中没有匹配链接，切换到对应英文入口和英文基 URL 重新查找。英文目录使用 `Readme-EN.md`。
7. 如果英文入口、英文目录链接或英文目标文档也拉取不到、返回 404、目录中没有匹配链接，打开或提供华为开发者官方搜索链接兜底。
8. 外部链接（`https://gitcode.com` 等）→ 告知用户直接访问。

## URL 拼接规则

- 开发指南相对路径 → 拼到当前语言的开发指南基 URL 后。
- API 参考相对路径 → 拼到当前语言的 API 参考基 URL 后。
- `../` 跳出当前目录 → 解析为更上层路径。
- 优先用 `raw.githubusercontent.com` 的 raw Markdown 格式，而非 `github.com/blob/`。
- 中文路径和英文路径只替换语言目录与索引后缀：`zh-cn/.../Readme-CN.md` 对应 `en/.../Readme-EN.md`。
- 官方搜索中的 `{关键词}` 必须替换为 URL 编码后的查询词，例如组件名、Kit 名或 API 名。

## 开发指南顶层结构

| 区域 | 入口 |
|------|------|
| 入门 | `quick-start/Readme-CN.md` |
| Ability Kit | `application-models/Readme-CN.md` |
| ArkData | `database/Readme-CN.md` |
| ArkTS | `arkts-utils/Readme-CN.md` |
| ArkUI | `ui/Readme-CN.md` |
| ArkWeb | `web/Readme-CN.md` |
| 后台任务 | `task-management/Readme-CN.md` |
| 文件管理 | `file-management/Readme-CN.md` |
| 卡片 | `form/Readme-CN.md` |
| IPC | `ipc/Readme-CN.md` |
| 安全 | `security/` (多个子 Kit) |
| 网络 | `connectivity/`, `network/`, `telephony/` |
| 媒体 | `media/` (audio/avcodec/camera/image 等) |
| 图形 | `graphics/`, `graphics3d/` |
| AI | `ai/mindspore/`, `ai/nnrt/` |
| Native API | `napi/Readme-CN.md` |
| 性能 | `performance/Readme-CN.md` |
| 常见问题 | `faqs/Readme-CN.md` |

英文兜底时把上表入口中的 `Readme-CN.md` 替换为 `Readme-EN.md`，并使用英文基 URL。

## 重要规则

- **已知知识不查**：ArkTS 语法规则（如不用 `any`、不用 `var`）已在 `arkts-ts-rules` skill 中覆盖，不要重复查询。
- **逐级查找**：不要猜测 URL，每级拉取目录后确认下一步。
- **中文优先，英文兜底，官方搜索最后兜底**：只有中文入口或中文链接不可用、找不到匹配项时，才使用英文入口；中英文都没有结果时，打开或提供华为开发者官方搜索链接。
- **长文档做摘要**：WebFetch 用 `prompt` 参数描述要提取的信息，避免全量返回。
- **外部链接处理**：华为开发者官方搜索是中英文 raw 文档都失败后的兜底，站点可能拦截命令行抓取；其他非 raw.githubusercontent.com 域直接告知用户链接。
