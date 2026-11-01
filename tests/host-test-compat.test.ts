import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createStatsLineTask } from '../src/client/effects/stats-line.ts'

// Execute the actual task. Geometry is controlled; these are call counts, not FPS.
function statsFixture(initialTps = false, initialRing = true) {
  // queries  = 所有 document.querySelector 调用（含 measureRing 那条车道查询）
  // stackScans = locateTps 里那条 `stack.querySelectorAll('div')`（2026-10-13 被短路消掉的那条）
  const counts = { rect: 0, ringQueries: 0, queries: 0, stackScans: 0 }
  const rect = { left: 0, top: 0, width: 360, height: 20 }
  let withTps = initialTps
  const node = (marker, text = '') => ({
    isConnected: true, textContent: text, children: [], parentElement: null,
    style: {}, clientLeft: 0, clientTop: 0,
    getAttribute: key => key === 'data-mobile-nav' ? marker : null,
    setAttribute(key, value) { if (key === 'data-mobile-nav') marker = value },
    getBoundingClientRect() { counts.rect++; return { ...rect } },
    contains: () => false,
  })
  const anchor = node('stats'), stack = node(null), holder = node(null)
  const dock = node('stats-ring-dock'), reserve = node('stats-ring-reserve')
  // The reserve is what the ring overlay is positioned against, so it needs its own
  // box: the skip key now includes it (see moveReserve below).
  let reserveRect = { ...rect }
  reserve.getBoundingClientRect = () => { counts.rect++; return { ...reserveRect } }
  const primary = node(null), row = node(null)
  const tps = node('stats-tps', 'TPS 89.4 tok/s'), tpsReserve = node('stats-tps-reserve', tps.textContent)
  const makeRing = () => { const ring = node('stats-ring', '45%'); ring.parentElement = dock; return ring }
  const ring = makeRing()
  anchor.parentElement = holder
  holder.parentElement = dock
  tps.parentElement = dock
  dock.children = initialRing ? [holder, ring] : [holder]
  holder.contains = target => target === anchor
  reserve.nextElementSibling = primary
  anchor.closest = selector => selector.includes('_composerStack') ? stack : anchor
  anchor.querySelector = () => withTps ? tpsReserve : null
  stack.querySelectorAll = () => { counts.stackScans += 1; return withTps ? [tps] : [] }
  // 真 DOM 里 textContent 覆盖整棵子树，所以读数在栈内时它的文本必然出现在 stack.textContent 里。
  // 快路径的零查询预筛（resolveTpsForKey 第 ② 级）就是靠这一点，桩必须照实模拟。
  Object.defineProperty(stack, 'textContent', { get: () => (withTps ? tps.textContent : '') })
  row.querySelector = selector => selector.includes('stats-ring-reserve') ? reserve : primary
  const before = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle }
  globalThis.document = {
    querySelector(selector) {
      counts.queries += 1
      if (selector.includes('data-composer-card')) { counts.ringQueries++; return row }
      if (selector.includes('data-mobile-nav="stats"')) return anchor
      throw new Error(`Unexpected query: ${selector}`)
    },
  }
  globalThis.window = { addEventListener() {}, visualViewport: { addEventListener() {} } }
  globalThis.getComputedStyle = () => ({ position: 'relative' })
  const task = createStatsLineTask()
  return {
    counts, task,
    changeTps: value => { withTps = value },
    moveReserve: dx => { reserveRect = { ...reserveRect, left: reserveRect.left + dx } },
    replaceRing: () => { dock.children = [holder, makeRing()] },
    removeRing: () => { dock.children = [holder] },
    restore: () => Object.assign(globalThis, before),
  }
}

// 2026-10-13：上面那条 2026-10-12 移交的「优化项」已落地，本文件恢复该**查询计数**契约
// 并扩成硬指标（下面的用例用同一套桩逐项钉数字）。
// 改前的空转链条：`locateTps(anchor)` 在 key 比较**之前**无条件跑（含那条
// `stack.querySelectorAll('div')`）；TPS 缺席时 `stillFolded(null, 'stats-tps')` 恒 false
// ⇒ 跳过判定永不成立 ⇒ 每趟都真折一遍（measure + write，含强制同步布局）。

// 实测（同一套桩；第一趟建立折叠态，之后连续 10 趟 ensure 什么都不改）：
//   配置                       querySelector   stack.querySelectorAll(div)   ring 车道查询   rect
//   TPS 在场 + 环在场   改前         10                    10                     0         20
//                      改后         10                     0                     0         20
//   TPS 缺席 + 环在场   改前         20                    10                    10         60
//                      改后         10                     0                     0         20
//   TPS 在场 + 环缺席   改前/改后     10                    10                     0         50
// 第三档两版同价：环缺席时环形那两个槽没有 presence 位可判（保持原判据、不做成可跳过），
// 于是那一档每趟都在**真折**，折叠那一趟本来就要重解析读数 —— 不是空转，是必要开销。
test('未变化的 pass 不再做 TPS 全栈 div 查询，TPS 缺席时也不再空转', () => {
  // ① TPS 在场 + 环在场：唯一被消掉的是那条全栈 div 查询，rect 次数与改前一致。
  const withTps = statsFixture(true, true)
  try {
    withTps.task.ensure()
    const base = { ...withTps.counts }
    for (let i = 0; i < 10; i += 1) withTps.task.ensure()
    assert.equal(withTps.counts.stackScans - base.stackScans, 0, '未变化的 pass 不得再扫全栈 div')
    assert.equal(withTps.counts.queries - base.queries, 10, '每趟仍要一次 querySelector（认锚点）')
    assert.equal(withTps.counts.rect - base.rect, 20, '每趟两次 rect（锚点盒 + 环形占位盒）')
  } finally { withTps.restore() }

  // ② TPS 缺席 + 环在场（宿主没渲染读数、或还没出第一个 token）：旧版永不 skip，
  //    10 趟 ensure = 10 次 ring 车道查询 + 20 次 querySelector + 60 次 rect；
  //    现在与①同价（10 / 0 / 20）。这就是 2026-10-12 移交的那条优化。
  const noTps = statsFixture(false, true)
  try {
    noTps.task.ensure()
    const base = { ...noTps.counts }
    for (let i = 0; i < 10; i += 1) noTps.task.ensure()
    assert.equal(noTps.counts.ringQueries - base.ringQueries, 0, '未变化的 pass 不得再查环形（旧版 10 趟 10 次）')
    assert.equal(noTps.counts.stackScans - base.stackScans, 0, '旧版 10 趟 10 次全栈 div 查询')
    assert.equal(noTps.counts.queries - base.queries, 10, '旧版 20 次（每趟锚点 + 占位两条）')
    assert.equal(noTps.counts.rect - base.rect, 20, '旧版 60 次（每趟都真折一遍：measure + write + 强制同步布局）')
  } finally { noTps.restore() }
})

// 第三档：TPS 在场 + 环缺席（宿主还没渲染环、或环被 React 卸掉的窗口期）。
// **这条钉的是「该档两版同价、属真折的必要开销、不是空转」** —— 上面注释表格里
// 「TPS 在场 + 环缺席 改前/改后 10 / 10 / 0 / 50」那一行原先只是注释、没有断言，
// 所以日后若有人「顺手也把环缺席做成可跳过」，数字会静默失真而测试不红。
//
// 为什么不 skip：环形那两个槽没有 presence 位（环缺席时 key 里根本不带它的盒子），
// 缺席时宁可不 skip，也不能漏掉「环新出现」的那一趟 —— 本文件上面「an absent ring
// appearing later invalidates the skipped state」钉的就是这条语义。所以这一档每趟
// 仍在真折：10 趟 = 10 次全栈 div 查询 + 10 次 rect（首趟建立折叠态 5 次，之后每趟 4 次）。
//
// 与第一、二档的区别是**故意的**：那两档的 0/0/20 是本次优化省下来的，这一档省不掉。
// 谁要动这三条计数，先读这段：改小就意味着环缺席也走了 skip，环会留在旧坐标上。
test('环缺席档（TPS 在场）两版同价：真折的必要开销，不是空转', () => {
  const tpsOnly = statsFixture(true, false)
  try {
    tpsOnly.task.ensure()
    const base = { ...tpsOnly.counts }
    for (let i = 0; i < 10; i += 1) tpsOnly.task.ensure()
    assert.equal(tpsOnly.counts.queries - base.queries, 10, '环缺席档不适用快路径：每趟仍要一次 querySelector（认锚点）')
    assert.equal(tpsOnly.counts.stackScans - base.stackScans, 10, '环缺席档每趟仍真折 TPS ⇒ 那条全栈 div 查询仍在（与改前同价）')
    assert.equal(tpsOnly.counts.ringQueries - base.ringQueries, 0, '环缺席时环形车道本来就不查（两版一致）')
    assert.equal(tpsOnly.counts.rect - base.rect, 50, '环缺席档每趟真折的几何开销：首趟 5 + 之后 10 趟 × 4（与改前同价）')
  } finally { tpsOnly.restore() }
})

test('a rebuilt ring with the old node still connected is measured again', () => {
  const fixture = statsFixture()
  try {
    fixture.task.ensure()
    const before = fixture.counts.ringQueries
    fixture.replaceRing()
    fixture.task.ensure()
    assert.equal(fixture.counts.ringQueries, before + 1)
  } finally { fixture.restore() }
})

test('an absent ring appearing later invalidates the skipped state', () => {
  const fixture = statsFixture(false, false)
  try {
    fixture.task.ensure()
    fixture.task.ensure()
    assert.equal(fixture.counts.ringQueries, 0)
    fixture.replaceRing()
    fixture.task.ensure()
    assert.equal(fixture.counts.ringQueries, 1)
  } finally { fixture.restore() }
})

test('TPS appearing after an absent state forces a new fold', () => {
  const fixture = statsFixture()
  try {
    fixture.task.ensure()
    const before = fixture.counts.ringQueries
    fixture.changeTps(true)
    fixture.task.ensure()
    assert.equal(fixture.counts.ringQueries, before + 1)
  } finally { fixture.restore() }
})

test('DSHA shortcut guard only suppresses first automatic focus and releases on disposal', async () => {
  const source = readFileSync(new URL('../src/client/effects/shortcut-modal-keyboard-guard.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  let predicate, dispose, released = false, dialogFocus = 0
  const module = { exports: {} }
  const context = {
    exports: module.exports, module, document: { querySelectorAll: () => [], activeElement: null },
    require: id => id.includes('platform/breakpoints')
      ? { installMobileEffect: (_ctx, _label, install) => { dispose = install() } }
      : { shadowFocus: handler => { predicate = handler; return () => { released = true } } },
  }
  vm.runInNewContext(compiled, context)
  module.exports.installShortcutModalKeyboardGuard({})
  const dialog = { contains: () => false, focus: () => { dialogFocus++ } }
  const automatic = { matches: () => true, hasAttribute: () => true, closest: () => dialog }
  assert.equal(predicate(automatic), true)
  assert.equal(predicate(automatic), true)
  assert.equal(dialogFocus, 1)
  await Promise.resolve()
  assert.equal(predicate(automatic), false)
  assert.equal(predicate({ matches: () => true, hasAttribute: () => false }), false)
  dispose()
  assert.equal(released, true)
})

function scrollFixture() {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['SWAP_RESTORE_MS', 'scrollWindow', 'scrollState'])
  const functions = new Set(['conversationScrollers', 'rememberConversationScroll', 'restoreConversationScroll'])
  const text = tree.statements.filter(node =>
    ts.isFunctionDeclaration(node) && functions.has(node.name?.text) ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.has(d.name.getText(tree)))
  ).map(node => node.getText(tree)).join('\n')
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const element = { scrollTop: 123, isConnected: true }
  const window = {}
  const location = { href: 'http://localhost/session-a' }
  const frames = []
  const load = () => new Function('window', 'document', 'location', 'requestAnimationFrame',
    compiled + '; return { rememberConversationScroll, restoreConversationScroll }'
  )(window, { querySelectorAll: () => [element], querySelector: () => element }, location, fn => frames.push(fn))
  return { element, location, load, flush: () => frames.splice(0).forEach(fn => fn()) }
}

test('scroll positions survive a fresh module generation without overriding host scroll', () => {
  const fixture = scrollFixture()
  fixture.load().rememberConversationScroll()
  fixture.element.scrollTop = 0
  fixture.load().restoreConversationScroll()
  fixture.flush()
  assert.equal(fixture.element.scrollTop, 123)
  fixture.load().rememberConversationScroll()
  fixture.element.scrollTop = 50
  fixture.load().restoreConversationScroll()
  fixture.flush()
  assert.equal(fixture.element.scrollTop, 50)
})

test('a session change after scheduling prevents restoration of another session position', () => {
  const fixture = scrollFixture()
  fixture.load().rememberConversationScroll()
  fixture.element.scrollTop = 0
  fixture.load().restoreConversationScroll()
  fixture.location.href = 'http://localhost/session-b'
  fixture.flush()
  assert.equal(fixture.element.scrollTop, 0)
})

// 2026-10-11 真机复现的回归：宿主在「正在输出 + 已输入内容」时把发送键换成
// 「Stop generating + Steer message」，composer 车道重排、我们的占位槽左移 45px，
// 但统计条锚点（dock）没动 —— 旧的跳过判据只看锚点盒子，于是整趟跳过、环留在旧坐标，
// 正好压在停止键上（报障原话「发送键旁边两个蓝色控件叠在一起」）。
// 这条测试钉住：占位槽位移必须让下一趟重新折叠。
test('moving the ring reserve re-folds the ring instead of keeping a stale offset', () => {
  const fixture = statsFixture()
  try {
    fixture.task.ensure()
    const before = fixture.counts.ringQueries
    fixture.moveReserve(45)
    fixture.task.ensure()
    assert.equal(fixture.counts.ringQueries, before + 1,
      '占位槽位移后必须重新测量环，否则环会停在旧坐标上压住邻居控件')
  } finally { fixture.restore() }
})
