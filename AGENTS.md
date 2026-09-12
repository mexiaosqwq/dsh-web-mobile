# dsh-web-mobile

## Project

- Single-package, client-only plugin for the DSH (DeepSeek Harness) Web UI. It adapts the web UI on **touch-primary devices with a viewport below 1024px** (overlay drawer, full-width conversation, adapted settings/explorer/preview sheets, status-bar safe areas, composer row, stats line). The activation query is `MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'` (phone-chrome.ts): width alone cannot distinguish a phone from a narrow desktop window — split views and OS display scaling push a PC's CSS viewport below 1024px too (2026-08-30 PC leak). A mouse-driven window (`pointer: fine`) or pointer-less one stays desktop at **every** width; the desktop hide block in misc.css.ts is the exact complement of MOBILE_QUERY as a comma list and hides the slot-rendered controls outside the mobile branch. ONE deliberate exception (v2.4.1): the session-delete trio (menu item + confirm/error dialog) arms on `TOUCH_QUERY = '(pointer: coarse)'` at EVERY width, so a large tablet in landscape keeps the desktop layout but still gets the 「删除会话」 item.
- Names differ by boundary: README/GitHub project = `dsh-web-mobile`; npm package = `dsh-web-mobile`（2026-08-30 由 dsh-mobile-nav 改名而来，旧名连同 2.2.0/2.3.0 已整包 unpublish，npm 上不再存在）; patch row id = `dsh-web-mobile`（DOM 标记 `data-mobile-nav` 与 `?mobile-nav-debug=1` 参数刻意保留旧词根，见 Pitfalls）。
- 已被 [DSHA](https://github.com/qiannianhuanxiang/DSHA)（DeepSeek Harness 安卓启动器）内置为移动端适配，README 顶部已标注并致谢 @qiannianhuanxiang（commit ffb61b5）；DSHA 用户装 APK 即用，无需 npm 安装。
- No monorepo, no application server, no workspace layer.
- Real entrypoints:
  - `cordis.patch.yml` inserts the single host plugin row.
  - `src/index.ts` is the host half: `apply()` makes the row visible to the host Loader, installs transparent gzip/brotli compression for large JSON responses (`src/compress.ts`), and registers the session-delete endpoint `/api/mobile-nav.session.delete` (work in `src/delete-session.ts`).
  - `package.json` exposes `./client` and declares `dsh.client.platform: "web"`; DSH discovers the browser half from `src/client/index.tsx`.
- Key layout（注释版仓库树；`(不入库)` = gitignore，外部 clone 不可见）:

  ```text
  dsh-web-mobile/
  ├─ src/                    ← 真源码，唯一该手改的地方
  │  ├─ index.ts             ← 宿主半区入口（apply 装响应压缩 + 会话删除端点）
  │  ├─ compress.ts          ← 进程级 prototype patch
  │  ├─ delete-session.ts    ← 会话删除纯核（DI、分代适配、可单测）
  │  └─ client/
  │     ├─ index.tsx         ← 浏览器半区入口（2 slots）
  │     ├─ debug.ts          ← ?mobile-nav-debug=1 诊断徽章
  │     ├─ components/       ← MobileNavToggle / MobileDrawerFooter
  │     ├─ core/             ← reconciler-core.ts（零 import）+ raf-scheduler.ts
  │     ├─ effects/          ← 13 个（禁 ../ import）：phone-chrome · sidebar-swipe ·
  │     │                       gesture-guard · subagent-chip-touch · composer-keyboard-guard ·
  │     │                       file-viewer-compat · aionui-compat · stats-line ·
  │     │                       git-chip-reparent · settings-toolbar-reparent ·
  │     │                       preview-fullscreen · overlay-backdrop-fab · session-menu
  │     ├─ styles/           ← index.ts（base→layout→compat→misc 承载顺序）+ 4 个 .css.ts
  │     └─ i18n/locales.ts
  ├─ lib/                    ← 生成物：随 pnpm build 刷新，勿手改（client.js≈2 万行内联 bundle）
  │  └─ types/…              ← d.ts+map；合并同 CSS 模块的 PR 在 .css.d.ts 冲突 → 重建
  ├─ scripts/
  │  ├─ build-client.mjs     ← 自研客户端打包器
  │  ├─ cdp-probe.mjs        ← 主探针 32 断言（EXPECTED_FAILURES 基线）
  │  ├─ cdp-swipe-probe/failures · cdp-zoom-probe · cdp-compat-contracts (.mjs)
  │  └─ probes/              ← 9 个回归锚点（builtin-only，可单跑）
  ├─ tests/                  ← 12 个 .test.ts（node --test，type-stripping 直跑）
  ├─ docs/
  │  ├─ specs/               ← 6 篇权威设计文档（入库）
  │  ├─ audits/ · maintenance/pitfalls.md · upstream/（runbook + compat-contracts.json）· fork-wzxmt-zhc/
  │  └─ debug/ · superpowers/ ← 本地不入库
  ├─ .github/workflows/ci.yml ← verify → test:core → build → git diff --exit-code lib
  ├─ assets/                 ← README 用图
  └─ .local-tests/ · .codegraph/ · .dsh-vision-toolkit/  ← 本地不入库（gitignore 噪音区）
  ```

## Commands

```sh
pnpm install                       # install (pnpm@11.7.0, lockfile v9)
pnpm verify                        # type-check host + client halves (tsc --noEmit)
pnpm test:core                     # node --test tests/*.test.ts (unit tests)
pnpm build                         # tsc host && tsc client && node scripts/build-client.mjs
npm run prepack                    # runs npm run build before packaging
npm pack                           # package smoke check (invokes prepack)
```

- `test:core` 现在就是 `node --test tests/*.test.ts`（曾经硬编码的文件列表长期落后于 `tests/`，2026-08-31 改成 glob）。
- `pnpm build` is the required gate after any source change: it emits host ESM, client CommonJS, then inlines the client into `lib/client.js`. `lib/` is committed, so a change is incomplete until `pnpm build` refreshes it.
- `pnpm verify` + `pnpm test:core` are the fast local checks; there is no lint/format config — the CI gate is `.github/workflows/ci.yml`（verify → test:core → build → lib 新鲜度，见 维护入口）.
- Optional CDP regression probe (not part of `verify`/`build`):

```sh
DSH_PROBE_SESSION_ID=<id> pnpm smoke:cdp
# env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_CHROME (default chromium),
#      DSH_PROBE_TIMEOUT_MS, DSH_PROBE_REQUIRE_CHIP (0/1)
```

  Requires a local DSH Web profile already running at `127.0.0.1:3080`.

- Focused unit test: `node --test tests/sidebar-swipe.test.ts` (any single file in `tests/`).
- Direct swipe regression probes (not the general `smoke:cdp`): `node scripts/cdp-swipe-probe.mjs` and `node scripts/cdp-swipe-failures.mjs`; same `DSH_PROBE_URL`/`DSH_PROBE_CHROME` env vars, and on Termux add writable `TMPDIR`/`XDG_RUNTIME_DIR`.
- iOS 聚焦放大守卫探针（#45 / #46，21 断言）：`node scripts/cdp-zoom-probe.mjs`（同组 env）。三场景：手机+Chromium UA（无 iOS 标记、第三方 13px 输入框不变、注入的 14px 可编辑域不被抬高）、手机+iPhone UA（标记就位、所有可见文本输入域 >=16px、composer 三件套同尺寸、控件类 input/select 未被改、注入的 14px contenteditable 抬到 16px 而其 `contenteditable="false"` 装饰节点保持 12px）、桌面（标记缺席、字号零影响）；兼验根/抽屉 `touch-action` 含 `pinch-zoom` 且不含 `pan-x`、`gesturestart` 不再被 preventDefault。A7/B6 注入的形状就是 dsh 0.1.2-rc.1 的 Lexical composer，用来在旧宿主上前瞻验证下一版。A8-A10 守 viewport meta 的所有权（#46 合并部分）：武装期内容必须恰好 `width=device-width, initial-scale=1, viewport-fit=cover`（**出现 maximum-scale/user-scalable 即回归**），宿主改写与整节点替换都要被重申回来。

- Local DSH profile workflow:

```sh
dsh plugin --profile web add link:/path/to/dsh-web-mobile
dsh --profile web --dump-config   # should contain the dsh-web-mobile row
dsh web
```

## Architecture

- Host/client split is load-bearing. All browser behavior lives in `src/client/`; the host half installs the response-compression patch plus the session-delete endpoint (deletion work in the DI pure core `src/delete-session.ts`, generation-adapted per host).
- `src/client/index.tsx` injects `['slots', 'layout', 'locale', 'sessionLogDownload', 'sessions', 'workspaces']`. Its `apply()` registers locale dictionaries, injects one `<style data-plugin>` tag, installs effects, and registers exactly two slots:
  - `conversation.session.header.actions` → `MobileNavToggle` (`order: 10`): drawer toggle + Files button.
  - `sidebar.footer.action` → `MobileDrawerFooter` (`order: 5`): Files + session-log actions. Order 5 keeps them below the remote icon row (order default 0) and above usage badges (order 10). Do not tie with usage stats.
  - There is **no settings slot** anymore; the haptic feedback feature was removed.
- Shared full-tree reconciler:
  - `src/client/core/reconciler-core.ts` is a DOM-free engine with **zero imports**. It owns task registry, dirty-key routing (`scopes`), coalesced rAF flush scheduling, and per-task error isolation.
  - `src/client/effects/phone-chrome.ts` is the thin browser adapter: one `MutationObserver` on `document.documentElement` maps records to dirty keys (`attributeName`, or `'*'` for tree changes), feeds `core.note()`, and drives activation/deactivation via `installMobileEffect`.
  - Tasks only run while the mobile breakpoint is active, coalesced to one pass per animation frame. `stats-line` must stay `scopes: ['*']` because TPS updates are childList/characterData text mutations.
  - Registered tasks: `frame-marker`, `preview-fullscreen-toggle`, `git-chip-reparent`, `settings-toolbar-reparent`, `preview-close-sync`, `sheet-rise-replay`, `stats-line`, `overlay-backdrop-fab`.
- Effects:
  - `phone-chrome.ts` — status bar/theme-color/viewport meta, the iOS focus-zoom marker (`detectIosWebKit` → `html[data-mobile-nav-ios]`), drawer close interactions (Escape + navigation taps), and the overlay backdrop/FAB via reconciler tasks.
  - `sidebar-swipe.ts` + `gesture-guard.ts` — drawer swipe gestures：开=8px 锁轴**提前提交**（inline `-101%` 百分比基线跟随 + arm 帧 `content-visibility:hidden` 拆挂载）；关=**晚提交**（inline 280ms 滑到自身宽×110% px 槽位后翻 marker，防 React 中途换子树）；遮罩经 `fadeOverlayOut` 渐隐；`gesture-guard.ts` supplies the host-yield consume marks + stroke axis lock.
  - `aionui-compat.ts` — dsh-web-ui explorer/preview markers and sheet rise animation.
  - `stats-line.ts` — marks the official status row and moves the TPS readout into it.
  - `debug.ts` — opt-in `?mobile-nav-debug=1` live diagnostic badge (no-op without the query param).
  - `subagent-chip-touch.ts` — touch compatibility for the subagent count chip and touch nav-arm close (see Pitfalls).
  - `composer-keyboard-guard.ts` — iOS-only: tapping the composer's send/stop/+ buttons must not re-raise a dismissed keyboard (upstream `keepFocus` focuses the editor on `mousedown`, PR #48; DOM-contract notes in the file header).
  - `session-menu.ts` — touch-gated injection of a 「删除会话」 item into the workspace session-row ⋯ menu (clone-and-inject from the fork wzxmt-zhc v2.7.0): guard = TOUCH_QUERY (`(pointer: coarse)` at EVERY width — large tablets in landscape included, v2.4.1) + row/menu/label selectors present; inert on hosts whose drawer renders the rail variant (rc.2), activates on hosts rendering session rows in the drawer (0.1.3) or on the ≥1024px desktop panel; after deleting the current session `ctx.layout.toggleSidebar()` only runs on the mobile query (desktop panels must not collapse); confirmation dialog markup/styles live in base.css.ts (wide-touch card capped 420px centered) with corrected animation names.
  - Reconciler task modules: `git-chip-reparent.ts`, `settings-toolbar-reparent.ts`, `preview-fullscreen.ts`, `overlay-backdrop-fab.ts`.
- Styles: `src/client/styles/index.ts` concatenates `base → layout → compat → misc` in that load-bearing order and injects one `<style data-plugin>` tag. Mobile rules target `(max-width: 1023px) and (pointer: coarse)` (keep every top-level media block in sync with `MOBILE_QUERY`); the desktop hide block in misc.css.ts is its exact complement and must preserve the uninstalled layout.
- Third-party compatibility is implemented through scoped DOM markers, stable `data-*` attributes, `MutationObserver`, and carefully scoped class/text anchors. Never modify third-party source packages.
- Authoritative design docs: `docs/specs/2026-08-27-sidebar-swipe-gestures.md` (gesture parameters/state machine) and `docs/audits/2026-08-27-sidebar-swipe-latent-defects.md` (gesture defect baseline).

## Conventions

- Keep the host/client split intact; the host half stays minimal (`apply()` installs response compression + the session-delete endpoint, nothing else).
- Use stable `data-*` markers and structural selectors before hashed classes. For unavoidable hashed classes use substring matching (`[class*=_frag]`), never attribute-suffix (`[class$=…]`) — the class attribute often carries extra tokens or trailing spaces, and a suffix test runs against the whole attribute value, so it silently misses (verified in the full-codebase migration). Scope the selector to its owning region and guard prefix-overlapping fragments with `:not`; for tree rows use `[class*="_treeRow"]` and exclude `[class*="_treeArrowEmpty"]` when distinguishing directories from files.
- Put every long-lived style tag, listener, timer, or `MutationObserver` inside `ctx.effect(() => { ...; return disposer }, label)`. Re-arm width-sensitive effects on `matchMedia(MOBILE_QUERY)` changes via `installMobileEffect` so wide→narrow transitions work; import the constant from phone-chrome.ts instead of hardcoding query strings.
- Treat DOM markers as the cross-module state contract: `data-mobile-nav="frame"`, `data-sidebar-collapsed`, `data-aionui-explorer-open`, `data-aionui-preview-open`, `data-mobile-preview-full`, `data-mobile-nav="stats"`, `data-file-viewer-open` (frame-level gate for the dsh-file-viewer compat layout, keyed on `.dsfv-panel`), `data-mobile-nav="session-delete"` (menu-item probe key), `delete-dialog-backdrop` + `delete-dialog` (confirmation dialog), and `data-mobile-nav-ios` (on `<html>`, iOS-only CSS gate).
- Use idempotent `ensure()`/reparent logic when injecting nodes into third-party React-owned DOM. Clean up moved nodes, observers, attributes, and listeners on disposal.
- Obtain DSH services through the declared fiber `inject` list and slot `inject` props; use React state for local mirrors and `data-*` markers for cross-effect state.
- Client runtime effects are currently synchronous DOM work; follow that pattern unless a new contract requires async behavior. Use the debug badge's captured `error`/`unhandledrejection` output when diagnosing failures instead of swallowing exceptions.
- TypeScript style: single quotes, no semicolons, explicit exported return types, installer names `install<Domain>`.
- Client-local relative imports must include `.ts`/`.tsx` extensions; `tsconfig.client.json` rewrites them for CommonJS emit. Use type-only imports for DSH module augmentation and SlotMap/Context typing.
- **`src/client/effects/` 禁 `../` import**：自定义打包器（`scripts/build-client.mjs`）无法解析 effects 目录向父级的相对 require（会把 `../x.ts` 误解析为同目录 `x.js` 并报 `client module not found`）。effects 内文件只能引用同目录模块或裸模块；跨模块共享的纯逻辑放同目录新文件（如 `reconciler-core.ts` 保持零 import），第三方任务模块统一经 `phone-chrome.ts` 拿 `ReconcilerTask` 类型。
- Add locale keys to `zh` first, then mirror the same keys in typed `en`; `MobileNavKey` is derived from `zh`.
- Keep CSS in `src/client/styles/`, not in component files. Preserve the `base → layout → compat → misc` concatenation order and complete CSS comments/section boundaries.
- Preserve mobile-only behavior and modal precedence: capture-phase drawer handlers must yield to `[aria-modal="true"]` dialogs and ignore session-row action buttons. `transform: none`, rather than an identity `translateX(0)`, is required for the open drawer so fixed descendants keep the correct containing block.
- Do not edit `lib/` directly; rebuild and include generated artifacts after any source/config change.

## Pitfalls
- **Pitfalls 档案**：本节是压缩后的可执行不变式；每条的完整推导/取证/实验证据归档在 `docs/maintenance/pitfalls.md`（紧凑条目里标了 §小节名），复杂改动前先读对应小节。

- **抽屉手势层（sidebar-swipe.ts）铁律**（完整推导/A/B 证据 → `docs/maintenance/pitfalls.md` §手势层）：开=提前提交（8px 锁轴即 arm + inline `-101%` 百分比跟随 + arm 帧 `content-visibility:hidden`）；关=晚提交（280ms 滑自身宽×110% px 槽位，落地才翻 marker，防 React 中途换子树倒跳）；手势判定后必须 `markGestureConsumed(target, 300, drawer)`，宿主 `onDrawerClick`/`onDrawerPointerUp` 首行 `isStrokeLocked() || consumeIfGestured(event)` yield；drawer 滚动容器 `touch-action: pan-y`；起点纯几何（`hitTestStart`，0.45×视口宽≈176px@390；2026-09-11 曾短暂缩到 0.25 缓解拖动冲突，同日按用户拍板回滚保持 0.45——识别区手感不变，冲突改由让位体系解决，无热区元素）；inline 一律 `setProperty(...,'important')`，断言看计算后几何；`transform:none` 无 inline 残留只约束终态。参数速查：START_ZONE_RATIO=0.45、LOCK_PX=8、open/close 0.16/0.13 视口比例、速度=60ms 窗末两点斜率、openVel/closeVel 0.45px/ms、cooldown 350ms、consume 300ms（consumedEl 每次 pointerdown 清空）、touch 认领 slop `TOUCH_CLAIM_SLOP_PX=4`（**未轴锁的行 tap 位移 <4px 时禁止 preventDefault**——WebKit 对 touchmove 被 preventDefault 的 touch 序列不合成 click，而抽屉打开时任意 touch 按下都会武装行程 ⇒ 行 tap 的 click 会被自家手势层吃掉；轴锁后照旧无条件 prevent）。让位清单（beginStroke 前置 + tryLock 每次锁轴前复查）：cooldown/modal/takeover/selection/横滚容器/**拖动标记/悬浮窗形状**——拖动组件拖动期间挂 `data-mobile-nav-dragging`（被按住元素/祖先或 body/documentElement 全局）手势层即整笔让位（配合实现的组件走标记）；不配合的第三方可拖动悬浮件（dsh-pet 桌宠实测 148×160 fixed）走位置启发式 `findFloatingWidget`：起点祖先链上第一个 fixed|absolute 且 ≤200px（FLOATING_WIDGET_MAX_PX）的自由定位浮层即让位（frame 子树除外——FAB/backdrop/抽屉不误伤）；让位≠拦截，悬浮窗拖动照常执行；一旦锁轴即承诺，锁后出现的标记/形状不回头。划词选择（双选区模型都读，塌缩光标不算拥有）与多指必须整体让位；距离从 startX 起算；#32 nav-arm 关闭路径不许掐死；`gesture-guard.ts` 保持零 import。**行 tap 不许依赖 click（2026-09-12 真机）**：WebKit 对行 tap 的 click 合成不可靠（实测两次同质 tap 一次有 click、一次完全没有）⇒ `phone-chrome.ts` 的抽屉 pointerup 对「touch/pen + 未选中会话行 + 位移 ≤`TAP_NAV_SLOP_PX=12`」的 tap 用 **fiber 链取 id**（`effects/session-row-fiber.ts`；行 DOM 无 id，向上一跳 `props.node.id`）调 `ctx.sessions.open(id)`，并在 **store 报 `current === id` 时关一次抽屉**（该 tap 不 arm 上游 DOM 观察者，两条关闭路径互斥），同时**丢弃这次 tap 的尾随 click**（否则同会话被 open 两次、渲染重来 ⇒ "点完要等"）。回归门：`scripts/cdp-swipe-failures.mjs` 16 场景 + 主探针 32 断言 + `scripts/probes/draggable-conflict-probe.mjs`（15 断言：0.45 区几何 / 无标记悬浮球让位 + 跟手 / 标记接口 / 清除后恢复）；主探针 `drawer-touch-action` 断言为含 pan-y + pinch-zoom 且不含 pan-x（#45 zoom 契约后同步）。
- **手势消费标记的 backdrop 误吞坑（「点两次才关」）**：手势打开抽屉后 `markGestureConsumed` 链式标记手势起点目标，若起点 `event.target` 的祖先链**不含 drawer**（headless 命中穿透时起点落到 body；或 drawer 空壳无内容元素），链会一路走到 document——把 **backdrop / FAB 也标记为 consumed**。随后 1s 窗口内点 backdrop 想关闭，sidebar-swipe 的 document 捕获 `onClick` 命中标记 → `stopPropagation` → backdrop 元素级 click 监听收不到 → 点一次无效（用户感知"要点两次"）。修复：`onClick` 对命中 `[data-mobile-nav="backdrop"], [data-mobile-nav="fab"]` 的 click **无条件放行**（backdrop/FAB 绝不可能是手势合成 click 的目标——手势起点只在左缘 start zone/drawer 内容区）。同时 `markGestureConsumed` 的 upTo 收敛为 drawer（非 frame），减小误标范围。
- **CDP 手势实测驱动的两处修正**：`touch-action` 真正落点是 html/body 而非 drawer（已改 `pan-y`，drawer 双保险）；内容区判定几何优先（`beginStroke` 用 `clientX ∈ drawerRect`，空抽屉也成立）。探针注意：隔离 profile 会弹宿主 Internal Testing Notice 模态——必须移除整个 root（只删 `[aria-modal=true]` 会留 mask 拦触摸）；反向手势等 cooldown 350ms 过期（探针每步 sleep(500)）→ `docs/maintenance/pitfalls.md` §CDP 手势实测。
- **composer 底部行三件套契约**（完整推导+复现探针 → `docs/maintenance/pitfalls.md` §composer 行）：固定图标控件（_add 28 / ContextMeter trigger 28 / _primary 34）不参与收缩；trailing `flex:1 1 auto`、发送 `margin-left:auto` 钉右缘；自适应余量吸收器优先级=模型条>圈>发送键，互斥由置零规则双 arm（menu+dialog）保证，空隙永远在焊接簇之前；模型条与 dock 槽隔 `display:contents`，trailing 域用后代组合器；收缩规则必须 `:not` 排除 `_add`/`_primary`/`_root`；ContextMeter（`JObwrW_`）trigger 无 `aria-haspopup="menu"` 须单独钉住 root。子代理形态：running 渲染双 `_primary` → 该形态恢复官方 wrap（`:has([class*="_primary"] ~ [class*="_primary"])`）；idle 无模型条 → 圈 root 挂 auto。回归探针 `scripts/probes/subagent-composer-fix-probe.mjs`、`scripts/probes/diag-sub-idle-pin.mjs`。
- **composer 键盘 guard（PR #48）marker 契约按宿主分代**：`[data-composer-input]` 是 0.1.2-rc.1 Lexical 编辑面 marker，0.1.1-rc.2 只有 card/seat（guard 安全空转）；升级宿主按 composer-keyboard-guard.ts 文件头注释对账两 marker；headless 的 `detectIosWebKit` 恒 false，本地 CDP 无法验活跃路径（贡献者 iPhone 实机 + tests/composer-keyboard-guard.test.ts 源码不变量已过）→ `docs/maintenance/pitfalls.md` §键盘 guard。
- **宽度断点 ≠ 设备判定（2026-08-30 PC 泄漏）**：`MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'`（JS 常量 + compat/layout/misc 全部顶层 media 块同步）；misc 桌面隐藏块=精确补集 `@media (min-width: 1024px), (pointer: fine), (pointer: none)`。**维护约定：新增任何 `data-mobile-nav` 注入控件（slot 按钮、task 注入元素）必须同步加进隐藏块清单**（dispose 竞态最后防线）。**唯一豁免（v2.4.1）：session-delete 三件套**（`session-delete` 菜单项 + `delete-dialog-backdrop` + `delete-dialog`）不进宽度臂——它们按 `TOUCH_QUERY = '(pointer: coarse)'` 全宽度武装（大平板横屏契约），只受 misc 尾部独立的 pointer-only 块 `(pointer: fine), (pointer: none)` 隐藏；`installMobileEffect` 支持第 4 参 query 覆盖默认 MOBILE_QUERY。探针必须 `Emulation.setTouchEmulationEnabled`（`setEmulatedMedia` 对 pointer 特征无效），桌面场景必须关掉；断言 slot 按钮前等 active phase（hero 的 `qDHVXG_headerActions` 不是同一容器）。完整案例 → `docs/maintenance/pitfalls.md` §断点与设备。
- **CDP 探针环境参数（Termux 本机实测）**：`cdp-swipe-failures.mjs` 的 `DSH_PROBE_URL` 缺省曾误指调试端口 3457，已改为与主探针一致的 `http://127.0.0.1:3080/`（旧版不带 env 直接跑会连到没人监听的端口，报「插件 frame 未就绪」——现象像回归/环境坏了，其实是 URL 错）。主探针需要 `DSH_PROBE_SESSION_ID`（取 `~/.dsh/sessions/<项目目录>/` 最新 `session-*`；本机 3080 的 cwd 是 `~`，对应 `--data-data-com.termux-files-home--/`），Termux 上 `DSH_PROBE_CHROME=chromium-browser` 必须显式传（缺省 `chromium` 会 spawn ENOENT）。另外连续跑探针会在设备上泄漏 headless chromium 进程（实测 31 个残留、load 7.0，拖垮后续所有探针 boot 甚至误报超时）——排查前先 `pgrep -c chrom` 清点；`pkill -f` 的 pattern 会匹配自身命令行把当前 shell 杀掉，用不含自匹配的 pattern 或从另一个会话清理。
- **iOS 一输入就放大（#45）已按机制修**（完整取证/已否决路线/未验证后续项 → `docs/maintenance/pitfalls.md` §iOS zoom）：根/抽屉 `touch-action` 必须含 `pinch-zoom`（沿祖先链交集，漏一层授权就被抵消）；`gesturestart` 一律不 preventDefault；16px 下限走 `html[data-mobile-nav-ios]`（misc.css，盖 textarea / `[contenteditable]:not([contenteditable="false"])` / 文本类 input + composer 三件套同字号；`select` 故意不改）；**不要改回 `maximum-scale=1`**（iOS 10+ 忽略、安卓/桌面认真执行）；宿主 viewport meta 各版都不带 maximum-scale；引擎判定=纯函数 `detectIosWebKit`（先 CSS.supports 特征探针再 UA，iPadOS 13+ 发桌面 UA 靠 maxTouchPoints）。viewport meta 所有权（重申 `width=device-width, initial-scale=1, viewport-fit=cover`，写入永不带缩放锁）已合并 cb16329。探针 `scripts/cdp-zoom-probe.mjs`（21 断言）。
- **主探针（`scripts/cdp-probe.mjs`）的 3 项预存失败已写成机读基线**：探针源码内 `EXPECTED_FAILURES`（name 精确匹配；`page.errors` 另要求 detail 含 `404`，防掩盖新的页面错误）＝`page.errors`（一个 404 资源）、`integration.gitgraph.reparented`（`hasCard=true reparented=false`）、`integration.gitgraph.pressed`（`transform=none`，是上一项的下游：芯片未进 dock 则 `:active` 规则不命中）。命中基线的 FAIL 记 BASE 不计入退出码，SUMMARY 显示 `base=N new=M` 且 base>0 时打印 `BASELINE <names>`，只有 `new>0` 才 exit 1（gitgraph 芯片缺席时走 SKIP，属正常环境差异；某条目修好后必须从 EXPECTED_FAILURES 移除）。已用 bundle A/B 实验判定（`git show HEAD:lib/client.js > lib/client.js` 后重跑，旧 bundle 83924c1c6281 与新 bundle 完全同款失败）——判定探针结果时看 SUMMARY 的 new 字段，别把基线归给当前改动；修 gitgraph reparent 属独立课题。
- **dsh-meme 表情卡片（meme-picker）**：手机端贴 anchor 双侧对齐（`left/right:0`+`width:auto`+`max-width:386px`）；网格 grid `minmax(64px,1fr)` 手机 4 列/平板 5 列（覆盖 dsh-meme 行内尺寸）；滚动条细条。dsh-meme 改卡宽/缩略图尺寸后回来对账 → `docs/maintenance/pitfalls.md` §meme 卡。
- **agent preset 模式选择菜单底部弹层**：`[role="menu"]:has([class*="cubgiG_item"])`（`:has` 圈定，不误伤其他 role=menu）；水平居中+顶部手柄+内部 viewport 滚动+细滚动条；桌面保持官方大下拉。参数 → `docs/maintenance/pitfalls.md` §preset 菜单。
- **会话 header 拥挤保护必须 `[class*="_root"]`**（尾随空格根因+修正 → `docs/maintenance/pitfalls.md` §header 拥挤）：`ZKlsPq_root ` 带尾随空格，`[class$=]` 真实 DOM 0 命中（合成 fixture 复现不出，只有真渲染能暴露）；门控 `header:has([class*="_crumbs"] [class*="_root"])`；钉宽只钉计数/jobs root（`:has(> button[class*="_trigger"])`），排除 switcherRoot 让 title 省略号收缩；官方 `ZKlsPq_separator` 手机端隐藏，crumbSep 保留。
- **哈希类选择器一律子串匹配 `[class*=]`，禁止 `[class$=]`**（实锤案例+守卫族清单 → `docs/maintenance/pitfalls.md` §哈希子串）：`[class$=…]` 对整个 class 属性串做后缀测试，多 token/尾随空格（`ZKlsPq_root `、`wSkVaW_… wSkVaW_composerHero`）即整体失配；复活后可能过匹配，前缀重叠片段加 `:not`。已守卫族：`_action(s)`、`_header`（含 `_headerStatic` 排除）、`_stat(_statsRow)`、`_scroll`（`:has(p)` + `:not(:has([data-composer-input]))`，PR #47）、`_tabBar`、`_row` 复合族五段 `:not`；低危候选 `_search/_searchInline/_searchBox` 升级后普查。回归：headless 向 scrollBody 注入 `<p>` 断言 padding 保持；bundle A/B 用 `git show <commit>:lib/client.js > lib/client.js`（服务端 no-cache，A/B 窗口要短并及时还原）。
- **设置工具栏规则结构化锚定，禁止裸 `[class*="_header"]`**（该子串命中全部 8 个插件卡头：官方 `YyYd_a_` + dsh-web-ui-all 五张；锚定 reparent 后 `> [class*="_nav"] > [class*="_header"]`、reparent 前 `> :last-child > [class*="_header"]`）；新装插件卡再现同类症状先查这条；回归探针 `scripts/probes/plugin-card-header-bleed.mjs`（10 断言）→ 案例 `docs/maintenance/pitfalls.md` §工具栏锚定。
- **触屏 tooltip 压制必须保留 `[class*="_actions"]` 祖先限定**（裸 `[_bubble]` 会 display:none 用户消息/goal 气泡——0.1.1-rc.2 上「CDP 实测 10 个 tooltip」就是 10 条用户消息，断言断在 bug 本身；摘抄/移植类 CDP 验证必须同时断言非目标元素可见）→ 完整取证 `docs/maintenance/pitfalls.md` §tooltip；回归探针 `scripts/probes/diag-flow4.mjs`。
- **hero 净空与胶囊锚点净空的级联冲突（2026-09-06）**：同特异度 (0,3,0) 跨块踩踏（misc 拼接在 compat 之后）——hero 40px 净空被踩成 6px、28px 胶囊压输入行；修复=misc padding-top 覆盖加 `:not(:has([data-gitgraph-chip-anchor]))`，净空随芯片生长 40→44px。教训：同张拼接样式表跨块调参前先用探针量同特异度冲突；胶囊异步渲染必须轮询等锚点再断言。回归探针 `scripts/probes/diag-hero-chip.mjs`（8 断言）→ `docs/maintenance/pitfalls.md` §hero 净空。
- **`data-conversation-composer-overlay` 是通用 overlay 属性，非 file-viewer 专属**：marker 判定只认 `.dsfv-panel`；手势让位 `takeoverActive()` 直查通用属性（轨迹 tab 也让位，FAB 仍可开抽屉）；注入形状必须含反断言形态（纯属性、无 dsfv 类 → marker 不置位但滑动让位）→ `docs/maintenance/pitfalls.md` §overlay 两信号；设计 `docs/specs/2026-09-06-conversation-overlay-takeover-design.md`；探针 `scripts/probes/file-viewer-probe.mjs`。
- **会话 header view tab strip 手机端横滚（#41）**：strip `overflow-x:auto` + 按钮 `flex-shrink:0; white-space:nowrap` + `touch-action: pan-x`（strip 自身认领横向 pan）+ `overscroll-behavior-x: contain` + scroll-snap；affordance=右缘被切断的 tab（与设置 navList 的 wrap 相对）；起始于已溢出 strip 的边缘滑被 `findHorizontalScroller` 在 beginStroke 拒绝。完整设计 → `docs/maintenance/pitfalls.md` §tab strip。

- **全树 reconciler 的 task 必须幂等且 dispose 可恢复**：`ensure` 每次移动第三方 DOM 时刷新 `origin`（React 会重建节点）；`dispose` 找回元素限定在被移动容器内，不用全局文本搜索；task 注册的 disposer 不得丢弃，否则同环境插件重载后 reconciler 失效。
- **文档/注释与实现的漂移**：`MobileNavOverlay.tsx` 已删除，其职责由 shared reconciler task（`settings-toolbar-reparent`/`git-chip-reparent`）承担；提到该组件即视为过时。触觉反馈（`HapticRow`/`haptic-pref`）也已从源码移除，README 相关条目已清理。README「未发布」段的参数同样会漂移——定稿 release notes 前必须对源码常量核对（v2.3.0 定稿时发现识别区残留中间轮次旧值 96px，源码实为 `START_ZONE_RATIO = 0.45`×视口宽）。变更条目**只描述结果不写过程**（2026-09-05 用户偏好：不写症状/修复叙事，直接写修复后的最终状态）；功能条目同理**不列举特点细节**，一句话说清是什么即可（2026-09-08 用户偏好：功能不用解释有哪些特点）。计数条目（探针/测试文件数）README 与 AGENTS.md 各持一份，收口时必须两处同步——2026-09-08 实漏：会话删除收口只更 AGENTS.md 探针计数，README 的「七个」留在旧值。
- **合并涉及 CSS 字符串的 PR 会冲突在生成文件**：`lib/types/client/styles/*.css.d.ts` 和 `.d.ts.map` 是单行大字符串，双方只要都改过同一 CSS 模块，git 会在这些生成文件上报行级冲突。解法是合并后跑 `pnpm build` 重建 lib 再 `git add`，不要手工编辑 d.ts。

- **子代理芯片触摸兼容（subagent-chip-touch.ts）**（三类症状分类+iOS 壳硬约束 → `docs/maintenance/pitfalls.md` §子代理芯片）：上游 count 变体 trigger 无 onClick（hover 定时器开关）；触摸路径=pointerup 派发合成 ArrowDown/Escape 走组件键盘路径 + ~800ms 吞射向 `ZKlsPq_`/`h8S2Va_` 子树的 trusted hover 事件（不吞 click）；行导航不依赖合成 click 时序（iOS 壳整体吞），用 `aria-selected` MutationObserver arm（2000ms 自 disarm）；document 捕获 click 在行 tap 后 500ms 让位。CDP 注意：每步先断言无 aria-modal（误触 Session log 会拉起模态），一律全新 user-data-dir。
- **dsh-client-ui-subagent 两代互斥开关实现必须同兼容**（闪退竞态根因+修复 → `docs/maintenance/pitfalls.md` §subagent 两代）：0.1.0-rc.6~8（`h8S2Va_`）=onClick 代，0.1.1-rc.1/2（`ZKlsPq_`）=hover 代（npm dist-tag 不可信）；判定看 served bundle 有无 onClick/hover 定时器，别看版本号。onClick 代双开关竞态由 `toggledTrigger`（1s 宽限）+ document 捕获吞同 trigger 的 click 解决；`HOVER_SUBTREE_SELECTOR` 同时列两代哈希——两条吞噬防护并存、在另一代上各自 no-op，即两代通吃。
- **已安装列表的 outer-row 选择器必须排除嵌套 action 容器**：最新版 dshmarket 的 `eGUBIq_irowActions` 与 `eGUBIq_irowTrailing` 类名都包含 `irow`。若使用宽泛的 `[class*="irow"]`，移动端内联 effect 会把 action 容器也设置为 `flex-wrap:wrap`，并把状态标签/路径元数据强制 `flex:1 1 100%`，导致启用状态、更新/卸载按钮和开关错位。outer row 必须使用 `[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"])`；该 effect 在切回 ≥1024px 时还必须清理自己写入的 inline 属性。
- **市场头部「文字变竖排」的触发器是待更新按钮**：dshmarket 标题行（`_titleRow`，nowrap flex）在有插件待更新时会渲染 "Update market"/"Update all" 按钮，自然宽度 ~450px 超出 ~334px 表单，flex 把 `_title` 和按钮压到内容宽以下逐词换行——表现为文字时横时竖（按钮仅在有待更新时存在）。已在 `compat.css.ts` 修复：行改 wrap、`_title` 锁单行 ellipsis、行内 button nowrap。同区还有 Tasks 弹卡（`_opPanel`）的 fixed 居中规则；两处哈希前缀均为 `eGUBIq_`，升级后回来对账。
- **dshmarket ≥1.20 手机端隐藏设置 nav 造成死路，需镜像条件反制**：1.20.x 起上游 `Market.module.css` 在 `@media(max-width:560px)` 注入 `[role="dialog"]:has([data-dsh-market-root]) > nav { display:none }`（意图让市场在手机上接管整个设置对话框），注释假设宿主会在 content header 自留关闭按钮——但本宿主唯一叉号 `VOzbGW_close` 就在该 nav 里，于是打开市场后分类行与叉号一起消失、无路可退。已在 `compat.css.ts` 镜像上游同一 media 条件反制：frame 域限定 + `[role="dialog"]:has([data-dsh-market-root]) > nav { display:flex !important }`。取证手法：活页面遍历 `document.styleSheets`（含 media 规则递归）找命中目标元素且带 display:none 的规则，即可定位注入 style 标签（带 `data-plugin=dshmarket data-plugin-css=…`）。profile 的 `^caret` 版本范围会静默升 minor——dshmarket 升级后按调试地图 §7 对账。
- **`?mobile-nav-debug=1` 的 debug badge 不能观察自己写入的子树**：badge 位于 `document.body` 内，而 `paint()` 写 `badge.textContent` 会产生 childList mutation；若 MutationObserver 直接以 `paint` 为回调，会把自身输出再次喂给 `paint()`，造成页面硬冻结（headless/真实浏览器都会卡在 "Loading plugins…"）。回调必须跳过 `badge` 自身及其子树上的 mutation（`record.target === badge || badge.contains(record.target)`），否则调试模式本身就是事故源。
- **CSS 模板字符串注释内禁止反引号**：`src/client/styles/*.css.ts` 的 CSS 是 TypeScript 模板字面量，注释里写 Markdown 反引号会提前终止模板，tsc 报 `TS1005`。引用类名用普通引号或纯文本。
- CSS relies on `:has()` and therefore requires Chromium 105+; unsupported `:has()` rules can disappear silently in old WebViews. Preserve `prefers-reduced-motion` behavior.
- Generated code discipline: `lib/` is intentionally committed because consumers install without a build step. A source change is incomplete until `pnpm build` refreshes it.
- **页面状态/bundle 校验**：boot 图（`/` 的 `__DSH_BOOT__`）里 `entries[].url` 是插件客户端的**唯一权威地址**，0.1.2-rc.1 实测形状为 `/plugins/??dsh-web-mobile/client.js&rev=<rev>`（无 scope 时是 `??`；`/plugins/dsh-web-mobile/client.js` 这种老形状在本代**恒 404 空 body**，其 sha1 恒 `da39a3ee5e6b`，别误判成版本不一致）。`rev` 是**内容派生的缓存令牌，不是** `sha1sum lib/client.js` 的前 12 位（2026-09-12 实测：同一插件改 bundle 后 rev 由 `e2a8748d9a93` 变 `3984be2dd473`，而 sha1 前 12 位是另一串）——**换过 lib 之后必须重新取 boot 拿新 rev 再请求，用旧 rev 会 404**（2026-09-12 就因此误判过一次）。对账方式=按 boot 的 url 原样请求 + 内容 grep 你的改动标记（服务端 no-cache，rev 仅作缓存 bust），必要时 diff 本地构建（差异应只有宿主注入的 `//# sourceMappingURL=` 行）。设备出现旧 UI 时先换全新 browser context/清站点数据——复用旧 context 会让 harness web 进入「fence-only」状态（frame 内联 `display:none`、最后一条 dsh-ui fence 挂 app 根级），与插件无关。

- **host 半区 ESM 相对导入必须带 `.js` 扩展名**：`tsconfig.json` 用 `moduleResolution: "bundler"`，tsc 把相对说明符原样发射；Node ESM 不猜扩展名 → `ERR_MODULE_NOT_FOUND`，plugin tree 加载失败、`dsh web` 直接崩（实锤 #31：`src/index.ts` 写 `from './compress'` 漏 `.js`）。bundler 模式会把 `./compress.js` 映射回 `compress.ts`，所以源码写 `.js` 即可，不必动 tsconfig。`lib/index.js` 应可从仓库根 `node -e "import('./lib/index.js')"` 直接解析。
- **safe-area padding 与 `box-sizing: border-box` 必须成对出现**（frame `height:100%`+content-box 会把视口撑出 inset 滚动量、composer seat 沉到视口下——「跟随失效」是假象，错位的是外层 document；桌面 inset=0 复现不出，须 CDP 注入 47px 模拟；断言 scrollHeight-clientHeight===0 且 seat.bottom===innerHeight）→ `docs/maintenance/pitfalls.md` §safe-area。
- **响应压缩是进程级 prototype patch**：`src/compress.ts` 直接替换 `http.ServerResponse.prototype` 的 writeHead/write/end（disposer 还原），作用于 DSH Web 进程内所有响应而不只是本插件路由；仅压缩 ≥4KB 且 content-type 含 json、无既有 content-encoding、客户端 Accept-Encoding 支持 br/gzip 的响应，SSE 有意不压。改动该文件时必须保持三条不变式：小 JSON 原样字节透传（原头不动）、Content-Length 与实发字节数一致、dispose 完整还原三个方法。
- **会话删除的注入面按宿主分代（fork wzxmt-zhc 摘抄，2026-09-08）**：rc.2 手机抽屉渲染宿主 rail 变体（`qDHVXG_rail`，`qDHVXG_listArea` 恒空），390/768px 均无会话行与 ⋯ 菜单；`YDXeBa_sessionRow` + 菜单（恰 3 项 rename/fork/archive，`_itemIcon/_itemLabel` 克隆模板齐全）只在 ≥1024px 桌面工作区面板存在。fork 选择器靠子串天然命中（`YDXeBa_sessionRow` ⊇ `_sessionRow`、`qDHVXG_groupSection` ⊇ `_groupSection`），故 session-menu.ts 在 rc.2 的 touch 门控内静默、宿主升级（0.1.3 抽屉渲染会话行）后自动激活——**别为此做全宽注入或抽屉展开面板**（用户已否决，破坏鼠标桌面零影响）。升级绊线：`scripts/probes/session-delete-probe.mjs` 断言 5（rail 在场但 0 行/0 菜单），0.1.3 上翻红 = 按 SKIP 提示到 `docs/fork-wzxmt-zhc/backlog.md` 会话删除行复启注入/弹窗断言套件。鼠标/无指针桌面零注入由断言 15c/15d 守（pointer 门控 + misc pointer-only 隐藏块双保险）；宽屏触摸（≥1024px + touch emulation）注入由 16a-16d 守（4 项菜单 + 删除项在场 + 弹窗开合）。删除端点真机已验：冷会话 200 并整目录移除（跨项目 projectKey 复算命中真实布局）、GET 405 / 空参 400 / 未知 404；运行中会话 409 拒删为单测覆盖（真机 409 实测需有 agent 真在跑的会话，留待实机场景）。

- **流式期每帧热点性能契约**：stats-line 快路径 `statsAnchorAlive`（失位先摘旧标记再回落慢路径，scopes 恒 `['*']`）；installed-list 观察者走 `core/raf-scheduler.ts` rAF 合并（flush 重验 mq，dispose cancel）；抽屉会话树 `content-visibility:auto` 为会话数增大后的渐进增强；arm-open 冻结治本在宿主（React 互斥子树同步挂载），插件 CSS 只能消 layout/paint 份额 → `docs/maintenance/pitfalls.md` §性能契约。

- **宿主 Shiki 高亮止血 patch**：`tokenizeTimeLimit:0`（单块不限时）→ `100`ms，消除大 code 块高亮尖刺。文件：`~/../usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-ClqxG24t.js`（宿主前端是独立依赖 dsh-web-frontend 的 dist，发布包内无源码）。重放命令（宿主升级后，文件名 hash 可能变化，先 `grep -rl tokenizeTimeLimit` 重新定位）：`cp <file> ~/dsh-web-mobile/.local-tests/<name>.bak-pre-shiki && sed -i "s/tokenizeTimeLimit:0/tokenizeTimeLimit:100/" <file>`。备份在 `~/dsh-web-mobile/.local-tests/index-ClqxG24t.js.bak-pre-shiki`（恢复即还原）。已验证：served 生效 + 真 6.8MB 会话 boot 正常 phase=active；超时降级行为（超预算块变纯文本、内容完整）未在真块上实测——真机若见个别块无语法色即此降级，属预期，可调大数值。

- **npm 包改名边界（2026-08-30：dsh-mobile-nav → dsh-web-mobile）**：包名、patch 行 id/name、client loader id、served 路径 `/plugins/dsh-web-mobile/`、style dataset `data-plugin` 与 CSS 动画名（`dsh-web-mobile-fade/sheet-in/sheet-up`）全部随新名；**刻意不改**：DOM 标记 `data-mobile-nav="frame"` 族与 `?mobile-nav-debug=1` 参数（用户可见契约，保持短且已文档化）。旧 npm 名 dsh-mobile-nav（2.2.0/2.3.0）已整包 unpublish、不可恢复；DSHA 的 vendored 副本仍是 `@dsh-external/dsh-mobile-nav`（2.1.x 代），不影响其 APK 运行，等它 re-vendor 才对齐。仓库目录名保持 `~/dsh-mobile-nav` 不改（AGENTS/Shiki patch 备份路径引用它，改目录名会断链）。本机 profile 换新名需重跑 `dsh plugin --profile web add link:~/dsh-mobile-nav` 并重启 `dsh web`。旧名用户的迁移契约：**必须 rm 旧名 → add 新名，不能并存**——patch 行 id 随包名一起换了，两行 bundle 会让宿主把同一插件加载两份（style/slot/locale 双重注册，locale 重复注册直接抛错）；旧名 unpublish 后死依赖会毒化 profile 的所有后续 install（与 /root 机 dsh-api-dashboard 404 同机制），所以这是强制迁移而非可选更新；README 包名说明里已附迁移命令。

## Testing & QA

- **设置/插件市场调试地图**：`docs/debug/settings-market-debug-map.md` —— 设置区与市场 UI 的 DOM 层级图、入口链路、CSS module 哈希对照表（VOzbGW_/eGUBIq_/hHd-Xa_…）、compat 干预点索引与 CDP 取证 SOP。排查该区域布局/弹层问题先读它，不要重新摸索层级。（此文档仅本地保留，已加入 .gitignore 不随仓库上传。）
- Automated gates: `pnpm verify` (typecheck) and `pnpm test:core`（12 个测试文件，glob 覆盖 `tests/` 全部）. `pnpm build` additionally exercises the custom client bundler. Use `git diff --check` for whitespace hygiene.
- There is no linter, formatter, or coverage setup; the CI workflow (`.github/workflows/ci.yml`) additionally runs the lib freshness gate `git diff --exit-code lib`.
- After source/layout changes, install the linked plugin in a real DSH Web profile, restart `dsh web`, and check both sides of the breakpoint:
  - **Narrow phone (~390px):** rail hidden; drawer/FAB/backdrop open and close; Escape; session-row action menus do not close the drawer; settings remains usable; Files opens explorer/preview sheets; session-log/footer actions work; preview fullscreen opens and resets.
  - **Tablet (768–1023px):** verify the intended centered and width-constrained sheet geometry separately from phone behavior.
  - **Desktop (≥1024px) and narrow desktop windows (mouse pointer, e.g. 900×700 split view):** compare with the plugin disabled; there must be no layout or interaction change at ANY width — the pointer guard keeps mouse-driven windows desktop even below 1024px (headless: do NOT enable touch emulation for these scenes). One exception (v2.4.1): wide touch (≥1024px, pointer coarse, e.g. a tablet in landscape) intentionally gains the injected 「删除会话」 item + confirm dialog (session-delete probe scenes 16a-16d); mouse-driven windows must still show none (scenes 15c/15d).
- For phone-side debugging, add `?mobile-nav-debug=1` to display live viewport, frame/marker, floating-panel, and captured-JavaScript-error state. The optional `pnpm smoke:cdp` is a targeted smoke probe, not a replacement for real-profile checks.
- Playwright 验证 DSH Web 移动端布局必须用**全新 browser context**，并通过 `addInitScript` 写入 `localStorage['dsh.sessions.current'] = JSON.stringify({sessionId})`；复用长活 context 会出现「fence-only」假象（见 Pitfalls「页面状态/bundle 校验」）。点 backdrop 关抽屉时默认点元素中心会被抽屉盖住，改用 `page.mouse.click(x, y)` 点抽屉右侧露出区域。
- 不要用 Playwright route 拦截插件 `client.js` 并 fulfill 空 body 做 A/B 实验：空响应被缓存后 boot 会报「loaded without registering」并挂起。A/B 用 `git show <commit>:lib/client.js > lib/client.js` 换文件。
- **Playwright MCP 报「Session not found」或 MCP 恢复无望时，用原生 CDP 写 Node 探针**（playwright-core 的 registry 在 android 平台直接抛 `Unsupported platform: android`——无论全局 @playwright/mcp 自带副本还是 openclaw 副本，`chromium.launch()` 都起不来，别再试）。可行做法：spawn 系统 chromium（`--headless=new --no-sandbox --disable-dev-shm-usage --remote-debugging-port=<port> --user-data-dir=<dir>`）+ fetch `/json` 取 webSocketDebuggerUrl + 原生 WebSocket 收发 CDP（Page.navigate / Runtime.evaluate(returnByValue) / Input.dispatchMouseEvent / Page.captureScreenshot / Emulation.setDeviceMetricsOverride）；可参考 `scripts/cdp-probe.mjs` 的 createCdpClient 实现。会话注入仍在导航前 `Page.addScriptToEvaluateOnNewDocument` 写 `localStorage['dsh.sessions.current']`。
- **Termux 上 headless chromium 必须给可写的 TMPDIR 与 XDG_RUNTIME_DIR**（spawn env 指到 `~/tmp` 下自建目录），否则 ProcessSingleton 建 socket 失败报「Failed to create a ProcessSingleton」直接退出、CDP 端口永不上线。工具 exec 环境里 `$HOME` 可能为空（`mkdir -p $HOME/x` 会打到 `/tmp`）——env 一律用绝对路径。另：node 的 `spawn` 无法 exec `chromium-browser` 包装脚本（symlink → chromium-launcher.sh，libuv 拿 EACCES，而经 sh 跑同一脚本却正常）——探针用 `DSH_PROBE_CHROME=/data/data/com.termux/files/usr/lib/chromium/chrome` 直指真实 ELF（实测 750ms 就绪）。临时脚本与截图放 `~/tmp/` 用完清理；视觉工具（vision_glance/describe_image）只接受 workspace 内路径且依赖外部视觉凭证（401=凭证失效，别硬重试）。
- Validate compatible third-party versions when exercising integrations（2026-09-04 实装）：宿主 `@deepseek-ai/dsh` 0.1.1-rc.2、`@linxin666/dsh-web-ui-all` 0.1.20、`dshmarket` 1.38.0、`dsh-meme` 0.1.39、`dsh-usage-stats` 0.3.1 (github)、`@omdsh-dev/dsh-genui` 0.9.1 (github)。以 `~/.dsh/profiles/web/node_modules/<pkg>/package.json` 的实装版本为准（profile package.json 里是 `^` 范围，会静默升 minor），升级后回来对账。
- **外部贡献合并前必须过「与既有体系冲突」检查**（#47 教训，2026-09-06 补课）：外部贡献者不知道仓库已有什么——PR #47 的 iOS floor 方案与仓库既有 16px 下限体系（misc.css `html[data-mobile-nav-ios]` 门控）冗余且会引入第二次 viewport 改写。合并 fork/PR 前先盘点与本改动同域的既有机制（viewport 所有权、16px 下限、手势让位、marker 契约清单、composer 固定控件三件套），逐一判断贡献是冗余、冲突还是互补；冗余部分砍掉、冲突部分以仓库体系为准，互补才并入。

## Maintenance

- **fork wzxmt-zhc 对账/摘抄专项文档**：`docs/fork-wzxmt-zhc/` —— README（对账快照 + 接手协议）、`backlog.md`（摘抄清单与决策，三档：直接摘/对账合并/参考不摘）、`log.md`（推进日志，做完一步记一条）。接手该专项先读 README；动手前必须重新 fetch fork（未配置 remote，命令在 README 接手协议里），快照会过时。
- This file is a living reference. Whenever you discover a new repo-specific command, convention, or pitfall, update it in place.
- Keep it accurate and concise; remove stale entries as the codebase changes (e.g. removed features, renamed files, new scripts).
- Verify claims against source before writing them; do not preserve guidance that no longer matches the current tree.

## 维护入口

- 回归探针：`scripts/probes/`（9 个回归锚点，node:builtin-only，可单跑；主探针 `pnpm smoke:cdp` 与手势门 `cdp-swipe-failures.mjs` 见 Commands）。
- 设计 spec：`docs/specs/`（权威设计文档随仓库走）；`.local-tests/` 探针原稿、`docs/superpowers/` 与 `docs/debug/settings-market-debug-map.md` 仍是本地不入库。
- CI：`.github/workflows/ci.yml`——verify → test:core → build → `git diff --exit-code lib`（lib 新鲜度门）。
- 引擎底线：`package.json` engines `node >=24.0.0`（tests 依赖 Node 原生 TS type-stripping）。
- 宿主升级对账清单：`docs/upstream/upgrade-runbook.md`；哈希契约机读版 `docs/upstream/compat-contracts.json`，自动对账 `node scripts/cdp-compat-contracts.mjs`（无需 SESSION_ID；非 lazy MISS 才 exit 1，SKIP 按条目 `state` 手动复扫）。
