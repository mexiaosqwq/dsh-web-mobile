// 架构合规门：把「代码归拢」的标准变成 CI 能拦的规则，而不是靠人记。
// 依据：代码归拢与架构标准_可执行版.md（§2 目标结构 / §3 可机检标准）。
// 台账（DEBT）不是豁免，是债务：每条都注明在哪一阶段清掉；只许缩短 ——
// 若某条债务已经不存在，本测试会要求你把它从台账里删掉（自证非空转）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const LINE_BUDGET = 400

const DEBT = {
  // P1 已完成（2026-10-11 B1）：7 个 effects 的运行时环已打散——共享符号
  // （getFrame/findFrame、MOBILE_QUERY 系列、installMobileEffect、detectIosWebKit）
  // 提到 platform/，环内 6 个文件不再 import phone-chrome。这条台账现在为空，
  // 反向自检要求它继续保持为空：任何新增的运行时环都会让 R1/R3 直接红。
  cycle: [],
  // P2/P3 清：超过行数预算的非 CSS 模块（上限即快照：只许带理由在同一提交里
  // 上调，P2 拆分后必须大幅下降）
  bigFiles: {
    'src/client/effects/sidebar-swipe.ts': 1593, // C01/C03 修复 +8；P1 搬运 import 拆行 +1（platform/breakpoints + platform/frame）
    // 2026-10-12：phone-chrome.ts 876 → 504（第一块 drawer-close 取走抽屉关闭三路监听与共享
    // toggleDrawer）→ 442（第二块 header-metrics 取走顶栏高度那一块）→ 393（第三块
    // selection-chrome 取走选区标记那一块）→ 279（第四块 reconciler-adapter 取走 reconciler
    // 实例 / 任务注册面）→ 147（第五块 viewport-meta 取走 viewport meta 所有权 / 稳定视口高度 /
    // iOS 标记）后回落进 400 行预算，条目按「只许收紧」删除（同 index.tsx 那条先例）。
    'src/client/effects/session-menu.ts': 538, // P1 搬运 import 拆行 +1（getFrame 落 platform/frame，toggleDrawer 留 phone-chrome）
    'src/client/effects/panel-exit.ts': 651, // P1 搬运 import 拆行 +1（getFrame 与 installMobileEffect 分属 platform 两个模块）
    // 2026-10-20 +110（485 → 595）：面板子页「返回上一级」。宿主把 列表/更多/详情 做成
    // 同一个面板里的 view 状态（无 history、无叠层、无服务面），一次 pop 只能整层退出。
    // 新增行 = PANEL_SUBPAGE_BACK 四条锚点 + 为什么只能点宿主控件（不许跨包拿 store action）
    // 与三条被否方案的理由注释 + subpageControl/subpageOpen/back 三个闭包 + arm() 从
    // ensure() 抽出（子页 pop 后必须补回 entry，否则下一次返回直接离开页面）+
    // createPanelBackExitTask 的第四个参数与子页分支。行为由
    // tests/panel-exit-animation.test.ts 的 DOM 桩用例钉住（子页只点宿主控件不退出、
    // 根页才 selectPanel）。
    // 2026-10-20 +6（595 → 601）：真机复测「子页第二下返回直接退出 web」——
    // popstate 内发出的 pushState 被 Android WebView 丢弃；补 entry 改由下一帧的
    // ensure() 做（代码只删掉 popstate 里的 arm()，新增行是这段实测结论的注释）。
    // 2026-10-20 +9（601 → 610）：退面板会弹键盘 —— exit() 在挂退场标记的同一步同步广播
    // dsh-mobile-panel-exit，让 composer 焦点窗口赶在会话重挂载的同步聚焦之前打开。
    // 新增行 = 事件常量 + 广播 + 为什么必须同步（observer 微任务赶不上）的理由注释。
    // 2026-10-20 +25（610 → 635）：第二下返回仍然离开 web —— 同一个遍历任务里（含
    // 紧随的 rAF）发出的 pushState 都会丢，补 entry 改排到 setTimeout(0) 的新任务；
    // 新增行 = scheduleRearm（含幂等与复查）+ dispose 清理 + 两段实测理由注释。
    // 数值口径同本门：split('\n').length。
    // 2026-10-13 +12（473 → 485）：C02-a/C02-b —— 快照与 frame 标记都改成按归属处理。
    // 新增行全部是理由注释（freezePanel 为什么不能按标记扫全文档、finishMain 为什么
    // 摘标记要过归属判断、dispose 的归属说明）；扫全文档的那 5 行同时被删掉。
    // 行为由 tests/panel-exit-animation.test.ts 的 DOM 桩用例钉住（不是纯文本断言）。
    // 2026-10-13 +7：selectPanel 裸调改 try/finally（宿主抛错会留下全屏 ghost 永不自清，
    // 且两个兜底计时器都装不上）；新增行全部是那一处 finally 块与理由注释。
    // 2026-10-13 +121（443 → 564）：消掉本效果仅存的每帧全栈查询。
    // 新增行 = 两个可测纯核（resolveTpsForKey 三级短路 + tpsSlotsSettled 定态判据）
    // + TpsLocated 类型从工厂内部提到模块级（纯核要用同一形状）+ 共用选取判据
    // isRingCandidate 与零查询身份校验 ringIdentitySettled（#194：React 换掉环时旧节点
    // 可能仍连着，liveness 看不出来；旧版靠「TPS 缺席永不 skip」这条副作用兜住，
    // 现在缺席也能 skip，必须自己验身份）+ 两处 key/跳过判据的理由注释。
    // 数值口径同本门：`split('\n').length`（= `wc -l` + 1）。
    // 2026-10-17 +23（564 → 587）：0.2.1 把 StatsPills 拆成 activity/usage 两个 slot 条目，
    // composerStack 内不再有共同的 `_root`，只认 `_root` 的候选集让标记永远打不上（整条 stats
    // 与环的 CSS 集体哑火）。新增行 = 抽出 locateRing（按「谁的 children 里有环候选」向上找
    // dock，取代 measureRing / ringIdentitySettled 两处写死的两级上溯；0.2.1 标记落在 slot 包装
    // 上，固定两级会越过 dock；并封顶在 composerStack，否则一路扫到 body 会把会话正文里带
    // 「50%」的块误判成环）+ 候选集改两档的循环壳 + 三段理由注释。判据本体（文本锚 /
    // popover 按钮 / 输入框排除）一个字未动，旧代标记落点也不变（`_root` 档先查）。
    'src/client/effects/stats-line.ts': 587,
    // 2026-10-13 +90（399 → 489）：浮层落位的三处去重（写前比较 / 几何改读 visualViewport /
    // 12 帧 follow 期间不重复排程）。新增行全部是：抽出的落位纯核 computePickerPlacement
    // （+ PickerAnchorBox / PickerSize / PickerVisibleBand 三个类型 + 可见带解析 visibleBand()，
    // 无 DOM、数值由 tests/composer-file-picker-bridge.test.ts 钉住）、GAP/EDGE 由 openSheet
    // 局部 hoist 到模块（纯核与 DOM 两侧共用）、以及「键盘跟随靠什么保持」那段必写的理由注释
    // （任务要求写明机制；按本仓规矩不靠删注释凑行数）。没有新增模块级可变状态。
    // 数值口径同本门：`split('\n').length`（= `wc -l` + 1，文件以换行结尾）。
    'src/client/effects/composer-file-picker.ts': 490,
    // P3（2026-10-12）：index.tsx 412 → 314（installed-list 行内业务块搬到
    // effects/installed-list.ts）后回落进 400 行预算，条目按「只许收紧」删除。
  },
  // P4 清：模块级可变状态（每文件允许的上限）
  moduleState: {
    'src/client/effects/sidebar-swipe.ts': 20,
    'src/client/effects/phone-chrome.ts': 1, // P1 拆分（2026-10-12）：6 → 5（drawer-close）→ 3（header-metrics 取走 observedHeader / headerObserver）→ 2（selection-chrome 那一块无模块级状态）→ 1（reconciler-adapter 取走 reconcilerInstalled / reconcileTasksRegistered；实测）
    'src/client/effects/reconciler-adapter.ts': 2, // P1 拆分第四片（2026-10-12）：reconcilerInstalled / reconcileTasksRegistered 从 phone-chrome 平移（平移，不是新增债务）
    'src/client/effects/header-metrics.ts': 2, // P1 拆分第二片（2026-10-12）：observedHeader / headerObserver 从 phone-chrome 平移（平移，不是新增债务）
    'src/client/effects/drawer-close.ts': 1, // P1 拆分第一块（2026-10-12）：touchDownAt 随 installOverlayInteractions 从 phone-chrome 平移（平移，不是新增债务）
    'src/client/platform/frame.ts': 1, // P1：同上——getFrame 的记忆化缓存，P4 状态对象化时再谈
    'src/client/effects/panel-exit.ts': 2,
    'src/client/core/prototype-focus-shadow.ts': 1,
    'src/client/effects/composer-file-picker.ts': 1,
    'src/client/effects/gesture-guard.ts': 1,
    'src/client/effects/overlay-backdrop-fab.ts': 1,
  },
  // P3 清：组合根里的内联业务（2026-10-12 搬运 installed-list 块：6 → 2，实测值）
  entryInlineQueries: 2,
  // P1 已完成：components → effects 的越界随 getFrame 落 platform/frame 消失。
  // 反向自检要求它继续保持为空。
  layerViolations: [],
}

const walk = (dir) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const FILES = walk(join(SRC, 'client'))
const rel = (file) => relative(ROOT, file)
const source = new Map(FILES.map((file) => [file, readFileSync(file, 'utf8')]))

/** 只有 src/client 内部的相对 import 才算架构边（peer 包与 node: 不算）。 */
function edgesOf(file) {
  const out = new Set()
  for (const match of (source.get(file) ?? '').matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = resolve(dirname(file), match[1])
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`]) {
      if (source.has(candidate)) { out.add(candidate); break }
    }
  }
  return out
}

/** Tarjan：返回所有成员数 > 1 的强连通分量（= 运行时环）。 */
function cycles() {
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [], found = []
  let counter = 0
  const walkFrom = (node) => {
    index.set(node, counter); low.set(node, counter); counter += 1
    stack.push(node); onStack.add(node)
    for (const next of edgesOf(node)) {
      if (!index.has(next)) { walkFrom(next); low.set(node, Math.min(low.get(node), low.get(next))) }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)))
    }
    if (low.get(node) === index.get(node)) {
      const component = []
      let popped
      do { popped = stack.pop(); onStack.delete(popped); component.push(popped) } while (popped !== node)
      if (component.length > 1) found.push(component.map(rel).sort())
    }
  }
  for (const file of FILES) if (!index.has(file)) walkFrom(file)
  return found
}

// R3 的**机检口径要说清楚**（2026-10-11 B1 后补，免得下一位读者以为「effects 互不
// import」已经被全量拦住）：本门拦的是「运行时环」（SCC > 1）+ 那条 7 文件白名单，
// **不拦非环的 effects → effects 边**。B1 清掉的是环（6 条回边）与 components→effects
// 越界；剩下的 **21 条非环边**（P1 拆分第三/四/五片 2026-10-12 后逐条实扫；第一片后
// 16 条。第四片把 registerReconcileTasks 连同它的 6 条 effects 依赖移到
// reconciler-adapter（phone-chrome 的 7 条只剩 header-metrics 1 条），第三/四/五片
// 又各给 phone-chrome 添 1 条新边 → 3 条；reconciler-adapter 自己 9 条，含 2026-10-18 的 drawer-session-log 与 2026-10-20 的 image-lightbox-zoom）仍在，
// 尚未机检：
//
//   effects/reconciler-adapter.ts → aionui-compat·drawer-close(toggleDrawer)·
//                             file-viewer-compat·overlay-backdrop-fab·panel-exit·
//                             preview-fullscreen·stats-line·drawer-session-log·image-lightbox-zoom (9)
//   effects/drawer-close.ts → gesture-guard·session-row-fiber·sidebar-swipe       (3)
//   effects/phone-chrome.ts → header-metrics·reconciler-adapter·viewport-meta     (3)
//   effects/session-menu.ts → drawer-close(toggleDrawer)·session-row-fiber        (2)
//   effects/sidebar-swipe.ts → gesture-guard·overlay-backdrop-fab                 (2)
//   effects/overlay-backdrop-fab.ts → panel-exit(类型)                            (1)
//   effects/session-focus-guard.ts → composer-keyboard-guard                      (1)
//                                                                   合计 21 条（实测）
//
// 清法就是架构标准 P1 的第 ③ 步「跨特性工厂由组装根注入」：把 toggleDrawer /
// fadeOverlayOut / 共享类型提到 platform/，或由 index.tsx 注入；清完再把本门收紧成
// 「effects → effects 除白名单外一律 fail」。在那之前，**别把这个缺口当已机检**。
test('R1/R3 运行时 import 环：只允许台账里登记的那些', () => {
  const found = cycles()
  const flattened = found.flat()
  const unknown = flattened.filter((file) => !DEBT.cycle.includes(file))
  assert.deepEqual(unknown, [], '新增运行时环——把共享符号提到 platform/ 或由 index.tsx 注入（见架构标准 §2）')

  // 反向自检：台账里已经不在环里的条目必须删掉，保证这个检测器不是空转。
  const stale = DEBT.cycle.filter((file) => !flattened.includes(file))
  assert.deepEqual(stale, [], '台账过期：这些文件已经不在环里，请从 DEBT.cycle 删除')
})

test('R2 分层方向：core 不依赖上层，components 不依赖 effects', () => {
  const violations = []
  for (const file of FILES) {
    const self = rel(file)
    const targets = [...edgesOf(file)].map(rel)
    if (self.startsWith('src/client/core/')) {
      for (const target of targets) {
        if (/^src\/client\/(effects|components|platform)\//.test(target)) {
          violations.push(`${self} → ${target}（core 只能依赖 core）`)
        }
      }
    }
    if (self.startsWith('src/client/components/')) {
      for (const target of targets) {
        if (target.startsWith('src/client/effects/')) violations.push(`${self} → ${target}`)
      }
    }
  }
  const unknown = violations.filter((line) => !DEBT.layerViolations.includes(line))
  assert.deepEqual(unknown, [], '新增反向依赖——把共用符号提到 platform/ 或由 index.tsx 注入（见架构标准 §2）')
  const stale = DEBT.layerViolations.filter((line) => !violations.includes(line))
  assert.deepEqual(stale, [], '台账过期：这些越界已经消失，请从 DEBT.layerViolations 删除')
})

test('R4 core 纯度：不得出现 DOM 全局', () => {
  const violations = []
  for (const file of FILES) {
    if (!rel(file).startsWith('src/client/core/')) continue
    if (/\b(document|window|HTMLElement)\b/.test(source.get(file))) violations.push(rel(file))
  }
  assert.deepEqual(violations, [], 'core/ 必须零 DOM（纯函数、可直接单测）')
})

test('R5/R6/R7 债务只许缩短：模块级状态、文件行数、入口内联业务', () => {
  const overState = []
  for (const file of FILES) {
    const count = (source.get(file).match(/^(?:let|var)\s+\w+/gm) ?? []).length
    const allowed = DEBT.moduleState[rel(file)] ?? 0
    if (count > allowed) overState.push(`${rel(file)}: ${count} > ${allowed}`)
  }
  assert.deepEqual(overState, [], '新增模块级可变状态——改为每次 apply 拥有的实例对象（见架构标准 §2）')

  const overSize = []
  for (const file of FILES) {
    if (/styles\/.*\.css\.ts$/.test(rel(file))) continue
    const lines = source.get(file).split('\n').length
    const allowed = DEBT.bigFiles[rel(file)] ?? LINE_BUDGET
    if (lines > allowed) overSize.push(`${rel(file)}: ${lines} > ${allowed}`)
  }
  assert.deepEqual(overSize, [], `非 CSS 模块不得超过 ${LINE_BUDGET} 行（拆到 platform/ 或按职责分文件）`)

  const entry = source.get(join(SRC, 'client/index.tsx'))
  const inline = (entry.match(/querySelectorAll|querySelector\(/g) ?? []).length
  assert.ok(inline <= DEBT.entryInlineQueries,
    `index.tsx 内联查询 ${inline} > ${DEBT.entryInlineQueries}——业务块请抽成 effects/ 模块`)
})
