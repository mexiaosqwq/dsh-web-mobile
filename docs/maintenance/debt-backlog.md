# 技术债台账：看过但刻意没动的地方

> **何时读**：准备重构抽屉关闭/暗层链路、整理探针脚本、或要给 `drawer-layer.ts` 改名/换标记时。
> **一句话结论**：这里每一条都写了「为什么当时不动」和「做完的验收线」——按条做、每条单独验证，**不要顺手一起合**。
> 做完一条就从本文件删掉该条（台账只减不增；加新条前先想清楚它会不会两周内就被做掉）。

---

## 1. 关闭提交仍住在手势模块里（close-commit 该上 platform/）

**位置**：`src/client/effects/sidebar-swipe.ts`——`cooldownUntil`（L156）/ `CLOSED_SLOT_PCT`（L109）/
`pendingCommit`（L891）/ `finishPendingCommit`（L893）/ `commitWithAnimation`（L914）/
`commitFollowClose`（L962）/ `closeDrawerAnimated`（L991）/ `frameRtl`（L1364）。

**现状**：「两个动画器」已经合并，别再照旧找重复：两条关闭路径共用 `commitWithAnimation`，滑出动画、
落地翻 marker、晚提交窗口、`pendingCommit` 与 `finishPendingCommit` 都只有一处实现，`cooldownUntil`
也只有一份。真实残余是**归属错了**——这套关闭提交同时服务手势松手与 `drawer-close` 的全部关闭入口
（点击空白 / Escape / 导航点击 / FAB / 顶栏开关），却住在只有手势用的模块里。代价是两条
`effects → effects` 边：

- `sidebar-swipe → drawer-layer`：唯一用途 `fadeOverlayOut()`，而它本身就是 `fadeHook?.()`；
- `drawer-close → sidebar-swipe`：唯一用途 `closeDrawerAnimated`（该文件只 import 这一个符号）。

**为什么没动**：搬它要动关闭动效的时序（晚提交窗口、cooldown、reduced-motion 分支），回归面是三个手势
探针，而本机没有可跑的探针实例；那几轮手上还压着跨 29 文件的 diff。

**修法**：新建 `src/client/platform/drawer-commit.ts`，搬 `CLOSED_SLOT_PCT` / `COOLDOWN_MS` /
`cooldownUntil`（导出 `onCooldown()` / `markCooldown()`）/ `pendingCommit` / `finishPendingCommit` /
`commitWithAnimation` / `closeDrawerAnimated` / `frameRtl`，并给暗层淡出加一个中立钩子槽
（`setDimFade(fn | null)` + `fadeDim()`）。**先例是 `src/client/platform/drawer-open.ts`**——同款钩子槽
就是为消这条边建起来的，照它的 docblock 写法。

硬约束（源码注释里的血泪）：`fadeHook` 现在在 `sync()` 里**每次 ensure 重挂**、`dispose()` 里清空，
因为 `core.deactivate()` 每次断点翻转都会 dispose，只在工厂体注册一次就会从第一次翻转起永久静默失效。
钩子槽必须同款重挂语义。

手势侧只留 `commitFollowClose`（它绑定 `followDrawer` / `strokeRtl` / `releaseFollowStyles`，是手势自己的
东西）与 `releaseFollowStyles`；目标串改由 `closedSlotTx(rtl)` 产出，两个入口各传自己的取向。

**验收**（结构判据，不是行数）：① `tests/architecture.test.ts` 里 `sidebar-swipe → drawer-layer`
与 `drawer-close → sidebar-swipe` 两行边注释归零（台账只许缩短）；② `pendingCommit` / `cooldownUntil`
全仓唯一声明在 `platform/drawer-commit.ts`；③ `DEBT.bigFiles` 的 sidebar-swipe 数字下调并记理由、
`DEBT.moduleState` 20 → 18 且新增 `platform/drawer-commit.ts` 键；④ `scripts/cdp-swipe-probe.mjs` /
`scripts/probes/drawer-click-animation-probe.mjs` / `scripts/cdp-swipe-failures.mjs` 在活实例上全绿——
**没有活实例就不算验完**，最多到「test:core + build 绿，探针待跑」。

**规模**：中（60–90 分钟，含台账与探针回归）。**单独一轮做，别和改名 / 换标记混在一起。**

## 2. 两个探针各自实现 drawerState

**位置**：`scripts/cdp-probe.mjs` 的 `drawerStateProbe`（L385），`scripts/cdp-swipe-probe.mjs` 的
`drawerState`（L286），`scripts/cdp-swipe-failures.mjs` 自建的一次 collapsed 读取（L181）。

**现状**：三处各自拼浏览器内查询。两份「状态对象」骨架相同（`collapsed` / `dimActive` / `drawerWidth` /
`drawerHeight`），字段面不同：cdp-probe 4 个字段、关闭谓词内联在 `waitDrawerState`（L397）里；
swipe-probe 12 个（多 `frame` / `backdropCount` / `drawerTransform` / `drawerTransition` / `touchAction` /
两个 overscroll / `viewport`），关闭谓词抽成了 `isClosed()`（L320）。

选择器常量的重复远不止这两处：`[data-mobile-nav="frame"]` 在 `scripts/` 下 **62 份 / 19 个文件**
（`FRAME_SELECTOR` / `MOBILE_FRAME_SELECTOR` / 内联字面量三种写法混用），台账点名的 5 个脚本占 14 份。

**为什么没动**：共享要新增 `scripts/lib/` 模块并改探针的引用方式，而本机没有可跑的探针目标实例
（需带 token 的 DSH Web + session id）——探针类改动「改完跑不了」等于没验证。

**修法**：新建 `scripts/lib/mobile-dom.mjs`，导出 `FRAME` / `DRAWER` / `BACKDROP` / `FAB` 选择器常量、
`drawerStateScript(fields)` 与 `isOpen` / `isClosed` 谓词；只收编台账点名的 5 个脚本
（`cdp-probe` / `cdp-swipe-probe` / `cdp-swipe-failures` / `probes/drawer-click-animation-probe` /
`probes/draggable-conflict-probe`）与那 2 份状态查询。**长尾 14 个探针故意不动**——没有活实例就无法验证，
改它们只换来一次不可证明的 diff；条目的名字因此从「两个探针」改成「五个脚本」。

**验收**：两个探针在隔离实例上各跑一次全绿（探针跑通本身就是证据，不需要额外单测）；
`git grep -c 'data-mobile-nav="frame"' scripts` 从 62 降到 48（5 个脚本那 14 份 + 状态查询里的字面量）。

**规模**：小（< 1 小时）+ 一次探针验证。

## 3. DOM 标记名遗留：`backdrop` 实际是命中层

**位置**：`data-mobile-nav="backdrop"` 写入点 `drawer-layer.ts`（`dataset.mobileNav`，L88）。
读取点（实测 6 行 CSS + 2 个 JS + 3 个探针 + 6 个测试）：

- `styles/base.css.ts` 2 行（命中层规则 + 弹层带门控）、`styles/compat.css.ts` 2 行（takeover 清屏）、
  `styles/misc.css.ts` 2 行（user-select / 桌面隐藏）——三处成对改；
- `effects/drawer-close.ts`（捕获期点击归属判定，L220）、`effects/sidebar-swipe.ts`（手势合成 click
  放行判定，L1457——**最容易漏的一处**）；
- 探针 3：`scripts/cdp-probe.mjs`（L23）、`scripts/cdp-swipe-probe.mjs`（L40）、
  `scripts/probes/drawer-click-animation-probe.mjs`（L37）；
- 测试 6：`css-rules`（L626）、`shortcut-modal-flash-band`（L43 门控 + L13 注释）、
  `our-free-model-toast-layer`（L60 取 z-index）、`text-selection-scope`（L49）、
  `drawer-open`（L211 假节点判定）、`mobile-navigation-behavior`（L45 选择器匹配）。

`effects/gesture-guard.ts` **不读**这个标记（全文只有一句注释提到它），改名时别被它带偏。

**坑**：`backdrop` 这个词还出现在另外两个标记里（`delete-dialog-backdrop`、`file-picker-backdrop`），
只许精确串替换（`'backdrop'` / `"backdrop"` / `="backdrop"]`），禁止 `sed s/backdrop/hit/g` 一把梭。

**现状**：这个元素已经不画任何东西（`background: transparent`，只有命中测试与 `cursor: pointer`）；
暗层靠 `data-mobile-nav-dim` 单独表达。名字里的 `backdrop` 是 2026-11-08 之前的角色残留。

**为什么没动**：改标记等于改跨模块契约，八个读点分散在 styles / effects / 探针 / 测试四处。

**旧口径作废**：「双侧并存一代」的兼容窗口**不需要**——插件是单 bundle，CSS 与 JS 永远同版本；
缓存页拿到的是整个旧 bundle，不存在新旧混跑。直接单名替换。

**修法**：写入点改 `'hit'`，上列八处读点同步；`tests/` 里断言 CSS 文本的四处跟着改；探针常量改新名。

**验收**：`pnpm test:core`（含 CSS 结构门与补丁登记门）+ `pnpm build`；
`git grep -n '"backdrop"' src/ tests/ scripts/` 只剩另外那两个标记的命中；探针需活实例复跑。

**规模**：小改（30–45 分钟）。**排在条 3 之后**（同一个文件两次契约改动分开做，便于 bisect）。

---

## 4. `tests/` 从不做 typecheck（2026-11-08 测量后决定**不设门**）

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
