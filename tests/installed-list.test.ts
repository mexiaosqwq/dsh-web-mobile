// 已安装列表内联样式（effects/installed-list.ts 的 installed-list-inline-styles
// effect）的两条不变量：写入前比较、按所有权释放。该 effect 于 2026-10-12 由入口
// 逐字搬出成模块。
//
// 本文件分两层，别只看一半：
//   ① 源码不变式（下面这组）——切一段出来做正则断言，钉形状与常量，不执行代码；
//   ② 行为层（文件末尾）——用最小 DOM 桩把 effect 真跑起来，钉那两条不变量本身。
// 两层各拦一类：①拦「有人改了一个常量字」，②拦「代码还在、语义变了」。
// 2026-10-12 的 rowTargets 去重正好暴露了①单独用的问题：一条形态断言误报，
// 而真正的语义如果坏了①又未必看得见。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'
import { installInstalledListRows } from '../src/client/effects/installed-list.ts'

const ENTRY = readFileSync(new URL('../src/client/effects/installed-list.ts', import.meta.url), 'utf8')

const HEAD = '// Hard-fix the installed-plugins list text layout'
const TAIL = "'dsh-web-mobile: installed-list-inline-styles')"

/** 只取这一个 effect：同一文件别处也写内联样式，整文件断言会互相污染。 */
function installedListEffect(): string {
  const start = ENTRY.indexOf(HEAD)
  const end = ENTRY.indexOf(TAIL, start)
  assert.ok(start >= 0 && end > start, 'installed-list effect 未找到：切片锚点失效（改名/搬家请同步本测试）')
  return ENTRY.slice(start, end + TAIL.length)
}

/** 按前后锚点切一段出来，用来把断言限定在某个函数体里。 */
function body(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `切片「${from} … ${to}」未找到`)
  return source.slice(start, end)
}

const EFFECT = installedListEffect()

test('installed-list styling excludes nested action rows', () => {
  assert.match(COMPAT_CSS, /\[class\*="irow"\]:not\(\[class\*="irowActions"\]\):not\(\[class\*="irowTrailing"\]\)/)
})

test('写入前比较：当前值与优先级已经一致就不写', () => {
  const write = body(EFFECT, 'const write = ', 'const release = ')
  assert.match(write, /const current = el\.style\.getPropertyValue\(key\)/)
  assert.match(write, /const currentPriority = el\.style\.getPropertyPriority\(key\)/)
  assert.match(write, /if \(current === value && currentPriority === priority\) continue/)
  // 比较必须排在写入之前，否则等于没比较（每次 flush 仍然击穿样式）。
  assert.ok(
    write.indexOf('continue') < write.indexOf('el.style.setProperty(key, value, priority)'),
    '写前比较必须早于 setProperty',
  )
})

test('释放按所有权账本：值被改过不回收，没写过的不可能被 remove', () => {
  assert.match(EFFECT, /const owned = new WeakMap<HTMLElement, Map<string, Held>>\(\)/)
  assert.match(EFFECT, /type Held = \{ value: string; priority: string; before: string; beforePriority: string \}/)
  const release = body(EFFECT, 'const release = ', 'const clear = ')
  // 回收前逐属性比对当前值 + 优先级：仍是本效果写的那个值才动它。
  assert.match(
    release,
    /if \(el\.style\.getPropertyValue\(key\) !== held\.value \|\| el\.style\.getPropertyPriority\(key\) !== held\.priority\) continue/,
  )
  // 是我们的值：原本就有内联值 → 恢复原值/原优先级；原本没有 → 才删除。
  assert.match(release, /if \(held\.before === ''\) el\.style\.removeProperty\(key\)/)
  assert.match(release, /else el\.style\.setProperty\(key, held\.before, held\.beforePriority\)/)

  // clear() 本身只许调用 release()，不得自己动 style（这就是修复前的缺陷形态）。
  // 断言语义、不断言遍历写法：2026-10-12 把「行/首子节点/spec/nm」四个目标收敛成
  // rowTargets 表之后，逐目标点名（release(row)/release(first)/…）就不再是唯一合法
  // 形态了——写死的形态断言只会拦住合法重构，拦不住真正的所有权破坏。这里改成钉
  // 「只经 release() 出口」这一条不变量本身。
  const clear = body(EFFECT, 'const clear = ', 'const apply = ')
  assert.doesNotMatch(clear, /removeProperty|setProperty/)
  assert.match(clear, /release\(/)

  // apply() 同理：只许经 write()，不得直接 setProperty。
  const apply = body(EFFECT, 'const apply = ', 'const arm = ')
  assert.doesNotMatch(apply, /setProperty|removeProperty/)
  assert.match(apply, /write\(/)
})

// 「行内目标的单一描述」：apply 按这张表写、clear 按同一张表释放。四类目标
// （行 / 首个子节点 / spec / nm）与三组属性值一个字都不许变——表驱动之后这条比
// 逐目标点名更紧地守住了「写哪些元素、写哪些值」。只在 rowTargets 表确实存在时
// 断言（逐字搬运形态没有这张表，那一形态由上面几条逐目标断言覆盖）。
test('行内目标表：四类目标与属性值与搬运前逐字一致', () => {
  const start = EFFECT.indexOf('const rowTargets')
  if (start < 0) return
  const table = EFFECT.slice(start, EFFECT.indexOf('const write = ', start))
  for (const props of [
    "{ 'flex-wrap': 'wrap', 'align-items': 'center', 'gap': '4px 10px' }",
    "{ 'flex': '1 1 100%', 'max-width': '100%', 'min-width': '0' }",
  ]) assert.ok(table.includes(props), `rowTargets 缺属性组 ${props}`)
  assert.match(table, /\[class\*="spec"\]/)
  assert.match(table, /\[class\*="nm"\]/)
  assert.match(table, /row\.children\[0\]/)
  // 折行文本那组属性（TEXT）的值必须原样在模块里。
  assert.match(EFFECT, /'white-space': 'nowrap', 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'max-width': '100%'/)
  // apply 与 clear 必须共用同一张表（不许在某一侧重新内联一份遍历）。
  assert.equal((EFFECT.match(/for \(const target of rowTargets\)/g) ?? []).length, 2)
})

test('不再出现无条件 removeProperty 的属性列表', () => {
  // 修复前：rowProps / firstProps / textProps 三条属性表 + 本效果从未写过的 `order`，
  // 一律由 unset() 裸删——安装时 arm() 先 clear()，fine pointer / 宽屏首次就把宿主
  // 自己写在这些行上的内联样式删掉（属性所有权破坏）。
  assert.doesNotMatch(EFFECT, /const unset =/)
  assert.doesNotMatch(EFFECT, /rowProps|firstProps|textProps/)
  assert.doesNotMatch(EFFECT, /'order'/)
  // 整个 effect 只剩一处删属性的调用，且被「有原始值就恢复」的分支守着。
  assert.equal((EFFECT.match(/el\.style\.removeProperty\(/g) ?? []).length, 1)
})

test('既有不变量保持：市场容器 gate / rAF 合帧 / 卸载清理 / irow 排除选择器', () => {
  // 2026-10-13：gate 由「每趟一条 querySelector + 全文档扫行」改成「缓存容器 + 收窄扫描」，
  // 这条形态断言随之更新；「不在场即早退」的语义由下面那条行为测试继续钉着。
  assert.match(EFFECT, /const MARKET_GATE = '\[data-dsh-market-root\], \[role="dialog"\]'/)
  assert.match(EFFECT, /const gate = document\.querySelector<HTMLElement>\(MARKET_GATE\)/)
  assert.match(EFFECT, /if \(gate === null\) \{/)
  assert.match(EFFECT, /const rowSelector = '\[class\*="irow"\]:not\(\[class\*="irowActions"\]\):not\(\[class\*="irowTrailing"\]\)'/)
  assert.match(EFFECT, /const scheduler = createRafScheduler/)
  assert.match(EFFECT, /scheduler\.schedule\(\(\) => \{ if \(mq\.matches\) apply\(\) \}\)/)
  const disposer = body(EFFECT, 'return () => {', '}, \'dsh-web-mobile: installed-list-inline-styles\')')
  for (const step of ['scheduler.cancel()', 'mo.disconnect()', "mq.removeEventListener('change', arm)", 'clear()'])
    assert.ok(disposer.includes(step), `dispose 缺少 ${step}`)
})

// 2026-10-13：市场容器缓存 + 扫描收窄的源码不变量。行为层（文件末尾）另有一组真跑的用例。
test('市场容器缓存：命中零查询、按 isConnected 复验、行扫描收窄到容器', () => {
  const resolve = body(EFFECT, 'const resolveRoot = ', 'const apply = ')
  // 缓存命中必须先于任何查询 —— 这是「每帧一次全文档查询」被消掉的唯一理由。
  assert.match(resolve, /if \(cached !== null && cached\.isConnected\) return cached/)
  assert.ok(
    resolve.indexOf('cached.isConnected') < resolve.indexOf('document.querySelector'),
    '缓存复验必须早于查询',
  )
  // 缓存失效才查询，且存在性判定仍走旧版那条选择器（语义与查询条数不变）。
  assert.match(resolve, /const gate = document\.querySelector<HTMLElement>\(MARKET_GATE\)/)
  // 命中的不是市场根时补一条查询优先取根（收窄后「命中谁」才是语义）。
  assert.match(resolve, /gate\.matches\(MARKET_ROOT\) \? gate : document\.querySelector<HTMLElement>\(MARKET_ROOT\) \?\? gate/)

  const apply = body(EFFECT, 'const apply = ', 'const arm = ')
  assert.match(apply, /root\.querySelectorAll<HTMLElement>\(rowSelector\)/, '行扫描必须收窄到容器内')
  // 2026-10-13（fail-open）：这里原先是 `assert.doesNotMatch(apply, /document\.querySelectorAll/)`
  // —— 一条「apply 的源码里不得出现全文档扫」的**文本**命题，它当时是「apply 不许每帧
  // 全文档扫行」的代理。fail-open 之后 apply 里确实有一次全文档扫，但它落在**条件分支**
  // 上：只有「收窄扫 0 条 **且** 容器不是市场根本身」才走。真正要守的契约（正常一代零
  // 查询、收窄不变、不许退化成每帧双扫）没有被破 —— 那句话已经由行为层直接钉着：
  // 「容器仍在场时每帧零查询，行扫描只在容器内」，以及「容器本身就是市场根 → 永不
  // fail-open」（后者用一颗诱饵行证明**一次**多余的兜底扫都跑不掉）。正则表达不了条件，
  // 继续钉旧文本只会拦住这个正确实现、拦不住「兜底条件被写漏」，所以改成钉条件本身：
  assert.match(apply, /if \(rows\.length === 0 && !root\.matches\(MARKET_ROOT\)\)/, 'fail-open 的两个前提缺一不可')
  assert.equal(
    (apply.match(/document\.querySelectorAll/g) ?? []).length,
    1,
    'apply 里全文档扫只许出现在 fail-open 那一条分支',
  )
  // 收窄扫仍是主路径：先查容器、拿不到才谈兜底（顺序反了就是每帧双扫）。
  assert.ok(
    apply.indexOf('root.querySelectorAll') < apply.indexOf('document.querySelectorAll'),
    '收窄扫必须先于兜底扫',
  )
  // clear() 刻意保持全文档：它负责把写过的样式全还回去，收窄会漏（见源码注释）。
  const clear = body(EFFECT, 'const clear = ', 'const apply = ')
  assert.match(clear, /document\.querySelectorAll<HTMLElement>\(rowSelector\)/)
})

// 2026-10-12（P3 搬运）补的两条「搬运形状」锚：块被搬出入口后，切片锚点从
// index.tsx 换到 effects/installed-list.ts（上面的 ENTRY），所以这里再钉一遍
// 「搬进模块的只有一个 effect、且入口只做组装与调用」——否则下一位把别的东西
// 塞进这个模块、或把 effect 又写回入口，切片仍绿而这组不变量已经漂了。
test('搬运形状：模块内只有一个 effect，入口只组装不内联', () => {
  // 模块里恰好一处 ctx.effect：切片锚 TAIL 正是那处的收尾，多一处就说明模块
  // 不再是「一个效果的模块」，本文件的切片也不再只圈住这一块。
  assert.equal((ENTRY.match(/ctx\.effect\(/g) ?? []).length, 1)
  // 安装函数是 install<Domain> 形式，且入口确实调用它（而不是留着旧的内联块）。
  assert.match(ENTRY, /export function installInstalledListRows\(ctx: ClientContext\): void \{/)
  const entry = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(entry, /import \{ installInstalledListRows \} from '\.\/effects\/installed-list\.ts'/)
  assert.match(entry, /^\s*installInstalledListRows\(ctx\)$/m)
  // 入口不得再留这块业务：irow 行选择器与 !important 写入必须只存在于模块里。
  assert.doesNotMatch(entry, /irowActions/)
  assert.doesNotMatch(entry, /removeProperty/)
})

// ═══════════════════════════════════════════════════════════════════════════
// ② 行为层：把 effect 真跑起来
//
// 本仓 test:core 历来是「源码不变式审计，无 DOM 无真渲染」，所以上面那组只能做
// 文本断言。但这个 effect 的两条契约**本身就是 DOM 行为**——「值没变就不写」和
// 「只回收自己写的值」只有在真的读写一个 CSSStyleDeclaration 时才存在。文本断言
// 对合法重构会误报（rowTargets 去重已实测一次），对真实语义退化又可能漏报。
//
// 这里手搓一个只实现**被测代码真正用到的那一小片**语义的桩，然后调用
// installInstalledListRows(fakeCtx) 真跑。桩刻意保守：没实现的成员一律不提供
// （访问即 TypeError），不静默兜底——静默兜底会把「effect 开始用新 API」这种
// 变化伪装成假绿。
// ═══════════════════════════════════════════════════════════════════════════

const ROW_SELECTOR = '[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"])'
const SPEC_SELECTOR = '[class*="spec"]'
const NM_SELECTOR = '[class*="nm"]'

type StyleDecl = { value: string; priority: string }

/** CSSStyleDeclaration 的最小子集，语义照规范：没设过的属性读出来是空串。 */
function fakeStyle() {
  const decls = new Map<string, StyleDecl>()
  const writes: string[] = []
  const removes: string[] = []
  return {
    decls,
    writes,
    removes,
    getPropertyValue: (key: string): string => decls.get(key)?.value ?? '',
    getPropertyPriority: (key: string): string => decls.get(key)?.priority ?? '',
    setProperty(key: string, value: string, priority?: string): void {
      writes.push(key)
      decls.set(key, { value, priority: priority ?? '' })
    },
    removeProperty(key: string): string {
      removes.push(key)
      const previous = decls.get(key)?.value ?? ''
      decls.delete(key)
      return previous
    },
  }
}

function fakeNode(queryMap: Record<string, unknown> = {}, children: unknown[] = []) {
  return {
    style: fakeStyle(),
    children,
    querySelector: (selector: string): unknown => queryMap[selector] ?? null,
  }
}

type FakeNode = ReturnType<typeof fakeNode>

/** 一行 + 它的首个子节点 + spec/nm 两个后代，就是 effect 认的四类目标。 */
function makeScene() {
  const spec = fakeNode()
  const nm = fakeNode()
  const first = fakeNode()
  const row = fakeNode({ [SPEC_SELECTOR]: spec, [NM_SELECTOR]: nm }, [first])
  return { row, first, spec, nm }
}

/** 属性 → 「值!」形式，! 代表 !important；用来一眼断言写下的整张表。 */
function declsOf(node: FakeNode): Record<string, string> {
  return Object.fromEntries(
    [...node.style.decls].map(([key, decl]) => [key, decl.priority === 'important' ? `${decl.value}!` : decl.value]),
  )
}

function totalWrites(nodes: FakeNode[]): number {
  return nodes.reduce((sum, node) => sum + node.style.writes.length, 0)
}

function resetWrites(nodes: FakeNode[]): void {
  for (const node of nodes) {
    node.style.writes.length = 0
    node.style.removes.length = 0
  }
}

const MARKET_GATE_SEL = '[data-dsh-market-root], [role="dialog"]'
const MARKET_ROOT_SEL = '[data-dsh-market-root]'

/**
 * 市场容器桩（2026-10-13）。effect 现在把行扫描收窄到**容器**上、并按 isConnected 复验缓存，
 * 所以这里必须提供一个带 matches/querySelectorAll/isConnected 的容器，而不是让
 * document.querySelector 随便返回一个空对象——空对象会在 root.querySelectorAll 处 TypeError，
 * 那正是「桩没跟上源码」的信号（本文件两头都要跟）。
 *
 * gateMode 四态：
 *   'root'     两个标记都命中同一个市场根（正常档）
 *   'dialog'   只命中一个普通弹层，市场根查询落空 ⇒ 退而扫弹层（标记换代的降级档）
 *   'shadowed' 文档序在前的弹层 + 另一个市场根 ⇒ 必须扫市场根而不是弹层
 *   'none'     两个标记都不在场（早退档）
 *
 * 2026-10-13（fail-open）补的三项 `*Rows`：决定「行长在谁下面」。真 DOM 里容器查询只命中
 * 自己的后代、全文档查询命中任何位置，桩必须能表达这个差别 —— 否则「收窄扫拿到 0 条」
 * 这一档根本造不出来（默认三处都返回 state.rows，收窄扫永远拿得到行，任何 fail-open 断言
 * 都会是空转）。
 */
function makeContainer(name: string, isRoot: boolean, scans: string[], rowsOf: () => FakeNode[]) {
  return {
    name,
    isConnected: true,
    matches: (selector: string): boolean => isRoot && selector === MARKET_ROOT_SEL,
    querySelectorAll: (selector: string): FakeNode[] => { scans.push(`${name}:${selector}`); return rowsOf() },
  }
}

function installHarness(options: {
  rows?: FakeNode[]
  /** 收窄扫命中的那个容器（'root' 档）里有哪些行。 */
  rootRows?: FakeNode[]
  /** 降级档命中的弹层容器里有哪些行。 */
  dialogRows?: FakeNode[]
  /** 全文档查询（clear() 与 fail-open 兜底）能看到哪些行。 */
  documentRows?: FakeNode[]
  matches?: boolean
  gate?: boolean
  gateMode?: string
} = {}) {
  const gateMode = options.gateMode ?? (options.gate === false ? 'none' : 'root')
  const state = {
    rows: options.rows ?? [],
    /** 每一次行选择器扫描的入参：`<容器名>:<选择器>` —— 同时证明「用哪条选择器」与「扫的哪个容器」。 */
    scans: [] as string[],
    /** 每一次 document.querySelector 的入参：存在性判定与「优先市场根」的补查询。 */
    gates: [] as string[],
    rafQueue: [] as Array<() => void>,
    rafCancelled: [] as number[],
    listeners: new Map<string, () => void>(),
    disconnects: 0,
    observes: 0,
    onMutate: null as null | (() => void),
    disposer: undefined as undefined | (() => void),
  }

  const rowsOf = (): FakeNode[] => state.rows
  const rootContainer = makeContainer('root', true, state.scans, () => options.rootRows ?? rowsOf())
  const dialogContainer = makeContainer('dialog', false, state.scans, () => options.dialogRows ?? rowsOf())
  const documentRows = (): FakeNode[] => options.documentRows ?? rowsOf()

  const mq = {
    matches: options.matches ?? true,
    addEventListener(type: string, listener: () => void): void { state.listeners.set(type, listener) },
    removeEventListener(type: string): void { state.listeners.delete(type) },
  }

  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = {
    matchMedia: () => mq,
    requestAnimationFrame: (callback: () => void): number => {
      state.rafQueue.push(callback)
      return state.rafQueue.length
    },
    cancelAnimationFrame: (id: number): void => { state.rafCancelled.push(id) },
  }
  globals.document = {
    documentElement: {},
    querySelector: (selector: string): unknown => {
      state.gates.push(selector)
      if (gateMode === 'none') return null
      // 已卸载的容器查不到（真 DOM 里移除的子树不可能被 querySelector 命中）。
      const mounted = (node: { isConnected: boolean }) => (node.isConnected ? node : null)
      if (selector === MARKET_GATE_SEL) return mounted(gateMode === 'root' ? rootContainer : dialogContainer)
      // 补查询（只可能是 MARKET_ROOT）：'shadowed' 才有独立的根可拿。
      return gateMode === 'shadowed' ? mounted(rootContainer) : null
    },
    querySelectorAll: (selector: string): unknown[] => {
      state.scans.push(`document:${selector}`)
      return documentRows()
    },
  }
  globals.MutationObserver = class {
    constructor(callback: () => void) { state.onMutate = callback }
    observe(): void { state.observes += 1 }
    disconnect(): void { state.disconnects += 1 }
  }

  const ctx = {
    effect: (fn: () => (() => void) | void): void => {
      const disposer = fn()
      if (typeof disposer === 'function') state.disposer = disposer
    },
  }
  installInstalledListRows(ctx as unknown as ClientContext)

  return {
    state,
    mq,
    rootContainer,
    dialogContainer,
    /** 收窄后的行扫描（排除 clear() 那条全文档扫描）。 */
    containerScans: (): string[] => state.scans.filter((entry) => !entry.startsWith('document:')),
    /** 全文档行扫描：clear() 每趟一条，apply 的 fail-open 兜底一条。断言一律看**增量**。 */
    documentScans: (): string[] => state.scans.filter((entry) => entry.startsWith('document:')),
    /** 跑掉这一帧排队的 rAF 回调。 */
    frame: (): void => { for (const callback of state.rafQueue.splice(0)) callback() },
    /** 模拟一次 DOM 变动，再跑一帧。 */
    mutate: (): void => { state.onMutate?.(); for (const callback of state.rafQueue.splice(0)) callback() },
    /** 模拟断点切换（mq change）。 */
    fireChange: (): void => { for (const listener of state.listeners.values()) listener() },
    dispose: (): void => { state.disposer?.() },
  }
}

test('行为：移动档 arm 把四类目标按表写满，值/优先级与搬运前逐字一致', () => {
  const { row, first, spec, nm } = makeScene()
  const harness = installHarness({ rows: [row] })

  assert.deepEqual(declsOf(row), { 'flex-wrap': 'wrap!', 'align-items': 'center!', 'gap': '4px 10px!' })
  assert.deepEqual(declsOf(first), { flex: '1 1 100%!', 'max-width': '100%!', 'min-width': '0!' })
  assert.deepEqual(declsOf(spec), {
    'white-space': 'nowrap!', overflow: 'hidden!', 'text-overflow': 'ellipsis!', 'max-width': '100%!',
  })
  assert.deepEqual(declsOf(nm), declsOf(spec))

  // 遍历必须走那条排除嵌套动作行的选择器，而不是任意行。
  assert.ok(
    harness.containerScans().includes(`root:${ROW_SELECTOR}`),
    'apply 未在容器内使用 irow 排除选择器',
  )
  assert.equal(harness.state.observes, 1, '应挂上且只挂一个 MutationObserver')
  assert.ok(harness.state.listeners.has('change'), '应监听断点变化')
})

test('行为：写前比较是真的——第二帧零写入，只有被改掉的格子重写', () => {
  const { row, first, spec, nm } = makeScene()
  const nodes = [row, first, spec, nm]
  const harness = installHarness({ rows: [row] })

  // 首次 arm：3 + 3 + 4 + 4 个属性。
  assert.equal(totalWrites(nodes), 14, '首次 arm 的写入数不对')

  resetWrites(nodes)
  harness.mutate()
  assert.equal(totalWrites(nodes), 0, '值+优先级都没变，第二帧必须零写入（2026-10-11 写前比较修复）')

  // 非空转：把其中一格改掉，下一次 apply 必须且只能补写那一格。
  row.style.setProperty('gap', '0px')
  resetWrites(nodes)
  harness.mutate()
  assert.equal(totalWrites(nodes), 1, '只该重写被改掉的那一格')
  assert.deepEqual(row.style.writes, ['gap'])
  assert.equal(row.style.getPropertyValue('gap'), '4px 10px')
})

test('行为：新出现的行经 MutationObserver→rAF 后被写入，且多帧合并成一次', () => {
  const { row } = makeScene()
  const harness = installHarness({ rows: [row] })
  const scansAfterInstall = harness.state.scans.length

  const late = fakeNode({}, [fakeNode()])
  harness.state.rows.push(late)
  harness.mutate()
  assert.equal(late.style.getPropertyValue('flex-wrap'), 'wrap', '新行没被写入')
  assert.equal(late.style.getPropertyPriority('flex-wrap'), 'important')

  // 同一个 rAF 窗口内的多次变动只许合成一次 apply。
  const scansBefore = harness.state.scans.length
  harness.state.onMutate?.()
  harness.state.onMutate?.()
  harness.state.onMutate?.()
  harness.frame()
  assert.equal(harness.state.scans.length - scansBefore, 1, '三帧必须合并成一次扫描')
  assert.ok(scansAfterInstall > 0)
})

test('行为：释放只回收「仍是我们写的值」，被别处改过的格子永久弃权', () => {
  const { row, first, spec, nm } = makeScene()
  const harness = installHarness({ rows: [row] })

  // 宿主在我们写过之后又改了 flex-wrap —— 值不再等于我们写下的那个。
  row.style.setProperty('flex-wrap', 'nowrap')
  harness.dispose()

  assert.equal(row.style.getPropertyValue('flex-wrap'), 'nowrap', '被别处改过的值必须留在原地')
  assert.equal(row.style.getPropertyPriority('flex-wrap'), '', '不得顺手改回 !important')
  assert.ok(!row.style.removes.includes('flex-wrap'), '不得把别人的值删掉')

  // 我们写过、且之后没人动过的，必须全部回收。
  assert.deepEqual(declsOf(row), { 'flex-wrap': 'nowrap' })
  assert.deepEqual(declsOf(first), {})
  assert.deepEqual(declsOf(spec), {})
  assert.deepEqual(declsOf(nm), {})
})

test('行为：原本就有内联值的格子，释放时恢复原值与原优先级；没碰过的属性零改动', () => {
  const spec = fakeNode()
  const row = fakeNode({ [SPEC_SELECTOR]: spec }, [fakeNode()])
  // 宿主原本的内联值：一个带 !important、一个不带、一个我们根本不写。
  row.style.setProperty('align-items', 'flex-start', 'important')
  row.style.setProperty('gap', '0px')
  spec.style.setProperty('color', 'red')

  const harness = installHarness({ rows: [row] })
  assert.equal(row.style.getPropertyPriority('align-items'), 'important')
  assert.equal(row.style.getPropertyValue('align-items'), 'center')

  harness.dispose()
  assert.equal(row.style.getPropertyValue('align-items'), 'flex-start', '应恢复原值')
  assert.equal(row.style.getPropertyPriority('align-items'), 'important', '应恢复原优先级')
  assert.equal(row.style.getPropertyValue('gap'), '0px', '应恢复原值')
  assert.equal(row.style.getPropertyPriority('gap'), '')
  // 我们从未写过的属性：既不该被删，也不该被动。
  assert.equal(spec.style.getPropertyValue('color'), 'red')
  assert.ok(!spec.style.removes.includes('color'))
})

test('行为：非移动档 arm 只清不写', () => {
  const { row, first, spec, nm } = makeScene()
  const nodes = [row, first, spec, nm]
  const harness = installHarness({ rows: [row], matches: false })

  assert.equal(totalWrites(nodes), 0, '非移动档不得写入')
  assert.deepEqual(declsOf(row), {})
  assert.ok(harness.state.scans.length > 0, 'clear() 仍须扫一遍，清掉上一档可能残留的写入')
})

test('行为：市场根/对话框不在场时 apply 早退，不再扫全文', () => {
  const { row } = makeScene()
  const harness = installHarness({ rows: [row], gate: false })

  // install 时 arm() 的 clear() 扫过一次（那一次是必需的），此后不该再有扫描。
  const scansAfterArm = harness.state.scans.length
  assert.equal(totalWrites([row]), 0, 'gate 关闭时不得写入')
  assert.deepEqual(declsOf(row), {})

  harness.mutate()
  assert.equal(harness.state.scans.length, scansAfterArm, 'gate 关闭时 apply 不得再扫全文')
  assert.equal(totalWrites([row]), 0)
})

// 上面那条的对照组：gate 在场时同一帧必须真写下去，否则前一条可能只是「什么都没发生」。
test('行为：对照组——市场根在场时同样的帧确实写入了', () => {
  const { row } = makeScene()
  const harness = installHarness({ rows: [row], gate: true })
  assert.equal(harness.state.gates.length > 0, true, 'gate 查询本身必须发生过')
  assert.equal(row.style.getPropertyValue('flex-wrap'), 'wrap')
})

test('行为：断点关→开重新武装，开→关清掉写入', () => {
  const { row } = makeScene()
  const harness = installHarness({ rows: [row], matches: false })
  assert.equal(row.style.getPropertyValue('flex-wrap'), '')

  harness.mq.matches = true
  harness.fireChange()
  assert.equal(row.style.getPropertyValue('flex-wrap'), 'wrap')
  assert.equal(row.style.getPropertyPriority('flex-wrap'), 'important')

  harness.mq.matches = false
  harness.fireChange()
  assert.deepEqual(declsOf(row), {}, '关档必须把移动档写入全部清掉')
})

test('行为：dispose 断观察器、摘监听、取消待跑帧，并释放全部写入', () => {
  const { row, first, spec, nm } = makeScene()
  const harness = installHarness({ rows: [row] })

  harness.state.onMutate?.()
  assert.equal(harness.state.rafQueue.length, 1, '应有且只有一帧排队')

  harness.dispose()
  assert.equal(harness.state.disconnects, 1, 'MutationObserver 未断开')
  assert.equal(harness.state.listeners.size, 0, '断点监听未摘')
  assert.deepEqual(harness.state.rafCancelled, [1], '待跑帧未取消')
  for (const node of [row, first, spec, nm]) {
    assert.deepEqual(declsOf(node), {}, 'dispose 后插件写的属性必须全部释放')
  }
})

// ── 2026-10-13：市场容器缓存 + 扫描收窄的行为层 ──────────────────────────────
// 三条都用同一套桩：容器缓存让「挂上之后每帧零查询」成立，扫描收窄让任意 dialog
// 在场时不再全文档扫 irow。计数是硬指标，不看感觉。

test('行为：容器仍在场时每帧零查询，行扫描只在容器内', () => {
  const { row } = makeScene()
  const harness = installHarness({ rows: [row] })

  // arm() 那一趟必须查询（还没有缓存）。
  assert.equal(harness.state.gates.length, 1, 'arm 首趟应有且只有一次存在性查询')
  assert.deepEqual(harness.state.gates, [MARKET_GATE_SEL], '存在性查询仍走旧版那条选择器')
  const scansAfterArm = harness.containerScans().length

  for (let round = 0; round < 3; round += 1) harness.mutate()
  assert.equal(harness.state.gates.length, 1, '容器仍在场：后续帧不得再查询')
  assert.equal(harness.containerScans().length - scansAfterArm, 3, '每帧仍要在容器内扫一次行（不是不干活）')
  // 全文档扫行只剩 clear() 一条路（arm 那一趟），apply 期间一次都没有。
  assert.equal(
    harness.state.scans.filter((entry) => entry.startsWith('document:')).length,
    1,
    'apply 期间不得再全文档扫行',
  )
  assert.equal(row.style.getPropertyValue('flex-wrap'), 'wrap')
})

test('行为：文档序在前的弹层挡不住市场根——补查询优先取根', () => {
  const { row } = makeScene()
  // 'shadowed'：存在性查询按文档序先命中一个普通弹层，市场根另在别处。
  const shadowed = installHarness({ rows: [row], gateMode: 'shadowed' })
  assert.ok(
    shadowed.containerScans().every((entry) => entry.startsWith('root:')),
    '必须扫市场根，而不是文档序在前的弹层（否则市场行被静默漏掉）',
  )
  assert.ok(shadowed.state.gates.includes(MARKET_ROOT_SEL), '命中非根时必须补一次市场根查询')
  assert.equal(row.style.getPropertyValue('flex-wrap'), 'wrap')

  // 降级档：市场根标记换掉（查不到）时退回弹层，效果不静默死掉。
  const { row: fallbackRow } = makeScene()
  const fallback = installHarness({ rows: [fallbackRow], gateMode: 'dialog' })
  assert.ok(
    fallback.containerScans().every((entry) => entry.startsWith('dialog:')),
    '没有市场根时应退回弹层扫描',
  )
  assert.equal(fallbackRow.style.getPropertyValue('flex-wrap'), 'wrap')
})

test('行为：容器卸载后缓存失效——重新查询、查不到就早退，新容器挂上后照常写', () => {
  const { row } = makeScene()
  const harness = installHarness({ rows: [row] })
  assert.equal(harness.state.gates.length, 1)

  // 市场关掉：容器不再挂在文档上。
  harness.rootContainer.isConnected = false
  const scansBefore = harness.containerScans().length
  const gatesBefore = harness.state.gates.length
  harness.mutate()
  assert.equal(harness.state.gates.length, gatesBefore + 1, '缓存的容器断开后必须重新查询')
  assert.equal(harness.containerScans().length, scansBefore, '查不到容器就早退，不许再扫')

  // 再开一次：新根挂上，写入照常。
  harness.rootContainer.isConnected = true
  row.style.setProperty('gap', '0px')
  resetWrites([row])
  harness.mutate()
  assert.ok(harness.state.gates.length > gatesBefore + 1, '新根出现后必须重新查询并认下它')
  assert.equal(row.style.getPropertyValue('gap'), '4px 10px', '新根里的行必须被重新写上')
})

// ── 2026-10-13：fail-open 档（独立验证 V5）───────────────────────────────────
// 「命中的不是市场根」这一档原先只兜底了容器、没兜底范围：市场行若长在容器**外面**，
// 收窄扫一条都拿不到也不报错 —— 静默漏写，不是注释里承诺的「降级为成本」。
// 下面两条一正一反：一条钉「该兜的时候兜住」，一条钉「不该兜的时候一次都不许兜」
// ——后者才是前者不退化成正当代价的前提。
// 计数一律看**增量**：arm() 内部先跑 clear()，而 clear() 按设计就做全文档扫，
// 所以「scans 里出现过 document: 扫描」这种绝对值断言恒真（空转断言）。

test('行为：降级档收窄扫空手而归 → 同一趟退回全文档，市场行不漏写', () => {
  const { row, spec } = makeScene()
  // 降级档：存在性查询只命中一个普通弹层、市场根查询落空，而市场行长在弹层**外面**
  // （真 DOM 里容器查询只命中自己的后代 —— 这就是 V5 的静默漏写档）。
  const harness = installHarness({ gateMode: 'dialog', dialogRows: [], documentRows: [row] })

  // 先说语义（V5 的症状本身）：漏写的行必须被补上，且兜底那条路写的是完整的四类
  // 目标（不是只写了行本身）。这条排在最前 —— 撤掉 fail-open 时先红的就是它，
  // 「市场行静默漏写」这个症状不会被一句计数断言盖住。
  assert.equal(row.style.getPropertyValue('flex-wrap'), 'wrap', '收窄扫空手时必须退回全文档把行写回来')
  assert.equal(row.style.getPropertyPriority('flex-wrap'), 'important')
  assert.deepEqual(declsOf(spec), {
    'white-space': 'nowrap!', overflow: 'hidden!', 'text-overflow': 'ellipsis!', 'max-width': '100%!',
  })

  // arm 那一趟恰好两条全文档扫：clear() 一条（它按设计必须全文档），apply 里收窄扫
  // 空手之后补一条。少一条就是没兜住。
  assert.equal(
    harness.documentScans().length,
    2,
    'arm 应恰好两次全文档扫：clear() 一次 + fail-open 兜底一次',
  )
  // 「同一趟」= 同一个 apply 调用里，收窄先扫、拿不到再兜底；不是另起一趟/另一帧。
  assert.deepEqual(
    harness.state.scans.slice(-2),
    [`dialog:${ROW_SELECTOR}`, `document:${ROW_SELECTOR}`],
    'fail-open 必须紧跟在收窄扫之后、同一趟完成',
  )

  // 后续帧照旧：收窄扫仍是每帧一次的主路径，兜底每帧只补一次（不是两次收窄、两次兜底）。
  const docsBefore = harness.documentScans().length
  const containersBefore = harness.containerScans().length
  harness.mutate()
  assert.equal(harness.documentScans().length - docsBefore, 1, '降级档每帧只许补一次全文档扫')
  assert.equal(harness.containerScans().length - containersBefore, 1, '收窄扫仍是每帧一次的主路径')
})

test('行为：容器本身就是市场根 → 永不 fail-open（正常一代零查询、收窄不变）', () => {
  // ① 兜底的第一个前提「有行存在的信号」：收窄扫拿得到行时，行长在容器外的同选择器
  // 节点一律不许被写（否则正常一代就退化成每帧双扫）。
  const { row } = makeScene()
  const decoy = makeScene().row
  const normal = installHarness({ rootRows: [row], documentRows: [decoy] })
  assert.equal(row.style.getPropertyValue('flex-wrap'), 'wrap', '收窄扫拿得到行时应正常写入')
  assert.equal(decoy.style.getPropertyValue('flex-wrap'), '', '收窄扫非空时不许再全文档扫')
  const docsAfterArm = normal.documentScans().length
  for (let round = 0; round < 3; round += 1) normal.mutate()
  assert.equal(normal.documentScans().length - docsAfterArm, 0, '正常一代：apply 期间零全文档扫')
  assert.equal(decoy.style.getPropertyValue('flex-wrap'), '', '正常一代：三帧之后诱饵行仍未被写')

  // ①b 同一个前提在降级档也成立：弹层里拿得到行就说明容器是对的，兜底不许再扫全文档
  // —— 否则弹层之外的同选择器节点会被顺手写掉（本效果的写入是内联强制样式，写出去就是
  // 写到别人的行上），而且每帧多付一次全文档扫。
  const { row: inDialogRow } = makeScene()
  const dialogDecoy = makeScene().row
  const degraded = installHarness({ gateMode: 'dialog', dialogRows: [inDialogRow], documentRows: [inDialogRow, dialogDecoy] })
  assert.equal(inDialogRow.style.getPropertyValue('flex-wrap'), 'wrap', '弹层里拿得到行时必须照常写')
  assert.equal(dialogDecoy.style.getPropertyValue('flex-wrap'), '', '弹层里拿得到行时不许再兜底扫全文档')
  assert.equal(degraded.documentScans().length, 1, '降级档拿到行时 apply 期间零全文档扫（只剩 clear 那一条）')
  degraded.mutate()
  assert.equal(degraded.documentScans().length, 1, '降级档拿到行时后续帧同样零全文档扫')

  // ② 兜底的第二个前提「容器不是市场根本身」：市场根**自己**扫空时，空结果的语义是
  // 「市场当前没有行」，不是「找错容器」—— 不许把别处的同选择器节点当市场行写掉。
  const { row: rootlessRow } = makeScene()
  const empty = installHarness({ rootRows: [], documentRows: [rootlessRow] })
  assert.ok(empty.containerScans().includes(`root:${ROW_SELECTOR}`), '收窄扫必须真的发生过（不是整个 apply 早退）')
  assert.equal(rootlessRow.style.getPropertyValue('flex-wrap'), '', '市场根上的空结果不许触发 fail-open')
  const emptyDocsAfterArm = empty.documentScans().length
  empty.mutate()
  assert.equal(empty.documentScans().length - emptyDocsAfterArm, 0, '根上的空结果也不许退化成每帧全文档扫')

  // ③ 'shadowed' 档补查询拿到的就是市场根：同样按「容器即根」处理 —— 判据是**容器的
  // 标记身份**，不是「存在性查询有没有先命中弹层」。
  const { row: shadowRow } = makeScene()
  const shadow = installHarness({ gateMode: 'shadowed', rootRows: [], documentRows: [shadowRow] })
  assert.equal(shadowRow.style.getPropertyValue('flex-wrap'), '', '补查询拿到的根是权威容器，空结果同样不兜底')
  assert.equal(shadow.documentScans().length, 1, 'shadowed 档 apply 期间零全文档扫（只剩 clear 那一条）')
})
