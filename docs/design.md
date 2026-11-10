# HotWord 界面与交互

## 参考与实现

本轮实际浏览了 [recent.design 首页](https://recent.design/) 及下列组件详情。参考网站提供设计展示；HotWord 的组件用 React、Motion 与 CSS 实现，未复制其视频或图片。

| 参考 | HotWord 中的应用 |
| --- | --- |
| 首页的白色侧栏、紧凑胶囊、卡片留白与悬停操作 | 团队工作台、近期任务、候选词卡与词条操作 |
| [Liquid Stepper Interaction](https://recent.design/i/lrtfzrm-liquid-stepper-interaction) | 准备 / 审核 / 导出步骤使用共享布局指示器，阶段以暖色、紫色、绿色渐变反馈；按钮可跳转对应区域 |
| [Dark Light Mode Toggle](https://recent.design/i/yifo62r-dark-light-mode-toggle) | 表头与双向映射开关采用立体滑动拨钮，操作立即影响实际导出内容 |
| [SwiftUI Slider Interaction](https://recent.design/i/542towy-swiftui-slider-interaction) | 每条词的重要度可拖动，数字与导出排序即时响应；支持方向键、Home、End |

审核筛选采用弹簧滑动胶囊。字符预算随词条修改平滑更新；文件拖入时文件叠层轻微倾斜，读取、复制、下载与项目恢复有明确反馈。格式示例卡可交换中英文顺序，并始终保持完整短语。

删除词条提供 10 秒内撤销，恢复完整词条及其属性。云端任务删除通过 Radix 对话框确认，限定键盘焦点；Escape 取消后回到原按钮，确认删除后焦点回到任务列表。

## 规则与可访问性

- 编译规则继续由 `shared/compiler.ts` 负责：热词 2048、指定翻译 20480 UTF-16 单元，计入 BOM 与 CRLF。
- 指定翻译每条一个 ASCII `-`；词条内部连字符和逗号改为空格，中文逗号只分隔完整条目。保留证据、人工确认、必保和双向冲突校验。
- 复制与下载共用最终格式校验，必保超限或必保翻译冲突时均禁用。
- 筛选按钮使用 `aria-pressed`，复选按钮使用 `role=checkbox`，开关使用 `role=switch`，字符预算使用 `role=meter`；图标按钮都有名称。
- 原文与排除详情可折叠；收起区域使用 `inert`，键盘不会进入隐藏内容。
- 数字动画向读屏提供实际值；`prefers-reduced-motion` 禁用位移、数字过渡和 CSS 动效。
- 手机端为单列。审核表在自身区域横向滚动，隐藏辅助文本定位在该区域，避免整页溢出。
- DM Sans 字体随静态资源打包，中文使用系统字体；符合现有仅允许同源字体的生产 CSP。

## 验证

2026-11-10 使用真实 Chromium 浏览器验证：搜索、审核筛选、滑块拖动和键盘、必保、修改译文后取消确认、双向映射、词条删除撤销、复制、TXT 下载、JSON 保存与恢复、CSV 上传、列映射、跳过表头、相同列与空选择保护、分页和超限导出保护。

下载文件另行检查了 BOM、CRLF、UTF-16 字符数与完整映射。删除确认交互使用浏览器拦截的测试任务验证，没有删除真实云端任务。AI 服务本轮未调用；后端提取质量不属于本次 UI 验证。

布局检查覆盖 320 / 390 / 768 / 1024 / 1440 像素与减弱动效模式。截图和临时浏览器验证资料存放在已忽略的 `output/playwright/`；不纳入发布资源。
