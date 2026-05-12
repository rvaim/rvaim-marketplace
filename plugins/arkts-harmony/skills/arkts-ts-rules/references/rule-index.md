# ArkTS / TypeScript 规则索引

本文件是轻量索引。完整原文在 `original-docs/`，不要只依赖本文件做最终判断。

## 原始资料

| 文件 | 说明 |
|---|---|
| `original-docs/arkts-migration-background.md` | ArkTS 语法适配背景、稳定性、性能、兼容性。 |
| `original-docs/typescript-to-arkts-migration-guide.md` | 从 TypeScript 到 ArkTS 的完整适配规则。 |
| `original-docs/arkts-more-cases.md` | 适配指导案例，包含大量“应用代码 / 建议改法”。 |
| `original-docs/arkts-high-performance-programming.md` | ArkTS 高性能编程实践。 |

## 常见硬性规则

- `arkts-no-var`：使用 `let` / `const`，不要使用 `var`。
- `arkts-no-any-unknown`：不要使用 `any` / `unknown`。
- `arkts-no-private-identifiers`：不要使用 `#private`，改用 `private`。
- `arkts-no-ctor-prop-decls`：不要在构造函数参数中声明字段。
- `arkts-no-indexed-signatures`：不要使用 index signature，改用 `Record`、数组、类或 `Map`。
- `arkts-no-intersection-types`：不要使用 intersection type，改用 interface extends。
- `arkts-no-typing-with-this`：不要使用 `this` 类型。
- `arkts-no-conditional-types`：不要使用条件类型和 `infer`。
- `arkts-no-delete`：不要用 `delete` 删除对象属性。
- `arkts-no-func-apply-call` / `arkts-no-func-bind`：避免 `apply`、`call`、`bind`。
- `arkts-no-as-const`：不要使用 `as const`。
- `arkts-strict-typing-required`：不要用 `@ts-ignore`、`@ts-nocheck` 绕过类型检查。
- `arkts-no-tsdeps`：`.ts` / `.js` 不应 import `.ets` 源码。

## 性能建议

- 不变变量用 `const`。
- `number` 避免整型和浮点型混用。
- 避免数值溢出导致慢路径。
- 循环中常量、不变量提取到循环外。
- 性能敏感场景避免闭包捕获。
- 避免可选参数造成额外 `undefined` 分支。
- 纯数值数组优先考虑 `TypedArray`。
- 避免稀疏数组、联合类型数组、频繁抛异常。
