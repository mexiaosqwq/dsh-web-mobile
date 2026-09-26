# dsh-web-mobile

## Project

- Single-package, client-only plugin for the DSH (DeepSeek Harness) Web UI. It adapts the web UI on **touch-primary devices with a viewport below 1024px** (overlay drawer, full-width conversation, adapted settings/explorer/preview sheets, status-bar safe areas, composer row, stats line). The activation query is `MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'` (phone-chrome.ts): width alone cannot distinguish a phone from a narrow desktop window — split views and OS display scaling push a PC's CSS viewport below 1024px too (2026-08-30 PC leak). A mouse-driven window (`pointer: fine`) or pointer-less one stays desktop at **every** width; the desktop hide block in misc.css.ts is the exact complement of MOBILE_QUERY as a comma list and hides the slot-rendered controls outside the mobile branch. ONE deliberate exception (v2.4.1): the session-delete trio (menu item + confirm/error dialog) arms on `TOUCH_QUERY = '(pointer: coarse)'` at EVERY width, so a large tablet in landscape keeps the desktop layout but still gets the 「删除会话」 item.
- Names differ by boundary: README/GitHub project = `dsh-web-mobile`; npm package = `dsh-web-mobile`（2026-08-30 由 dsh-mobile-nav 改名而来，旧名连同 2.2.0/2.3.0 已整包 unpublish，npm 上不再存在）; patch row id = `dsh-web-mobile`（DOM 标记 `data-mobile-nav` 与 `?mobile-nav-debug=1` 参数刻意保留旧词根，见 Pitfalls）。
- 已被 [DSHA](https://github.com/qiannianhuanxiang/DSHA)（Android 启动器）内置为移动端适配（README 已致谢 @qiannianhuanxiang，commit ffb61b5）——DSHA 用户装 APK 即用。
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
  │     ├─ index.tsx         ← 浏览器半区入口（3 slots）
  │     ├─ debug.ts          ← ?mobile-nav-debug=1 诊断徽章
  │     ├─ components/       ← MobileNavToggle / MobileDrawerFooter / ComposerFileButton / open-files-panel.ts
  │     ├─ core/             ← reconciler-core.ts（零 import）+ raf-scheduler.ts · css-rules.ts · sessions-compat.ts · layout-compat.ts · icon-compat.ts（宿主图标跨代命名兼容）
  │     ├─ effects/          ← 18 个效果模块：phone-chrome · sidebar-swipe ·
  │     │                       gesture-guard · subagent-chip-touch · composer-keyboard-guard ·
  │     │                       shortcut-modal-keyboard-guard ·
  │     │                       composer-plus-toggle · workspace-chip-toggle · team-chip-toggle ·
  │     │                       model-menu-anchor ·
  │     │                       file-viewer-compat · aionui-compat · stats-line ·
  │     │                       preview-fullscreen ·
  │     │                       overlay-backdrop-fab · panel-exit · session-menu · session-row-fiber
  │     ├─ styles/           ← index.ts（base→layout→compat→misc 承载顺序）+ 4 个 .css.ts
  │     └─ i18n/locales.ts
  ├─ lib/                    ← 生成物：随 pnpm build 刷新，勿手改
  │  └─ types/…              ← d.ts+map；合并同 CSS 模块的 PR 在 .css.d.ts 冲突 → 重建
  ├─ scripts/
  │  ├─ build-client.mjs     ← 自研客户端打包器
  │  ├─ cdp-probe.mjs        ← 主探针 14 项核心断言（+6 集成，EXPECTED_FAILURES 基线）
  │  ├─ cdp-swipe-probe/failures · cdp-zoom-probe · cdp-compat-contracts (.mjs)
  │  ├─ css-structure-check.mjs ← CSS 结构检测器（已接入 test:core）
  │  └─ probes/              ← 22 个回归锚点（builtin-only，可单跑）
  ├─ tests/                  ← 34 个 .test.ts（node --test，type-stripping 直跑）
  ├─ docs/
  │  ├─ specs/               ← 8 篇权威设计文档（入库）
  │  ├─ audits/ · maintenance/pitfalls.md · upstream/（runbook + compat-contracts.json + host-jank-feedback.md）· fork-wzxmt-zhc/
  │  └─ debug/ · superpowers/ ← 本地不入库（例外：composer-tree-recon.md 与 settings-market-debug-map.md 已于 2026-09-25 入库）
  ├─ .github/workflows/ci.yml ← verify → test:core → build → git diff --exit-code lib
  ├─ assets/                 ← README 用图
  └─ .local-tests/ · .codegraph/ · .dsh-vision-toolkit/  ← 本地不入库（gitignore 噪音区）
  ```

## Docs

文档路由表——遇到下述场景先读对应文档，不要重新摸索；新增长效文档必须在此挂触发行，目标没了删行防死链。

- 排查设置/插件市场区布局与弹层 → `docs/debug/settings-market-debug-map.md`（DOM 层级/哈希归属/干预点索引/CDP SOP；§8=0.1.7-rc.1 复测、§9=rc.2 portal 换锚对照）
- 排查 composer/输入区 → `docs/debug/composer-tree-recon.md`（composer 子树考古；QA 会话种子配方同源）
- 动手改某块代码前 → `docs/maintenance/pitfalls.md`（58 坑原文，名字=锚点，索引在下方 Pitfalls 节）
- 改手势/面板退出等行为契约 → `docs/specs/`（8 篇权威 spec；手势参数与状态机在 2026-08-27-sidebar-swipe-gestures.md，不可破）
- 宿主升级前 → `docs/upstream/upgrade-runbook.md`（对账清单与验收电池）+ `node scripts/cdp-compat-contracts.mjs`（机读契约自动对账，无需 SESSION_ID）
- 评估宿主代际兼容面 → `docs/upstream/2026-09-23-dsh-0.1.7-alpha.2-compat-audit.md`（28 条对账 0 改的先例与方法）；升 0.1.6-alpha.2 系前必读 `docs/upstream/2026-09-19-dsh-0.1.6-alpha.2-compat-audit.md` §10（升级前必修 3 项 + 电池 15 项）
- 宿主会话切换卡顿/性能归因 → `docs/audits/2026-09-23-session-switch-jank-handover.md`（归因 + 止血/上游两条路线）+ `docs/upstream/host-jank-feedback.md`（上游反馈通道，tokenizeTimeLimit 更正在此）
- 0.1.7-rc.1 手机端适配待办 → `docs/audits/2026-09-23-0.1.7-rc.1-adaptation-handover.md`（容器内 chromium 取证通道 + A/B 与真机读数）
- 手机端会话头部/输入框 0.1.6 适配 → `docs/upstream/2026-09-19-mobile-header-0.1.6-adaptation.md`（16 条，14 已并入 layout 移动块）
- CSS 结构回归 → `docs/audits/2026-09-15-css-surface-audit.md`（结构检测器已接入 `test:core`，基线 0 fatal / 4 info；缩进/媒体查询/选择器拆分回归会红）
- 接手 fork wzxmt-zhc 摘抄专项 → `docs/fork-wzxmt-zhc/README.md`（先读接手协议，动手前重新 fetch fork）

## Commands

```sh
pnpm install                       # install (pnpm@11.7.0, lockfile v9)
pnpm verify                        # type-check host + client halves (tsc --noEmit)
pnpm test:core                     # node --test tests/*.test.ts (unit tests)
pnpm build                         # tsc host && tsc client && node scripts/build-client.mjs
npm run prepack                    # runs npm run build before packaging
npm pack                           # package smoke check (invokes prepack)
```

- `test:core` = `node --test tests/*.test.ts`（glob；2026-08-31 前是硬编码列表，长期落后于 `tests/`）。
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
- iOS 聚焦放大守卫探针（#45 / #46，23 断言）：`node scripts/cdp-zoom-probe.mjs`（同组 env）。三场景：手机+Chromium UA（无 iOS 标记、第三方 13px 输入框不变、注入的 14px 可编辑域不被抬高）、手机+iPhone UA（标记就位、所有可见文本输入域 >=16px、composer 三件套同尺寸、控件类 input/select 未被改、注入的 14px contenteditable 抬到 16px 而其 `contenteditable="false"` 装饰节点保持 12px）、桌面（标记缺席、字号零影响）；兼验根/抽屉 `touch-action` 含 `pinch-zoom` 且不含 `pan-x`、`gesturestart` 不再被 preventDefault。A7/B6 注入的形状就是 dsh 0.1.2-rc.1 的 Lexical composer，用来在旧宿主上前瞻验证下一版。A11/B7 守 D-1 决策：`_customInput`/`_customTextarea`/`dsfv-*-input` 只在 iOS 抬到 16px（读计算值；旧 bundle 上 A11 实测红 ⇒ 非空转）。A8-A10 守 viewport meta 的所有权（#46 合并部分）：武装期内容必须恰好 `width=device-width, initial-scale=1, viewport-fit=cover`（**出现 maximum-scale/user-scalable 即回归**），宿主改写与整节点替换都要被重申回来。

- Local DSH profile workflow:

```sh
dsh plugin --profile web add link:/path/to/dsh-web-mobile
dsh --profile web --dump-config   # should contain the dsh-web-mobile row
dsh web
```

## Architecture

- Host/client split is load-bearing. All browser behavior lives in `src/client/`; the host half installs the response-compression patch plus the session-delete endpoint (deletion work in the DI pure core `src/delete-session.ts`, generation-adapted per host).
- `src/client/index.tsx` injects `['slots', 'layout', 'locale', 'sessionLogDownload', 'sessions', 'workspaces']`. Its `apply()` registers locale dictionaries, injects one `<style data-plugin>` tag, installs effects, and registers three slots:
  - `conversation.session.header.actions` → `MobileNavToggle` (`order: 10`): drawer toggle + Files button.
  - `conversation.input.left` → `ComposerFileButton` (`id: mobile-nav-file-upload`, `order: 10`): the permanent composer file entry. Host 0.1.6 deleted the paperclip attach button, leaving the 「文件」row inside the "+" listbox as the only entry; this control sits in the tools lane beside the plus button and triggers the host's own hidden `input[type=file]`, so intake validation, upload and availability stay host-owned. Session-scoped — the hero/blank phase keeps the "+" menu as its only file entry.
  - `sidebar.footer.action` → `MobileDrawerFooter` (`id: mobile-nav-session-log`, `order: 5`): the session-log export pill only — the Files entry that used to sit beside it was removed on 2026-09-17 (with the drawer open neither the host nor the third-party dismiss shim lets a click reach the right-sidebar opener; contract in `docs/specs/2026-09-17-sidebar-files-coexistence-design.md`). Order 5 keeps them below the remote icon row (order default 0) and above usage badges (order 10). Do not tie with usage stats.
  - There is **no settings slot** anymore; the haptic feedback feature was removed.
- Shared full-tree reconciler:
  - `src/client/core/reconciler-core.ts` is a DOM-free engine with **zero imports**. It owns task registry, dirty-key routing (`scopes`), coalesced rAF flush scheduling, and per-task error isolation.
  - `src/client/effects/phone-chrome.ts` is the thin browser adapter: one `MutationObserver` on `document.documentElement` maps records to dirty keys (`attributeName`, or `'*'` for tree changes), feeds `core.note()`, and drives activation/deactivation via `installMobileEffect`.
  - Tasks only run while the mobile breakpoint is active, coalesced to one pass per animation frame. `stats-line` must stay `scopes: ['*']` because TPS updates are childList/characterData text mutations.
  - Registered tasks: `frame-marker`, `preview-fullscreen-toggle`, `preview-close-sync`, `sheet-rise-replay`, `stats-line`, `overlay-backdrop-fab`, `panel-back-exit`.
- Effects:
  - `phone-chrome.ts` — status bar/theme-color/viewport meta, the iOS focus-zoom marker (`detectIosWebKit` → `html[data-mobile-nav-ios]`), drawer close interactions (Escape + navigation taps), and the overlay backdrop/FAB via reconciler tasks.
  - `sidebar-swipe.ts` + `gesture-guard.ts` — drawer swipe gestures：开=8px 锁轴**提前提交**（inline `-101%` 百分比基线跟随 + arm 帧 `content-visibility:hidden` 拆挂载）；关=**晚提交**（inline 280ms 滑到自身宽×110% px 槽位后翻 marker，防 React 中途换子树）；遮罩经 `fadeOverlayOut` 渐隐；右缘 files 手势与抽屉手势同层双族路由（判定矩阵与已踩坑见 Pitfalls「files 手势」）；`gesture-guard.ts` supplies the host-yield consume marks + stroke axis lock.
  - `aionui-compat.ts` — dsh-web-ui explorer/preview markers and sheet rise animation.
  - `stats-line.ts` — marks the official status row; the context ring and TPS readout stay where React rendered them and are overlaid on plugin-owned placeholder slots（#104：宿主 React 节点禁搬，见 Pitfalls「搬宿主 React 节点」）.
  - `debug.ts` — opt-in `?mobile-nav-debug=1` live diagnostic badge (no-op without the query param).
  - `subagent-chip-touch.ts` — touch compatibility for the subagent count chip and touch nav-arm close (see Pitfalls).
  - `composer-keyboard-guard.ts` — iOS-only: tapping the composer's send/stop/+ buttons must not re-raise a dismissed keyboard (upstream `keepFocus` focuses the editor on `mousedown`, PR #48; DOM-contract notes in the file header).
  - `workspace-chip-toggle.ts` — hero 工作区 chip 的「再点关闭」：宿主把选择器菜单开成
    `<Menu anchor={null} portal>`，触发器在 Menu 子树外，于是它的「外部 pointerdown 关闭」
    把 chip 自己的第二击也吃掉；本效果只吞那一击 click，让宿主的关闭成为唯一结果
    （同型：`composer-plus-toggle.ts`；见 Pitfalls「工作区 chip 再点关闭」）。
  - `team-chip-toggle.ts` — 智能体团队 chip 的「再点关闭」：宿主 agent-team 插件的触发器
    onClick 只在关闭时 `changeOpen(true)`、开态时仅 focus 面板，**永不 toggle**；关闭只靠
    outside pointerdown / Escape。本效果开态时先替用户向 `document.body` 派发一次合成
    pointerdown（走宿主自己的 dismiss），再吞掉那颗 click（顺序不可换）。见 Pitfalls「header 拥挤」。
  - `session-menu.ts` — touch-gated injection of a 「删除会话」 item into the workspace session-row ⋯ menu (clone-and-inject from the fork wzxmt-zhc v2.7.0): guard = TOUCH_QUERY (`(pointer: coarse)` at EVERY width — large tablets in landscape included, v2.4.1) + row/menu/label selectors present; inert on hosts whose drawer renders the rail variant (rc.2), activates on hosts rendering session rows in the drawer (0.1.3) or on the ≥1024px desktop panel; after deleting the current session `toggleDrawer(ctx)` only runs on the mobile query (desktop panels must not collapse); confirmation dialog markup/styles live in base.css.ts (wide-touch card capped 420px centered) with corrected animation names.
  - `panel-exit.ts` — 侧边栏面板的退出：系统返回键/手势（popstate 记账）、再点已选中的面板行、以及面板视图下左上角按钮的语义切换；三条路共用一个 `exit`。`core/layout-compat.ts` 探测 `ctx.layout.selectPanel` 是否存在于本代宿主（rc.6 没有），缺失则整条特性惰性化。
  - `shortcut-modal-keyboard-guard.ts` — 手机档：快捷键弹层（宿主 `dsh-client-ui-shortcuts` 的
    `data-shortcut-modal="shortcuts"`）打开时会把焦点抢到搜索框，手机随即弹软键盘 —— 用户是来编辑
    快捷键的，键盘却盖掉半屏，而且弹层按 `100dvh` 定高、键盘一压就整体缩一截（实测 844→520 时
    600px→496px，就是「打开就闪」）。这里给搜索框挂一个 own 的 no-op `focus` 影子方法（同
    `composer-keyboard-guard.ts` 的手法）：宿主的 `focusWithoutRing` 落到影子上、输入框不获得焦点、
    键盘不起；点击不受影响（浏览器原生聚焦不经过 JS 方法），搜一次仍是一次点按。影子在
    MutationObserver（只盯 `document.body` 的 childList）里安装 —— 微任务早于 React 的被动 effect，
    所以第一帧抢焦也拦得住；弹层移除时 `delete` 还原。
  - Reconciler task modules: `preview-fullscreen.ts`, `overlay-backdrop-fab.ts`, `panel-exit.ts`.
- Styles: `src/client/styles/index.ts` concatenates `base → layout → compat → misc` in that load-bearing order and injects one `<style data-plugin>` tag. Mobile rules target `(max-width: 1023px) and (pointer: coarse)` (keep every top-level media block in sync with `MOBILE_QUERY`); the desktop hide block in misc.css.ts is its exact complement and must preserve the uninstalled layout.
- Third-party compatibility is implemented through scoped DOM markers, stable `data-*` attributes, `MutationObserver`, and carefully scoped class/text anchors. Never modify third-party source packages.
- Authoritative design docs: `docs/specs/2026-08-27-sidebar-swipe-gestures.md` (gesture parameters/state machine) and `docs/audits/2026-08-27-sidebar-swipe-latent-defects.md` (gesture defect baseline).

## Workflow

- **「全面更新」类指令默认按增量理解（用户要求，2026-09-25）**：用户说「全面更新」某文档 ≠ 推倒重写——口径是「该更新的更新（失效处就地小改）、该新增的新增（文末追加带日期增补节）」，原文结构与编号保留；实测纠偏发生后再问就晚了，文档类任务一律按此执行。
- **main 已启用 PR-only 保护（2026-09-25 实测 GH013 拒直推，含 docs 小改）**：一切变更（含文档）走 分支→PR→CI→merge；**合并后立即删远端分支**（`git push origin --delete <branch>`；#118/#119/#120 漏删堆出 28 个陈旧分支，已清理）。本工作区有未提交改动时合并 PR 不要带 `--delete-branch`（会触发本地分支切换）。
- **外部制作人 PR 主张独立验证（用户要求，2026-09-27）**：另一制作人的 PR/修复主张（如 #128 的「三道防线」）不当事实采信——以仓库实测（CDP 动态探针/锚测试/亲读代码路径）与用户真机验收为准；「桌面实测通过」对真机只有旁证力（2026-09-27 会话三次实锤：CDP 绿 ≠ 真机好）。
- **开场模糊指令先问再动（用户要求，2026-09-24）**：新开会话收到「跟进一下 X」「继续」等未给目标的指令时，**直接一句话问用户要目标与范围**，禁止自行展开 recall + 多路探测的重建调查链（浪费上下文与 token，用户点名批评）；团队协作同理——派成员干活前先问清目标，不派成员替我猜。例外：用户明说「自己找/搜刮」时仍先搜不反问。
- **动手前自行调用 karpathy-guidelines（用户要求，2026-09-24）**：每次开始实际工作（写码/改码/排查/审查）前，先自行调用 `karpathy-guidelines` 技能加载完整准则再动手，不凭印象裸跑；不着急，先摸清再动手。
- **Bug 定位先报告、确认后再修（用户要求，2026-09-19）**：需要跟踪定位的 bug——多步调查、根因不明、现象与成因相距远的那种——定位到根因后**不要立刻动手修**，先给出清晰报告：症状、根因、证据链、影响范围、拟议修复（有取舍时列选项），等用户确认再执行。一眼即明的简单修复不在此列。
- **用户协作偏好自动入库（用户要求，2026-09-19）**：用户在对话中提出的协作偏好/工作流要求（如上一条这类），**当场写进本文件对应节**，不必等用户点名「写进 AGENTS.md」；入库后在回复里提一句写到了哪里。记忆只做跨会话备份，不能替代本文件。
- **宿主升级必须用户单独确认（用户要求，2026-09-19）**：默认只做源码/静态对账，**不动宿主**；alpha 通道一律不上机（隐藏 bug 风险 + 会话格式迁移不可逆）。真要升级先备份 `~/.dsh/sessions`，升级后按 runbook 电池验收。
- **发版动作必须用户单独同意（用户要求，2026-09-25）**：版本 bump + tag + npm publish + GitHub Release 属对外发布动作，收口闭环走到发版步时**停下来等用户点头**再执行；代码修复/commit/PR/merge 不在此列。
- **审查规模与改动成正比（用户要求，2026-09-19）**：PR/改动审查默认**自己一遍过**（CI 状态 + 静态对账 + 抽读核心 diff），不为流程排场派多代理；只有真大范围改动（跨多模块 / 数百行 diff / 触碰手势与宿主契约）才考虑拆专项，且派前先问用户。**团队在场时例外（用户要求，2026-09-23）**：已拉起成员（chief-checker / content-retriever 等）时，检查、取证、复查类工作直接 send_message 派给成员完成，lead 不再亲自重做；成员报告仍按 lead 终审铁律亲验关键证据。
- **团队岗位分离 SOP（用户要求，2026-09-19）**：多代理协作按三岗走——**实施岗**唯一写代码（接规格令→落码→自检→报告，不跑浏览器）；**验收岗（QA）**唯一接收 bug 与执行测试（browser-review 技能清单 + 探针电池 + 标准报告，不写代码）；**lead** 分诊/拍板/三门+build/对用户。每件 bug 固定回路：报告→定位令→落码→门验→QA 标准报告→PASS 收口 / FAIL 回炉（修复轮 ≤3 记台账）→用户验收。端侧资源纪律：headless chromium 先批后跑、单实例、合并多场景采集、跑完即杀（2026-09-19 OOM 实锤）。
- **lead 终审铁律（2026-09-19 深查事故后补）**：合并/提交前 lead 全量亲验，禁止只看报告数字：①diff 的**删除行必读**（grep 过滤 `+` 行会漏掉 context 里被删的承载代码，实测造出过伪证）；②QA/子代理的**证据文件必亲读**（报告可能漏报自身缺陷，实测探针结尾崩溃未披露）；③「零残留/exit 0」类自证声明要有脚本外旁证；④报告与证据文件不一致处必须声明（报告纪律）。
- **成员完工落盘交接文档（用户要求，2026-09-24）**：每个成员（scout/worker/checker）完成任务后，除聊天回执外必须把完整结果写成 Markdown 落盘 `docs/handover/`（本地不入库，见 .gitignore）：`YYYY-MM-DD-<令号或主题>-<岗位>.md`，内容 = Status + 与规格/现象对照 + 证据（文件:行号）+ 变更/取证清单 + 残留风险。lead 终审与后续成员接力以该文档为准，聊天消息只作通知，不以「简单谈话」作交接载体。

## Conventions

- Keep the host/client split intact; the host half stays minimal (`apply()` installs response compression + the session-delete endpoint, nothing else).
- Use stable `data-*` markers and structural selectors before hashed classes. For unavoidable hashed classes use substring matching (`[class*=_frag]`), never attribute-suffix (`[class$=…]`) — the class attribute often carries extra tokens or trailing spaces, and a suffix test runs against the whole attribute value, so it silently misses (verified in the full-codebase migration). Scope the selector to its owning region and guard prefix-overlapping fragments with `:not`; for tree rows use `[class*="_treeRow"]` and exclude `[class*="_treeArrowEmpty"]` when distinguishing directories from files.
- Put every long-lived style tag, listener, timer, or `MutationObserver` inside `ctx.effect(() => { ...; return disposer }, label)`. Re-arm width-sensitive effects on `matchMedia(MOBILE_QUERY)` changes via `installMobileEffect` so wide→narrow transitions work; import the constant from phone-chrome.ts instead of hardcoding query strings.
- Treat DOM markers as the cross-module state contract: `data-mobile-nav="frame"`, `data-sidebar-collapsed`, `data-aionui-explorer-open`, `data-aionui-preview-open`, `data-mobile-preview-full`, `data-mobile-nav="stats"`, `data-mobile-nav="stats-ring"` + overlay 体系五标记（`stats-ring-reserve` / `stats-tps-reserve` / `stats-tps` / `stats-ring-dock` / `stats-tps-row`，#104）， `data-file-viewer-open` (frame-level gate for the dsh-file-viewer compat layout, keyed on `.dsfv-panel`), `data-mobile-nav="session-delete"` (menu-item probe key), `delete-dialog-backdrop` + `delete-dialog` (confirmation dialog), and `data-mobile-nav-ios` (on `<html>`, iOS-only CSS gate).
- Use idempotent `ensure()`/reparent logic when injecting nodes into third-party React-owned DOM. Clean up moved nodes, observers, attributes, and listeners on disposal.
- Obtain DSH services through the declared fiber `inject` list and slot `inject` props; use React state for local mirrors and `data-*` markers for cross-effect state.
- Client runtime effects are currently synchronous DOM work; follow that pattern unless a new contract requires async behavior. Use the debug badge's captured `error`/`unhandledrejection` output when diagnosing failures instead of swallowing exceptions.
- TypeScript style: single quotes, no semicolons, explicit exported return types, installer names `install<Domain>`.
- Client-local relative imports must include `.ts`/`.tsx` extensions; `tsconfig.client.json` rewrites them for CommonJS emit. Use type-only imports for DSH module augmentation and SlotMap/Context typing.
- **`src/client/effects/` 的 `../` import：原禁令已证伪（2026-09-14 A/B 实测）**。曾被记为「自定义打包器无法解析 effects 向父级的相对 require，会把 `../x.ts` 误解析为同目录 `x.js` 并报 `client module not found`」——实测**不成立**：`phone-chrome.ts` 的值导入 `import { createReconcilerCore } from '../core/reconciler-core.ts'` 一直正常，A/B 把 `const NS` 镜像换成 `import { NS } from '../i18n/locales.ts'` 后 `pnpm build` 通过、bundle 里落成 `require("./i18n/locales.js")` + `__modules["i18n/locales.js"]`（26 模块内联不变），已还原。所以**跨目录导入本身可用**；当年报错的 `../locales.ts`（`locales.ts` 后迁到 `i18n/`）已无法复现，具体触发条件未定（不排除当时是源码/构建产物不同步，须再撞到才能定论——别把这条当已解释的历史）。**仍然要守的既有事实**：`reconciler-core.ts` 保持零 import；task 模块拿 `ReconcilerTask` 类型：`reconciler-core.ts` 导出类型、`phone-chrome.ts` 是适配器（现为 `import type`，编译期擦除、不进 bundle）。新代码不必为「禁令」绕路加镜像常量——能 import 就直接 import。
- Add locale keys to `zh` first, then mirror the same keys in typed `en`; `MobileNavKey` is derived from `zh`.
- Keep CSS in `src/client/styles/`, not in component files. Preserve the `base → layout → compat → misc` concatenation order and complete CSS comments/section boundaries. **该顺序是行为契约，不是排版偏好**：aionui 探索器/预览两列的平板档「居中不铺满」压在 compat 的铺满规则之上（两者同 (0,1,0) 且都 `!important`，只靠 misc 在后分胜负——把顺序翻过来就退回铺满，2026-09-16 用 `order-flip.mjs` 复现）。
- Preserve mobile-only behavior and modal precedence: capture-phase drawer handlers must yield to `[aria-modal="true"]` dialogs and ignore session-row action buttons. `transform: none`, rather than an identity `translateX(0)`, is required for the open drawer so fixed descendants keep the correct containing block.
- Do not edit `lib/` directly; rebuild and include generated artifacts after any source/config change.

## Pitfalls

- **58 个坑的索引：名字 = 触发词 = 锚点**。每条原文在 `docs/maintenance/pitfalls.md` 末尾「2026-09-18 迁入原文」节，锚点 `### <名字>`，顺序与下面一一对应。**动手改某块代码前，先按名字读对应条目**——里面是踩过的坑、最硬铁律、实测数据、探针断言与被否决方案；不看就改等于重踩。
- 本文件只放名字，正文一律进 `docs/`（见 Maintenance「体积门槛」）：新增坑位 = 名字加进下面清单 + 原文写进该档并补 `### 同名` 锚点。

- `手势层`
- `files 手势`
- `抽屉导航 click`
- `抽屉行菜单`
- `backdrop 误吞`
- `composer 行`
- `键盘 guard`
- `断点与设备`
- `探针运行环境`
- `iOS zoom`
- `探针基线`
- `meme 卡`
- `preset 菜单`
- `header 拥挤`
- `header 行高与弹层`
- `files 按钮`
- `哈希子串`
- `工具栏锚定`
- `tooltip`
- `hero 净空`
- `hero 输入框下限`
- `overlay 两信号`
- `tab strip`
- `reconciler`
- `文档漂移`
- `合并冲突`
- `子代理芯片`
- `subagent 两代`
- `irow`
- `市场头`
- `dshmarket`
- `debug badge`
- `反引号`
- `has 下限`
- `lib 纪律`
- `bundle 校验`
- `host ESM`
- `safe-area`
- `Files 面板 safe-area`
- `响应压缩`
- `会话删除`
- `0.1.5 抽屉 z 与遮罩`
- `0.1.5 关态槽位`
- `性能契约`
- `Shiki`
- `包改名边界`
- `字号轴`
- `两个 closer`
- `ghost details`
- `dialog footer 按钮`
- `composer 文件入口`
- `代际门控`
- `谓词复用与豁免`
- `第三方模型条`
- `工作区 chip 再点关闭`
- `全屏侧边栏面板带`
- `搬宿主 React 节点`
- `弹层闪`

## Testing & QA

- Automated gates: `pnpm verify` (typecheck) and `pnpm test:core`（34 个测试文件，glob 覆盖 `tests/` 全部）. `pnpm build` additionally exercises the custom client bundler. Use `git diff --check` for whitespace hygiene.
- There is no linter, formatter, or coverage setup; the CI workflow (`.github/workflows/ci.yml`) additionally runs the lib freshness gate `git diff --exit-code lib`.
- After source/layout changes, install the linked plugin in a real DSH Web profile, restart `dsh web`, and check both sides of the breakpoint:
  - **Narrow phone (~390px):** rail hidden; drawer/FAB/backdrop open and close; Escape; session-row action menus do not close the drawer; settings remains usable; Files opens explorer/preview sheets; session-log/footer actions work; preview fullscreen opens and resets.
  - **Tablet (768–1023px):** verify the intended centered and width-constrained sheet geometry separately from phone behavior.
  - **Desktop (≥1024px) and narrow desktop windows (mouse pointer, e.g. 900×700 split view):** compare with the plugin disabled; there must be no layout or interaction change at ANY width — the pointer guard keeps mouse-driven windows desktop even below 1024px (headless: do NOT enable touch emulation for these scenes). One exception (v2.4.1): wide touch (≥1024px, pointer coarse, e.g. a tablet in landscape) intentionally gains the injected 「删除会话」 item + confirm dialog (session-delete probe scenes 16a-16d); mouse-driven windows must still show none (scenes 15c/15d).
- For phone-side debugging, add `?mobile-nav-debug=1` to display live viewport, frame/marker, floating-panel, and captured-JavaScript-error state. The optional `pnpm smoke:cdp` is a targeted smoke probe, not a replacement for real-profile checks.
- **真机读数通道（2026-09-14）**：`?mobile-nav-debug=1` 除了页面徽章，还会把同一份读数 POST 到本机监听器（默认 `http://127.0.0.1:3199/diag`，`?beacon=<url>` 可覆盖）——「看不到设备屏幕」时用它取证：本机起一个把 body 追加到 `~/tmp/mobile-nav-diag.jsonl` 的小服务即可，页面侧无需人工念数字/截图（截图也读不了，模型无图像输入）。payload 含 `build` 标记、`framePad`（= 解析后的 `env(safe-area-inset-top)`，headless 恒 0）、`rightPanel` 形态/padding/rect、`toggle`/`files`/`header`/`titleCluster` 的 rect、UA 与 visualViewport。no-cors + 文本 body 是简单请求（无预检），没有监听器时静默失败。
- Playwright 验证 DSH Web 移动端布局必须用**全新 browser context**，并通过 `addInitScript` 写入 `localStorage['dsh.sessions.current'] = JSON.stringify({sessionId})`；复用长活 context 会出现「fence-only」假象（见 Pitfalls「bundle 校验」）。点 backdrop 关抽屉时默认点元素中心会被抽屉盖住，改用 `page.mouse.click(x, y)` 点抽屉右侧露出区域。
- 不要用 Playwright route 拦截插件 `client.js` 并 fulfill 空 body 做 A/B 实验：空响应被缓存后 boot 会报「loaded without registering」并挂起。A/B 用 `git show <commit>:lib/client.js > lib/client.js` 换文件。
- **认证 token 向用户索要（用户要求，2026-09-21）**：需要认证访问本机 dsh web（浏览器审查、HTTP 取证）时，**先向用户要 token**（重启输出的 `?token=…` URL 即可用），**不要自行跑 `.local-tests/mint-cookie.mjs` 铸 cookie**——mjs 路径依赖签名文件与路径正确，容易卡死；仅在用户明说可用时才作后备。
- **设备仿真验证优先用 Playwright MCP（本机已装），脚本化回归走原生 CDP**：MCP 自带 Chromium 能起真浏览器打 `127.0.0.1` 的 DSH Web，`browser_run_code_unsafe` 里 `browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })` + 复制 cookie + `addInitScript` 写 `localStorage['dsh.sessions.current']` 就是一台手机；**被桌面布局隐藏的元素必须用 `document.querySelector(sel).click()`，`page.click()` 的可见性检查必失败**；`~/tmp/pw-dsh-tmp` 需先存在，且无 `setSafeAreaInsets`。`playwright-core` 在 android 抛 `Unsupported platform`，所以仓库内脚本一律原生 CDP（`scripts/cdp-probe.mjs` 的 `createCdpClient`）。完整步骤/坑 → `docs/maintenance/pitfalls.md` §探针运行环境。
- **Termux 上 headless chromium 必须给可写的 `TMPDIR` 与 `XDG_RUNTIME_DIR`**（指到 `~/tmp` 下自建目录），否则 ProcessSingleton 建 socket 失败、CDP 端口永不上线；探针的 `DSH_PROBE_CHROME` 可用 `chromium-browser`（2026-09-18 契约探针整跑实测），异常时直指真实 ELF；临时脚本/截图放 `~/tmp/` 用完清理。完整命令与 cookie TTL → `docs/maintenance/pitfalls.md` §探针运行环境。
- Validate compatible third-party versions when exercising integrations（2026-09-19 修正）：**判据是 `~/.dsh/profiles/web/cordis.patch.yml` 的行启用状态，不是 node_modules 里装没装**——2026-09-19 实测 25+ 行全部 `disabled: true`（market/usage-stats/genui/task-board/pet/ssh/skin-center…），唯一启用的 web-all 行是 git-graph；包在树里 ≠ DOM 在场。当前实装：`dsh-web-mobile`、`@dsh-external/seshat`、`@linxin666/dsh-web-all`（仅 git-graph 行）。@omdsh-dev/dsh-genui 与 @changfenhuang/dsh-genui 包逐字节相同（迁移副车）。行状态变更后先重跑 `docs/debug/settings-market-debug-map.md` §5。
- **未安装的第三方插件不做实机复现（用户要求，2026-09-22）**：修复目标插件本机从未安装时（如 #60 的 @hytime/dsh-thinking-effort），验证止步于静态对账 + 单元锚 + 报障者实测数据交叉验证，不装插件、不上机索 token；用户装好后主动要实机验收再说。

- **外部贡献合并前必须过「与既有体系冲突」检查**（#47 教训，2026-09-06 补课）：外部贡献者不知道仓库已有什么——PR #47 的 iOS floor 方案与仓库既有 16px 下限体系（misc.css `html[data-mobile-nav-ios]` 门控）冗余且会引入第二次 viewport 改写。合并 fork/PR 前先盘点与本改动同域的既有机制（viewport 所有权、16px 下限、手势让位、marker 契约清单、composer 固定控件三件套），逐一判断贡献是冗余、冲突还是互补；冗余部分砍掉、冲突部分以仓库体系为准，互补才并入。

## Maintenance

- **fork wzxmt-zhc 对账/摘抄专项文档**：`docs/fork-wzxmt-zhc/` —— README（对账快照 + 接手协议）、`backlog.md`（摘抄清单与决策，三档：直接摘/对账合并/参考不摘）、`log.md`（推进日志，做完一步记一条）。接手该专项先读 README；动手前必须重新 fetch fork（未配置 remote，命令在 README 接手协议里），快照会过时。
- This file is a living reference. Whenever you discover a new repo-specific command, convention, or pitfall, update it in place.
- **体积门槛（2026-09-18 起）**：本文件受工作区指令预算 ~64 KB 限制，超了会被**静默截尾**（末尾内容每轮丢失；实测 65,443 B 时 `## 维护入口` 末条长期读不到）。所以这里只写命令、约定、契约、触发词索引与一两行的铁律；凡是「说不清、要摆证据」的内容一律进 `docs/`（坑位 → `docs/maintenance/pitfalls.md`，设计 → `docs/specs/`，审计 → `docs/audits/`），本文件只留一行指针。
- **知识去向（用户偏好，2026-09-18 拍板）**：零碎的规矩 / 要求 / 偏好 → **写进本文件对应节**，不要只存进记忆（记忆跨会话，但它不能替代仓库文档，而本文件是每个会话都必然读到的那份）；需要推导 / 证据 / 大段流程 / 实测数字的内容 → `docs/`（坑位 → `pitfalls.md`，设计 → `specs/`，审计 → `audits/`，调试考古 → `debug/`，上游契约 → `upstream/`）。记忆只留「跨会话需要主动回忆的教训」，且不得成为某条规矩的唯一存放处。
- **同一 worktree 有并发写者时**：别人可能把你**未提交**的工作区改动一起提交走（症状：`git status` 突然变空、`git diff --exit-code HEAD -- lib` 返回 0 却不是你的提交）。别据此重做改动或补空提交——先 `git show HEAD:<file>` 确认内容已在；提交只 `git add` 自己点名的路径，**绝不 `git add -A`**。
- **文档写法（用户偏好，每次写文档都适用）**：变更条目只描述结果、不写过程；功能不列举特点细节；计数条目（探针 / 测试 / spec 篇数）在 README 与 AGENTS.md 两处必须同步；README「未发布」段参数定稿前先对源码常量核对。
- Keep it accurate and concise; remove stale entries as the codebase changes (e.g. removed features, renamed files, new scripts).
- Verify claims against source before writing them; do not preserve guidance that no longer matches the current tree.

## 维护入口

- **GitHub Release 文案规格（用户要求，2026-09-20）**：Release notes 照 v2.4.1/v2.3.0 文章体例，不许直接贴 README 段落——`## vX.Y.Z · 一句话摘要` 开头 + 导语段（本版是什么、桌面 no-op 承诺、旧宿主回退建议）+ **致谢行必写**（v2.4.0 体例：「特别感谢合作人 @x（PR #63/#65：具体贡献）」+ 社区贡献与报障逐个 `@handle（#NN 报障 / PR #NN）`；条目标题带 `（#NN by @handle）`归属。署名从 GitHub 实测取：PR author + commit author + issue reporter，且只列修复确实落在本 tag 区间的——用 close 日期、closed_by 提交、`git log vA..vB` 引用三路核对，未合并的 PR 与仍 open 的报障不计）+ `### 安装`（DSHA 一句 + npm 代码块 + GitHub 直装行 + 旧名迁移提示）+ `### 新功能` / `### 修复`（`**症状**：根因 + 修法` 句式）+ `### 兼容`（宿主代际范围 + 已实装验证的第三方版本号）+ `### 完整提交`（提交少时逐条 short-hash；大版本列里程碑提交，收尾必带 `compare/vA...vB` 完整变更对比链接）。**README「更新内容」段发版时同步写**（2026-09-25 用户拍板；版本合并补发时按「上游 tag 之后所有改动并入本版」口径整理，Release notes 仍单独写、不贴 README 段落）。

- CI：`.github/workflows/ci.yml`——verify → test:core → build → `git diff --exit-code lib`（lib 新鲜度门）。**本地照抄这条会假绿**：它比的是**工作区↔索引**，`git add` 之后恒真，源码没提交也能过（本分支出过两个只装 `lib/` 的提交）。本地正确判据＝源码与 `lib/` 同一提交 → 再 `pnpm build` → `git diff --exit-code HEAD -- lib`；另加 `git status --porcelain --ignored lib` 必须为空（`git diff` 看不见未跟踪孤儿产物，而 tsc 从不清理 outDir）。**推 `fix/*` 分支不触发任何 CI**（workflow 只监听 main + PR），所以「推上去了」≠「被检查过」。
- 引擎底线：`package.json` engines `node >=24.0.0`（tests 依赖 Node 原生 TS type-stripping）。
