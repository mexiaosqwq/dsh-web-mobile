# 技术债台账：看过但刻意没动的地方

> **何时读**：准备重构抽屉关闭/暗层链路、整理探针脚本、或要给 `overlay-backdrop-fab.ts` 改名/换标记时。
> **一句话结论**：这里每一条都写了「为什么当时不动」和「做完的验收线」——按条做、每条单独验证，**不要顺手一起合**。
> 做完一条就从本文件删掉该条（台账只减不增；加新条前先想清楚它会不会两周内就被做掉）。

---

## 1. 关闭路径：target 串各拼一遍（「两个动画器」已合并）

**位置**：`src/client/effects/sidebar-swipe.ts`——`closeDrawerAnimated`（L991：点击 / Escape / 导航点击走它）
与 `commitFollowClose`（L962：手势松手走它）。

**现状**：两条路径共用 `commitWithAnimation`（L914）：滑出动画、落地翻 marker、晚提交窗口、
`cooldownUntil` 与**唯一一份** `pendingCommit`（L891）/ `finishPendingCommit`（L893）都只有一处实现。
残余重复只在入口——两者各自拼 `translateX(±110%)`，RTL 取向还取两个来源：手势在笔画开始时采样
`strokeRtl`（L167），点击 / 导航现读 `frameRtl()`（L1364）。

**为什么没动**：残余只有几行且两处语义等价；动它要跑全套手势探针，当时更在意不碰
`docs/specs/2026-08-27-sidebar-swipe-gestures.md` 的状态机。

**修法**：加 `closedSlotTx(rtl: boolean): string`，两个入口各传自己的取向。**不要再抽 `platform/` 纯核**——
重复已经不存在，抽了只剩一层转发。

**验收**：`scripts/cdp-swipe-probe.mjs` / `scripts/probes/drawer-click-animation-probe.mjs` /
`scripts/cdp-swipe-failures.mjs` 三个探针全绿；`CLOSED_SLOT_PCT` 只在一处被拼进 target 串。
**别用「行数下降」当判据**——抽在同一个文件里行数基本不变（2026-11-08 复核纠正，原条目把它写成唯一量化目标）。

**规模**：小（< 30 分钟）。

## 2. 两个探针各自实现 drawerState

**位置**：`scripts/cdp-probe.mjs` 的 `drawerStateProbe`（L385），`scripts/cdp-swipe-probe.mjs` 的
`drawerState`（L286）。

**现状**：两份浏览器内查询同骨架——`collapsed` / `dimActive` / `drawerWidth` / `drawerHeight` 共有；字段面
不同：前者 4 个字段，后者 12 个（多 `frame` / `backdropCount` / `drawerTransform` / `drawerTransition` /
`touchAction` / 两个 overscroll / `viewport`）。关闭谓词两边都有，但只有后者抽成函数
（`isClosed()`，L320），前者内联在 `waitDrawerState` 里。

**为什么没动**：共享要新增 `scripts/lib/drawer-state.mjs` 并改两个探针的启动路径，而本机没有可跑的
探针目标实例（需带 token 的 DSH Web + session id），改完无法当场验证——探针类改动「改完跑不了」等于
没验证。

**修法**：抽 `scripts/lib/drawer-state.mjs`，导出选择器常量 + `drawerStateScript(fields)` + `isOpen` /
`isClosed` 谓词，两个探针按需传字段。**顺带收编选择器**：`FRAME_SELECTOR` / `DRAWER_SELECTOR` /
`BACKDROP_SELECTOR` 现在在五处各有一份——`scripts/cdp-probe.mjs`（`MOBILE_*` 前缀）、
`scripts/cdp-swipe-probe.mjs`、`scripts/cdp-swipe-failures.mjs`、`scripts/probes/drawer-click-animation-probe.mjs`、
`scripts/probes/draggable-conflict-probe.mjs`；`cdp-swipe-failures.mjs` 还自建了一次 collapsed 读取
（L181）。只抽状态查询不收选择器 = 只做一半。

**验收**：两个探针在隔离实例上各跑一次全绿（探针跑通本身就是证据，不需要额外单测）；
抽完 `git grep -c 'data-mobile-nav="frame"' scripts` 的份数必须下降。

**规模**：小（< 1 小时）+ 一次探针验证。

## 3. 模块名与角色不符

**位置**：`src/client/effects/overlay-backdrop-fab.ts`。

**现状**：名字说的是「遮罩 + 悬浮键」，但现在它既不创建遮罩层（暗层画在 frame 的 `::after` 上），
也不是遮罩的所有者——它拥有的是 FAB、常驻命中层（`[data-mobile-nav="backdrop"]`）与暗层标记
（`data-mobile-nav-dim`）。读名字找「谁画暗层」会找错人。

**为什么没动**：改名牵动 `reconciler-adapter.ts`（导入）、`sidebar-swipe.ts`（`fadeOverlayOut` 导入）、
探针脚本里的选择器注释、两处 `AGENTS.md` 索引（`src/client/AGENTS.md` 任务清单 +
`src/client/effects/AGENTS.md` 两处）、`panel-exit.ts` / `header-metrics.ts` 的引用注释，以及
**四处按名字/路径写死的测试耦合**：

- `tests/architecture.test.ts` 的行预算台账按**文件路径**做键（`'src/client/effects/overlay-backdrop-fab.ts': 1`）；
- `tests/reconciler-core.test.ts` 的任务注册表按**任务名**做键（`'overlay-backdrop-fab': ['*', 'data-sidebar-collapsed', 'data-phase']`）；
- `tests/panel-exit-animation.test.ts` 直接 `readFileSync('src/client/effects/overlay-backdrop-fab.ts')`；
- `tests/drawer-open.test.ts` 按路径**动态 import**（L208 / L244），漏改直接红。

另有 `src/client/platform/drawer-open.ts`、`src/client/styles/base.css.ts` 的指路注释，以及
`tests/architecture.test.ts` 依赖台账里三行注释（`sidebar-swipe → gesture-guard·overlay-backdrop-fab` 等）
要一起改。当轮已经有一个跨 29 文件的 diff，再叠纯改名会让审查成本失控。

**修法**：`git mv` 到 `drawer-layer.ts` → 改导入 → 任务名 `name: 'overlay-backdrop-fab'` 改
`'drawer-layer'` → 同步上面四处测试耦合与两处索引文字 → 顺手改那三行依赖台账注释。
先 `git grep -n overlay-backdrop-fab` 全量打点，改完再跑一次确认零残留。

**验收**：全门禁（`architecture` / `reconciler-core` / `panel-exit-animation` / `drawer-open` 四处若漏改会自己报）；
`scripts/cdp-probe.mjs` 的抽屉/FAB 断言不受影响（DOM 选择器没变）；`?mobile-nav-debug=1` 徽章里的任务名
跟着变（无代码按名匹配该字符串）。

**规模**：小但机械（约 30 分钟）。**建议与下一次动这个文件时合并做。**

## 4. DOM 标记名遗留：`backdrop` 实际是命中层

**位置**：`data-mobile-nav="backdrop"` 写入点 `overlay-backdrop-fab.ts`（`dataset.mobileNav`，L88）。读取点：

- `styles/base.css.ts`（命中层规则 + 弹层带门控）、`styles/compat.css.ts`（takeover 清屏）、
  `styles/misc.css.ts`（user-select / 桌面隐藏清单）——三处成对改；
- `effects/drawer-close.ts`（捕获期点击归属判定，L220）；
- `effects/sidebar-swipe.ts`（手势合成 click 放行判定，L1457——**最容易漏的一处**）；
- 7 个探针/测试引用：`scripts/cdp-probe.mjs`、`scripts/cdp-swipe-probe.mjs`、
  `scripts/probes/drawer-click-animation-probe.mjs`，`tests/css-rules`、`tests/our-free-model-toast-layer`
  （取 z-index）、`tests/shortcut-modal-flash-band`、`tests/text-selection-scope`。

`effects/gesture-guard.ts` **不读**这个标记（全文只有一句注释提到它），改名时别被它带偏。

**现状**：这个元素已经不画任何东西（`background: transparent`，只有命中测试与 `cursor: pointer`）；暗层靠
`data-mobile-nav-dim` 单独表达。名字里的 `backdrop` 是 2026-11-08 之前的角色残留。

**为什么没动**：改标记等于改跨模块契约，且**跨代兼容窗口**真实存在——用户机上的旧版缓存页面与新
代码可能短期共存，标记一换就有一代漏命中（点空白关不掉）或漏隐藏（桌面冒出透明命中层）。

**修法**：先加新名（如 `data-mobile-nav-hit`）双侧并存一代：JS 同时写两个属性，CSS 两个选择器并列
（桌面隐藏块、user-select 块、takeover 清屏块三处都要成对），下个版本删旧名。

**验收**：并存期间三处 CSS 都能命中；`gesture-guard` 不参与、`drawer-close` 与 `sidebar-swipe` 的点击归属
判定同时识别两名；探针断言改新名后全绿。

**规模**：小改 + 一个兼容窗口。**排在条 3 之后**（先改文件名再改标记，避免同一轮两个契约同时动）。

---

## 5. `tests/` 从不做 typecheck（2026-11-08 测量后决定**不设门**）

**位置**：`tsconfig.json` 的 `include` 只到 `src/index.ts`，`tsconfig.client.json` 只到 `src/client/**`——`tests/`
两份都不覆盖；`test:core` 用 Node 24 原生 type-stripping 直跑 `.test.ts`，类型在运行期被整个剥掉。

**现状（实测，2026-11-08）**：把 `tests/**/*.ts` 纳入临时配置后冒出 **132–156 条类型错 / 13 个文件**（计数随配置
细节浮动：侦察岗的 V1b 口径 132，lead 的 `nodeNext` + `typeRoots` 口径 156）。形态：**61 条是测试 helper 从不写
类型注解**，约 43 条是假 DOM 桩缺 `EventTarget`/`Element` 成员，其余是夹具与生产 seam 的口径差。假 DOM 桩有
**3 份各自实现**（`FakeEl` / `fake` / `FakeElement`），其中 2 份已分叉。

**为什么没动**：① 符号漂移（缺导出、改名）今天就会在 `test:core` **加载期**直接 SyntaxError，静态层没有额外猎物
——136 条抽检里真缺陷只有 1 类 4 条（`ClientContext` 未导入，已修）；② 132 条里 61 条是「helper 从不写类型」，
修法只能批量补注解（机械量大）或塞 `any`（门变装饰）；③ 56/72 个测试的断言对象是**源码字符串**，类型系统根本
看不到它们的行为——那类风险要靠变异/空转审计，不是 typecheck。

**修法（将来要做时）**：建 `tsconfig.tests.json`（`strict` + 与 `tsconfig.client.json` 相同的 `paths` + `include`
加 `tests/**/*.ts` 与 `src/client/**/*.ts`）→ 加 `pnpm verify:tests` → 先修 3 个重灾区（`host-test-compat` /
`mobile-navigation-behavior` / `architecture`）→ 残量做「不许新增」棘轮。预估 95–105 行可达 69/72 文件覆盖
（排除 3 个 vm/transpile harness）。

**验收**：门一旦上，`pnpm verify:tests` 必须进 CI；且**不许**为了让它是绿而给测试塞 `any`——那只是把缺口换个
地方藏。

**规模**：中等（半天）。**建议等下一次大改 `tests/` 时一起做。**

---

## 待真机验收（不是重构项，但同样「本轮做不到」）

点空白关闭抽屉时右侧变亮的闪：暗层改法有 bisect 支持（已保留），点遮罩关闭路径已回退成晚提交关闭
（与改动前一致）。**需要在真机上开合三次、点空白区域复现**——只测第一次不算，报障描述是从第二轮开合起。

若仍闪，下一步按**单变量**排查（切勿并行改多项，2026-09-27 #131–#136 五轮修复全废就是并行猜的教训）：

1. `::after` 的 `opacity` 过渡在设备合成器上被层提升 → 局部试验 `will-change: opacity`；
2. 命中层的 `cursor: pointer` + `-webkit-tap-highlight-color: transparent` 组合 → 去掉 `cursor` 对照；
3. 抽屉列的 `transform` 过渡与暗层 `opacity` 过渡同帧推进 → 让暗层滞后一帧起跑对照。

每轮一个变量、留复现步骤与录屏；阴性三轮即停下来换取证手段（beacon 时间线 / 帧 md5），不要继续猜。
