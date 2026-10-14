# effects/ · 效果模块背景

改动 `src/client/effects/` 下任意文件时本文件会自动进入上下文；改别的目录时它不出现。
每个模块的背景与根因写在**源码文件头注释**里，这里补的是跨模块共享的形状约束与易踩点。

## 分层与依赖

依赖方向 `index.tsx → effects → platform → core`。`effects/` 不许为基础设施 import 另一个
effect；`components/` 只用 `platform/` + `core/`。`tests/architecture.test.ts` 强制（运行时环、
层方向、`core/` DOM 纯净、行预算、模块级状态、entry inline 查询），台账只许缩不许涨。

## 跨模块形状约束（踩过的坑，改前必读）

- **`viewport-meta.ts` 禁止改成 installer**：它导出三个**返回 disposer 的普通函数**
  （`preserveViewportMeta()` / `syncStableViewportHeight()` / `applyIosMarker()`），由
  phone-chrome 里**唯一那个** status-bar effect 按顺序武装并逐位合成清理。改成各自
  `installMobileEffect` 会让外层每次重新武装都往 ctx 上再注册三个收不到的子 effect
  （实测孤例，非本仓范式）。
- **武装顺序是行为**：viewport meta → iOS 标记 → 稳定视口高度。meta 所有权会改视口，而稳定
  视口高度读 `window.innerHeight`，所以「先认领 meta、最后读高度」才是原行为。
- **`panel-exit.ts` 退场是先动画后提交**：挂 `data-mobile-panel-leaving` → CSS
  `dsh-web-mobile-panel-out`（220ms）→ `animationend` 之后才 `selectPanel()`。先提交会让宿主
  在同一次 commit 卸载面板，动画落在 0×0 空槽上。
- **`composer-file-picker.ts` 定位必须重锚定**：点回形针会让软键盘收起、布局整体下移一个键盘
  高，只在打开时算一次坐标的 `position:fixed` 浮层会停在会话中部。视口一变（`resize` /
  `orientationchange` / `visualViewport` 的 `resize`+`scroll`）就要重算。

## 模块索引

背景与根因见各文件头注释；此处只记一句话定位与易踩点。

- `phone-chrome.ts` — status bar/theme-color + 惰性 dismiss-shadow + frame-marker 任务。
  2026-10-12 五片拆分后只剩这三件事（viewport/iOS 高度→`viewport-meta.ts`，reconciler
  实例与任务注册→`reconciler-adapter.ts`）。
- `reconciler-adapter.ts` — **那一个全树 `MutationObserver`**（记录→脏键→`core.note()`）+
  任务注册面 `addReconcilerTask` + 本插件全部 reconciler 任务。改全树观察逻辑找这里，
  **不是** phone-chrome.ts。
- `drawer-close.ts` — 抽屉关闭三条监听路（Escape / 遮罩与导航目标的捕获 click / DSHA
  `dsha-session-open`）与共用的那一个 `toggleDrawer`（晚提交关闭）。
- `header-metrics.ts` — 顶栏高度 → CSS 变量 `--mobile-nav-header-h`（`scopes:['*']`）。
- `selection-chrome.ts` — 非折叠选区期间给 `<html>` 挂 `data-mobile-nav-selecting`，CSS 借此
  把顶栏移出命中测试。
- `sidebar-swipe.ts` — 抽屉手势，**本目录最大的模块（1,593 行）**。开=8px 锁轴提前提交
  （inline `-101%` 基线 + arm 帧 `content-visibility:hidden` 拆挂载）；关=晚提交（inline
  280ms 滑到自身宽×110% px 槽位后翻 marker，防 React 中途换子树）；遮罩 `fadeOverlayOut`
  渐隐。参数与状态机是 `docs/specs/2026-08-27-sidebar-swipe-gestures.md` 的契约，**不可破**。
- `gesture-guard.ts` — 宿主让位 consume marks + 笔画锁轴。
- `stats-line.ts` — 标记官方状态行；上下文环与 TPS 读数**留在 React 渲染的位置**，只叠在插件
  自有的占位槽上（#104：宿主 React 节点禁搬）。`scopes: ['*','characterData']` 两个键都不能
  删——槽随树重建、TPS 走 `nodeValue` 原地改写。
- `session-menu.ts` — touch 门控注入「删除会话」菜单项（自 fork wzxmt-zhc v2.7.0 移植）。
  守卫 = TOUCH_QUERY（每个宽度都算，横屏大平板也算）+ 行/菜单/标签选择器在场。删除当前会话后
  `toggleDrawer` 只在 mobile query 下跑。
- `composer-keyboard-guard.ts` / `composer-keyboard-lift.ts` / `session-focus-guard.ts` /
  `shortcut-modal-keyboard-guard.ts` — 四个键盘守卫，共享 `core/prototype-focus-shadow.ts`
  （#84）的 focus 影子；最后一个守卫卸载时才还原真实方法，同装互不覆盖。
- `workspace-chip-toggle.ts` / `team-chip-toggle.ts` / `composer-plus-toggle.ts` — 三处
  「再点关闭」同型修补：宿主把菜单开成 `<Menu anchor={null} portal>`，触发器在 Menu 子树外，
  于是「外部 pointerdown 关闭」把自己的第二击也吃掉。
- `aionui-compat.ts` — dsh-web-ui explorer/preview markers + sheet rise 动画。
- `file-viewer-compat.ts` / `file-share.ts` / `attachment-mention.ts` /
  `model-menu-anchor.ts` / `plugin-card-tap.ts` / `session-row-fiber.ts` /
  `subagent-chip-touch.ts` / `reasoning-defaults.ts` / `overlay-backdrop-fab.ts`
  — 兼容与定位类，背景见各文件头注释。
- `installed-list.ts` / `preview-fullscreen.ts` — **没有头注释**（源码即全部背景）：前者是已安装列表的
  触摸/布局修补；后者是预览全屏切换按钮的 reconciler 任务（`preview-fullscreen-toggle`）。
- `composer-paste-guard.ts` — 手机档多行粘贴只剩首行（2026-10 报障）：输入法上屏后的
  `beforeinput`/`insertText` 落进 Lexical 的 CONTROLLED_TEXT_INSERTION_COMMAND，只写第一段；真 `paste`
  事件走 PASTE_COMMAND 不吞段。本效果在捕获期把「可信 insertText + 多行 + 落在 composer 编辑面」改派成
  携带同一文本的合成 `paste`。上游讨论 #8823。
- `model-menu-keyboard-guard.ts` — 手机档：开「模型 / 推理等级」菜单不该弹软键盘（面板在 passive effect
  里 `searchRef.current?.focus()`）。用共享 focus 影子在**捕获期 pointerdown** 就位——观察者路线赶不上
  那个时机。

## 模块背景全文

以下模块**源码文件头注释为空**，背景原文从根 `AGENTS.md` 迁来，在此保留全量。

- **`composer-file-picker.ts`** — 手机档回形针入口（2026-10-06 报障）：宿主自带的两选项入口
  0.1.6 起已删除，直点隐藏 input 只弹系统选择器（形态不可控、也无法「只挑图片」）。本效果吞掉
  入口的 click，弹插件自绘的两选项**贴锚点小浮层**（上传图片 / 上传附件；同日店主否掉了整宽底部
  弹层形态，改为按回形针 rect 定位、上方优先、夹进视口，行高 34px / 行间距 0，无「取消」行，点
  浮层外或返回键关闭），选完仍点宿主那个 hidden input —— 按选项**临时**写 accept（图片
  `image/*`、附件显式 `*/*`，`click()` 返回后立刻还原；附件那路 2026-10-07 从「不改属性」改成
  显式 `*/*` 是**待真机确认的实验**：空 acceptTypes 在 DSHA 上起的是文档选择器而不是「打开方式」
  应用列表）；浮层挂 `document.body`（同 delete-dialog 的取舍），CSS 在 base.css.ts。

- **`shortcut-modal-keyboard-guard.ts`** — 手机档：快捷键弹层（宿主 `dsh-client-ui-shortcuts`
  的 `data-shortcut-modal="shortcuts"`）打开时会把焦点抢到搜索框，手机随即弹软键盘 —— 用户是来
  编辑快捷键的，键盘却盖掉半屏，而且弹层按 `100dvh` 定高、键盘一压就整体缩一截（实测 844→520
  时 600px→496px，就是「打开就闪」）。这里通过共享管理器 `core/prototype-focus-shadow.ts`（#84）
  给 `HTMLInputElement.prototype.focus` 注册一条「这个搜索框不聚焦」的谓词：宿主的
  `focusWithoutRing` 落到影子上、输入框不获得焦点、键盘不起；点击不受影响（浏览器原生聚焦不经过
  JS 方法）。谓词只在弹层存在期间注册，最后一个守卫卸载时真实方法才被放回。影子在
  MutationObserver（只盯 `document.body` 的 childList）里安装 —— 微任务早于 React 的被动
  effect，所以第一帧抢焦也拦得住；弹层移除时 `delete` 还原。

- **`session-focus-guard.ts`** — 手机档：进入会话不自动弹软键盘（issue #140）。宿主 InputBar
  在每次切会话时程序化聚焦编辑器；本效果订阅 `ctx.sessions.list` 快照、仅在当前会话 id 变化时开
  一个 800ms 影子窗口（复用 `composer-keyboard-guard.ts` 的 own no-op focus 影子与标记），窗口内
  MutationObserver 微任务给新挂载的 `[data-composer-input]` 装影子；宿主聚焦实测跑在 commit
  同步相（早于微任务，headless t=314ms 无影子焦点实锤），窗口期另有 focusin 捕获**同步 blur**
  兜底（composer guard 2026-09-23 同型）；用户点输入框当场解除窗口，原生点按永远不受影响。

- **`composer-keyboard-lift.ts`** — iOS-only（#149）：宿主 Lexical 选区滚动助手把布局坐标可视带
  和视口坐标 caret rect 比对，iOS 键盘的非零窗口滚动让它每次击键误发 `window.scrollBy`，composer
  整块沉进系统辅助条。本效果在编辑器持焦期间用 screen-space-only 的 `translateY(−overlap)`
  （seat rect.bottom vs `vv.height`）把 seat 钉回键盘顶；pinch 或双通道分歧时 fail-open；纯核
  `computeComposerLift` 由测试钉死。

- **`composer-keyboard-guard.ts`** — iOS-only：点 composer 的发送/停止/+ 按钮不得重新唤起已收起
  的键盘（上游 `keepFocus` 在 `mousedown` 聚焦编辑器，PR #48；DOM 契约见文件头）。

- **`team-chip-toggle.ts`** — 智能体团队 chip 的「再点关闭」：宿主 agent-team 插件的触发器
  onClick 只在关闭时 `changeOpen(true)`、开态时仅 focus 面板，**永不 toggle**；关闭只靠 outside
  pointerdown / Escape。本效果开态时先替用户向 `document.body` 派发一次合成 pointerdown（走宿主
  自己的 dismiss），再吞掉那颗 click（**顺序不可换**）。

- **`workspace-chip-toggle.ts`** — hero 工作区 chip 的「再点关闭」：宿主把选择器菜单开成
  `<Menu anchor={null} portal>`，触发器在 Menu 子树外，于是它的「外部 pointerdown 关闭」把 chip
  自己的第二击也吃掉；本效果只吞那一击 click，让宿主的关闭成为唯一结果。

## 新增模块时

背景写进**源码文件头注释**（≥3 行）或本文件，**不要写进根 `AGENTS.md`**——那边预算恒定、
装不下线性增长项。本文件是披露层（改 `src/client/effects/` 下任意文件时自动进入上下文），
没有体积压力。
