// 2026-10-07 真宿主取证（390x844 触屏仿真、锚点在消息流内、按住 1.4s）：
// 手机档选区拖拽的自动滚动**速率由「拖点超出滚动区顶边的距离」决定**——
// y=140/100（区内）→ 0 px/s，y=70 → 1018，y=50 → 2225，y=30 → 3329，y=10 → 3232 px/s。
// 而会话滚动区的顶边正好被顶栏压在 y=67 ⇒ 顶栏那 67px 整块都是加速带，手指在顶栏上
// 任何位置都落在 2200-3300 px/s 档（一屏 777px ≈ 0.23s），观感就是「抽帧式跳到上面」。
// 修法：把滚动区盒子铺到顶栏底下（盒子向上长 H、padding-top 补 H，视觉位置等价），
// H 由 reconciler 任务 header-metrics 量出来写进 --mobile-nav-header-h。
// 本文件是源码不变式审计（无 DOM）；行为层读数见
// docs/handover/2026-10-07-mobile-ui-selection-scroll-findings.md §7。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { findRuleBlocks } from '../src/client/core/css-rules.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'

const ROOT = new URL('..', import.meta.url).pathname
// P1 拆分第二片（2026-10-12）：header-height 那一块（常量 / 两个模块级状态 /
// publishHeaderHeight / syncHeaderHeight / header-metrics 任务）已搬进
// header-metrics.ts。本文件钉的断言有一半在那一块里，所以读取面拼成两半——
// 负向断言（!includes）与正向断言（includes/match）在拼接下语义都保持不变。
const CHROME = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')
  + readFileSync(join(ROOT, 'src/client/effects/header-metrics.ts'), 'utf8')
// P1 拆分第三片（2026-10-12）：选区标记那一块（SELECTING_ATTR /
// selectionLivesInConversation / installSelectionChromeYield）已搬进
// selection-chrome.ts，所以钉它的四条断言改读那一份（各读各的文件，
// 覆盖面积与原文件上的断言完全一致）。
const SELECTION = readFileSync(join(ROOT, 'src/client/effects/selection-chrome.ts'), 'utf8')


/** Body of the phone-tier media block (brace-walked, so nested at-rules are kept). */
function phoneBlock(css: string): string {
  const start = css.indexOf('@media (max-width: 1023px) and (pointer: coarse) {')
  assert.ok(start >= 0, 'phone-tier media block present')
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  return css.slice(start)
}

/** Body of the rule whose selector starts at `at` (brace-matched, so a nested
 *  block cannot truncate it). Needed because a substring search for the plain
 *  header selector also matches the longer `html[data-mobile-nav-selecting] ...`
 *  arm — anchor on the rule's own line instead. */
function bodyAt(css: string, at: number): string {
  assert.ok(at >= 0, 'rule not found')
  const open = css.indexOf('{', at)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return ''
}

/** Props declared in a rule body, deduped and sorted. */
function propsOf(body: string): string[] {
  return [...new Set(body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean))].sort()
}

test('the phone scroll body extends up under the header (compensated geometry)', () => {
  const phone = phoneBlock(LAYOUT_CSS)
  const at = phone.indexOf('\n  [data-mobile-nav="frame"] [data-phase] [class*="_scrollBody"] {')
  const block = bodyAt(phone, at)
  assert.match(block, /margin-top:\s*calc\(-1 \* var\(--mobile-nav-header-h, 0px\)\) !important/)
  assert.match(block, /padding-top:\s*var\(--mobile-nav-header-h, 0px\) !important/)
  // 变量缺席时必须是 no-op（hero / 空顶栏 / 宿主换形态都靠这条 fail-open）。
  // 例外只有一条：提问卡的满屏带（layout.css.ts 的 ask-question-card-phone 节）刻意写成
  // **裸** var —— 它靠「自定义属性 guaranteed-invalid ⇒ 消费端 var() 回落宿主
  // min(60vh,520px)」实现 fail-open；在这里补 0px 反而会让卡片撑到顶栏底下。
  // 断言仍是全表扫描（不许在别处新增裸用法），只是点名放行那一条。
  const bare = findRuleBlocks(LAYOUT_CSS).filter((block) =>
    /var\(--mobile-nav-header-h\)/.test(block.body),
  )
  for (const block of bare) {
    assert.match(block.selector, /\[data-mobile-nav-question-full\]/, `裸 var 用法：${block.selector}`)
    assert.match(block.body, /--dsha-mobile-question-band:/, '裸 var 只允许出现在满屏带那条声明里')
  }
})

test('the header occludes the lifted flow (opaque + raised, under the overlay tier)', () => {
  // 三张无头截图（2026-10-07）：透明 → 消息穿过标题行；不透明但未抬升 → 与透明那版逐字节
  // 相同（背景被画在内容下面）；不透明 + 抬升 → 与未改动的顶栏带像素一致。
  const phone = phoneBlock(LAYOUT_CSS)
  const at = phone.indexOf('\n  [data-mobile-nav="frame"] [data-phase] header.wSkVaW_header {')
  const block = bodyAt(phone, at)
  assert.match(block, /background:\s*var\(--dsw-alias-bg-layer-1, #fff\) !important/)
  const z = block.match(/z-index:\s*(\d+) !important/)
  assert.ok(z !== null, '顶栏必须抬升，否则消息会盖在它上面')
  const value = Number(z[1])
  // 高于流内自带的层（真宿主实测 6-7），低于本插件自己的浮层阶梯（55+）与抽屉/菜单（1000+）。
  assert.ok(value > 7 && value < 55, `z-index ${value} 不在安全段内`)
  assert.match(block, /position:\s*relative !important/, 'z-index 需要有定位才生效')
})

test('the selection marker drops the header out of the hit test', () => {
  // 真机复报（04:2x）：速率修好后仍然「不是滚动选择，直接跳到会话顶上」。机制：原生手柄拖拽
  // 每一步都对把手位置做命中测试来定选区终点，顶栏虽然不可选但仍是命中目标 ⇒ Blink 顺着 DOM
  // 往后找到第一个可选节点（真宿主实测 = 流的第一个条目「Load earlier」）并 reveal 它 ⇒ 视口瞬移。
  const phone = phoneBlock(LAYOUT_CSS)
  const sel = 'html[data-mobile-nav-selecting] [data-mobile-nav="frame"] [data-phase] header.wSkVaW_header {'
  const block = bodyAt(phone, phone.indexOf(sel))
  assert.match(block, /pointer-events:\s*none !important/)
  // 只准动 pointer-events：拖拽中任何布局变化都会打断选区/引起跳动。
  assert.deepEqual(propsOf(block), ['pointer-events'])
})

test('the marker is driven by selectionchange and scoped to the conversation', () => {
  assert.ok(SELECTION.includes("const SELECTING_ATTR = 'data-mobile-nav-selecting'"))
  assert.ok(SELECTION.includes("document.addEventListener('selectionchange', sync)"))
  assert.ok(SELECTION.includes("document.removeEventListener('selectionchange', sync)"))
  // 输入框/抽屉里的选区不算：它们的 chrome 必须保持可点。
  assert.match(SELECTION, /if \(element\.closest\('\[data-composer-card\]'\) !== null\) return false/)
  assert.match(SELECTION, /return element\.closest\('\[data-phase\]'\) !== null/)
  // 选区收起与卸载都必须摘掉标记，否则顶栏永久点不动。
  assert.ok(SELECTION.includes('root.removeAttribute(SELECTING_ATTR)'))
})

test('the offset comes from a measured header, published idempotently', () => {  assert.ok(CHROME.includes("name: 'header-metrics'"), 'reconciler 任务已注册')
  assert.ok(CHROME.includes("const HEADER_HEIGHT_VAR = '--mobile-nav-header-h'"))
  assert.ok(
    CHROME.includes("const HEADER_SELECTOR = '[data-mobile-nav=\"frame\"] [data-phase] header'"),
    '顶栏锚点用后代形态',
  )
  assert.ok(
    !CHROME.includes('[data-phase] > header'),
    '不许退回直接子元素形态（0.2.0-rc.2 在 phase root 与 header 之间插了一层 wrapper）',
  )
  // 变量写回 <html> 的 style 属性本身就是一次 mutation：不比对就会自己把自己弄脏。
  assert.match(CHROME, /if \(root\.style\.getPropertyValue\(HEADER_HEIGHT_VAR\) !== next\)/)
  // 卸载/断点退出必须清变量，否则布局停在铺开态。
  assert.match(CHROME, /removeProperty\(HEADER_HEIGHT_VAR\)/)
  assert.match(CHROME, /header\.offsetHeight === 0/, '顶栏不可量时回落到 0px')
})

/** 取两个锚点之间的源码；锚点找不到就报错（免得切片悄悄变成空串而断言恒真）。 */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `切片「${from} … ${to}」未找到（改名/搬家请同步本测试）`)
  return source.slice(start, end)
}

/** 去掉注释再断言：这一段的小作文里会引用被禁的 API 名，注释不该被算成「读了布局」。 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

// 2026-10-13：结构性拆分 —— 任务声明 scopes:['*']，旧 ensure 每趟都调
// publishHeaderHeight()（读 offsetHeight + 两次 rect），与该文件自己的注释
// 「header 没换就不做 layout 工作」直接矛盾：流式期间每个 mutation 批次都白读一次布局。
// 现在按信号分流，这条测试钉住分流本身，而不只是钉住「函数还在」。
test('header-metrics：结构路径才做 layout 工作，几何路径不读 offsetHeight', () => {
  // 几何路径 = measureHeaderHeight + publishGeometry（ResizeObserver 回调走的那条）。
  const geometry = code(between(CHROME, 'function measureHeaderHeight()', 'function publishStructure()'))
  assert.doesNotMatch(geometry, /offsetHeight/, '几何路径不得读 offsetHeight')
  assert.match(geometry, /function publishGeometry\(\): void \{/)
  // 几何路径仍必须按「frame 顶边 → header 底边」量：safe-area 下推顶栏时 H 要跟着长，
  // 换成 RO 的 entry.contentRect 会丢掉 frame.top 这一段（那才是这条路径的存在理由）。
  assert.match(geometry, /header\.getBoundingClientRect\(\)\.bottom - frame\.getBoundingClientRect\(\)\.top/)
  assert.doesNotMatch(geometry, /contentRect|clientHeight/)

  // 结构路径保留「顶栏没有盒子 ⇒ 0px」的回落语义（offsetHeight 门只此一处）。
  const structure = code(between(CHROME, 'function publishStructure()', 'function syncHeaderHeight()'))
  assert.match(structure, /header\.offsetHeight === 0 \? '0px' : measureHeaderHeight\(\)/)
  assert.equal((code(CHROME).match(/offsetHeight/g) ?? []).length, 1, 'offsetHeight 只许出现在结构路径这一处')

  // ResizeObserver 保留，且回调走几何路径（不是旧的无条件 publish）。
  assert.match(CHROME, /new ResizeObserver\(\(\) => \{ publishGeometry\(\) \}\)/)
  assert.match(CHROME, /headerObserver\.observe\(header\)/)
  assert.match(CHROME, /headerObserver\?\.disconnect\(\)/)

  // ensure 走结构路径；「没换」分支里不得出现任何 layout 读取。
  const sync = code(between(CHROME, 'function syncHeaderHeight()', 'Reconciler task face'))
  assert.match(sync, /const header = document\.querySelector\(HEADER_SELECTOR\)/)
  const unchanged = between(sync, 'if (header === observedHeader) {', 'headerObserver?.disconnect()')
  assert.doesNotMatch(unchanged, /offsetHeight|getBoundingClientRect/, '顶栏没换时不得做 layout 工作')
  // 唯一例外：宿主没有 ResizeObserver 时退化为每趟量几何（否则 H 永远不会再更新）。
  assert.match(unchanged, /typeof ResizeObserver === 'undefined'\) publishGeometry\(\)/)
  // 结构变化那一趟：重绑（disconnect + observe）之后才发布。
  const changed = sync.slice(sync.indexOf('headerObserver?.disconnect()'))
  assert.ok(
    changed.indexOf('headerObserver.observe(header)') < changed.indexOf('publishStructure()'),
    '重绑必须早于发布',
  )
  assert.match(sync, /publishStructure\(\)/)
  // scopes 仍须 ['*']：顶栏节点可在任意 commit 被换掉，没有更窄的脏键覆盖它。
  assert.ok(CHROME.includes("scopes: ['*']"), 'scopes 仍是全脏键（顶栏节点可在任意 commit 被换）')
})

// ═══════════════════════════════════════════════════════════════════════════
// 行为层：把 header-metrics 真跑起来，数 layout 读取
//
// 上面那条是源码切片断言 —— 它拦得住「几何路径里冒出 offsetHeight」，但拦不住
// 「分流写对了、接线接反了」（比如 ensure 忘了走结构路径、RO 回调接了旧函数）。
// 这里用 vm + ts.transpileModule 把那一个模块真加载起来（getFrame 用桩替换），
// 然后用 getter 精确数每一次 offsetHeight / getBoundingClientRect 读取。
//
// 硬指标（本文件的核心产出一句话）：**顶栏没换的那一趟 ensure = 1 次
// querySelector + 0 次 offsetHeight + 0 次 rect 读**（旧版是 1 + 1 + 2）。
// ═══════════════════════════════════════════════════════════════════════════

const compile = (text: string) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const HEADER_METRICS_BODY = compile(
  readFileSync(join(ROOT, 'src/client/effects/header-metrics.ts'), 'utf8'),
)

/** 一个可数的顶栏桩：每次读 offsetHeight / rect 都记账。 */
function fakeHeader(counters: { offsetReads: number; rects: number }, box: { top: number; bottom: number }) {
  return {
    get offsetHeight() { counters.offsetReads += 1; return box.bottom - box.top },
    getBoundingClientRect: () => { counters.rects += 1; return { top: box.top, bottom: box.bottom, width: 390, height: box.bottom - box.top } },
  }
}

function headerMetricsFixture(options: { withResizeObserver?: boolean } = {}) {
  const counters = { queries: 0, offsetReads: 0, rects: 0 }
  const vars = new Map<string, string>()
  const writes: string[] = []
  const observers: Array<{ callback: () => void; observed: unknown[]; disconnects: number }> = []
  const headerBox = { top: 20, bottom: 64 }
  const header = fakeHeader(counters, headerBox)
  const frame = { getBoundingClientRect: () => { counters.rects += 1; return { top: 0, bottom: 700 } } }
  const state = { current: header as unknown }

  const document = {
    documentElement: {
      style: {
        getPropertyValue: (key: string): string => vars.get(key) ?? '',
        setProperty: (key: string, value: string): void => { vars.set(key, value); writes.push(value) },
        removeProperty: (key: string): void => { vars.delete(key) },
      },
    },
    querySelector: (_selector: string): unknown => { counters.queries += 1; return state.current },
  }
  class HTMLElement {}
  Object.setPrototypeOf(header, HTMLElement.prototype)
  const context: Record<string, unknown> = {
    module: { exports: {} as Record<string, unknown> },
    document,
    HTMLElement,
    require: () => ({ getFrame: () => frame }),
  }
  context.exports = (context.module as { exports: Record<string, unknown> }).exports
  if (options.withResizeObserver !== false) {
    context.ResizeObserver = class {
      callback: () => void
      observed: unknown[] = []
      disconnects = 0
      constructor(callback: () => void) { this.callback = callback; observers.push(this) }
      observe(el: unknown): void { this.observed.push(el) }
      disconnect(): void { this.disconnects += 1 }
    }
  }
  vm.runInNewContext(HEADER_METRICS_BODY, context)
  const task = (context.module as { exports: { createHeaderMetricsTask: () => { ensure: () => void; dispose: () => void } } })
    .exports.createHeaderMetricsTask()
  return {
    counters, vars, writes, observers, headerBox, task,
    /** 造一个仍然 instanceof HTMLElement 的新顶栏节点（React 换子树时的形态）。 */
    makeHeader: (box: { top: number; bottom: number }): unknown => {
      const next = fakeHeader(counters, box)
      Object.setPrototypeOf(next, HTMLElement.prototype)
      return next
    },
    setCurrent: (next: unknown): void => { state.current = next },
    /** 当前顶栏高度变量值（'0px' 表示「不可量」）。 */
    varValue: (): string | undefined => vars.get('--mobile-nav-header-h'),
  }
}

test('行为：顶栏没换的那一趟 ensure 零 layout 读（旧版是 1 次 offsetHeight + 2 次 rect）', () => {
  const fixture = headerMetricsFixture()
  // 首趟：结构变化（null → 真顶栏）⇒ 重绑 + 发布，这一趟做 layout 工作是对的。
  fixture.task.ensure()
  assert.equal(fixture.counters.queries, 1)
  assert.equal(fixture.counters.offsetReads, 1, '结构路径应当读一次 offsetHeight')
  assert.equal(fixture.counters.rects, 2, '结构路径读 frame.top + header.bottom')
  assert.equal(fixture.varValue(), '64px', 'H = frame.top(0) → header.bottom(64)')
  assert.equal(fixture.observers.length, 1)
  assert.equal(fixture.observers[0].observed.length, 1, '首趟只 observe 一次')

  // 关键指标：结构没变的三趟 ensure。
  const before = { ...fixture.counters }
  for (let round = 0; round < 3; round += 1) fixture.task.ensure()
  assert.equal(fixture.counters.queries - before.queries, 3, '每趟仍要一次 querySelector（换没换只有它知道）')
  assert.equal(fixture.counters.offsetReads - before.offsetReads, 0, '顶栏没换不得读 offsetHeight')
  assert.equal(fixture.counters.rects - before.rects, 0, '顶栏没换不得读 rect')
  assert.equal(fixture.writes.length, 1, '没变化就不该再写变量（写回本身是一次 mutation）')
})

test('行为：几何变化由 ResizeObserver 驱动，只量不读 offsetHeight', () => {
  const fixture = headerMetricsFixture()
  fixture.task.ensure()
  const writesBefore = fixture.writes.length
  const offsetBefore = fixture.counters.offsetReads

  // 顶栏长高（safe-area 下推 / 标题折行）：RO 回调 = 几何路径。
  fixture.headerBox.bottom = 88
  fixture.observers[0].callback()
  assert.equal(fixture.counters.offsetReads - offsetBefore, 0, '几何路径不得读 offsetHeight')
  assert.equal(fixture.varValue(), '88px', 'safe-area 下推顶栏时 H 必须跟着长')
  assert.equal(fixture.writes.length, writesBefore + 1)

  // 幂等：几何没变时不写（否则每次 RO 回调都把 reconciler 弄脏）。
  fixture.observers[0].callback()
  assert.equal(fixture.writes.length, writesBefore + 1, '同值不得重写')
  assert.equal(fixture.varValue(), '88px')
})

test('行为：React 换掉顶栏节点时重绑观察器并重新发布', () => {
  const fixture = headerMetricsFixture()
  fixture.task.ensure()
  const first = fixture.observers[0]

  fixture.setCurrent(fixture.makeHeader({ top: 20, bottom: 100 }))
  fixture.task.ensure()
  assert.equal(first.disconnects, 1, '换节点必须摘掉旧观察')
  assert.equal(fixture.observers.length, 1, '复用同一个 ResizeObserver 实例')
  assert.equal(fixture.observers[0].observed.length, 2, '新节点必须被重新 observe')
  assert.equal(fixture.varValue(), '100px')
})

test('行为：结构路径的「顶栏没有盒子 ⇒ 0px」语义仍在；几何路径按 rect 夹到 0', () => {
  const fixture = headerMetricsFixture()
  fixture.task.ensure()
  // display:none 的顶栏（offsetHeight 0，rect 全零）作为新节点换进来。
  fixture.setCurrent(fixture.makeHeader({ top: 0, bottom: 0 }))
  fixture.task.ensure()
  assert.equal(fixture.varValue(), '0px', '没有盒子的顶栏 ⇒ 0px（旧语义保留）')

  // 几何路径（无 offsetHeight 门）在同样的 rect 下也是 0px —— Math.max(0, …) 夹的。
  fixture.headerBox.bottom = 0
  fixture.observers[0].callback()
  assert.equal(fixture.varValue(), '0px', '几何路径按 rect 夹到 0px，与结构路径同结果')
})

test('行为：拿不到 ResizeObserver 时退化为每趟量几何（否则 H 永不更新）', () => {
  const fixture = headerMetricsFixture({ withResizeObserver: false })
  fixture.task.ensure()
  assert.equal(fixture.observers.length, 0)
  assert.equal(fixture.varValue(), '64px')
  assert.equal(fixture.counters.offsetReads, 1)

  // 没有 RO 就没有几何信号：这一趟必须自己量（但仍不读 offsetHeight）。
  const offsetBefore = fixture.counters.offsetReads
  fixture.headerBox.bottom = 70
  fixture.task.ensure()
  assert.equal(fixture.counters.offsetReads - offsetBefore, 0, '退化路径仍不得读 offsetHeight')
  assert.equal(fixture.varValue(), '70px', '没有 RO 时 ensure 必须补上几何发布')
})

test('行为：dispose 摘观察器并把变量还给宿主', () => {
  const fixture = headerMetricsFixture()
  fixture.task.ensure()
  fixture.task.dispose()
  assert.equal(fixture.observers[0].disconnects, 1)
  assert.equal(fixture.vars.has('--mobile-nav-header-h'), false, '卸载必须清变量，否则布局停在铺开态')
})
