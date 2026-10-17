# 补丁登记表（patch registry）

每个补丁必须在源码里用 @patch 块自报 for / why / until / test 四要素。

<!-- BEGIN:generated -->

共 6 条。此表由 `node scripts/patch-registry-check.mjs --write` 生成，
手改无效 —— 检查器会把不一致判为 fatal。

| id | 位置 | 适配对象（for） | 到期条件（until） | 测试（test） |
| --- | --- | --- | --- | --- |
| `header-chip-seat` | src/client/styles/layout.css.ts:2191 | 宿主 3.0.6 的 headerActions / titleCluster 槽位（子智能体谱系 chip 的座位） | 上游在标题行提供稳定的 actions/title 槽标记，或把该 chip 分到独立容器 | `tests/a2-header-gating.test.ts` |
| `header-job-chip-collapse` | src/client/styles/layout.css.ts:2124 | dsh-client-ui-jobs 的后台任务 chip（0.2.1 起包裹 div 无类名） | 宿主给该 chip 稳定的数据标记，或在手机档自带折叠形态 | `tests/a2-header-gating.test.ts` |
| `installed-list-chatflow-filter` | src/client/effects/installed-list.ts:158 | 共享协调器的「正文整批丢弃」语义（phone-chrome 侧既有过滤） | 宿主把市场根挂到稳定容器、且协调器把 childList 一并按容器路由（届时可改为按容器早期退出） | `tests/installed-list.test.ts` |
| `lineage-chip-pinned` | src/client/styles/layout.css.ts:2331 | 宿主 ZKlsPq 子智能体 chip 的绝对定位落点（含包含块） | 宿主为该 chip 提供非绝对定位的稳定槽（届时四边偏移与祖先 static 都可删） | `tests/a2-header-gating.test.ts` |
| `ofm-mobile-cost-ceiling` | src/client/styles/compat.css.ts:1306 | dsh-our-free-model 2.0.0 的 ofm_ 私有类名（毛玻璃表面 + 极光层 + 装饰动画） | 上游自己给手机档出成本降级（或拿掉极光层与 blur 表面）——届时本块整节删除 | `tests/our-free-model-cost.test.ts` |
| `preset-invisible-capsule` | src/client/styles/layout.css.ts:2394 | 宿主 SVAs4q_label 智能体预设 chip 的外包裹层 | 宿主给预设 chip 自身加上左右内边距（本外壳与 margin 一并删） | `tests/a2-header-gating.test.ts` |

`why`（为何不能用正规写法）逐条写在源码的 @patch 块里 —— 它必须贴着代码，
因为读代码的人不会先来翻这张表。

<!-- END:generated -->

<!-- BEGIN:inventory -->

### 存量盘点（未自报的历史补丁）

下表由 `--write` 生成。**它不是待办清单，也不是许可** —— 是"这堆东西有多大"的机械读数：
存量补丁不可能一次清完（会动到刚在真机验收过的几何），但**可以不再无声增长**。
按代际分批收编时，看的就是这几列数字有没有往下走。

| 模块 | `!important` | 哈希子串选择器 | `:has(` |
| --- | --- | --- | --- |
| `src/client/styles/layout.css.ts` | 459 | 494 | 254 |
| `src/client/styles/compat.css.ts` | 385 | 113 | 20 |
| `src/client/styles/misc.css.ts` | 51 | 18 | 12 |
| `src/client/styles/base.css.ts` | 15 | 2 | 11 |
| `src/client/effects/installed-list.ts` | 3 | 5 | 0 |
| `src/client/effects/phone-chrome.ts` | 2 | 0 | 0 |
| `src/client/effects/sidebar-swipe.ts` | 2 | 1 | 0 |
| `src/client/core/css-rules.ts` | 1 | 2 | 3 |
| `src/client/effects/stats-line.ts` | 1 | 9 | 0 |
| `src/client/debug.ts` | 0 | 5 | 0 |
| `src/client/effects/aionui-compat.ts` | 0 | 4 | 0 |
| `src/client/effects/composer-keyboard-lift.ts` | 0 | 2 | 0 |
| `src/client/effects/composer-plus-toggle.ts` | 0 | 1 | 0 |
| `src/client/effects/drawer-close.ts` | 0 | 9 | 0 |
| `src/client/effects/model-menu-anchor.ts` | 0 | 3 | 0 |
| `src/client/effects/model-menu-keyboard-guard.ts` | 0 | 1 | 0 |
| `src/client/effects/panel-exit.ts` | 0 | 6 | 0 |
| `src/client/effects/plugin-card-tap.ts` | 0 | 2 | 0 |
| `src/client/effects/session-menu.ts` | 0 | 7 | 0 |
| `src/client/effects/subagent-chip-touch.ts` | 0 | 6 | 0 |
| `src/client/effects/workspace-chip-toggle.ts` | 0 | 1 | 0 |
| **合计** | **919** | **691** | **300** |

<!-- END:inventory -->
