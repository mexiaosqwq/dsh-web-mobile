# Pitfalls 档案（AGENTS.md 压缩条目的完整原文）

> AGENTS.md 的「Pitfalls」只保留**名字清单**（名字 = 触发词 = 本档的 `### 锚点`）；本文件是这些坑的**完整原文**——推导、取证记录、实测数据、探针断言表、被否决方案都在这里。动手改某块代码前，先按 AGENTS.md 里的名字定位本档对应 `### 条目`（`tests/docs-consistency.test.ts` 精确校验名字与锚点一一对应）。新增坑位的流程：名字加进 AGENTS.md 的清单，原文写进本文件并补 `### 同名` 锚点（顺序保持一致）。本档同时保留各时期的原始记录，其中的**计数 / 断言数 / 提交号都是当时口径**——现役数字一律以 `AGENTS.md` 与 `README.md` 为准（由 `tests/docs-consistency.test.ts` 对账），不要照抄本档的历史计数。

## 抽屉手势层（sidebar-swipe.ts）的铁律与共存契约

**抽屉手势层（sidebar-swipe.ts）的铁律与共存契约**：**开 = 提前提交**——起点区内 8px 轴锁定即 arm（`ctx.layout.toggleSidebar()` 同步挂载 389 节点抽屉），每步 pointermove 写 inline `translateX(min(0px, calc(-101% + Npx)))`（RTL 镜像）跟随；arm 帧 `content-visibility:hidden` 拆分挂载 longtask、两帧后 reveal（4x CPU 节流实测挂载=308ms longtask / rAF 间隙 225ms）。**关 = 晚提交**——松手先 inline 自播 280ms 滑到「被拖元素自身宽 ×110%」的 px 槽位（锁轴时由 `getBoundingClientRect().width` 现算），动画落地才翻宿主 marker（提前翻＝React 异步把 280px 抽屉换成 206px rail，中途 tx 倒跳 25.7px；280ms 窗口内背景点击由 `finishPendingCommit` 的 marker 防护兜底），遮罩随提交 `fadeOverlayOut` 渐隐（260ms 延迟移除，重开取消）。判定纯函数 `classifySwipe`/`slidingVelocity`/`followTranslate`/`followOpenTransform`（tests/sidebar-swipe.test.ts 覆盖决策表）；inline 一律 `setProperty(...,'important')`，断言看**计算后几何**；`transform:none` 无 inline 残留不变式只约束终态。手势判定后必须 `markGestureConsumed(target, 300, drawer)`（gesture-guard.ts，**链式标记到 drawer 为止**；upTo 不在起点祖先链时（如边缘滑入释放点在主内容）会一路标到 document 根，靠 300ms 短窗过期兜底，勿拉长窗口），宿主 `phone-chrome.ts` 的 `onDrawerClick`/`onDrawerPointerUp` 首行 `if (isStrokeLocked() || consumeIfGestured(event)) return`（isStrokeLocked＝轴锁定标志：tryLock 在 pointermove 阶段置位、reset/新 pointer 纪元清除；consume 标记到手势层自己的 pointerup 才写入，而宿主 capture handler 注册更早、同一 release 事件先跑——只靠 consumeIfGestured 挡不住 S0 抢跑/双翻抵消，2026-08-27 审计）——否则手势 release 后浏览器合成的 click 会被宿主当 tap 再关一次抽屉、或触发 FAB/backdrop 二次 click。**不要掐死 #32 nav-arm 导航关闭路径**：手势 up 后 marker 已同步翻转，非手势 tap 谓词集合为空、nav-arm 原样工作；宿主两 handler 首行 yield 只挡手势自身的合成 click。关键 CSS 一行：drawer 滚动容器 `touch-action: pan-y pinch-zoom`（不加 pan-y 则横滑被浏览器吃成 pan 发 pointercancel，手势全失效；漏 pinch-zoom 则浏览器施加的缩放无法撤销，#45——两者必须同时在）。起点判定纯几何（`hitTestStart`，0.45×视口宽识别区），无 DOM 热区元素、不挂监听；全屏接管（taskboard/ssh）语义只作用于 beginStroke 的 takeoverActive 短路。状态机兜底：pointercancel / visibilitychange(hidden) / blur / 拖拽中 aria-modal 升起 → reset。参数（回归门：`scripts/cdp-swipe-failures.mjs` 16 场景（含 E 段划词让位五场景：文档选区三 + textarea 选区与塌缩光标对照；F 段双指让位两场景）+ 主探针 14 核心 + 6 集成（3 项机读基线，见下条））：**识别起点区 START_ZONE_RATIO=0.45×视口宽**（无 DOM 热区元素，起点判定纯几何；固定小起步区会把边缘横滑误判成「识别成对话滚动」——真实手指落点 30-50px 家常便饭）、轴锁定 **首段 LOCK_PX=8px 内 `|dx| > |dy|` 即锁横向**（固定 4px slop + 1.5× 方向偏置不可用——1.5× 会拒绝 ~45° 自然斜滑）、open 0.16 / close 0.13 视口比例（~62px / ~51px @390px）、速度窗口 **60ms 窗口末尾两点斜率**（首尾平均会把慢拖稀释、报不出末尾甩动）、openVel/closeVel 0.45 px/ms、cooldown 350ms、consume 窗 300ms 且手势层 consumedEl 门控在每次 pointerdown 清空（WebKit 壳会整体吞掉手势后的合成 click，长窗不清空会把下一次真实 tap 吞成死点击）。**边缘触摸优先于滚动**：起点在识别区内的 stroke，`document` 捕获阶段 `touchmove`（passive:false）`preventDefault`——iOS Safari 滚动合成器会抢边缘横滑/斜滑，`pan-y` 只挡横向、挡不住纵向抢占，preventDefault 让边缘 stroke 事件流完整到达手势层（iOS UIScreenEdgePanGestureRecognizer 语义：边缘触摸不滚动）；纵向主导的 stroke 在 `tryLock` 里 reset（trackingPointer=0）后浏览器恢复滚动，非手势触摸不受影响。**划词选择所有权优先于手势（#43）**：非塌缩选区（拖拽选择手柄）与抽屉滑出几何上不可区分，`selectionOwnsStroke()` 双点让位——`beginStroke` 全局门（选区已存在）+ `onPointerMove` 轴锁前（长按选区出现在 pointerdown 后、锁定前的第二时间窗；reset 同时解除 touchmove preventDefault）；选区存活期间开抽屉的边缘滑也让位（tap 一次清选区即可恢复），backdrop 点关不受影响（tap 不进 tryLock）。**必须同时读两套选区模型（#44）**：`<textarea>`/`<input>` 内的选区**不出现在** `window.getSelection()` 里（报告人 iPad 实测 `taStart=0 taEnd=20` 而 `docCollapsed=true`），只读文档选区的版本会在 composer 内拖选择手柄时照常开抽屉并把选区拖没；`selectionOwnsStroke()` 先读文档选区，再读 `document.activeElement` 的 `selectionStart/End`（仅 TEXTAREA/INPUT，`try/catch` 包住：旧引擎对 number/email 类型招 `InvalidStateError`，Chromium 则返回 `null`，两者均归为“不拥有”）；塌缩光标（start===end）不算拥有，否则 autoFocus 的 composer 会永久掐死打开手势（探针 E3c 就是这根对照）。**距离从起点（startX）起算、lockPx 只作激活门槛不消耗行程**——从锁定点起算会把有效行程变成 lockPx+阈值（8+62px），手指要多滑一截才达标。**多指必须整体让位（#46 真机报告）**：单指 stroke 期间 `onTouchMove` 的 `preventDefault` 是边缘优先的关键一行，但它绝不能落在多指交互上——两指在屏＝浏览器的捏合缩放，拦了就把缩放手势掐掉，而 iOS 上捏合是退出放大态的唯一路径（等于复刻 #45 的陷阱）。两道守卫：`onPointerDown` 收到第二个不同 pointerId 时 `abortStroke(ctx)`（而不是旧的静默 return——那样 stroke 还活着，touchmove 继续被拦），`onTouchMove` 另判 `event.touches.length > 1` 直接让位（有引擎把手势交给合成器时不补发第二个 pointerdown）。bundle A/B 实测：修复前第一指落在左 45% 识别区的双指手势有 6/6 个多指 touchmove 被 preventDefault，修复后 0/10，而单指对照仍 9/9 被拦（探针 F1/F2）。代价：真手势中途按下第二根手指会取消该次滑动（与 pointercancel 同路径），可接受。`gesture-guard.ts` 保持**零 import**（node:test 直接可测，用特征检测而非 `instanceof Element` 以便非 DOM 环境运行）。**拖动元素让位体系（第十/十一轮 2026-09-11）**：用户报「拖桌宠/悬浮窗经过屏幕左侧误开抽屉」——识别区 45% 下起点按住可拖动悬浮件即被手势认领。2026-09-11 曾落地 D 方案（识别区缩到 0.25 + `data-mobile-nav-dragging` 让位标记），用户真机实测后拍板：**识别区保持 0.45 不缩（手感优先），冲突全由让位体系解决**——双层：① C 侧标记接口（配合组件）：拖动期间挂 `data-mobile-nav-dragging`（被按住元素/祖先或 body 全局），beginStroke 前置 + tryLock 锁轴前双点检测，在场即整笔让位，让位≠拦截；② B 侧位置启发式 `findFloatingWidget`（不配合的第三方件，dsh-pet 桌宠实锚：`kz2Bea_float` position:fixed 实测 148×160、pointerdown/move + setPointerCapture + touch-action:none 标准拖动实现、无标记）：起点 target 沿祖先链找到第一个 fixed|absolute 且 ≤200px（FLOATING_WIDGET_MAX_PX）的自由定位浮层即让位，`[data-mobile-nav="frame"]` 子树（FAB/backdrop/抽屉）除外。**取证方法**：真实页面全量枚举 `position∈{fixed,absolute} ∧ 0<尺寸≤200 ∧ ∉frame` 定位误伤面（本机 390px viewport 仅 dsh-pet 本体+气泡堆命中）；`@linxin666/dsh-pet/lib/client.js` rg 拖动实现确认。天花板：静态小定位元素（消息角标）也让位（≤200px 点下一次起手代价）；更大或静态定位的真悬浮件漏检——升级路径=C 侧标记或调大上限。回归探针 `scripts/probes/draggable-conflict-probe.mjs` 15 断言（0.45 几何 / 无标记球让位+跟手 / 标记接口 / 清除恢复），探针 boot 前把既有悬浮件 display:none 钉死环境差异。教训：**「缩小判定区」与「用户手感」冲突时先问用户**——A 侧方案当时未征求用户对识别区手感的取舍即落地，真机一测即被回滚；启发式方案的误伤面必须用真实页面全量枚举证明，不能只看注入 fixture。

---

## CDP 手势实测（scripts/cdp-swipe-probe.mjs，现 35 项断言）驱动的两处修正

**CDP 手势实测（scripts/cdp-swipe-probe.mjs，现 32 项断言）驱动的两处修正**：① **`touch-action` 的真正落点是 html/body 而不是 drawer**——layout.css.ts 里 mobile 的 html/body `touch-action: manipulation` 允许横向 pan，左缘热区触摸穿透到 body 背景（drawer 空壳/无内容时 `elementFromPoint` 命中 body）后横向拖动被浏览器判为 pan 发 `pointercancel`，手势层收不到完整事件流。已改为 `pan-y`（禁横向 pan 保纵向 + pinch-zoom；`touch-action` 不继承，只影响直接命中根背景的触摸，内容容器内横向滚动不受影响）。drawer 的 pan-y 保留双保险。② **内容区判定必须几何优先**（`beginStroke` 用 `clientX ∈ drawerRect` 而非 `drawer.contains(event.target)`）——hero/blank 空抽屉没有内容元素，pointerdown 穿透到 frame 背景，target 树判定会误拒手势；坐标判定对空抽屉同样成立（用户滑开空抽屉后仍能滑回）。验证注意：隔离 profile 全新启动会弹宿主 "Internal Testing Notice" 模态（BODY > `_root_15u5s`，含 mask + `aria-modal`），探针必须移除整个 root（只删 `[aria-modal=true]` 会留 mask 拦截触摸）；打开/关闭手势间需等待 cooldown 350ms 过期，否则反向手势被冷却拦（探针每步后 `sleep(500)`）。

---

## composer 底部行「固定控件三件套」不得参与自适应收缩

**composer 底部行「固定控件三件套」不得参与自适应收缩**：官方 composer row 两车道 tools(`_add`+`_modes`)/trailing(dock slot + ContextMeter + `_primary`)，三个图标控件官方全部 `flex:none` 固定尺寸（`_add` 28×28、ContextMeter trigger 28×28、`_primary` 发送 34×34）。mobile 覆盖把 `_trailing` 拉成 `flex:1 1 auto` 后：剩余空间会堆在车道右侧使发送按钮漂移，须给 `[class*="_trailing"] > [class*="_primary"]` 加 `margin-left:auto` 钉右缘；右侧固定簇 [模型条][圈][发送]：auto 挂**模型条 root**（`margin-left:auto` 吸全部余量，形成工具区↔模型条的自适应分界缝，宽屏才可见；另 `margin-right:-4px` 贴圈），圈 root 现为 `margin-right:0px`，圈 trigger 盒 **28×34**（2026-09-17 用户肉眼定稿），环保持官方 14px **不放大**（用户明确要求：放大抢注意力）。**间距旋钮只有一个且 1:1**：`6px + margin-right = 缝 = 墨迹左移量`（0px→左移 6px＝当前定稿；-6px→钉死不动；+8px→左移 14px 被判「过分」）。**几何教训**：右侧 `_primary` 与左侧模型条都焊死时，「可点区域变大」与「环位置不动」不可兼得——盒宽 28 已是几何上限（盒子居中于墨迹，而 `_primary` 命中区从墨迹中心起只往右 14px），右缘焊死则居中墨迹必然左移；只加高（24×34）是唯一「零位移」选项但右侧容差一点不涨。1px 偏移用户看不出效果，最终按肉眼定 6px。**探针取数三坑（2026-09-17 recon 实测）**：①`[class*="_card"]` 不是 composer 专属——手机实测 14 命中里 13 个是 bash 工具卡 `CY-8Ka_card`（`data-sample="bash"`，在会话流 `EvIC1a_flowItem` 内，y 为负、`rect.width>0` 仍算已布局但点不到），取「第一个 `_card`」纯看顺序；②`[class*="_root"]:has(> [class*="_trigger"][aria-haspopup="dialog"])` 也不唯一——轮尾 hover 动作栏的 `Q51KRG_root > Q51KRG_trigger[aria-haspopup="dialog"]` 同形（`TS9iAW_root[data-turn-tail][data-actions-reveal="hover"]`，y≈−3906）。正确口径：用宿主自己的 `[data-composer-card]`（count=1）选卡、圈的选择限定在卡内。③最阴的一条：**未布局副本的 computed 尺寸与布局副本完全一致**（28×34），而 `getBoundingClientRect()` 全 0——只用 computed 的几何断言会假绿，选卡必须 `rect.width > 0` 过滤并配 `elementFromPoint` 命中测试。锚点 `scripts/probes/composer-meter-hitbox-probe.mjs`（20 断言，A/B 已证非空转）；完整 DOM 解剖、标记溯源、状态签名与收口结论见本地 `docs/debug/composer-tree-recon.md`（§5 七问已全答、§8 为取证表）。send 的 auto 仅在双控件皆缺席时回退钉边，任一存在即经 `:has([aria-haspopup="menu"], > [class*="_root"] > [class*="_trigger"][aria-haspopup="dialog"])` 置 0，防双 auto 对分余量把条浮在中间。坑：模型条 `_7KE1Ra_root` 与 dock 槽均隔着 `display:contents` 包装 div——`>` 直接子组合器对其静默失配（实测 auto 挂不上、余量反堆 send 右侧），trailing 域内须用后代组合器；flex 中 margin:auto 的 computed 值是解析后 px，断言看几何别看 ==='auto'。通用收缩规则必须用 `:not([class*="_add"])`/`:not([class*="_primary"])`/`:not([class*="_root"])` 排除图标控件，否则窄屏被压扁（实测 34→31、28→25）。关键坑：ContextMeter（`JObwrW_` 哈希）trigger **没有** `aria-haspopup="menu"` 属性，model-selector 的 `:has(>[class*="_trigger"][aria-haspopup="menu"])` 规则不命中它——若不单独钉住其 root，root 可被挤到 11px 而内部 trigger 固定 28px 向右 paint 真实重叠发送按钮。回归手段：CDP 探针全视口扫描断言 add=28/send=34/贴右缘/无元素重叠 + 注入超长 triggerLabel 压力测试；Termux 上视觉目检不可用（read_image 后端进不了 /data/data），几何断言即验证。**子代理控制界面打破三件套假设（2026-09-05 修复）**：continuable 子代理会话 running 时官方 trailing 渲染**两个** `_primary`（`interruptible = running && continuable` → 停止键，中断子代理当前轮；`primaryStops = running && subagent === null` 为 false → 主键恒为发送键），四件套 [模型条][圈][停止34][发送34] 固有宽 ≈ 225px+gap——主会话三件套余量足够不暴露，子代理界面必暴露。移动覆盖（row nowrap + trailing `flex:1 1 auto` + 模型条 root `flex:0 1 auto; min-width:0` 是全行唯一可收缩 + 模型条 `ml:auto`）在空间不足时把模型条压到 0（胶囊消失）、auto margin 无 slack 归 0（[圈][停][发] 全贴 trailing 左缘）。实测：390 视口 trailing 224px vs 固有 225px 已在边缘（模型条 ml=7.28px）；360 视口模型条 115→100px、ml=0、圈/停/发贴左 l=237/263/303。复现探针 `scripts/probes/subagent-composer-fix-probe.mjs`：注入**子代理 ID**（实测注入父会话 ID 看不到 switcher，注入子代理 ID 反而打开父视图+switcher）→ 点 header「Switch subagent」（aria-haspopup=tree）→ 菜单 `ZKlsPq_row` 行选子代理 → send 一条短消息驱动 running 双 primary → 注入超长 triggerLabel + style 标签锁 `.uV2eYG_tools{flex:none!important;min-width:234px!important}`（必须锁 tools 容器——modes 的 min-width 不参与 row 层 flex 分配，锁 modes 无效）→ 断言 trailing 换行/模型条 ≥48px/send 贴 trailing 右缘/无重叠（390/360 双视口）。修复：该形态下恢复官方 wrap——`[data-phase] [class*="_card"]:has(textarea, [data-composer-input]) [class*="_row"]:has([class*="_trailing"]):has([class*="_primary"] ~ [class*="_primary"]) { flex-wrap: wrap }`，trailing 换到第二行整宽，四件套恒完整（min-width 保底候选已否决：极端空间不足时会让 send 溢出屏幕，比胶囊消失更糟）。修复前实测红：模型条压到 0-2px、send 出屏 28px；修复后绿：wrap 生效、模型条完整、send 贴右。主会话单 primary 与子代理 idle 不命中形态门，行为不变。**子代理 idle 形态的右钉修复（2026-09-06，6cc4405）**：子代理会话官方**不渲染模型条**（model seat available=false，模型由父锁定），trailing 车道失去唯一余量吸收器，而发送键 auto 又被圈的 `aria-haspopup="dialog"` arm 置零 → [圈][发送] 整簇贴 trailing 左缘、右半空（用户截图实锤）。修复=显式吸收器优先级 **模型条 > 圈 > 发送键**：圈 root 在 `trailing:not(:has([class*="_trigger"][aria-haspopup="menu"]))` 时挂 `margin-left:auto`（焊接 [圈][发送] 贴右，与主视图 [模型条][圈][发送] 同审美），发送 auto 仅在二者皆缺席时兜底，互斥由置零规则双 arm（menu+dialog）保证——任一时刻恰有一个元素吃余量，自适应空隙永远在焊接簇**之前**而非簇内。回归探针 `scripts/probes/diag-sub-idle-pin.mjs`。

### composer 卡与圈：宿主 marker 溯源 + 「未布局副本」的状态签名（2026-09-17 收口，回答 recon §5）

① **标记与代际**：`[data-composer-card]` 由宿主 InputBar 发射（`"data-composer-card": true` 挂 `InputBar_module_css_default.card`），**23 个已发布的 dsh-client-ui-conversation 版本全都有它，最早 0.0.1-rc.1（2026-08-10）就有**（npm tarball 阶梯 + jsdelivr 全量普查；jsdelivr 副本与 tarball 逐字节一致已锚定）→ 选 composer 卡只锚这个标记、**不留回退分支**（旧写法的 `[class*="_card"]` 回退正是 13 张 bash 卡的入口）；标记缺席时探针必须在 `0.composer-present` 大声红，而不是退化去量消息卡。**代际门在另一个标记上**：`[data-composer-input]`（Lexical 编辑面）自 **0.1.2-alpha.2（2026-08-30）** 才有，之前的宿主「有卡无输入域」——`composer-keyboard-guard.ts` 的旧宿主空转就是这一代差。

② **「未布局副本」的状态签名**：computed 读到规则值（28×34）而 `getBoundingClientRect()` 全 0，**只可能是「节点仍连接、但某祖先 computed display:none」**（多态对照实测）：分离节点（`cloneNode` / `remove()` 后）的 computed 是**空串**、根本读不到 28×34；而 `content-visibility:hidden` 属**另一类不可见**——rect 与 computed 全正常（实测 356×98 纹丝不动、环 28×34），只是不绘制、不可命中，**只有 `elementFromPoint` 抓得到**（MDN：`hidden` 让内容跳过渲染但保留布局盒，`display:none` 才移除盒）。真正当过那个祖先的是**宿主自己的链式叠加**：`dsh-client-ui-renderer` 的 `renderChainResult(slotKey, elected, opts)` 在 `opts.overlay` 下把 fallback 包进 `[data-chain-overlay-fallback="<slotKey>"]`——无叠加时该包装是 `display:contents`，一旦为 `conversation.composer` 选中叠加，就写成**内联 `display:none`**，把整棵 composer（含插件注入控件与 meter）一起藏掉。**2026-09-18 实测到的 elected 节点＝一张未回答的提问卡**（`Mbwy4a_frame[data-question-key="question:1"]`，属 `dsh-client-ui-user-questions`），即「代理正在问用户问题」这一正常状态；此时探针的 `rect.width > 0` 过滤给 0 张可用卡，而**只看 computed 的旧写法在同一时刻仍报 28×34 → 假绿**。**门与话术**：这是宿主正常状态、不是插件故障，探针必须走 SKIP 并点名 elected 节点（`composer-meter-hitbox-probe.mjs` 已实现：查 composer 槽自己的包装，`display:none` 才算被顶掉；别的槽的包装是 `contents`，不能拿「文档里第一个 `[data-chain-overlay-fallback]`」判断——2026-09-18 第一版就是这么写错的）。**认错的机制**：早期把祖先归给「frame 内联 `display:none`（fence-only）」只复现了形状（F 态对照保留在 recon §8.2），不是本签名的来源。状态/签名/判定对照表与取样脚本见 recon 文档 §4.3/§5.1/§8.4。

③ **`[data-phase]` 是双命名空间属性**：app 根 = `hero|active|settling`（`settling` 把 composer seat 置 `visibility:hidden`）；**编辑面上也带 `data-phase`**，值是 composer SubmitMachine 的相位 `plain|claimed|…`、未挂载时 `inert`（`"data-phase": input?.phase ?? "inert"`）。裸 `[data-phase]` 同时命中两者（实测 count=2：`hero@div` + `inert@div`，会话就绪后 `active` + `plain`）→ 探针断言 app 相位必须写值（`[data-phase="active"]`），别用 `[data-phase]` 取「第一个」。插件 CSS 里的 `[data-phase] …` 前缀是特异度围栏、不做相位判断，不受影响。

④ **周边节点归属**：`uV2eYG_overlayAnchor`（高 0、`position:absolute;inset:0 0 auto`）＝ `conversation.input.overlay` 槽的挂载点，槽内那个 `display:none` 的 span 是它的占位；`data-conversation-composer-overlay` 由**接管型视图自己声明**（轨迹 tab 的 `views_module_css_default.root` 实测带它），不是 anchor 发的——插件 `takeoverActive()` 读的正是这个通用属性（meme picker 等轻量浮层不带它，手势照常）。`Q51KRG_*` ＝ `dsh-client-ui-chat` 的 **TurnUsagePanel**（轮尾 hover 动作栏里的每轮用量按钮）；手机 28px 宽是**宿主自己**的 `@media (width<=480px){ …label{display:none} }`，与插件无关。

---

## composer 键盘 guard（composer-keyboard-guard.ts，PR #48）的 marker 契约按宿主版本分代

**composer 键盘 guard（composer-keyboard-guard.ts，PR #48）的 marker 契约按宿主版本分代**：上游 InputBar 的 `keepFocus`（`e.preventDefault(); <编辑面>.focus({preventScroll:true})`）挂在 send/stop/+ 三按钮的 `onMouseDown`（本地安装包实测确认），iOS WebKit 上该程序化 focus 会重新唤起已收起的键盘。修复＝capture 阶段 `mousedown` 命中 `[data-composer-card]` 内非编辑面 target 时，给编辑面临时装自有 no-op `focus` 属性（marker `data-mobile-nav-focus-shadow`），宏任务后恢复、dispose 兜底恢复；仅 iOS 武装（`detectIosWebKit` + `installMobileEffect` 双门），Android/桌面零监听。**`[data-composer-input]` 是 0.1.2-rc.1 Lexical composer 的编辑面 marker**，本地 0.1.1-rc.2 的 conversation 包只有 `data-composer-card`/`data-composer-seat`（实测无 input marker）→ guard 在旧宿主安全空转（`editor === null` 即 return）；升级宿主时按文件头注释对账两 marker。验证：贡献者 iPhone 实机通过 + 源码不变量测试（tests/composer-keyboard-guard.test.ts）；headless Chromium 的 `detectIosWebKit` 恒 false，本地 CDP 无法验证 guard 活跃路径。

---

## 宽度断点 ≠ 设备判定

**宽度断点 ≠ 设备判定：桌面窄窗口会激活移动模式（2026-08-30 PC 泄漏）**：断点原本只有 `(max-width: 1023px)`，而 PC 上分屏窗口、未最大化窗口、系统显示缩放（125%/150%/200% 都会把 CSS 视口压小，如 1920 物理 @200% = 960 CSS px）都会掉进移动分支——用户在桌面窗口看到右上角 Files 按钮（实测 rect [864,14]）、左上 toggle、底部 stats 行全套移动 UI；点击 Files 因桌面双击习惯触发 toggle 开→关快速翻转，感知为「抽搐、打不开」。修复 = `MOBILE_QUERY` 加 `(pointer: coarse)` 触屏守卫（JS 断点常量 + compat/layout/misc 全部顶层 media 块）；misc.css 桌面隐藏块改为精确补集 `@media (min-width: 1024px), (pointer: fine), (pointer: none)`（slot 渲染的按钮存在于任意宽度，守不住补集就会在窄桌面露出）。**探针必须补触摸模拟**：headless chromium 无 pointer 设备，`(pointer)` 三查询全 false，移动分支永不激活——探针视口设置须加 `Emulation.setTouchEmulationEnabled({enabled: !!mobile, maxTouchPoints: 5})`（`setEmulatedMedia` 对 pointer 特征**无效**，实测静默忽略）；桌面断言场景必须关掉触摸模拟。副作用契约：带鼠标的触屏笔电窄窗口走桌面 UI（主指针 fine），DSHA/手机/平板照常（触屏恒 coarse）。回归手段：CDP 三方场景（1440 桌面 / 900 窄桌面 / 390+触摸手机）断言 frame marker 与 controls 显隐。**维护约定：新增任何 `data-mobile-nav` 注入控件（slot 按钮、reconciler task 注入元素）都必须同步加进该隐藏块清单**——2026-08-30 复查实锤 `preview-full-toggle` 漏列（10 个标记值清单只有 7 个）；清单是 dispose 竞态的最后一道防线，不是摆设。另：探针断言 toggle/files（`conversation.session.header.actions` slot）前必须等会话进入 active phase——hero phase 下该 slot 容器语义不渲染按钮（hero 自己的 `qDHVXG_headerActions` 不是同一容器），否则把官方语义误判成回归。

---

## iOS “一输入就放大”是双因素（#45）

**iOS “一输入就放大”是双因素（#45）：字号 <16px 招聚焦放大 + 插件没给回路**。iOS Safari/WebView 一旦聚焦的 `input`/`textarea` 计算 `font-size < 16px` 就把 visual viewport 整体放大，**只在 blur 时缩回**——聊天壳的 composer 常驻聚焦（官方 `autoFocus` + 切会话重新聚焦），根本没有 blur 的时机；而插件同时堵死了两条退路：旧 `gesturestart` 监听器一律 preventDefault（**该事件是双指捏合，不是双击缩放**，拦它等于取消用户手动缩回的能力）+ 根 `touch-action: pan-y`（不含 pinch-zoom）。于是放大后只能关 App 重开或旋转一次才恢复，正是报告人描述的现象。三处修正：① 根/抽屉 `touch-action: pan-y pinch-zoom`（仍不含 pan-x，手势层不受影响；`touch-action` 沿祖先链交集，抽屉那行忘了就把根的授权抵消）；② 删掉 `gesturestart` preventDefault（双击缩放本就被任何显式 `touch-action` 关掉，不靠它）；③ `html[data-mobile-nav-ios]` 门控的 16px 下限（misc.css.ts）盖住 `textarea` / `[contenteditable]:not([contenteditable="false"])` / 文本类 `input`（排除 button/checkbox/color/file/hidden/image/radio/range/reset/submit）与 composer 的 `[data-input-mirror]`/`[data-input-backdrop]`（三件套必须同字号，否则光标与文本错位）；**故意不改 `select`**（会撑破 28px composer 控件，且原生 picker 自己遮盖屏幕）。引擎判定走纯函数 `detectIosWebKit(nav, supports)`（phone-chrome.ts 导出，tests/ios-zoom-guard.test.ts 覆盖决策表）：先特征探针 `CSS.supports('(font: -apple-system-body) and (-webkit-touch-callout: none)')`（Chromium 实测为 false，无误报），再 `/iP(hone|ad|od)/`，最后 `Macintosh` + `maxTouchPoints > 1`（iPadOS 13+ 发桌面 UA）。**不要改回 `maximum-scale=1`**：iOS 10+ 对用户捏合直接忽略它，而安卓/桌面引擎会认真执行——写了只会把安卓的缩放一并拿掉。取证记录：报告附图（iPhone 15 Pro Max）1290×2796 经像素取证算出 scale≈1.0（composer 卡片 288 设备 px ≈ 96 CSS px），即图本身并未定格在放大态，所以这一轮是**按机制修**而非按图修；现实官方 composer 已是 16px（`uV2eYG_card` 16px + input/mirror/backdrop `inherit`），它不是当下的放大源；真正可见的 <16px 域是第三方 13px 搜索框（`-NprXq_searchInput`）与官方 ask composer，下限把它们一并盖住并为旧/小字号宿主兼底。尚未验证的后续选项（报告人若仍复现再上）：`visualViewport` 驱动 frame 重置、`interactive-widget=resizes-content`——两者都有 jank 风险且 headless 无法验证。**宿主 viewport meta 从来没带过 `maximum-scale`**（0.0.1-rc.5 / 0.1.1-rc.2 / 0.1.2-rc.1 三版 index.html 实测都只有 `width=device-width, initial-scale=1`），所以插件里“保留宿主 maximum-scale”那条分支实际从不触发；别据此推断“宿主某版把它删了”。**下一版宿主的放大源已定位**：dsh 0.1.2-rc.1 的 `dsh-client-ui-conversation` 把 composer 从 textarea 换成 Lexical `<div contenteditable="true" role="textbox">`，卡片 `font-size: var(--dsh-content-font-size, 14px)`＝默认 14px，正落在放大区间；下限的可编辑分支写成 `[contenteditable]:not([contenteditable="false"])`（匹配属性而非值 "true"，Lexical 写 "true"、别的宿主可能是 plaintext-only 或裸属性；`false` 是 Lexical 给装饰节点用的，必须排除），探针 B6 用注入形状实测 14→16 而装饰节点 12 不动。同版还删掉了 `[data-input-mirror]`/`[data-input-backdrop]`（只剩 `data-input-scroll`），那两条选择器在新宿主上变空转，留着为 0.1.1-rc.2 兜底。**PR #46 的原路线（`maximum-scale=1, user-scalable=no` + 保留 gesturestart 拦截）已否决**：它对所有触屏用户彻底关掉缩放（WCAG 1.4.4 失败，而安卓/DSHA 这个多数群体根本没有 iOS 聚焦放大这个 bug），且一旦有字段漏在 16px 以下（第三方 13px 搜索框现存），iOS 用户又会被锁在放大态且这次连捏合退路都没有——正是 #45 的原始投诉。**砍窄后的 viewport 所有权部分已合并**（cb16329）：插件武装期间拥有 `meta[name=viewport]`，双 observer（content 属性 + head childList）在宿主改写/换节点/迟到注入时重申 `width=device-width, initial-scale=1, viewport-fit=cover`，dispose 只在内容仍是自己写的时候归还；**写入内容永远不带缩放锁**，`applying` 标志与相等判定一起防自触发循环（探针 A8-A10）。同 PR 提到 0.1.2-rc.1 起 client bundle 改走合并式端点 `/plugins/??a/client.js,b/client.js&rev=<12位>`，在本机 0.1.1-rc.2 上无法验证（仍是按插件 URL）。**已对账（0.1.5 实测，2026-09-15）**：本机现走组合端点，且**组合 URL 的 `rev` 与 sha1 无关**——实测 rev `760a4196b484` ≠ sha1(lib) `c37fc641a402` ≠ sha1(served) `ffcefb5084f8`，而 served 内容是当前代码（四个当前源码独有标记 1:1 命中）。served body = `lib/client.js` 的**逐字节前缀**＋80 字节 `//# sourceMappingURL=…` 尾巴（`cmp -n` 验证），所以权威对账＝`curl … | head -c $(stat -c%s lib/client.js) | sha1sum` 对比 `sha1sum lib/client.js`；按旧食谱「拿 rev 比 sha1 前 12 位」会得出「版本不一致」的假警报。无 cookie 时 401，cookie 用 `.local-tests/mint-cookie.mjs` 铸。**iOS 真机复核结论（PR #46 报告人，iPhone PWA + 宿主 0.1.2-rc.1 + 插件 8ab1fb5）：16px 下限有效——遍历实例里所有可输入域，聚焦均不再放大**，#45 的自动放大路径已从源头消失。同一轮真机暴露出**另一个独立缺陷**：手动双指外扩能放大、捏合缩不回来，追下去是手势层在多指交互上照旧 preventDefault（见上条 F 段），已修；真机复测仍待报告人回填（也可能叠加 PWA standalone 的系统级行为，对照测试未做）。

---

## dsh-meme 表情卡片右缘溢出 + 网格不自适应 + 滚动条太粗

**dsh-meme 表情卡片右缘溢出 + 网格不自适应 + 滚动条太粗**：`.meme-picker`（`conversation.input.overlay`，id meme-picker）用 `width:min(360px,90vw)` 对**视口**计算宽度，而卡片锚定在输入区的 overlay anchor（左右各 17px 内缩）里——窄屏手机（390px）下 border-box 377px 超过 anchor 356px，右缘会冲出屏幕。`compat.css` 里已用 `[data-mobile-nav="frame"] .meme-picker { left/right:0; width:auto; box-sizing:border-box; max-width:386px }` 修正：手机端贴 anchor 双侧对齐（左右安全距离对称），平板端保持原 386px 卡宽不拉伸。网格内部 `.mp-grid` 原是 flex + 固定 76px `.mp-cell`，手机端每行只有 3 列且右侧留 ~78px 空白；已改用 `display:grid; grid-template-columns:repeat(auto-fill,minmax(64px,1fr))` + `.mp-cell { width:100%; height:auto; aspect-ratio:1 }`（均 `!important` 覆盖 dsh-meme 行内 width/height），手机端 4 列、平板端 5 列满宽，间隙保持 8px，末行不完整属正常。网格右侧滚动条默认 WebKit 太粗，已加 `scrollbar-width:thin` + `::-webkit-scrollbar { width:4px }` 圆角细条。以后 dsh-meme 改卡片宽度或缩略图尺寸记得回来对账。

---

## agent preset 模式选择菜单手机端撑满屏

**agent preset 模式选择菜单手机端撑满屏**：新会话主界面点「Agent preset」模式选择，打开的是官方 `@deepseek-ai/dsh-client-ui-agent-preset` 的 `[role="menu"]` portal（挂在 `document.body`，不在 `[data-mobile-nav="frame"]` 内），其 CSS `position:fixed; max-height:820px; bottom:12px` 在手机视口下从触发器一直拉到距底 12px，几乎占满整屏。`compat.css` 里用 `[role="menu"]:has([class*="cubgiG_item"])`（`:has` 精确圈定该菜单，不误伤 model/access mode 等其他 `role=menu`）改成打磨过的底部弹层：水平居中（官方 max-width 360px 默认 left:12 会留 12/18px 不对称边距）、`top:auto; left:50%; transform:translateX(-50%); bottom:12px; width:min(100% - 24px,360px); max-height:min(55dvh,440px); padding:30px 6px 10px; border-radius:16px`，加顶部 36×4px 拖拽手柄（`::before`，pointer-events:none），内部 viewport 滚动。竖屏下该菜单内部滚动条默认 WebKit 太粗会占 ~15px 挤窄文字描述，已加 `[class*="_viewport_"] { scrollbar-width:thin }` + `::-webkit-scrollbar { width:4px }` 圆角细条。桌面 ≥1024px 在 media query 外，保持官方大下拉。注意：`cubgiG_` 是 agent-preset 包的 CSS module 哈希，包升级时需回来对账。

---

## 会话 header 拥挤保护的选择器必须用 `[class*="_root"]`，不是 `[class$="_root"]`

**会话 header 拥挤保护的选择器必须用 `[class*="_root"]`，不是 `[class$="_root"]`**：子代理计数（"N 个子代理"）渲染在 crumbs 的 lineage 里，后台任务触发器（"N 个后台任务运行中"）在 headerActions。关键坑：subagent 插件的 lineage root class 是 `class="ZKlsPq_root "`——**带尾随空格**（模板字符串 className `${root} ${variant==="switcher"?switcherRoot:""}` 拼出来的），于是 `[class$="_root"]` 在真实 DOM 里 **0 命中**（实测 `querySelectorAll` 返回 0），所有依赖它的保护/钉宽规则全部静默失效——这就是「修完还是截断」的根本原因（测试用干净 class 字符串的合成 fixture 复现不出，只有真渲染能暴露）。修正：门控用 `header:has([class*="_crumbs"] [class*="_root"])`（lineage root 运行/空闲都在，也覆盖 `_activitySlot` 瞬态点的坑）；钉宽只钉计数/jobs root：`header [class*="_root"]:not([class*="_switcherRoot"]):has(> button[class*="_trigger"]) { flex:0 0 auto; min-width:max-content }`，排除 switcher root 让它内部 `.switcherTitle` 保持可省略号收缩（switcher trigger 的 class 同样带尾随空格 `ZKlsPq_switcherTrigger `）。另外：根会话 lineage 计数自带官方 `ZKlsPq_separator` "/"（桌面 chrome，语义像多了一级面包屑），移动端已用 `header [class*="_crumbs"] [class*="_separator"] { display:none }` 隐藏；crumbSep "/"（子代理会话段间分隔）保留。计数 root 不收缩后，crumbs 里让位的是 title/switcher title——省略号截断标题是预期行为。**2026-09-14 让位优先级反转**（模式名与标题保文字、后台任务 chip 的长标签让位）＋同轮的「弹层包含块 / 行高 / 座位线」见下节 §header 行高与弹层。

---

## 哈希类选择器一律子串匹配

**哈希类选择器一律子串匹配：属性级 `[class$=…]` 是对整个 class 属性串做后缀测试**（全量迁移实证）：元素 class 带第二个 token 或尾随空格即整体失配（如 `wSkVaW_composerStack wSkVaW_composerHero`、旧坑 `ZKlsPq_root `）——「rc.2 哈希前置导致后缀失配」的说法并不准确，多 token/尾部杂物才是根因。全量 `$=`→`*=` 后，原本静默死亡的规则会复活并可能过匹配，前缀重叠片段必须加 `:not` 守卫。已守卫族：`_action/_actions`、`_header/_headerActions`（实锤回归：`[class*="_header"]` 工具栏复合规则还命中 @linxin666 插件设置卡头 `*_headerStatic`（pet/community-plugins/skin-center/live-stats 共享 PluginSettingsCard 模板），「关闭按钮圆形底座」的 50% 圆角+灰底落在其全宽 `_headText` span 上=设置分类顶部灰色椭圆，容器规则同时压掉上游 14px/16px 内边距；三条规则均已追加 `:not([class*="_headerStatic"])`，回归探针 `scripts/probes/ellipse-regression.mjs`）、`_stat/_statsRow`、`_scroll/_scrollBody`（实锤回归：会话内容列被 `[class*="_scroll"]:has(p)` 多垫左右各 20px，内容宽 390→350；DSH 0.1.2-rc.1 起 composer 的 `uV2eYG_scroll` 因 Lexical 渲染真 `<p>` 也命中该规则，已加 `:not(:has([data-composer-input]))` 显式排除，PR #47）、`_tabBar/_tabBarRight`、`_row 及 _row* 复合族`（实锤回归：设置 Models 区类名 rows/rowCard/rowHead/rowIdentity/rowActions 全命中三连规则，UL 的 ：first/:last-child 拿 width:100%，叠加官方 content-box(+14px padding+1px border) 使首尾模型卡 372px vs 兄弟 342px 并超出 390 视口，已加五段 `:not` 守卫）；低危未守卫候选：`_search/_searchInline/_searchBox`，升级宿主后用 CDP 普查复核。回归手段：headless CDP 向 scrollBody 注入 `<p>` 后断言 computed padding 保持 0px；换 bundle A/B 用 `git show <commit>:lib/client.js > lib/client.js`——服务端 no-cache 现读该文件，用户正开着的页面会实时看到切换，A/B 窗口要短并及时还原。

---

## 设置对话框工具栏三连规则必须结构化锚定，禁止裸 `[class*="_header"]`（2026-09-05 实锤）

**设置对话框工具栏三连规则必须结构化锚定，禁止裸 `[class*="_header"]`（2026-09-05 实锤）**：layout.css.ts 的工具栏规则（flex-end / 清 margin / 32px 圆底）原本以 `[class*="_header"]:not([class*="_headerActions"]):not([class*="_headerStatic"])` 锚定，但该子串同时命中内容区所有插件卡头——官方 Plugins 配置卡 `YyYd_a_header`（Shell/Agent loop/Web search 三张）与 dsh-web-ui-all 分组卡头（`Kwoi6G_header`/`bpnj3G_header`/`Jh0q7G_header`/`jmhvDG_header`/`rUBhvW_header`，dsh-remote-web-ui 等包共享同款模板 appearance:none;text-align:left;gap:12px;padding:14px 16px;border-radius:12px）。症状=标题右对齐、官方 padding/gap 被清成 `0 0 0 4px`/8px、箭头 svg 套上 32px 灰圆底（全节扫描共 8 个卡头波及）。修复=结构锚定工具栏的两个合法位置：reparent 后 `> [class*="_nav"] > [class*="_header"]`、reparent 前 `> :last-child > [class*="_header"]`（卡头在 options 滚动区深处，两处都不匹配，免去逐插件哈希加 `:not` 守卫）。回归探针 `scripts/probes/plugin-card-header-bleed.mjs`（10 断言：8 卡头 computed 与桌面一致 + 工具栏仍 flex-end 且 close 32×32 圆底）；新装插件卡再现同类症状先查这条规则。

**2026-09-18 复核（上游已换代，探针按结构重锚）**：官方 Plugins 页现在是 **4 张**卡头（原记 3 张；`ShellLimits`/`Agent loop`/`Subagent`/`Web search`），全部仍是 `YyYd_a_header` 且 computed 模板不变量成立（justify normal / gap 12px / padding 14px 16px / min-height 0）——**被测目标仍在，规则没有被上游改坏**。同轮实测的三处漂移：①设置 nav 里那一格现在叫 **`Web Plugins`**（旧记法 `Web UI Plugins`，探针按旧字面找会静默点不到、后面全链 0 命中）；②那页**零 `[class*=_header]` 卡头**（整个 modal 62 个节点，只有工具栏），dsh-web-all 五张分组卡头 `Kwoi6G_/bpnj3G_/Jh0q7G_/jmhvDG_/rUBhvW_` 中 `bpnj3G_`/`jmhvDG_` 已改名、**其余三张只在样式表选择器里、无元素渲染**；③手机端卡头不再画 14px 箭头、工具栏叉号也是 0×0（旧断言把「未绘制」记成「被改坏」）。探针因此改成：只对**实际绘制**的节点断言模板（避免对空集合永真），Web Plugins 场景按结构测（`[class*=_header]` 去掉工具栏）并加一条「该页工具栏在场」的非空转锚。**契约对账的 `hit` 同理**：字符串出现在 DOM class **或任何已加载样式表的 cssText** 里就算命中，未使用的 CSS-module 类照样 HIT——要断言「渲染了」必须靠探针的渲染级断言。探针还需 `DSH_PROBE_COOKIE`（2026-09-18 前它没有 cookie 支持，在本机认证实例上直接 "mobile frame timed out"）。**2026-09-19 a2 对账备注**：0.1.6-alpha.2 删除 PluginCard.tsx，`YyD_a_` 族整体消失（新卡头族 `pbvGtq_/UYsYFG_/uedTFq_`）；plugin-card 探针的 headers-present 断言在 a2 必 FAIL，处置（EXPECTED_FAILURES 或改锚新族）见 audit doc §10.2-5；VOzbGW_ 族断言实测存活不受累。

---

## 触屏 tooltip 压制规则必须保留 actions 行祖先限定，禁止裸 `[class*="_bubble"]`（2026-09-06 实锤，用户消息消失）

**触屏 tooltip 压制规则必须保留 actions 行祖先限定，禁止裸 `[class*="_bubble"]`（2026-09-06 实锤，用户消息消失）**：layout.css.ts 的触屏压制规则（fork 7e58824 摘抄 190fbbf）摘抄时「放宽作用域」去掉了 fork 原有的 `[class*="_actions"]` 祖先限定，裸 `:is([class*="_bubble"], [role="tooltip"])` 在触屏设备上把**用户消息气泡**（`gdEzaW_bubble`，位于 `userRow > userStack`，`_actions` 是它的兄弟而非祖先）与 **goal 气泡**（`oRe1gG_bubble`，同款用户气泡视觉）全部 `display:none`——移动端消息流里用户发的每条消息直接消失，assistant 消息（无 `_bubble` 类）正常，感知即「我的消息没发出去」。0.1.1-rc.2 上**不存在任何可见 tooltip 气泡**：复制标签是 `visuallyHidden` span（读屏专用），全宿主 client-ui 包 `role="tooltip"` 0 命中——当时「CDP 实测 10 个 tooltip 元素全压制」的 10 个元素就是 10 条用户消息，验证断言恰好断在 bug 本身。修复=`[data-phase] [role="tooltip"]`（全域臂保留）+ `[data-phase] [class*="_actions"] [class*="_bubble"]`（恢复 fork 原祖先限定，0.1.2 形状 tooltip 内联在 actions 行时会自激活）。**摘抄/移植类 CDP 验证必须同时断言非目标元素（用户消息、goal 气泡）保持可见**，只测「目标被压制」会把自己造成的破坏当成验证通过。回归探针 `scripts/probes/diag-flow4.mjs`（两步注入法 v2：boot 后等 localStorage 稳定≈6s 再 setItem 重导航，宿主会在 boot 后 ~4s 用自身解析的当前会话回写 `dsh.sessions.current` 冲掉早写的注入值）。

---

## hero 紧凑净空与 git 胶囊锚点净空的级联冲突（2026-09-06 实锤，胶囊压输入行）

**hero 紧凑净空与 git 胶囊锚点净空的级联冲突（2026-09-06 实锤，胶囊压输入行）**：compat.css 给 reparent 进卡片的分支胶囊锚点（绝对定位 top:12 left:12）配套 `[class*="_card"]:has([data-gitgraph-chip-anchor]) { padding-top }` 顶部净空，misc.css 的 hero 紧凑规则 `padding-top: 6px` 与它**特异度同 (0,3,0) 且 misc 拼接在 compat 之后**——hero 相位 40px 净空被踩成 6px，28px 高的胶囊（git-graph 芯片已从当年调参的 24px 长到 28px）直接压住输入行 22px；会话内（非 hero）不受影响，症状=「仅新会话输入框居中时胶囊异常」。修复=misc 的 padding-top 覆盖加 `:not(:has([data-gitgraph-chip-anchor]))`（gap 覆盖保留在宽规则上，胶囊卡片 gap 维持 8px），净空随芯片生长 40→44px 保住原 4px 呼吸隙；顺带补 frame 域 `[data-gitgraph-chip-anchor] [data-gitgraph-chip] { touch-action: manipulation }`（misc 的触达三件套挂在 dock 槽下，reparent 后永远死匹配）。教训：**同一张拼接样式表里跨块调参前，先用探针量同特异度冲突**；胶囊时序性渲染（/git/branches 异步加载，headless 复现不稳定）探针必须轮询等锚点出现再断言。回归探针 `scripts/probes/diag-hero-chip.mjs`（8 断言）。

---

## `data-conversation-composer-overlay` 是宿主 conversation.view 的通用 overlay 属性，不是 file-viewer 专属（2026-09-06 两信号解耦，方案 F）

**`data-conversation-composer-overlay` 是宿主 conversation.view 的通用 overlay 属性，不是 file-viewer 专属（2026-09-06 两信号解耦，方案 F）**：源码查证（dsh-client-ui-trajectory client.js）该属性渲染在**每个**活跃 conversation.view tab 的根 div 上——官方「轨迹」tab 同款；conversation 包以 `renderSlot("conversation.view", …, { only: active.id })` 只渲染活跃 view，切 tab 即卸载。file-viewer marker task 曾用它判定「查看器打开」，轨迹 tab 打开时误置 `data-file-viewer-open`（fork 2ff7976 同款判定，缺陷为继承）。现行为（显式设计语义，`docs/specs/2026-09-06-conversation-overlay-takeover-design.md`）：marker 判定只认 `.dsfv-panel`（file-viewer 独有类，专服务 compat.css 布局）；手势让位 `takeoverActive()` 直查通用 overlay 属性——**任何** conversation overlay（轨迹/file-viewer/未来第三方 view）打开期间抽屉边缘滑让位（横滑内容赢左缘识别区），FAB 仍可开抽屉；taskboard/ssh 两臂不变。回归探针 `scripts/probes/file-viewer-probe.mjs` 场景 5 注入「纯属性、无 dsfv 类」形态断言 marker 不置位但滑动让位（diag-flow4 教训：注入形状必须含反断言形态）。

---

## 会话 header view tab strip 手机端横滚（#41，5a47149 沉淀）

**会话 header view tab strip 手机端横滚（#41，5a47149 沉淀）**：官方 tablist（`header [role="tablist"]`）是单 flex 行（gap 36）按两个 stock tab（对话/轨迹）定尺寸；插件注册更多 view（memory/skill/todo 面板、各插件设置页）后 shrinkable 按钮塌到 min-content——CJK 标签逐字竖排（楼梯）、latin 按词断行，一条 strip 吃掉一屏竖空间（#41 实测 8 tabs，HarmonyOS 浏览器）。修复（layout.css.ts）：strip 改 `overflow-x: auto` + 按钮 `flex-shrink:0; white-space:nowrap`（标签恒完整），`touch-action: pan-x` 让 strip 自身认领横向 pan（root 的 pan-y 交集止于第一个滚动容器，页面不侧滚），`overscroll-behavior-x: contain` 防 fling 链出边界、`scroll-snap-type: x proximity` + `scroll-snap-align: start` 弹后对齐、滚动条隐藏。**affordance 是右缘被切断的 tab**（「还有更多」暗示）——与设置 navList 的 wrap 相对：那里按钮几乎放得下、切边看不见所以 wrap；这里 tab 多、切边天然存在所以横滚。与手势层的让位关系：起始于已溢出 tab strip 的边缘滑被 `findHorizontalScroller`（祖先链第一个 `overflowX: auto|scroll` 且 `scrollWidth > clientWidth` 的元素）在 beginStroke 拒绝——横滑归 strip 自身；只有两 stock tab 不溢出时不影响手势。

---

## 子代理计数芯片手机端点击不稳定是上游 hover-only 缺陷，已用触摸兼容效果修复（`subagent-chip-touch.ts`）

**子代理计数芯片手机端点击不稳定是上游 hover-only 缺陷，已用触摸兼容效果修复**（`subagent-chip-touch.ts`）：上游 `dsh-client-ui-subagent` 的 count 变体 trigger **没有 onClick**（bundle 里 `onClick: openTitle === void 0 ? void 0 : …`），开关全靠 root 的 onMouseEnter/onMouseLeave 定时器（enter 150ms 开、leave 120ms 关、互相 cancel）。触摸 tap 时 Chromium 按「模拟鼠标位置」（非 tap 点）合成配对 mouse enter/leave，产生三类症状：尾随 leave cancel 刚武装的开定时器→点了没反应；光标停在芯片上时零事件且无 onClick→点很多下没反应；外部点击关闭后 ~200ms 浏览器还原光标位置触发 `mouseenter@_root` → 菜单自弹回。修复仅对 touch/pen pointerType 生效：(1) pointerup 命中 count 变体 trigger（`[aria-haspopup="tree"][aria-expanded]:not([class*="_switcherTrigger"])`）时按 aria-expanded 派发合成 keydown——ArrowDown 开 / Escape 关，走组件自身 `onKeyDown(navigate)` 键盘路径（React 对非 trusted 合成冒泡事件同样响应）；(2) 每次触摸活动后 ~800ms 内在 document 捕获阶段吞掉射向 `[class*="ZKlsPq_root"]/[class*="ZKlsPq_menu"]` 子树的 trusted mouseover/out/enter/leave（不吞 click，菜单行不受影响）。`ZKlsPq_` 是 subagent 包哈希，升级后对账。同批修复：抽屉导航关闭加 pointerup 平行路径（pointerType=touch/pen 时与 click 路径互斥）——触摸选会话后行节点重渲染使迟到的合成 click 落空、抽屉不再自动关。**iOS WebKit 壳的硬约束（实测 iPhone Safari / Opera iOS 等）**：pointerup 同步 `toggleSidebar()` 会让抽屉在合成 click **之前**滑出，iOS 整体抑制/重定向该 click（「抽屉收了但会话不打开」）；自愈式代发 click 在纯 Chromium 可用，但 WebKit 壳把兼容 click 整体吞掉——凡与合成 click 竞速必然漏接，故行导航彻底不依赖事件顺序：未选中行 pointerup 只记 `lastTouchNavAt` 并 arm MutationObserver 观察 `aria-selected`（快照＝选中 treeitem 的 `[class*="_title"]` 文本；出现不同签名＝React 已完成导航才 `toggleSidebar()`，2000ms 无变化自动 disarm）；已选中行与新会话/taskboard/ssh 等非行目标仍在 pointerup 即关；document 捕获的 click 处理器在行 tap 后 500ms 内整体让位防双 toggle。不要改回「同步关抽屉」「延迟一档关」或「click 代发」：任何依赖浏览器合成 click 时序的方案在 iOS 壳上都不可靠。CDP 回归注意：盲点坐标可能误触「Session log」拉起 aria-modal 的 "Session download started" 模态框（宿主哈希 `_dialog_15u5s_22`），遮罩拦截一切点击且抽屉/芯片逻辑正确让位于 `[aria-modal]`——验证脚本每步必须先断言无 aria-modal，否则得到假阴性；持久复用的浏览器 profile 会累积这类污染，回归一律开全新 user-data-dir。

---

## `dsh-client-ui-subagent` 存在两代互斥的开关实现，触摸兼容层必须同时兼容

**`dsh-client-ui-subagent` 存在两代互斥的开关实现，触摸兼容层必须同时兼容**：`0.1.0-rc.6/rc.7/rc.8`（哈希 `h8S2Va_`）＝**onClick 代**——删掉 hover 定时器、trigger 带原生 `onClick: () => changeOpen(!open)`、菜单从 body portal 改回 root 内 `position:absolute` 子节点；`0.1.1-rc.1/rc.2`（哈希 `ZKlsPq_`）＝**hover 代**（上游已回滚，count 变体 `onClick === undefined`、hover 定时器与 `createPortal` 都回来了）。npm dist-tag `next` = 0.1.1-rc.2、`latest` = 0.0.1-rc.1（陈旧），所以两代都可能实装，判定看**served bundle 里有没有 onClick / hover 定时器**，别看版本号大小。onClick 代上芯片「点开一闪即退（闪退）」是双开关竞态——`subagent-chip-touch.ts` 的 pointerup（document 捕获，先于 click）仍按旧版逻辑派发合成 ArrowDown/Escape 走键盘路径开/关卡片——于是手机端一次 tap 触发**两次 toggle**：pointerup 的合成 keydown 先把菜单打开（`if (!open) changeOpen(true)`），紧随其后的原生 click 又命中 `onClick` 的 `changeOpen(!open)` 把刚打开的菜单关掉。净效果=菜单闪一帧就消失、芯片看似没反应（感知为「闪退」）。修复：pointerup 派发 keydown 后记录 `toggledTrigger`（1s 宽限窗），document 捕获阶段 click 监听器对同一 trigger 的同一次 tap 的 click 调 `stopPropagation()`——挡住容器级 React 委托（trigger 的 onClick 不再执行）；旧 hover-only 版本没有 onClick，吞 click 无副作用，两代上游行为一致（每次 tap 恰好一次 toggle）。身份比对确保菜单行/其它位置的 click 不受影响。`HOVER_SUBTREE_SELECTOR` 同时列 `ZKlsPq_root/_menu` 与 `h8S2Va_root/_menu`：hover 吞噬在 onClick 代是 no-op，click 吞噬在 hover 代是 no-op，两条防护并存即两代通吃。坑点：trigger 选择器无哈希（`[aria-haspopup="tree"][aria-expanded]`），所以 rc.6 下旧修复代码仍照常生效——「selector 还活着但上游语义已变」正是竞态来源；上游大改后须重读 served bundle 核对行为，不能只对哈希。

---

## 给 frame 加 `padding-top: env(safe-area-inset-top)` 必须同时写 `box-sizing: border-box`（实锤症状

**给 frame 加 `padding-top: env(safe-area-inset-top)` 必须同时写 `box-sizing: border-box`**（实锤症状：输入框被抬起、底部露空白、最后一条消息被压住——外层 document 在滚而非消息流）：官方 `pI_x6G_frame` 是 `height:100%` + 默认 `content-box`，安全区 padding 会**加在**满视口高度之外 → frame 高 = 视口 + inset（实测 844→891），document 本身出现恰好 inset 高的滚动量，粘在 scrollBody 底部的 composer seat 整体落到可视视口**之下** 47px。于是：手指上滑滑的是 document（不是消息流），输入框被抬起、下方露出空白条，最后一条消息被输入框压住；而宿主的 at-bottom 跟随只操作它自己的 scrollBody（`floorGap` 恒 0，逻辑无错），所以「跟随失效」是假象——真正错位的是外层文档。刘海为 0 的桌面浏览器/无 notch 设备复现不出（inset=0 时两种 box-sizing 等价），必须用 CDP 注入 `padding-top:47px` 模拟。修正：`layout.css.ts` 的 frame 规则加 `box-sizing: border-box !important`（padding 从 100% 高度里扣，frame 恰好一屏，`docScrollable` 归 0）。抽屉（`> :first-child`）不需要跟着改：它是 `position:absolute; inset:0`，按 frame 的 padding box 定位，本身不撑高文档。回归断言：inset=0/47 两种状态下 `documentElement.scrollHeight - clientHeight === 0` 且 `seat.getBoundingClientRect().bottom === innerHeight`；桌面 ≥1024px 无 marker、保持 content-box。

---

## 流式期插件每帧热点的性能契约

**流式期插件每帧热点的性能契约**：三个已落地优化——① stats-line 快路径：`statsAnchorAlive(el)`（纯判定，tests/stats-line-fastpath.test.ts）锚点仍在位（isConnected + [data-phase] 内 + composerStack 内）时 O(1) 返回；失位必须先摘旧标记再回落慢路径，scopes 仍须 `['*']`。② installed-list 观察者经 `core/raf-scheduler.ts`（createRafScheduler，零 import 可测）rAF 合并，flush 时重验 mq 防桌面误写，dispose 必须 cancel。③ 抽屉会话树 `content-visibility: auto`（misc.css.ts，`[data-mobile-nav="frame"] > :first-child [role="tree"]` + `contain-intrinsic-size: auto 600px`）——屏外挂载与流式期跳过树 layout/paint。真会话差分实测：抽屉树仅 15 行会话时该规则无可测收益（差异在噪声内），保留仅作为会话数增大后的渐进增强，无成本。arm-open 冻结主因＝宿主 React 互斥子树同步挂载（rail 79→drawer 389 节点，4x 节流下 308ms longtask / rAF 间隙 225ms），插件 CSS 只能消 layout/paint 份额，治本在宿主（挂载分帧或双子树常驻）。测量方法论：这版 chromium trace 无 RunTask 事件，用最大 FunctionCall 锚点 + 功能族归因；窗口求和会混入后台线程 GC 事件，主线程结论只看 biggestJs。

---

## 会话删除注入的菜单形状按宿主分代（0.1.5 真机实测，2026-09-13）

**会话删除注入的菜单形状按宿主分代（0.1.5 真机实测，2026-09-13）**：0.1.5 把会话行 ⋯ 菜单换成了共享菜单组件——`._list_1nxmc_8 > ._scrollable_1nxmc_22 > ._viewport_1nxmc_22 > ._itemWrap_1nxmc_92 > button._item_1nxmc_92[role="menuitem"]`，按钮直排文本（无子元素），仍恰 3 项 rename/fork/archive（上游无删除项）。rc.2 的 `_itemIcon`/`_itemLabel` span 模板在此代消失。**危害链**：`isSessionMenu` 只读 `[role="menuitem"] [class*="_itemLabel"]` → 0.1.5 返回空 → `labels.length===3` 恒假 → 菜单不被识别 → 整个删除注入**静默失效**（连克隆都不发生）；即便识别过了，`injectInto` 拿不到 label span → 克隆项顶着被克隆项的原文案（「重命名」）挂着危险色丢失。修复（session-menu.ts）：`itemLabel(item)` 辅助——先找 `[class*="_itemLabel"]`，找不到回落到按钮自身 `textContent`（svg 图标不贡献文本，rc.2 两代读数一致）；注入分支在无 label span 且 `button.firstElementChild === null` 时整按钮改文+染色，**有子元素却无 label span 的未知形状不猜文本**（不注入文案，避免盲改）。判定法（为什么当初静态推断错了）：我从 0.1.5 bundle 静态 grep 推出「`data-side` 消失/`data-sidebar-collapsed` 被官方占用必须改名」两个错误结论，读源码后发现——①插件 CSS 里根本没有 `[data-side="sidebar"]` 规则（浏览器审查清单的假设句，从未落地）；②`data-sidebar-collapsed` 从来就是官方属性、插件只读不写（`ctx.layout.toggleSidebar()` 由官方翻转属性，layout.css 把 `frame:not([data-sidebar-collapsed]) > :first-child` 当抽屉展开态）——官方占用≠冲突，是既有架构。教训：**改属性名/判定锚点前必须先 grep 谁写谁读**（setAttribute/removeAttribute 证据），不要只看 marker 契约清单；探针证实的 DOM 形状变化要落到源码不变量测试（tests/session-menu.test.ts）而不只是改注释。**2026-09-19 a2 对账备注**：前端共享菜单模块哈希换代 `1nxmc_→1g45v_`（a2 fe 实测 `_itemLabel_1g45v_182`）；本条记录的 0.1.5 代 `1nxmc_` 哈希已失效，但 session-menu.ts:139/308 的 `[class*="_itemLabel"]` 子串选择器不受影响，两代通用。

---

## 0.1.5 官方窄屏已是原生 overlay 抽屉，但插件不放权——抽屉与遮罩全代都归插件（z 契约实锤 + 2026-09-14 文档修正）

**0.1.5 官方窄屏 expanded 已是原生 overlay 抽屉，插件却继续用自己的抽屉和遮罩**：0.1.5 把窄屏侧栏重做成了原生 overlay——`pI_x6G_sidebarCol` 计算样式 `position:absolute; z-index:1100`（两态恒定），frame grid 变单轨 `390px`（内容不被挤压），collapsed＝52px 官方 rail 且 `pointer-events:none`、expanded＝321px 且 `pe:auto`，另有 `pI_x6G_handle`（276×8）拖宽把手。**官方自己把「抽屉负优化」修好了**，但 2026-09-13 用户拍板不放权：官方 expanded 只有 321px 且**没有任何全屏遮罩**（已实测：抽屉旁的内容仍然可点、可直接操作），用户判断这种「抽屉旁边还能点内容」的形态不可用 → 插件继续用自己的抽屉列（`z-index:1300`）与全屏 backdrop（`z-index:1250`），覆盖所有代际。代码侧的理由写在 `overlay-backdrop-fab.ts` 的 `drawerOpen()` 注释里（原文记录「the host's version measures 321px wide with z-index:1100 and, notably, NO full-screen backdrop at all … which is the behaviour the phone owner rejected as unusable」）。

**曾被压成 z-index:40 的实锤**：插件早期 col 规则写 `z-index:40!important`，把官方 1100 压到 40——抽屉**有 layout box、computed 全部正常，却既不绘制也不命中**（描边实验：删除插件 CSS 后红 outline 立刻画出；inline z 提到 999 仍不画，只有官方原生值才正常），而插件的全屏 backdrop（官方原生 expanded 没有全屏遮罩）成了唯一可见的暗层、点外关闭判定又因命中异常全落 frame——用户看到的「打开抽屉一片全黑 + 点哪都关」就是这三层叠加。**修复不是让位而是抬到 1300**：`layout.css` 把 col 钉死 `z-index:1300!important`（注释里写明与 `base.css` 的 1250 遮罩是契约），抽屉重新可见、遮罩恢复「点遮罩关」语义。

**文档修正（2026-09-14 两阶段审查发现）**：本档与 AGENTS.md 曾写成「代际让位」——声称 `layout.css` 的 col 规则/开态 transform/reduced-motion/drag-handles 用 `:root:not([data-mobile-nav-gen="native-drawer"])` 门控、`overlay-backdrop-fab` 该代不建 backdrop。**这三条全部不成立**：`git log -S':root:not([data-mobile-nav-gen' -- src/` 全历史零命中（该门控从未被写出来），`overlay-backdrop-fab.ts` 也从无代际分支（`drawerOpen()` 一路只读 `data-sidebar-collapsed`），实际行为是 1300 + 全代建 backdrop。`isNativeDrawerGeneration()` / `updateNativeDrawerGen()` 当时仍存在并每 flush 在 `<html>` 写 `data-mobile-nav-gen="native-drawer"`，但**没有任何 CSS/JS 读它**（`grep -rn data-mobile-nav-gen src/ lib/ scripts/ tests/` 只有写入方）——是死标记，**已于 2026-09-14 用户批准后整体删除**（两个函数 + `<html>` 属性写入 + dispose 清理 + `frame-marker` 每帧调用，源码零残留）。教训有两条：①**文档描述一个「机制」时必须 grep 出读方**——只凭 commit message 或写入方的注释就会写出从未落地的机制；②**过时的注释比没有注释更贵**——`phone-chrome.ts` 那句自称 "the stylesheet gates on it" 的 docstring 正是该函数存在的全部理由，还骗过了一轮审计（审计报告据此写成「源码 grep 0 命中」，实际 3 处命中）。

**代际检测仍必须用结构类名（col 类含 `sidebarCol`）＋ computed position，绝不能用 computed z-index**：检测跑在我们 CSS 还在场的时候，读到的 z 是我们自己压出来的值（当年是 40、现在是 1300），用 z 阈值检测会永久 false 形成死锁（2026-09-14 实测：z 阈值版探针 A1/A2 恒 FAIL）。手势层**零改动兼容**——手势 commit 本来就是 `ctx.layout.toggleSidebar()`（开=锁轴即 commit、关=inline 滑出落地后 commit），官方 absolute col 上 inline transform 照常工作；cdp-swipe-failures 16 场景实测 12 场景全过（composer 场景为探针脚本形状漂移，见 runbook）。主探针 7/9 与修复前同基线（mobile.open-control＝鲸鱼盖 toggle 的独立待决项）。升级对账点：`sidebarCol` 类子串（0.1.5 哈希 `pI_x6G_` 会变，升级后按 `docs/upstream/compat-contracts.json` 对账）。


---

## 0.1.5 窄屏分支压掉抽屉关态槽位 → 点击路径动画全丢（2026-09-17 实锤，第十二轮）

**症状**：点左上角 toggle 开抽屉、点右侧遮罩收抽屉**都没有动画**（连续 16 帧 computed transform 恒 `none`），而手势开关抽屉动画正常。

**根因（两条叠加）**：
1. **层叠**：0.1.5 窄屏分支（注入者 `@deepseek-ai/dsh-api-session-controller`，`@media (max-width: 768px)`）新增
   `[data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] { width:52px !important; transform:none; pointer-events:none; background:transparent !important; border:0 !important }`（并把 slot 子节点 `display:none !important`，只留 `[data-dsh-responsive-part="sidebar-toggle"]`）——**特异度 (0,3,0)**，比插件 `[data-mobile-nav="frame"] > :first-child`（(0,2,0)）高一档，于是插件的 `transform: translateX(-110%)` 与 `width: min(88vw,280px) !important` **一起落败**。实测关态 `transform:none / width:52px / rect [0,0,52,844] / pointer-events:none / background:transparent`，开态 `width:280px / transform:none`。
   于是开↔关**唯一实际变化的是 width（52↔280）**，而过渡属性是 `transform` → 没有可插值的量，点击路径硬跳。手势路径之所以幸存：手势层写的是 **inline** `transform !important`（inline important 胜过作者 important）。
2. **翻态撕视觉**：宿主在 marker 翻转瞬间就把 pane 变透明、去边框、内容 `display:none`。所以只修 (1) 只能救「开」方向；关闭方向必须**先动画、落地才翻**（第八轮晚提交已解决同构问题）。

**修复（三处，互相独立）**：
- `layout.css.ts` 以**同特异度**重申关态槽位：`[data-mobile-nav="frame"][data-sidebar-collapsed] > :first-child { width: min(88vw, 280px) !important; transform: translateX(-110%) !important }`（关态回到 `[-308,280]`，right=-28）。
- `sidebar-swipe.ts` 导出 `closeDrawerAnimated(ctx)`：复用 `commitWithAnimation`（280ms 滑到 `±110%`、落地 `finishPendingCommit` 才翻 marker、写 cooldown 350ms、marker 守卫防盲 toggle）；`prefers-reduced-motion: reduce` 或抽屉已关时返回 false。
- `phone-chrome.ts` 的 `installOverlayInteractions` 把唯一的 `toggleSidebar` 本地别名改为 `if (!closeDrawerAnimated(ctx)) ctx.layout.toggleSidebar()` → 六个点击关闭入口（backdrop tap / Escape / 非行导航 tap / 已选中行 tap / `armNav` 观察者 / `closeOnNavigation` 回退）全部先动画；开方向保持普通 toggle。

**教训（可复用）**：
- **宿主升级时「插件规则被更特异度规则压掉」是静默的**，症状不是布局错乱而是「两个状态只差一个不在 transition 列表里的属性」→ 动画静默消失。改 CSS 状态机后必须逐帧采样确认中间帧存在，只看终态计算值会漏。
- **探针断言「离屏」不够**：52px 透明壳同样「离屏」（`pointer-events:none`、`elementFromPoint` 命中会话内容）。必须断言**设计槽位数学**（`rect.left <= -rect.width`）。
- 探针里插值代码谨防 **ASI 陷阱**：`...getComputedStyle(x).transform` 换行接 `(() => {...})()` 会被解析成 `transform(...)` 调用（报错 `getComputedStyle(...).transform is not a function`），插值表达式前加 `void` 或分号。

**回归门**：`scripts/probes/drawer-click-animation-probe.mjs`（5 场景：关态槽位几何 / toggle 开 16 帧采样 / backdrop 关 / Escape 关 / 桌面零命中）。注意「点 toggle 开」是可达路径，而**抽屉开时点 toggle 不可达**（抽屉盖住它，且第三方 dismiss shim 吞 frame 内、抽屉外的点击）——该场景用 Escape 验证同一收口。

---

## 抽屉里的导航项必须在 click 落地后才关抽屉（2026-09-13「点新会话只收回抽屉」根因）

**抽屉里的非会话行导航项必须在浏览器合成的 click 落地之后才关抽屉，pointerup 关闭会把 click 一起取消**：`installOverlayInteractions` 原来对非 `[role="treeitem"]` 的导航目标（`[class*="newSession"]` / taskboard / ssh / search 行）在 document 捕获 `pointerup` 里直接 `toggleSidebar()`。触摸序列是 pointerdown → pointerup →（浏览器合成）click，而 click 派发给**派发时刻触摸点下的元素**：pointerup 就把抽屉收起来（collapsed 态整列平移出屏）后，该点已不属于按钮，Chrome **根本不派发 click**——CDP 实测 trace `pointerdown@open>pointerup@closed`，此后无 click（鼠标点击则 `...>click@closed`），宿主 `onClick`（`startSession()`）从不执行。用户感知即「抽屉里点新会话没反应、抽屉只是收回去了」。会话行（treeitem）早在 #32 就绕开了同一竞态（pointerup 只 arm「选中标题变化」observer），非行目标是同根因的漏网分支。修复＝删掉该分支的 `toggleSidebar()`，改由既有的 document 捕获 click 处理器收抽屉：click 是**已经派发给按钮之后**才收抽屉的，事件路径在派发时已固定，React 的委托监听照样收到该 click（A/B 三态：鼠标点击、触摸点击、「只摘掉这一个 pointerup 监听」的触摸点击都能建会话，trace `pointerdown@open>pointerup@open>click@closed`；仅当前代码的触摸路径是死路）。判定探针：`scripts/probes/drawer-new-session-probe.mjs`（5 断言：会话已激活 / 抽屉打开 / 按钮可见 / 点后切到新会话 id / 抽屉收起）。通用教训：**任何在 pointerup 里收起容器或改动布局的写法，都要先问「这一次手势的 click 还没派发吧」**。

---

## Files 面板（宿主 ui-sidebar-right）的顶行压在手机状态栏下（2026-09-14 修复）

**现象**：手机上打开文件列表（右栏 Files 面板）后，面板顶部那一行——tab 标签、`+`（New tab）、Split、退出全屏——被状态栏压住。**机制**：这个面板是宿主自己的全屏 fixed sheet，`[data-sidebar-right-panel=fullscreen]` 的计算样式是 `position: fixed; inset: 0`（z-index 40，背景 `--dsw-alias-bg-base`），而宿主 CSS 里**没有任何 safe-area 处理**（对 `dsh-web-frontend/dist/assets/*.css` grep `safe-area-inset` 零命中）。插件既有的 safe-area 体系是给 frame 加 `padding-top: env(safe-area-inset-top)`（layout.css），但 fixed 元素的包含块是**视口**，不继承 frame 的内边距——面板是唯一漏网的固定全屏层，于是它 y=0…38 的顶行正好落在手机状态栏（实测 24–48px）底下。**修复**：在移动分支给**全屏形态**的面板本体吃 inset——`@media (max-width: 1023px) and (pointer: coarse)` 内加 `[data-sidebar-right-panel="fullscreen"] { padding-top: env(safe-area-inset-top, 0px) !important }`（形态限定不可省，理由见下节）。两个前提缺一不可：①面板自绘 `--dsw-alias-bg-base` 背景（实测 `rgb(255, 255, 255)`），状态栏那一条不露底、没有接缝；②面板是 border-box，padding 只把内容下推，面板本身仍铺满视口。**几何取证**（390×844 + touch emulation，CDP 读 `getBoundingClientRect` 取整；headless 的 `env(safe-area-inset-top)` 恒为 0，inset 用同值 inline `padding-top: 47px !important` 模拟）：inset=0 时面板 [0,0,390,844]、strip y=0、tab 标签 y=15、`+` y=10、Split y=10（右缘 348）、退出全屏 y=10（右缘 384）、paneBody [0,38,390,806]；inset=47 时面板仍 [0,0,390,844]、strip y=47、标签 y=62、`+` y=57、Split 与退出全屏 y=57（右缘仍是 348 / 384）、paneBody [0,85,390,759]。即整行**按 inset 精确下移**（0→47），右侧那组按钮依旧钉在右缘（退出全屏右缘 = 390−6），行内相对对齐不变（strip 与退出全屏的 y 差 −10 两态一致），面板 body 不溢出视口。**为什么不是给 frame 加内边距**：面板是 fixed 全屏层，frame 的内边距与它无关；把面板从 fixed 拉回文档流会与宿主的 fullscreen 形态打架，宿主升级即碎——只加面板自身一条 padding，最小且可逆。**验证**：回归锚点 `scripts/probes/files-panel-safe-area-probe.mjs`（21 断言：规则在场且在移动分支、**规则选择器确实命中活面板本体**、宿主契约是 `position:fixed; inset:0` 全屏且自绘背景、模拟 inset 后整行下移而右缘不动、paneBody 不溢出、停靠形态不被命中），宿主改名或改形态即翻红。桌面零影响：规则在移动 media 块内，1280×720 `pointer: fine` 实测 `matchMedia('(max-width: 1023px) and (pointer: coarse)').matches === false`；Playwright 设备仿真（isMobile + hasTouch、390×844、DPR 2）独立复跑同一组几何断言全过。

### 形态限定：只给 fullscreen 吃 inset，停靠形态必须排除（2026-09-14 补测）

`data-sidebar-right-panel` 有两种值，一种才是全屏 sheet：

| 视口 | form | position | 几何 | 是否要 inset |
|---|---|---|---|---|
| 390×844（手机，pointer coarse） | `fullscreen` | `fixed; inset:0` | `[0,0,390,844]` | **要**——包含块是视口，顶行 y=0 落在状态栏下 |
| 820×1180（平板，pointer coarse） | `push` | `absolute; right-anchored 365px` | `[455,0,365,1180]` | **不要**——包含块是 frame 的 padding box，已在状态栏下方 |

首版规则写成裸 `[data-sidebar-right-panel]`，理由是「宿主只是换 position/inset，问题是同一个」——实测被推翻：停靠形态是 frame 内的绝对定位面板，frame 的 safe-area padding 已经作用于它的包含块，再吃一次 inset 会把顶行顶下**两倍**状态栏高度。现规则带 `="fullscreen"` 形态限定，探针场景 5 用 820×1180 断言：规则选择器不命中停靠面板、其 computed `padding-top` 为 0、且面板确实在 frame 子树内（`frame.contains(panel)`）。

代价与对账点：形态值被宿主改名（或新增第三种形态）时，修复会在**没有** inset 的形态上静默失效——所以场景 1 的断言把选择器文本钉死为 `[data-sidebar-right-panel="fullscreen"]`（放宽或改名都会翻红），场景 2 另断宿主手机态 form 仍为 `fullscreen`。

## 抽屉 ⇄ 文件面板：一套「看似两个抽屉、实则三套机制」的共存契约（2026-09-17 实测，五轮活页面）

用户报告「抽屉和打开文件管理打架」，实测发现冲突面有四个、机制有三层，别当成一个问题修：

1. **z 序**：宿主的文件面板 `[data-sidebar-right-panel]` 手机档是 `P3OORG_panel[data-sidebar-right-panel=fullscreen]`（`position:fixed; inset:0`，**z-index 40**），而且**在 frame 内部**（`frame > … > pI_x6G_rightbarCol > panel`）；插件抽屉列 1300、backdrop 1250 ⇒ 抽屉永远压面板；插件顶栏两个角按钮 `z-index:2`、header `z-index:auto` ⇒ 面板画在顶栏之上（`base.css` 的 55/56/57 是删除确认卡、`compat` 的 55/56 是 aionui 两列，都不在 header 上，别拿它们当解释）。
2. **第三方 shim 吞点击**：`@linxin666/dsh-web-all` 的 `installMobileSidebarDismiss` 在 `max-width: 768px` 且 frame 无 `data-sidebar-collapsed`（＝左栏/抽屉开着）时，对**不在 `[data-pane="sidebar"]` 子树内**的点击一律 `preventDefault + stopPropagation` 并顺手点宿主自己的 `sidebar-toggle`——**程序化 `.click()` 一样被吞**。实锤：抽屉开着时点 `[data-sidebar-right-expand]`，按钮自身捕获监听 `listenerFired: 0`、面板 `data-sidebar-right-open` 零变化；抽屉关着时同一点击 90ms 后置 `true`。
3. **宿主自身的门槛**：即使绕过 shim，左栏开着时宿主也不接受右栏展开。实测「先收抽屉 → 延迟点展开」矩阵：**0ms ✗ / 120ms ✗ / 320ms ✓ / 600ms ✓**（关抽屉是晚提交，marker 在 280ms 动画落地才翻，shim 守卫与宿主状态都到那时才放开）。

结论（用户 2026-09-17 拍板）：抽屉底部的文件入口**删除**，不给它加时序补丁；共存规则定为「抽屉压面板、打开抽屉不销毁也不关闭面板、收掉抽屉即回到面板、面板开着时顶栏角按钮不可达＝接受」。契约全文与已知不修清单见 `docs/specs/2026-09-17-sidebar-files-coexistence-design.md`；锚点 `scripts/probes/files-swipe-probe.mjs` 场景 9/10/11（footer 无文件入口 + 抽屉压在面板上仍命中抽屉、面板存活 + 收抽屉后面板仍在）。

## 「打开文件列表」按钮没有钉在右上角（2026-09-14 真机反馈）

原话：「打开文件列表的按钮……没有进行固定，它仍然受到状态栏自适应影响」。**主语是按钮，不是文件列表面板**——同一天的 safe-area 修复修的是面板顶行，两者不是一回事。

### 机制

宿主把 `conversation.session.header.actions` slot 挂在 `wSkVaW_titleCluster` 里，而 cluster 自带 `padding-right: 44px`：

| 元素 | 390×844 实测 | 说明 |
|---|---|---|
| `wSkVaW_titleCluster` | `[40,16,332,28]`，`display:flex`，`padding-right:44px` | 44px 是给右侧工具座位的预留 |
| `wSkVaW_headerUtilities` | `[374,8,0,44]`，宽 **0** | 手机端该座位恒空（内部子元素被插件隐藏） |
| `wSkVaW_headerActions` | `[212,16,116,28]`，`justify-content:flex-end` | 我们的按钮是它最右侧的流式项 |
| `[data-mobile-nav="files"]` 修前 | `[300,16,28,28]` | 右缘 328，离视口右缘还差 **62px** |
| `[data-mobile-nav="toggle"]` | `[8,12,28,28]`（绝对定位） | 左侧那个早就钉死了 |

结论：**流式布局 + 宿主预留的 44px，按钮永远够不到右边缘**——这就是「没有固定」。

### 修复

移动分支里把按钮改成绝对定位，与左侧按钮对称：

```css
[data-mobile-nav="files"] {
  position: absolute !important;
  right: 8px !important;
  left: auto !important;
  top: 12px !important;
  z-index: 2 !important;
}
```

修后实测：`[354,12,28,28]`（右缘 382 = 390−8，与左按钮同为 top 12）；`elementFromPoint(中心)` 命中按钮本体；utilities 座位宽 0 → 无重叠；标题道回收 28px（crumbs 170→200）。

### 竖向：它仍然随状态栏下移（预期）

插 47px inset 后两个角按钮同时从 top 12 → 59（`top: 12px` 的包含块随包含块体系一起走：`wSkVaW_root` → 本轮起是 `header`，两者都在被 padding 下推的 frame 内容里，实测 12 → 59 不变）。**这是必须的**：不让它下移就会被状态栏压住。所以「不受状态栏影响」只能理解为「水平方向不要漂、贴住右上角」，不能理解为「纵向不动」。

### 边界

- hero 态（无会话）该 slot 不渲染（实测 `[data-mobile-nav="files"]` absent），不存在「钉到别的容器」的风险；hero 的 Files 入口在抽屉 footer（`data-mobile-nav="explorer"`）。**2026-09-18 更正：该入口已于 2026-09-17 删除，hero 态不再有按钮入口，文件面板入口＝右缘左滑**（`src/client/components/MobileDrawerFooter.tsx` 现只渲染 session-log；契约 `docs/specs/2026-09-17-sidebar-files-coexistence-design.md`）。
- utilities 座位自 2026-09-14 起被插件限高 30px（它只顶行高，不画东西）；哪天它真的渲染出控件，我们的按钮会与它重叠 8px——届时按锚点提示改 `right` 值或让位（锚点断言里已记录该座位的坐标与宽度）。
- 装置层验证：`scripts/probes/header-files-pin-probe.mjs`（12 断言）；真机读数走 `?mobile-nav-debug=1` 的调试上报（见 Testing & QA）。

---

## 会话 header：行高、座位线与弹层包含块（2026-09-14 真机三项反馈）

原话：「模式几个字都被压缩没了，仅留模式选择那个图案」「后台运行命令元素展开无 ui」「顶部状态栏加上下边的对话轨迹一栏合一起空隙非常大」＋追加「文字行总体在上边，感觉十分不协调」。三件事同域，一次收口。

### ① 「后台任务」芯片展开无 UI ＝ 弹层被三重困住

`dsh-client-ui-jobs` 的菜单是 `position:absolute; top:calc(100% + 5px)`，挂在它自己的 `.QsffPG_root{position:relative}` 上——一个 **28px 高的流式盒**。三重问题叠加：

| 层 | 事实 | 后果 |
|---|---|---|
| 我们 | `[class*="_root"]…{overflow:hidden}` | 菜单被裁在芯片盒内 |
| 宿主 | `[data-dsh-responsive-part="session-title-cluster"]{overflow:hidden}` | 从上层再裁一次 |
| 定位 | 我们给 `_menu` 的 `right:8px` 相对 156px 的 chip root 解析 | 菜单落在 `[-16,49,336,40]`（x 为负、屏外） |

修前实测：芯片 `aria-expanded=true`，菜单 rect `[-16,49,336,40]`，`elementFromPoint` 在菜单中心命中的是**不可见的 view tabs 行**——「有 DOM、没 UI」。

**修复的两半都必需**（A/B 实锤）：

```css
[data-mobile-nav="frame"] [data-phase] header { position: relative !important; }
[data-mobile-nav="frame"] [data-phase] header [class*="_headerActions"] [class*="_root"]:not([class*="_switcherRoot"]):has(> button[class*="_trigger"]) { position: static !important; }
```

- 只加 `position:static`（header 仍 static）＝包含块外移到 frame，菜单落到 `x=8 y=849`，比 844px 视口还低（2026-09-13 那次 A/B 只做了这一半，于是留下「不许动 position」的错误结论，本次 A/B 推翻）。
- 两半齐上：菜单 `[46,77,336,73]`，落在 header 下缘（`top:calc(100%+5px)` 的 100% 此时是 header 的 padding box），行可命中（`elementFromPoint` 命中 `QsffPG_row`），点外部仍由宿主 `useDismissOnOutsidePointer` 收起（menus 1→0）。
- 作用域限定 `_headerActions`：crumbs 里的 lineage root 不命中，它的菜单本来就是 `position:fixed`（不受祖先裁切影响），行为不变。

### ② 空隙很大 ＝ 两行各被顶到 44px

宿主手机版 `[data-dsh-responsive-part="conversation-header"]{grid-template-rows:minmax(32px,auto) minmax(44px,auto)}` + `[role="tab"]{min-height:44px}`。两行的实际高度：

| 行 | 名义 | 被谁顶上去 | 内容 |
|---|---|---|---|
| 标题行 | `minmax(32px,auto)` | utilities 座位（44×44 的 flex 单元，手机端恒空，里面只有我们隐藏的 More-actions 按钮） | 28px chips |
| tab 行 | `minmax(44px,auto)` | `[role=tab]{min-height:44px}` | 13px 标签（行高 16 + padding-bottom 9 = 25px） |

97px = 8 padding + 44 + 44 + 1 border，其中只有 36px 是画出来的内容。压法（`:has(> *)` 门控，见 ④）：

```css
header:has(> *){ min-height:0!important; grid-template-rows:minmax(36px,auto) minmax(32px,auto)!important }
header [class*="wSkVaW_headerUtilities"]{ height:30px!important; min-height:0!important }
header [role="tab"]{ min-height:32px!important }
header [class*="wSkVaW_titleCluster"]{ padding-right:26px!important }
```

⇒ 77px，其余几何零退化（title/mode/chips/chevron/两角按钮全部实测不变；tab strip 的 #41 契约不变：`overflow-x:auto`、gap 16、labels 完整、`touch-action:pan-x`）。最后那条把 title cluster 给空 utilities 座位预留的 44px 裁到 26px（我们的 Files 按钮只画 28px 带），标题道再回收 18px（390px 带 lineage chip 实测 crumb 64→82px），仍与按钮留 8px 净空。

### ③ 座位线：文字行必须与两角按钮共线（用户追加反馈）

第一版顺手把 `padding-top` 从 8 收到 4（省 4px）——用户立刻报「文字行总体在上边，感觉十分不协调」。数字对得上：

| 状态 | 标题行元素中心 | toggle/files 中心 | 差 |
|---|---|---|---|
| padding-top 4 | 22（crumb/mode/lineage/jobs 全是 22） | 26 | 文字高 4px |
| padding-top 8（最终） | **26** | 26 | **共线** |

两个角按钮是 `top:12px` + 28px ⇒ 中心 26。标题行内容 28px 要在 36px 行里居中到 26，行顶必须落在 8（宿主自己的 padding 就是这个值）。**结论：行高由 rows 承担，对齐不许动 padding**；`top:12` 这条座位线因此保持不变。

插 47px inset 的复验：header/toggle/files/文字行整体下移 47（12→59、中心 26→73）且仍共线，弹层随之下移到 `y=128` 仍在视口内，`scrollHeight == clientHeight == 844`（无溢出）。

### ④ `:has(> *)` 门控：hero 的空 header 不许被压

hero 态存在一个**空的、宿主隐藏但仍在文档流**的 session header：`wSkVaW_header wSkVaW_headerHidden`，0 个元素子节点，却占 85px（rows 32/44），composer 因此被居中下推 42px。压行规则若命中它，hero 布局会整体上移。`:has(> *)`（有元素子节点才压缩）在**同一页面 A/B** 下验证：hero composer rect 加不加规则逐字节相同（当时 85px header 在场：`[0,349,388,231]`；重建后 hero 实测该 header 未渲染，composer `[0,307,388,231]`——两种状态都不受影响）。**2026-09-19 a2 对账备注**：0.1.6-alpha.2 删除 `headerHidden` 类（ConversationSession.tsx 改用 `headerBlank`，且 blank header 保留导航行不再 display:none）——layout.css.ts:668 的 (0,3,1) 重申规则与 hero-composer-clip-probe 5b/6b 断言在 a2 双死，本条灰线问题在 a2 的形态（36px 空带是否复发）需电池定级，处置见 audit doc §10.2-4。

### ⑤ 拥挤让位优先级反转（用户拍板）

模式名让位规则（`max-width:18px; min-width:18px`）原为「模式文字是手机端最冗余的一项」。实际上它是**手机端唯一的模式切换入口**，而它的 22vw 上限（390px → 85.8px）本来就装不下 121px 的模式名——「压缩」在执行前就已经是「抹掉」。反转后：

| 项 | 处置 |
|---|---|
| 模式名 | 上限 `min(38vw,220px)`（320px 起完整），保留图标 + 文字 |
| 会话标题 | 保留文字，超宽走宿主省略号（crumbs `min-width:30%` 兜底） |
| 子代理计数 chip | 保留全文（pin + cap，不收缩） |
| 后台任务 chip `_count` | **让位**：≤440px 直接 `display:none`（dot/chevron/tap 保留，`aria-label` 仍报 "N background jobs"）；≤559px 再加「lineage 同时在场」条件 |

`display:none` 而非截成数字：两位数任务（"10 background jobs"）截宽后会显示成 "1"，是**错误的计数**。题外：chip 消失只发生在 `jobs.length===0`，实测杀掉任务后 chip 整个消失，settled 态不常驻。

### ⑥ 这一轮实测矩阵（真实 bundle，非注入）

| 场景 | 结果 |
|---|---|
| 390px 会话（lineage + jobs chip） | header 77 / rows 36,32 / 六个元素中心全 26 / 模式 "Creator mode" 103px 完整 / crumb 80 / gap(actions→files) 8px / 两角按钮命中本体 |
| 弹层（触摸 tap） | 开 `[46,81,336,73]`、行命中、外点关；谱系 chip 菜单 `[38,41,336,58]` 同为固定定位、行命中 |
| 320 / 360 / 430 / 559 / 768 | header 77 恒定；模式名 360 起完整；320 走 ≤359 兜底（模式仅图标）；768 后台标签恢复全文 |
| 900×700 鼠标 | `MOBILE_QUERY=false`、frame 缺省、rows `none`（桌面布局），规则零作用 |
| hero | 空 header 不被压（见 ④） |
| inset 47 | 见 ③ |

装置层回归：`scripts/probes/header-files-pin-probe.mjs` 12/12（含 inset 场景）、主探针 `pnpm smoke:cdp` 13 pass / 0 fail / `page.errors 0`。

## 抽屉里的行菜单（⋯）在手机上不可达：长按没反应 + 弹出后压在抽屉底下（2026-09-14 真机两连）

用户原话：「抽屉内的极多元素点击之后都会导致抽屉关闭…长按一个会话，不应该有三个点吗？点击三个点，弹出的弹窗会被抽屉压在底下」。实测（390×844、headless Chromium + touch、0.1.5-rc.1 + `@linxin666/dsh-web-all` 0.3.20）拆出**四个独立机制**，前两个是「点不到三点」，后两个是「点到了也看不到/点不动」。

### ① 三点被第三方 shim 关掉（长按前）

`dsh-web-all` 的 `installMobileSidebarDismiss(frame)`（`lib/client.js` 约 55366 行）在 frame 上挂**捕获** click，`(max-width: 768px)` 时两条分支都靠 `frame.querySelector('[data-dsh-responsive-part="sidebar-toggle"]')` 拿宿主 logo 行的开关，再 `.click()` 收抽屉：

- 抽屉开着 + 点击目标不在 `[data-pane="sidebar"]` 内 → `preventDefault(); stopPropagation(); toggle?.click()`；
- 否则点击目标命中 `[data-dsh-part="sidebar-entry"], [role="treeitem"]` → rAF 里再 `toggle?.click()`。

**它的兄弟实现 `@linxin666/dsh-remote-web-ui/src/client/mobile-adapt.ts` 在同一分支里有 `_rowActions` 豁免，这一份没有**，于是点会话行右侧的 ⋯（`_rowActions` 内、行又是 `[role="treeitem"]`）被当成「点了会话行」。实测 trace：可信 pointerdown/pointerup/click 落在 ⋯ 上（抽屉仍开）→ **13 ms 后一个 UNTRUSTED `.click()` 打到 `BUTTON.hHd-Xa_iconButton.hHd-Xa_toggle`**（堆栈落在 concatenated bundle 的 shim rAF 行）→ `data-sidebar-collapsed` 置位。

**修复＝中立化它的把手，而不是抢它的行为**：插件注入一个惰性 `<span data-mobile-nav="dismiss-shadow" data-dsh-responsive-part="sidebar-toggle">`，以 inline `display:none !important` 隐藏（挡它的 `display:inline-flex !important` 折叠 rail 规则），插在**sidebar pane 的第一个子节点**（插 logo 行会连品牌一起藏掉；`pane.firstElementChild === shadow` + 同父即认为已就位，满足全树 reconciler 的幂等要求）。它的 `querySelector` 先命中影子 → 两条分支都变成 no-op。抽屉的关闭权回到插件：行内导航走「选中标题变化」observer / pointerup，遮罩走 document 捕获 click，Escape 不变。

### ② 触摸永远看不到三点（长按前）

宿主行操作是 `display: none` 直到 `:hover` 或 `menuOpen`（桌面悬停），触摸设备两者都到不了；第三方那份「长按 500 ms 显示 `_rowActions` 并点开」的实现被它自己的 `if (!active) return` 门控（本 profile `body.className === ''`、无 `#dshRemoteWhale` → 未激活）。实测长按后 `menus: 0`、`actionsDisplay: none`，抬手反而触发导航并关抽屉。

**修复＝插件自己实现长按**（`phone-chrome.ts`，`pointerType` 限 touch/pen、移动 > 10px 或 `isStrokeLocked()` 取消）：500 ms 后若页面无 `[role="menu"]` 就点该行 `_rowActions` 里的 ⋯ → 宿主自己的菜单；抬手时武装 800 ms 的合成 click 吞噬（按的是那一行才吞），并给宿主菜单 1200 ms 的 `pointerleave` 守卫——**抬手本身就会给菜单锚点发一次 pointerleave**，而宿主菜单 `closeOnPointerLeave`。

### ③ 菜单被压在抽屉底下（用户报告的「压在底下」）

宿主菜单 portal 到 `<body>` 且是 `position: fixed; z-index: 1100`，而抽屉列 1300、插件遮罩 1250。实测菜单 rect `[160,454,218,168]`，`elementFromPoint` 在**中心**与**两端**取到的都是抽屉内元素（`DIV.bhn1Oq_list`、`SPAN.YDXeBa_title`）——整块菜单既看不到也点不到（右侧露在抽屉外的部分被 1250 的遮罩盖住）。宿主自己的设置弹窗没这个问题，因为它渲染在 sidebar pane 内部，天然继承 1300 带。

**修复＝移动分支一条 body 级层带**（`base.css.ts`）：`body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed])) [role="menu"] { z-index: 1400 !important }`（遮罩在时抽屉外点不动，所以「抽屉开着才会有菜单」这条门控是充分的；桌面与关抽屉态零影响）。

### ④ 同一个 shim 还会吞掉「frame 内、抽屉外」的一切点击

它的第一分支在 `preventDefault/stopPropagation` 之后才去点那个（已被我们变 no-op 的）开关，但**吞事件这一步还在**：插件自己的删除确认卡原先 `frame.appendChild`，于是卡片上的「取消/删除」永远收不到 click——实测真触摸点「取消」后卡片仍在（只能 Escape 关），且卡片左侧 272px（x<280）命中的是抽屉自己的按钮。

**修复＝确认卡/错误卡改挂 `<body>`**（`session-menu.ts`）：整张卡脱离 frame，shim 的捕获监听根本看不到它（它自己的菜单也是 portal 到 body 才一直好用的），再配 1400/1401 层带（`delete-dialog-backdrop` / `delete-dialog`），卡片落在抽屉之上、整宽可点。

### 回归锚点与遗留

`scripts/probes/drawer-row-actions-probe.mjs`（13 断言）：长按出菜单（4 项含注入的「删除会话」）、**抬手后菜单与抽屉都在**、**菜单中心/两端的命中测试都落在菜单内**（4b——DOM-only 断言曾经在「菜单渲染了但被盖住」时全绿）、⋯ 点击只切菜单不关抽屉、确认卡 body 挂载 + 抽屉带上命中 + 真触摸「取消」可关、行点击仍导航并关抽屉、遮罩点击仍关抽屉。

**遗留**：workspace（项目）行的 ⋯ 同样是 `:hover` 独占，本次只按用户报告修了会话行；项目行的长按是同一处的一行扩展，但项目菜单含「删除 workspace」，留给用户拍板。**上游建议**：给 `dsh-web-all` 的 `installMobileSidebarDismiss` 补上兄弟实现已有的 `_rowActions` 豁免，并把「点击吞掉」限制在真正需要收抽屉的目标上。

## hero 空态输入框被压到宿主下限之下（2026-09-14 真机：滚动条 + 首行被裁）

### ① 症状与实测

新会话页（hero）的输入框「上下被压缩」并出现滚动条。390×844、touch、全新 profile、宿主 `@deepseek-ai/dsh` 0.1.5-rc.1、插件 bundle `d88fcfcdfb85` 实测：

| 量 | 修前 | 修后 |
|---|---|---|
| 卡片 rect | `[16,464,356,84]` | `[16,451.9,356,108]` |
| `_scroll`（`overflow-y:auto`）clientHeight / scrollHeight | 28 / 52 | 52 / 52 |
| `_scroll` scrollTop | 24（自动聚焦把首行滚出去） | 0 |
| 输入框高度 / 自身计算 min-height | 52 / 52px | 52 / 52px |
| 提示 `[data-composer-placeholder]` | 折两行 48px，只露下面 28px | 完整可见 |

输入框 rect `427.4..479.4` 落在 `_scroll` 可视带 `427.4..455.4` 之外 24px——「被压缩」的真身是**滚动窗口比内容矮**。

### ② 根因：min-height 赢过外层 height，规则只压小了窗口

插件移动分支 hero 块里有两条同族规则（`src/client/styles/misc.css.ts`）：①textarea 代（2026-09-05 前）`[data-phase="hero"] textarea:placeholder-shown{height:28px!important}` + `:has(textarea:placeholder-shown)` 命中 `_scroll`/`_grow` 的 `height:28px!important`；②Lexical 代镜像（commit `e1ea61d`，2026-09-05「fork port」）把同一条 collapse 复制到 `:has([data-composer-placeholder])` 形态上。

宿主 0.1.2-rc.1 起换 Lexical 输入面（`[data-composer-input]`），并给 hero 输入框钉了自己的下限：`.uV2eYG_hero .uV2eYG_input { min-height: 52px }`（0.1.2-rc.1 与 0.1.5-rc.2 包内 CSS 都实测存在；hero 提示文案会折两行，宿主刻意留两行高）。**下限长在输入框自己身上，外层的 `height:28px !important` 只压得动容器**——`_scroll` 于是 28px 高、装着 52px 内容，`overflow-y:auto` 出滚动条；输入框自动聚焦又把 `scrollTop` 推到 24，可视带里既看不到提示首行也看不到输入首行。

活页面取证：遍历 `document.styleSheets` 中 `ownerNode.dataset.plugin === 'dsh-web-mobile'` 的规则、按元素 `matches(selectorText)` 过滤——命中 composer `_scroll`/`_grow`/`[data-composer-input]` 的插件规则**只有这两条**，症状与插件规则的因果关系因此闭合（不是宿主自身的回归）。

### ③ 为什么旧代规则是对的、新代镜像却不成立

`@deepseek-ai/dsh-client-ui-conversation` 0.1.1-rc.2 的包内 CSS：`.uV2eYG_input{...width:100%;height:100%;color:#0000;-webkit-text-fill-color:transparent;...}` 且**没有** hero min-height；同版 `data-composer-placeholder` / `data-composer-input` 字符串**零命中**（直接读包内 JS 验证）。即：旧代输入框是铺在 `_scroll`/`_grow` 之上的透明 `height:100%` 层，容器压到 28px 它就跟着 28px——collapse 真的生效，用户当时看到的就是一行 hero。换代之后插件的镜像规则第一次真正落地，而下限把「压小」变成了「裁剪」。合成 fixture 里没有宿主下限，这正是该改动当年 11 断言全绿却漏网的原因。教训：**镜像到新一代的「压小」规则，必须对账宿主是否给该元素钉了自己的下限**。

### ④ 修复

删除 Lexical 代的两条镜像规则（textarea 代保留——那代无下限、规则有效，且随宿主换代自然惰性），原地留注释说明「为何不镜像」。hero 输入框回到宿主自己的两行高度：卡片 84→108px、`_scroll` 52/52 无溢出、`scrollTop` 0、提示与输入完整可见。修前先在活页面做过反事实（追加同特异度 `height:auto!important` 后测量 `_scroll` 52 == scrollHeight 52、`overflow:false`、`scrollTop:0`），确认几何因果再动源码。

**同族检修清单**：任何「把宿主某元素压小」的规则，先确认该元素有没有自己的 `min-height` / `size` 下限；有下限时只能改尺寸以外的属性（padding/gap/字号），否则症状会从「变矮」变成「被裁 + 滚动条」。

### ⑤ 回归锚点

`scripts/probes/hero-composer-clip-probe.mjs`（12 断言，builtin-only 原生 CDP，支持 `DSH_PROBE_COOKIE`）。手机场景（390×844 + touch）：hero 卡片在场、移动分支 armed、`_scroll` 无溢出（clientHeight ≥ scrollHeight）、未滚动（scrollTop 0）、输入框完整落在可视带内、输入框高度不低于自身计算 min-height、提示完整可见、**匹配该链的插件规则没有一条声明 height**（这条直接钉住「不许再镜像 collapse」）；桌面场景（1280×720、关 touch）：同链条零插件规则命中、无溢出。修前 RED：`2.scroll-container-not-overflowing`（28/52）、`3.input-fully-visible`（越界 24px）、`5.no-plugin-rule-pins-the-chain`（点出两条规则）失败；修后 12/12 过。

## 探针运行环境：cookie TTL、headless chromium 与 Playwright MCP（2026-09-14 实测定稿）

**① `dsh-auth-*` cookie TTL 24h**：打需要认证的实例（3080/3098 直接 GET 是 401）时用启动日志里的 token URL 换 cookie（`curl -D -` 抄 `set-cookie`，`.local-tests/grab-cookie.mjs` 是本机做法），传 `DSH_PROBE_COOKIE=name=value`（探针走 `Network.setCookie`）。这份 cookie 与 Playwright MCP profile 里那份都会在 **24 小时后过期**，症状是页面直接 401「dsh web authentication required」——MCP 侧看起来像「页面启不来」，此时别怀疑插件：`node .local-tests/mint-cookie.mjs` 用 `~/.dsh/.credentials.yaml` 里 `client-connection/browser-session` 的持久密钥重签一份（自带自检：复算一个已知 cookie 的签名并打印），或重跑 grab-cookie 换新的。另：`?token=` URL 直接当 `DSH_PROBE_URL` 会让主探针永远 "page load timed out"（服务器 303 剥掉 query 后 `location.href` 是裸地址，而探针判据是 `href.startsWith(DSH_PROBE_URL)`）——正确姿势是 `DSH_PROBE_URL=http://127.0.0.1:<port>/` + 上面的 cookie。

**①-b `rev` 必须是当前值，且活实例已实测跑当前 bundle（2026-09-16）**：插件自身的 URL 由 shell HTML 给出——`curl -s -H "Cookie: $C" http://127.0.0.1:3080/ | grep -o '/plugins/??dsh-web-mobile/client.js&rev=[0-9a-f]*' | head -1`。**自造或过期的 rev（实测 `rev=probe`、`rev=000000000000`）一律 404 空 body**，外观与「非组合路径 404」完全相同——别据此判「插件没被服务」。同一 rev 下定稿：HTTP 200，总 **352601 B ＝ `lib/client.js` 352521 B ＋ 80 B `//# sourceMappingURL=…` 尾巴**，前缀 sha1 **2dfc5c027bd6** 与本地文件逐字节一致。配套确认「页面跑的是本仓库代码」这条链共三环：① profile 用 `link:` 装本仓库（`~/.dsh/profiles/web/node_modules/dsh-web-mobile -> ../../../../dsh-mobile-nav`，package.json 里是 `link:/data/.../dsh-mobile-nav`）；② 本仓库 `lib/` 与 HEAD 逐字节一致（`git archive HEAD` 到干净目录重建实测：69 文件全同、0 孤儿）；③ 服务器按请求读盘（no-cache）。

**② Termux 上 headless chromium**：必须给可写的 `TMPDIR` 与 `XDG_RUNTIME_DIR`（spawn env 指到 `~/tmp` 下自建目录），否则 ProcessSingleton 建 socket 失败报「Failed to create a ProcessSingleton」直接退出、CDP 端口永不上线。工具 exec 环境里 `$HOME` 可能为空（`mkdir -p $HOME/x` 会打到 `/tmp`）——env 一律用绝对路径。node 的 `spawn` 无法 exec `chromium-browser` 包装脚本（symlink → `chromium-launcher.sh`，libuv 拿 EACCES，而经 sh 跑同一脚本却正常），探针要用 `DSH_PROBE_CHROME=/data/data/com.termux/files/usr/lib/chromium/chrome` 直指真实 ELF（实测 750ms 就绪）。临时脚本与截图放 `~/tmp/` 用完清理。

**③ Playwright MCP（本机已装，2026-09-14 实测）**：MCP 自带 Chromium（`~/.cache/ms-playwright/chromium-1232`，149.0.7827.155）在本机正常起浏览器并访问 `127.0.0.1` 的 DSH Web，设备仿真优先用它；仓库内脚本化回归仍走原生 CDP。用法：`browser_run_code_unsafe` 里 `browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })` + 从已有 context 复制 cookie + `addInitScript` 写 `localStorage['dsh.sessions.current']` 就是一台手机；被桌面布局隐藏的元素用 `document.querySelector(sel).click()` 而非 `page.click()`（后者要可见性检查，必失败）。两个环境前提：`~/tmp/pw-dsh-tmp` 必须先存在（否则 `mkdtemp ENOENT`），且该 Chromium 协议里没有 `Emulation.setSafeAreaInsets`（回 was not found）——inset 仍只能模拟。仓库内 `playwright-core` 的 registry 在 android 平台抛 `Unsupported platform: android`，所以脚本化回归的可行做法是：spawn 系统 chromium（`--headless=new --no-sandbox --disable-dev-shm-usage --remote-debugging-port=<port> --user-data-dir=<dir>`）+ fetch `/json` 取 `webSocketDebuggerUrl` + 原生 WebSocket 收发 CDP（`Page.navigate` / `Runtime.evaluate(returnByValue)` / `Input.dispatchMouseEvent` / `Page.captureScreenshot` / `Emulation.setDeviceMetricsOverride`），参考 `scripts/cdp-probe.mjs` 的 `createCdpClient`；会话注入在导航前用 `Page.addScriptToEvaluateOnNewDocument` 写 `localStorage['dsh.sessions.current']`。用它独立复跑过 Files 面板 safe-area 几何断言 13/13。

---

## 消息字号必须跟随宿主字号轴（#52）：两处「守卫空转」陷阱

**消息字号必须跟随宿主字号轴（#52）**：插件移动分支原来把消息列**连同**它的 `p` / `li` / `[class*="_text_"]` 后代一起钉在 `font-size: 15px !important`，而宿主把「设置 → 字号大小」写在 `<body>` 的 inline 自定义属性上（ThemePresenter 用 `document.body.style.setProperty('--dsh-content-font-size', '12px')`，见 `@deepseek-ai/dsh-client-ui-theme/lib/client.js`），再由 `body{…}` 块里的 `--dsw-font-markdown-base-font-size: var(--dsh-content-font-size,14px)` 派生。于是设置 12–17 只驱动宿主自己画的 markdown 块，消息文字恒 15px——**同一条消息里混着两种字号**（探针 `scripts/probes/message-font-axis-probe.mjs` 修前红：`paragraph=15px container=15px markdown=12px`，轴调到 17px 时同款）。修法：容器读长写 token 作整条回退链 `font-size: var(--dsw-font-markdown-base-font-size, var(--dsh-content-font-size, 14px)) !important`（layout.css.ts，仅此一条手改规则），后代改 `font-size: inherit !important`——再给每个 `p`/`li` 各钉一条等于把轴第二次切断。

**`font:` 复合简写 token 不能当 `font-size` 用**：`--dsw-font-markdown-base` 存的是 `尺寸 / 行高 字族` 三元组（`var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family)`），`font-size: var(--dsw-font-markdown-base)` 是**非法声明**——解析器静默丢弃、级联回退到继承值，不报错也不生效。只有结尾 `-font-size` 的长写 token 可用；两个 token 只差一个后缀，抄错时症状是「写了字号但完全没变化」。

### 守卫别遍历 DOM 级联：`@keyframes` 容器没有 `selectorText`

「消息文字族不再硬编码 px」这类断言只有两条路能走：断**源模板串**（`LAYOUT_CSS`）配一个纯函数选择器配对器（`src/client/core/css-rules.ts`，零 import，`tests/css-rules.test.ts` 驱动），或真的去递归 `document.styleSheets`。后者绕不开 `@keyframes` 的容器判定（Chromium 149 `CSSStyleSheet` 实测）：`CSSKeyframesRule` **没有** `selectorText`、**没有** `style`（读 `rule.style.cssText` 直接 `TypeError: Cannot read properties of undefined`），但它**有** `cssRules`；它的子规则 `CSSKeyframeRule` 反过来**有** `style` 却**没有** `selectorText`（只有 `keyText`，`from` → `"0%"`）。于是「按成员判断这是不是样式规则」的遍历分三种形状：读 `.style.cssText` 前不判 `selectorText` → 在容器上抛错（探针/审计里套 try/catch 即变成**静默截断的规则集**，后面的 `@media` 规则永远不被访问）；以 `style` 是否存在收规则 → 把关键帧步骤当规则（实测把 `opacity: 0;` 收成一条"规则"，其 `value` 是 `undefined`：同一族的断言于是**要么噪音、要么在 `assert.match` 上响亮报错**，总之不空转）；**先判 `selectorText`、按 `cssRules` 递归 → 安全**（容器与关键帧子规则都跳过、遍历照常前进；本仓库 `scripts/probes/files-panel-safe-area-probe.mjs` / `hero-composer-clip-probe.mjs` / `header-files-pin-probe.mjs` 就是这形状——`@keyframes` 在拼接表头部（base 先于 layout），它们照样跨过去命中 layout 的规则；`scripts/cdp-compat-contracts.mjs` 不按成员判别、只收 `cssText`，同样不受伤）。源级解析器有同族的两个反面：不剥整段 `@keyframes` 会把 `from`/`to` 这类非选择器混入块列表（Task 2 实测草稿 `blocks.length = 3`，应为 1）；反过来整块跳过 at-rule 则一条也匹配不到——`tests/css-rules.test.ts` 第一个测试把 `@keyframes` + `@media` 混合输入钉成「只许 1 个块」。**配套铁律**：`fontSizeFor` 返回 `null` 时必须大声失败（`assert.ok(hit !== null)`），否则「守卫什么都没查到」与「守卫通过」在输出上无法区分——草稿里 `:has(p)` 被近似成"元素本身是 p"，真实规则永远 `null`，正是这一类。

### 「守卫什么也没守」的同族第二例：正则对它要抓的字符串恒不匹配

同一条守卫里的 `assert.doesNotMatch(hit.value, /px$/)` 对本仓库自己的声明风格**恒真**——所有 `font-size` 都写成 `15px !important`，字符串不以 `px` 结尾，于是这条断言永远绿；真正拦下硬编码的是同组的 `assert.match(hit.value, /var\(/)`（Task 2 反向验证实测：临时把 `15px !important` 放回去，红的是后一条）。已改成锚定值开头的 `/^\s*[\d.]+px/`——不能退回裸 `/px/`，它会把回退链里合法的 `14px` 一起抓。**判定一条断言是否真在守：把它要抓的字符串喂进去，看它红不红**；同族历史见 §header 拥挤的尾随空格（合成 fixture 复现不出）、§hero 输入框下限（11 断言全绿却漏网）、§tooltip（断言断在 bug 本身）。

---

## 抽屉的两个 closer 必须互斥（#49 的 tap 接线把隐式不变式变成显式的）

**抽屉的两个 closer 必须互斥（#49 的 tap 接线把隐式不变式变成显式的）**：会话行 tap 有两条关抽屉路径——`armNav()`（MutationObserver 看「选中行的标题变化」，2000ms 自 disarm）与 `closeOnNavigation(id)`（订阅 `ctx.sessions.list`，导航落地后 `setTimeout(fire, 0)` 关）。旧代码里每次未选中行 `pointerup` 都调 `armNav()`，而它的首句就是 `disarmNav()`——「同一时刻只有一个 closer 被武装」这条不变式当年是靠**调用结构隐式**维持的，没人写下来。#49 让 tap 在能解析出会话 id 时改走 `closeOnNavigation()`，这条路径**不碰观察者**，不变式于是破了：「回退释放」（漂移 > `TAP_NAV_SLOP_PX` 的滑动释放，抽屉仍开着、观察者已武装且 2s 内才自 disarm）+「2s 内再一次解析成功的 tap」会让观察者（选中标题变化）与 store 落点（`fire`）**为同一次导航各调一次 `toggleSidebar()`**，谁先谁后取决于 React commit 时序——表现就是本仓库「抽屉没关 / 要点两次」家族。修复＝两个分支**在决策点各自先 disarm 对方**（`tappedId === null` 分支先 `disarmCloseOnNav()` 再 `armNav()`；解析成功分支先 `disarmNav()` 再 `closeOnNavigation()`），两条路径各留一段注释说明为什么。

**同族收紧**：`disarmCloseOnNav()` 现在同时置 `closeOnNavDone = true`——只退订拦不住已经排进 `setTimeout(fire, 0)` 的那次 `fire`，不置位就仍会在 disarm 之后补一次 `toggleSidebar()`；effect 的 disposer 里那句显式置位因此变成冗余（同一件事现在由 `disarmCloseOnNav()` 做），已删。这条竞态**没有仓库内复现**：修复是按结构论证的（重放需要在共用 dev server 上把 bundle 换回 `6edaaed`，A/B 窗口对用户可见且结果依时序而定），别把它当已复现的 bug 记账。

**`isTapWithinSlop` 是逐轴 max-norm，不是欧氏距离**（`|dx| <= slop && |dy| <= slop`，`TAP_NAV_SLOP_PX = 12`）：这是刻意取 `hypot` 圆盘的**超集**——`hypot` 会让斜向 tap 比轴向 tap 严格更难通过，而抽屉列表本身就是纵向滚动列表，真正要排除的是「纵向漂了一大段还停在行上」的滚动释放（同一次 45° 斜移 9px/9px：逐轴判据两轴都在 12px 内＝照常 tap，`hypot` 半径 12.7px 早已出界＝被当滚动丢掉）。**别把它"修正"成 `hypot`**。

**锚点**：`scripts/probes/row-tap-no-click-probe.mjs`（7 断言、端口 9355、临时 profile `~/tmp/cdp-noclick-*`）。双场景共用同一 tap 几何：A 对照（不吞 click，证明探针几何真的驱动了宿主路径——A 红=整条 tap 路断了，A 绿+B 红=只是新分支坏了）+ B 在 document 捕获阶段对指向会话行的 click 做 `preventDefault + stopImmediatePropagation`（React 18 的事件委托挂在 root container 上，document 捕获早于它 —— 与 WebKit 根本没派发 click 对 React 等价），断言 5 计数「确实吞到了」以防 B 什么都没证明。**它证明不了真机 WebKit**：pointerup 次序、`pointercancel`、整体吞事件的 iOS 壳都在模拟范围之外。

---

## 宿主 Shiki 高亮止血 patch（本机配方：宿主升级后重放）

**宿主 Shiki 高亮止血 patch（本机配方，2026-09-14；2026-09-18 复核已失效 → 同日定案：默认不重放，根治走上游）**：`tokenizeTimeLimit:0`（单块不限时）→ `100`ms，消除大 code 块高亮尖刺。宿主前端是独立依赖 dsh-web-frontend 的 dist（发布包内无源码），**每次宿主升级整包替换 dist → 补丁必被抹掉**。2026-09-18 实测：旧的 `index-ClqxG24t.js` 已不存在，现役 `dist/assets/index-BKQ_L1z6.js` 里是 `tokenizeTimeLimit:0`——**补丁当前不生效**（`grep -o "tokenizeTimeLimit:[0-9]*" <file>` 印出 `:0` 即未打，`:100` 才算打上）。重放命令（文件名 hash 每次可能变，先 `grep -rl tokenizeTimeLimit <dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/` 重新定位）：`cp <file> ~/dsh-mobile-nav/.local-tests/$(basename <file>).bak-pre-shiki && sed -i "s/tokenizeTimeLimit:0/tokenizeTimeLimit:100/" <file>`；改完重启 `dsh web` 再按上面的 grep 复核。`~/dsh-mobile-nav/.local-tests/*.bak-pre-shiki` 是**旧那代 bundle 的未打补丁副本**，不是现役还原点（该目录 gitignore、不入库）。已验证：served 生效 + 真 6.8MB 会话 boot 正常 phase=active；超时降级行为（超预算块变纯文本、内容完整）未在真块上实测——真机若见个别块无语法色即此降级，属预期，可调大数值。这是**本机对宿主 dist 的手改**，不是插件不变式：插件源码不含该改动，重装/升级宿主即失效。**2026-09-18 决定（用户确认）：默认不重放**——下游每升一次宿主就被抹一次，属于给未来埋维护税；根治产物已交给上游（`docs/upstream/host-jank-feedback.md` §问题 2：单遍 tokenize 110–400ms、叠加 400–1900ms longtask，附 idle 调度/分片/视口优先三条修法）。下面命令保留为**应急手段**，只在真机明显被大 code 块卡到时才用，用完照上面的 grep 复核。

---

## 2026-09-18 迁入原文：原 AGENTS.md「Pitfalls」节（逐字）

> 2026-09-18 从 `AGENTS.md` 的 Pitfalls 节**逐字**迁入（含推导、取证、实测数据、探针断言清单、被否决方案）。AGENTS.md 现只保留 48 个名字清单（名字 = 触发词 = 本块的 `### 锚点`），按顺序与本块一一对应，由 `tests/docs-consistency.test.ts` 精确校验。与上文小节内容重叠处，以本块为较新版本（本块只增不改）。
### 手势层

- **抽屉手势层（sidebar-swipe.ts）铁律**（推导/A/B → `docs/maintenance/pitfalls.md` §手势层）：开=提前提交（8px 锁轴即 arm + inline `-101%` 百分比跟随 + arm 帧 `content-visibility:hidden`）；关=晚提交（280ms 滑自身宽×110% px 槽位，落地才翻 marker，防 React 中途换子树倒跳）；（同一条晚提交路径也服务点按关闭：六个入口统一走 closeDrawerAnimated，2026-09-17）；手势判定后必须 `markGestureConsumed(target, 300, drawer)`，宿主 `onDrawerClick`/`onDrawerPointerUp` 首行 `isStrokeLocked() || consumeIfGestured(event)` yield；drawer 滚动容器 `touch-action: pan-y pinch-zoom`（**漏 pinch-zoom 会让浏览器施加的缩放无法撤销，#45**；主探针断言含 pinch-zoom 且不含 pan-x；真正落点是 html/body，drawer 是双保险）；起点纯几何（`hitTestStart`，0.45×视口宽≈176px@390；冲突由让位体系解决，识别区不缩）；inline 一律 `setProperty(...,'important')`，断言看计算后几何；`transform:none` 无 inline 残留只约束终态。参数速查：START_ZONE_RATIO=0.45、LOCK_PX=8、open/close 0.16/0.13 视口比例、速度=60ms 窗末两点斜率、openVel/closeVel 0.45px/ms、cooldown 350ms、consume 300ms（consumedEl 每次 pointerdown 清空）。让位清单（beginStroke 前置 + tryLock 每次锁轴前复查）：cooldown/modal/takeover/selection/横滚容器/**拖动标记/悬浮窗形状**——拖动组件拖动期间挂 `data-mobile-nav-dragging`（被按住元素/祖先或 body/documentElement 全局）手势层即整笔让位（配合实现的组件走标记）；不配合的第三方可拖动悬浮件（dsh-pet 桌宠实测 148×160 fixed）走位置启发式 `findFloatingWidget`：起点祖先链上第一个 fixed|absolute 且 ≤200px（FLOATING_WIDGET_MAX_PX）的自由定位浮层即让位（frame 子树除外——FAB/backdrop/抽屉不误伤）；让位≠拦截，悬浮窗拖动照常执行；一旦锁轴即承诺，锁后出现的标记/形状不回头。划词选择（双选区模型都读，塌缩光标不算拥有）与多指必须整体让位；距离从 startX 起算；#32 nav-arm 关闭路径不许掐死；`gesture-guard.ts` 保持零 import。回归门：`scripts/cdp-swipe-failures.mjs` 16 场景 + 主探针 14 项核心断言（+6 集成）+ `scripts/probes/draggable-conflict-probe.mjs`（15 断言：0.45 区几何 / 无标记悬浮球让位 + 跟手 / 标记接口 / 清除后恢复）；主探针 `drawer-touch-action` 断言为含 pan-y + pinch-zoom 且不含 pan-x（#45 zoom 契约后同步）。
### files 手势

- **files 手势（右缘，2026-09-13 用户拍板的判定矩阵）**：`strokeMode` 双族路由写在 beginStroke——抽屉开时右缘笔画也进 **files 族**但判定等价（左滑='none' 永不收抽屉——**2026-09-17 起限「抽屉右缘之外」**，抽屉体内归抽屉族——用户原话「右缘左滑抽屉要是开的情况下，不会收起！只有右缘右滑才能做到」；右滑='close' 走 commitFollowClose 动画收起，**门槛＝抽屉族的 CLOSE_DISTANCE_RATIO 0.13×视口或 0.45px/ms 速度**——390px 下 files 区与抽屉列重叠 66px，缺这道门槛时抽屉内容上的拇指横向漂 8px 就会收抽屉并吞掉这次 click（2026-09-14 两阶段审查抓到，原判定直接 `return 'close'`；`tests/sidebar-swipe.test.ts` 有跨族等价测试钉住两族判定一致）；抽屉关时右缘 45% 区起滑进 files 族（双关+左滑=开面板；面板开+右滑=关面板）。三个已踩坑：①endStroke 的 verdict 必须在 `reset()` **之前**捕获 strokeMode/lockFilesOpen（reset 会把 strokeMode 重写回 'drawer' 并清 lockFilesOpen，判定静默降级为 'none'）；②files 提交必须 **toggle 先于 markStrokeConsumed**——标记链从起点走到 frame，而 frame 是 header 的祖先，标记先落会把 openFilesPanel 自己程序化的 opener click 经公共祖先段吞掉（面板永不打开）；'none' files 释放仍要吞合成 click（释放点在开启的面板内、宿主 toggle 就在下面），但必须在提交分支之后；③filesPanelOpen() 不能只查元素在场——0.1.5 面板常驻 DOM（关闭形态 visibility:hidden + rect 顶到 x=视口宽），要用 visibility/display/rect 三重判定。files 笔画不画跟手（applyFollow mode-guard），files 提交也不进 cooldown 例外。锚点 `scripts/probes/files-swipe-probe.mjs`（11 场景：上列矩阵 + footer 无文件入口 + 面板被抽屉压住仍存活/收抽屉后仍在）；**抽屉底部文件入口已删**；共存契约与已知不修清单 → docs/specs/2026-09-17-sidebar-files-coexistence-design.md；`close-follow-reaches-slot` 场景已迁到抽屉族最深合法起点（390px 下左区起点最多 -211px，槽位算术由 followTranslate 单测钉死）。
### 抽屉导航 click

- **抽屉里的导航项只能在 click 落地后关抽屉，pointerup 关闭会连 click 一起取消（「点新会话只收回抽屉」根因，2026-09-13）**：`installOverlayInteractions` 对非 `[role="treeitem"]` 的导航目标（newSession / taskboard / ssh / search）原来在 document 捕获 `pointerup` 里 `toggleSidebar()`——pointerup 收抽屉后触摸点已不属于按钮，Chrome **不派发 click**（trace `pointerdown@open>pointerup@closed`，此后无 click），宿主 onClick（`startSession()`）从不执行。会话行早由 #32 的「选中标题变化」observer 绕开，非行分支是漏网；修复＝删掉该分支的关闭，交给既有 document 捕获 click 收抽屉（click 已派发给按钮，事件路径派发时已固定，React 委托照收）。**任何在 pointerup 里收起容器/改布局的写法，先问「这次手势的 click 还没派发吧」**。锚点 `scripts/probes/drawer-new-session-probe.mjs`（5 断言）→ `docs/maintenance/pitfalls.md` §抽屉导航 click。
### 抽屉行菜单

- **摘要层要警惕「渲染了 ≠ 可点到」：会话行 ⋯ 菜单四连坑（2026-09-14 真机）**：①第三方 `@linxin666/dsh-web-all` 的 `installMobileSidebarDismiss` 缺 `_rowActions` 豁免 → 点行内 ⋯ 被当「点了会话行」、去 `.click()` logo 收抽屉；插件注入惰性影子 `[data-mobile-nav="dismiss-shadow"]` 让它先命中（inline `display:none !important`、作 sidebar pane 首子节点、**别放 logo 行**）。②触摸看不到三点（宿主 `_rowActions` 只 hover/menuOpen 显示）→ 插件自实现长按 500ms + 抬手吞合成 click 800ms + `pointerleave` 守卫 1200ms。③菜单被抽屉压住（宿主 menu `z-index:1100` < 抽屉列 1300）→ 移动分支 `body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed])) [role="menu"] { z-index:1400 !important }`。④同一 shim 还吞掉 frame 内、抽屉外的一切点击 → 删除确认卡必须挂 `document.body` + `delete-dialog-backdrop` 1400 / `delete-dialog` 1401，否则按钮全死。**同类断言必须带 `elementFromPoint` 命中测试**（DOM-only 断言在「渲染了但被盖住」时全绿）。锚点 `scripts/probes/drawer-row-actions-probe.mjs`（15 断言）→ `docs/maintenance/pitfalls.md` §抽屉行菜单。遗留已收口（2026-09-19）：workspace（项目）行 ⋯ 同样 hover-only，其 Rename 打开的**宿主模态**门户根 `body > div._root_w1urq_2`（fixed z1000）也压在抽屉 1300 下——弹窗内部 z:1 只在门户根内排序，提升 `[role=dialog]` 无效，必须提升门户根；已并入 base.css 抽屉打开态提升家族（`body:has(开态) > div:has(> [role="dialog"][aria-modal="true"])` → 1400），探针 5f/5g 断言门户根 z 与命中、cancel 关闭；我们自己的 delete 卡 role 在 body 直接子上故不被 `:has(>)` 误命中。
### backdrop 误吞

- **手势消费标记的 backdrop 误吞坑（「点两次才关」）**：手势打开抽屉后 `markGestureConsumed` 链式标记手势起点目标，若起点 `event.target` 的祖先链**不含 drawer**（headless 命中穿透时起点落到 body；或 drawer 空壳无内容元素），链会一路走到 document——把 **backdrop / FAB 也标记为 consumed**。随后 1s 窗口内点 backdrop 想关闭，sidebar-swipe 的 document 捕获 `onClick` 命中标记 → `stopPropagation` → backdrop 元素级 click 监听收不到 → 点一次无效（用户感知"要点两次"）。修复：`onClick` 对命中 `[data-mobile-nav="backdrop"], [data-mobile-nav="fab"]` 的 click **无条件放行**（backdrop/FAB 绝不可能是手势合成 click 的目标——手势起点只在左缘 start zone/drawer 内容区）。同时 `markGestureConsumed` 的 upTo 收敛为 drawer（非 frame），减小误标范围。
### composer 行

- **composer 底部行三件套契约**（推导/探针 → `docs/maintenance/pitfalls.md` §composer 行）：固定图标控件（_add 28 / ContextMeter trigger 28 / _primary 34）不参与收缩；trailing `flex:1 1 auto`、发送 `margin-left:auto` 钉右缘；自适应余量吸收器优先级=模型条>圈>发送键，互斥由置零规则双 arm（menu+dialog）保证，空隙永远在焊接簇之前；模型条与 dock 槽隔 `display:contents`，trailing 域用后代组合器；收缩规则必须 `:not` 排除 `_add`/`_primary`/`_root`；ContextMeter（`JObwrW_`）trigger 无 `aria-haspopup="menu"` 须单独钉住 root。**圈命中盒/间距（2026-09-17 定稿）**：trigger 盒移动端 `28×34`（宽 28 = 几何上限、高 34 行高零成本），`margin-right: 0px`；唯一旋钮且 1:1（`6px + margin-right = 缝 = 环左移量`），环墨迹恒官方 14px 不放大。子代理形态：running 渲染双 `_primary` → 该形态恢复官方 wrap（`:has([class*="_primary"] ~ [class*="_primary"])`）；idle 无模型条 → 圈 root 挂 auto。回归探针 `scripts/probes/subagent-composer-fix-probe.mjs`、`scripts/probes/diag-sub-idle-pin.mjs`、`scripts/probes/composer-meter-hitbox-probe.mjs`（圈命中盒/间距断言 + A/B 非空转）。**取数口径**：选卡只锚 `[data-composer-card]`（无回退分支）；`[data-phase]` 是双命名空间（根=app 相位、编辑面=提交相位）；宿主链式叠加顶掉 composer 时（`[data-chain-overlay-fallback="conversation.composer"]` 内联 `display:none`，如未回答的提问卡）探针走 SKIP 并点名 elected 节点，不当红也不静默跳过。
### 键盘 guard

- **composer 键盘 guard（PR #48）marker 契约按宿主分代**：`[data-composer-input]` 是 Lexical 编辑面 marker（0.1.2-alpha.2 起），早于它只有 card/seat（guard 安全空转）；升级宿主按 composer-keyboard-guard.ts 文件头注释对账两 marker；headless 的 `detectIosWebKit` 恒 false，本地 CDP 无法验活跃路径（贡献者 iPhone 实机 + tests/composer-keyboard-guard.test.ts 源码不变量已过）→ `docs/maintenance/pitfalls.md` §键盘 guard。
### 断点与设备

- **宽度断点 ≠ 设备判定（2026-08-30 PC 泄漏）**：`MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'`（JS 常量 + compat/layout/misc 全部顶层 media 块同步）；misc 桌面隐藏块=精确补集 `@media (min-width: 1024px), (pointer: fine), (pointer: none)`。**维护约定：新增任何 `data-mobile-nav` 注入控件（slot 按钮、task 注入元素）必须同步加进隐藏块清单**（dispose 竞态最后防线）。**唯一豁免（v2.4.1）：session-delete 三件套**（`session-delete` 菜单项 + `delete-dialog-backdrop` + `delete-dialog`）不进宽度臂——它们按 `TOUCH_QUERY = '(pointer: coarse)'` 全宽度武装（大平板横屏契约），只受 misc 尾部独立的 pointer-only 块 `(pointer: fine), (pointer: none)` 隐藏；`installMobileEffect` 支持第 4 参 query 覆盖默认 MOBILE_QUERY。探针必须 `Emulation.setTouchEmulationEnabled`（`setEmulatedMedia` 对 pointer 特征无效），桌面场景必须关掉；断言 slot 按钮前等 active phase（hero 的 `wSkVaW_headerActions` 不是同一容器）。完整案例 → `docs/maintenance/pitfalls.md` §断点与设备。
### 探针运行环境

- **CDP 探针环境参数**：主探针要 `DSH_PROBE_SESSION_ID`；`DSH_PROBE_URL` 三个探针统一 `http://127.0.0.1:3080/`；`DSH_PROBE_CHROME` 在 Termux 要显式传（缺省会 spawn ENOENT）。**活性标记是元素属性 `[data-phase="active"]`，`document.body.dataset.dshPhase` 不存在**（照抄它会一直超时）；插件自己的 `[data-mobile-nav="frame"]` 更早，要「插件已武装」用它。连续跑会泄漏 headless chromium 进程（实测 31 个残留把 load 顶到 7.0），排查前先 `pgrep -c chrom`。完整清单（cookie TTL / `mint-cookie.mjs` / URL 带 token 的陷阱）→ `docs/maintenance/pitfalls.md` §探针运行环境。**`DSH_PROBE_URL` 带 `?token=` 时宿主 303 到裸路径**（2026-09-24 实测，token 换 `dsh-auth-*` cookie）——探针的页面加载判据必须按 **origin** 比（`cdp-probe.mjs` 已修），按完整 URL 前缀比会永远超时。
- **自建 fixture 的 Playwright 仿真陷阱（2026-09-24，#101 审查实测）**：fixture 不带 `<meta name="viewport" content="width=device-width">` 时，`isMobile: true` 会把布局视口钳到 **980px**，所有媒体查询按 980 求值——≤767 分档断言全失真（检查岗首轮复测即踩，390 场景名存实亡）。分档 CSS 的 fixture 验证两条路：①给 fixture 补 viewport meta 后照常 `isMobile: true`；②`hasTouch: true` + `isMobile: false` + `setViewportSize`（device-width 页面的正确建模）。真宿主页面自带正确 meta，AGENTS.md 的 isMobile 配方不受影响；断言前先核对 matchMedia 目标档布尔与预期档一致，再读计算值。
### iOS zoom

- **iOS 一输入就放大（#45）已按机制修**（完整取证/已否决路线/未验证后续项 → `docs/maintenance/pitfalls.md` §iOS zoom）：根/抽屉 `touch-action` 必须含 `pinch-zoom`（沿祖先链交集，漏一层授权就被抵消）；`gesturestart` 一律不 preventDefault；16px 下限走 `html[data-mobile-nav-ios]`（misc.css，盖 textarea / `[contenteditable]:not([contenteditable="false"])` / 文本类 input + composer 三件套同字号；`select` 故意不改）；**不要改回 `maximum-scale=1`**（iOS 10+ 忽略、安卓/桌面认真执行）；宿主 viewport meta 各版都不带 maximum-scale；引擎判定=纯函数 `detectIosWebKit`（先 CSS.supports 特征探针再 UA，iPadOS 13+ 发桌面 UA 靠 maxTouchPoints）。viewport meta 所有权（重申 `width=device-width, initial-scale=1, viewport-fit=cover`，写入永不带缩放锁）已合并 cb16329。探针见 Commands（**A3/B3 本机 headless 预存红**：composer 卡选择器 0 命中，A/B 已证与改动无关，归 L2）。
### 探针基线

- **主探针（`scripts/cdp-probe.mjs`）的 3 项预存失败已写成机读基线**：探针源码内 `EXPECTED_FAILURES`（name 精确匹配；`page.errors` 另要求 detail 含 `404`，防掩盖新的页面错误）＝`page.errors`（一个 404 资源）、`integration.gitgraph.reparented`（`hasCard=true reparented=false`）、`integration.gitgraph.pressed`（`transform=none`，是上一项的下游：芯片未进 dock 则 `:active` 规则不命中）。命中基线的 FAIL 记 BASE 不计入退出码，SUMMARY 显示 `base=N new=M` 且 base>0 时打印 `BASELINE <names>`，只有 `new>0` 才 exit 1（gitgraph 芯片缺席时走 SKIP，属正常环境差异；某条目修好后必须从 EXPECTED_FAILURES 移除）。判定方法＝bundle A/B（见上条哈希子串）——判定探针结果时看 SUMMARY 的 new 字段，别把基线归给当前改动；修 gitgraph reparent 属独立课题。
### meme 卡

- **dsh-meme 表情卡片（meme-picker）**：手机端贴 anchor 双侧对齐（`left/right:0`+`width:auto`+`max-width:386px`）；网格 grid `minmax(64px,1fr)` 手机 4 列/平板 5 列（覆盖 dsh-meme 行内尺寸）；滚动条细条。dsh-meme 改卡宽/缩略图尺寸后回来对账 → `docs/maintenance/pitfalls.md` §meme 卡。
### preset 菜单

- **agent preset 模式选择菜单底部弹层**：`[role="menu"]:has([class*="cubgiG_item"])`（`:has` 圈定，不误伤其他 role=menu）；水平居中+顶部手柄+内部 viewport 滚动+细滚动条；桌面保持官方大下拉。参数 → `docs/maintenance/pitfalls.md` §preset 菜单。
### header 拥挤

- **会话 header 拥挤保护必须 `[class*="_root"]`**（尾随空格根因+修正 → `docs/maintenance/pitfalls.md` §header 拥挤）：`ZKlsPq_root ` 带尾随空格，`[class$=]` 真实 DOM 0 命中（合成 fixture 复现不出，只有真渲染能暴露）；门控 `header:has([class*="_crumbs"] [class*="_root"])`；钉宽只钉计数/jobs root（`:has(> button[class*="_trigger"])`），排除 switcherRoot 让 title 省略号收缩；官方 `ZKlsPq_separator` 手机端隐藏，crumbSep 保留。**让位优先级（2026-09-14 反转，用户拍板）**：模式名（手机端唯一的模式切换入口）与会话标题都保住文字，让位的是后台任务芯片的冗长标签 `_count`（≤440px 直接 `display:none`——截成数字在两位数任务时会显示错误的计数；≤559px 再加「lineage 同时在场」条件）——原先压模式文字的 `max-width:18px` 两条规则已删除。
- **2026-09-23 增补（智能体团队 chip + 右侧留白，真机 dpr 4 / 视口 360）**：
  - **团队 chip 的字不是插件藏的**：宿主 agent-team 包自带 `@container(width<=480px){.VoX2oq_triggerLabel{display:none}}`，容器是会话头 `wSkVaW_titleRow`（`container-type:inline-size`），头部一行 344 CSS px ⇒ 必命中（用户拍板跟随上游）。既然只剩 14px 图标，**下限从 44px 收到 28px**（图标 14 + 宿主自带 7px 内边距，与本插件 toggle/files 同尺寸）。
  - **右侧那段 26px 留白不许从预留下手**：头部右侧 `titleCluster{padding-right:46px}` 是承重值——文件按钮是绝对定位 `right:8px` 的 36px 盒，2026-09-22 用 26px 预留在 360px 真机上实测团队 chip 跑到 334、被 316 起的按钮压住 18px，**点 chip 尾巴会打开文件面板**。留白只能从「盒子本身」收：三级间隙 6→4、模式 chip 内边距 6→4、团队 chip 44→28。
  - **团队 chip「再点不关」是上游 onClick 不 toggle**：该包触发器开态时只 `panelRef.current?.focus()`，关闭只靠 `useDismissOnOutsidePointer`（document 上的 pointerdown，靶心在 root/panel 外）或 Escape。插件侧修法见 `src/client/effects/team-chip-toggle.ts`：开态时替用户向 `document.body` 派发一次合成 pointerdown（走宿主自己的 dismiss），再吞掉那一击 click——**顺序不可换**，放 click 过去会让宿主在未冲刷的旧闭包里 focus 面板。
### header 行高与弹层

- **会话 header 的行高、座位线与弹层包含块（2026-09-14 真机三项反馈 → `docs/maintenance/pitfalls.md` §header 行高与弹层）**：①弹层——`dsh-client-ui-jobs` 的菜单是 `position:absolute; top:calc(100%+5px)` 挂在 `.QsffPG_root{position:relative}`（28px 流式盒）上，被我们 chip root 的 `overflow:hidden` 与宿主 `session-title-cluster{overflow:hidden}` 双重裁掉、且 `right:8px` 相对 156px chip root 解析到 x=-16，芯片 `aria-expanded=true` 却什么都没画；修复＝**header `position:relative` + headerActions 内 chip root `position:static`**，两半都必需（只 static 会让包含块外移到 frame，菜单落到 x=8 y=849 屏外）。②行高——宿主手机版 `grid-template-rows: minmax(32px,auto) minmax(44px,auto)` 被空 utilities 座位（44px）与 `[role=tab]{min-height:44px}` 顶成 44/44（97px 里只有 36px 是内容）；压到 rows 36/32 + tab 32 + 座位 30px ⇒ 77px，宿主 `padding-top:8px` **不许再收**（收到 4px 会让标题行中心 22 而两角按钮中心 26）；规则用 `:has(> *)` 门控：hero 那个空 header 仍占 85px，不许被压缩（hero composer rect 逐字节不变）。③title cluster 的 44px 预留裁到 26px（我们的 Files 按钮只画 28px 带，留 8px 净空），标题道再得 18px。④**hero 空 header 的灰线（2026-09-19）**：hero 相位的 `headerHidden` 空 header 在手机上只画出自己的 1px `border-bottom`（像素扫描 y=84–85，rgb(224,224,224)）＝用户报的「新会话顶部灰线」；根因是宿主自家规则互压——`dsh-api-session-controller` 的 ≤768px 规则（(0,2,0) display:grid）压过 conversation 的 `headerHidden` 隐藏（(0,1,0) display:none），桌面 >768px 不命中故无灰线。修＝layout.css 移动分支以 (0,3,1) 重申 display:none（无需 !important，宿主 display 非 important 且我们的标签最后加载）；hero header 无子元素、抽屉入口是 FAB，隐藏顺带释放 85px 死空间。注意宿主在部分引擎上根本不挂载该 header（CDP 系统 Chromium 实测 headerCount=0）——探针断言写「缺席或 display:none」契约语义，不写「必须在场」；锚点 `hero-composer-clip-probe.mjs` 5b/6b。
### files 按钮

- **「打开文件列表」按钮（`[data-mobile-nav="files"]`）必须钉在右上角，与左侧抽屉按钮对称（2026-09-14 真机反馈）**：宿主把会话头 actions slot 挂在它的 title cluster 里，而 cluster 自带 `padding-right: 44px` 给一个手机端恒空的 utilities 座位（390px 实测 `headerUtilities` x=374 宽 0），**流式布局的按钮永远够不到右边缘**——修前实测 `[300,16,28,28]`，右边留了 62px 空档；桌面版同样如此但桌面不归插件管。修复＝移动分支把按钮改成绝对定位 `position:absolute; right:8px; top:12px; z-index:2`（和左侧 `[data-mobile-nav="toggle"]` 的 `left:8px; top:12px` 同一座位线），顺带把它占的 28px 还给标题道（crumbs 170→200）；该 44px 预留随后被裁到 26px（见上一条），标题道再得 18px。两点别踩：①它必须是 `position` 覆盖而不是加负 margin（容器 `justify-content:flex-end`，负 margin 会被 cluster 的 padding 吃掉一部分，且标题道宽度不会回收）；②竖向上两个角按钮都随 frame 的 safe-area padding 一起下移（实测 inset 47 时 top 12→59）——这是必须的，否则按钮会被状态栏压住。锚点 `scripts/probes/header-files-pin-probe.mjs`（11 断言：规则只在移动分支 / 右缘 382=390-8 / 与抽屉按钮同 top / 命中测试到按钮本体 / 不压 utilities 座位 / 插 inset 后两角同步下移且仍钉右缘）。（hero 态该 slot 不渲染，无钉错容器风险。）
### 哈希子串

- **哈希类选择器一律子串匹配 `[class*=]`，禁止 `[class$=]`**（实锤案例+守卫族清单 → `docs/maintenance/pitfalls.md` §哈希子串）：`[class$=…]` 对整个 class 属性串做后缀测试，多 token/尾随空格（`ZKlsPq_root `、`wSkVaW_… wSkVaW_composerHero`）即整体失配；复活后可能过匹配，前缀重叠片段加 `:not`。已守卫族：`_action(s)`、`_header`（含 `_headerStatic` 排除）、`_stat(_statsRow)`、`_scroll`（`:has(p)` + `:not(:has([data-composer-input]))`，PR #47）、`_tabBar`、`_row` 复合族五段 `:not`；低危候选 `_search/_searchInline/_searchBox` 升级后普查。回归：headless 向 scrollBody 注入 `<p>` 断言 padding 保持；bundle A/B 用 `git show <commit>:lib/client.js > lib/client.js`（服务端 no-cache，A/B 窗口要短并及时还原）。
### 工具栏锚定

- **设置工具栏规则结构化锚定，禁止裸 `[class*="_header"]`**（0.1.5-rc.2 实测官方 Plugins 页 4 张 `YyYd_a_` 卡头命中，dsh-web-all 分组卡头页零渲染；锚定 reparent 后 `> [class*="_nav"] > [class*="_header"]`、reparent 前 `> :last-child > [class*="_header"]`）；新装插件卡再现同类症状先查这条；回归探针 `scripts/probes/plugin-card-header-bleed.mjs`（10 断言，需 `DSH_PROBE_COOKIE`，nav 标签现为 `Web Plugins`）→ 案例 `docs/maintenance/pitfalls.md` §工具栏锚定。
### tooltip

- **触屏 tooltip 压制必须保留 `[class*="_actions"]` 祖先限定**（裸 `[_bubble]` 会 display:none 用户消息/goal 气泡——0.1.1-rc.2 上「CDP 实测 10 个 tooltip」就是 10 条用户消息，断言断在 bug 本身；摘抄/移植类 CDP 验证必须同时断言非目标元素可见）→ 完整取证 `docs/maintenance/pitfalls.md` §tooltip；回归探针 `scripts/probes/diag-flow4.mjs`。
### hero 净空

- **hero 净空与胶囊锚点净空的级联冲突（2026-09-06）**：同特异度 (0,3,0) 跨块踩踏（misc 拼接在 compat 之后）——hero 40px 净空被踩成 6px、28px 胶囊压输入行；修复=misc padding-top 覆盖加 `:not(:has([data-gitgraph-chip-anchor]))`，净空随芯片生长 40→44px。教训：同张拼接样式表跨块调参前先用探针量同特异度冲突；胶囊异步渲染必须轮询等锚点再断言。回归探针 `scripts/probes/diag-hero-chip.mjs`（8 断言）→ `docs/maintenance/pitfalls.md` §hero 净空。
### hero 输入框下限

- **hero 空态输入框不许被压到宿主自己的下限之下（2026-09-14 真机：滚动条 + 首行被裁）**：Lexical 代宿主（0.1.2-rc.1 起实测到 0.1.5-rc.2）给 hero 输入框钉了 `min-height: 52px`（hero 提示文案会折两行），而 **min-height 永远赢过外层的 height**——插件从 fork 摘的「空态压成一行」镜像规则（`height:28px !important` 打在 `_scroll`/`_grow`/`[data-composer-input]`）在真宿主上只压小了滚动窗口（clientHeight 28 / scrollHeight 52）→ 滚动条 + 首行不可见。该规则已删除（hero 输入框回到宿主两行高度，卡 108px）；textarea 代（0.1.1-rc.2）的同一 collapse 保留——那代输入框是透明 `height:100%` 覆盖层、自身无下限，规则确实生效。**教训**：镜像到新一代的「压小」规则必须对账宿主是否给该元素钉了自己的下限（合成 fixture 里没有下限，这正是它当年 11 断言全绿却漏网的原因）；同族检修=任何「压小宿主元素」的规则先查该元素有没有 min-height/size 下限。锚点 `scripts/probes/hero-composer-clip-probe.mjs`（12 断言：无溢出 / 未滚动 / 输入框与提示完整可见 / 输入框不低于宿主下限 / 插件规则不钉该链高度 / 桌面零干预）→ `docs/maintenance/pitfalls.md` §hero 输入框下限。
### overlay 两信号

- **`data-conversation-composer-overlay` 是通用 overlay 属性，非 file-viewer 专属**：marker 判定只认 `.dsfv-panel`；手势让位 `takeoverActive()` 直查通用属性（轨迹 tab 也让位，FAB 仍可开抽屉）；注入形状必须含反断言形态（纯属性、无 dsfv 类 → marker 不置位但滑动让位）→ `docs/maintenance/pitfalls.md` §overlay 两信号；设计 `docs/specs/2026-09-06-conversation-overlay-takeover-design.md`；探针 `scripts/probes/file-viewer-probe.mjs`。
### tab strip

- **会话 header view tab strip 手机端横滚（#41）**：strip `overflow-x:auto` + 按钮 `flex-shrink:0; white-space:nowrap` + `touch-action: pan-x`（strip 自己认领横向 pan）+ `overscroll-behavior-x: contain` + scroll-snap；affordance=右缘被切断的 tab；起始于已溢出 strip 的边缘滑被 `findHorizontalScroller` 在 beginStroke 拒绝 → `pitfalls.md` §tab strip。

### reconciler

- **全树 reconciler 的 task 必须幂等且 dispose 可恢复**：`ensure` 每次移动第三方 DOM 时刷新 `origin`（React 会重建节点）；`dispose` 找回元素限定在被移动容器内，不用全局文本搜索；task 注册的 disposer 不得丢弃，否则同环境插件重载后 reconciler 失效。
### 文档漂移

- **文档/注释与实现的漂移**：`MobileNavOverlay.tsx` 已删除；它当年的搬动型继任者（`settings-toolbar-reparent`/`git-chip-reparent`）也已删除（#105 改 CSS 重锚定）——提到这些组件/任务即视为过时。触觉反馈（`HapticRow`/`haptic-pref`）也已从源码移除，README 相关条目已清理。README「未发布」段的参数同样会漂移——定稿 release notes 前必须对源码常量核对（v2.3.0 漏过识别区旧值，以源码常量为准）。变更条目**只描述结果不写过程**（2026-09-05 用户偏好：不写症状/修复叙事，直接写修复后的最终状态）；功能条目同理**不列举特点细节**，一句话说清是什么即可（2026-09-08 用户偏好：功能不用解释有哪些特点）。计数条目（探针/测试文件数）README 与 AGENTS.md 各持一份，收口时必须两处同步——2026-09-08 实漏：会话删除收口只更 AGENTS.md 探针计数，README 的「七个」留在旧值。
### 合并冲突

- **合并涉及 CSS 字符串的 PR 会冲突在生成文件**：`lib/types/client/styles/*.css.d.ts` 和 `.d.ts.map` 是单行大字符串，双方只要都改过同一 CSS 模块，git 会在这些生成文件上报行级冲突。解法是合并后跑 `pnpm build` 重建 lib 再 `git add`，不要手工编辑 d.ts。

### 子代理芯片

- **子代理芯片触摸兼容（subagent-chip-touch.ts）**（三类症状分类+iOS 壳硬约束 → `docs/maintenance/pitfalls.md` §子代理芯片）：上游 count 变体 trigger 无 onClick（hover 定时器开关）；触摸路径=pointerup 派发合成 ArrowDown/Escape 走组件键盘路径 + ~800ms 吞射向 `ZKlsPq_`/`h8S2Va_` 子树的 trusted hover 事件（不吞 click）。CDP 注意：每步先断言无 aria-modal（误触 Session log 会拉起模态），一律全新 user-data-dir。
### subagent 两代

- **dsh-client-ui-subagent 两代互斥开关实现必须同兼容**（闪退竞态根因+修复 → `docs/maintenance/pitfalls.md` §subagent 两代）：0.1.0-rc.6~8（`h8S2Va_`）=onClick 代，0.1.1-rc.1/2（`ZKlsPq_`）=hover 代（npm dist-tag 不可信）；判定看 served bundle 有无 onClick/hover 定时器，别看版本号。onClick 代双开关竞态由 `toggledTrigger`（1s 宽限）+ document 捕获吞同 trigger 的 click 解决；`HOVER_SUBTREE_SELECTOR` 同时列两代哈希——两条吞噬防护并存、在另一代上各自 no-op，即两代通吃。
### irow

- **已安装列表的 outer-row 选择器必须排除嵌套 action 容器**：`irowActions` / `irowTrailing` 类名都含 `irow`，宽泛的 `[class*="irow"]` 会把 action 容器一起 `flex-wrap:wrap`、状态与按钮错位 → outer row 必须 `[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"])`，切回 ≥1024px 要清掉自己写的 inline。**该族上游当前 0 命中**（2026-09-16 实测），规则留作复活守卫。
### 市场头

- **市场头部「文字变竖排」的触发器是待更新按钮**：`_titleRow`（nowrap flex）出现 "Update market/all" 时 ~450px 撑爆 ~334px 表单 → `_title` 逐词换行。compat 已改 wrap + `_title` ellipsis + 按钮 nowrap；同区 `_opPanel` fixed 居中。**该族上游当前 0 命中**（2026-09-16），留作复活守卫。
### dshmarket

- **dshmarket ≥1.20 手机端隐藏设置 nav 造成死路，需镜像条件反制**：1.20.x 起上游 `Market.module.css` 在 `@media(max-width:560px)` 注入 `[role="dialog"]:has([data-dsh-market-root]) > nav { display:none }`（意图让市场在手机上接管整个设置对话框），注释假设宿主会在 content header 自留关闭按钮——但本宿主唯一叉号 `VOzbGW_close` 就在该 nav 里，于是打开市场后分类行与叉号一起消失、无路可退。已在 `compat.css.ts` 镜像上游同一 media 条件反制：frame 域限定 + `[role="dialog"]:has([data-dsh-market-root]) > nav { display:flex !important }`。取证手法：活页面遍历 `document.styleSheets`（含 media 规则递归）找命中目标元素且带 display:none 的规则，即可定位注入 style 标签（带 `data-plugin=dshmarket data-plugin-css=…`）。profile 的 `^caret` 版本范围会静默升 minor——dshmarket 升级后按调试地图 §7 对账。
### debug badge

- **`?mobile-nav-debug=1` 的 debug badge 不能观察自己写入的子树**：badge 位于 `document.body` 内，而 `paint()` 写 `badge.textContent` 会产生 childList mutation；若 MutationObserver 直接以 `paint` 为回调，会把自身输出再次喂给 `paint()`，造成页面硬冻结（headless/真实浏览器都会卡在 "Loading plugins…"）。回调必须跳过 `badge` 自身及其子树上的 mutation（`record.target === badge || badge.contains(record.target)`），否则调试模式本身就是事故源。
### 反引号

- **CSS 模板字符串注释内禁止反引号**：`src/client/styles/*.css.ts` 的 CSS 是 TypeScript 模板字面量，注释里写 Markdown 反引号会提前终止模板，tsc 报 `TS1005`。引用类名用普通引号或纯文本。
### has 下限

- CSS relies on `:has()` and therefore requires Chromium 105+; unsupported `:has()` rules can disappear silently in old WebViews. Preserve `prefers-reduced-motion` behavior.
### lib 纪律

- Generated code discipline: `lib/` is intentionally committed because consumers install without a build step. A source change is incomplete until `pnpm build` refreshes it.
### bundle 校验

- **页面状态/bundle 校验**：**对账法已按 0.1.5 实测修正**：插件由组合加载器提供 `http://127.0.0.1:3080/plugins/??dsh-web-mobile/client.js&rev=<rev>`（无 cookie 401，cookie 用 `.local-tests/mint-cookie.mjs` 铸；**rev 必须取自 shell HTML 的当前值——自造/过期 rev 与「非组合路径」同样是 404 空 body（sha1 恒 da39a3ee5e6b），别据此判「插件没被服务」**）。**rev 既不是 sha1(lib/client.js) 也不是 sha1(served)**（实测 760a4196b484 vs c37fc641a402 / ffcefb5084f8）——别用 rev 对账；权威判据＝served body 是 `lib/client.js` 的**逐字节前缀 + 80 字节 `//# sourceMappingURL=…` 尾巴**：`curl -s -H "Cookie: $C" '<combo url>' | head -c $(stat -c%s lib/client.js) | sha1sum` 必须等于 `sha1sum lib/client.js`。设备出现旧 UI 时先换全新 browser context/清站点数据——复用旧 context 会让 harness web 进入「fence-only」状态（frame 内联 `display:none`、最后一条 dsh-ui fence 挂 app 根级），与插件无关；再用上面的前缀 sha1 判据比对，不要据此改 mobile-nav 代码。

### host ESM

- **host 半区 ESM 相对导入必须带 `.js` 扩展名**：`tsconfig.json` 用 `moduleResolution: "bundler"`，tsc 把相对说明符原样发射；Node ESM 不猜扩展名 → `ERR_MODULE_NOT_FOUND`，plugin tree 加载失败、`dsh web` 直接崩（实锤 #31：`src/index.ts` 写 `from './compress'` 漏 `.js`）。bundler 模式会把 `./compress.js` 映射回 `compress.ts`，所以源码写 `.js` 即可，不必动 tsconfig。`lib/index.js` 应可从仓库根 `node -e "import('./lib/index.js')"` 直接解析。
### safe-area

- **safe-area padding 与 `box-sizing: border-box` 必须成对出现**（frame `height:100%`+content-box 会把视口撑出 inset 滚动量、composer seat 沉到视口下——「跟随失效」是假象，错位的是外层 document；桌面 inset=0 复现不出，须 CDP 注入 47px 模拟；断言 scrollHeight-clientHeight===0 且 seat.bottom===innerHeight）→ `docs/maintenance/pitfalls.md` §safe-area。
### Files 面板 safe-area

- **Files 列表面板（宿主 ui-sidebar-right）顶行压在手机状态栏下（2026-09-14）**：面板是宿主自己的全屏 fixed sheet（`[data-sidebar-right-panel=fullscreen]` → `position:fixed; inset:0`，z-index 40，自绘 `--dsw-alias-bg-base`），宿主 CSS 全程无 safe-area 处理，而 **fixed 元素的包含块是视口**——插件给 frame 加的 `padding-top: env(safe-area-inset-top)` 够不到它，顶行（tab 标签 / `+` / Split / 退出全屏）y=0…38 正好落在状态栏下。修复＝移动分支给**全屏形态**的面板本体吃 inset：`[data-sidebar-right-panel="fullscreen"] { padding-top: env(safe-area-inset-top, 0px) !important }`（layout.css 移动块）；成立前提是面板自绘背景（状态栏那一条不露底、无接缝）且为 border-box（padding 只下推内容，面板仍铺满视口）。**必须带 `="fullscreen"` 形态限定**：宿主另一种形态是停靠面板（820×1180 实测 `form=push`、`position:absolute`），它的包含块是 frame 的 padding box，本来就在状态栏下方，再吃一次 inset 会顶两次（探针场景 5 守此）。锚点 `scripts/probes/files-panel-safe-area-probe.mjs`（21 断言：规则在场且只在移动分支 / 规则选择器**命中活面板本体** / 宿主 fixed 全屏形态 + 自绘背景 / 模拟 inset 后整行按值下移、右缘不动、paneBody 不溢出 / 停靠形态不被规则命中且不双重 padding）→ `docs/maintenance/pitfalls.md` §Files 面板 safe-area。桌面零影响：规则在移动 media 块内，1280×720 `pointer:fine` 实测 `matches=false`。

### 响应压缩

- **响应压缩是进程级 prototype patch**：`src/compress.ts` 直接替换 `http.ServerResponse.prototype` 的 writeHead/write/end（disposer 还原），作用于 DSH Web 进程内所有响应而不只是本插件路由；仅压缩 ≥4KB 且 content-type 含 json、无既有 content-encoding、客户端 Accept-Encoding 支持 br/gzip 的响应，SSE 有意不压。改动该文件时必须保持三条不变式：小 JSON 原样字节透传（原头不动）、Content-Length 与实发字节数一致、dispose 完整还原三个方法。
- **#80 跟进已修（2026-09-22）**：缓冲期 `write()` 的 encoding 随块缓冲（latin1 不再被静默重编码，`end(data, enc)` 同透传）；completion callback 收进 `pending`，在真 `end()` 回放后 fire-once 按序触发（不接 error 传播——真实 flush 无法单独失败它们）；缓冲期恒 `true`（内存全收、socket 未触碰）＝已文档化限制（模块头注同记）。回归锚：`tests/compress.test.ts` 两用例（回调顺序、latin1 字节）。

### 会话删除

- **会话删除的注入面按宿主分代**（fork wzxmt-zhc 摘抄；完整取证 → `docs/fork-wzxmt-zhc/backlog.md` 会话删除行）：rc.2 手机抽屉只渲染宿主 rail（现役 `bhn1Oq_rail`；上游已改名，子串匹配不受影响），会话行 `_sessionRow` 与 ⋯ 菜单只在 ≥1024px 桌面面板存在 → session-menu.ts 在 touch 门控内静默、宿主升级后自动激活；**别为此做全宽注入或抽屉展开面板**（用户已否决）。**0.1.5 菜单换形（2026-09-13 真机）**：仍 3 项但渲染换代——`role="menuitem"` 按钮直排文本、无子元素（rc.2 的 `_itemIcon/_itemLabel` 克隆模板消失）；读取用 `itemLabel`（label span → 整按钮 textContent）双代兼容，注入项在无 label span 且无子元素时整按钮改文+染色，**未知形状（有子元素却无 label span）不猜文本**。升级绊线：`scripts/probes/session-delete-probe.mjs` 断言 5（rail 在场但 0 行/0 菜单）——0.1.3 上翻红即按 SKIP 提示复启注入/弹窗套件。桌面零注入由断言 15c/15d 守（pointer 门控 + misc pointer-only 隐藏块双保险），宽屏触摸（≥1024px + touch emulation）注入由 16a-16d 守。删除端点真机已验：冷会话 200 + 移入 `.sessions-trash`（2026-09-25 trash 语义，见下）、GET 405 / 空参 400 / 未知 404；**运行中会话 409 仅单测**。源码不变量守卫 `tests/session-menu.test.ts`。**0.1.7 菜单再换形（2026-09-24 bring-up，eaf74e4）**：识别改**包含式签名**（rename+fork+(archive|unarchive) 同含即会话菜单，去掉 `length===3` 硬卡）——0.1.7 普通行 4 项（新增 pin）命中；**归档行（unarchive 换 archive）不再命中不注入**：0.1.7 归档行被旧判定误注入后，`resolveSessionId` 的 `!archived.has(id)` 过滤使点击必弹 deleteError（#V1 N1）；blank 新会话行（标题=宿主 `session.new`）跳过注入——0.1.7 blank 行本无 ⋯（`!row.blank &&` 门），守卫属跨代防御。弹窗重设计为居中毛玻璃卡（材质/几何取自宿主 ⋯ 菜单与 Dialog），**点遮罩才关、点卡片不关**；探针期望同步：15c=四项宿主菜单+零注入、16b=items=5 injected=1。
- **#114/#115 删除端点安全加固与失败语义（2026-09-25，QA 六场景全 PASS）**：① Origin 同源门——`new URL(origin).host !== req.headers.host` → 403 `cross-origin`（畸形 Origin 同拒）；**缺/空 Origin 放行**（非浏览器客户端）；无白名单，localhost/127.0.0.1/LAN 多入口靠 host 相等自然工作。② readBody 1MiB 上限 → 413 `payload-too-large`；**超限处置必须 resume+丢弃（释放缓冲、忽略后续 chunk、等 end 再 reject），禁 `req.destroy()`**——destroy 与响应 flush 竞态 → 客户端 Empty reply（curl exit 52 实测）；字节计量用 `Buffer.byteLength`（setEncoding 后 chunk.length 是 UTF-16 units）。③ 删除 = **改名-first 移入** `<root>/.sessions-trash/<UTC>-<projectKey>-<encodedId>/`：载荷先加 `.trash` 后缀再整目录 rename——**canonical 名落 trash 会被宿主 assertStoredIdentity 抛普通 Error、逃过 listArtifacts 的错误过滤 → 整个 list() 拒绝（会话列表全挂）**，实机逐字证实；manifest.json 尽力写（{id,cwd,deletedAt,files[{from,to}]}），恢复 = 按 manifest 去 `.trash` 后缀移回 `<root>/<projectKey>/<encodeSegment(id)>/`；每次成功删除后尽力清理 mtime>24h 条目（无 timer）。失败分相（#115）：**live → 500 `cleanup-failed` + `deletedLiveSession:true` + detachFromWorkspaces 记账**（会话已停止注销）；冷 → 500 `delete-failed` 不碰记账。**stash 阶段失败（载荷已改名、目录在位）后盲目重试 = 404**（列表隐身）——live message 必须指引 strip-suffix→delete-again（防回归锚 doesNotMatch /retry the delete/）；真机 live 配方：宿主 sessions.get() 只认本进程 enter() 过的会话，live 测试用 `POST /api/session/create`（create→enter），纯打开/行点击不注册。空白会话行无 ⋯ 钮 → 注入删除项物理不可达（宿主行渲染，非插件缺陷）。`session-delete-probe.mjs` 无删除断言（头注声明），删除契约断言面全在 `tests/delete-session.test.ts`。

### 0.1.5 抽屉 z 与遮罩

- **0.1.5 官方窄屏已是原生 overlay 抽屉，但插件**不放权**——抽屉与遮罩全代都归插件（2026-09-13 用户拍板，2026-09-14 修正文档）**：官方 `pI_x6G_sidebarCol` 是 `position:absolute; z-index:1100`（collapsed 52px rail / expanded 321px 拖宽把手），**实测无全屏遮罩**（内容仍可点）→ 插件继续用自己的抽屉列（`z-index:1300`，layout.css + base.css 的 1250 遮罩契约）与全屏 backdrop，覆盖所有代际。**别再按「代际让位」理解，也别再写「检测宿主代际」的钩子**（`data-mobile-nav-gen` 那套已删）；真要检测官方形态只能用结构类名（col 类含 `sidebarCol`）＋ computed position，**绝不能用 computed z-index**（检测跑在我们 CSS 在场时，读到的是自压值）；`z-index:40!important` 压官方 1100 曾让抽屉「有 box、computed 正常却不绘制不命中」，已由 1300 解决。升级对账点：`sidebarCol` 子串（0.1.5 哈希 `pI_x6G_` 会变）→ `pitfalls.md` §0.1.5 抽屉 z 与遮罩。
- **天窗带（overlayLayer）被抽屉整体压住——层叠上下文锁死，面板自抬 z 无效，必须抬上下文根（2026-09-22 实测）**：插件/宿主的弹层 portal 进 AppFrame `overlayLayer`（`position:absolute; z-index:20`，自成层叠上下文），而抽屉列 1300 在根上下文——面板把自身 z 抬到 9999 仍被盖（Playwright 390px 实测 elementFromPoint：z auto 与 z 9999 两态命中的都是抽屉元素），只有抬层根（overlayLayer → 1400）才露出。修法进 base.css「popover band」节：`body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed])) [class*="_overlayLayer"] { z-index: 1400 !important }`，与既有 dialog portal-root 抬升同形（「Raise the portal root, not the dialog」）。**边界划分（用户拍板 2026-09-22）**：此前逐面板抬升（菜单 1100 / dialog root 1000 / usage-stats 面板 100，#75）是**对外适配补丁**——各自 portal 在 body、不在本层，继续保留；本次是**自身层叠契约的类修复**，一类修完覆盖「大多数天窗」，不再逐面板打补丁。回归锚＝`tests/overlay-layer-band.test.ts`（gate 归属 + 1400 带 + 移动分支三断言）。关态与桌面维持宿主原生排序（gate 只在开抽屉态生效）。**被否决方案（2026-09-22 梳理）**：wholesale 抬 body 直挂 fixed 面板与降抽屉/遮罩 z 都不做——前者 blast radius＝宿主 toast/tooltip/隐形辅助层全被抬、桌面 no-op 承诺破产，后者复现 09-13 全黑事故；body 域新面板接入配方＝band 节同 gate 同 1400 加一条 4 行规则（锚该面板自有 data-* 标记）。

### 0.1.5 关态槽位

- **宿主更高特异度规则会静默压掉插件的抽屉槽位（0.1.5 实测，2026-09-17）**：关态只剩不在 transition 列表里的 width → 点击开关**无动画**（手势写 inline `transform !important` 幸存）。修＝同特异度重申槽位 + `closeDrawerAnimated(ctx)` 收口六个点击关闭入口 + 开态判定区右缘＝抽屉右缘（`openStateStartMode`）。探针须钉 `rect.left <= -rect.width`，只断「离屏」会漏 → `pitfalls.md` §0.1.5 关态槽位。

### 性能契约

- **流式期每帧热点性能契约**：stats-line 快路径 `statsAnchorAlive`（失位先摘旧标记再回落慢路径，scopes 恒 `['*']`）；installed-list 观察者走 `core/raf-scheduler.ts` rAF 合并（flush 重验 mq，dispose cancel）；抽屉会话树 `content-visibility:auto` 为会话数增大后的渐进增强；arm-open 冻结治本在宿主（React 互斥子树同步挂载），插件 CSS 只能消 layout/paint 份额 → `docs/maintenance/pitfalls.md` §性能契约。

### Shiki

- **宿主 Shiki 高亮止血 patch（已定：不重放，走上游）**：`tokenizeTimeLimit` 0→100ms 的手改已被宿主升级抹回 0；根治见 `docs/upstream/host-jank-feedback.md` §问题 2 → `docs/maintenance/pitfalls.md` §Shiki。

### 包改名边界

- **npm 包改名边界（2026-08-30：dsh-mobile-nav → dsh-web-mobile）**：包名、patch 行 id/name、client loader id、served 路径 `/plugins/dsh-web-mobile/`、style dataset `data-plugin` 与 CSS 动画名（`dsh-web-mobile-fade/sheet-in/sheet-up`）全部随新名；**刻意不改**：DOM 标记 `data-mobile-nav="frame"` 族与 `?mobile-nav-debug=1` 参数（用户可见契约，保持短且已文档化）。旧 npm 名 dsh-mobile-nav（2.2.0/2.3.0）已整包 unpublish、不可恢复；DSHA 的 vendored 副本仍是 `@dsh-external/dsh-mobile-nav`（2.1.x 代），不影响其 APK 运行，等它 re-vendor 才对齐。仓库目录名保持 `~/dsh-mobile-nav` 不改（AGENTS/Shiki patch 备份路径引用它，改目录名会断链）。本机换名需重跑 `dsh plugin --profile web add link:~/dsh-mobile-nav`。旧名用户的迁移契约：**必须 rm 旧名 → add 新名，不能并存**——patch 行 id 随包名一起换了，两行 bundle 会让宿主把同一插件加载两份（style/slot/locale 双重注册，locale 重复注册直接抛错）；旧名 unpublish 后死依赖会毒化 profile 的所有后续 install（与 /root 机 dsh-api-dashboard 404 同机制），所以这是强制迁移而非可选更新；README 包名说明里已附迁移命令。

### 字号轴

- **消息字号只读长写 `--dsw-font-markdown-base-font-size`（`-base` 是 `font:` 简写）；守卫断源串，勿遍历 DOM 级联（遍历须先判 `selectorText`，否则容器上抛错）→ `docs/maintenance/pitfalls.md` §字号轴。
### 两个 closer

- **只许一个抽屉 closer 武装**：`armNav()` 与 `closeOnNavigation()` 各自先 disarm 对方（disarm 即置 done，排队 `fire` 不再补 toggle）；`isTapWithinSlop` 逐轴 max-norm，勿改 `hypot`。**行导航不依赖合成 click 时序**：`armNav` 的 `aria-selected` 观察者 2000ms 自 disarm、document 捕获 click 在行 tap 后 500ms 让位（两者都在 `phone-chrome.ts`，曾误记为子代理芯片）→ `docs/maintenance/pitfalls.md` §两个 closer。

### ghost details

- **引擎会把「关闭态」`<details>` 的 body 渲染成幽灵层（settings-models 编辑器全按钮失灵的根因，2026-09-19 真机两案并发）**：提供商编辑器里「Customized models」是 `DETAILS.zGbnIq_customized`，关闭态本应只画 SUMMARY 行，但本机引擎把它的 `_customizedBody`（模型目录 ~1500px）**照常排版绘制**——ghost 层盖住编辑器自身动作行（Fetch/Cancel/Apply/Add model）与**DOM 顺序在编辑行之前的提供商行**（前面的行画在 ghost 下、命中被劫持），后面的行画在 ghost 上。宿主布局本按「关闭态」计算（editor 217px / rows 903px 全部正确），所以**解压方向（flex-shrink/height:auto）全无效**——注入整链 inline 也不动分毫；`details.open=true` 后一切立即正常（details 33→1532、Fetch 命中自己）。修复＝compat.css `details[class*="_customized"]:not([open]) > [class*="_customizedBody"] { display:none }`（恢复浏览器本应做的隐藏；对正常引擎零副作用）。用户症状「无法删除任何提供商 + 获取可用模型无反应」同一根因：编辑器 Cancel 也被 ghost 盖住关不掉 → ghost 常驻。取证时 `contentVisibility`/`display`/任何 sheet 禁用都不改变 ghost（它不是 author CSS 覆盖，是引擎渲染缺陷）。锚点：`scripts/probes/`（新增断言时用「编辑器开着 + elementFromPoint 命中编辑器内按钮」）→ `docs/maintenance/pitfalls.md` §ghost details。

### dialog footer 按钮

- **宿主 dialog footer 按钮白空间是 normal，宽度一挤就折行裁字（2026-09-19 真机）**：删除确认卡 footer 两按钮（`_button_cfgyt_4`，高 36px 单行设计）在窄视口/长提供商名/Android 字体放大（fontScale ~1.3）任一组合下标签折行，第二行被 36px 行高裁掉——用户看到的「按钮文字错行」。修＝compat.css：`[role="dialog"][aria-modal="true"] [class*="_footer"] { flex-wrap: wrap }` + footer 内 `button[class*="_button"] { white-space: nowrap }`（标签保持单行，空间不够时整按钮换行）。复现组合：320px 视口 + 18.2px 按钮字号，390px 正常字号不复现。**CSS 模板字符串注释里写反引号会终止模板串**（本次踩中仓库自己的「反引号」坑位：verify 报 TS1005）→ `docs/maintenance/pitfalls.md` §dialog footer 按钮。

### composer 文件入口

- **0.1.6 宿主删掉回形针 attach 按钮，文件入口只剩「+」菜单；插件把它加回输入区工具行（2026-09-19 真机 a2 实测）**：0.1.6-alpha.2 的 composer tools 行里只剩 `_add`（28×28、`display:grid`、`aria-haspopup="listbox"`、aria-label「添加文件或调用指令」）与权限控件，attach 按钮已删；`input[type=file]`（**无 class、`display:none`、`multiple`**）退化成 `_add` 的**同级兄弟**（`_tools` 的第 2 个子节点），「文件」是 `+` 菜单（`role="listbox"`，7 项）的第 0 项。**不要自己造上传链**：宿主 `ComposerKeyboard` 上确有 `pickFiles()`/`canPickFiles()`，但源码注释明写 *package-internal — handed through the composer-bar entry's inject, never across a plugin boundary*；`CommandUiRuntime` 的公开面只有 `register`/`decorate`/`dismiss`/`popupFor`（`invoke`/`execute` 私有），`InputActions` 只给 `addAttachments(ids)`（真正创建 File 的 `addFiles` 属包内私有 `ComposerBarInjected`）→ **插件无法正规调用宿主的 `file` 命令**。可用做法＝占宿主**公开声明**的 `conversation.input.left` list 槽（`slots.d.ts`："Compact controls at the left of the composer tool row"，无 owner props），渲染一个 28×28 控件，点击时 `card.querySelector('input[type=file]').click()` —— 与宿主自己的 `open()` 同一行（`fileInputRef.current?.click()`），摄入校验/上传/可用性判定全归宿主。**实测**（360px）：`_tools` 78→112、`_trailing` 226→192（余量由它吸收、车道缝仍 6px）、发送键 x 不动、卡片 `scrollWidth-clientWidth` 仍 0、按钮中心 `elementFromPoint` 命中自身；图片与 .md 均上传成功，.md 与手机原件 sha256 逐字节一致。**可用性门**：宿主判据 `canAcceptDrop`（`subagent === null && !locked && !machineBusy && addFiles !== undefined`）是包内私有，只能近似＝`useInput(s => s.phase !== 'plain')` + `useSession(s => s.subagent !== null)`（真机空闲态 `phase === "plain"`）。**新增 `data-mobile-nav` 控件必须同步进 misc.css.ts 桌面隐藏块清单**（已加 `[data-mobile-nav="file-upload"]`）。**注意触发路径需要瞬时用户激活**：`input.click()` 只能由真实手势触发，页内探针的程序化 click 无法验证，必须真机手指验。

### 代际门控

- **写「新宿主代适配块」时，跨代选择器必须在目标代专属类上做存在性门控（2026-09-19 PR #63 复查）**：只锚共享类（`_titleCluster/_crumbs/_headerActions/_headerUtilities/QsffPG_/ZKlsPq_`、`:first-child` 结构链、`[role="tablist"]`）的规则在**每个宿主代都命中**——初版 14 条 a2 头部适配规则直接打到 0.1.5-rc 宿主。最重一条：`header > :first-child > :first-child { flex: 0 0 auto !important }` 按 a2 DOM 写（第一个孩子是空 `headerLeading` 座位），但在 rc.6 命中的是同时装面包屑+动作区的 `wSkVaW_titleCluster`（宿主给它 `flex:1`），特异性 (0,4,1) 还压过同 diff 新加的 `_titleCluster{flex: 1 1 auto !important}`（(0,3,1)）→ rc.6 长标题按 max-content 取宽撑爆头部、动作区被推出屏外，旧「簇收缩 + crumbs ellipsis」契约失效。铁律：**新代块每条选择器带 `header:has([class*="_headerLeading"])`**（本次落地 36 处）；只有 `_headerLeading/_crumbCurrent/_crumbSeg/_headerCorner` 四类可当天然代际锚，其余哈希类两代都有。反向同理：新块与旧高特异性规则冲突时——实测旧 `position:static !important` (0,6,2) 压死新 `position:absolute !important` (0,4,1)，两条都 important 时**按特异性分胜负、与书写顺序无关**——修法是给旧规则补 `:not(:has([class*="_headerLeading"]))` 排除门控而不是删（rc.6 还靠它工作）。**合成 fixture 测不出这类互压**：#9 的合成元素没带 `> button[class*="_trigger"]` 子节点，旧规则在 fixture 上不命中、新规则假赢；跨代差异的实证来源＝直接读 node_modules 里 pin 的宿主 bundle 源码（rc.6 的 JSX/CSS module），不靠文档转述。配套修复：ComposerFileButton 在 rc.6 是死控件（rc.6 无 `input[type=file]`）→ `[data-composer-card]:not(:has(input[type=file]))` 特性检测隐藏；a2 空头部改名 `headerBlank` → 新旧两条 hide 规则并列；probe 5b/6b 断言接受两类名。

### 谓词复用与豁免

- **共享谓词加豁免前必须逐个核对每个调用方的提问语义（#82，2026-09-22）**：`shouldCloseOnTapInsideDrawer` 被三方复用——click/pointerup 的「点行关抽屉」、`onDrawerPointerDown` 的「长按武装门」。#76/#81 往里加 DSHA 行早退（`[data-dsha-session-select]` → false）后，点行关被修好，长按武装被**静默连带**：DSHA 行 `pressTimer` 永不装填，宿主 ⋯ 行菜单在触屏上的唯一入口（长按）失效——而 `openRowMenu` 是既有「抽屉行菜单」坑位里修了三轮才立住的路径。铁律：给被多方复用的谓词加条件前，先列出全部调用方，逐个问「这条新条件对你的问题意味着什么」；提问语义不同就**拆谓词**，不要用布尔参数糊两个问题。#82 修法＝抽出无豁免的 `isDrawerNavTarget`（modal/抽屉开/行内/非按钮四守卫）作武装门，`shouldCloseOnTapInsideDrawer = !DSHA && base` 留给关抽屉两调用方。意图边界：3624af5 提交原文只说「这些行不参与点行关抽屉」——豁免扩到长按属事故不属设计。回归锚＝`tests/dsha-long-press-gate.test.ts`（源码契约断言：武装门不得路由经豁免谓词；豁免与 marker 字面量只活在关抽屉谓词里）。

### 第三方模型条

- **trailing 车道的 slack 吸收者体系只认两种模型条形态：官方 pill（`:has(> _trigger[aria-haspopup="menu"])`，拿 auto）与缺席（subagent 场，meter 兜底拿 auto）；第三方 seat（@hytime/dsh-thinking-effort 的 `data-seat-root`，v0.2.3-v0.3.1 逐字节稳定）是第三形态——在场但无 `_trigger` 子节点（自己的 chip/panel 词汇表），两条吸收者规则全部静默失配（#60，2026-09-22）**：展开态 root 唯一子节点是绝对定位面板 → root 塌成 0 宽，面板 `right:0` 锚着 0 宽 root 的右缘往左扫 336px——393px 实测 root x=106、面板 left=-230（报障者实测：禁用本插件样式表后 root x=339、面板 +3，坐实责任在注入侧；`_trigger`/`aria-haspopup="menu"` 那族规则对 seat root 本就全不命中，`listbox` 不是 `menu`）。修法＝两根新规则锚 `data-seat-root`/`data-seat-panel`（纯增量，不改既有规则）：root `flex: 1 1 auto` + `justify-content: flex-end`（收起态 chip 焊右；伸展吃光自由空间后 flex 尺寸解析先于 auto margin，meter 兜底 auto 归零，无双空隙——这是**不改** meter 兜底规则的根据）；展开态面板 `left: 50%` + `translateX(-50%)` 把重心锚到伸展后的 root（与官方 `_menu` 居中同配方），插件自带 `min(336px, 100vw - 32px)` 宽度保证任意宽度不出屏。**报障者被否的 translateX 尝试败因＝没先修 root 位置**——0 宽 root 上的居中照样出屏；居中只在伸展后的 root 上成立。教训：给 trailing 车道写适配前先问「这条规则在模型条的第三形态下命中谁」；吸收者链每多认一种第三方 seat 就要显式教一次，换词汇表即失联。回归锚＝`tests/third-party-model-seat.test.ts`。

### 工作区 chip 再点关闭

- **hero 工作区 chip 的「再点关闭」被宿主 Menu 的「外部点击」吃到（2026-09-23，宿主 0.1.7-rc.1 源码对账）**：症状＝点 chip 打开工作区列表后，**再点 chip 关不掉**（列表原地不动，等于又开一次）。chip 自己是正常 toggle（`ui-conversation/src/client/skeleton/ConversationContent.tsx`：`onClick: () => { setPickerOpen(open => !open) }`），关不掉的原因在 `ui-workspace/src/client/WorkspacePicker.tsx` 的开法：`<Menu anchor={null} portal getAnchorRect={anchorRef.current.getBoundingClientRect} …>` —— `anchor={null}` 意味着 Menu 的 `rootRef` 是一个**空 span**，触发器 chip 在 Menu 子树**之外**，而 `ui-primitives/src/Menu.tsx` 的关闭判定只豁免这两个子树：

  ```ts
  const onPointerDown = (e: PointerEvent) => {
    if (rootRef.current?.contains(e.target) === true) return
    if (listRef.current?.contains(e.target) === true) return
    onClose()
  }
  ```

  ⇒ 第二击的顺序是：`pointerdown` 被判成外部点击 → `onClose()`（状态翻 false）；紧接着的 `click` 到达 chip 的 `onClick` → 又翻 true。**旁证**：同行的「预设」触发器传的是 `anchor={<button …/>}`（按钮在 rootRef 内），pointerdown 不被判外部，所以它没有这个毛病——同一份 Menu 代码，两种接线。

- **修法（只吞这一击 click，宿主路径不动）**：`effects/workspace-chip-toggle.ts`。`pointerdown` **捕获**阶段：chip 自报 `aria-expanded="true"` 且宿主的 portal 菜单（`[role="menu"]`）在场时记下这一击；`click` **捕获**阶段：同一 chip 的 click 直接 `stopPropagation()`——React 挂在 root 容器上的 onClick 不再执行，chip 的 toggle 不会被翻回「开」，宿主 pointerdown 的那次关闭成为唯一结果（同型：`composer-plus-toggle.ts` 吞 click 挡 React 委托；`subagent-chip-touch.ts` 的 `toggledTrigger` 宽限窗）。菜单本来就关着时（第一击的开启路径）完全不介入。

- **为什么不读 DOM 判开态、也不补发合成事件**：开态必须在 `pointerdown` 阶段读 `aria-expanded`——React 18 对「原生 listener 里的 setState」是 NormalPriority 调度（MessageChannel 宏任务），到 `click` 时 portal 可能**还没卸载**，此刻 `document.querySelector('[role="menu"]')` 读到的可能是未冲刷的旧树；而 `aria-expanded` 在 pointerdown 时必然是这一击之前的真实值。补发合成 `Escape`/`pointerdown` 的路线已否决：Escape 会同时打到插件自己的抽屉关闭与宿主 modal 的 document 级监听（`composer-plus-toggle` 就是因为这个才必须把 Escape 派发在编辑器元素上），合成 pointerdown 同理有 blast radius。

- **选择器与跨代边界**：chip 锚 `[class*="heroWorkspaceRow"] > button[aria-haspopup="menu"]`——**直接子**是关键，预设触发器在 Menu 的 anchor span 里，加 `>` 才不会误伤（它的接线是好的，吞它的 click 会让菜单关不掉）。整条效果走 `installMobileEffect`（`MOBILE_QUERY` 门控），桌面零介入（那里同一处宿主缺口依然存在，但不属于本插件范围）。回归锚＝`tests/workspace-chip-toggle.test.ts`（选择器/捕获阶段/开态读法/唯一 stopPropagation/dispose 五项源码契约）。

### 全屏侧边栏面板带

- **0.1.7 全屏右侧边栏面板（终端 / 文件 / 预览 / 浏览器 tab）压在插件浮层之上：手机上唯一的抽屉入口点不到（2026-09-23，真机 dsh web 0.1.7-rc.1 实测）**：宿主在 fullscreen 档把 `--dsh-dockkit-dock-layer` 设成 **40**（`.panel[data-sidebar-right-panel='fullscreen']`），dockkit 的 tabCell 于是拿 z 40；而宿主 AppFrame 的 overlayLayer 只有 **20**、本插件 FAB 只有 **21** —— 面板一开就盖住这两者。宿主在桌面是有意的（fullscreen 面板 > frame overlays），但手机上 FAB 是面板占住主区后**唯一**的返回/抽屉入口（见 `overlay-backdrop-fab.ts` 的 FAB 第二张脸），被盖住即全断。
- **实测（390×844，headless 真浏览器打真宿主）**：面板开着时 `elementFromPoint`(FAB 中心) 命中面板子节点（`hitInPanel: true`），真实 tap 后 `data-sidebar-collapsed` 仍为 true（抽屉没开）；同一次修复后：FAB `z-index: 55`、命中自身、tap 打开抽屉、Escape 关上。第 1 处 chip 的 A/B 同批跑（见「工作区 chip 再点关闭」）。
- **修法**：`base.css.ts` 的 mobile「popover band」节加一条同形 gate——`body:has([data-sidebar-right-open][data-sidebar-right-panel="fullscreen"])` 下把本插件 FAB 抬到 **55**（本插件「抽屉之下」带：仍在遮罩 1250 / 抽屉 1300 之下，抽屉开着时照旧被盖住，不回退 09-13 的遮挡事故），并把 `[class*="_overlayLayer"]` 抬到 **1400**（与抽屉 gate 同值；两条 gate 同值时无论哪条胜出结果一样，不会出现「右侧栏开着反而把层压低到抽屉之下」）。**门必须带 `[data-sidebar-right-open]`**：`data-sidebar-right-panel="fullscreen"` 是展示档、面板关着也在（实测 restore 后仍在），只按它会把 band 常驻抬高、FAB 就会浮在打开的抽屉之上。docker 档（层 10）本来就低于 FAB 21，不进这条门。
- **被否决**：把 FAB 抬到 1400（会浮在打开的抽屉上）；只抬 `_overlayLayer` 不抬 FAB（FAB 是 frame 子节点、不在该层里，实测 `fabChain[0] = pI_x6G_frame`)；降抽屉/遮罩 z（09-13 全黑事故）；按面板逐个打补丁（宿主的 fullscreen 档是通用形态）。回归锚＝`tests/overlay-layer-band.test.ts` 三条新断言（FAB 带值区间、overlayLayer 同值、门必须含 open 属性）。
### 搬宿主 React 节点

- **禁令：不要把宿主（或第三方 React 组件）渲染的节点搬出它渲染时的父节点**（#104 实锤，2026-09-24 修）。React 卸载该节点时按它自己记录的父容器调 `parent.removeChild(child)`，节点已被搬走就抛 `NotFoundError`。这个异常**不会出现在 uncaught 通道**——它被 `SlotErrorBoundary` 吞掉并把整个槽位渲染成空壳；运行时取证必须 hook `Node.prototype.removeChild` 数「child.parentNode !== this」的未命中（报障者方法，与 uncaught 监听互补）。
- 触发链（手机端必踩）：断网 ≥15s → 重连 → 宿主重建 composer 子树 → 旧子树卸载 → 被搬走的节点在 removeChild 处炸 → composer bar 槽位整块消失（输入框没了），刷新才恢复。回归锚 `scripts/probes/stats-line-offline-probe.mjs`（断网重连 11 断言；A/B 已证：old bundle 红相 = composer 消失 + removeChild 未命中 1 + slot-error 1，new bundle 全绿）。
- 修复范式 = **overlay**：宿主节点留在 React 渲染它的位置；插件自建占位节点（`stats-ring-reserve` / `stats-tps-reserve`，React 不认识、卸载不经过它）顶住视觉槽位；宿主节点 `position:absolute` 用 JS 算的坐标盖回占位（reserveRect − containerRect − clientLeft/Top，自洽于真实 positioned ancestor）；坐标每帧 flush + `resize`/`visualViewport.resize` 重算（软键盘弹出无 DOM 突变，靠 viewport 事件补）。dispose 清坐标/标记/占位。契约锁 `tests/stats-line-overlay.test.ts`。
- **修复范式 2 = A′ 重锚定（#105，2026-09-24）**：当宿主节点的视觉目标位与其 React 家只差**定位**时，不搬节点、不建占位——留宿主节点在 React 家，用 CSS 把「共享祖先」变成 containing block（宿主节点 `position:absolute` 锚在其内）。实测两例：git-graph chip（composerStack static→relative，anchor `top:12px`/hero `134.9px`·`left:28px`；44px 净空键从卡级 `:has(chip)` 上移到 stack 级）；设置工具栏（dialog 本身 `position:absolute` 即 containing block，`top:10px; right:12px`；navList `margin-right:42px` 让 nowrap 横滚条视口止步于工具栏区——这代宿主的 tab 条是 `overflow-x:auto` 滚动条，强制 `flex-wrap` 赢不了它）。选型判据：要**嵌进行内流**（与兄弟共享一行布局）→ overlay/占位；只**钉在某个矩形角**→ A′ CSS 重锚定（零 JS、零每帧计算、dispose 零动作）。A′ 常数是对当前宿主布局的 T0 CDP 实测，宿主改版会漂——探针钉几何（±2px）兜住。
- **同型雷已拆（#105，2026-09-24）**：`git-chip-reparent.ts` 与 `settings-toolbar-reparent.ts` 均按 A′ 重锚定拆除——chip/工具栏节点留 React 家，CSS absolute 钉位，两任务与注册一并删除；回归锚 = `stats-line-offline-probe.mjs` G 段（chip 在场才咬合）+ `plugin-card-header-bleed.mjs` A′ 契约段 + 主探针 `gitgraph.docked`/`chip-anchored`。
### 弹层闪

- **「快捷键弹层打开/唤起键盘时抽搐、闪」的根因是本插件自己的抽屉层叠带压过宿主弹层 portal 根，不是合成撕裂**（2026-09-25，真机 dsh web 0.1.7-rc.2 + Android 16 WebView 取证）。三层 z 关系：宿主弹层 portal 根 `._root_17i0t_6 { position:fixed; inset:0; z-index:1000 }`（包住 `[role="dialog"][aria-modal="true"]`，`_dialog` 自身 z 1）＜ 本插件全屏遮罩 `[data-mobile-nav="backdrop"]` **1250**（`rgba(0,0,0,.45)`）＜ 抽屉列 **1300**。兜底规则原本以「抽屉开着」为门（`body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed]))`）把根抬到 1400，**而 marker 与绘制在整个关闭过渡里是不一致的**：遮罩淡出 `.2s` 且 marker 翻转后 **260ms** 才移除（`overlay-backdrop-fab.ts` 的 `BACKDROP_FADE_MS=200` 再 +60），列 `transform .28s`，React 还要 ~200ms 才换 pane 子树。这个 200–280ms 窗口里抬升失效 → 遮罩 + 抽屉列盖住任何开着的弹层。
- **真机实验（决定性，可复跑）**：弹层开着时人为给 frame 加 `data-sidebar-collapsed`，逐帧读：根的计算 z **1400 → 1000**；`document.elementsFromPoint(0.85w, .30h)` 命中的最顶层元素变成 `[data-mobile-nav="backdrop"]`（翻转前命中弹层内的行按钮），还原后回到 1400。受控复现截图量测：抽屉面 247–250，遮罩带 **141** = 255×(1−0.45)，暗带左界 **285 CSS px** —— 与报障人录屏同法量到的 **140 / 280px** 一致。
- **修法**：抬升的门从「抽屉开着」换成「**本插件遮罩在场**」——`body:has([data-mobile-nav="backdrop"]) > div:has(> [role="dialog"][aria-modal="true"]) { z-index: 1400 !important }`。遮罩在屏正是伪影成立的必要条件，且它与绘制同步、没有状态与绘制的时差窗口；没有遮罩时保持宿主原序（弹层 1000 与宿主菜单 1100 的相对关系不变，「弹层里开菜单」不受影响）。加固面：所有非手势关闭入口共用一个 `toggleDrawer(ctx)`（`phone-chrome.ts` 导出，= `if (!closeDrawerAnimated(ctx)) ctx.layout.toggleSidebar()`），让「先滑出去、再翻 marker」成为唯一关闭路径；手势模块内部的 `commitFollowClose` 晚提交契约不动。
- **被证伪/打偏的方向**：`backdrop-filter`、`will-change`、`.2s max-height` 过渡（按「合成撕裂」猜的三条；真机 `env` 探针显示 `--dsw-mask-blur` 与 `--dsw-alias-bg-mask-1` 为空、页面上没有任何 backdrop-filter，`will-change` 生效后症状不变）；把无头环境当判据（布局类结论有效、合成类无效，撕裂一次都没复现出来）。**残留**：录屏 10.60s 那一帧弹层白底只画到 x≈280 而行文字仍全亮，像「抽屉层背景瓦片未及时栅格化」的合成成分；主修把抽屉带整体压到弹层之下后若仍有余影，再按纯栅格问题单独定位。
- 回归锚＝`tests/shortcut-modal-flash-band.test.ts`（抬升门必须是遮罩在场、band 值 1400、非手势关闭入口共用 `toggleDrawer`）。
- **（同一坑的另一半）手机档卡片不能拿视口单位定高**（2026-09-25，真机实测）。软键盘一唤起，Android WebView（adjustResize）把布局视口从 **754 压到 471**，而且 `vh` / `svh` / `lvh` / `dvh` **四个单位一起吃这个变化**（四个都实测到 471，`innerHeight` / `visualViewport.height` 同步）——这台引擎上没有任何 CSS 单位能躲开键盘。后果：凡是按视口定高的卡片都随键盘缩一截。宿主快捷键弹层自己的 CSS 就是 `height:600px; max-height:calc(100dvh - 108px)`，插件手机档还额外写了 `max-height: min(7xxpx, calc(100dvh - …))`，于是设置面板与快捷键卡片**各缩一次**；报障人在「编辑快捷键」里点搜索框时看到的那一步（「又闪一下」）。上一版给 `max-height` 加 `.2s` 过渡，只是把这一步变成 **150ms 的连续塌陷**（实测 600px → 447.25px，中间 6 档，每帧重排重绘整张卡与它的滚动列表）——报障人后续的「还是抽」就是它。
- **修法**：利用「键盘只改高度、不改宽度」，在视口效果里维护 `--dsh-web-mobile-vh`（**只在高度变大或宽度变化时更新**，因此恒等于键盘不在时的视口高度），两层卡片用它定高；键盘出现时卡片一动不动，由键盘自然盖住下半截。够不着的内容用**列表的键盘内边距**补齐：`padding-bottom: calc(18px + max(0px, var(--dsh-web-mobile-vh, 100dvh) - 100dvh))` —— 改的是滚动内容而不是可见外框，所以屏幕上仍然什么都不动。`.2s` 过渡保留（此时只在旋转等真实视口变化时才触发）。
- **真机回归**：修复后同一实验，`ih` 仍在 754↔471 之间变，但卡片 3086 帧全程 `h=600px`、矩形恒为 `[8,12,344,600]`（修复前 600 → 447.25）。回归锚＝`tests/stable-viewport-keyboard.test.ts`（3 断言：变量维护规则 / 两条 `max-height` 必须用它且不得留裸 `100dvh` / 列表键盘内边距）。
- **被否决**：给 `max-height` 加过渡（把跳变成慢动作抽，实测无效）；`interactive-widget=resizes-visual`（会连 composer 一起不再避让键盘，爆炸半径过大）；用 `svh`/`lvh` 替代 `dvh`（实测同样随键盘变，无效）。

