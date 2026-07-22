# 鸿蒙黑体与文本排版

## HarmonyOS Sans

HarmonyOS Sans 是系统默认无衬线字体，覆盖简体中文、繁体中文，并广泛支持拉丁、希腊、西里尔和阿拉伯语系。它强调屏幕清晰度、多语言基线协调、自然笔意与跨设备一致性。

可用粗细包括 `Thin`、`UltraLight`、`Light`、`Regular`、`Medium`、`SemiBold`、`Bold`、`Heavy`、`Black`。同时支持可变字重，以及 `Condensed`、`Italic` 等样式。

常用 OpenType 特性包括：`sups`、`subs`、`sinf`、`numr`、`dnom`、`tnum`、`pnum`、`case`、`frac`、`ordn`、`liga`、`fwid`、`hwid`、`vert`。

## 文本层级 Token

下表单位为 `vp`；`-` 表示官方表未提供该设备规格。

| 类别 | Token | 字重 | 手机 | 电脑 | 穿戴 |
|---|---|---:|---:|---:|---:|
| 展示 | `Display_L` | Light | 56 | 54 | 56 |
| 展示 | `Display_M` | Light | 48 | 46 | 48 |
| 展示 | `Display_S` | Light | 38 | 36 | 38 |
| 标题 | `Title_L` | Bold | 30 | 28 | 30 |
| 标题 | `Title_M` | Bold | 24 | 22 | 24 |
| 标题 | `Title_S` | Bold | 20 | 18 | 20 |
| 副标题 | `Subtitle_L` | Medium | 18 | 16 | 18 |
| 副标题 | `Subtitle_M` | Medium | 16 | 14 | 16 |
| 副标题 | `Subtitle_S` | Medium | 14 | 12 | 14 |
| 正文 | `Body_L` | Medium | 16 | 14 | 16 |
| 正文 | `Body_M` | Regular | 14 | 14 | 14 |
| 正文 | `Body_S` | Regular | 12 | 14 | 12 |
| 说明 | `Caption_L` | Medium | 12 | 12 | 12 |
| 说明 | `Caption_M` | Medium | 10 | 9 | 10 |
| 说明 | `Caption_S` | Medium | - | - | 8 |

## 选型规则

- 展示文本只承载需要吸引注意的短内容，例如核心数值或结果。
- 标题标识页面或区域，副标题组织更细的内容层级。
- 正文用于列表和长内容，说明用于标签、图片提示和图标说明。
- 保证最小可读字号、足够对比度、统一字体风格和有限层级。
- 支持系统大字体，不要用固定容器高度截断放大后的文字。
- 避免同时滥用字号、字重和颜色制造过多层级。

## 排版审查

检查行首标点缩进与禁则、行尾标点悬挂、连续标点、中西文混排间距、孤字成行、中文两端对齐、英文平衡与按音节换行，以及小语种所需的行高变化。

系统字体不能满足品牌或沉浸场景时才使用自定义字体，并在不同视距、语言、设备与大字体模式下重新验证可读性。
