# 侧边栏抽屉手势滑动方案

> **评审状态**：经两轮独立对抗评审（2026-08-27），定档 **A 档（松手判定式，不跟手）**。第一轮"跟手拖动"初稿被判定存在 2 个致命缺陷；第二轮独立复核确认缺陷 2 必然成立、缺陷 1 特定场景成立，A 档零 inline transform 使两个缺陷风险面均为 0。评审记录见文末。
> **2026-08-29 受控升级为 B 档混合（用户需求"滑动时就有动画"）**：按评审给出的解法落地——缺陷 1 以「每个 pointermove 都守卫 aria-modal/takeover」消除；缺陷 2 的结论不动摇（backdrop 保持 commit 时二值出现，绝不跟手）；判定与提交完全复用 A 档（classifySwipe + toggleSidebar），新增的只有"锁轴后 inline transform 跟手 + 松手释放 inline 让宿主 transition 接管"。**同日实测后打开方向回退为 A 档**：宿主 collapsed/open 是两套互斥子树（rail vs 抽屉），open 内容在状态翻转前未挂载，跟手只会拖出 rail。故最终形态＝**关闭方向左拖跟手，打开方向与右拖关闭保持 A 档**。详见下文「B 档受控升级」。

## 概述

为 `dsh-mobile-nav` 插件添加侧边栏抽屉的手势操作支持：**屏幕左边缘右滑呼出抽屉 + 抽屉内容区右滑关闭抽屉**。使用户在手机竖屏下获得与原生 App 一致的"边缘滑出/内容拖回"肌肉记忆。本方案对应上游 Issue #16（wingsky-1 提出，维护者以 completed 关闭但未实现，无任何手势 PR）。

## 现状

- 窄屏下（<1024px）侧边栏变为 overlay 抽屉
- 交互：点击 toggle 按钮 / 点击 FAB 打开，点击 backdrop / Escape / 导航项点击关闭；**关闭的六个入口都先播 280ms 滑出、落地才翻 marker**（第十二轮 2026-09-17，与手势关同一条晚提交路径），**打开**仍由 `.28s` CSS transition 驱动
- **无任何手势操作**
- 状态契约：`[data-mobile-nav="frame"]` 上的 `data-sidebar-collapsed` marker；唯一状态入口 `ctx.layout.toggleSidebar()`
- 抽屉 DOM：frame 首个子元素，宽度 `min(88vw, 280px)`（槽位＝自身宽的 110%，390px 下 -308px），关闭 `transform: translateX(-110%)` / 打开 `transform: none`，transition `.28s`。**宿主 0.1.5 的窄屏分支用 (0,3,0) 的 `[data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"]` 压掉过 width 与 transform 两条**，插件必须以同特异度重申（见第十二轮）

## 技术选型：A 档（松手判定式，不跟手）

### 方案定义

```
屏幕左缘 45% 识别区右滑打开 / 抽屉打开时整个 frame 内横滑（左右均可）关闭（**起点落在抽屉体内一律归抽屉族**，右缘 files 区只管辖抽屉右缘之外，第十二轮 2026-09-17）
  → 记录起点/位移/最近窗口速度
  → 方向锁定（首段 8px 内 |dx| > |dy|，纯横向支配）
  → release 时按"位移比例 OR 速度"判定
  → 命中：直接 ctx.layout.toggleSidebar()（动画全交现有 .28s CSS transition）
  → 未命中：无操作
```

**零 inline transform、零手势层 backdrop、零过渡期竞态**。抽屉几何只由宿主 CSS transition 驱动，与"点击 toggle"路径完全同构。

### 为什么不是"跟手拖动"（B 档）

| 项 | 结论 | 依据 |
|---|---|---|
| 缺陷 1（跟手 transform 违反 `transform:none` 不变式） | 打开方向天然不可达（设置对话框只能从抽屉内打开）；关闭方向依赖"aria-modal 让位 + 每帧守卫"才是安全（若只在 pointerdown 查一次，拖拽中模态升起仍会偏移设置遮罩 102px） | layout.css.ts L66-77 实证 + AGENTS.md L85 |
| 缺陷 2（backdrop 双归属） | **必然成立**：reconciler 用闭包局部变量 `backdrop === null` 判定创建/销毁，从不查 DOM；手势层自建 backdrop → release 后 rAF flush 必再建一个 → 双遮罩 + 孤儿节点 | overlay-backdrop-fab.ts L9/L23/L30 |
| B 档价值打折 | 遮罩跟手被缺陷 2 禁止（取 reconciler 引用做 opacity 跟手 = 脆弱依赖 + 竞态），只剩抽屉本体跟手；rAF 拖拽帧与 reconciler 的 rAF 合并 flush 抢帧 | — |
| 审查/维护成本 | A 档 ~110 行、状态机可穷举、判定纯函数可 node:test；B 档 ~200+ 行 + 每帧守卫 + backdrop 归属，每个点都在碰铁律 | — |
| 升级路径 | A 档把"判定"与"提交执行器"解耦（`classifySwipe` 纯函数 + `commit` 回调），未来升 B 档只换 commit 实现，零沉没成本 | — |

### 为什么不引入第三方库

宿主浏览器模块表 `window.__ModuleLoader__` 的各 client bundle 通过**内联自身依赖**注册模块，裸 require 只能命中 DSH 内置包（react、`@deepseek-ai/*` 及少数内置三方）。`@use-gesture` 不在内置集；`scripts/build-client.mjs` 只内联相对模块，第三方库内联需重写打包器（违反 AGENTS.md 且膨胀产物）。**自研是唯一务实路径**（业界 vaul/MUI 核心同样是自研 Pointer Events）。

## B 档受控升级（2026-08-29，用户确认 C3 混合）

用户反馈"右滑时抽屉不跟手，松手才播动画"。按 2026-08-27 评审预留的升级路径（判定/提交解耦）实施，**三个评审结论的落点**：

| 评审结论 | B 档落地 |
|---|---|
| 缺陷 1（拖拽中模态升起偏移遮罩）| **每个 pointermove 都守卫** `modalOpen() \|\| takeoverActive()`，命中即 `abortStroke()`（释放 inline → 宿主 transition 把抽屉弹回当前状态）——不再是 pointerdown 一次性检查 |
| 缺陷 2（backdrop 双归属，必然成立）| **backdrop 保持 commit 时二值出现，绝不跟手淡入**（用户确认）；手势层 DOM 足迹仍为零 |
| rAF 与 reconciler 抢帧 | 无 rAF 循环：跟手直接写在 pointermove 处理器里，每帧零布局读取（几何在锁轴时一次性缓存），每帧只写 1-2 个 style |

### 手势语义（C3 混合，用户拍板 → 打开方向于同日回退）

- **关闭跟手（新方向）**：抽屉内**左拖**（LTR）→ 抽屉跟手指向关闭槽位滑，钳位在槽位——物理动量与手指同向；
- **右拖关闭保留 A 档**：抽屉内右拖不跟手（无跟手映射，`followTranslate` 返回 null → 释放 inline），松手判定原样——零回归，老肌肉记忆不破坏；
- **关闭方向双向 + 全 frame 起点（第六轮 2026-08-29，用户报「往左滑收回判定范围还是左部 45% 小区域（根本没法左滑关闭）」+「希望打开抽屉之后以外的部分可以进行左滑」）**：两处独立缺陷叠加成「左滑关不掉」——① `classifySwipe` 的 open 分支 `if (dx <= 0) return 'none'` 只认右拖，而跟手映射偏偏只画左拖（`followTranslate` 的 close 分支），于是抽屉跟着手指走完再弹回去，动画承诺了判定不认的事；② `beginStroke` 的 open 分支要求起点落在抽屉自身几何内并显式拒 backdrop，抽屉右侧 ~28% 屏宽（390px 下约 110px）吞掉一切 stroke。修正：判定用 `Math.abs(dx)` 双向接受（fling 必须与自身方向同号，与 open 分支同样的矛盾守卫），起点判定放宽到整个 frame 矩形（只保留 kebab 让位）——抽屉打开时没有别的东西争抢横向 stroke（会话区在 backdrop 之下）。backdrop 点击关闭不受影响：tap 不进 tryLock，`endStroke` 在 `!wasTracking` 就返回、不写消费标记；但 backdrop **成为 stroke 起点**后其合成 click 必须被吃掉，否则刚关上又被 backdrop 的 click 监听翻回去——document 捕获的 `onClick` 因此从「backdrop/FAB 一律放行」改为「放行，除非该 overlay 就是本次 stroke 的起点元素」。配套：消费标记的 upTo 从「恒为 drawer」改为「起点在抽屉内则到 drawer，否则到 frame」——起点在 backdrop 时 drawer 不在祖先链上，旧写法会一路标到 document 根；
- **打开方向不跟手（2026-08-29 同日回退，用户实测"拖出来的 UI 界面和原来一点也不同、没有真实会话、位置全乱"）**：宿主在同一 sidebar column 里渲染**两套互斥子树**——collapsed 态是 ~206px 的**导航 rail**（只有 Task Board / SSH / Files / Session log，79 节点、`role=treeitem` **0 个**），open 态才是 ~280px 的抽屉（会话树 + footer，389 节点、15 个 treeitem，且 `inset-right` 从 183.9px 变 110px）。open 内容在状态翻转前**根本不存在**，所以跟手把关闭态列拖进视野只能拖出「宽度不对、内部布局不对、没有会话」的 rail——这不是 CSS 能修的错位，而是子树未挂载。打开方向因此保持 A 档（松手判定 + 宿主 .28s transition）。`followTranslate` 的开方向映射保留为纯函数并继续单测，但 `startFollow` 运行时不再启用它。

### 松手与清理

- **判定复用**：`classifySwipe` 原样（跟手后 dx 即拖拽进度），距离 0.16/0.13 OR 速度 0.45px/ms 决定完成/弹回；fling 速度优先（用户确认）；
- **提交时序（同一 task 内，无中间绘制）**：判定 → 释放 inline（恢复宿主 transition + 清 transform，开始向当前状态动画）→ `toggleSidebar()` 重定向 transition → 从手指位置一笔滑到终态；弹回分支只做前半段；
- **终态不变式**：open 态 computed transform 必须回到 `none`（fixed 后代 containing block 依赖）——inline 双清（transition/transform）后由宿主规则接管；探针 `swipe.open-release-transform-none` 锁定；
- **中断即弹回**：pointercancel / visibilitychange / blur / 拖拽中 modal 或 takeover 升起 → 释放 inline 弹回，不提交、不写消费标记；
- **槽位＝被拖元素自身宽度的 110%**（第七轮 2026-08-29 修正）：`strokeClosedTx = ±(drawer.getBoundingClientRect().width × 110%)`，锁轴时现算。此前缓存的是**关闭态**观测的 computed transform（`lastSeenClosedTx`），而关闭态宿主渲染 ~206px 导航 rail（槽位 -226.7px），被拖的是 ~280px 抽屉（真实槽位 -308px）——`followTranslate` 在槽位夹取，手指还在动抽屉已冻在离屏差 81px 处（用户报「半开不开」「卡一下」），松手 transition 再补那 81px（「停在我最终滑动的地方，之后消失」）。关闭 stroke 期间元素宽度不变（子树互换只在松手提交后），故 px 基线在此安全；开方向必须仍用百分比。`followTranslate` 纯函数决策表进 node:test（钳位/RTL/退化零槽位/-0 归一/rail-vs-drawer 槽位算术）；
- **反向回拉钉住不释放**：`followTranslate` 返回 null（拉过原点）时写 `translateX(0px)` 而非清 inline——清 inline 会把宿主 .28s transition 放回来，方向抖动即自己动起来、再跨回正向又跳一下；
- **打开方向＝先提交后跟手（early commit，2026-08-29 第三次迭代）**：宿主 collapsed/open 是两套互斥子树（206px 导航 rail 79 节点 0 treeitem ↔ 280px 抽屉 389 节点 15 treeitem），所以「拖着 closed 元素出场」必然错。正确顺序是 **轴锁定（8px）即 arm（第九轮：`OPEN_FOLLOW_ARM_PX` 12→8，锁轴到 arm 之间的 4px 是纯死区）→ 先用 important inline 把抽屉钉在槽位 → 同 task `toggleSidebar()`**：React 在屏外挂载真抽屉，之后每个 move 用 `followOpenTransform` 把它从槽位拉出来，用户看到的是真实会话树跟着手指走。钉位必须**先于**翻转，否则宿主 open 规则 `transform:none` 会先画一帧「已就位」再开始跟手（闪一下）。松手时判定语义不变（`classifySwipe` 仍用 `lockDrawerOpen`＝起手时的关闭态），但**提交方向反过来**：verdict=open → 什么都不做（已经开了，release inline 让宿主 transition 收尾），否则走**晚提交**（见下）；cancel/blur 同理由 `abortStroke(ctx)` 晚提交翻回。
- **关闭方向＝晚提交（late commit，第八轮 2026-08-29，用户报「最后抽屉样式突然消失，不是自然的动画收起」）**：松手瞬间翻转宿主是错的——React 对互斥子树的替换**异步落地**，CDP 帧采样实测落在 280ms 动画的中段（t≈200ms：宽度 280→206，tx 从 -207.6 **倒跳**回 -181.9，`translateX(-110%)` 对窄 rail 重新解析）＝动画中途抽屉内容被换、位置回跳。正确顺序：`commitWithAnimation` 先给抽屉写 inline `transition: transform 280ms` + **flush（读一次 getBoundingClientRect 锁定 before-change style）** + inline transform 到 `±110%` 终槽，**动画落地后**（定时器 280+40ms）`finishPendingCommit` 才翻转宿主并清 inline——此时子树互换发生在完全离屏处，不可见。三个配套不变式：① `finishPendingCommit` 翻转前检查 marker（280ms 窗口内 backdrop 真实 tap 已把宿主关上时，盲 toggle 会把抽屉**再打开**）；② 提交开始即写 cooldown（350ms 覆盖动画窗），窗口内新 stroke 被 `onCooldown` 拦截；③ `abortStroke` 遇 `pendingCommit` 直接让位（仅 dispose 传 `immediate` 同步落定）。开方向 revert（armed 后 verdict≠open）与 close 共用 `commitFollowClose`。
- **背景遮罩淡入淡出（第八轮同批，用户要求「背景黑色遮罩进行渐变动画」）**：淡入本就有（挂载 animation `.2s`）；补齐**淡出**——overlay 任务的移除路径改为「inline `opacity:0` + `pointer-events:none`（立即防误触）→ 260ms 后真正 remove」，重开窗口内（timer 未到）取消移除并恢复。手势层关抽屉时经 `fadeOverlayOut()` 在提交动画开始瞬间预淡出，使遮罩渐隐与抽屉滑出**同步**（帧采样实测 opacity 1→0.76→0.23→0.04→0 与 tx -80→-308 同帧推进）。`faded` 标志守卫恢复分支：晚提交期间 marker 仍 open，无标志的 open 分支会把预淡出洗回。`prefers-reduced-motion` 下 animation/transition 全关。铁律演进：「零手势层 backdrop、commit 时二值出现」中的「二值」自本轮起放宽为「commit 时渐变」，手势层仍不创建/持有 backdrop（只经 hook 预淡出）。
- **开方向 baseline 必须是百分比而不是 px**：arm 时元素还是 206px rail（槽位 -226.7px），一帧后变成 280px 抽屉（槽位 -308px）——arm 前缓存的 px 基线会让宽抽屉错位 74px（实测 left=-284 而非 -308）。`followOpenTransform` 输出 `translateX(min(0px, calc(-101% + Npx)))`（RTL 为 `max(0px, calc(101% - Npx))`），百分比每帧按当前宽度重解析，跨挂载自动正确；`min()/max()` 兼作开端夹取。**基线是 -101% 而非宿主槽位 -110%**（第九轮）：从 -110% 起跟，手指要先抵消 10% 超出量——CDP 实测 dx=12 首帧 left=-296（完全不可见），dx=28 才露第一条边＝用户报「刚开始会卡一下，之后才会拖出来」「最开始有真空期」；-102% 在 arm 点只剩 2.4px 仍偏空，**-101% 在 8px arm 即露 ~5px**（帧采样 left=-273.8，右缘 6.2px 可见），1% 余量保亚像素安全。CDP 实测 `calc` + `min()` 在 inline important 下正常解析。
- **inline 必须带 `important` 优先级**：open 态由我们自己的 `transform: none !important`（layout.css.ts 的 containing-block 规则）统治，普通 inline 声明**输掉层叠**——`element.style.transform` 读回完美但 computed 恒为 `none`，抽屉一动不动。这就是 B 档第一版「跟手隐形」的根因（2026-08-29 用户报"实时拖动消失了"）：所有断言都在看 `element.style.transform`，没有一条看 computed。故 `applyFollow` 用 `style.setProperty(..., 'important')`、`releaseFollowStyles` 用 `removeProperty`；探针新增 `swipe.close-follow-visible` 断言 **computed matrix 的 m41 与 `getBoundingClientRect().left` 双双随手指移动**。教训：跟手类断言只认 computed 几何，inline 字符串不构成证据。
- **跟手绑定必须每 stroke 重置**：`endStroke` 是先 `reset()` 后 `releaseFollowStyles()`（要留着 followDrawer 才能清样式），所以 `followDrawer` 会跨 stroke 存活——`startFollow` 首行必须先解绑，否则一次关闭跟手之后的**打开** stroke 会继承旧绑定、又跟起手来（实锤：探针 `swipe.open-stroke-no-follow` 第一次跑就抓到 `translateX(-166.703px)`）。

### 探针回归（`scripts/cdp-swipe-probe.mjs` 22 → 35 项）

`swipe.close-follow-reaches-slot`（长行程左滑的 computed 位移必须真能到 -110%×自身宽度，锁死 rail 槽位夹取那个 bug）、`swipe.close-leftward-inside`（抽屉内左滑必须真的关上）、`swipe.close-from-right-zone`（起点在抽屉右缘之外的右滑必须关上且 backdrop 归零，其合成 click 不得把抽屉翻回去；同区左滑是刻意的无动作，见 `swipe.files-zone-leftward-keeps-drawer`）、`swipe.open-follow-visible`（开方向 computed matrix/rect.left 随手指单调右移 + `transition:none`）、`swipe.open-follow-real-subtree`（跟手中的元素必须是已挂载真抽屉：collapsed=false、treeitem>0、width>260——挡住"拖出 206px rail"回归）、`swipe.open-release-transform-none`（提交后 computed=none）、`swipe.cancel-open-stroke-reverts`（armed 开方向 cancel 必须把宿主状态翻回、无 inline 残留）、`swipe.close-follow-drag-transform`（关方向 inline 单调趋槽位 + `transition:none`）、`swipe.close-follow-visible`（computed matrix m41 与 rect.left 同步移动＝inline 赢下层叠）、`swipe.follow-cancel-close-reverts`（关方向 cancel 弹回保持打开）、`swipe.drawer-band-precondition` / `swipe.drawer-band-leftward-closes`（第十二轮：起点落在抽屉右带内——同时也在 files 区内——的左滑必须收回抽屉，控制组是右缘之外仍不收）；失败场景 9 项原样全绿（B 系列 legacy 关闭与 C1 让位不受影响）。

### 第十二轮（2026-09-17）：点击路径动画恢复 + 开态判定区收边

**症状与取证**（390×844 coarse，活页面 CDP 逐帧采样）：点 toggle 开抽屉、点 backdrop 收抽屉都**没有动画**（连续 16 帧 computed transform 恒 `none`），而手势开关动画正常；关态 pane 实测 `transform:none / width:52px / rect [0,0,52,844]`。

**根因（两条叠加）**：
1. **层叠**：宿主 0.1.5 窄屏分支新增 `[data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] { width:52px !important; transform:none; pointer-events:none; background:transparent !important }`——**特异度 (0,3,0)**，比插件 `[data-mobile-nav="frame"] > :first-child`（(0,2,0)）高一档，于是 `transform: translateX(-110%)` 与 `width: min(88vw,280px) !important` **一起落败**：关态抽屉从未离开视口，开↔关唯一实际变化的是 width（52↔280），而过渡属性是 `transform` → 没有可插值的量，点击路径硬跳。手势路径不受影响（手势层写 inline `transform !important`，inline important 压过作者 important）。
2. **翻态撕视觉**：宿主在 marker 翻转瞬间就把 pane 变透明、去边框、内容 `display:none`。只修 (1) 只能救「开」方向；关闭方向必须**先动画、落地才翻**——复用第八轮的晚提交。

**修复**：
- `layout.css.ts` 以**同特异度**重申关态槽位：`[data-mobile-nav="frame"][data-sidebar-collapsed] > :first-child { width: min(88vw, 280px) !important; transform: translateX(-110%) !important }`（-308px@390）。
- 新增导出 `closeDrawerAnimated(ctx)`（`sidebar-swipe.ts`）：抽屉已开 → `commitWithAnimation` 滑到 `±110%`、落地 `finishPendingCommit` 才翻 marker（与手势关同构，含 cooldown 350ms 与 pendingCommit 的 marker 守卫）；已关或 `prefers-reduced-motion: reduce` → 返回 false，调用方回落普通 `toggleSidebar()`（保持「动画降级交宿主 CSS transition，不新增自写动画」）。
- **六个点击关闭入口统一收口**：`phone-chrome.ts` 的 `installOverlayInteractions` 把唯一的 `toggleSidebar` 本地别名改为 `if (!closeDrawerAnimated(ctx)) ctx.layout.toggleSidebar()`——backdrop tap / Escape / 非行导航 tap / 已选中行 tap / `armNav` 观察者 / `closeOnNavigation` 回退全部覆盖；FAB 与 toggle 的**开**方向保持普通 toggle（宿主 `.28s` 过渡驱动）。
- **开态判定区收边**：`beginStroke` 的 open 分支改为「起点落在抽屉矩形内 → 抽屉族」优先（纯函数 `openStateStartMode`）。390px 下 files 区从 x=214 起、抽屉到 280，这条 66px 重叠带原先按 files 族回 `'none'`（触摸抽屉本体左滑没反应）；现在归抽屉族（左滑＝收回，带跟手）。抽屉**右缘之外**不变：files 区左滑仍是刻意的无动作，右滑仍走 `commitFollowClose`。
- 手势层的**关态起点**判定不读抽屉 rect（只用视口比例），故 CSS 恢复不影响既有手势判定。

**回归门**：`scripts/probes/drawer-click-animation-probe.mjs`（关态槽位几何 / 开·关·Escape 三路径 16 帧采样 / 桌面零命中）、`swipe.drawer-band-*` 两条 + `tests/sidebar-swipe.test.ts` 的 `openStateStartMode` 决策表。

## 业界参数（源码级调研 2026-08-27）

成熟实现：MUI SwipeableDrawer（ratio 52% / vel 0.45px/ms / 热区 20px / 轴锁 3px / **iOS 默认禁边缘滑出**）、vaul（ratio 25% / vel 0.4px/ms / 纯 CSS transition / 滚动后 100ms 锁）、RNGH DrawerLayout（50% 投影 / 热区 20px / 3px 起判）、@use-gesture（swipe 50px+0.5px/ms+250ms / rubberband c=0.15）。

### 本方案参数（实装值，第三轮调优 2026-08-27）

> 演进：初稿 → 第二轮（用户反馈"行程太长"：open 0.30→0.20 / close 0.24→0.16）→ 第三轮（用户反馈"识别成对话内容滚动"：起点区 24→48px、轴锁定 1.5×→首段 8px 横向主导、速度窗口 120→60ms 末尾两点、阈值 0.20/0.16→0.16/0.13、新增边缘触摸 touchmove preventDefault）→ 第四轮（2026-08-29，用户反馈"判定太靠左需贴边"+"浏览器手势没禁"，真机 Android Chrome 实证页面直接返回：起点区 48→96px、根元素 `overscroll-behavior-x: none` 抑制 Chrome 边缘历史导航、新增横向滚动容器让位守卫）→ 第五轮（2026-08-29，用户要求识别区"约占总宽 45%"且"做成自适应"：起点区改 `round(0.45×视口宽)`）→ 第六轮（2026-08-29，用户报"根本没法左滑关闭"＋"希望打开抽屉之后以外的部分可以进行左滑"：关闭判定改双向、关闭起点区放宽到整个 frame）→ 第七轮（2026-08-29，用户报"左滑会卡一下、半开不开、停在最终滑动位置才消失"：跟手槽位从关闭态观测值改为被拖抽屉自身宽度的 110%）→ **第八轮（2026-08-29，用户报"松手时抽屉样式突然消失"＋要求"背景遮罩渐变"：关闭改晚提交——动画落地后才翻宿主；遮罩补齐淡出并与滑出同步）** → **第九轮（2026-08-29，用户报"右滑开头有真空期"：arm 门槛 12→8（锁轴即 arm）、开方向基线 -102%→-101%）** → **第十轮（2026-09-11，用户报"拖动桌宠类悬浮物会误开抽屉"，探针 draggable-conflict-probe 复现：手势层让位清单没有「拖动中元素」项，起点落 45% 区内 + 向右 ≥8px 即提前提交：先落地 0.25 缩窄（A 侧）＋`data-mobile-nav-dragging` 让位信号（C 侧）＝D 方案组合；用户实测后拍板 A 侧回滚——识别区保持 0.45 手感不变，冲突由让位体系独立解决）** → **第十一轮（2026-09-11，用户真机确认悬浮件仍误触发（dsh-pet 不挂标记），补 B 侧位置启发式 `findFloatingWidget`：起点祖先链上第一个 `position:fixed|absolute` 且 ≤200px（`FLOATING_WIDGET_MAX_PX`）的自由定位浮层即让位——dsh-pet 悬浮球实测 148×160 fixed 命中；frame 子树除外，误伤面=从 ≤200px 定位元素上起手（真实页面枚举仅 dsh-pet 本体命中）；让位≠拦截，拖动照常）** → **第十二轮（2026-09-17，用户报「点 toggle 开抽屉没有弹出动画、点右侧遮罩收回也没有动画」：宿主 0.1.5 窄屏分支以 (0,3,0) 压掉抽屉关态槽位的 width 与 transform，点击路径失去可插值的量；修复＝同特异度重申关态槽位 + 六个点击关闭入口复用晚提交动画；同批把开态判定区右缘收到抽屉右缘）** → **第十三轮（2026-10-17，issue #222：iOS 左右各 45% 识别区从静止起手纵向滚动零位移——轴锁定前的 touchmove preventDefault 取消了整个 touch point 的默认动作，WebKit 在同一笔触摸内不恢复；修复＝只在 `tracking`（横向已锁）后拦，锁定前一概放行原生滚动）**。均经 CDP 探针验证（`scripts/cdp-swipe-probe.mjs` 35 项 + `scripts/cdp-swipe-failures.mjs` 18 场景 + `scripts/probes/draggable-conflict-probe.mjs` 15 断言全绿；主探针 `drawer-touch-action` 断言同步 #45 zoom 契约：含 pan-y+pinch-zoom、不含 pan-x）。

| 参数 | 值 | 说明 |
|---|---|---|
| `startZonePx` | **`round(0.45 × 视口宽)`** | 识别起点区（`START_ZONE_RATIO = 0.45`，390px → 176px；每次 stroke 用实时视口现算，竖屏/横屏/平板无需分别调参）。演进 24 → 48 → 96 → 45%。2026-09-11 拖动冲突轮曾缩到 0.25，同日按用户拍板回滚保持 0.45——识别区手感不变，冲突改由让位体系（`data-mobile-nav-dragging` 标记 + 悬浮窗位置启发式，见下）解决。距离/速度阈值兜底，放宽起点不会误触（视觉热区元素已于 2026-08-29 删除，判定纯几何） |
| `lockPx` | **8** | 轴锁定：首段 8px 内 `\|dx\| > \|dy\|` 即锁横向（弃 1.5× 偏置——会拒绝 ~45° 自然斜滑）；纵向主导即放弃交还滚动 |
| `openDistanceRatio` | **0.16** 视口宽（390px→62px） | 打开阈值（vaul 25% 之下，轻快手感） |
| `closeDistanceRatio` | **0.13**（51px@390px） | 关闭阈值（比打开低，主动操作为主） |
| `velocityWindowMs` | **60** | 窗口末尾两点斜率（瞬时），弃 120ms 首尾平均（慢拖后快甩被稀释） |
| `openVelocity` / `closeVelocity` | **0.45 px/ms** | MUI 同款；速度 OR 距离任一满足即提交 |
| `cooldownMs` | **350** | 覆盖 .28s transition，防动画中反向手势双翻 |
| 判定组合 | `ratio ≥ X \|\| velocity ≥ V` | OR 非 AND（慢速长拖 / 快速短滑都有效） |
| 边缘触摸优先（**仅轴锁定后**） | document 捕获 `touchmove`（passive:false）`preventDefault`，执行条件 = `tracking`（横向已锁） | 已锁横向的 stroke 不被浏览器滚动抢占（iOS 合成器会抢边缘斜滑；防滚后事件流完整，iOS UIScreenEdgePanGestureRecognizer 语义）。**锁定前绝不拦**：首个被取消的 touchmove 会取消整个 touch point 的默认动作（W3C Touch Events cancelability），WebKit 在同一笔触摸内不恢复，`reset()` 清 trackingPointer 也救不回来——2026-10-17 issue #222（iOS 静止起手时侧区纵向滚动全死，零位移）；未锁定的纵向 stroke 原生滚动不受影响。**代价**：起手 8px 内纵向主导的斜滑可能被原生滚动先认领（第三轮「识别成滚动」的同类风险窗口），由真机验收覆盖 |
| 横向滚动容器让位（第四轮） | `findHorizontalScroller`（纯函数，node:test）+ `chainFrom`（运行时快照） | 起指在 overflow-x:auto/scroll 且真实溢出的容器内（stats 条、消息代码块）→ beginStroke 拒绝：不 preventDefault（保原生 pan）、不判开抽屉。识别区（0.45×视口宽）覆盖这些容器的左段，无此守卫则横滑 stats 条误开抽屉（失败场景 C1） |
| 浏览器手势抑制（第四轮） | 根元素 `overscroll-behavior-x: none !important`（layout.css.ts，mobile media query 内） | Android Chrome 边缘返回（历史导航）由此抑制——仅 html/body 有效（Chromium issue 41483088），headless CDP 只能断言 computed style，真机手感需人工验证；iOS Safari/壳无 CSS 手段（WebKit bug 240183），靠识别区（0.45×视口宽）避让其 ~20-40px 边缘条 |

## 文件级设计

| 文件 | 改动 |
|---|---|
| `src/client/effects/gesture-guard.ts` | **新增**，零 import；`markGestureConsumed(target, windowMs, upTo?)`（upTo 收敛到 drawer 是「点两次才关」修复核心）+ 轴锁定标志 `markStrokeLocked`/`clearStrokeLocked`/`isStrokeLocked`（S0）+ `consumeIfGestured(event)` 共存契约 |
| `src/client/effects/sidebar-swipe.ts` | **新增**；仅 import 同目录 `./phone-chrome.ts` + runtime 类型；纯判定函数 + `installSidebarSwipe(ctx)` |
| `src/client/effects/phone-chrome.ts` | `installOverlayInteractions` 的 onDrawerClick / onDrawerPointerUp 首行加 `if (isStrokeLocked() || consumeIfGestured(event)) return`（2 行谓词；`isStrokeLocked` 为 S0 修复新增：轴锁定发生在 pointermove，严格早于任何 pointerup） |
| `src/client/styles/layout.css.ts` | 追加：热区 section + **drawer 滚动容器 `touch-action: pan-y`**（关键一行） |
| `src/client/index.tsx` | `installOverlayInteractions(ctx)` 后加一行 `installSidebarSwipe(ctx)` |

### 核心函数签名

```ts
export interface SwipeThresholds {
  openDistanceRatio: number; closeDistanceRatio: number
  velocityWindowMs: number; openVelocity: number; closeVelocity: number
  lockPx: number; cooldownMs: number; startZonePx: number
}

// 纯判定（node:test 直测）
export function classifySwipe(
  t: SwipeThresholds & { viewportWidthPx: number; drawerOpen: boolean },
  m: { dx: number; dy: number; velX: number },
  rtl: boolean,
): 'open' | 'close' | 'none'

export function slidingVelocity(
  samples: Array<{ t: number; x: number }>, windowMs: number, now: number,
): number   // 窗口末尾两点斜率（瞬时）

export function hitTestStart(
  clientX: number, viewportWidthPx: number, rtl: boolean,
  t: Pick<SwipeThresholds, 'startZonePx'>,
): boolean

export function installSidebarSwipe(ctx: ClientContext): void
```

### 状态机

```
IDLE ──pointerdown(几何命中: closed 态＝左缘45%识别区; open 态＝frame 矩形内任意处（起点在抽屉体内一律归抽屉族；抽屉右缘之外按 45% files 区路由，第十二轮）, 非横向滚动容器/kebab, 无 aria-modal, 无 data-mobile-nav-dragging 让位标记, 无 ≤200px 自由定位浮层祖先, cooldown 外)──▶ ARMED
ARMED ──位移锁定(首段8px内 |dx|>|dy|, 锁定前复查让位标记)──▶ TRACKING
TRACKING ──每帧采样(窗口速度) + 每帧查 aria-modal(升起即取消)──▶ release
RELEASE ──classifySwipe──▶ 'open'|'close' → markGestureConsumed + ctx.layout.toggleSidebar()（记 cooldown）
                        └──▶ 'none' / pointercancel / visibilitychange(hidden) / blur → 直接 IDLE
```

- 判定方向永远与当前 `drawerOpen()` 一致（open 要求 closed、close 要求 open），过渡期 marker 已翻转 → 同向助推天然无副作用；冷却只防动画中反向操作。**关闭判定对左右两个方向都成立**（第六轮）；打开判定仍只认右拖（左拖在关闭态没有语义）。**右缘 files 区是刻意的例外**：其左滑回 `none`——第十二轮把这条限死为「抽屉右缘之外」，抽屉本体上的左滑永远归抽屉族
- 不主动 `setPointerCapture`（避免干扰滚动，浏览器滚动抢占走 `pointercancel` 兜底）
- 热区 DOM **不挂任何监听**（几何判定优先），只作视觉/触控层

### 与现有交互共存机制（关键）

宿主 `installOverlayInteractions` 已在 document 捕获阶段监听 click + pointerup（含 iOS click 被抑制时"宏任务后重发 click"的自愈逻辑），且**先注册先执行**——纯新增文件不碰宿主无法共存，必须走谓词：

1. 宿主 `onDrawerClick` / `onDrawerPointerUp` 首行 `if (isStrokeLocked() || consumeIfGestured(event)) return`（phone-chrome.ts 改 2 行；`isStrokeLocked` 防同一 release 事件上宿主先跑、consume 标记尚未写入的 S0 抢跑）
2. 手势层判定为手势后 `markGestureConsumed(up.target 链, 300)` 并同步 `toggleSidebar()`
3. 手势层自身注册 document 捕获 click：`consumeIfGestured` 命中 → `stopPropagation() + preventDefault()` → 挡住**元素级**监听（FAB/backdrop 的 `addEventListener('click', toggleSidebar)`）

**自愈路径不被掐死**：非手势 tap → 谓词集合空 → 宿主原样自愈；手势 up → 宿主 timer 排定后 `toggleSidebar()` 已同步翻转 marker → 自愈回调 `drawerOpen()` false 直接 return；即使 React 异步未翻，合成 click 也撞 `consumeIfGestured`。两条时序均封闭，自愈逻辑一行未动。

### 拖动元素让位体系（第十/十一轮 2026-09-11，标记接口 + 位置启发式）

拖动类组件（桌宠、悬浮球、拖拽排序等）与抽屉手势共享同一条 pointer 流：手势层此前对「拖动中的元素」零感知，起点落在识别区内 + 向右 ≥8px 横向主导移动即提前提交打开抽屉（探针 `scripts/probes/draggable-conflict-probe.mjs` 复现）。两级让位：

**C 侧·标记接口（配合实现的组件）**：

- **标记**：拖动进行期间，把 `data-mobile-nav-dragging` 挂在**被按住的元素（或其任意祖先）**上——或挂到 `documentElement` / `body` 作全局标记（适合拖动目标会移动、或实现方不便触碰节点树的情况）。
- **时机**：pointerdown 时挂上（最自然）；最迟首个 move 前挂上也可（手势层在**每次锁轴判定前**复查，`tryLock` 是第二个检测点）。
- **语义**：标记在场时手势层**整条笔画让位**——不 arm、不锁轴、不 preventDefault touchmove，拖动完全归组件自己。一旦锁轴即承诺（与选区让位语义一致），锁后出现的标记不回头。
- **解除**：pointerup / pointercancel 时移除标记，手势层下一笔照常认领。
- **让位 ≠ 拦截**：手势层只是不认领，不阻断事件派发——组件的 pointer 拖动照常执行。

**B 侧·位置启发式（不配合的第三方悬浮件，`findFloatingWidget`）**：

- **形状信号**：可拖动悬浮件在 DOM 上没有标准标记，但几乎必然住在一个**小尺寸自由定位浮层**里——起点 `event.target` 沿祖先链找到第一个 `position: fixed|absolute` 且自身 ≤200px（`FLOATING_WIDGET_MAX_PX`）的元素即判定为悬浮窗。
- **实锚**：dsh-pet 桌宠（`@linxin666/dsh-pet`，`kz2Bea_float`，`position:fixed`、实测 148×160、pointerdown/move + setPointerCapture + `touch-action:none` 标准拖动实现，无任何让位标记）命中。
- **排除**：`[data-mobile-nav="frame"]` 子树（FAB/backdrop/抽屉内容有自己的手势语义，永不因形状误伤）；全屏 overlay 因尺寸上限天然排除。
- **已知天花板（ponytail）**：静态的小定位元素（如消息角标）也会让位——代价是 ≤200px 点下的一次笔画起点被让位；真悬浮件若更大或改静态定位则漏——升级路径=挂 C 侧标记或调大上限。真实页面全量枚举（390px 手机 viewport）仅 dsh-pet 本体与气泡堆命中，无误伤实例。

### 热区 DOM/CSS

- `[data-mobile-nav="frame"] > [data-mobile-nav="hotspot"]`，`position:absolute; inset-inline-start:0; top:0; bottom:0; width:24px; z-index:30`（< 抽屉 40、> 主内容）
- `aria-hidden="true"`、无 role/tabindex（不进无障碍树）
- **必须 `@media (max-width: 1023px)` 包裹**（≥1024px 热区不存在，桌面零回归）
- **`touch-action: pan-y` 加在 drawer 滚动容器**（`[data-mobile-nav="frame"] > :first-child`）——不加则横滑被浏览器当滚动吃掉并发 pointercancel，手势全失效（比热区更关键的一行）
- taskboard/ssh 全屏接管态：effect 按需不创建热区（复用 heroPhase 判定移植），CSS 不感知

### 平台与可达性

| 项 | 策略 |
|---|---|
| iOS 边缘滑出 | **用户在 PWA/standalone（添加到主屏幕）模式下使用**（Issue #16 的 iOS 主路径：standalone 下 Safari 无网页边缘返回手势，冲突自然化解）→ **启用边缘滑出**；浏览器标签页内仍保留"默认禁用边缘滑出、仅内容区右滑关闭"的配置开关 `edgeSwipe: 'on'\|'off'` 预留（MUI 同款），判定实现用 UA 探测（iPhone/iPad + AppleWebKit + 非 CriOS/FXiOS + maxTouchPoints>1），配置点预留在插件 options |
| Android 13+ 边缘返回 | 系统手势抢占时 JS 收不到 pointerdown，天然让位无副作用；不硬阻断 |
| reduced-motion | 判定逻辑不变（滑动开关是导航可达性）；动画降级交宿主 CSS transition（不新增自写动画） |
| RTL | 热区用 `inset-inline-start:0` 自动镜像；几何判定取 `getComputedStyle(frame).direction`，`classifySwipe` 接收 rtl 镜像 dx 符号 |
| aria-modal 打开 | pointerdown **和每帧**检查 `[aria-modal="true"]`，出现即取消（防误提交） |
| 多指 | 仅跟踪第一指；后续 pointerdown 忽略 |
| WebView | 与浏览器相同；Android WebView 无系统边缘返回，全功能 |

## 测试策略

**node:test 纯函数单测（`tests/sidebar-swipe.test.ts`）**：`classifySwipe` 决策表（开/关/none × 距离/速度/bias × RTL × reduced-motion 不变性）；`slidingVelocity`（窗口裁剪、瞬时 vs 整段、空样本）；`hitTestStart`（24px 带内外、RTL、视口边界）；gesture-guard（mark/consume 一次性语义、target 链、过期）；状态机转移（注入假时间戳）。

**CDP 验证清单（390×844 mobile，全新 user-data-dir）**：
1. 边缘滑出打开：marker 翻转；逐帧采样 `getComputedStyle(drawer).transform` 断言**无插件写入**，且关态必须是**设计槽位**（`rect.left <= -rect.width`，390px 下 left=-308 / right=-28）而不只是「离屏」——宿主 0.1.5 的 52px 透明壳同样「离屏」，2026-09-17 的点击路径动画回归正是从这条缝漏过去的
2. 设置对话框（aria-modal）打开后：手势不生效、模态内 click 正常穿透
3. 双遮罩断言：开→关→开后 `[data-mobile-nav="backdrop"]` 数量恒为 1
4. 自愈回归：触摸 tap sessionRow（无手势）→ 会话打开 + 抽屉关（合成 click 未被误吞）
5. 手势后零副作用：内容区右滑关闭 → 无会话切换、无 FAB/backdrop 二次 click
6. 桌面 ≥1024px：无热区 DOM、无监听副作用、与禁用插件布局一致
7. 纵向滚动不触发手势（pointercancel + touch-action 生效），且**从静止起手必须真的滚起来**（issue #222：侧区纵向拖拽的 touchmove 不得被 preventDefault，探针 G 段）
8. 点击路径动画（第十二轮，`scripts/probes/drawer-click-animation-probe.mjs`）：关态槽位几何 / 点 toggle 开、点 backdrop 关、Escape 关三条路径各采样 16 帧必须出现中间矩阵并落到设计终态 / 桌面（pointer:fine）零命中

**真机清单**：iPhone Safari（边缘滑出默认禁/内容右滑关闭/自愈导航/模态交互）、Android Chrome 13+（边缘滑出与系统返回观感/兜底）、768-1023px 平板（阈值按视口比例自适应）、深/浅主题、与子代理芯片菜单同屏不互踩。

## 实施步骤

1. `gesture-guard.ts` + `sidebar-swipe.ts` + `tests/sidebar-swipe.test.ts`
2. `phone-chrome.ts` 加 2 行谓词；`layout.css.ts` 加热区 + drawer 滚动容器 pan-y；`index.tsx` 注册一行
3. `pnpm verify && pnpm test:core && pnpm build`（lib/ 刷新入库）
4. 新 marker 登记进 AGENTS.md DOM marker 清单
5. CDP 清单 + 真机验证；更新 README changelog

## 待用户确认

1. **手势范围**：边缘滑出打开 + 内容区右滑关闭（推荐，A 档完整）；还是仅边缘滑出打开（最小）？
2. **iOS 策略**：默认禁用边缘滑出打开（MUI 同款，推荐，避开 Safari 边缘返回手势冲突），保留内容区右滑关闭；还是 iOS 全功能开放？
3. **设置开关**：是否加"边缘手势"设置开关（可默认开启）？本版可先不加（保持最小），预留配置点。
4. **平板 768-1023px**：手势是否启用（Issue #16 倾向启用；本方案参数按视口比例自适应，默认启用）？
5. **开发基线**：v2.1.5（fork 已同步，推荐，含 41 个后续修复）；v2.0.0（用户实装）？

## 实测记录（2026-08-27，隔离环境 CDP，21 项断言全绿）

环境：隔离 DSH_HOME + link 本地 fork + `dsh web --port 3456` + headless Chrome（`scripts/cdp-swipe-probe.mjs`，复用 cdp-probe.mjs 的 CDP 基础设施 + `Input.dispatchTouchEvent` 触摸注入）。

**CDP 清单 7 项全部通过**：边缘滑出打开（marker 翻转 + 逐帧 transform 采样仅宿主两态）、内容区右滑关闭、aria-modal 让位（注入 modal 后手势 inert、清理后恢复）、双遮罩恒 1、手势后零副作用、桌面 ≥1024px 零回归（无热区/无 frame/无 backdrop）、纵向滚动不触发。

**实测驱动的两处实现修正**（方案文档原设计未覆盖）：

1. **`touch-action` 真正落点是 html/body 而非 drawer**：`layout.css.ts` 的 mobile `html, body { touch-action: manipulation }` 允许横向 pan。左缘热区 `pointer-events:none` 穿透到 body 背景（空抽屉/无内容时 `elementFromPoint` 命中 body），横向拖动被浏览器判为 pan 发 `pointercancel`，手势层收不到完整事件流。已改 `pan-y`（禁横向 pan，保纵向 + pinch-zoom；`touch-action` 不继承，只影响直接命中根背景的触摸）。drawer 的 pan-y 保留为双保险。
2. **内容区判定几何优先**：`beginStroke` 原用 `drawer.contains(event.target)`，但 hero/blank 空抽屉无内容元素，pointerdown 穿透到 frame 背景导致误拒。改为 `clientX ∈ drawerRect` 坐标判定（空抽屉同样成立，滑开空抽屉仍能滑回），元素树排除（backdrop/kebab）保留。

**验证注意事项**（已沉淀进 AGENTS.md pitfall）：
- 隔离 profile 全新启动弹宿主 "Internal Testing Notice" 模态（BODY > `_root_15u5s` 含 mask + aria-modal），探针须移除整个 root（只删 `[aria-modal=true]` 会留 mask 拦截触摸）
- 打开/关闭手势间须等待 cooldown 350ms 过期（探针每步后 `sleep(500)`）
- 偶发边缘滑出超时（run 1）为 headless 触摸合成抖动，重跑即稳定

**合并期修正（2026-08-27，维护者）**：consume 标记窗 1000→300ms + 手势层 consumedEl 门控每次 pointerdown 清空——WebKit 壳会整体抑制手势后的合成 click，长窗不清空会把用户下一次真实 tap 吞成死点击（upTo 不在链上时标记延伸到 document 根，短窗过期即兜底）。共存机制现基于 #32 nav-arm 方案（上文「自愈重发」为 v2.1.5 基线的历史方案）；终值参数见上文「本方案参数（实装值，第三轮调优 2026-08-27）」表：START_ZONE `round(0.45×视口宽)` / lock 8 / open 0.16 / close 0.13 / vel 0.45/0.45。

**维护期修正（2026-08-29，依据 docs/audits/2026-08-27-sidebar-swipe-latent-defects.md）**：① 宿主 `onDrawerClick`/`onDrawerPointerUp` 首行谓词升级为 `isStrokeLocked() || consumeIfGestured(event)`（S0/S1：宿主 capture pointerup 注册序先于手势层，consume 事后标记在同一 release 事件上尚未写入，唯有序型前移的轴锁定标志能防抢跑/双翻抵消——`isStrokeLocked` 在 `tryLock`（pointermove 阶段）置位、`reset` 清除，严格早于任何 pointerup，无时序竞态）；② 热区 DOM 元素已删除（C1–C3：判定纯几何，探针改行为断言）。上文历史段落残留的「24px 热区」「1.5× 偏置」「自愈重发」字样为历史记录，以「本方案参数」表、状态机与本文共存的机制描述为准。

**第四轮调优（2026-08-29，用户真机反馈）**：真机 Android Chrome 上"判定太靠左（需贴边才能滑）"且"贴边滑动页面直接返回上一页"。取证链：① Chromium `NavigationHandler.java` —— 历史导航手势要求起指在 `EDGE_WIDTH_DP=48dp` 边条内且 `|dx|>1.73×|dy|`，与旧 48px 识别区**完全重叠**，两个症状同根（起指 <48px 与浏览器手势打架、>48px 两边都不认）；② `overscroll-behavior-x: none` 仅在 html/body 根上抑制该手势（Chrome 官方博客 + Chromium issue 41483088 + 实证文章），已加进 layout.css.ts 的 mobile 根规则，同时修正了 pan-y 注释（pan-y 不含 pinch-zoom）；③ 识别区 48→96px（越出所有浏览器边条），随之新增横向滚动容器让位守卫 `findHorizontalScroller`（96px 区覆盖 stats 条/代码块左段，不守卫则横滑误开抽屉——失败场景 C1 红转绿锁定）；④ headless CDP 无法复现浏览器层手势竞争（探针 cancels=0 为常态），浏览器手势的验证边界 = computed style 断言（`swipe.root-overscroll-x-none`）+ 真机人工确认；C1 的原生滚动在 headless 不落盘（对照实验：无插件 data:URL 页同样 sl=0/cancels=1，伪影与插件无关）。

---

## 评审记录

### 第一轮对抗评审（2026-08-27）—— 初稿"跟手拖动"判定：不通过

**致命缺陷 1（事实 A）**：拖拽中给抽屉写非 none inline transform 会打破 `transform:none` 不变式（设置对话框 fixed 遮罩 `.VOzbGW_overlay` 被 portal 进 sidebar DOM，非 none transform → containing block 改变 → 102px 偏移/锚定失效）。

**致命缺陷 2（事实 B）**：backdrop 由 reconciler task（`overlay-backdrop-fab.ts`）以闭包局部变量 `backdrop === null` 判定创建/销毁；手势层自建 backdrop 不在其引用内 → release 后 reconciler 必再建一个 → 双遮罩 + inline opacity 残留 + 孤儿节点泄漏。

**附带发现**：缺 TRANSITIONING 态；backdrop fade 动画优先级高于 inline opacity；整段平均速度被拖拽史稀释宜改窗口瞬时；缺 visibilitychange/blur 兜底；与 installOverlayInteractions 自愈逻辑竞争需显式契约；热区放 base.css.ts 无 @media 会桌面污染；reduced-motion 在回弹路径无 reduce 覆盖；vendor use-gesture 为可评估选项；状态机时序建议 reducer 化 + 异常路径 try/finally。

**评审推荐**：A 档（松手判定式）可完全绕开两个致命缺陷。

### 第二轮独立复核（2026-08-27）—— 定档 A 档

- **缺陷 1 定性：特定场景才成立**。打开方向（closed→open）天然不可达（设置对话框唯一入口在抽屉内，closed 态不可达）；关闭方向靠"aria-modal 让位"保证互斥，但互斥是实现约定非状态不变量——若只在 pointerdown 查一次，拖拽中模态升起仍会偏移遮罩（真实致命）；每帧动态守卫则受控；**A 档零 transform 写入，风险面为 0**。
- **缺陷 2 定性：推论必然成立**。"完全不建 backdrop"是唯一干净绕法（手势层 DOM 足迹严格为零），遮罩跟手在 B 档实际被禁止。
- **定档：A 档**。理由：缺陷 2 砍掉 B 档一半价值；A 档 ~110 行零新增风险面、判定纯函数可测、与"点 toggle"路径完全同构；判定/提交解耦为 B 档升级留地基。

**升级路径**：A 档将"判定"与"提交执行器"解耦（`classifySwipe` 纯函数 + `commit` 回调）；未来升 B 档（跟手）只需：先修 reconciler backdrop 为 DOM 查询式幂等 ensure（单所有权）、drag 中每帧查 aria-modal + 动画期守卫、补 TRANSITIONING 态。均独立于 A 档地基。