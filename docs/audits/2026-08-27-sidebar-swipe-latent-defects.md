# 侧边栏滑动手势 —— 隐性缺陷审计（2026-08-27）

对 `docs/specs/2026-08-27-sidebar-swipe-gestures.md` 所描述的手势层做的一次穷尽式排查。目标不是"明显的 bug"，而是**冲突、歧义、CSS 位置、注释漂移**这类平时察觉不出来的东西。

## 证据基线

| 项 | 值 |
| --- | --- |
| 分支 / 版本 | `check` / `2.2.0`（审计期间无源码改动） |
| 宿主 | `dsh` 0.1.1-rc.2（全局安装） |
| 服务端 bundle | `sha1 eb5f07d51e3e`，与 `lib/client.js` 逐字节一致（已下载对比） |
| 自动闸门 | `pnpm verify` 通过；`pnpm test:core` 28/28 通过 |
| 验证手段 | 真实 DSH Web（`127.0.0.1:3080`）+ 原生 CDP 触摸注入，390×844 |

**宿主哈希类名的正确取证路径**（本次踩过的坑）：渲染会话树的 `@deepseek-ai/dsh-client-ui-workspace` 既不在仓库 `node_modules`，也不在 `~/.dsh/profiles/web/node_modules`，而在 `$(readlink -f $(which dsh))` 上溯到的 `.../usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`。真实类名族为 `YDXeBa_sessionRow` / `_projectRow` / `_searchResultRow` / `_title`，元素带 `role="treeitem"` 与 `aria-selected`。

---

## 一、功能缺陷

### S0 —— 宿主 pointerup 抢跑，手势被抵消（严重）

抽屉打开时，起点落在**宿主关闭集合**内的元素上向右滑出，`data-sidebar-collapsed` 连翻两次（间隔约 50ms），抽屉净结果保持打开，手势看着像完全失灵。

实测命中矩阵（每格一次完整 stroke，`dx = +170px`）：

| 起点元素 | flips | 结果 |
| --- | --- | --- |
| `[class*="sessionRow"][aria-selected="true"]` | 2 | 停留在打开 |
| `[class*="newSession"]` | 2 | 停留在打开 |
| `button[data-dsh-taskboard-entry]` | 2 | 停留在打开 |
| `button[data-dsh-ssh-entry]` | 2 | 停留在打开 |
| `[class*="projectRow"]`（不在集合内） | 1 | 正确关闭 |

判决性实验：同一行把 `aria-selected` 强制置 `false` → 单翻、正确关闭；改回 `true` → 双翻复现。

用 `Element.prototype.setAttribute/removeAttribute` 打桩抓栈，两次写入调用栈**完全同源**（均为宿主 React 的 `z → o0 → Nt`），证明两次都走 `ctx.layout.toggleSidebar()`，不存在第三方直接改 DOM。

capture-first tracer 抓到的时序：

```
pointerup CAPTURE-FIRST  target=YDXeBa_title
   FLIP collapsed=true      ← 宿主 onDrawerPointerUp 先执行，consumeIfGestured 此刻为 false
   FLIP collapsed=false     ← 手势用 lockDrawerOpen 快照判为 'close'，再 toggle 回去
pointerup BUBBLE-LAST
```

**根因**：`markGestureConsumed` 是**事后**标记（在 `sidebar-swipe.ts` 自己的 `pointerup` 里才调用，见 `endStroke` `:322`），而 `phone-chrome.ts` 的两个 handler 注册更早（`:359-361`），在同一 capture 阶段先跑完。共存契约依赖"手势先标记、宿主后让位"，但事件顺序恰好相反。`installSidebarSwipe`（`index.tsx:163`）晚于 `installOverlayInteractions`（`:159`），调换注册顺序也不能修——那只是把竞态换个方向。

**修复形状**：`tryLock`（`:247-259`）置一个模块级 `strokeLocked`，宿主两个 handler 首行改为 `if (strokeLocked || consumeIfGestured(event)) return`。轴锁定发生在 `pointermove`，严格早于任何 `pointerup`，因此不再有时序竞态。

### S1 —— 亚阈值横拖被宿主当成 tap（中）

手势层判定 `'none'`（未达 ~51px 关闭阈值）时，宿主的 `shouldCloseOnTapInsideDrawer` 仍把这次 pointerup 当 tap 处理并关抽屉。宿主侧**没有任何 slop 门槛**。

| 起点 / 位移 | flips | 结果 |
| --- | --- | --- |
| `newSession`，右 30px | 1 | 关闭（应保持打开） |
| `sessionRow`，右 30px | 1 | 关闭（应保持打开） |
| `sessionRow`，**左** 30px | 1 | 关闭（应保持打开） |
| `sessionRow`，下 60px | 0 | 正确保持打开 |
| `projectRow`，右 30px | 0 | 正确保持打开 |

竖向逃逸是因为 `tryLock` 的纵向支配分支 `reset()` 后浏览器接管滚动，宿主判定要求 target 在集合内且没有额外位移检查——但竖滑时 target 常已随滚动改变。横向短拖则完整落进宿主的 tap 路径。用户感受是"想小幅拖一下，抽屉自己关了"。

S1 与 S0 同源（都是宿主 pointerup 无位移概念），`strokeLocked` 修复同时覆盖两者：8px 轴锁定一旦触发，宿主就整体让位。

### S2 —— `prefers-reduced-motion` 未覆盖抽屉（低，可访问性）

`reduce` 生效时（`matchMedia(...).matches === true` 已实测），抽屉 `transition-duration` 仍为 `0.28s`。

- `layout.css.ts:648-653` 的 reduced-motion 块只覆盖设置面板与其遮罩
- `compat.css.ts:210-215` 只覆盖 preview 列与全屏按钮
- 抽屉本体规则在 `layout.css.ts:62-76`，`transition: transform .28s` 无对应 reduce 覆盖

属于"该做没做"，不是回归。

### S3 —— kebab 排除守卫在触摸上恒不命中（低，设计歧义）

`beginStroke`（`:228`）与 `shouldCloseOnTapInsideDrawer`（`phone-chrome.ts:270`）都写了 `[class*="sessionRow"] button` 排除，意图是"不抢会话行操作菜单的 tap"。实测抽屉打开、无 hover 时：

```
row 0 (New Session)   : 0 buttons
row 1..4 (sessionRow) : 1 button 各自 0x0 尺寸
```

按钮存在但零尺寸，触摸永远不可能命中它——`closest()` 要求按钮是 target 的自身或祖先。守卫在触摸设备上是**恒假分支**。这不造成错误行为（保守方向），但它给读者一个错觉：以为触摸上的 kebab 冲突已被处理。真正需要处理的是"kebab 因 hover 展开后"的场景，而触摸没有 hover。

---

## 二、经复核确认为健康（原先怀疑，现予撤销）

这批是我先前基于合成 fixture 或错误的取证路径得出、又被真实环境推翻的结论，一并记录以免后人重犯。

| 曾怀疑 | 真相 |
| --- | --- |
| `[class*="sessionRow"]` 选择器已死（`grep node_modules` 为空） | **活着**。取证路径错了，宿主包在全局 dsh 安装下，真实类名 `YDXeBa_sessionRow` |
| 手势后 300ms 内真实 tap 被吞成死点击 | **不存在**。80/150/250/299/350/500ms 六档，click 全部正常冒泡到末端 |
| 桌面隐藏列表漏掉 `hotspot` / `stats` 是缺陷 | **无实际影响**。1280px 下 `frame`/`hotspot`/`backdrop` 元素根本不创建，完整 no-op |
| takeover 时 `compat.css.ts:233-238` 只隐藏 `fab`/`backdrop` 不隐藏 `hotspot` | **无影响**。`createHotspotTask` 在 `takeoverActive()` 时主动移除热区 DOM |
| 竖滑 `preventDefault` 会杀掉抽屉内滚动 | **不会**。抽屉内竖滑 scrollTop 0 → 183 正常，零误 toggle |
| backdrop 需"点两次"才关 | **已修复且有效**。手势开抽屉后单击一次即关 |

其余实测通过项：`START_ZONE_PX = 48` 边界精确（x ≤ 47 开、x ≥ 49 不开，视觉热区仍 24px）；抽屉内左滑被正确忽略；cooldown 350ms 与模型吻合（反向手势 100/250ms 被拦，400/700ms 通过）；`[aria-modal]` 升起时手势完全惰性、移除后恢复。

---

## 三、CSS 位置与对称性

### C1 —— 热区规则内 `!important` 不成体系

`layout.css.ts:113-122`：

```
width: 24px;            ← 无 !important
z-index: 30 !important;
pointer-events: none !important;
position/inset/top/bottom: 全部 !important
```

同一条规则里 `width` 是唯一裸声明。热区是本插件自创元素、无上游竞争者，因此**当前不会出错**；但它与相邻声明的写法不一致，任何后来者按"照抄邻居"的直觉修改都会得到不一致的结果。要么全加、要么按"自创元素不需要 `!important`"的原则全删——不该只有一个例外。

### C2 —— 热区注释宣称"视觉可供性"，实际零可见样式

规则里没有任何 `background` / `border` / `box-shadow`，实测 `backgroundColor: rgba(0, 0, 0, 0)`。`sidebar-swipe.ts` 的 `createHotspotTask` 注释写"visual / touch-affordance layer"，`layout.css.ts` 也称其为视觉层。实际它是一个**完全不可见、且 `pointer-events: none`、且不挂任何监听**的 24px 空 div。

这不是 bug，但存在语义空洞：既然判定纯几何、且 `START_ZONE_PX = 48` 与视觉宽度 24px 也不相等，这个元素当下的唯一作用是让 CDP 探针有个断言目标。要么给它真实的视觉表达（并把宽度对齐到 48），要么删掉它并把探针断言改成对 `START_ZONE_PX` 的行为断言。

### C3 —— 探针锁住了视觉宽度，没锁住行为参数

`scripts/cdp-swipe-probe.mjs:390` 断言 `hotspotWidth === 24`。真正决定手感的 `START_ZONE_PX = 48` 全无断言保护。`cdp-swipe-failures.mjs` 有一条 40px 起点用例（在 24 外、48 内），间接覆盖了下界，但 48/49 的上界无人守。改错 `START_ZONE_PX` 不会有任何红灯。

---

## 四、注释与文档漂移

按"读者会被误导的程度"排序。

| # | 位置 | 现状 | 应为 |
| --- | --- | --- | --- |
| D1 | `docs/specs/…:195` | "终值参数以 AGENTS.md 为准（slop 4、open 0.20、close 0.16、vel 0.45/0.45）" | 四个值全过期（实为 lock 8、open 0.16、close 0.13）。且这是**自指指针**——同一份文档的 `:52` 已正确记录第三轮调优值，`:195` 反而指向别处的旧值 |
| D2 | `docs/specs/…:24`、`:106` | 状态机与流程图写 `\|dx\| > 1.5·\|dy\| 且 \|dx\| > 8px` | 1.5× 方向偏置已在第三轮废弃，改为纯支配 `\|dx\| > \|dy\|`。1.5× 正是"斜滑被拒"的主因之一，文档却仍在推荐它 |
| D3 | `docs/specs/…:70` | 文件表写 `markGestureConsumed(target, windowMs)` | 三参 `(target, windowMs, upTo?)`，`upTo` 是"点两次才关"修复的核心 |
| D4 | `sidebar-swipe.ts:11` | 头注释"the pointer goes down inside the left hotspot (24px)" | 识别区 48px；24px 只是视觉宽度。这句话直接误导读者以为判定用 24 |
| D5 | `gesture-guard.ts:5`、`:17` | 两处引用"the iOS self-healing re-dispatch path" | 自愈重发是 v2.1.5 基线方案，已被 #32 nav-arm MutationObserver 取代 |
| D6 | `tests/sidebar-swipe.test.ts:225-227` | 注释"upTo=frame"并解释自愈重发覆盖 | 实现已收敛为 `upTo=drawer`；测试自身传的也是 `root`。注释与它验证的不变式不符 |
| D7 | `endStroke` 注释（`:315` 附近） | "the host's synthetic re-dispatched click targets the row root" | 同 D5，自愈重发路径已移除 |
| D8 | `endStroke` 注释 | "within the 1s window" | 窗口已是 300ms（`CONSUME_WINDOW_MS`） |
| D9 | `AGENTS.md:59`、`:83` | `src/client/effects/reconciler-core.ts` | 实际在 `src/client/core/reconciler-core.ts`。effects 目录下无此文件 |
| D10 | `AGENTS.md:25` | `pnpm test:core` 注为"node --test tests/reconciler-core.test.ts" | 实际同时跑 `tests/sidebar-swipe.test.ts` |
| D11 | `AGENTS.md:68`、`:128`、`README.md:23`、`:120` | 宣传 `?mobile-nav-debug=1` 调试徽章 | **功能不存在**。`installDebugBadge` 自 `0d10397`（2026-08-22 重组）起无调用方，`grep -c "mobile-nav-debug" lib/client.js` → 0。用户按文档加参数会什么都没有 |

---

## 五、死代码与构建产物

| # | 项 | 说明 |
| --- | --- | --- |
| E1 | `src/client/debug.ts` | `installDebugBadge` 全仓无调用方，未进 bundle。要么在 `index.tsx` 重新接上，要么连同 D11 的四处文档一起删 |
| E2 | `gesture-guard.ts:96` `isGestureConsumed` | 唯一消费者是 `tests/sidebar-swipe.test.ts:12`/`:212`。生产代码不用，它是纯测试探针——若有意保留应在注释里写明，否则读者会去找不存在的调用点 |
| E3 | `lib/types/client/effects/reconciler-core.d.ts` + `.map` | `reconciler-core.ts` 已移到 `core/`，`lib/types/client/core/` 下有新副本，旧副本残留（tsc 不删旧产物） |
| E4 | `lib/types/client/MobileDrawerFooter.d.ts`、`MobileNavToggle.d.ts`（+ `.map`） | 组件已移入 `components/`，`lib/types/client/components/` 下有新副本，扁平旧副本残留 |
| E5 | `lib/types/client/locales.d.ts`（+ `.map`） | 源码在 `src/client/i18n/locales.ts`，`lib/types/client/i18n/locales.d.ts` 是当前产物，扁平旧副本残留 |
| E6 | `tests/installed-list.test.ts`、`tests/market-gallery-style.test.ts` | 手动跑 3/3 通过，但不在 `test:core` 的文件列表里 → 永远不会在闸门中执行，等同于无保护 |

E3–E5 无运行时影响（消费者用 `lib/client.js`），但会让 `pnpm build` 后的 `git status` 出现噪音，也会误导 IDE 跳转。

---

## 六、package.json 契约

| # | 项 | 证据 |
| --- | --- | --- |
| P1 | peer 范围无法匹配 `0.1.2-alpha.1` | `semver.satisfies('0.1.2-alpha.1', '^0.1.0-rc.6 \|\| >=0.1.1-rc.0 <0.2.0')` → `false`（`0.1.1-rc.2` → `true`、`0.1.2` → `true`）。预发布标识需显式列入范围 |
| P2 | `dsh.client.inject` 与 peer 列 `@deepseek-ai/dsh-client-ui-slots`、`dsh-client-ui-primitives` | 两包在宿主 0.1.1-rc.2 的安装树里**不存在**（已 `find` 全深度确认）。`slots` 仅作类型声明与服务名使用，无运行时 require；`primitives` 有真实 `require("@deepseek-ai/dsh-client-ui-primitives")`（`lib/client.js`），由宿主 web 资产 `assets/index-*.js` 提供注册。当前能跑，但 peer 声明与实际解析路径不一致，`npm ls` 类工具会报缺失 |

P1/P2 都不影响当前 profile 运行（`link:` 安装跳过 peer 校验），属于分发契约层面的隐性债务。

---

## 修复优先级

1. **S0 + S1**（同一处改动）—— `sidebar-swipe.ts` 加 `strokeLocked`，`phone-chrome.ts` 两个 handler 首行让位。补一条 `tests/sidebar-swipe.test.ts` 决策表用例锁住"宿主先 toggle 时手势必须让位"
2. **D1–D4** —— 参数类漂移，直接误导后续调优
3. **D11 + E1** —— 文档宣传一个不存在的功能，需二选一（重新接上 / 一起删）
4. **S2** —— reduced-motion 覆盖抽屉
5. **C1–C3、D5–D10、E2–E6、P1–P2** —— 一致性与卫生，可批量处理

## 复现脚本备注

本次全部证据由临时 CDP 探针产出（已按约定清理 `~/tmp/`）。若要复现，关键手法：

- `Page.addScriptToEvaluateOnNewDocument` 在任何应用代码前注册 capture-first / bubble-last 双探针，才能看清宿主与手势层的相对顺序
- 打桩 `Element.prototype.setAttribute` / `removeAttribute` 并只记录 `data-mobile-nav="frame"` 上的 `data-sidebar-collapsed`，可拿到每次 flip 的调用栈
- 测点坐标必须在抽屉**完全打开**后测量并缓存；抽屉过渡中 `getBoundingClientRect()` 会给出滑动中的位置
- 反向手势之间需 `sleep(500)` 让 350ms cooldown 过期
- 本机（Termux）隔离 profile 未弹"Internal Testing Notice"（`body > [class*="_root_15u5s"]` 零命中），但该清理步骤应保留——它在别的环境确实会出现
