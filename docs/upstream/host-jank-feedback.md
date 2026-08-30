# 反馈：移动端两个主线程长任务来源（抽屉同步挂载 + 首分钟代码高亮）

> TL;DR：移动端（≤1023px）有两处可实测的长任务卡顿，均来自宿主前端：① 侧边抽屉打开瞬间 React 同步替换互斥子树（rail 79 节点 ↔ 抽屉 389 节点），4x CPU 节流下单任务 584–705ms；② 会话加载后第一分钟，Shiki 高亮器以 `tokenizeTimeLimit:0`（单块不限时）分批 tokenize 全部代码块，单遍 110–400ms、叠加出 400–1900ms longtask。两条都有低成本修法，见各节建议。全部数字为 headless CDP + 真机会话实测，可复现。

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

**证据**：回调级计时（包装 rAF/MO/setTimeout/querySelectorAll）+ 屏蔽前端资产差分定位到宿主 index bundle 的语法高亮器（Shiki，`css-variables` 主题、`tokenizeTimeLimit:0`）。触发链：`setTimeout(()=>{hr()})` 调度 + 语言包懒加载完成后 `then(l=>{hr()})` 重跑，每遍 tokenize 全部待高亮 code 块 110–400ms（1x CPU），多遍叠加。第三方移动端插件的响应路径已逐一排除（flush ≤8ms、MutationObserver ≤9ms、最慢选择器 4.9ms）。

**建议（任一）**：

1. 高亮 pass 改 idle 调度或分片增量 tokenize（每空闲片处理少量块）；
2. 给 `tokenizeTimeLimit` 设预算——**已在本机验证可行**：对 dist bundle 做 `tokenizeTimeLimit:0 → 100` 单点替换，served 生效、真会话 boot 正常、尖刺消除；
3. 视口优先：先高亮可视区块，屏外块延后。

## 复现要点

- DevTools Performance 面板 4x CPU throttle，录制「点开抽屉」与「打开长会话后静置一分钟」两段即可看到上述单任务；
- headless 归因注意：该版本 chromium trace 无 RunTask 事件、FunctionCall args 为空，可用 PerformanceObserver longtask + 对 rAF/MO/setTimeout 回调做计时包装（拿 `String(cb)` 源码片段定位）替代；
- 长会话选取：往 localStorage 写 `dsh.sessions.current = {"sessionId":"session-<uuid>"}`（须带 `session-` 前缀）后刷新即载入指定会话。

— 测量与归因由 dsh-web-mobile 插件排查完成，材料可提供。