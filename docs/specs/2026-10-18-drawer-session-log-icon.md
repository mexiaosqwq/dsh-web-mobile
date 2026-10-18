# 抽屉会话日志入口：品牌行图标（替代页脚胶囊）

> 状态：2026-10-18 用户拍板（issue #225：侧栏「导出会话日志」按钮挤压小屏会话列表）。本文件定**入口位置与行为契约**；实现见 `src/client/effects/drawer-session-log.ts`。

## §1 问题

移动端抽屉（宿主左栏 overlay）底部曾放一颗全宽胶囊（`sidebar.footer.action` slot → `MobileDrawerFooter`）。390×844 coarse 实测：抽屉列表滚动区 270×450（y 246–696），`_footerActions` 从 y 696 起、与列表相接；胶囊 256×34 + 6px gap = 40px ≈ 1.2 个会话行（34px/行）。导出在手机上是低频动作，不值得常驻一行。

## §2 决定

入口保留，位置改到抽屉品牌行右端，只显示图标：

- 节点：插件自有的 `<button data-mobile-nav="session-log">`，28×28 盒 / 16px 下载描边图标（宿主 `IconDownloadOutline` 同款三路径），`aria-label` + `title` = `sessionLog` 文案。
- 宿主没有顶部动作槽位：`sidebar.brand.mark` / `sidebar.brand.name` / `sidebar.toggle.badge` 都是 single 且已被品牌占用，`sidebar.footer.action` 是唯一 list 槽（原胶囊所在地）。因此按钮由 reconciler task 注入宿主 `[class*="sidebarCol"] [class*="logoRow"]`（flex 行；品牌按钮 `flex:1` 让出右端，实测 390 下品牌 252→~224，文字不裁）。
- 有当前会话时可点：调用宿主 `ctx.sessionLogDownload.download(当前会话 id)`，进度/结果对话框与桌面共用；没有当前会话时 `disabled` 置灰。
- 宿主 React 重建 logo 行时由同一个 reconciler task 幂等重挂；禁用态由一条 `ctx.sessions.list` 订阅维护。
- **图标不能是 logo 行的直接 `button`**：第三方 `@linxin666/dsh-web-all` 的 responsive 层把 logo 行
  **最后一个直接 `button`** 盖章 `data-dsh-responsive-part="sidebar-toggle"`，其 dismiss shim 点这个节点收抽屉；
  直接挂在行里的图标会被顶替（2026-10-18 实测：计算样式 `display:none`，外部点击会误触导出）。实现是
  把按钮嵌在一层 `<span data-mobile-nav="session-log-wrap">` 里（`:scope > button` 看不到嵌套按钮，且不依赖
  宿主 toggle 的类名）；`tests/drawer-session-log.test.ts` 用最小 DOM 桩钉住「行内直接 button 只有宿主那两颗」。
- 桌面与键鼠窗口不出现：task 只随 reconciler 在 MOBILE_QUERY 激活时注册；misc.css 桌面隐藏清单保留 `[data-mobile-nav="session-log"]` 作为 dispose 竞态兜底。
- 移动端 header 的官方「⋯」仍按现状隐藏（重复入口）；宿主 `/export` 命令不受影响。

## §3 与既有契约的关系

- `docs/specs/2026-09-17-sidebar-files-coexistence-design.md` §3.1 中「抽屉页脚只留 session-log 胶囊」随本条作废：页脚不再有插件入口；Files 入口仍只有顶栏按钮与右缘手势。
- 会话行 ⋯ 菜单不新增导出项（2026-10-18 对比中的备选，未采用）。

## §4 被否决的备选

| 方案 | 否决理由 |
|---|---|
| 页脚胶囊缩成图标 | 仍独占一行（用量/余额卡满宽会把图标挤到下一行），不回收高度 |
| 会话行 ⋯ 菜单项 | 2 击 + 长按发现，低频动作被藏得更深 |
| 恢复 header 官方 ⋯ | 与右上 Files 按钮同座位（right:8/top:12），头部更挤 |
| 账户/更多菜单 | 账户级语义、只能导当前会话 |

## §5 验证

- 门禁：`pnpm verify` / `pnpm test:core` / `pnpm build` / `node scripts/client-bundle-smoke.mjs` / lib 新鲜度。
- 390×844 coarse：抽屉无页脚胶囊，列表滚动区 450→490；品牌行右端图标可命中，点击打开导出对话框；无当前会话置灰；宿主 logo 行被重建后图标仍在。
- 768–1023 平板同手机档；≥1024 桌面与 900×700 键鼠窄窗零变化（无图标，header 官方 ⋯ 照旧）。
- 探针：`scripts/probes/files-swipe-probe.mjs` 场景 9（页脚无插件入口 + 品牌图标可命中）、`scripts/probes/multi-width-layout-probe.mjs` 的 sessionLog 图标断言。
