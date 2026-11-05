# 反馈：移动端两个主线程长任务来源（抽屉同步挂载 + 首分钟代码高亮）

> TL;DR：移动端（≤1023px）有两处可实测的长任务卡顿，均来自宿主前端：① 侧边抽屉打开瞬间 React 同步替换互斥子树（rail 79 节点 ↔ 抽屉 389 节点），4x CPU 节流下单任务 584–705ms；② 会话加载后第一分钟，Shiki 高亮器以 `tokenizeTimeLimit:0`（单块不限时）分批 tokenize 全部代码块，单遍 110–400ms、叠加出 400–1900ms longtask。两条都有低成本修法，见各节建议。全部数字为 headless CDP + 真机会话实测，可复现。③（2026-11-05 补，0.2.2-rc.1）手机档开抽屉同一 commit 里还有两处宿主固有开销：四个区域同时挂 `inert` 触发整树样式重算、`useModalLayer` 在 layout effect 里同步 `focus()` 不带 `preventScroll`；这一条是**源码静态取证**，未做 trace 实测。

## 环境

- dsh `0.1.1-rc.2`，前端 `@deepseek-ai/dsh-web-frontend@0.1.1-rc.2`（assets/index-*.js）
- Android / Termux 部署，Chrome 移动视口 390×844；headless CDP 测量 + `Emulation.setCPUThrottlingRate`（1x/4x）
- 真会话样本：6.8MB 会话日志、31 个 code 块（宿主虚拟化后 DOM ≈ 2400 元素）

## 问题 1：抽屉打开瞬间的同步挂载冻结

**现象**：手机宽度点开侧边抽屉的瞬间主线程冻结，抽屉动画掉帧。

**证据**：真会话 4x 节流下，打开动作窗口内最大 FunctionCall（React commit）584–705ms，窗口功能族求和 script 2.2–2.4s ≫ style 549–640ms ≫ layout+paint <50ms——成本主体是 commit 本体，不是样式或布局。

**根因**：同一 sidebar column 渲染两套互斥子树——collapsed 导航 rail（79 节点）↔ open 抽屉（389 节点，含完整会话树 + footer）。`toggleSidebar()` 翻转 state → React 同步替换子树 → JS commit + style/layout/paint 落在同一任务。抽屉挂载时刻虽在屏外（translateX(-110%) 槽位），transform 不豁免 layout。

**建议（任一）**：

1. 抽屉子树挂载走并发渲染（`startTransition` / React Offscreen），commit 分帧；
2. 双子树常驻：两套子树都保持挂载，仅 CSS visibility/transform 切换，屏外子树配 `content-visibility: auto`（已实测该写法在插件侧无副作用）；
3. 会话树虚拟化——treeitem 数量是挂载成本的主要变量。

## 问题 2：会话加载后首分钟的代码高亮 longtask

**现象**：打开一个长会话后的第一分钟内，主线程间歇出现 400–1900ms 的 longtask（与用户操作无关，开抽屉、点输入框都会撞上）。

**证据**：回调级计时（包装 rAF/MO/setTimeout/querySelectorAll）+ 屏蔽前端资产差分定位到宿主 index bundle 的语法高亮器（Shiki，`css-variables` 主题；当时 bundle 里是 `tokenizeTimeLimit:0`，该字段在当前宿主上的位置已变，见下方 2026-09-23 更正）。触发链：`setTimeout(()=>{hr()})` 调度 + 语言包懒加载完成后 `then(l=>{hr()})` 重跑，每遍 tokenize 全部待高亮 code 块 110–400ms（1x CPU），多遍叠加。第三方移动端插件的响应路径已逐一排除（flush ≤8ms、MutationObserver ≤9ms、最慢选择器 4.9ms）。

**建议（任一）**：

1. 高亮 pass 改 idle 调度或分片增量 tokenize（每空闲片处理少量块）；
2. 给 `tokenizeTimeLimit` 设预算——**当时在本机验证可行**：对 `0.1.1-rc.2` 的 dist bundle 做 `tokenizeTimeLimit:0 → 100` 单点替换，served 生效、真会话 boot 正常、尖刺消除。**在当前宿主上这个单点替换已经打不到渲染路径，别照搬**（见下方更正）；
3. 视口优先：先高亮可视区块，屏外块延后。

**2026-09-23 在 0.1.7-rc.1 上复核（上面那些毫秒数未重测，只复核了三条前提）**：① 宿主 dist 里**仍是 `tokenizeTimeLimit:0`**（当年的止血手改被宿主升级抹回）；② 会话包**仍无窗口化**（`virtual` / `windowing` / `IntersectionObserver` / `content-visibility` 在 `dsh-client-ui-conversation/lib/client.js` 全 0 命中 ⇒ 每次切换整段挂载）；③ 症状随上下文长度放大的量化：短会话 52 KB / 0 个代码块 vs 两个长会话 5.3 MB / 153 块、5.9 MB / 176 块。真机（双击行切换）首屏短长都是 ~0.9s ⇒ **切换动作本身不慢，卡在首屏之后的整段挂载 + 高亮**。完整交接见 `docs/audits/2026-09-23-session-switch-jank-handover.md`。

**2026-09-23 更正（0.1.7-rc.1 bundle 精读：`dsh-web-frontend/dist/assets/index-3dwByubT.js` + `vendor-CCJJTK99.js`）**：上面「仍是 `tokenizeTimeLimit:0`／单块不限时」的说法要修正——`tokenizeTimeLimit` 在两个 bundle 里**各只出现 1 次**：

- `index-*.js` 那唯一一处是**预热**调用：`Qk()` 建好 highlighter 后用 3 个样例片段跑 `codeToTokens(..., {tokenizeTimeLimit:0})`（0 = 不限时）；
- 真正的渲染调用**不带这个参数**：`N6()` → `d1().codeToTokens(code, {lang, theme:"css-variables"})`；流式高亮类的 `tokenize()` → `codeToTokensBase(code, {lang, theme, grammarState?})`；
- `vendor-*.js` 里 Shiki 内部 `Ji()` 的默认值是 `{tokenizeMaxLineLength = 0, tokenizeTimeLimit = 500}`，而且是**逐行**预算：每行都拿 `tokenizeLine(line, state, 500)`。

两条结论：① **按块看仍没有有效预算**（代价 ≈ Σ 每块行数 × 每行 tokenize 时间，500ms 只是单行上限）；② **建议 2 的单点替换在当前宿主上打不到渲染路径**——sed 只会改到预热的那 3 个片段。要见效得给渲染调用显式传预算，或按建议 1/3 改调度与视口优先。

**2026-09-27 rc.2 复核（宿主 0.1.7-rc.2，本 discussion 提交后零回复）**：①窗口化四关键词仍全 0 命中；②渲染调用形态变化——`codeToTokens(n.code,{lang:n.lang,theme:"css-variables",tokenizeTimeLimit:0})` **显式把不限时传进了渲染路径**（另一条渲染调用与 `codeToTokensBase` 流式路径仍不带预算，落默认 500ms/行）；③会话体量继续放大（最大 7.4 MB / 建议段的三条修法一条未落）。本机已实施行预算止血（`tokenizeTimeLimit:0 → 100`，超时行降级纯文本），并挂 `dsh-fix` 补丁幂等重放防升级回抹；上游根治仍待官方，本节三条建议维持有效。

## 问题 3：手机档开抽屉的同一 commit 里，inert 整树重算 + 同步抢焦（0.2.2-rc.1）

**现象**：手机宽度（<768）点开抽屉，滑入「卡卡的」；开之前输入框聚焦、软键盘弹着时更明显。

**证据**（宿主 0.2.2-rc.1 包内源码，静态取证，未做 trace 实测）：

- `dsh-client-ui-layout/lib/client.js:385-409`：`drawerOpen` 为真时，CenterColumn、RightbarColumn、bottomRow、leadingSeat **四处在同一次 commit 里**挂上 `inert`（sidebarCol 在 :381 同时摘掉 `inert`）。`inert` 改变整个子树的计算后交互性，会话区（长会话数千节点）全量样式失效重算，落在打开那一帧。
- `dsh-client-ui-primitives/lib/index.js:1660-1683`：SidebarRoot 用 `useModalLayer(column, drawer && !collapsed, …)`（`dsh-client-ui-sidebar/lib/client.js:330`），layout effect 里同步 `focusWithoutRing(initial)`（:1683），**不带 `preventScroll`**；`focusWithoutRing` 直接 `element.focus(options)`（:1620）。`focus()` 需要最新布局 ⇒ 在 commit 的同步阶段强制一次整页样式 + 布局。输入框聚焦时，这一步把焦点抢进抽屉 → 软键盘在滑入过程中收起 → visualViewport 中途变高 → 依赖可视高度的外壳在移动的抽屉下面整页重排。
- 两条均与插件无关：去掉 dsh-web-mobile，宿主原生抽屉（`[data-sidebar-drawer]`，<768）走的是同一套 inert 与 useModalLayer。

**建议（任一）**：

1. `inert` 只挂主会话列一处（或改为在过渡结束后再挂），右栏 / 底栏 / leadingSeat 在抽屉打开期间本就被遮罩盖住，不必同帧失效；
2. `useModalLayer` 的初始聚焦传 `{ preventScroll: true }`，并推迟到 `requestAnimationFrame`（或过渡结束）之后，不在 layout effect 里同步强制布局；
3. 打开前若焦点在文本输入上，宿主先 `blur()` 并等键盘收起再开（插件侧已在 0.2.2 上这样兜底：`platform/drawer-open.ts`，2026-11-05）。

## 复现要点

- DevTools Performance 面板 4x CPU throttle，录制「点开抽屉」与「打开长会话后静置一分钟」两段即可看到上述单任务；
- 问题 3：同一面板录「输入框聚焦 + 键盘弹着时点开关开抽屉」，看打开任务里 Recalculate Style 受影响元素数（inert）与 `focusWithoutRing` 下的 Forced reflow；
- headless 归因注意：该版本 chromium trace 无 RunTask 事件、FunctionCall args 为空，可用 PerformanceObserver longtask + 对 rAF/MO/setTimeout 回调做计时包装（拿 `String(cb)` 源码片段定位）替代；
- 长会话选取：往 localStorage 写 `dsh.sessions.current = {"sessionId":"session-<uuid>"}`（须带 `session-` 前缀）后刷新即载入指定会话。

— 测量与归因由 dsh-web-mobile 插件排查完成，材料可提供。