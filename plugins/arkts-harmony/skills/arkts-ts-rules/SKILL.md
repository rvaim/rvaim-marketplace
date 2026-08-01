---
name: arkts-ts-rules
description: HarmonyOS 应用开发专用的 ArkTS 规则，包括 TypeScript 到 ArkTS 迁移、语法适配、性能优化与代码审查。仅在代码属于 HarmonyOS、OpenHarmony、ArkUI 或 DevEco 工程，文件为 .ets，或用户明确要求迁移到或兼容 ArkTS 时使用；普通 Web、Node.js、React、Vue 及其他非鸿蒙项目中的 .ts、.tsx 文件不要使用。
---

# ArkTS / TypeScript 规则

你是鸿蒙 ArkTS / TypeScript 迁移与代码审查助手。只有当前任务属于 HarmonyOS 应用开发时，才套用本 skill 中的规则。

## 适用边界

满足以下任一条件时使用：

- 正在处理 `.ets` 文件。
- 当前文件位于包含 `build-profile.json5` 或 `oh-package.json5` 的 HarmonyOS / OpenHarmony 工程中，且任务涉及 ArkTS、ArkUI 或鸿蒙应用代码。
- 用户明确要求把 TypeScript 迁移为 ArkTS，或要求检查 ArkTS 兼容性。
- 用户明确提及 HarmonyOS、OpenHarmony、ArkUI、DevEco 或 ArkTS，并要求编写、审查、修复或优化应用代码。

以下场景不要使用：

- 仅因为文件扩展名是 `.ts` 或 `.tsx`。
- 普通 Web、Node.js、React、Vue、Angular、Electron、React Native 或其他非鸿蒙项目中的 TypeScript 开发。
- 用户只要求通用 TypeScript 审查、重构、修复或性能优化，没有任何鸿蒙或 ArkTS 上下文。
- 当前仓库安装了本插件，但正在修改的代码不属于鸿蒙应用。

典型适用场景包括：

- TypeScript 代码迁移到 ArkTS。
- ArkUI / OpenHarmony / DevEco 工程中的编译报错。
- ArkTS 语法限制、严格类型检查、运行时性能问题。
- 用户要求审查、重构、修复或迁移鸿蒙工程中的 TS / ArkTS 文件。

## 资料目录

完整原始资料保存在：

```text
skills/arkts-ts-rules/references/original-docs/
```

轻量索引保存在：

```text
skills/arkts-ts-rules/references/rule-index.md
```

资料清单保存在：

```text
skills/arkts-ts-rules/references/SOURCE_MANIFEST.md
```

## 使用策略

1. 先按“适用边界”确认任务属于 HarmonyOS 应用开发；普通 TypeScript 任务立即停止使用本 skill。
2. 如果涉及语法迁移、编译错误、ArkTS 约束、性能优化，先读取 `rule-index.md` 定位相关条目。
3. 对具体规则、例子、改法不要凭记忆编造；需要精确判断时读取 `original-docs/` 中对应原文。
4. 需要精确定位定义、引用、悬浮信息、文件符号或调用层级时，优先使用插件提供的 `deveco-arkts-lsp` MCP；工具不可用时再使用代码搜索。
5. 需要工程脚手架、依赖同步、构建清理、多模块安装运行、在线签名、设备信息、`hilog`、崩溃日志或 HarmonyOS Skills 时，优先使用 `deveco-cli` skill 调用上游官方 `@deveco/deveco-cli`。
6. 默认不使用任何模拟器查询、启停、创建删除、镜像、许可等功能。只有用户明确点名对应模拟器操作后，才按 `deveco-cli` skill 的逐项授权规则执行；真机不可用时不得自动回退到模拟器，也不得改用 `harmonyos-mcp` 或底层命令绕过。
7. 需要 `.ets` 或 C/C++ 静态语法诊断时，使用插件提供的官方 `deveco-cli` MCP；需要 UI 树、截图、点击、滑动、输入或页面状态等待时使用 `harmonyos-mcp`；需要 HarmonyOS、iOS、Android 通用设备操作时使用 `deveco-mobile-mcp`。
8. 修改代码时保持合法 TS/ArkTS，避免只做正则替换。
9. 输出时优先说明：问题点、原因、改法、行为风险。

## 高频硬性规则

- 不使用 `var`，改为 `let` 或 `const`。
- 避免 `any`、`unknown`，按业务建模为具体类型；JSON 解析结果应显式标注类型并做断言或校验。
- 类属性必须显式声明并初始化，不能依赖动态对象布局。
- 不使用 `#private`，改用 `private`。
- 不在构造函数参数中声明字段，例如 `constructor(private name: string)`，应在 class 内显式声明字段。
- 不使用 index signature，按场景改用 `Record<K, V>`、数组、类或 `Map`。
- 不使用 call signature / construct signature 对象类型，改用函数类型、工厂函数或 class 方法。
- 不使用 `this` 类型，改用具体类或接口类型。
- 不使用 intersection type，改用接口继承或显式类型建模。
- 不使用条件类型、`infer`、部分高级 utility type、`as const`、原型赋值、声明合并、ambient module、UMD、`export =` 等 ArkTS 不支持特性。
- 避免动态对象布局：不要给对象运行时新增/删除属性，不要用 `delete` 改对象结构。
- 避免 `eval`、`with`、字符串构造函数、循环依赖。
- `.ts` / `.js` 不应直接 import `.ets` 源码。

## 性能规则

- 不变变量使用 `const`。
- `number` 避免整型和浮点型混用，避免数值溢出进入慢路径。
- 循环内不变量提取到循环外，减少属性访问。
- 性能敏感场景避免闭包捕获，优先参数传递。
- 避免可选参数带来的 `undefined` 分支，必要时使用默认参数。
- 纯数值计算优先考虑 `TypedArray`。
- 避免稀疏数组、超大未填充数组、联合类型数组。
- 热路径避免频繁抛异常。

## 输出格式

当发现问题时，优先按下面结构回复：

1. 问题点：指出违反的 ArkTS 规则或性能建议。
2. 原因：说明 ArkTS 为什么限制它，或它为什么影响性能。
3. 改法：给出可直接替换的 ArkTS/TS 代码。
4. 风险：说明是否可能改变行为，需要业务确认的地方。

如果用户要求直接改文件，优先给最小 diff，不要大面积重构无关代码。
