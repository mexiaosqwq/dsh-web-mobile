// 「上传附件」的桥路线（2026-10-08，DSH-APP/DSHA#101）。
//
// 形态归属已查清：弹出来是安卓文件管理还是系统「打开方式」，只由 App 侧
// WebChromeClient.onShowFileChooser 决定（现在是 params.createIntent() 直接 launch，
// 少包一层 Intent.createChooser）；插件能改的只有 accept，换不出 chooser。
//
// 所以附件那一路排三档：① App 侧给了 window.DSHA.pickFile 桥 → 走桥；
// ② 没有桥但合入了 #101 → 仍走宿主 hidden input，系统这次会弹 chooser；
// ③ 都没有 → 现状。这些测试钉住桥的选择、结果分类、取消语义与「仍归宿主 intake」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bridgePickFile,
  classifyBridgeResult,
  computePickerPlacement,
  openAttachmentPicker,
  pickResultFiles,
} from '../src/client/effects/composer-file-picker.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/composer-file-picker.ts'), 'utf8')

test('bridgePickFile：认得方法、绑好 this；半实现的桥等于没有桥', () => {
  const plain = { pickFile: () => Promise.resolve([]) }
  assert.equal(typeof bridgePickFile(plain), 'function')
  const unbound = { value: 7, pickFile() { return this.value } }
  const bound = bridgePickFile(unbound)
  assert.equal(bound?.({ accept: [], multiple: true, title: 'x' }), 7, 'this 必须绑在桥上')
  // 桥对象在、方法不在（半实现）也要回落，不能把附件路带进死胡同。
  assert.equal(bridgePickFile({}), undefined)
  assert.equal(bridgePickFile({ pickFile: 42 } as never), undefined)
  assert.equal(bridgePickFile(undefined), undefined)
})

test('pickResultFiles：只收真 File，脏数据一律丢掉', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })
  assert.deepEqual(pickResultFiles([file]), [file])
  assert.deepEqual(pickResultFiles([file, 'b.txt', null, undefined, { name: 'c' }]), [file])
  assert.deepEqual(pickResultFiles(null), [])
  assert.deepEqual(pickResultFiles('a.txt'), [])
})

test('classifyBridgeResult：取消不回落，抛错/脏返回才回落', () => {
  const file = new File([new Uint8Array([1])], 'a.txt')
  assert.equal(classifyBridgeResult([file], false), 'files')
  // 用户取消的三副面孔：null / undefined / 空数组 —— 都要静默，否则一次取消弹两次选择器。
  assert.equal(classifyBridgeResult(null, false), 'cancelled')
  assert.equal(classifyBridgeResult(undefined, false), 'cancelled')
  assert.equal(classifyBridgeResult([], false), 'cancelled')
  // 桥抛错、返回非数组、返回的全是脏数据 ⇒ 都回落，宁可回落也不能点了没反应。
  assert.equal(classifyBridgeResult(null, true), 'fallback')
  assert.equal(classifyBridgeResult({ files: [file] }, false), 'fallback')
  assert.equal(classifyBridgeResult(['a.txt'], false), 'fallback')
})

test('附件那一路：桥优先，没有桥/桥抛错/注入失败都回落宿主 input', () => {
  // 桥在就只走桥；桥不在直接回落（不 await 一个不存在的对象）。
  assert.match(SRC, /const bridge = \(window as unknown as \{ DSHA\?: DshaPickFileBridge \}\)\.DSHA/)
  assert.match(SRC, /if \(pick === undefined\) \{\n    openHostPicker\('file'\)\n    return\n  \}/)
  // 结果分类 + 取消静默 + 注入成功即结束。
  assert.match(SRC, /const outcome = classifyBridgeResult\(value, failed\)/)
  assert.match(SRC, /if \(outcome === 'cancelled'\) return/)
  // 交接目标不再是「resolve 时查到的那个 input」，而是发起时捕获的那一个（见行为用例）。
  assert.match(SRC, /if \(outcome === 'files' && handFilesToHost\(pickResultFiles\(value\), target\)\) return/)
  // 兜底仍然把点击交回宿主 input（那时若 #101 已合入，系统自己会弹 chooser）。
  const route = SRC.slice(SRC.indexOf('export async function openAttachmentPicker'))
  assert.ok(
    route.indexOf("openHostPicker('file')") > -1 && route.indexOf('await pick(') > -1,
    'bridge first, host input as the fallback',
  )
})

test('桥拿到的文件仍走宿主 intake：写 hidden input 再派发 change，不另起上传', () => {
  // 与 input.click() 那条路同一个入口：校验/大小/数量策略/上传/草稿全归宿主。
  assert.match(SRC, /const transfer = new DataTransfer\(\)/)
  assert.match(SRC, /for \(const file of files\) transfer\.items\.add\(file\)/)
  assert.match(SRC, /input\.files = transfer\.files/)
  assert.match(SRC, /input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/)
  // 注入失败要能被调用方看见（false ⇒ 回落），不能吞掉当成成功。
  assert.match(SRC, /export function handFilesToHost\(files: File\[\], input: HTMLInputElement \| null\): boolean \{/)
  // 不许在插件里另开上传通道（fetch 上传 / 自建 FormData 都不该出现）。
  assert.doesNotMatch(SRC, /FormData|XMLHttpRequest|fetch\(/)
})

test('图片那一路仍只走宿主 input 的 accept="image/*"，不上桥', () => {
  assert.match(SRC, /if \(row\.kind === 'file'\) void openAttachmentPicker\(t, readSessionId\)\n      else openHostPicker\(row\.kind\)/)
})

test('身份闸门：打开选择器时捕获 input，交接前重查同一个元素（否则丢弃这次结果）', () => {
  // 缺陷证据（2026-10-11）：桥是异步的，resolve 后若重新全局查询 input，文件会落到
  // 后来那个会话的输入区。所以身份必须在打开选择器时捕获，交接前逐项对账。
  assert.match(SRC, /const target = hostInput\(\)/)
  // `hostInput()` 只可能命中已挂载节点 ⇒「重查仍是同一个元素」同时钉住同一性与 isConnected。
  assert.match(SRC, /if \(target === null \|\| hostInput\(\) !== target\) return/)
  // 会话身份也要对：宿主切会话时可能复用同一棵 composer DOM（元素还在、只是换了会话）。
  assert.match(SRC, /if \(sessionId !== null && \(readSessionId\?\.\(\) \?\? null\) !== sessionId\) return/)
  // 丢弃要发生在回落之前 —— 不许重放 picker，也不许回落去点「当前」那个 input。
  const route = SRC.slice(SRC.indexOf('export async function openAttachmentPicker'))
  assert.ok(
    route.indexOf('if (target === null || hostInput() !== target) return') < route.indexOf("openHostPicker('file', target)"),
    'the identity check must gate the fallback too',
  )
})

// ── 行为用例（2026-10-11）─────────────────────────────────────────────────────
//
// 上面都是源码形状审计，钉不住「异步期间换了输入区」这条时序。下面用最小 DOM 桩驱动真正的
// `openAttachmentPicker`（Node 里没有 document / DataTransfer / window）：
//   capture input A → resolve 时 A 已被 B 顶替 → 断言**没有任何东西交给 B**，且不触发第二次
//   picker（缺陷原状是文件落进 B，即新会话的草稿）。

type FakeInput = {
  isConnected: boolean
  files: unknown
  dispatched: number
  clicked: number
  hasAttribute: (name: string) => boolean
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  dispatchEvent: (event: unknown) => boolean
  click: () => void
}

/** 宿主 hidden input 的桩：只实现源文件真正用到的那几样。 */
function fakeInput(): FakeInput {
  const attrs = new Map<string, string>()
  const input: FakeInput = {
    isConnected: true,
    files: null,
    dispatched: 0,
    clicked: 0,
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
    dispatchEvent: () => { input.dispatched += 1; return true },
    click: () => { input.clicked += 1 },
  }
  return input
}

/** card 桩：`hostInput()` 走 `document.querySelector(card)` → `card.querySelector(input)`。
 *  脱离文档的元素查不到（真 `document.querySelector` 就是这么回事），所以 isConnected=false
 *  的桩返回 null —— 这样「A 断开」不需要额外换 card 也能被测到。 */
const cardOf = (input: FakeInput | null): { querySelector: () => unknown } => ({
  querySelector: () => (input !== null && input.isConnected ? input : null),
})

/** 每次 new 出来的 transfer 都要能被 source 用上，所以桩成全局类。 */
class FakeDataTransfer {
  files: unknown[] = []
  items = { add: (file: unknown): void => void this.files.push(file) }
}

/** 会话 id 来源（模拟宿主 `sessions` 服务那一层）。 */
let sessionId: string | null = null
const readSessionId = (): string | null => sessionId

const t = (key: 'fileUploadImage' | 'fileUploadAttachment'): string => key

function installGlobals(cardOwner: () => unknown): void {
  // 双重 cast：Node 的类型里既没有 document/DataTransfer，也没有可写的 window。
  ;(globalThis as unknown as { document?: unknown }).document = { querySelector: cardOwner }
  ;(globalThis as unknown as { DataTransfer?: unknown }).DataTransfer = FakeDataTransfer
}

/** 装桥；调用次数由用例自己数（「不重放 picker」就靠它）。 */
function installBridge(pickFile: () => Promise<unknown>): void {
  ;(globalThis as unknown as { window?: unknown }).window = { DSHA: { pickFile } }
}

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve: (value: unknown) => void = () => {}
  const promise = new Promise<unknown>((r) => { resolve = r })
  return { promise, resolve }
}

test('行为：capture 的是 A、resolve 时 A 已被 B 顶替 —— 什么都不交给 B，也不再弹第二次', async () => {
  const a = fakeInput()
  const b = fakeInput()
  let card = cardOf(a)
  installGlobals(() => card)
  sessionId = 'session-1'
  const picked = deferred()
  let picks = 0
  installBridge(() => { picks += 1; return picked.promise })

  const pending = openAttachmentPicker(t, readSessionId)
  assert.equal(picks, 1, '桥应已同步发起')
  // 用户切会话：React 重建 composer —— A 脱离文档，B 成为当前 input。
  a.isConnected = false
  card = cardOf(b)
  sessionId = 'session-2'
  picked.resolve([new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })])
  await pending

  assert.equal(b.files, null, 'B（后来那个输入区）不该拿到任何文件')
  assert.equal(b.dispatched, 0, 'B 不该收到 change')
  assert.equal(b.clicked, 0, '也不许回落去点 B')
  assert.equal(a.dispatched, 0, 'A 已不在文档里，同样不交接')
  assert.equal(picks, 1, '不许重放第二次 picker')
})

test('行为：同一个 input 仍在文档里 —— 文件照常交接（证明闸门不是一刀切）', async () => {
  const a = fakeInput()
  const b = fakeInput()
  installGlobals(() => cardOf(a))
  sessionId = 'session-1'
  const picked = deferred()
  let picks = 0
  installBridge(() => { picks += 1; return picked.promise })

  const file = new File([new Uint8Array([9])], 'ok.txt')
  const pending = openAttachmentPicker(t, readSessionId)
  picked.resolve([file])
  await pending

  assert.deepEqual(a.files, [file], '发起时那一个 input 才拿到文件')
  assert.equal(a.dispatched, 1, '交接 = 写 files + 派发 change')
  assert.equal(a.clicked, 0, '拿到文件就不该再弹宿主选择器')
  assert.equal(b.files, null)
  assert.equal(picks, 1)
})

test('行为：input 元素没换但会话换了 —— 宿主可能复用同一棵 composer DOM，仍然丢弃', async () => {
  const a = fakeInput()
  installGlobals(() => cardOf(a))
  sessionId = 'session-1'
  const picked = deferred()
  let picks = 0
  installBridge(() => { picks += 1; return picked.promise })

  const pending = openAttachmentPicker(t, readSessionId)
  // 元素还在文档里（React 复用了它），只是当前会话变了。
  sessionId = 'session-2'
  picked.resolve([new File([new Uint8Array([1])], 'a.txt')])
  await pending

  assert.equal(a.files, null, '同一个元素也不能跨会话交接')
  assert.equal(a.dispatched, 0)
  assert.equal(a.clicked, 0)
  assert.equal(picks, 1)
})

test('行为：A 断开、B 还没挂上（会话没变）—— 仍然丢弃，不猜「用户大概还在同一会话」', async () => {
  // 取舍：元素已脱离文档就无从确认它还是不是当前 intake。宁可这一次选择白选（用户重挑），
  // 也不能冒着把文件塞进别的会话的风险 —— 所以没有「A 断了就退化成点当前 input」这条退路。
  const a = fakeInput()
  installGlobals(() => cardOf(a))
  sessionId = 'session-1'
  const picked = deferred()
  let picks = 0
  installBridge(() => { picks += 1; return picked.promise })

  const pending = openAttachmentPicker(t, readSessionId)
  a.isConnected = false
  picked.resolve([new File([new Uint8Array([1])], 'a.txt')])
  await pending

  assert.equal(a.files, null)
  assert.equal(a.dispatched, 0)
  assert.equal(a.clicked, 0, '断开的 A 也不点（点了也弹不出宿主 intake）')
  assert.equal(picks, 1)
})

test('行为：身份失效 + 桥抛错 —— 也不回落去点后来那个 input（不盲重放）', async () => {
  const a = fakeInput()
  const b = fakeInput()
  let card = cardOf(a)
  installGlobals(() => card)
  sessionId = 'session-1'
  let picks = 0
  let rejectPick: (error: Error) => void = () => {}
  installBridge(() => {
    picks += 1
    return new Promise((_resolve, reject) => { rejectPick = reject })
  })

  const pending = openAttachmentPicker(t, readSessionId)
  a.isConnected = false
  card = cardOf(b)
  rejectPick(new Error('bridge broke'))
  await pending

  assert.equal(b.clicked, 0, '身份失效时连回落都不许点 B')
  assert.equal(a.clicked, 0)
  assert.equal(picks, 1)
})

test('行为：身份仍在但桥抛错 —— 仍回落点发起时那一个 input（既有契约不变）', async () => {
  const a = fakeInput()
  const b = fakeInput()
  installGlobals(() => cardOf(a))
  sessionId = 'session-1'
  let picks = 0
  installBridge(() => { picks += 1; return Promise.reject(new Error('bridge broke')) })

  await openAttachmentPicker(t, readSessionId)

  assert.equal(a.clicked, 1, '桥坏了要回落到宿主 input，按钮不能点了没反应')
  assert.equal(b.clicked, 0)
  assert.equal(a.dispatched, 0, '回落是打开选择器，不是交接文件')
  assert.equal(picks, 1)
})

test('行为：取消（null）静默返回 —— 不交接、不回落、不重放', async () => {
  const a = fakeInput()
  installGlobals(() => cardOf(a))
  sessionId = 'session-1'
  const picked = deferred()
  let picks = 0
  installBridge(() => { picks += 1; return picked.promise })

  const pending = openAttachmentPicker(t, readSessionId)
  picked.resolve(null)
  await pending

  assert.equal(a.files, null)
  assert.equal(a.dispatched, 0)
  assert.equal(a.clicked, 0, '取消不回落（否则一次取消弹两次选择器）')
  assert.equal(picks, 1)
})

// ═══════════════════════════════════════════════════════════════════════════
// 浮层落位（2026-10-13）：写前比较 / 几何改读 visualViewport / follow 期间不重复排程
//
// 落位数学被抽成纯核 computePickerPlacement（无 DOM），所以这里能直接钉数值；
// DOM 侧那三条（写前比较、可见带来源、排程去重）是形态契约，用源码断言钉。
// ═══════════════════════════════════════════════════════════════════════════

const BAND_FULL = { top: 0, bottom: 900, left: 0, right: 400 }
const OWN = { width: 160, height: 80 }

test('落位纯核：锚点上方优先 8px，放不下翻到下方', () => {
  // 上方放得下（锚点在中下部）：top = anchor.top - 8 - own.height。
  assert.deepEqual(
    computePickerPlacement({ top: 700, right: 260, bottom: 730, left: 230 }, OWN, BAND_FULL),
    { top: 612, left: 230 },
  )
  // 上方放不下（锚点贴近顶边）：翻到下方 = anchor.bottom + 8。
  assert.deepEqual(
    computePickerPlacement({ top: 40, right: 260, bottom: 70, left: 230 }, OWN, BAND_FULL),
    { top: 78, left: 230 },
  )
})

test('落位纯核：左右都夹进可见带，右缘越界时贴带右缘', () => {
  // 锚点靠右：left 被 max-left 夹住（band.right - own.width - 8 = 232）。
  assert.deepEqual(
    computePickerPlacement({ top: 700, right: 390, bottom: 730, left: 300 }, OWN, BAND_FULL),
    { top: 612, left: 232 },
  )
  // 锚点贴左缘：夹到 band.left + 8。
  assert.deepEqual(
    computePickerPlacement({ top: 700, right: 20, bottom: 730, left: 2 }, OWN, BAND_FULL),
    { top: 612, left: 8 },
  )
})

test('落位纯核：退化档（无 visualViewport ⇒ band = [0, innerH] × [0, innerW]）与旧公式逐字等价', () => {
  const GAP = 8
  const EDGE = 8
  const cases: ReadonlyArray<{ top: number; bottom: number; left: number }> = [
    { top: 700, bottom: 730, left: 230 },
    { top: 40, bottom: 70, left: 230 },
    { top: 5, bottom: 35, left: 2 },
    { top: 880, bottom: 899, left: 395 },
  ]
  for (const box of cases) {
    const anchor = { ...box, right: box.left + 30 }
    // 旧公式：上方优先 → 放不下翻下方（用 innerHeight 夹）→ 左右夹紧 → 取整。
    let oldTop = anchor.top - GAP - OWN.height
    if (oldTop < EDGE) oldTop = Math.min(anchor.bottom + GAP, 900 - OWN.height - EDGE)
    const oldLeft = Math.max(EDGE, Math.min(anchor.left, 400 - OWN.width - EDGE))
    assert.deepEqual(
      computePickerPlacement(anchor, OWN, BAND_FULL),
      { top: Math.round(Math.max(EDGE, oldTop)), left: Math.round(oldLeft) },
      `退化档必须与旧公式逐字等价（anchor=${JSON.stringify(box)}）`,
    )
  }
})

test('落位纯核：可见带变窄/被平移时，浮层跟着夹进**看得见**的那一段', () => {
  // ① 捏合缩放把视觉视口右移 100px（带宽 600）：锚点在带的右缘外。
  //    旧版按 innerWidth=800 夹 ⇒ left=632（浮层 632..792，带上只看得见 100..700 的后半）；
  //    新版按带夹 ⇒ left=532（532..692 完整落在带内）。
  const panned = { top: 0, bottom: 900, left: 100, right: 700 }
  assert.equal(computePickerPlacement({ top: 700, right: 680, bottom: 730, left: 650 }, OWN, panned).left, 532)
  assert.notEqual(
    computePickerPlacement({ top: 700, right: 680, bottom: 730, left: 650 }, OWN, panned).left,
    Math.max(8, Math.min(650, 800 - OWN.width - 8)),
    '与「按 layout 视口宽夹」的结果必须不同，否则这条修复是空转',
  )

  // ② 横屏 + 键盘：视觉视口只剩 120px 高。锚点贴带顶、上方放不下 ⇒ 翻下方的那一支
  //    必须被带底夹住（120 - 80 - 8 = 32），旧版按 innerHeight=900 会算成 58（浮层 58..138，
  //    下半截压在带外）。
  const short = { top: 0, bottom: 120, left: 0, right: 400 }
  assert.deepEqual(
    computePickerPlacement({ top: 20, right: 60, bottom: 50, left: 20 }, OWN, short),
    { top: 32, left: 20 },
  )
})

test('DOM 侧形态：写前比较 + 可见带优先 visualViewport + follow 期间不重复排程', () => {
  const place = SRC.slice(SRC.indexOf('const place = (): void => {'), SRC.indexOf('place()\n  // 重锚定'))
  // ① 写前比较：值没变就不写（follow 每帧一调，重写 inline 样式会击穿样式失效重算）。
  assert.match(place, /const nextTop = `\$\{settled\.top\}px`/)
  assert.match(place, /if \(sheet\.style\.top !== nextTop\) sheet\.style\.top = nextTop/)
  assert.match(place, /if \(sheet\.style\.left !== nextLeft\) sheet\.style\.left = nextLeft/)
  assert.doesNotMatch(place, /sheet\.style\.top = `/, '不得再无条件写 top')
  // ② 键盘跟随的载体：锚点 rect 每次都重取（缓存它等于不跟随）。
  assert.match(place, /const anchor = trigger\.getBoundingClientRect\(\)/)
  // ③ 几何走纯核 + 可见带。
  assert.match(place, /computePickerPlacement\(anchor, own, visibleBand\(\)\)/)

  // ④ 可见带：visualViewport 优先（含 offsetTop/offsetLeft），拿不到才回退 innerWidth/innerHeight。
  const band = SRC.slice(SRC.indexOf('function visibleBand()'), SRC.indexOf('const activeClose'))
  const vvBranch = band.indexOf('window.visualViewport')
  const fallback = band.indexOf('window.innerHeight')
  assert.ok(vvBranch >= 0 && fallback > vvBranch, 'visualViewport 必须优先，回退档在后')
  assert.match(band, /vv\.offsetTop \+ vv\.height/)
  assert.match(band, /vv\.offsetLeft \+ vv\.width/)
  assert.match(band, /top: 0, bottom: window\.innerHeight, left: 0, right: window\.innerWidth/)

  // ⑤ 排程去重：follow 链在跑期间，四类视口事件一律吸收；链一结束立刻恢复。
  const onViewport = SRC.slice(SRC.indexOf('const onViewport = (): void => {'), SRC.indexOf("window.addEventListener('resize'"))
  assert.match(onViewport, /if \(following\) return/)
  assert.match(onViewport, /place\(\)/)
  // 四类监听仍在（键盘跟随的入口没被删）。
  for (const wiring of [
    "window.addEventListener('resize', onViewport)",
    "window.addEventListener('orientationchange', onViewport)",
    "window.visualViewport?.addEventListener('resize', onViewport)",
    "window.visualViewport?.addEventListener('scroll', onViewport)",
  ]) assert.ok(SRC.includes(wiring), `缺少视口监听 ${wiring}`)
  // follow 链：每帧仍 place（跟随本体），跑完 12 帧才把标志复位并显形。
  const follow = SRC.slice(SRC.indexOf('requestAnimationFrame(function follow()'))
  assert.match(follow, /^[\s\S]*?place\(\)/)
  assert.match(follow, /if \(!sheet\.isConnected\) \{\n      following = false/)
  assert.match(follow, /if \(\+\+frames < 12\) raf = requestAnimationFrame\(follow\)/)
  assert.match(follow, /following = false\n      reveal\(\)/)
  // 标志初值 true：链在打开时就跑，首帧之前不该有别的东西来插一脚。
  assert.match(SRC, /let following = true/)
  assert.ok(SRC.includes('let frames = 0'), '12 帧计数仍在')
})
