// C09：sheet-rise（explorer / preview 列升起）动画的**所有权**与 reduce 行为。
//
// 症状（审计 C09）：`el.animate(...)` 的返回值被丢弃——reduce 下照播、同列重开叠两条、
// 卸载时留着不取消（`fill: backwards` 的起手态会留在元素上）。CSS 的 `animation: none`
// 管不到 WAAPI 创建的 Animation，只能自己记、自己取消。
//
// 本测试驱动**真实的** `createSheetRiseTask()`，用一个假 DOM 记录 `animate()` 调用与
// `cancel()` 调用，钉住三件事：① 只取消**我们自己**创建的动画；② reduce 下不启动；
// ③ 同列重开 / 节点替换 / dispose 三条路径都要取消。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSheetRiseTask } from '../src/client/effects/aionui-compat.ts'
import { createReconcilerCore } from '../src/client/core/reconciler-core.ts'

const EXPLORER = '[data-aionui-explorer-col]'

type FakeAnim = { cancel(): void; finished: Promise<unknown> }
type FakeEl = { tag: string; visibility: string; isConnected: boolean; parentElement: FakeEl | null; animate(): FakeAnim }

function fixture({ reduce = false, resolvedFinished = false } = {}) {
  const calls: Array<{ el: FakeEl; anim: FakeAnim }> = []
  const cancels: FakeAnim[] = []
  const bySel = new Map<string, FakeEl>()
  const observers: Array<{ cb: (m: unknown[]) => void; target: FakeEl | null; opts: Record<string, unknown> | null; disconnected: boolean }> = []
  const mkEl = (tag: string, visible: boolean, parent: FakeEl | null = null): FakeEl => ({
    tag,
    visibility: visible ? 'visible' : 'hidden',
    isConnected: true,
    parentElement: parent,
    animate(): FakeAnim {
      const anim: FakeAnim = {
        cancel() { cancels.push(anim) },
        finished: resolvedFinished ? Promise.resolve() : new Promise(() => {}),
      }
      calls.push({ el: this as FakeEl, anim })
      return anim
    },
  })
  const g = globalThis as Record<string, unknown>
  g.document = { querySelector: (sel: string) => bySel.get(sel) ?? null }
  g.getComputedStyle = (el: FakeEl) => ({ visibility: el.visibility })
  g.window = { matchMedia: (q: string) => ({ matches: reduce && /prefers-reduced-motion/.test(q) }) }
  g.MutationObserver = class {
    cb: (m: unknown[]) => void
    target: FakeEl | null = null
    opts: Record<string, unknown> | null = null
    disconnected = false
    constructor(cb: (m: unknown[]) => void) {
      this.cb = cb
      observers.push(this as unknown as { cb: (m: unknown[]) => void; target: FakeEl | null; opts: Record<string, unknown> | null; disconnected: boolean })
    }
    observe(t: FakeEl, o: Record<string, unknown>): void { this.target = t; this.opts = o }
    disconnect(): void { this.disconnected = true }
  }
  return { calls, cancels, bySel, mkEl, observers }
}

/** 真实 reconciler 路由：note(keys) → flush()，只有 scopes 与 keys 相交时才跑 ensure。 */
function routed(task: ReturnType<typeof createSheetRiseTask>) {
  const core = createReconcilerCore({ requestFrame: () => () => {} })
  core.register(task)
  core.activate()
  return core
}

test('可见翻转时才启动动画（隐藏→可见一次，可见期间不重复）', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const el = f.mkEl('explorer', false)
  f.bySel.set(EXPLORER, el)

  task.ensure()
  assert.equal(f.calls.length, 0, '隐藏时不得启动')
  el.visibility = 'visible'
  task.ensure()
  assert.equal(f.calls.length, 1, '由隐转显必须启动一次')
  task.ensure()
  assert.equal(f.calls.length, 1, '持续可见不得每帧重播')
})

test('prefers-reduced-motion: reduce 下不启动任何动画', () => {
  const f = fixture({ reduce: true })
  const task = createSheetRiseTask()
  f.bySel.set(EXPLORER, f.mkEl('explorer', false))
  f.bySel.get(EXPLORER)!.visibility = 'visible'
  task.ensure()
  assert.equal(f.calls.length, 0, 'reduce 下必须一次都不 animate')
})

test('同列重开：先取消上一条自有动画，再启动新的', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const el = f.mkEl('explorer', true)
  f.bySel.set(EXPLORER, el)
  task.ensure()
  assert.equal(f.calls.length, 1)
  el.visibility = 'hidden'
  task.ensure()
  el.visibility = 'visible'
  task.ensure()
  assert.equal(f.calls.length, 2, '重开要有一条新动画')
  assert.deepEqual(f.cancels, [f.calls[0]!.anim], '旧的必须先被取消')
})

test('节点被 React 换掉：取消挂在旧节点上的自有动画，且不因此重播', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const oldEl = f.mkEl('explorer', true)
  f.bySel.set(EXPLORER, oldEl)
  task.ensure()
  const first = f.calls[0]!.anim
  const newEl = f.mkEl('explorer', true)   // 仍可见，只是换了节点
  f.bySel.set(EXPLORER, newEl)
  task.ensure()
  assert.deepEqual(f.cancels, [first], '旧节点上的自有动画必须被取消')
  assert.equal(f.calls.length, 1, '刻意不因换节点重播（那是行为变更，不在 C09 范围）')
})

test('dispose 取消自有动画并重置状态（之后可重建）', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  f.bySel.set(EXPLORER, f.mkEl('explorer', true))
  task.ensure()
  const first = f.calls[0]!.anim
  task.dispose()
  assert.deepEqual(f.cancels, [first], 'dispose 必须取消自有动画')
  task.ensure()
  assert.equal(f.calls.length, 2, 'dispose 后状态重置，再次可见应重新启动')
})

test('取消面只包含我们自己创建的动画（宿主创建的永不进表）', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const el = f.mkEl('explorer', true)
  f.bySel.set(EXPLORER, el)
  task.ensure()
  el.visibility = 'hidden'; task.ensure()
  el.visibility = 'visible'; task.ensure()
  task.dispose()
  const ours = new Set(f.calls.map((c) => c.anim))
  assert.ok(f.cancels.length > 0, '本用例应至少取消过一次')
  assert.ok(f.cancels.every((a) => ours.has(a)), '取消面必须严格等于自有动画集合')
})

// ── 以下走**真实 reconciler 路由**（note(keys) → flush()），补上"调度层"这一层 ──
// 第三轮复核指出：原有用例直接调 task.ensure，绕过了"哪些 dirty key 会唤醒它"，
// 因此漏掉了「树变更/节点缺席」两条清理路径。这几条按真实路由写。

test('路由：节点缺席经 style 键唤醒时，必须取消该列自有动画', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const core = routed(task)
  const el = f.mkEl('explorer', true)
  f.bySel.set(EXPLORER, el)
  core.note(['style']); core.flush()
  assert.equal(f.calls.length, 1, '打开时应播放一次')
  // 槽位查询为 null、但记录的节点**仍在文档里**（被挪走/换了挂载点）：这条只有
  // 「缺席分支释放记录」能覆盖 —— 若把它退回 `continue`，本用例必须红。
  f.bySel.delete(EXPLORER)
  core.note(['style']); core.flush()
  assert.deepEqual(f.cancels, [f.calls[0]!.anim], '缺席分支必须释放所有权并取消')
  core.deactivate()
})

test('路由：* 键覆盖「父容器从祖父节点整体移除」这条路（旧版观察器收不到）', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const core = routed(task)
  const grandparent = f.mkEl('root', true)
  const parent = f.mkEl('explorerSlot', true, grandparent)
  const el = f.mkEl('explorer', true, parent)
  f.bySel.set(EXPLORER, el)
  core.note(['style']); core.flush()
  assert.equal(f.calls.length, 1)
  // 父容器整体从祖父节点摘掉 ⇒ childList 的 target 是**祖父**；局部观察器永远收不到。
  f.bySel.delete(EXPLORER)
  el.isConnected = false
  core.note(['*']); core.flush()
  assert.deepEqual(f.cancels, [f.calls[0]!.anim], '* 键必须把这条路径也清掉')
  core.deactivate()
})

test('引用有界：连续换 30 个父节点，不创建任何观察器、也不留旧记录', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const core = routed(task)
  let parent = f.mkEl('slot0', true)
  f.bySel.set(EXPLORER, f.mkEl('explorer', true, parent))
  core.note(['style']); core.flush()
  for (let i = 1; i <= 30; i++) {
    parent = f.mkEl(`slot${i}`, true)               // 换父节点 + 换列
    f.bySel.set(EXPLORER, f.mkEl('explorer', true, parent))
    core.note(['*']); core.flush()
  }
  assert.equal(f.observers.length, 0, '不得创建观察器（引用有界 = 根本没有历史目标表）')
  assert.equal(f.cancels.length, 1, '第一次替换就取消掉唯一那条自有记录；之后不再重播 ⇒ 任意时刻至多一条（实测 0 条）')
  core.deactivate()
})

test('便宜路径：无自有动画、无目标列时，* 唤醒不读样式（有界成本）', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const core = routed(task)
  let gcs = 0
  const realGcs = (globalThis as Record<string, unknown>).getComputedStyle as (el: FakeEl) => { visibility: string }
  ;(globalThis as Record<string, unknown>).getComputedStyle = (el: FakeEl) => { gcs += 1; return realGcs(el) }
  core.note(['*']); core.flush()
  core.note(['*']); core.flush()
  assert.equal(gcs, 0, '空转时不得做样式测量')
  assert.equal(f.calls.length, 0)
  core.deactivate()
})

test('路由：清理路径只取消自有动画，宿主动画绝不被碰', () => {
  const f = fixture()
  const task = createSheetRiseTask()
  const core = routed(task)
  const hostCancel = () => { throw new Error('绝不该取消宿主动画') }
  void hostCancel                                     // 宿主动画从未进我们的表 ⇒ 无取消路径
  f.bySel.set(EXPLORER, f.mkEl('explorer', true))
  core.note(['style']); core.flush()
  const ours = f.calls[0]!.anim
  f.bySel.set(EXPLORER, f.mkEl('explorer', true))
  core.note(['*']); core.flush()
  assert.deepEqual(f.cancels, [ours], '取消面严格等于自有动画集合')
  core.deactivate()
})
