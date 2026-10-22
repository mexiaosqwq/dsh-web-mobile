# effects/ · 效果模块背景

改动 `src/client/effects/` 下任意文件时本文件会自动进入上下文；改别的目录时它不出现。
每个模块的背景与根因写在**该文件自己的文档块**里（33/35 有，位置在 imports 之后的导出上方），
这里补的是跨模块共享的形状约束与源码里没写下的细节。

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
- **`panel-exit.ts` 的 history 条目必须「提前备」**：这个 WebView 会丢掉与同文档遍历同一任务
  里发出的 `pushState`（popstate 内 / 紧随 rAF / 再晚一拍的 setTimeout 都实测丢过）。所以面板
  自己一条、每下一层子页再预推一条；`popstate` 只消费已有条目、绝不补。
- **`composer-file-picker.ts` 定位必须重锚定**：点回形针会让软键盘收起、布局整体下移一个键盘
  高，只在打开时算一次坐标的 `position:fixed` 浮层会停在会话中部。视口一变（`resize` /
  `orientationchange` / `visualViewport` 的 `resize`+`scroll`）就要重算。

## 模块索引

背景与根因见各文件自己的文档块；此处只记一句话定位与易踩点。

- `phone-chrome.ts` — status bar/theme-color + 惰性 dismiss-shadow + frame-marker 任务。
  五片拆分后只剩这三件事（viewport/iOS 高度→`viewport-meta.ts`，reconciler
  实例与任务注册→`reconciler-adapter.ts`）。
- `reconciler-adapter.ts` — **那一个全树 `MutationObserver`**（记录→脏键→`core.note()`）+
  任务注册面 `addReconcilerTask` + 本插件全部 reconciler 任务。改全树观察逻辑找这里，
  **不是** phone-chrome.ts。
- `drawer-close.ts` — 抽屉关闭三条监听路（Escape / 遮罩与导航目标的捕获 click / DSHA
  `dsha-session-open`）与共用的那一个 `toggleDrawer`（晚提交关闭）。
- `drawer-session-log.ts` — 抽屉品牌行右端的会话日志导出图标（issue #225，替代页脚胶囊）：往
  `[class*="sidebarCol"] [class*="logoRow"]` 注入 `data-mobile-nav="session-log"` 按钮，
  `scopes:['*']` 处理宿主重建，`dispose` 退订 + 移除；无当前会话置灰。
- `drawer-quick-settings.ts` — 抽屉页脚账户行右端的一键设置齿轮（2026-10-20）：宿主把设置入口并进账户
  launcher（`settings.launcher` 槽）后要两步才能开设置，齿轮往 `[class*="sidebarCol"] [class*="triggerRow"]`
  注入 `data-mobile-nav="quick-settings"`，点击复刻用户路径（点 launcher → 下一帧点菜单第一项）；
  连接条在场时由 CSS 守卫让位（该行只有 260px，见 spec）。2026-10-21 起同一 task 还给账户菜单节点打
  `data-mobile-nav-quick-menu` 让 CSS 收起菜单里的设置项（齿轮让位时摘标记，见 spec §2）。
- `header-metrics.ts` — 顶栏高度 → CSS 变量 `--mobile-nav-header-h`（`scopes:['*']`）。
- `image-lightbox-zoom.ts` — 宿主原图灯箱（body 直挂 `div[role=dialog][aria-modal=true]`，stage 直接孩子是 img）
  自己的缩放层：只给 img 写 `translate3d + scale` 的 transform，pointer/gesturestart/touchmove 全部只挂灯箱
  节点（挂 document 会打红 cdp-zoom-probe A5 与 #45 契约）；缩放数学在 `core/image-zoom-core.ts`。
  灯箱的铺满覆盖与 `touch-action:none` 在 `styles/layout.css.ts` 的 `image-lightbox-fullbleed` 补丁块。
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
  `subagent-chip-touch.ts` / `overlay-backdrop-fab.ts`
  — 兼容与定位类，背景见各文件自己的文档块。
- `installed-list.ts` / `preview-fullscreen.ts` — **本目录唯二没有文档块的文件**（其余 31 个的
  背景都在文件内 JSDoc 里）：前者是已安装列表的触摸/布局修补；后者是预览全屏切换按钮的
  reconciler 任务（`preview-fullscreen-toggle`）。
- `composer-paste-guard.ts` — 手机档多行粘贴只剩首行（2026-10 报障）：输入法上屏后的
  `beforeinput`/`insertText` 落进 Lexical 的 CONTROLLED_TEXT_INSERTION_COMMAND，只写第一段；真 `paste`
  事件走 PASTE_COMMAND 不吞段。本效果在捕获期把「可信 insertText + 多行 + 落在 composer 编辑面」改派成
  携带同一文本的合成 `paste`。上游讨论 #8823。
- `model-menu-keyboard-guard.ts` — 手机档：开「模型 / 推理等级」菜单不该弹软键盘（面板在 passive effect
  里 `searchRef.current?.focus()`）。用共享 focus 影子在**捕获期 pointerdown** 就位——观察者路线赶不上
  那个时机。

## 源码未覆盖的补充背景

上面索引里说的「背景见文件内文档块」对**大多数**模块成立（31/33 有），但有几处细节源码里
没有，只能放这里：

- **`shortcut-modal-keyboard-guard.ts`** — 文件里只有一行 JSDoc（导出函数上方），机制与实测数据在此：宿主
  `dsh-client-ui-shortcuts` 的弹层（`data-shortcut-modal="shortcuts"`）打开时把焦点抢到搜索框，
  手机随即弹软键盘——用户是来编辑快捷键的，键盘却盖掉半屏；弹层按 `100dvh` 定高，键盘一压
  整体缩一截（实测 844→520 时 600px→496px，就是「打开就闪」）。本效果用共享 focus 影子
  （`core/prototype-focus-shadow.ts`，#84）给 `HTMLInputElement.prototype.focus` 注册「这个
  搜索框不聚焦」的谓词，宿主的 `focusWithoutRing` 落到影子上。影子在 MutationObserver
  （只盯 `document.body` 的 childList）里安装——微任务早于 React 被动 effect，第一帧抢焦也拦得住。
- **`session-focus-guard.ts`** — 影子窗口时长 **800ms**（源码用常量，数值语义在此）。开窗有两个触发：
  ①当前会话 id 变化；②面板退场（`panel-exit` 同步广播 `dsh-mobile-panel-exit`，帧上的
  `data-mobile-panel-exit` 只是兜底）——面板占住主区时会话被卸载，退场后 InputBar 重挂载
  又聚焦一次，键盘跟着弹。窗口必须在 commit 前打开，所以走事件而不是属性观察。
- **`composer-keyboard-lift.ts`** — 抬升量语义：`translateY(−overlap)`，`overlap` = seat 的
  `getBoundingClientRect().bottom` 减 `visualViewport.height`（`vv.height`），纯屏坐标。
- **`composer-keyboard-guard.ts`** — 上游 PR **#48**（`keepFocus` 在 `mousedown` 聚焦编辑器）。

## 新增模块时

背景写进**该文件自己的文档块**（≥3 行，放 imports 之后、导出上方）或本文件，**不要写进根 `AGENTS.md`**——那边预算恒定、
装不下线性增长项。本文件是披露层（改 `src/client/effects/` 下任意文件时自动进入上下文），但它**同样会线性增长**
——能钉进源码的就钉进源码，这里只收源码装不下的。
