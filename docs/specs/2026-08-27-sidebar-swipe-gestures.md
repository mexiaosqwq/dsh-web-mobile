# 侧边栏抽屉手势滑动方案

> **评审状态**：经两轮独立对抗评审（2026-08-27），最终定档 **A 档（松手判定式，不跟手）**。第一轮"跟手拖动"初稿被判定存在 2 个致命缺陷；第二轮独立复核确认缺陷 2 必然成立、缺陷 1 特定场景成立，A 档零 inline transform 使两个缺陷风险面均为 0。评审记录见文末。

## 概述

为 `dsh-mobile-nav` 插件添加侧边栏抽屉的手势操作支持：**屏幕左边缘右滑呼出抽屉 + 抽屉内容区右滑关闭抽屉**。使用户在手机竖屏下获得与原生 App 一致的"边缘滑出/内容拖回"肌肉记忆。本方案对应上游 Issue #16（wingsky-1 提出，维护者以 completed 关闭但未实现，无任何手势 PR）。

## 现状

- 窄屏下（<1024px）侧边栏变为 overlay 抽屉
- 交互：点击 toggle 按钮 / 点击 FAB 打开，点击 backdrop / Escape / 导航项点击关闭
- **无任何手势操作**
- 状态契约：`[data-mobile-nav="frame"]` 上的 `data-sidebar-collapsed` marker；唯一状态入口 `ctx.layout.toggleSidebar()`
- 抽屉 DOM：frame 首个子元素，关闭 `transform: translateX(-110%)` / 打开 `transform: none`，transition `.28s`

## 技术选型：A 档（松手判定式，不跟手）

### 方案定义

```
屏幕左缘 24px 热区右滑 / 抽屉内容区右滑
  → 记录起点/位移/最近窗口速度
  → 方向锁定（|dx| > 1.5·|dy| 且 |dx| > 8px）
  → release 时按"位移比例 OR 速度"判定
  → 命中：直接 ctx.layout.toggleSidebar()（动画全交现有 .28s CSS transition）
  → 未命中：无操作
```

**零 inline transform、零手势层 backdrop、零过渡期竞态**。抽屉几何只由宿主 CSS transition 驱动，与"点击 toggle"路径完全同构。

### 为什么不是"跟手拖动"（B 档）

| 项 | 结论 | 依据 |
|---|---|---|
| 缺陷 1（跟手 transform 违反 `transform:none` 不变式） | 打开方向天然不可达（设置对话框只能从抽屉内打开）；关闭方向依赖"aria-modal 让位 + 每帧守卫"才是安全（若只在 pointerdown 查一次，拖拽中模态升起仍会偏移设置遮罩 102px） | layout.css.ts L66-77 实证 + AGENTS.md L85 |
| 缺陷 2（backdrop 双归属） | **必然成立**：reconciler 用闭包局部变量 `backdrop === null` 判定创建/销毁，从不查 DOM；手势层自建 backdrop → release 后 rAF flush 必再建一个 → 双遮罩 + 孤儿节点 | overlay-backdrop-fab.ts L9/L23/L30 |
| B 档价值打折 | 遮罩跟手被缺陷 2 禁止（取 reconciler 引用做 opacity 跟手 = 脆弱依赖 + 竞态），只剩抽屉本体跟手；rAF 拖拽帧与 reconciler 的 rAF 合并 flush 抢帧 | — |
| 审查/维护成本 | A 档 ~110 行、状态机可穷举、判定纯函数可 node:test；B 档 ~200+ 行 + 每帧守卫 + backdrop 归属，每个点都在碰铁律 | — |
| 升级路径 | A 档把"判定"与"提交执行器"解耦（`classifySwipe` 纯函数 + `commit` 回调），未来升 B 档只换 commit 实现，零沉没成本 | — |

### 为什么不引入第三方库

宿主浏览器模块表 `window.__ModuleLoader__` 的各 client bundle 通过**内联自身依赖**注册模块，裸 require 只能命中 DSH 内置包（react、`@deepseek-ai/*` 及少数内置三方）。`@use-gesture` 不在内置集；`scripts/build-client.mjs` 只内联相对模块，第三方库内联需重写打包器（违反 AGENTS.md 且膨胀产物）。**自研是唯一务实路径**（业界 vaul/MUI 核心同样是自研 Pointer Events）。

## 业界参数（源码级调研 2026-08-27）

成熟实现：MUI SwipeableDrawer（ratio 52% / vel 0.45px/ms / 热区 20px / 轴锁 3px / **iOS 默认禁边缘滑出**）、vaul（ratio 25% / vel 0.4px/ms / 纯 CSS transition / 滚动后 100ms 锁）、RNGH DrawerLayout（50% 投影 / 热区 20px / 3px 起判）、@use-gesture（swipe 50px+0.5px/ms+250ms / rubberband c=0.15）。

### 本方案参数（实装值，第三轮调优 2026-08-27）

> 演进：初稿 → 第二轮（用户反馈"行程太长"：open 0.30→0.20 / close 0.24→0.16）→ **第三轮（用户反馈"识别成对话内容滚动"：起点区 24→48px、轴锁定 1.5×→首段 8px 横向主导、速度窗口 120→60ms 末尾两点、阈值 0.20/0.16→0.16/0.13、新增边缘触摸 touchmove preventDefault）**。均经 CDP 探针验证（`scripts/cdp-swipe-probe.mjs` 21 项 + `scripts/cdp-swipe-failures.mjs` 7 场景全绿）。

| 参数 | 值 | 说明 |
|---|---|---|
| `startZonePx` | **48** | 识别起点区（**视觉热区仍 24px**，layout.css.ts `[data-mobile-nav="hotspot"]` 只管视觉；真实手指落点 30-50px 家常便饭，24px 起步判定是"识别成滚动"主因之一；距离/速度阈值仍兜底，放宽起点不会误触） |
| `lockPx` | **8** | 轴锁定：首段 8px 内 `\|dx\| > \|dy\|` 即锁横向（弃 1.5× 偏置——会拒绝 ~45° 自然斜滑）；纵向主导即放弃交还滚动 |
| `openDistanceRatio` | **0.16** 视口宽（390px→62px） | 打开阈值（vaul 25% 之下，轻快手感） |
| `closeDistanceRatio` | **0.13**（51px@390px） | 关闭阈值（比打开低，主动操作为主） |
| `velocityWindowMs` | **60** | 窗口末尾两点斜率（瞬时），弃 120ms 首尾平均（慢拖后快甩被稀释） |
| `openVelocity` / `closeVelocity` | **0.45 px/ms** | MUI 同款；速度 OR 距离任一满足即提交 |
| `cooldownMs` | **350** | 覆盖 .28s transition，防动画中反向手势双翻 |
| 判定组合 | `ratio ≥ X \|\| velocity ≥ V` | OR 非 AND（慢速长拖 / 快速短滑都有效） |
| 边缘触摸优先 | document 捕获 `touchmove`（passive:false）`preventDefault` | 起点在识别区内 stroke 完全不被浏览器滚动抢占（iOS 合成器会抢边缘横滑/斜滑；防滚后事件流完整，iOS UIScreenEdgePanGestureRecognizer 语义）；纵向主导 reset 后恢复滚动 |

## 文件级设计

| 文件 | 改动 |
|---|---|
| `src/client/effects/gesture-guard.ts` | **新增**，零 import；`markGestureConsumed(target, windowMs)` / `consumeIfGestured(event)` 共存契约 |
| `src/client/effects/sidebar-swipe.ts` | **新增**；仅 import 同目录 `./phone-chrome.ts` + runtime 类型；纯判定函数 + `installSidebarSwipe(ctx)` |
| `src/client/effects/phone-chrome.ts` | `installOverlayInteractions` 的 onDrawerClick / onDrawerPointerUp 首行加 `if (consumeIfGestured(event)) return`（2 行谓词） |
| `src/client/styles/layout.css.ts` | 追加：热区 section + **drawer 滚动容器 `touch-action: pan-y`**（关键一行） |
| `src/client/index.tsx` | `installOverlayInteractions(ctx)` 后加一行 `installSidebarSwipe(ctx)` |

### 核心函数签名

```ts
export interface SwipeThresholds {
  openDistanceRatio: number; closeDistanceRatio: number
  velocityWindowMs: number; openVelocity: number; closeVelocity: number
  lockPx: number; cooldownMs: number; startZonePx: number
}

// 纯判定（node:test 直测）
export function classifySwipe(
  t: SwipeThresholds & { viewportWidthPx: number; drawerOpen: boolean },
  m: { dx: number; dy: number; velX: number },
  rtl: boolean,
): 'open' | 'close' | 'none'

export function slidingVelocity(
  samples: Array<{ t: number; x: number }>, windowMs: number, now: number,
): number   // 窗口末尾两点斜率（瞬时）

export function hitTestStart(
  clientX: number, viewportWidthPx: number, rtl: boolean,
  t: Pick<SwipeThresholds, 'startZonePx'>,
): boolean

export function installSidebarSwipe(ctx: ClientContext): void
```

### 状态机

```
IDLE ──pointerdown(几何命中: 左缘24px 或 drawer 内容区, 非 kebab/backdrop, 无 aria-modal, cooldown 外)──▶ ARMED
ARMED ──位移锁定(|dx|>1.5|dy| 且 |dx|>8px)──▶ TRACKING
TRACKING ──每帧采样(窗口速度) + 每帧查 aria-modal(升起即取消)──▶ release
RELEASE ──classifySwipe──▶ 'open'|'close' → markGestureConsumed + ctx.layout.toggleSidebar()（记 cooldown）
                        └──▶ 'none' / pointercancel / visibilitychange(hidden) / blur → 直接 IDLE
```

- 判定方向永远与当前 `drawerOpen()` 一致（open 要求 closed、close 要求 open），过渡期 marker 已翻转 → 同向助推天然无副作用；冷却只防动画中反向操作
- 不主动 `setPointerCapture`（避免干扰滚动，浏览器滚动抢占走 `pointercancel` 兜底）
- 热区 DOM **不挂任何监听**（几何判定优先），只作视觉/触控层

### 与现有交互共存机制（关键）

宿主 `installOverlayInteractions` 已在 document 捕获阶段监听 click + pointerup（含 iOS click 被抑制时"宏任务后重发 click"的自愈逻辑），且**先注册先执行**——纯新增文件不碰宿主无法共存，必须走谓词：

1. 宿主 `onDrawerClick` / `onDrawerPointerUp` 首行 `if (consumeIfGestured(event)) return`（phone-chrome.ts 改 2 行）
2. 手势层判定为手势后 `markGestureConsumed(up.target 链, 300)` 并同步 `toggleSidebar()`
3. 手势层自身注册 document 捕获 click：`consumeIfGestured` 命中 → `stopPropagation() + preventDefault()` → 挡住**元素级**监听（FAB/backdrop 的 `addEventListener('click', toggleSidebar)`）

**自愈路径不被掐死**：非手势 tap → 谓词集合空 → 宿主原样自愈；手势 up → 宿主 timer 排定后 `toggleSidebar()` 已同步翻转 marker → 自愈回调 `drawerOpen()` false 直接 return；即使 React 异步未翻，合成 click 也撞 `consumeIfGestured`。两条时序均封闭，自愈逻辑一行未动。

### 热区 DOM/CSS

- `[data-mobile-nav="frame"] > [data-mobile-nav="hotspot"]`，`position:absolute; inset-inline-start:0; top:0; bottom:0; width:24px; z-index:30`（< 抽屉 40、> 主内容）
- `aria-hidden="true"`、无 role/tabindex（不进无障碍树）
- **必须 `@media (max-width: 1023px)` 包裹**（≥1024px 热区不存在，桌面零回归）
- **`touch-action: pan-y` 加在 drawer 滚动容器**（`[data-mobile-nav="frame"] > :first-child`）——不加则横滑被浏览器当滚动吃掉并发 pointercancel，手势全失效（比热区更关键的一行）
- taskboard/ssh 全屏接管态：effect 按需不创建热区（复用 heroPhase 判定移植），CSS 不感知

### 平台与可达性

| 项 | 策略 |
|---|---|
| iOS 边缘滑出 | **用户在 PWA/standalone（添加到主屏幕）模式下使用**（Issue #16 的 iOS 主路径：standalone 下 Safari 无网页边缘返回手势，冲突自然化解）→ **启用边缘滑出**；浏览器标签页内仍保留"默认禁用边缘滑出、仅内容区右滑关闭"的配置开关 `edgeSwipe: 'on'\|'off'` 预留（MUI 同款），判定实现用 UA 探测（iPhone/iPad + AppleWebKit + 非 CriOS/FXiOS + maxTouchPoints>1），配置点预留在插件 options |
| Android 13+ 边缘返回 | 系统手势抢占时 JS 收不到 pointerdown，天然让位无副作用；不硬阻断 |
| reduced-motion | 判定逻辑不变（滑动开关是导航可达性）；动画降级交宿主 CSS transition（不新增自写动画） |
| RTL | 热区用 `inset-inline-start:0` 自动镜像；几何判定取 `getComputedStyle(frame).direction`，`classifySwipe` 接收 rtl 镜像 dx 符号 |
| aria-modal 打开 | pointerdown **和每帧**检查 `[aria-modal="true"]`，出现即取消（防误提交） |
| 多指 | 仅跟踪第一指；后续 pointerdown 忽略 |
| WebView | 与浏览器相同；Android WebView 无系统边缘返回，全功能 |

## 测试策略

**node:test 纯函数单测（`tests/sidebar-swipe.test.ts`）**：`classifySwipe` 决策表（开/关/none × 距离/速度/bias × RTL × reduced-motion 不变性）；`slidingVelocity`（窗口裁剪、瞬时 vs 整段、空样本）；`hitTestStart`（24px 带内外、RTL、视口边界）；gesture-guard（mark/consume 一次性语义、target 链、过期）；状态机转移（注入假时间戳）。

**CDP 验证清单（390×844 mobile，全新 user-data-dir）**：
1. 边缘滑出打开：marker 翻转；逐帧采样 `getComputedStyle(drawer).transform` 断言**无插件写入**（仅宿主 none/-110% 两态）
2. 设置对话框（aria-modal）打开后：手势不生效、模态内 click 正常穿透
3. 双遮罩断言：开→关→开后 `[data-mobile-nav="backdrop"]` 数量恒为 1
4. 自愈回归：触摸 tap sessionRow（无手势）→ 会话打开 + 抽屉关（合成 click 未被误吞）
5. 手势后零副作用：内容区右滑关闭 → 无会话切换、无 FAB/backdrop 二次 click
6. 桌面 ≥1024px：无热区 DOM、无监听副作用、与禁用插件布局一致
7. 纵向滚动不触发手势（pointercancel + touch-action 生效）

**真机清单**：iPhone Safari（边缘滑出默认禁/内容右滑关闭/自愈导航/模态交互）、Android Chrome 13+（边缘滑出与系统返回观感/兜底）、768-1023px 平板（阈值按视口比例自适应）、深/浅主题、与子代理芯片菜单同屏不互踩。

## 实施步骤

1. `gesture-guard.ts` + `sidebar-swipe.ts` + `tests/sidebar-swipe.test.ts`
2. `phone-chrome.ts` 加 2 行谓词；`layout.css.ts` 加热区 + drawer 滚动容器 pan-y；`index.tsx` 注册一行
3. `pnpm verify && pnpm test:core && pnpm build`（lib/ 刷新入库）
4. 新 marker 登记进 AGENTS.md DOM marker 清单
5. CDP 清单 + 真机验证；更新 README changelog

## 待用户确认

1. **手势范围**：边缘滑出打开 + 内容区右滑关闭（推荐，A 档完整）；还是仅边缘滑出打开（最小）？
2. **iOS 策略**：默认禁用边缘滑出打开（MUI 同款，推荐，避开 Safari 边缘返回手势冲突），保留内容区右滑关闭；还是 iOS 全功能开放？
3. **设置开关**：是否加"边缘手势"设置开关（可默认开启）？本版可先不加（保持最小），预留配置点。
4. **平板 768-1023px**：手势是否启用（Issue #16 倾向启用；本方案参数按视口比例自适应，默认启用）？
5. **开发基线**：v2.1.5（fork 已同步，推荐，含 41 个后续修复）；v2.0.0（用户实装）？

## 实测记录（2026-08-27，隔离环境 CDP，21 项断言全绿）

环境：隔离 DSH_HOME + link 本地 fork + `dsh web --port 3456` + headless Chrome（`scripts/cdp-swipe-probe.mjs`，复用 cdp-probe.mjs 的 CDP 基础设施 + `Input.dispatchTouchEvent` 触摸注入）。

**CDP 清单 7 项全部通过**：边缘滑出打开（marker 翻转 + 逐帧 transform 采样仅宿主两态）、内容区右滑关闭、aria-modal 让位（注入 modal 后手势 inert、清理后恢复）、双遮罩恒 1、手势后零副作用、桌面 ≥1024px 零回归（无热区/无 frame/无 backdrop）、纵向滚动不触发。

**实测驱动的两处实现修正**（方案文档原设计未覆盖）：

1. **`touch-action` 真正落点是 html/body 而非 drawer**：`layout.css.ts` 的 mobile `html, body { touch-action: manipulation }` 允许横向 pan。左缘热区 `pointer-events:none` 穿透到 body 背景（空抽屉/无内容时 `elementFromPoint` 命中 body），横向拖动被浏览器判为 pan 发 `pointercancel`，手势层收不到完整事件流。已改 `pan-y`（禁横向 pan，保纵向 + pinch-zoom；`touch-action` 不继承，只影响直接命中根背景的触摸）。drawer 的 pan-y 保留为双保险。
2. **内容区判定几何优先**：`beginStroke` 原用 `drawer.contains(event.target)`，但 hero/blank 空抽屉无内容元素，pointerdown 穿透到 frame 背景导致误拒。改为 `clientX ∈ drawerRect` 坐标判定（空抽屉同样成立，滑开空抽屉仍能滑回），元素树排除（backdrop/kebab）保留。

**验证注意事项**（已沉淀进 AGENTS.md pitfall）：
- 隔离 profile 全新启动弹宿主 "Internal Testing Notice" 模态（BODY > `_root_15u5s` 含 mask + aria-modal），探针须移除整个 root（只删 `[aria-modal=true]` 会留 mask 拦截触摸）
- 打开/关闭手势间须等待 cooldown 350ms 过期（探针每步后 `sleep(500)`）
- 偶发边缘滑出超时（run 1）为 headless 触摸合成抖动，重跑即稳定

**合并期修正（2026-08-27，维护者）**：consume 标记窗 1000→300ms + 手势层 consumedEl 门控每次 pointerdown 清空——WebKit 壳会整体抑制手势后的合成 click，长窗不清空会把用户下一次真实 tap 吞成死点击（upTo 不在链上时标记延伸到 document 根，短窗过期即兜底）。共存机制现基于 #32 nav-arm 方案（上文「自愈重发」为 v2.1.5 基线的历史方案）；终值参数以 AGENTS.md 为准（slop 4、open 0.20、close 0.16、vel 0.45/0.45）。

---

## 评审记录

### 第一轮对抗评审（2026-08-27）—— 初稿"跟手拖动"判定：不通过

**致命缺陷 1（事实 A）**：拖拽中给抽屉写非 none inline transform 会打破 `transform:none` 不变式（设置对话框 fixed 遮罩 `.VOzbGW_overlay` 被 portal 进 sidebar DOM，非 none transform → containing block 改变 → 102px 偏移/锚定失效）。

**致命缺陷 2（事实 B）**：backdrop 由 reconciler task（`overlay-backdrop-fab.ts`）以闭包局部变量 `backdrop === null` 判定创建/销毁；手势层自建 backdrop 不在其引用内 → release 后 reconciler 必再建一个 → 双遮罩 + inline opacity 残留 + 孤儿节点泄漏。

**附带发现**：缺 TRANSITIONING 态；backdrop fade 动画优先级高于 inline opacity；整段平均速度被拖拽史稀释宜改窗口瞬时；缺 visibilitychange/blur 兜底；与 installOverlayInteractions 自愈逻辑竞争需显式契约；热区放 base.css.ts 无 @media 会桌面污染；reduced-motion 在回弹路径无 reduce 覆盖；vendor use-gesture 为可评估选项；状态机时序建议 reducer 化 + 异常路径 try/finally。

**评审推荐**：A 档（松手判定式）可完全绕开两个致命缺陷。

### 第二轮独立复核（2026-08-27）—— 定档 A 档

- **缺陷 1 定性：特定场景才成立**。打开方向（closed→open）天然不可达（设置对话框唯一入口在抽屉内，closed 态不可达）；关闭方向靠"aria-modal 让位"保证互斥，但互斥是实现约定非状态不变量——若只在 pointerdown 查一次，拖拽中模态升起仍会偏移遮罩（真实致命）；每帧动态守卫则受控；**A 档零 transform 写入，风险面为 0**。
- **缺陷 2 定性：推论必然成立**。"完全不建 backdrop"是唯一干净绕法（手势层 DOM 足迹严格为零），遮罩跟手在 B 档实际被禁止。
- **定档：A 档**。理由：缺陷 2 砍掉 B 档一半价值；A 档 ~110 行零新增风险面、判定纯函数可测、与"点 toggle"路径完全同构；判定/提交解耦为 B 档升级留地基。

**升级路径**：A 档将"判定"与"提交执行器"解耦（`classifySwipe` 纯函数 + `commit` 回调）；未来升 B 档（跟手）只需：先修 reconciler backdrop 为 DOM 查询式幂等 ensure（单所有权）、drag 中每帧查 aria-modal + 动画期守卫、补 TRANSITIONING 态。均独立于 A 档地基。