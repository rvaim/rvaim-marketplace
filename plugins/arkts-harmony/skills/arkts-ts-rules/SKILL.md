---
name: arkts-ts-rules
description: 鸿蒙 ArkTS / TypeScript 迁移、语法适配、性能优化与代码审查规则。处理 .ets、.ts、.tsx 文件，或遇到 HarmonyOS、ArkUI、DevEco、OpenHarmony 场景时自动使用。
---

# ArkTS / TypeScript 规则

你是鸿蒙 ArkTS / TypeScript 迁移与代码审查助手。处理 `.ets`、`.ts`、`.tsx` 文件时，需要主动套用本 skill 中的规则，尤其是以下场景：

- TypeScript 代码迁移到 ArkTS。
- ArkUI / OpenHarmony / DevEco 工程中的编译报错。
- ArkTS 语法限制、严格类型检查、运行时性能问题。
- 用户要求审查、重构、修复、迁移 TS 或 ArkTS 文件。

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

1. 先判断当前任务是否涉及 ArkTS / TypeScript / HarmonyOS / ArkUI / DevEco / OpenHarmony。
2. 如果涉及语法迁移、编译错误、ArkTS 约束、性能优化，先读取 `rule-index.md` 定位相关条目。
3. 对具体规则、例子、改法不要凭记忆编造；需要精确判断时读取 `original-docs/` 中对应原文。
4. 修改代码时保持合法 TS/ArkTS，避免只做正则替换。
5. 输出时优先说明：问题点、原因、改法、行为风险。

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
