// 行为层：渐进 resize（原生输入法逐帧缩 WebView）下，视口变量的写入必须是「每帧最多一次」，
// 且值没变不写。2026-10-20 由 `syncStableViewportHeight` 的 rAF 合并引入。
//
// 与 stable-viewport-keyboard.test.ts 的分工：那边钉源码形状（常量/单调规则/调度接线），
// 这边用最小 DOM 桩把函数真跑起来，钉「一次动画十几次 resize → 一帧一次写」的语义。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncStableViewportHeight } from '../src/client/effects/viewport-meta.ts'

type Write = [name: string, value: string]

function makeHarness() {
  const writes: Write[] = []
  const props = new Map<string, string>()
  const style = {
    setProperty(name: string, value: string): void {
      props.set(name, value)
      writes.push([name, value])
    },
    getPropertyValue(name: string): string {
      return props.get(name) ?? ''
    },
    removeProperty(name: string): void {
      props.delete(name)
    },
  }
  const rafQueue: FrameRequestCallback[] = []
  const windowListeners = new Map<string, Set<() => void>>()
  const viewportListeners = new Map<string, Set<() => void>>()
  const state = { height: 754, width: 360, vvHeight: 754, offsetTop: 0 }

  const add = (map: Map<string, Set<() => void>>, type: string, fn: () => void): void => {
    const set = map.get(type) ?? new Set()
    set.add(fn)
    map.set(type, set)
  }
  const remove = (map: Map<string, Set<() => void>>, type: string, fn: () => void): void => {
    map.get(type)?.delete(fn)
  }

  const viewport = {
    get height(): number { return state.vvHeight },
    get offsetTop(): number { return state.offsetTop },
    addEventListener: (type: string, fn: () => void): void => add(viewportListeners, type, fn),
    removeEventListener: (type: string, fn: () => void): void => remove(viewportListeners, type, fn),
  }
  const win = {
    get innerHeight(): number { return state.height },
    get innerWidth(): number { return state.width },
    visualViewport: viewport,
    addEventListener: (type: string, fn: () => void): void => add(windowListeners, type, fn),
    removeEventListener: (type: string, fn: () => void): void => remove(windowListeners, type, fn),
  }

  const globals = globalThis as unknown as Record<string, unknown>
  const previous = {
    window: globals.window,
    document: globals.document,
    raf: globals.requestAnimationFrame,
    caf: globals.cancelAnimationFrame,
  }
  globals.window = win
  globals.document = { documentElement: { style } }
  globals.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    rafQueue.push(callback)
    return rafQueue.length
  }
  globals.cancelAnimationFrame = (id: number): void => {
    // 与浏览器一致：取消后这一帧的回调不得再执行。
    rafQueue[id - 1] = () => {}
  }

  return {
    state,
    writes,
    props,
    /** 跑掉这一帧排队的 rAF 回调。 */
    frame(): void {
      for (const callback of rafQueue.splice(0)) callback(0)
    },
    /** 只发事件，不跑帧。 */
    resize(): void {
      for (const fn of windowListeners.get('resize') ?? []) fn()
      for (const fn of viewportListeners.get('resize') ?? []) fn()
    },
    listenerCount(): number {
      let count = 0
      for (const set of windowListeners.values()) count += set.size
      for (const set of viewportListeners.values()) count += set.size
      return count
    },
    restore(): void {
      globals.window = previous.window
      globals.document = previous.document
      globals.requestAnimationFrame = previous.raf
      globals.cancelAnimationFrame = previous.caf
    },
  }
}

test('渐进 resize：同一帧里的十几次 resize 只写一次', () => {
  const h = makeHarness()
  const dispose = syncStableViewportHeight()
  try {
    // 首次同步是同步写：调用方同一轮就要读 STABLE_VIEWPORT_VAR。
    assert.deepEqual(h.writes, [
      ['--dsha-mobile-visible-vh', '754px'],
      ['--dsha-mobile-viewport-top', '0px'],
      ['--dsh-web-mobile-vh', '754px'],
    ])
    h.writes.length = 0

    // 原生输入法逐帧缩：754 → 471，十几个事件、每帧一个值，但中间不跑帧。
    for (let height = 754; height >= 471; height -= 16) {
      h.state.height = height
      h.state.vvHeight = height
      h.resize()
    }
    assert.equal(h.writes.length, 0, '一帧内的事件不能让写入穿过去')

    h.frame()
    assert.deepEqual(h.writes, [['--dsha-mobile-visible-vh', '482px']],
      '一帧只写一次，且写的是最后一帧的值')
    assert.equal(h.props.get('--dsh-web-mobile-vh'), '754px',
      '键盘只降低高度，稳定视口高度不许跟着变')
    assert.equal(h.props.get('--dsha-mobile-viewport-top'), '0px')

    // 同一帧再发事件、值不变：不得重复写。
    h.writes.length = 0
    h.resize()
    h.frame()
    assert.equal(h.writes.length, 0, '值没变时不许重写')
  } finally {
    dispose()
    h.restore()
  }
})

test('resize 跨帧时每帧各写一次', () => {
  const h = makeHarness()
  const dispose = syncStableViewportHeight()
  try {
    h.writes.length = 0
    h.state.height = 700
    h.state.vvHeight = 700
    h.resize()
    h.frame()
    assert.deepEqual(h.writes, [['--dsha-mobile-visible-vh', '700px']])

    h.writes.length = 0
    h.state.height = 640
    h.state.vvHeight = 640
    h.resize()
    h.frame()
    assert.deepEqual(h.writes, [['--dsha-mobile-visible-vh', '640px']])
  } finally {
    dispose()
    h.restore()
  }
})

test('dispose 取消待写帧并摘掉监听', () => {
  const h = makeHarness()
  const dispose = syncStableViewportHeight()
  assert.ok(h.listenerCount() > 0)
  h.state.height = 500
  h.state.vvHeight = 500
  h.resize()
  dispose()
  h.frame()
  assert.equal(h.props.has('--dsha-mobile-visible-vh'), false)
  assert.equal(h.props.has('--dsh-web-mobile-vh'), false)
  assert.equal(h.listenerCount(), 0)
  h.restore()
})
