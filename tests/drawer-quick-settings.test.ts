// 抽屉一键设置齿轮（2026-10-20，spec `docs/specs/2026-10-20-drawer-quick-settings.md`）。这里钉五件事：
//  1. 齿轮是 reconciler task 注入 `[class*="sidebarCol"] [class*="triggerRow"]`，带 marker 与文案；
//  2. 点击链顺序 = 账户 launcher → 下一帧 → 菜单第一项（宿主 AccountMenu 第一项即 Settings）；
//  3. 链运行期挂 `data-mobile-nav-quick`（CSS 借此压掉中间帧），落定即摘；
//  4. 链路失败（菜单没开 / 没有可选项）不留屏：回点 launcher 收起；
//  5. 连接条守卫与桌面隐藏清单在样式层里，dispose 会移除节点。
//
// 源码断言 + 一个最小 DOM 桩（Node 没有 document）：桩只实现 task 用到的
// querySelector / querySelectorAll / createElement / documentElement / 监听 / 挂载。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDrawerQuickSettingsTask } from '../src/client/effects/drawer-quick-settings.ts'
import { BASE_CSS } from '../src/client/styles/base.css.ts'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'
import { en, zh } from '../src/client/i18n/locales.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'src/client/effects/drawer-quick-settings.ts'), 'utf8')
const ADAPTER = readFileSync(join(ROOT, 'src/client/effects/reconciler-adapter.ts'), 'utf8')

test('the gear is a scoped reconciler task on the drawer account row', () => {
  assert.match(SOURCE, /name: 'drawer-quick-settings'/)
  assert.match(SOURCE, /scopes: \['\*'\]/)
  // The row lookup stays inside the drawer's sidebar column (no bare triggerRow).
  assert.match(SOURCE, /\[class\*="sidebarCol"\] \[class\*="triggerRow"\]/)
  assert.match(SOURCE, /button\[aria-haspopup="menu"\]/)
  assert.match(ADAPTER, /createDrawerQuickSettingsTask\(ctx\)/)
})

test('the click chain opens the account menu and takes its first item', () => {
  // The host AccountMenu has no readable item id in the DOM, so the chain is
  // "open the launcher, then take the first menuitem" — keep both halves pinned.
  assert.match(SOURCE, /\[role="menu"\]/)
  assert.match(SOURCE, /\[role="menuitem"\]/)
  assert.match(SOURCE, /requestAnimationFrame\(/)
  // The intermediate menu stays unpainted through the html marker.
  assert.match(SOURCE, /setAttribute\('data-mobile-nav-quick', ''\)/)
  assert.match(SOURCE, /removeAttribute\('data-mobile-nav-quick'\)/)
})

test('the styles carry the connection-chip guard and the desktop hide list', () => {
  // Connection chip present -> the gear steps aside (row is only 260px wide).
  assert.match(
    BASE_CSS,
    /\[data-mobile-nav="frame"\] \[class\*="sidebarCol"\] \[class\*="triggerRow"\]:has\(> button\[data-phase\], > \[role="status"\]\) \[data-mobile-nav="quick-settings-wrap"\]/,
  )
  assert.match(BASE_CSS, /\[data-mobile-nav-quick\] \[role="menu"\]/)
  for (const marker of ['quick-settings', 'quick-settings-wrap']) {
    assert.match(MISC_CSS, new RegExp('\\[data-mobile-nav="' + marker + '"\\]'))
  }
})

test('the gear box is 30px and sits 6px off the row edge', () => {
  // 2026-10-21 用户：「UI太小了!」→ 28×28 盒放大到 36×36（图标 16 → 20）；
  // 2026-10-22 用户：「还是太大了」→ 盒 36 → 30、图标 20 → 17（同比例，20 × 30/36）。
  // 「UI应该再向左调整一下」→ 右缘对齐账户 launcher 的内容右缘（column − 4px）。
  assert.match(BASE_CSS, /\[data-mobile-nav="quick-settings"\] \{[^}]*width: 30px/)
  assert.match(BASE_CSS, /\[data-mobile-nav="quick-settings"\] \{[^}]*height: 30px/)
  assert.match(BASE_CSS, /\[data-mobile-nav="quick-settings-wrap"\] \{[^}]*margin-right: 6px/)
  assert.match(SOURCE, /<svg width="17" height="17" viewBox="0 0 16 16"/)
})

test('the account menu folds its first row (Settings) away only while the gear is on screen', () => {
  // 2026-10-21 用户：「把原来的打开方式进行删除，只保留这个」。宿主菜单没有可读 id，
  // 认法只能是「账户 launcher 展开时文档里最后一个 [role=menu]」，收起由 CSS 做。
  assert.match(
    BASE_CSS,
    /\[data-mobile-nav-quick-menu\] > \[role="presentation"\] > :first-child > \[role="menuitem"\]/,
  )
  assert.match(SOURCE, /MENU_ENTRY_ATTR = 'data-mobile-nav-quick-menu'/)
})

test('both dictionaries carry the label', () => {
  assert.equal(zh.quickSettings, '设置')
  assert.equal(en.quickSettings, 'Settings')
})

/** Minimal element stub: only what the task touches. */
class FakeElement {
  tagName: string
  dataset: Record<string, string> = {}
  attrs: Record<string, string> = {}
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  className = ''
  innerHTML = ''
  title = ''
  type = ''
  isConnected = false
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

  removeAttribute(key: string): void {
    delete this.attrs[key]
  }

  hasAttribute(key: string): boolean {
    return key in this.attrs
  }

  appendChild(child: FakeElement): FakeElement {
    if (child.parentElement !== null) child.parentElement.removeChild(child)
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

/** The shell frame: the task resolves the row through `frame.querySelector`. */
class FakeFrame extends FakeElement {
  readonly row: FakeElement

  constructor(row: FakeElement) {
    super('div')
    this.row = row
    this.attrs['data-mobile-nav'] = 'frame'
  }

  querySelector(selector: string): FakeElement | null {
    return selector.includes('triggerRow') ? this.row : null
  }
}

/** The drawer account row: host launcher only; the task appends its wrapper. */
class FakeRow extends FakeElement {
  readonly trigger: FakeElement

  constructor(trigger: FakeElement) {
    super('div')
    this.trigger = trigger
  }

  querySelector(selector: string): FakeElement | null {
    return selector.includes('aria-haspopup') ? this.trigger : null
  }
}

/** One menuitem the fake menu exposes (index 0 = Settings, host order). */
class FakeItem extends FakeElement {
  clicks = 0

  constructor() {
    super('button')
    this.attrs.role = 'menuitem'
  }

  click(): void {
    this.clicks += 1
  }
}

/** One portaled menu holding a single item. */
class FakeMenu extends FakeElement {
  readonly item: FakeItem | null

  constructor(item: FakeItem | null) {
    super('div')
    this.item = item
  }

  querySelector(selector: string): FakeElement | null {
    return selector.includes('menuitem') ? this.item : null
  }
}

type Harness = {
  row: FakeRow
  trigger: FakeElement
  html: FakeElement
  menus: FakeMenu[]
  restore: () => void
  flushFrame: () => void
  runTimer: () => void
  frames: Array<() => void>
  timers: Array<() => void>
}

/** Install a fake document whose frame holds `row`; timers and rAF are manual. */
function installHarness(menu: FakeMenu | null): Harness {
  const trigger = new FakeElement('button')
  trigger.attrs['aria-haspopup'] = 'menu'
  trigger.attrs['aria-expanded'] = 'false'
  trigger.click = () => {
    const open = trigger.attrs['aria-expanded'] !== 'true'
    trigger.attrs['aria-expanded'] = open ? 'true' : 'false'
    if (menu !== null) {
      if (open) harness.menus.push(menu)
      else harness.menus = harness.menus.filter((entry) => entry !== menu)
    }
  }
  const row = new FakeRow(trigger)
  const frame = new FakeFrame(row)
  const html = new FakeElement('html')
  const previousDocument = (globalThis as { document?: unknown }).document
  const previousWindow = (globalThis as { window?: unknown }).window
  const previousRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
  const harness: Harness = {
    row,
    trigger,
    html,
    menus: [],
    frames: [],
    timers: [],
    flushFrame: () => {
      const pending = harness.frames.splice(0)
      for (const fn of pending) fn()
    },
    runTimer: () => {
      const pending = harness.timers.splice(0)
      for (const fn of pending) fn()
    },
    restore: () => {
      ;(globalThis as { document?: unknown }).document = previousDocument
      ;(globalThis as { window?: unknown }).window = previousWindow
      ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previousRaf
    },
  }
  ;(globalThis as { document?: unknown }).document = {
    documentElement: html,
    querySelector: (selector: string) => (selector === '[data-mobile-nav="frame"]' ? frame : null),
    querySelectorAll: (selector: string) => {
      if (selector === '[role="menu"]') return harness.menus
      if (selector === '[data-mobile-nav-quick-menu]') {
        return harness.menus.filter((menu) => menu.hasAttribute('data-mobile-nav-quick-menu'))
      }
      return []
    },
    createElement: (tagName: string) => new FakeElement(tagName),
  }
  ;(globalThis as { window?: unknown }).window = {
    setTimeout: (fn: () => void) => {
      harness.timers.push(fn)
      return harness.timers.length
    },
    clearTimeout: () => {},
  }
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (fn: () => void) => {
    harness.frames.push(fn)
    return harness.frames.length
  }
  return harness
}

function mount(harness: Harness) {
  const task = createDrawerQuickSettingsTask({
    locale: { bind: () => (key: string) => key },
  } as unknown as Parameters<typeof createDrawerQuickSettingsTask>[0])
  task.ensure()
  const wrapper = harness.row.children.find((child) => child.dataset.mobileNav === 'quick-settings-wrap')
  assert.ok(wrapper !== undefined, 'ensure must mount the wrapper into the account row')
  const button = wrapper.children[0]
  assert.ok(button !== undefined, 'the wrapper must carry the gear button')
  return { task, wrapper, button }
}

test('ensure mounts one gear in the account row, not as a direct row button', () => {
  const harness = installHarness(null)
  try {
    const { task, wrapper, button } = mount(harness)
    assert.equal(button.dataset.mobileNav, 'quick-settings')
    assert.equal(button.parentElement, wrapper)
    assert.equal(wrapper.parentElement, harness.row)
    assert.equal(button.getAttribute('aria-label'), 'quickSettings')
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(button.title, 'quickSettings')
    assert.match(button.innerHTML, /<svg /)
    // The host launcher stays the row's only direct button.
    const directButtons = harness.row.children.filter((child) => child.tagName === 'button')
    assert.deepEqual(directButtons, [])
    // ensure() is idempotent (the host re-renders the row on every sidebar frame).
    task.ensure()
    task.ensure()
    assert.equal(harness.row.children.filter((child) => child.dataset.mobileNav === 'quick-settings-wrap').length, 1)
    assert.equal(harness.row.children.filter((child) => child.tagName === 'span').length, 1)
  } finally {
    harness.restore()
  }
})

test('a tap opens the account menu, takes its first item and clears the paint guard', () => {
  const item = new FakeItem()
  const harness = installHarness(new FakeMenu(item))
  try {
    const { button } = mount(harness)
    button.fire('click')
    assert.equal(harness.trigger.getAttribute('aria-expanded'), 'true', 'the chain opens the launcher')
    assert.equal(harness.html.getAttribute('data-mobile-nav-quick'), '', 'the guard is on before the menu paints')
    assert.equal(item.clicks, 0, 'the item is only taken on the next frame')
    harness.flushFrame()
    assert.equal(item.clicks, 1, 'the first menuitem (Settings) is clicked')
    harness.trigger.attrs['aria-expanded'] = 'false' // the host menu closes on select
    harness.runTimer()
    assert.equal(harness.html.getAttribute('data-mobile-nav-quick'), null, 'the guard is removed once settled')
    assert.equal(harness.trigger.getAttribute('aria-expanded'), 'false', 'a clean chain does not touch the menu again')
  } finally {
    harness.restore()
  }
})

test('a chain that cannot find the item leaves no menu behind', () => {
  const harness = installHarness(null)
  try {
    const { button } = mount(harness)
    button.fire('click')
    assert.equal(harness.trigger.getAttribute('aria-expanded'), 'true')
    // No menu mounted by the fake host: the rAF half must close what it opened.
    harness.trigger.click = () => {
      harness.trigger.attrs['aria-expanded'] = 'false'
    }
    harness.flushFrame()
    assert.equal(harness.trigger.getAttribute('aria-expanded'), 'false', 'the empty menu is closed again')
    assert.equal(harness.html.getAttribute('data-mobile-nav-quick'), null)
  } finally {
    harness.restore()
  }
})

test('the open account menu is marked so CSS can fold its Settings row away', () => {
  const item = new FakeItem()
  const menu = new FakeMenu(item)
  const harness = installHarness(menu)
  try {
    const { task } = mount(harness)
    // Menu closed: nothing is marked.
    harness.menus.push(menu)
    task.ensure()
    assert.equal(menu.hasAttribute('data-mobile-nav-quick-menu'), false, 'a closed launcher never marks a menu')
    // The user opens the account menu: the reconciler pass marks that one menu.
    harness.trigger.attrs['aria-expanded'] = 'true'
    task.ensure()
    assert.equal(menu.hasAttribute('data-mobile-nav-quick-menu'), true)
    // Connection chip appears -> the gear steps aside, so Settings must come back.
    const chip = new FakeElement('button')
    chip.attrs['data-phase'] = 'connecting'
    harness.row.appendChild(chip)
    task.ensure()
    assert.equal(menu.hasAttribute('data-mobile-nav-quick-menu'), false, 'the menu row returns while the gear is hidden')
    chip.remove()
    task.ensure()
    assert.equal(menu.hasAttribute('data-mobile-nav-quick-menu'), true, 'and folds again once the gear is back')
    // dispose leaves no marker behind on a still-mounted menu.
    task.dispose()
    assert.equal(menu.hasAttribute('data-mobile-nav-quick-menu'), false)
  } finally {
    harness.restore()
  }
})

test('dispose removes the gear and clears the paint guard', () => {
  const harness = installHarness(null)
  try {
    const { task, wrapper } = mount(harness)
    harness.html.setAttribute('data-mobile-nav-quick', '')
    task.dispose()
    assert.equal(harness.row.children.includes(wrapper), false)
    assert.equal(harness.html.getAttribute('data-mobile-nav-quick'), null)
  } finally {
    harness.restore()
  }
})
