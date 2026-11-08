# 技术债台账：看过但刻意没动的地方

> **何时读**：准备重构抽屉关闭/暗层链路、整理探针脚本、或要给 `overlay-backdrop-fab.ts` 改名/换标记时。
> **一句话结论**：这里每一条都写了「为什么当时不动」和「做完的验收线」——按条做、每条单独验证，**不要顺手一起合**。
> 做完一条就从本文件删掉该条（台账只减不增；加新条前先想清楚它会不会两周内就被做掉）。

---

## 1. 关闭路径有两个动画器（最大的真重复）

**位置**：`src/client/effects/drawer-close.ts` 的 `closeDrawerAnimated`，与
`src/client/effects/sidebar-swipe.ts` 的 `commitFollowClose`。

**现状**：两者都是「inline `transform` 滑出去 → 动画落地再翻宿主 `data-sidebar-collapsed`」，
各自维护自己的 pending 状态与计时器。手势版额外持有跟手量（`followTranslate`）、`pendingCommit`、
`cooldownUntil`、合成 click 消费标记。

**为什么没动**：手势文件已经 1,500+ 行，且参数与状态机是
`docs/specs/2026-08-27-sidebar-swipe-gestures.md` 的硬契约（文档写明「不可破」）。合并要先抽象出
「滑出 + 晚提交 + marker 防护」，再换两边实现——单次改动同时碰点击路径与手势路径，回归面是全部
手势探针，风险与收益不成比例。

**修法**：把三段（滑出动画 / 落地翻 marker / 晚提交期间 marker 防护）抽成 `platform/` 级纯核，
由调用方注入 `getRect` / `writeInline` / `flip`。顺序：先让 `closeDrawerAnimated` 换到新核并跑探针，
再换手势侧。

**验收**：`scripts/cdp-swipe-probe.mjs` + `scripts/probes/drawer-click-animation-probe.mjs` +
`scripts/cdp-swipe-failures.mjs` 三个探针全绿，且 `sidebar-swipe.ts` 行数下降（这是唯一的量化目标：
抽核若没减行，说明没抽出来）。

**规模**：中（1–2 天；风险集中在手势回归）。

## 2. 两个探针各自实现 drawerState

**位置**：`scripts/cdp-probe.mjs` 的 `drawerStateProbe`，`scripts/cdp-swipe-probe.mjs` 的 `drawerState`。

**现状**：两份几乎同形的浏览器内查询（frame / collapsed / backdropCount / dimActive + 各自额外字段），
字段集不同但骨架相同；`isClosed` 只在前者里抽了函数。

**为什么没动**：共享要新增 `scripts/lib/drawer-state.mjs` 并改两个探针的启动路径，而本机没有可跑的
探针目标实例（需带 token 的 DSH Web + session id），改完无法当场验证——探针类改动「改完跑不了」等于
没验证。

**修法**：抽 `scripts/lib/drawer-state.mjs`，导出生成表达式片段的 `drawerStateScript(fields)` 与
`isOpen` / `isClosed` 谓词；两个探针按需传字段。

**验收**：两个探针在隔离实例上各跑一次全绿（探针跑通本身就是证据，不需要额外单测）。

**规模**：小（< 1 小时）+ 一次探针验证。

## 3. 模块名与角色不符

**位置**：`src/client/effects/overlay-backdrop-fab.ts`。

**现状**：名字说的是「遮罩 + 悬浮键」，但现在它既不创建遮罩层（暗层画在 frame 的 `::after` 上），
也不是遮罩的所有者——它拥有的是 FAB、常驻命中层（`[data-mobile-nav="backdrop"]`）与暗层标记
（`data-mobile-nav-dim`）。读名字找「谁画暗层」会找错人。

**为什么没动**：改名牵动 `reconciler-adapter.ts`（导入）、`sidebar-swipe.ts`（`fadeOverlayOut` 导入）、
探针脚本里的选择器注释、两处 `AGENTS.md` 索引、`panel-exit.ts` / `header-metrics.ts` 的引用注释，以及
**三处按名字/路径写死的测试耦合**（改名必改，否则测试静默不生效或直接红）：

- `tests/architecture.test.ts` 的行预算台账按**文件路径**做键（`'src/client/effects/overlay-backdrop-fab.ts': 1`）；
- `tests/reconciler-core.test.ts` 的任务注册表按**任务名**做键（`'overlay-backdrop-fab': ['*', ...]`）；
- `tests/panel-exit-animation.test.ts` 直接 `readFileSync('src/client/effects/overlay-backdrop-fab.ts')`。

当轮已经有一个跨 29 文件的 diff，再叠纯改名会让审查成本失控。

**修法**：`git mv` 到 `drawer-layer.ts` → 改导入 → 任务名 `name: 'overlay-backdrop-fab'` 改
`'drawer-layer'` → 同步上面三处测试耦合与两处索引文字。先 `git grep -n overlay-backdrop-fab` 全量
打点，改完再跑一次确认零残留。

**验收**：全门禁（`architecture` / `reconciler-core` / `panel-exit-animation` 三处若漏改会自己报）；
`scripts/cdp-probe.mjs` 的抽屉/FAB 断言不受影响（DOM 选择器没变）；`?mobile-nav-debug=1` 徽章里的任务名
跟着变（无代码按名匹配该字符串）。

**规模**：小但机械（约 30 分钟）。**建议与下一次动这个文件时合并做。**

## 4. DOM 标记名遗留：`backdrop` 实际是命中层

**位置**：`data-mobile-nav="backdrop"` 写入点 `overlay-backdrop-fab.ts`，读取点 =
`styles/base.css.ts`（命中层规则 + 弹层带门控）、`styles/compat.css.ts`（takeover 清屏）、
`styles/misc.css.ts`（user-select / 桌面隐藏清单）、`effects/gesture-guard.ts` 与
`drawer-close.ts`（点击归属判定）、5 个探针/测试断言。

**现状**：这个元素已经不画任何东西，只做命中测试；暗层靠 `data-mobile-nav-dim` 单独表达。
名字里的 `backdrop` 是 2026-11-08 之前的角色残留。

**为什么没动**：改标记等于改跨模块契约，且**跨代兼容窗口**真实存在——用户机上的旧版缓存页面与新
代码可能短期共存，标记一换就有一代漏命中（点空白关不掉）或漏隐藏（桌面冒出透明命中层）。

**修法**：先加新名（如 `data-mobile-nav-hit`）双侧并存一代：JS 同时写两个属性，CSS 两个选择器并列
（桌面隐藏块、user-select 块、takeover 清屏块三处都要成对），下个版本删旧名。

**验收**：并存期间三处 CSS 都能命中；`gesture-guard` / `drawer-close` 的点击归属判定同时识别两名；
探针断言改新名后全绿。

**规模**：小改 + 一个兼容窗口。**排在条 3 之后**（先改文件名再改标记，避免同一轮两个契约同时动）。

---

## 待真机验收（不是重构项，但同样「本轮做不到」）

点空白关闭抽屉时右侧变亮的闪：暗层改法有 bisect 支持（已保留），点遮罩关闭路径已回退成晚提交关闭
（与改动前一致）。**需要在真机上开合三次、点空白区域复现**——只测第一次不算，报障描述是从第二轮开合起。

若仍闪，下一步按**单变量**排查（切勿并行改多项，2026-09-27 #131–#136 五轮修复全废就是并行猜的教训）：

1. `::after` 的 `opacity` 过渡在设备合成器上被层提升 → 局部试验 `will-change: opacity`；
2. 命中层的 `cursor: pointer` + `-webkit-tap-highlight-color: transparent` 组合 → 去掉 `cursor` 对照；
3. 抽屉列的 `transform` 过渡与暗层 `opacity` 过渡同帧推进 → 让暗层滞后一帧起跑对照。

每轮一个变量、留复现步骤与录屏；阴性三轮即停下来换取证手段（beacon 时间线 / 帧 md5），不要继续猜。
