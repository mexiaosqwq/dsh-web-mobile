# 补丁登记表（patch registry）

每个补丁必须在源码里用 @patch 块自报 for / why / until / test 四要素。

<!-- BEGIN:generated -->

共 19 条。此表由 `node scripts/patch-registry-check.mjs --write` 生成，
手改无效 —— 检查器会把不一致判为 fatal。

| id | 位置 | 适配对象（for） | 到期条件（until） | 测试（test） |
| --- | --- | --- | --- | --- |
| `ask-question-card-phone` | src/client/styles/layout.css.ts:3496 | dsh-client-ui-user-questions 的 QuestionComposer.module.css（哈希前缀 Mbwy4a_：_frame / _card / _body / _header / _headerActions / _title 等）与其宿主 composerSeat | 宿主把 Mbwy4a_body 的 overflow-x 钉成 hidden/clip 并给五族文本补换行、或卡片自带「展开」形态与键盘感知定高 —— 届时整节删除 | `tests/question-fullscreen.test.ts` |
| `composer-seat-above-header` | src/client/styles/layout.css.ts:1359 | dsh-client-ui-conversation 0.2.1 的 composer 座位（[class*="_composerSeat"]，position:sticky; bottom:0）+ 本插件顶栏规则（header.wSkVaW_header 的 z-index:30 与不透明底） | 宿主把 composer 做成独立浮层（座位自带高于顶栏的层叠层）或提供座位/顶栏之间的层叠契约 —— 届时整块删除 | `tests/composer-clearance.test.ts` |
| `drawer-quick-settings-chip-guard` | src/client/styles/base.css.ts:167 | dsh-client-ui-primitives 的 ConnectionIndicator（connecting/disconnected 渲染 button[data-phase]，recovered 渲染 div[role="status"]）与账户 launcher 同处 settingsArea 的 triggerRow | 宿主给该行提供独立的次要动作位，或连接条不再占用行宽——届时删本块 | `tests/drawer-quick-settings.test.ts` |
| `drawer-quick-settings-menu-entry` | src/client/styles/base.css.ts:178 | dsh-client-ui-settings-account 的 AccountMenu items 数组（settings / contact / signout|signin）与 dsh-client-ui-primitives 的 Menu 列表结构（role=menu > div[role=presentation] > div > button[role=menuitem]） | 宿主给 settings.launcher 提供独立动作位，或账户菜单自己把设置项拆出去——届时删本块 | `tests/drawer-quick-settings.test.ts` |
| `header-chip-seat` | src/client/styles/layout.css.ts:2336 | 宿主 3.0.6 的 headerActions / titleCluster 槽位（子智能体谱系 chip 的座位） | 上游在标题行提供稳定的 actions/title 槽标记，或把该 chip 分到独立容器 | `tests/a2-header-gating.test.ts` |
| `header-job-chip-collapse` | src/client/styles/layout.css.ts:2269 | dsh-client-ui-jobs 的后台任务 chip（0.2.1 起包裹 div 无类名） | 宿主给该 chip 稳定的数据标记，或在手机档自带折叠形态 | `tests/a2-header-gating.test.ts` |
| `image-lightbox-fullbleed` | src/client/styles/layout.css.ts:2786 | dsh-client-ui-primitives ImageLightbox（role=dialog + aria-modal=true，stage 末孩子是关闭按钮） | 宿主给灯箱提供独立的 data-* 标记或自带移动端铺满形态，届时删本块 | `tests/css-rules.test.ts` |
| `installed-list-chatflow-filter` | src/client/effects/installed-list.ts:158 | 共享协调器的「正文整批丢弃」语义（phone-chrome 侧既有过滤） | 宿主把市场根挂到稳定容器、且协调器把 childList 一并按容器路由（届时可改为按容器早期退出） | `tests/installed-list.test.ts` |
| `lineage-chip-pinned` | src/client/styles/layout.css.ts:2479 | 宿主 ZKlsPq 子智能体 chip 的绝对定位落点（含包含块） | 宿主为该 chip 提供非绝对定位的稳定槽（届时四边偏移与祖先 static 都可删） | `tests/a2-header-gating.test.ts` |
| `ofm-mobile-cost-ceiling` | src/client/styles/compat.css.ts:1242 | dsh-our-free-model 2.0.0 的 ofm_ 私有类名（毛玻璃表面 + 极光层 + 装饰动画） | 上游自己给手机档出成本降级（或拿掉极光层与 blur 表面）——届时本块整节删除 | `tests/our-free-model-cost.test.ts` |
| `ofm-toast-above-drawer` | src/client/styles/compat.css.ts:1311 | dsh-our-free-model 2.0.0 的 .ofm_toasts（公告 toast，portal 到 document.body） | 上游把 toast 抬到宿主弹层之上（1400+）或宿主提供官方通知层 —— 届时本块删除 | `tests/our-free-model-toast-layer.test.ts` |
| `plugin-panel-head-left-align` | src/client/styles/layout.css.ts:3089 | dsh-client-ui-plugin-manager 0.2.1-rc.2 的 section[data-plugin-panel] 页首（_pageHead / _pageHeading / h1 三层） | 宿主给页首容器独立标记，或页首不再需要给 FAB 让位，届时删本块 | `tests/css-rules.test.ts` |
| `plugin-panel-subpage-back` | src/client/effects/panel-exit.ts:106 | 0.1.6-alpha.2 宿主的插件管理页子页：列表「更多」头的 button class 含 _moreBack，三种详情根（data-plugin-detail / data-plugin-item-detail / data-plugin-row-detail）里的 crumb button class 含 _crumb | 宿主把面板子页的返回暴露成 ctx.layout / panel 服务上的公开动作，或子页自己进 history | `tests/panel-exit-animation.test.ts` |
| `preset-invisible-capsule` | src/client/styles/layout.css.ts:2549 | 宿主 SVAs4q_label 智能体预设 chip 的外包裹层 | 宿主给预设 chip 自身加上左右内边距（本外壳与 margin 一并删） | `tests/a2-header-gating.test.ts` |
| `session-inspector-disclosure-size` | src/client/styles/compat.css.ts:1355 | @deepseek-ai/dsh-experimental-session-inspector 0.2.1-rc.2（CSS 模块哈希前缀 GTtnTq） | 宿主把 GTtnTq_disclosure 提到 ≥24px，或换成可缩放图标并自带内边距 | `tests/css-rules.test.ts` |
| `session-inspector-sticky-flicker` | src/client/styles/compat.css.ts:1391 | @deepseek-ai/dsh-experimental-session-inspector 0.2.1-rc.2（GTtnTq_table / GTtnTq_sticky） | 宿主把表格改成 border-collapse:separate，或不再用 sticky <tr> 表达祖先上下文 | `tests/css-rules.test.ts` |
| `wallpaper-drawer-fill` | src/client/styles/layout.css.ts:205 | deepseek-harness-background 0.6.x 的 body[data-dsh-bg]（壁纸启用时把 --dsw-specific-sidebar-fill 置为 transparent） | 上游提供不透明的面板填充接缝，或不再把 --dsw-specific-sidebar-fill 置空——届时本块删除 | `tests/wallpaper-surface-fill.test.ts` |
| `wallpaper-header-fill` | src/client/styles/layout.css.ts:1213 | deepseek-harness-background 0.6.x 的 body[data-dsh-bg]（壁纸启用时把 --dsw-alias-bg-base 置为 transparent） | 上游提供不透明的面板填充接缝，或不再把 --dsw-alias-bg-base 置空——届时本块删除 | `tests/wallpaper-surface-fill.test.ts` |
| `zen-remote-header-yield` | src/client/styles/layout.css.ts:3740 | dsh-zen-remote 2.2.5 的手机档 header reflow（headerActions 里注入 [data-mobile-nav="header-back"]，titleRow 改成 92px/1fr/92px 三栏，titleCluster 靠 display:contents 变成直系 grid 项） | dsh-zen-remote 不再重排 header，或它改为不依赖 display:contents 的稳定槽位，届时删本块 | `tests/a2-header-gating.test.ts` |

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
| `src/client/styles/layout.css.ts` | 539 | 627 | 299 |
| `src/client/styles/compat.css.ts` | 388 | 112 | 20 |
| `src/client/styles/misc.css.ts` | 57 | 21 | 13 |
| `src/client/styles/base.css.ts` | 18 | 4 | 12 |
| `src/client/effects/installed-list.ts` | 3 | 5 | 0 |
| `src/client/effects/phone-chrome.ts` | 2 | 0 | 0 |
| `src/client/effects/sidebar-swipe.ts` | 2 | 1 | 0 |
| `src/client/core/css-rules.ts` | 1 | 2 | 3 |
| `src/client/effects/stats-line.ts` | 1 | 10 | 0 |
| `src/client/debug.ts` | 0 | 5 | 0 |
| `src/client/effects/aionui-compat.ts` | 0 | 4 | 0 |
| `src/client/effects/composer-clearance.ts` | 0 | 2 | 0 |
| `src/client/effects/composer-keyboard-lift.ts` | 0 | 2 | 0 |
| `src/client/effects/composer-plus-toggle.ts` | 0 | 1 | 0 |
| `src/client/effects/drawer-close.ts` | 0 | 10 | 0 |
| `src/client/effects/drawer-quick-settings.ts` | 0 | 2 | 0 |
| `src/client/effects/drawer-session-log.ts` | 0 | 4 | 0 |
| `src/client/effects/model-menu-anchor.ts` | 0 | 3 | 0 |
| `src/client/effects/model-menu-keyboard-guard.ts` | 0 | 1 | 0 |
| `src/client/effects/panel-exit.ts` | 0 | 11 | 0 |
| `src/client/effects/plugin-card-tap.ts` | 0 | 2 | 0 |
| `src/client/effects/question-fullscreen.ts` | 0 | 5 | 0 |
| `src/client/effects/session-menu.ts` | 0 | 7 | 0 |
| `src/client/effects/subagent-chip-touch.ts` | 0 | 6 | 0 |
| `src/client/effects/workspace-chip-toggle.ts` | 0 | 1 | 0 |
| **合计** | **1011** | **848** | **347** |

<!-- END:inventory -->
