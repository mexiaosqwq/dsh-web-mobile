// 面板进出动画（店主 2026-10-07 两轮报障：先「退出像掉帧、直接回聊天界面」，
// 再「空档有点久了，要像侧边栏那样从侧面滑出来、原路返回」）。
// 终态 = 冻结快照 + 立即切换：面板 clone 成插件自有的固定层滑回右侧（合成器跑，
// 主线程重挂会话时也不掉帧），切换不再等任何动画 ⇒ 不额外增加空档。
// 这组断言钉四件事：快照存在、提交在同一 tick、兜底一定能清理、CSS 配套与时长对齐。
//
// 2026-10-13 追加两条**行为层**断言（C02-a / C02-b）：文件上半部分是源码不变式
// 审计（readFileSync + 正则），钉的是「写成什么样」；下面的 minimal DOM 桩真跑
// createPanelExit，钉的是「跑起来删谁、摘谁」——源码文本看着对、归属写反的组合
// 恰好是这两处缺陷的形状，正则拦不住。仍未跨到浏览器行为层（无真实渲染/动画），
// 那层的读数只能是 cdp 探针一族。
//
// 2026-10-20 追加子页「返回上一级」（plugin-panel-subpage-back）：插件管理页的
// 「更多」列表与三种详情根都带宿主自己的返回控件（moreBack / crumb），子页只是
// 宿主的组件状态、不产生 history entry。所以 back() 必须只点那个控件，根页才
// 整层退出；系统返回在子页要补回刚 pop 掉的 entry（backOneLevel() 后紧跟 arm()）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPanelExit } from '../src/client/effects/panel-exit.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXIT = readFileSync(join(ROOT, 'src/client/effects/panel-exit.ts'), 'utf8')
const CSS = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')

test('the outgoing panel is frozen into a snapshot and the swap happens on the same tick', () => {
  assert.match(EXIT, /const PANEL_GHOST_VALUE = 'panel-ghost'/)
  assert.match(EXIT, /ghost\.append\(panel\.cloneNode\(true\)\)/)
  assert.match(EXIT, /document\.body\.append\(ghost\)/)
  // 关键不变量：selectPanel() 必须在同一 tick 同步提交，不得被搬进任何帧回调
  // （上一版「先动画后提交」把会话重挂推迟了 220ms，店主立刻感觉到空档）。
  const exitBody = EXIT.slice(
    EXIT.indexOf('const exit = (): void => {'),
    EXIT.indexOf('function dispose(): void {'),
  )
  assert.ok(exitBody.includes('selectPanel()'), 'the swap must happen in exit()')
  assert.ok(
    exitBody.indexOf('selectPanel()') < exitBody.indexOf('requestAnimationFrame'),
    'the swap must commit before the sampling frame, never inside it',
  )
  // 旧的「动真面板」标记必须彻底消失。
  assert.doesNotMatch(EXIT, /PANEL_LEAVING_ATTR/)
  assert.doesNotMatch(EXIT, /dsh-web-mobile-panel-out/)
})

test('the completion signal is the running animation, never a hardcoded name', () => {
  // 名字曾经漂移（dsh-mobile-panel-reveal vs dsh-web-mobile-panel-reveal），
  // 且 prefers-reduced-motion 会把动画换成 none —— 两种都不可能靠名字判定。
  assert.match(EXIT, /target\.getAnimations\(\)/)
  assert.match(EXIT, /animation\.finished\.then\(/)
  assert.match(EXIT, /if \(animations\.length === 0\) \{/)
  // 没有动画时（reduce）必须当场收尾，而不是等一个永不发生的 animationend。
  const armBody = EXIT.slice(EXIT.indexOf('function armExit('), EXIT.indexOf('const exit = (): void => {'))
  assert.ok(armBody.includes('finishMain()'), 'no-animation path must finish immediately')
  // JS 侧出现的任何动画名字面量都必须是 CSS 里真实存在的 keyframe。
  const cssKeyframes = new Set([...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))
  for (const match of EXIT.matchAll(/animationName === '([\w-]+)'/g)) {
    assert.ok(cssKeyframes.has(match[1]), `${match[1]} is not a CSS @keyframes name`)
  }
})

test('the main timeline and the snapshot timeline clean up separately', () => {
  const mainBody = EXIT.slice(EXIT.indexOf('function finishMain(): void {'), EXIT.indexOf('function finishGhost(): void {'))
  // 主清理绝不能顺手删快照：reveal 约 180ms 结束，而 ghost 要滑满 280ms。
  assert.doesNotMatch(mainBody, /removeGhosts\(\)/)
  assert.doesNotMatch(mainBody, /ghost\.remove\(\)/)
  // 兜底时长由动画自身时长算出，2000ms 只作为上限。
  assert.match(EXIT, /Math\.min\(PANEL_EXIT_FALLBACK_MS, Math\.max\(250, longest \+ 200\)\)/)
})

test('a ghost layer can never be left covering the whole screen', () => {
  assert.match(EXIT, /const PANEL_GHOST_MS = 280/)
  assert.match(EXIT, /window\.setTimeout\(finishGhost, PANEL_GHOST_MS \+ 120\)/)
  // 兜底与 animationend 两条路都走同一个幂等 finishGhost。
  assert.match(EXIT, /function finishGhost\(\): void \{/)
  assert.match(EXIT, /ghost = null/)
  assert.match(EXIT, /el\.remove\(\)/)
})

test('teardown releases the marker, the timers and any leftover snapshot', () => {
  assert.match(EXIT, /dispose: \(\) => void/)
  assert.match(EXIT, /function dispose\(\): void \{[\s\S]*?finishGhost\(\)/)
  assert.match(EXIT, /function finishGhost\(\): void \{/)
  // 只有武装了 panelLeaving 的那个实例能清掉它（旧实例不得清掉新实例的状态）。
  assert.match(EXIT, /panelLeavingOwner === owner/)
  // C02-a/C02-b：标记与快照都按归属处理 —— 全文不得再出现「按标记扫全文档再删」
  // 的清理（那种写法让旧实例的 disposer 删掉新实例刚挂上的快照），
  // finishMain 里也不得有无条件 removeAttribute。
  assert.doesNotMatch(EXIT, /querySelectorAll\(\s*`\[data-mobile-nav="\$\{PANEL_GHOST_VALUE\}"\]`\s*\)/)
  const mainBody = EXIT.slice(EXIT.indexOf('function finishMain(): void {'), EXIT.indexOf('function finishGhost(): void {'))
  assert.ok(
    mainBody.indexOf('panelLeavingOwner === owner') < mainBody.indexOf('removeAttribute(PANEL_EXIT_ATTR)'),
    'removeAttribute 必须在归属判断之内',
  )
  // index.tsx 必须真的把 dispose 接进 owning effect，否则它永远不会跑。
  const INDEX = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')
  assert.match(INDEX, /panelExit\.dispose\(\)/)
})

test('CSS: the panel slides in from the side, the snapshot slides back out at drawer length', () => {
  assert.match(CSS, /@keyframes dsh-web-mobile-panel-in \{\s*from \{ opacity: \.55; transform: translateX\(100%\); \}/)
  assert.match(CSS, /animation: dsh-web-mobile-panel-in \.28s/)
  assert.match(CSS, /@keyframes dsh-web-mobile-panel-ghost-out \{\s*to \{ opacity: \.72; transform: translateX\(100%\); \}/)
  assert.match(CSS, /\[data-mobile-nav="panel-ghost"\] \{\s*position: fixed;[\s\S]*?animation: dsh-web-mobile-panel-ghost-out \.28s/)
  // 快照必须不吃点击，否则它会挡住底下刚挂上来的会话。
  assert.match(CSS, /\[data-mobile-nav="panel-ghost"\] \{\s*position: fixed;[\s\S]*?pointer-events: none;/)
})

test('reduced-motion switches both panel animations off', () => {
  const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce) {\n    [data-mobile-nav="frame"]:has([class*="panelRow"]'))
  const head = block.slice(0, 700)
  assert.match(head, /\[data-mobile-nav="panel-ghost"\]/)
  assert.match(head, /animation: none !important/)
})

// ---------------------------------------------------------------------------
// 行为层夹具：够 createPanelExit 跑完一次 exit / finishMain / dispose 的最小 DOM。
// 只实现模块真正用到的那几个面（属性、dataset、父子、克隆、rAF、定时器），
// 选择器按模块的查询意图分派：带 `_centerCol` 的那条（面板页元素）走具名槽位，
// 其余按属性选择器在树里匹配 —— 出现夹具不认识的选择器一律抛错，不静默放过。
// ---------------------------------------------------------------------------

/** 当前夹具的根：isConnected 只认它，跨用例不会把上一棵树的 frame 判成连着。 */
let activeRoot: FakeElement | null = null

/** 定时器是登记表而非真定时器：兜底路径不会在断言中途把快照删掉。 */
let timers: { id: number; run: () => void }[] = []
let nextTimerId = 1
/** 帧回调按批冲洗（flushFrames 一批对应一帧），顺序与真实 rAF 一致。 */
let frameQueue: { id: number; run: (time: number) => void }[] = []
let nextFrameId = 1

class FakeElement {
  readonly tagName: string
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  parentElement: FakeElement | null = null
  readonly dataset: Record<string, string>
  /** 宿主控件被点击的次数：子页返回只允许点那一个真控件。 */
  clicks = 0

  constructor(tagName: string) {
    this.tagName = tagName
    const attributes = this.attributes
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (target, key: string, value: string) => {
        target[key] = value
        attributes.set(`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value))
        return true
      },
      get: (target, key: string) => target[key],
    })
  }

  get isConnected(): boolean {
    let node: FakeElement = this
    while (node.parentElement !== null) node = node.parentElement
    return node === activeRoot
  }
  get className(): string { return this.attributes.get('class') ?? '' }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  hasAttribute(name: string): boolean { return this.attributes.has(name) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  click(): void { this.clicks += 1 }
  addEventListener(): void { /* 事件从不派发，登记即可 */ }
  removeEventListener(): void { /* 同上 */ }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) { node.parentElement = this; this.children.push(node) }
  }
  remove(): void {
    const parent = this.parentElement
    if (parent === null) return
    const at = parent.children.indexOf(this)
    if (at >= 0) parent.children.splice(at, 1)
    this.parentElement = null
  }
  cloneNode(): FakeElement {
    const copy = new FakeElement(this.tagName)
    for (const [name, value] of this.attributes) copy.attributes.set(name, value)
    for (const child of this.children) copy.append(child.cloneNode())
    return copy
  }
  /** 模块只在揭示目标上用一次；夹具里永不为空 ⇒ 走「无动画」那条即时收尾路。 */
  querySelectorAll(): FakeElement[] { return [] }
  getAnimations(): unknown[] { return [] }
}

/**
 * 夹具选择器：只支持模块真正用到的两种语法 —— 逗号候选（任一命中）与空格分隔
 * 的后代链（每段 = 可选标签名 + 若干属性选择器）。出现别的语法（类选择器、子代
 * 组合符等）一律抛错，避免「夹具静默不匹配、测试假绿」。
 */
function fakeMatches(element: FakeElement, selector: string): boolean {
  return selector.split(',').some((alternative) => fakeMatchesChain(element, alternative.trim()))
}

function fakeMatchesChain(element: FakeElement, chain: string): boolean {
  const segments = chain.split(/\s+/).filter((segment) => segment.length > 0)
  if (segments.length === 0) throw new Error(`夹具不认识的选择器：${chain}`)
  if (!fakeMatchesCompound(element, segments[segments.length - 1]!)) return false
  let ancestor = element.parentElement
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    while (ancestor !== null && !fakeMatchesCompound(ancestor, segments[index]!)) {
      ancestor = ancestor.parentElement
    }
    if (ancestor === null) return false
    ancestor = ancestor.parentElement
  }
  return true
}

function fakeMatchesCompound(element: FakeElement, compound: string): boolean {
  let rest = compound
  const tag = /^[a-zA-Z][\w-]*/.exec(rest)
  if (tag !== null) {
    if (element.tagName.toLowerCase() !== tag[0].toLowerCase()) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest.length > 0) {
    const part = /^\[[^\]]+\]/.exec(rest)
    if (part === null) throw new Error(`夹具不认识的复合选择器：${compound}`)
    if (!fakeMatchesAttribute(element, part[0])) return false
    rest = rest.slice(part[0].length)
  }
  return true
}

function fakeMatchesAttribute(element: FakeElement, part: string): boolean {
  const parsed = /^\[([\w-]+)(?:([*^$]?)=(?:"([^"]*)"|([^\]]*)))?\]$/.exec(part)
  if (parsed === null) throw new Error(`夹具不认识的属性选择器：${part}`)
  const [, name, operator, quoted, bare] = parsed
  if (operator === undefined) return element.hasAttribute(name!)
  const value = quoted ?? bare ?? ''
  const actual = element.getAttribute(name!) ?? ''
  if (operator === '*') return actual.includes(value)
  if (operator === '^') return actual.startsWith(value)
  if (operator === '$') return actual.endsWith(value)
  return actual === value
}

function fakeWalk(root: FakeElement, visit: (element: FakeElement) => void): void {
  visit(root)
  for (const child of root.children) fakeWalk(child, visit)
}

interface Harness {
  frame: FakeElement
  /** 面板页本体（宿主 section[data-plugin-panel]）—— 子页控件挂在这里。 */
  panel: FakeElement
  /** 宿主自己的「返回上一级」控件（列表更多页的 moreBack）。 */
  subpageBack: FakeElement
  /** 当前挂在文档里的快照（树序）—— 断言「删了谁的」只看这个。 */
  ghosts: () => FakeElement[]
  /** 交给 createPanelExit 的 layout 面（能力探针要它是个函数）。 */
  layout: unknown
  selectPanelCalls: () => number
}

function installHarness(): Harness {
  const documentElement = new FakeElement('html')
  const body = new FakeElement('body')
  documentElement.append(body)
  const frame = new FakeElement('div')
  frame.setAttribute('data-mobile-nav', 'frame')
  const panelRow = new FakeElement('button')
  panelRow.setAttribute('class', 'hHd-Xa_panelRow')
  panelRow.setAttribute('aria-current', 'page')
  const panel = new FakeElement('section')
  panel.setAttribute('data-plugin-panel', '')
  // 子页在场：宿主的「更多」列表头带 _moreBack 的按钮。
  const subpageBack = new FakeElement('button')
  subpageBack.setAttribute('class', 'X_2TxG_moreBack')
  panel.append(subpageBack)
  body.append(frame, panelRow, panel)
  activeRoot = documentElement
  timers = []
  frameQueue = []
  nextTimerId = 1
  nextFrameId = 1

  const find = (selector: string): FakeElement | null => {
    if (selector.includes('_centerCol')) return panel
    let found: FakeElement | null = null
    fakeWalk(documentElement, (element) => {
      if (found === null && fakeMatches(element, selector)) found = element
    })
    return found
  }
  const findAll = (selector: string): FakeElement[] => {
    const out: FakeElement[] = []
    fakeWalk(documentElement, (element) => { if (fakeMatches(element, selector)) out.push(element) })
    return out
  }

  const documentEvents: Event[] = []
  const globals = globalThis as unknown as Record<string, unknown>
  globals.document = {
    body,
    documentElement,
    createElement: (tagName: string) => new FakeElement(tagName),
    querySelector: find,
    querySelectorAll: findAll,
    // panel-exit 退场时同步广播 'dsh-mobile-panel-exit'（composer focus guard 靠它
    // 在会话重挂载前开窗）；夹具只做有事件目标的广播，不参与断言。
    dispatchEvent: (event: Event) => { documentEvents.push(event); return true },
  }
  globals.HTMLElement = FakeElement
  globals.window = {
    setTimeout: (run: () => void) => { const id = nextTimerId++; timers.push({ id, run }); return id },
    clearTimeout: (id: number) => { timers = timers.filter((timer) => timer.id !== id) },
  }
  globals.requestAnimationFrame = (run: (time: number) => void) => {
    const id = nextFrameId++
    frameQueue.push({ id, run })
    return id
  }
  globals.cancelAnimationFrame = (id: number) => { frameQueue = frameQueue.filter((frame) => frame.id !== id) }

  let selectPanelCalls = 0
  ;(globalThis as unknown as Record<string, unknown>).__documentEvents = documentEvents
  return {
    frame,
    panel,
    subpageBack,
    ghosts: () => findAll('[data-mobile-nav="panel-ghost"]'),
    layout: { selectPanel: () => { selectPanelCalls += 1 } },
    selectPanelCalls: () => selectPanelCalls,
  }
}

/** 冲洗一帧：本批回调跑完后新排的帧回调留到下一批（与真实 rAF 同序）。 */
function flushFrames(): void {
  const batch = frameQueue
  frameQueue = []
  for (const frame of batch) frame.run(0)
}

test('a torn-down instance never deletes the snapshot the instance that replaced it mounted', () => {
  // C02-a：快照标记（data-mobile-nav="panel-ghost"）是**所有实例共享**的，归属不是。
  // 旧实现在 dispose 里按标记扫全文档删 ⇒ 晚到的 disposer 把新实例刚挂上的快照删掉：
  // 面板滑到一半凭空消失，而新实例还握着一个已脱离文档的句柄。
  const dom = installHarness()
  const first = createPanelExit(dom.layout)
  first.exit()
  assert.equal(dom.selectPanelCalls(), 1, 'exit 必须真的跑到提交，否则下面的快照断言是空转')
  const ghostFirst = dom.ghosts()
  assert.equal(ghostFirst.length, 1, '退出应当挂上一张自有快照')

  const second = createPanelExit(dom.layout)
  second.exit()
  assert.equal(dom.selectPanelCalls(), 2)
  const afterSecond = dom.ghosts()
  // 两个实例重叠时各持自己的快照：新实例的退出不得动旧实例仍在滑出的那一张。
  assert.equal(afterSecond.length, 2, '新实例的退出删掉了旧实例的快照')
  assert.ok(afterSecond.includes(ghostFirst[0]!), '旧实例的快照必须还在文档里')
  const ghostSecond = afterSecond.find((element) => element !== ghostFirst[0])
  assert.ok(ghostSecond !== undefined, '新实例必须挂上自己的快照')

  // 旧实例的 disposer 晚到（重复调用同样合法：dispose 幂等）：只许摘自己的那一张。
  first.dispose()
  assert.deepEqual(dom.ghosts(), [ghostSecond], '旧实例的 disposer 删掉了新实例的快照')

  second.dispose()
  assert.deepEqual(dom.ghosts(), [], '两个实例都 dispose 后不得留下任何快照')
})

test('finishMain only takes off the frame marker it armed itself', () => {
  // C02-b：标记挂在 frame 上（共享元素），摘的条件必须是「这一笔是我们挂的」。
  // 旧实现无条件 removeAttribute ⇒ 旧实例的主时间线收尾会把新实例仍在跑的揭示
  // 标记一并摘掉，进来的会话直接以全不透明闪一帧。
  const dom = installHarness()
  const older = createPanelExit(dom.layout)
  const newer = createPanelExit(dom.layout)

  older.exit()
  assert.equal(dom.frame.hasAttribute('data-mobile-panel-exit'), true, '退场必须挂上揭示标记')
  flushFrames() // older 的采样帧：无动画 ⇒ 排下一帧
  newer.exit() // 新实例接管：同一元素上重挂标记，panelLeaving 换主人
  flushFrames() // older 第二次尝试 / newer 第一次采样
  flushFrames() // older 第三次尝试 ⇒ 它的 finishMain 在这里跑
  assert.equal(
    dom.frame.hasAttribute('data-mobile-panel-exit'),
    true,
    '旧实例的 finishMain 摘掉了新实例仍在用的揭示标记',
  )

  flushFrames() // newer 的 finishMain
  assert.equal(
    dom.frame.hasAttribute('data-mobile-panel-exit'),
    false,
    '标记最终必须被摘掉，否则会话一直带着退场状态',
  )
  older.dispose()
  newer.dispose()
})

test('back() steps one host level on a panel subpage and never exits the panel', () => {
  // 插件管理页「更多」列表：宿主自带 moreBack（onClick = setView list）。子页不产生
  // history entry，所以唯一正确的动作是点那个控件；整层 exit 会直接掉回会话。
  const dom = installHarness()
  const panelExit = createPanelExit(dom.layout)
  assert.equal(panelExit.subpageOpen(), true, '夹具里的 _moreBack 应被认成子页控件')

  panelExit.back()

  assert.equal(dom.subpageBack.clicks, 1, '子页返回必须点宿主自己的返回控件，且只点一次')
  assert.equal(dom.selectPanelCalls(), 0, '子页返回不得调用 selectPanel(null) 整层退出')
  assert.deepEqual(dom.ghosts(), [], '子页返回不是退场，不应产生冻结快照')
  panelExit.dispose()
})

test('back() exits the panel only when the panel root has no host back control', () => {
  const dom = installHarness()
  const panelExit = createPanelExit(dom.layout)
  // 根页：子页控件不在场（回到列表后宿主把它卸载了）。
  dom.subpageBack.remove()
  assert.equal(panelExit.subpageOpen(), false)

  panelExit.back()

  assert.equal(dom.subpageBack.clicks, 0, '根页没有子页控件可点')
  assert.equal(dom.selectPanelCalls(), 1, '根页返回才走 selectPanel(null)')
  assert.equal(dom.ghosts().length, 1, '根页返回仍走冻结快照退场')
  panelExit.dispose()
  assert.deepEqual(dom.ghosts(), [])
})

test('all three plugin detail roots expose their crumb as the subpage back control', () => {
  // 三种详情根（内置 / 官方插件 / 市场行）各用各的 crumb button；选择器必须全覆盖。
  for (const marker of ['data-plugin-detail', 'data-plugin-item-detail', 'data-plugin-row-detail']) {
    const dom = installHarness()
    dom.subpageBack.remove()
    const detail = new FakeElement('div')
    detail.setAttribute(marker, 'some-plugin')
    const crumb = new FakeElement('button')
    crumb.setAttribute('class', 'X_2TxG_crumb')
    detail.append(crumb)
    dom.panel.append(detail)

    const panelExit = createPanelExit(dom.layout)
    assert.equal(panelExit.subpageOpen(), true, `${marker} 的 crumb 未被认成子页控件`)
    panelExit.back()
    assert.equal(crumb.clicks, 1, `${marker} 详情页返回必须点 crumb`)
    assert.equal(dom.selectPanelCalls(), 0, `${marker} 详情页返回不得整层退出`)
    panelExit.dispose()
  }
})

test('subpage levels are pre-armed before a back press, never after one', () => {
  // 真机三轮实测（2026-10-20）：这个 WebView 会把「与同文档遍历同一任务」里发出的
  // pushState 丢掉 —— popstate 里、紧随的 rAF 里、再晚一拍的 setTimeout(0) 里都丢。
  // 所以条目必须**在返回动作之前**就备好：面板自己一条，每进一层子页再预推一条；
  // 返回只是消费已有条目，绝不在 popstate 里补。
  const popBody = EXIT.slice(
    EXIT.indexOf('function onPopState(): void {'),
    EXIT.indexOf('function listen(): void {'),
  )
  assert.doesNotMatch(popBody, /pushEntry\(\)/, 'popstate 里不得再 push entry')
  assert.match(popBody, /backOneLevel\(\)/, '子页返回仍然只升一级')
  const ensureBody = EXIT.slice(
    EXIT.indexOf('ensure: (): void => {'),
    EXIT.indexOf('dispose: (): void => {'),
  )
  assert.match(ensureBody, /armRoot\(\)/, '面板根页保留自己那条 entry')
  assert.match(ensureBody, /armExtra\(\)/, '进入更深一层时必须预推一条 entry')
  assert.match(ensureBody, /current > previous/, '按层级比较决定推 / 让')
  const levelBody = EXIT.slice(
    EXIT.indexOf('function levelOf('),
    EXIT.indexOf('function onPopState(): void {'),
  )
  assert.match(levelBody, /_moreBack/, '「更多」列表算第 1 级')
  assert.match(EXIT, /if \(pushEntry\(\)\) extraArmed \+= 1/, '预推成功后必须记账')
})

test('exit() broadcasts the synchronous composer-focus-guard event', () => {
  // 2026-10-20：退出面板会让会话重挂载、InputBar 再聚焦一次并弹键盘。焦点窗口必须
  // 在 commit 之前打开，而 commit 里（layout-effect 阶段）的聚焦早于任何 observer
  // 微任务——所以 exit() 在挂标记的同一步同步广播一个事件，由 session-focus-guard
  // 收。标记本身仍保留，作为事件被改名时的兜底。
  const source = EXIT
  assert.match(source, /const PANEL_EXIT_EVENT = 'dsh-mobile-panel-exit'/)
  assert.match(source, /document\.dispatchEvent\(new CustomEvent\(PANEL_EXIT_EVENT\)\)/)
  assert.ok(
    source.indexOf("setAttribute(PANEL_EXIT_ATTR, '')") < source.indexOf('dispatchEvent(new CustomEvent(PANEL_EXIT_EVENT))'),
    '事件必须在挂上退场标记之后、提交 selectPanel 之前发出',
  )
  const h = installHarness()
  const events = (globalThis as unknown as Record<string, Event[]>).__documentEvents
  events.length = 0
  const panelExit = createPanelExit(h.layout)
  panelExit.exit()
  assert.ok(events.some((event) => event.type === 'dsh-mobile-panel-exit'), '退场时必须广播事件')
  panelExit.dispose()
})

test('the system back climbs one subpage level and consumes the level entry', () => {
  const popBody = EXIT.slice(
    EXIT.indexOf('function onPopState(): void {'),
    EXIT.indexOf('function listen(): void {'),
  )
  // 消费顺序 LIFO：先扣子页层级的条数，扣完才动面板自己那条。
  assert.match(popBody, /if \(extraArmed > 0\) extraArmed -= 1\s*\n\s*else if \(rootArmed\) rootArmed = false/,
    '返回必须先消费子页层级 entries，最后才消费面板 entry')
  assert.ok(
    popBody.indexOf('backOneLevel()') > popBody.indexOf('subpageControl()'),
    '子页分支必须先判定子页在场',
  )
  assert.ok(
    popBody.indexOf('backOneLevel()') < popBody.indexOf('exitPanel()'),
    '子页分支必须在 exitPanel() 之前 return（否则整层退出）',
  )
  // back() 本身：先点宿主控件，根页才落到 exit()。
  const backBody = EXIT.slice(
    EXIT.indexOf('const back = (): void => {'),
    EXIT.indexOf('function dispose(): void {'),
  )
  assert.ok(backBody.includes('control.click()'), 'back() 必须点宿主控件')
  assert.ok(
    backBody.indexOf('control.click()') < backBody.indexOf('exit()'),
    'back() 先点子页控件，根页才走 exit',
  )
  // FAB 也必须走同一动作，否则两条返回路径会各走各的。
  const FAB = readFileSync(join(ROOT, 'src/client/effects/overlay-backdrop-fab.ts'), 'utf8')
  assert.match(FAB, /panelExit\.back\(\)/, 'FAB 的返回必须走 panelExit.back()')
  assert.doesNotMatch(FAB, /panelExit\.exit\(\)/, 'FAB 不得再直接整层退出')
})

test('subpage levels are pre-armed before a back press, never after one', () => {
  // 真机三轮实测（2026-10-20）：这个 WebView 会把「与同文档遍历同一任务」里发出的
  // pushState 丢掉 —— popstate 里、紧随的 rAF 里、再晚一拍的 setTimeout(0) 里都丢。
  // 所以条目必须**在返回动作之前**就备好：面板自己一条，每进一层子页再预推一条；
  // 返回只是消费已有条目，绝不在 popstate 里补。
  const popBody = EXIT.slice(
    EXIT.indexOf('function onPopState(): void {'),
    EXIT.indexOf('function listen(): void {'),
  )
  assert.doesNotMatch(popBody, /pushEntry\(\)/, 'popstate 里不得再 push entry')
  assert.match(popBody, /backOneLevel\(\)/, '子页返回仍然只升一级')
  const ensureBody = EXIT.slice(
    EXIT.indexOf('ensure: (): void => {'),
    EXIT.indexOf('dispose: (): void => {'),
  )
  assert.match(ensureBody, /armRoot\(\)/, '面板根页保留自己那条 entry')
  assert.match(ensureBody, /armExtra\(\)/, '进入更深一层时必须预推一条 entry')
  assert.match(ensureBody, /current > previous/, '按层级比较决定推 / 让')
  const levelBody = EXIT.slice(
    EXIT.indexOf('function levelOf('),
    EXIT.indexOf('function onPopState(): void {'),
  )
  assert.match(levelBody, /_moreBack/, '「更多」列表算第 1 级')
  assert.match(EXIT, /if \(pushEntry\(\)\) extraArmed \+= 1/, '预推成功后必须记账')
})

test('exit() broadcasts the synchronous composer-focus-guard event', () => {
  // 2026-10-20：退出面板会让会话重挂载、InputBar 再聚焦一次并弹键盘。焦点窗口必须
  // 在 commit 之前打开，而 commit 里（layout-effect 阶段）的聚焦早于任何 observer
  // 微任务——所以 exit() 在挂标记的同一步同步广播一个事件，由 session-focus-guard
  // 收。标记本身仍保留，作为事件被改名时的兜底。
  const source = EXIT
  assert.match(source, /const PANEL_EXIT_EVENT = 'dsh-mobile-panel-exit'/)
  assert.match(source, /document\.dispatchEvent\(new CustomEvent\(PANEL_EXIT_EVENT\)\)/)
  assert.ok(
    source.indexOf("setAttribute(PANEL_EXIT_ATTR, '')") < source.indexOf('dispatchEvent(new CustomEvent(PANEL_EXIT_EVENT))'),
    '事件必须在挂上退场标记之后、提交 selectPanel 之前发出',
  )
  const h = installHarness()
  const events = (globalThis as unknown as Record<string, Event[]>).__documentEvents
  events.length = 0
  const panelExit = createPanelExit(h.layout)
  panelExit.exit()
  assert.ok(events.some((event) => event.type === 'dsh-mobile-panel-exit'), '退场时必须广播事件')
  panelExit.dispose()
})

