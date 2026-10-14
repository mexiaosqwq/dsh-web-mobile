# dsh-web-mobile

## Project

- Single-package, client-only plugin for the DSH Web UI. Adapts the UI on **touch-primary devices with a viewport below 1024px**（overlay drawer、full-width conversation、settings/explorer/preview sheets、status-bar safe areas、composer row、stats line）. Activation query `MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'`（`platform/breakpoints.ts`）：宽度单独不足以区分手机与窄桌面窗口（分屏与系统缩放会把 PC 的 CSS 视口压到 1024px 以下），所以键鼠窗口（`pointer: fine`）或无指针窗口在**任何**宽度都保持桌面形态；misc.css.ts 的桌面隐藏块是 MOBILE_QUERY 的精确补集（逗号列表）。**唯一例外（v2.4.1）**：会话删除三件套（菜单项 + 确认/错误弹层）按 `TOUCH_QUERY = '(pointer: coarse)'` 在**每个**宽度武装，故横屏大平板保留桌面布局但仍拿到「删除会话」项。
- Names differ by boundary: README/GitHub project = `dsh-web-mobile`; npm package = `dsh-web-mobile`（由 dsh-mobile-nav 改名而来，旧名连同 2.2.0/2.3.0 已整包 unpublish，npm 上不再存在）; patch row id = `dsh-web-mobile`（DOM 标记 `data-mobile-nav` 与 `?mobile-nav-debug=1` 参数刻意保留旧词根，见 Pitfalls）。
- 已被 [DSHA](https://github.com/qiannianhuanxiang/DSHA)（Android 启动器）内置为移动端适配（README 已致谢 @qiannianhuanxiang，commit ffb61b5）——DSHA 用户装 APK 即用。
- **在本仓库改源码 + `pnpm build` 会直接影响用户正在用的页面**（v3.1.0 起本仓库就是线上版本，本机 web profile 只跑 `dsh-web-mobile`）。发版口径：v3.1.0 走 GitHub Release，**未发 npm**（npm 仍停在 3.0.6）。回滚件 `~/dsh-web-mobile-host-test` 是 v3.1.0 前身快照，已不装载。
- No monorepo, no application server, no workspace layer.
- Real entrypoints: `cordis.patch.yml`（唯一的宿主插件行）；`src/index.ts`（宿主半区入口，`apply()` 让该行对宿主 Loader 可见）；`package.json` 暴露 `./client` 并声明 `dsh.client.platform: "web"`，浏览器半区由 DSH 从 `src/client/index.tsx` 发现。宿主侧端点 `/api/mobile-nav.session.delete`。
- Key layout（注释版仓库树；`(不入库)` = gitignore，外部 clone 不可见）:

  ```text
  dsh-web-mobile/
  ├─ src/                    ← 真源码，唯一该手改的地方
  │  ├─ index.ts             ← 宿主半区入口（apply 装响应压缩 + 会话删除端点 + 手写模型档位补齐）
  │  ├─ compress.ts          ← 进程级 prototype patch
  │  ├─ delete-session.ts    ← 会话删除纯核（DI、分代适配、可单测）
  │  ├─ reasoning-effort.ts  ← 手写模型默认思考档位纯核 + settings 读写面（可单测）
  │  └─ client/
  │     ├─ AGENTS.md         ← 客户端半区披露层（改该目录文件时自动进入上下文）
  │     ├─ index.tsx         ← 浏览器半区入口（注册 3 个 slot；另有 file-share.ts 的 2 个官方 slot）
  │     ├─ debug.ts          ← ?mobile-nav-debug=1 诊断徽章
  │     ├─ components/       ← MobileNavToggle / MobileDrawerFooter / ComposerFileButton / open-files-panel.ts / file-share-*（分享按钮·纯核·文案）
  │     ├─ core/             ← reconciler-core.ts（零 import）+ raf-scheduler.ts · css-rules.ts · sessions-compat.ts · layout-compat.ts · icon-compat.ts（宿主图标跨代命名兼容）· attachment-mention-core.ts · prototype-focus-shadow.ts（两个键盘守卫共享的一个 focus 影子，#84）· plugin-card-tap-core.ts（插件卡片整卡可点判定纯核）
  │     ├─ platform/         ← 跨效果共享的浏览器基础设施（无特性语义；effects/components 只许依赖它，不许互相要）：frame.ts（getFrame/findFrame + 记忆化）· breakpoints.ts（MOBILE_QUERY/DESKTOP_QUERY/TOUCH_QUERY + installMobileEffect）· device.ts（detectIosWebKit）
  │     ├─ effects/          ← 33 个效果模块（背景在各自文件内文档块；跨模块契约见同目录 AGENTS.md）
  │     │     契约关键：reconciler-adapter（全树观察器）· viewport-meta · panel-exit · sidebar-swipe · gesture-guard · stats-line
  │     ├─ styles/           ← index.ts（base→layout→compat→misc 承载顺序）+ 4 个 .css.ts
  │     └─ i18n/locales.ts
  ├─ lib/                    ← 生成物：随 pnpm build 刷新，勿手改
  │  └─ types/…              ← d.ts+map；合并同 CSS 模块的 PR 在 .css.d.ts 冲突 → 重建
  ├─ scripts/
  │  ├─ build-client.mjs     ← 自研客户端打包器
  │  ├─ client-bundle-smoke.mjs ← 白屏门：桩 __ModuleLoader__ 加载产物并执行 entry factory
  │  ├─ cdp-probe.mjs        ← 主探针 14 项核心断言（+6 集成，EXPECTED_FAILURES 基线）
  │  ├─ cdp-swipe-probe/failures · cdp-zoom-probe · cdp-compat-contracts (.mjs)
  │  ├─ css-structure-check.mjs ← CSS 结构检测器（已接入 test:core）
  │  ├─ patch-registry-check.mjs ← 补丁登记门禁：@patch 四要素（for/why/until/test）+ 表↔码双向一致（已接入 test:core）
  │  ├─ lib/                 ← 探针共用模块（错误基线匹配、CDP 客户端、宿主场景、判定）
  │  └─ probes/              ← 22 个回归锚点（builtin-only，可单跑）
  ├─ tests/                  ← 59 个 .test.ts（node --test，type-stripping 直跑）
  ├─ docs/
  │  ├─ specs/               ← 8 篇权威设计文档（入库）
  │  ├─ maintenance/         ← pitfalls.md（67 坑原文）· verification-playbook.md（验收与探针流程）· collaboration-rules.md（团队与审查流程）· release-notes-spec.md · patch-registry.md ← 入库
  │  ├─ upstream/            ← runbook + 2 篇 compat audit + compat-contracts.json + host-jank-feedback.md ← 入库
  │  └─ audits/ · handover/ · fork-wzxmt-zhc/ · debug/ · superpowers/ ← 本地不入库（docs 下只上传 maintenance 与 debug）
  ├─ .github/workflows/ci.yml ← verify → test:core → build → bundle smoke → git diff --exit-code lib
  ├─ assets/                 ← README 用图
  └─ .local-tests/ · .codegraph/ · .dsh-vision-toolkit/  ← 本地不入库（gitignore 噪音区）
  ```

## Docs

文档路由表——遇到下述场景先读对应文档，不要重新摸索；新增长效文档必须在此挂触发行，目标没了删行防死链。

- 排查设置/插件市场区布局与弹层 → `docs/debug/settings-market-debug-map.md`（DOM 层级/哈希归属/干预点索引/CDP SOP；§8=rc.1 复测、§9=rc.2 portal 换锚对照）
- 排查 composer/输入区 → `docs/debug/composer-tree-recon.md`（composer 子树考古；QA 会话种子配方同源）
- 动手改某块代码前 → `docs/maintenance/pitfalls.md`（67 坑原文，名字=锚点，索引在下方 Pitfalls 节）
- 改 `src/client/` 下代码前 → `src/client/AGENTS.md`（客户端半区契约：slot/reconciler/样式/选择器/风格；改该目录文件时自动进入上下文）
- 改 `src/client/effects/` 下代码前 → `src/client/effects/AGENTS.md`（跨模块形状约束 + 模块索引 + 源码未覆盖的细节；逐模块背景在各自文件内文档块）
- 做验收或起探针环境 → `docs/maintenance/verification-playbook.md`（三档验收场景 + CDP/Playwright MCP/Termux 配方）
- 拉起团队、派令、做审查或写交接 → `docs/maintenance/collaboration-rules.md`（审查路线与两层验收、三岗 SOP、lead 终审铁律）
- 写 Release notes → `docs/maintenance/release-notes-spec.md`（七段体例与署名三路核对）
- 改手势/面板退出等行为契约 → `docs/specs/`（8 篇；手势参数与状态机在 `2026-08-27-sidebar-swipe-gestures.md`，不可破）
- 宿主升级前 → `docs/upstream/upgrade-runbook.md`（对账清单与验收电池）+ `node scripts/cdp-compat-contracts.mjs`（机读契约自动对账，无需 SESSION_ID）
- 评估宿主代际兼容面 → `docs/upstream/2026-09-23-dsh-0.1.7-alpha.2-compat-audit.md`（28 条对账 0 改的先例）；升 0.1.6-alpha.2 系前必读 `docs/upstream/2026-09-19-dsh-0.1.6-alpha.2-compat-audit.md` §10（升级前必修 3 项 + 电池 15 项）
- 宿主会话切换卡顿/性能归因 → `docs/upstream/host-jank-feedback.md`（上游反馈通道；完整归因含止血/上游两条路线在本地 audits 目录同名 handover，不上传）
- 0.1.7-rc.1 手机端适配待办 → 本地 audits 目录同名 handover（容器内 chromium 取证 + A/B 与真机读数；不上传）
- 手机端会话头部/输入框 0.1.6 适配 → `docs/upstream/2026-09-19-mobile-header-0.1.6-adaptation.md`（16 条，14 已并入 layout 移动块）
- 新增或修改兼容补丁 → `docs/maintenance/patch-registry.md`（每个补丁必须在源码用 @patch 块自报 for/why/until/test；表由 `node scripts/patch-registry-check.mjs --write` 生成，手改即红）
- CSS 结构回归 → 结构检测器已接入 `test:core`（基线 0 fatal / 5 info；缩进/媒体查询/选择器拆分回归会红），完整审计在本地 audits 目录（不上传）
- 接手 fork wzxmt-zhc 摘抄专项 → 本地 `docs/fork-wzxmt-zhc/README.md`（先读接手协议；该目录不上传，仅本机可读）

## Commands

```sh
pnpm install                       # install (pnpm@11.7.0, lockfile v9)
pnpm verify                        # type-check host + client halves (tsc --noEmit)
pnpm test:core                     # node --test tests/*.test.ts (unit tests)
pnpm build                         # tsc host && tsc client && node scripts/build-client.mjs
npm run prepack                    # runs npm run build before packaging
npm pack                           # package smoke check (invokes prepack)
```

- `test:core` = `node --test tests/*.test.ts`（glob；此前是硬编码列表，长期落后于 `tests/`）。
- `pnpm build` is the required gate after any source change: it emits host ESM, client CommonJS, then inlines the client into `lib/client.js`. `lib/` is committed, so a change is incomplete until `pnpm build` refreshes it.
- `pnpm verify` + `pnpm test:core` are the fast local checks; there is no lint/format config — the CI gate is `.github/workflows/ci.yml`（verify → test:core → build → bundle smoke → lib 新鲜度，见 维护入口）.
- Optional CDP regression probe (not part of `verify`/`build`):

```sh
DSH_PROBE_SESSION_ID=<id> pnpm smoke:cdp
# env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_CHROME (default chromium),
#      DSH_PROBE_TIMEOUT_MS, DSH_PROBE_REQUIRE_CHIP (0/1)
```

  Requires a local DSH Web profile already running at `127.0.0.1:3080`.

- Bundle load smoke（不接真机也能跑，热装载前的必过关）: `node scripts/client-bundle-smoke.mjs [lib/client.js]` —— 用桩 `window.__ModuleLoader__` 在 Node 里加载产物并执行 entry factory；语法错/缺模块键/顶层抛错都会在这里红（白屏事故后补）。
- Focused unit test: `node --test tests/sidebar-swipe.test.ts` (any single file in `tests/`).
- Direct swipe regression probes (not the general `smoke:cdp`): `node scripts/cdp-swipe-probe.mjs` and `node scripts/cdp-swipe-failures.mjs`; same `DSH_PROBE_URL`/`DSH_PROBE_CHROME` env vars, and on Termux add writable `TMPDIR`/`XDG_RUNTIME_DIR`.
- iOS 聚焦放大守卫探针（#45 / #46，23 断言）：`node scripts/cdp-zoom-probe.mjs`（同组 env）。三场景 = 手机+Chromium UA / 手机+iPhone UA / 桌面；守 iOS 16px 下限、`touch-action` 含 `pinch-zoom` 且不含 `pan-x`、`gesturestart` 不被 preventDefault、viewport meta 所有权（出现 `maximum-scale`/`user-scalable` 即回归）。逐条断言编号（A7/B6/A11/A8-A10 等）见脚本文件头。

- Local DSH profile workflow:

```sh
dsh plugin --profile web add link:/path/to/dsh-web-mobile
dsh --profile web --dump-config   # should contain the dsh-web-mobile row
dsh web
```

## Architecture

- Host/client split is load-bearing. 浏览器行为全在 `src/client/`——客户端半区的实现契约（slot 注册、reconciler、分层、样式、选择器与 DOM 标记、资源纪律、代码风格）见 **`src/client/AGENTS.md`**（披露层：改该目录下文件时自动进入上下文）。宿主半区只做三件事：响应压缩、会话删除端点（纯核 `src/delete-session.ts`，按宿主代际适配）、手写 `llm-pi-ai` 模型的默认思考档位补齐（纯核 `src/reasoning-effort.ts`）。
- **依赖方向 `index.tsx → effects → platform → core`**，`tests/architecture.test.ts` 逐条强制（运行时环、层方向、`core/` DOM 纯净、行预算、模块级状态、entry inline 查询），台账只许缩不许涨，`test:core` 会跑它——新增环或超行文件是红 CI。
- **Effects（33 个模块）** — 逐个模块的背景写在各文件自己的文档块里（31/33 有）；跨模块形状约束与源码装不下的细节见 **`src/client/effects/AGENTS.md`**（披露层：改动该目录下任意文件时自动进入上下文）。本文件只留三条跨模块契约：①分层不可破；②全树 `MutationObserver` 在 `reconciler-adapter.ts`（不是 `phone-chrome.ts`），任务注册面 `addReconcilerTask`；③形状禁令三则——`viewport-meta.ts` 的三个函数保持「返回 disposer 的普通函数」（改成各自 `installMobileEffect` 会让外层每次重武装都多注册三个收不到的子 effect）、武装顺序 viewport meta → iOS 标记 → 稳定视口高度是行为、`panel-exit.ts` 退场先动画后提交。
- Third-party compatibility is implemented through scoped DOM markers, stable `data-*` attributes, `MutationObserver`, and carefully scoped class/text anchors. Never modify third-party source packages.
- Authoritative design docs: `docs/specs/2026-08-27-sidebar-swipe-gestures.md` (gesture parameters/state machine; the gesture defect baseline lives in the local-only audits directory).

## Workflow

- **main 已启用 PR-only 保护（实测 GH013 拒直推，含 docs 小改）**：一切变更（含文档）走 分支→PR→CI→merge；**合并后立即删远端分支**（`git push origin --delete <branch>`）。本工作区有未提交改动时合并 PR 不要带 `--delete-branch`（会触发本地分支切换）。
- **外部制作人 PR 主张独立验证（用户要求）**：另一制作人的 PR/修复主张不当事实采信——以仓库实测（CDP 动态探针/锚测试/亲读代码路径）与用户真机验收为准；「桌面实测通过」对真机只有旁证力（CDP 绿 ≠ 真机好）。
- **开场模糊指令先问再动（用户要求）**：新开会话收到「跟进一下 X」「继续」等未给目标的指令时，**直接一句话问用户要目标与范围**，禁止自行展开 recall + 多路探测的重建调查链。例外：用户明说「自己找/搜刮」时仍先搜不反问。
- **动手前自行调用 karpathy-guidelines（用户要求）**：每次开始实际工作（写码/改码/排查/审查）前，先自行调用 `karpathy-guidelines` 技能加载完整准则再动手；不着急，先摸清再动手。
- **Bug 定位先报告、确认后再修（用户要求）**：多步调查/根因不明/现象与成因相距远的 bug，定位到根因后**不要立刻动手修**，先给报告（症状、根因、证据链、影响范围、拟议修复），等用户确认再执行。一眼即明的简单修复不在此列。
- **用户协作偏好自动入库（用户要求）**：用户在对话中提出的协作偏好/工作流要求，**当场写进本文件对应节**，不必等用户点名；入库后在回复里提一句写到了哪里。记忆只做跨会话备份，不能替代本文件。
- **宿主升级必须用户单独确认（用户要求）**：默认只做源码/静态对账，**不动宿主**；alpha 通道一律不上机。真要升级先备份 `~/.dsh/sessions`，升级后按 runbook 电池验收。
- **发版动作必须用户单独同意（用户要求）**：版本 bump + tag + npm publish + GitHub Release 属对外发布动作，走到发版步时**停下来等用户点头**。
- **push + PR + merge 必须用户批准（用户要求，覆盖旧口径）**：本地 commit 可自主（工作区可逆），但 **push 远端、开 PR、merge 一律先报用户等点头**——用户原话「没我批准你不许直接发PR」；网络重试自动合并的后台循环同样禁止。
- **公开 PR/issue 文本卫生（用户要求）**：私聊验收口语、内部对话引用、自封头衔**一律不进**公开文本——只写事实（改了什么、为何这样改、门验结果）；验收状态用中性的「已在真机验证」。**合并 ≠ 可更新**：修复合进 main 后 npm/Release 可能仍是旧版，对外回复必须区分「已合并」与「已发布」，未发版前明说「等下个 release」。
- **CI/长任务不空等（用户要求）**：push/merge 后的 CI、探针、后台任务一律不 sleep 轮询等待——发起后用即时命令查一次状态（如 `gh run list -L 1`）就收口；禁止 `sleep N && …` 式长等待。
- **改动必须落在源码层，不打补丁（用户要求）**：一切修复/功能都改 `src/`（配套 `tests/`），再由 `pnpm build` 生成 `lib/`；**禁止**手改 `lib/`、禁止运行时补丁/热补丁、禁止在源码里留 `TEMP`/`TODO-DIAG` 之类一次性 hack。真机诊断走既有通道（`?mobile-nav-debug=1` + beacon），**不得**为取证把插件改成「强制开诊断面板/强制上报」的变体版本。
- **热装载前必须过四道自检（三次事故后补）**：①`src/client` 内 `error TS1xxx`（语法类）= 0（`.css.ts` 是模板字符串，注释里一律用「」不用反引号）；②`node scripts/client-bundle-smoke.mjs` 过（桩 `__ModuleLoader__` 加载 `lib/client.js` 并执行 entry factory）；③emit 日志里 `src/client` 内 **`error TS2304`/`TS2552`（未定义名）= 0**；④`node --test tests/client-inject-surface.test.ts`——`src/client` 里任何 `ctx.<service>` 读取都必须在 `export const inject` 名单内，跨 `inject` 取服务一律走 `ctx.get(name)`。**连续重载也要克制**：每次 hot-load 都会重载页面，别在用户正在使用或 App 在后台时连续触发。
- **团队与审查流程**（审查路线与两层验收、审查规模与改动成正比、三岗分离 SOP、lead 终审铁律、成员完工落盘交接文档）见 **`docs/maintenance/collaboration-rules.md`**——拉起团队或做审查前先读它。

## Conventions

- 客户端半区的全部实现契约（slot 注册、reconciler 分层、样式承载顺序、选择器与 DOM 标记契约、效果/资源纪律、TypeScript 风格、locale 命名空间前缀、弹层优先级）见 **`src/client/AGENTS.md`**——**改 `src/client/` 下任何文件前先读它**（披露层，改该目录文件时自动进入上下文）。
- Keep the host/client split intact: the host half owns exactly three host-side jobs — response compression, the session-delete endpoint, and the reasoning-level fill for hand-declared `llm-pi-ai` models (`src/reasoning-effort.ts`). Anything browser-facing belongs in `src/client/`.
- Do not edit `lib/` directly; rebuild and include generated artifacts after any source/config change.

## Pitfalls

- **67 个坑的索引：名字 = 触发词 = 锚点**。每条原文在 `docs/maintenance/pitfalls.md`，锚点 `### <名字>`；新增坑位 = 名字加进下面清单 + 原文写进该档并补同名锚点。**动手改某块代码前先按名字读对应条目**——里面是最硬铁律、实测数据与被否决方案。

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
- `ContextMeter 挪位`
- `peer 范围与宿主门禁口径`
- `沙箱 DSH_HOME`
- `探针收尾`
- `build 顺序`
- `手写模型档位补齐`
- `双层底`
- `卡片命中`
- `header 座位归属`

## Testing & QA

- 门禁：`pnpm verify`（typecheck）+ `pnpm test:core`（59 个测试文件，另含 CSS 结构与补丁登记两道结构门，都带变异用例）+ `pnpm build`；CI 另跑 bundle smoke 与 lib 新鲜度门。没有 linter/formatter/coverage。
- **验收场景（窄手机 ~390 / 平板 768–1023 / 桌面 ≥1024 与窄桌面窗口）+ 探针环境（Playwright MCP 配方、全新 context、Termux TMPDIR、真机读数通道）见 `docs/maintenance/verification-playbook.md`**；探针环境的坑 → `docs/maintenance/pitfalls.md` §探针运行环境。
- 手机端调试加 `?mobile-nav-debug=1`；`pnpm smoke:cdp` 是定点冒烟探针，**不能替代**真实 profile 验收。
- **认证 token 向用户索要（用户要求）**：需认证访问本机 dsh web 时**先向用户要 token**（重启输出的 `?token=…` URL 即可用），**不要自行跑 `.local-tests/mint-cookie.mjs` 铸 cookie**。
- Validate compatible third-party versions：**判据是 `~/.dsh/profiles/web/cordis.patch.yml` 的行启用状态，不是 node_modules 里装没装**。行状态变更后先重跑 `docs/debug/settings-market-debug-map.md` §5。
- **未安装的第三方插件不做实机复现（用户要求）**：修复目标插件本机从未安装时，验证止步于静态对账 + 单元锚 + 报障者实测数据交叉验证，不装插件、不上机索 token。
- **外部贡献合并前必须过「与既有体系冲突」检查**（#47 教训）：合并 fork/PR 前先盘点同域既有机制，逐一判断冗余/冲突/互补；冗余砍掉、冲突以仓库体系为准、互补才并入。

## Maintenance

- **fork wzxmt-zhc 专项（本地不上传）**：`docs/fork-wzxmt-zhc/` —— README（对账快照 + 接手协议）、`backlog.md`（三档：直接摘/对账合并/参考不摘）、`log.md`。接手先读 README；快照会过时。**该目录不进 git**，只在本机可读。
- **体积门槛**：工作区指令预算是**共享的 65,536 B**——`~/.dsh/AGENTS.md`（全局，33,266 B）+ 本文件 + 嵌套 AGENTS.md 一起算，超了从**最不具体的一端整份丢弃**（实测：本文件 45,513 B 时全局那份每轮被丢）。所以**本文件硬顶 30,000 B**（`tests/docs-consistency.test.ts` 强制）。只写命令、约定、契约、触发词索引与一两行铁律；**per-item 描述钉回源码**（每个模块的背景写在**该文件自己的文档块**里，31/33 已如此；只有源码真装不下的才进披露层 `src/client/AGENTS.md` / `src/client/effects/AGENTS.md`——披露层同样会线性增长，不是收容所）；推导/证据/大段流程/实测数字进 `docs/`（坑位 → `pitfalls.md`，验证流程 → `verification-playbook.md`，协作流程 → `collaboration-rules.md`，设计 → `specs/`），一次性事故复盘进 `docs/handover/`。
- **知识去向（用户偏好）**：零碎的规矩 / 要求 / 偏好 → **写进本文件对应节**，不要只存进记忆（记忆跨会话，但不能替代仓库文档）；需要推导 / 证据 / 大段流程 / 实测数字的内容 → `docs/`。记忆只留「跨会话需要主动回忆的教训」，且不得成为某条规矩的唯一存放处。
- **同一 worktree 有并发写者时**：别人可能把你**未提交**的工作区改动一起提交走。别据此重做改动或补空提交——先 `git show HEAD:<file>` 确认内容已在；提交只 `git add` 自己点名的路径，**绝不 `git add -A`**。
- **判断「某修复在不在 main 上」一律以 `origin/main` 为基准，别信本地 `main` ref**：判前先 `git fetch origin --prune`，用 `git rev-list --left-right --count origin/main...HEAD` 看真实时差；对齐 = `git checkout main && git merge --ff-only origin/main`。**开新分支一律从 `origin/main` 起**（`git checkout -b <branch> origin/main`）。
- **监督者不要在写者运行期间改它范围内的文件**：要改写者范围内的东西，**等它产出完工回执之后**再动。一次性 `subagent` 不可寻址（`send_message` 报 `active teammate not found`），所以约束必须一次写进首次任务书，事后没有补救通道。
- **文档写法（用户偏好，每次写文档都适用）**：变更条目只描述结果、不写过程；功能不列举特点细节；README「更新内容」条目按 v3.0.0 段样式写结果导向一句话，机制与根因细节只进 Release notes（用户裁定）；计数条目（探针 / 测试 / spec 篇数）在 README 与 AGENTS.md 两处必须同步——`tests/` 文件数由 `tests/docs-consistency.test.ts` 在 `test:core` 里强制（新增测试文件必须同改树行与 Testing 节两处）；README「未发布」段参数定稿前先对源码常量核对。
- Keep it accurate and concise; remove stale entries（见体积门槛条）. Verify claims against source before writing them.
- 一次性事故复盘（AGENTS.md 瘦身、v3.1.0 并线判断、并发写者、PR #203 带错提交、热装载三次事故）见 `docs/handover/2026-10-14-agents-md-slim-oneoffs.md`（本地不入库）。

## 维护入口

- **GitHub Release 文案规格（用户要求）**：Release notes 照 v2.4.1/v2.3.0 文章体例，不许直接贴 README 段落——完整规格（七段写法 + 署名三路核对法）见 `docs/maintenance/release-notes-spec.md`。【README「更新内容」段发版时同步写】（用户拍板）。
- **README 版本段必须覆盖同一版本线的全部 pre-release（用户要求，纠错）**：Release notes 按 tag 分页（`.../releases/tag/vX.Y.Z` 与 `.../releases/tag/vX.Y.Z-rc.N` 是两页），写某版 README「更新内容」前先把该版本线**每个 tag 页都取回**（rc/beta/alpha 逐个）与最高版那页做 diff；**只要 diff 出 pre-release 独占条目就必须一并写进**。不许只读最高版那一页就动笔，也不许凭「我是按 Release 写的」推定已覆盖——推定不算数，要 diff。
- CI：`.github/workflows/ci.yml`——verify → test:core → build → `node scripts/client-bundle-smoke.mjs`（白屏门）→ `git diff --exit-code lib`（lib 新鲜度门）。**本地照抄这条会假绿**（比的是工作区↔索引，`git add` 后恒真）：本地正确判据＝源码与 `lib/` 同一提交 → 再 `pnpm build` → `git diff --exit-code HEAD -- lib`，另加 `git status --porcelain --ignored lib` 必须为空。**推 `fix/*` 分支不触发任何 CI**（workflow 只监听 main + PR），所以「推上去了」≠「被检查过」。
- 引擎底线：`package.json` engines `node >=24.0.0`（tests 依赖 Node 原生 TS type-stripping）。
