# 原始资料清单

四个上传文件已完整保留在 `original-docs/`，未再压缩成摘要。

| 文件 | 说明 | 字节数 | SHA-256 |
|---|---:|---:|---|
| `arkts-migration-background.md` | ArkTS 语法适配背景 | 9961 | `7be971f90f13691c99833e18f7b7d3274beff90ab3a9a46b06eded4edfaa71d7` |
| `typescript-to-arkts-migration-guide.md` | 从 TypeScript 到 ArkTS 的适配规则 | 100307 | `a523fac614da3a1cb6e9b38f2c018015599f261c586395b65eccea7aa8df2cba` |
| `arkts-more-cases.md` | 适配指导案例 | 70921 | `f9f4492e201e89896db4c15dbda098c411366d8d95410da6babd73a0473ea6ad` |
| `arkts-high-performance-programming.md` | ArkTS 高性能编程实践 | 9600 | `0bf68c35d5bd91b63d0b754fd97c02483855c1fa0cb54a65c96e37ce89f350a2` |

使用规则：

- 先读 `rule-index.md` 判断可能相关的规则。
- 遇到具体 ArkTS/TS 代码改造、报错、迁移、性能判断时，再读取 `original-docs/` 中的完整原文。
- 自动 hook 只做轻量扫描，不会把四个全文每次塞进上下文。
