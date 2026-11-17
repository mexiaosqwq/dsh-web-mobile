// 抽屉品牌行手势开关（issue #297，2026-11-15）。这里钉四件事：
//  1. 偏好读取 fail-open：缺失/损坏/存储不可用一律=开，绝不让「读不到」变成「手势没了」；
//  2. 开关确实被手势层消费：`beginStroke` 首行就是这道路由，且排在其它让位判定之前
//     （关掉后点击 FAB / 顶栏 toggle 仍开抽屉，因为它们不走 beginStroke）；
//  3. 注入形态与同族一致（drawer-session-log / drawer-quick-settings）：task 注入品牌行、
//     按钮套 span 包装（第三方 dsh-web-all 会把行内最后一个直接 button 当 sidebar toggle）、
//     dispose 移除；
//  4. 新增的 `data-mobile-nav` 两个标记进了 misc.css.ts 的桌面隐藏块清单
//     （pitfalls「断点与设备」的维护约定：清单是 dispose 竞态的最后一道防线）。
//
// 源码断言 + 一个最小 DOM 桩（Node 没有 document / localStorage）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gesturesEnabled, setGesturesEnabled, createGestureToggleTask } from '../src/client/effects/gesture-toggle.ts'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'
import { en, zh } from '../src/client/i18n/locales.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'src/client/effects/gesture-toggle.ts'), 'utf8')
const SWIPE = readFileSync(join(ROOT, 'src/client/effects/sidebar-swipe.ts'), 'utf8')
const ADAPTER = readFileSync(join(ROOT, 'src/client/effects/reconciler-adapter.ts'), 'utf8')

/** Source with comments blanked: the module header names `beginStroke` and the
 * storage key in prose, so only executable text may satisfy an assertion. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Run `fn` with a localStorage stub (or one that throws on every access). */
function withStorage<T>(store: Map<string, string> | 'throw', fn: () => T): T {
  const previous = (globalThis as { localStorage?: unknown }).localStorage
  ;(globalThis as { localStorage?: unknown }).localStorage = store === 'throw'
    ? {
        getItem: () => { throw new Error('blocked') },
        setItem: () => { throw new Error('blocked') },
        removeItem: () => { throw new Error('blocked') },
      }
    : {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      }
  try {
    return fn()
  } finally {
    ;(globalThis as { localStorage?: unknown }).localStorage = previous
  }
}

test('the preference fails open: absent, corrupt or blocked storage all mean ON', () => {
  // 缺失 = 从没按过开关 = 默认开。这一条是「升级后手势不该消失」的锚。
  assert.equal(withStorage(new Map(), () => gesturesEnabled()), true, 'absent value must mean gestures ON')
  // 任何非 'off' 的值（旧版写坏、别的键串味）也一律当开：只有明确的 off 才关。
  for (const value of ['on', 'OFF', '', '0', 'false']) {
    assert.equal(
      withStorage(new Map([['dsh-web-mobile:gestures', value]]), () => gesturesEnabled()),
      true,
      `only the exact 'off' disables gestures, got ${JSON.stringify(value)}`,
    )
  }
  assert.equal(
    withStorage(new Map([['dsh-web-mobile:gestures', 'off']]), () => gesturesEnabled()),
    false,
    'the stored off value must disable gestures',
  )
  // 存储不可用（隐私模式 / 沙箱）不能反过来关掉手势。
  assert.equal(withStorage('throw', () => gesturesEnabled()), true, 'a blocked store must fail open')
})

test('writing the preference is symmetric and survives a blocked store without throwing', () => {
  const store = new Map<string, string>()
  withStorage(store, () => setGesturesEnabled(false))
  assert.equal(store.get('dsh-web-mobile:gestures'), 'off', 'off is stored explicitly')
  withStorage(store, () => setGesturesEnabled(true))
  assert.equal(store.has('dsh-web-mobile:gestures'), false, 'on removes the key instead of storing a second spelling')
  // 写不进去时不能抛（点击处理器里抛会中断整条手势链）。
  assert.doesNotThrow(() => withStorage('throw', () => setGesturesEnabled(false)))
})

test('the gesture layer reads the switch first, before every other yield', () => {
  // 消费点在 sidebar-swipe.ts：import + beginStroke 首行。少了任何一半，开关就是个
  // 画在抽屉上的装饰品——按钮换了 aria-pressed，手势照旧会误触。
  assert.match(SWIPE, /import \{ gesturesEnabled \} from '\.\/gesture-toggle\.ts'/)
  const begin = SWIPE.slice(SWIPE.indexOf('function beginStroke('))
  const gate = begin.indexOf('if (!gesturesEnabled()) return false')
  assert.ok(gate > -1, 'beginStroke must gate on the switch')
  for (const later of ['onCooldown()', 'modalOpen()', 'selectionOwnsStroke()']) {
    assert.ok(gate < begin.indexOf(later), `the switch gate must run before ${later}`)
  }
})

test('the task registers through the shared reconciler surface', () => {
  assert.match(CODE, /name: 'gesture-toggle'/)
  assert.match(CODE, /scopes: \['\*'\]/)
  assert.match(ADAPTER, /createGestureToggleTask\(t\)/)
  // 品牌行查找留在这个 task 里（与 session-log 同锚点）。
  assert.match(CODE, /\[class\*="sidebarCol"\] \[class\*="logoRow"\]/)
})

test('both markers are in the desktop hide list and both dictionaries carry the label', () => {
  for (const marker of ['gesture-toggle', 'gesture-toggle-wrap']) {
    assert.match(
      MISC_CSS,
      new RegExp('\\[data-mobile-nav="' + marker + '"\\]'),
      `${marker} must be hidden on desktop/non-touch windows`,
    )
  }
  assert.equal(zh.gestureToggleOn, '侧滑手势：开')
  assert.equal(zh.gestureToggleOff, '侧滑手势：关')
  assert.equal(en.gestureToggleOn, 'Swipe gestures: on')
  assert.equal(en.gestureToggleOff, 'Swipe gestures: off')
})

/** Minimal element stub: only what the task touches. */
class FakeElement {
  tagName: string
  dataset: Record<string, string> = {}
  attrs: Record<string, string> = {}
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  innerHTML = ''
  title = ''
  type = ''
  private listeners: Record<string, Array<() => void>> = {}

  constructor(tagName: string) {
    this.tagName = tagName
  }

  addEventListener(name: string, fn: () => void): void {
    (this.listeners[name] ??= []).push(fn)
  }

  fire(name: string): void {
    for (const fn of this.listeners[name] ?? []) fn()
  }

  setAttribute(key: string, value: string): void {
    this.attrs[key] = value
  }

  getAttribute(key: string): string | null {
    return this.attrs[key] ?? null
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement?.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    return child
  }

  removeChild(child: FakeElement): void {
    this.children = this.children.filter((entry) => entry !== child)
    if (child.parentElement === this) child.parentElement = null
  }

  remove(): void {
    this.parentElement?.removeChild(this)
  }

  querySelector(): FakeElement | null {
    return null
  }
}

/** The shell frame: the task resolves the logo row through `frame.querySelector`. */
class FakeFrame extends FakeElement {
  readonly row: FakeElement

  constructor(row: FakeElement) {
    super('div')
    this.row = row
    this.attrs['data-mobile-nav'] = 'frame'
  }

  querySelector(selector: string): FakeElement | null {
    return selector.includes('logoRow') ? this.row : null
  }
}

test('ensure mounts one wrapped switch in the brand row, repaints state, dispose removes it', () => {
  const row = new FakeElement('div')
  const brand = new FakeElement('button')
  const hostToggle = new FakeElement('button')
  row.appendChild(brand)
  row.appendChild(hostToggle)
  const frame = new FakeFrame(row)
  const previousDocument = (globalThis as { document?: unknown }).document
  const store = new Map<string, string>()
  ;(globalThis as { document?: unknown }).document = {
    querySelector: (selector: string) => (selector === '[data-mobile-nav="frame"]' ? frame : null),
    createElement: (tagName: string) => new FakeElement(tagName),
  }
  try {
    withStorage(store, () => {
      const task = createGestureToggleTask((key: string) => key)
      task.ensure()

      const wrapper = row.children.find((child) => child.dataset.mobileNav === 'gesture-toggle-wrap')
      assert.ok(wrapper !== undefined, 'ensure must mount the wrapper into the logo row')
      const button = wrapper.children[0]
      assert.ok(button !== undefined, 'the wrapper must carry the switch button')
      assert.equal(button.dataset.mobileNav, 'gesture-toggle')
      assert.equal(button.parentElement, wrapper, 'the button is nested, never a row child')
      // 第三方 stamping 契约：本按钮不能是行内直接 button（会被当成 sidebar toggle）。
      assert.deepEqual(
        row.children.filter((child) => child.tagName === 'button'),
        [brand, hostToggle],
      )
      // 默认开：aria-pressed=true + 文案取「开」那一支。
      assert.equal(button.getAttribute('aria-pressed'), 'true')
      assert.equal(button.title, 'gestureToggleOn')
      assert.equal(button.dataset.state, 'on')
      assert.match(button.innerHTML, /<svg /)

      // ensure 幂等（宿主每次重渲染抽屉都会重建 logo 行）。
      task.ensure()
      task.ensure()
      assert.equal(row.children.filter((child) => child.dataset.mobileNav === 'gesture-toggle-wrap').length, 1)

      // 点一下：写偏好并立刻把状态发布到按钮上（不重载页面）。
      button.fire('click')
      assert.equal(store.get('dsh-web-mobile:gestures'), 'off')
      assert.equal(button.getAttribute('aria-pressed'), 'false')
      assert.equal(button.title, 'gestureToggleOff')
      assert.equal(button.dataset.state, 'off')

      // 再点一下：回到开（键被删掉，而不是写第二个拼写）。
      button.fire('click')
      assert.equal(store.has('dsh-web-mobile:gestures'), false)
      assert.equal(button.getAttribute('aria-pressed'), 'true')

      // 宿主换掉整行：ensure 必须把包装重新挂到新行上。
      const nextRow = new FakeElement('div')
      ;(frame as unknown as { querySelector: (selector: string) => FakeElement | null }).querySelector =
        () => nextRow
      task.ensure()
      assert.equal(nextRow.children.some((child) => child.dataset.mobileNav === 'gesture-toggle-wrap'), true)

      task.dispose()
      assert.equal(nextRow.children.some((child) => child.dataset.mobileNav === 'gesture-toggle-wrap'), false)
    })
  } finally {
    ;(globalThis as { document?: unknown }).document = previousDocument
  }
})

test('ensure leaves the row alone when the drawer is not mounted yet', () => {
  const previousDocument = (globalThis as { document?: unknown }).document
  ;(globalThis as { document?: unknown }).document = {
    querySelector: () => null,
    createElement: (tagName: string) => new FakeElement(tagName),
  }
  try {
    withStorage(new Map(), () => {
      const task = createGestureToggleTask((key: string) => key)
      assert.doesNotThrow(() => task.ensure(), 'a missing frame must be a no-op, not a throw')
      assert.doesNotThrow(() => task.dispose(), 'dispose before any mount must be a no-op')
    })
  } finally {
    ;(globalThis as { document?: unknown }).document = previousDocument
  }
})
