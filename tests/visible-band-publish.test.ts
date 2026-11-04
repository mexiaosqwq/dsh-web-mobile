// 可见带高度 --dsha-mobile-visible-vh 的发布时机（2026-11-04 店主报键盘升降闪一帧，二分到 #258 的两帧确认）。
// DSHA 壳的键盘动画在起止各一步改 WebView 尺寸：静止后的第一次变化必须同一回调里发布，
// 动画中的后续帧不写、停稳再收拢一次（逐帧动画的引擎每次动画最多写两次，不回到逐帧整页重排）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

type Listener = () => void

function harness() {
  const props = new Map<string, string>()
  const writes: string[] = []
  const frames: Listener[] = []
  const listeners: Listener[] = []
  const win = {
    innerHeight: 800,
    innerWidth: 400,
    visualViewport: { height: 800, offsetTop: 0, addEventListener() {}, removeEventListener() {} },
    addEventListener: (_: string, fn: Listener) => { listeners.push(fn) },
    removeEventListener() {},
  }
  const root = {
    style: {
      getPropertyValue: (k: string) => props.get(k) ?? '',
      setProperty: (k: string, v: string) => {
        props.set(k, v)
        if (k === '--dsha-mobile-visible-vh') writes.push(v)
      },
      removeProperty: (k: string) => { props.delete(k) },
    },
  }
  const g = globalThis as Record<string, unknown>
  g.window = win
  g.document = { documentElement: root, dispatchEvent() { return true } }
  g.CustomEvent = class { type: string; constructor(type: string) { this.type = type } }
  g.requestAnimationFrame = (fn: Listener) => { frames.push(fn); return frames.length }
  g.cancelAnimationFrame = () => {}
  const flush = (n: number) => {
    for (let i = 0; i < n; i++) {
      const due = frames.splice(0)
      for (const fn of due) fn()
    }
  }
  const resize = (h: number) => {
    win.innerHeight = h
    win.visualViewport.height = h
    for (const fn of listeners) fn()
  }
  return { writes, flush, resize }
}

test('a step change after rest publishes in the same callback (no lagging frame)', async () => {
  const { syncStableViewportHeight } = await import('../src/client/effects/viewport-meta.ts')
  const h = harness()
  const stop = syncStableViewportHeight()
  h.flush(4)
  assert.deepEqual(h.writes, ['800px'], 'settles on the initial height')
  h.resize(480) // 键盘弹起：壳一步把 WebView 缩到终值
  assert.deepEqual(h.writes, ['800px', '480px'], '同一回调发布，外壳不晚于视口')
  h.flush(4)
  h.resize(800) // 收起，同样一步
  assert.deepEqual(h.writes, ['800px', '480px', '800px'], '第二次动画同样立即发布（确认链没断）')
  stop()
})

test('a progressive animation writes at most twice: first frame and the settled value', async () => {
  const { syncStableViewportHeight } = await import('../src/client/effects/viewport-meta.ts')
  const h = harness()
  const stop = syncStableViewportHeight()
  h.flush(4)
  h.writes.length = 0
  for (let px = 780; px >= 480; px -= 20) {
    h.resize(px) // 逐帧动画（iOS visualViewport）：每帧一个新值
    h.flush(1)
  }
  h.flush(4)
  assert.deepEqual(h.writes, ['780px', '480px'], '只写首帧与停稳值，动画中不逐帧重排')
  stop()
})
