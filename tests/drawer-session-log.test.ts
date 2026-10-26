// 抽屉品牌行导出图标（issue #225，2026-10-18）：页脚胶囊退役，入口改到抽屉
// 品牌行右端的一颗图标。这里钉四件事：
//  1. slot 注册确实消失（不会有人再把整行胶囊挂回去），图标是 reconciler task；
//  2. task 真的把按钮挂进 logo 行、带 marker/aria-label、无会话时置灰、点击用
//     宿主 sessionLogDownload 服务导出当前会话；
//  3. 宿主 React 重建 logo 行后 ensure 能把图标重挂回去，dispose 会退订并移除；
//  4. 图标按钮不能是 logo 行的直接 button —— 第三方 dsh-web-all 把行内「最后一个直接
//     button」标记成 sidebar-toggle 并点它关抽屉（2026-10-18 实测：直接挂图标会被顶替，
//     计算样式 display:none，外部点击会误触导出）。实现是套一层 span 包装。
//
// 源码断言 + 一个最小 DOM 桩（Node 没有 document）：桩只实现 task 用到的
// appendChild / insertBefore / remove / parentElement / dataset / setAttribute / addEventListener。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDrawerSessionLogTask } from '../src/client/effects/drawer-session-log.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'src/client/effects/drawer-session-log.ts'), 'utf8')
const INDEX = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

test('the footer slot registration is gone and the icon is a scoped reconciler task', () => {
  assert.doesNotMatch(INDEX, /sidebar\.footer\.action/)
  assert.doesNotMatch(INDEX, /MobileDrawerFooter/)
  assert.match(SOURCE, /name: 'drawer-session-log'/)
  assert.match(SOURCE, /scopes: \['\*'\]/)
  // The row lookup stays inside the drawer's sidebar column (no bare logoRow).
  assert.match(SOURCE, /\[class\*="sidebarCol"\] \[class\*="logoRow"\]/)
})

test('the trigger carries the marker, the menu wiring and the host download call', () => {
  // 2026-10-25：品牌行图标从「直接导出」改成两项菜单（导出会话日志 / 下载记录），
  // 触发器仍是 session-log 标记，但 aria-label 走 downloadMenu，导出挪进菜单行。
  assert.match(SOURCE, /dataset\.mobileNav = 'session-log'/)
  assert.match(SOURCE, /button\.setAttribute\('aria-label', t\('downloadMenu'\)\)/)
  assert.match(SOURCE, /button\.setAttribute\('aria-haspopup', 'menu'\)/)
  assert.match(SOURCE, /panel\.dataset\.mobileNav = 'session-log-menu'/)
  assert.match(SOURCE, /makeItem\(t\('sessionLog'\), 'session-log-export'/)
  assert.match(SOURCE, /makeItem\(t\('downloads'\), 'session-log-downloads'/)
  assert.match(SOURCE, /currentSessionIdOf\(ctx\.sessions\.list\.getSnapshot\(\)\)/)
  assert.match(SOURCE, /ctx\.sessionLogDownload\.download\(/)
  // The wrapper is the dsh-web-all stamping guard (see the behavioral test).
  assert.match(SOURCE, /dataset\.mobileNav = 'session-log-wrap'/)
})

/** Minimal element stub: only what the task touches. */
class FakeElement {
  tagName: string
  dataset: Record<string, string> = {}
  attrs: Record<string, string> = {}
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  className = ''
  disabled = false
  title = ''
  innerHTML = ''
  isConnected = false
  style: Record<string, string> = {}

  focus(): void {}

  getBoundingClientRect(): { bottom: number; right: number } {
    return { bottom: 0, right: 0 }
  }

  contains(node: unknown): boolean {
    let current = node as FakeElement | null
    while (current !== null) {
      if (current === this) return true
      current = current.parentElement
    }
    return false
  }
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

  insertBefore(node: FakeElement, reference: FakeElement): FakeElement {
    if (node.parentElement !== null) node.parentElement.removeChild(node)
    const index = this.children.indexOf(reference)
    if (index === -1) return this.appendChild(node)
    node.parentElement = this
    this.children.splice(index, 0, node)
    return node
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

/** Install a fake document with one frame whose sidebar column contains `row`. */
function installDocument(row: FakeElement): { restore: () => void; body: FakeElement } {
  const frame = new FakeFrame(row)
  const body = new FakeElement('body')
  const documentListeners = new Map<string, Array<(event: unknown) => void>>()
  const previous = (globalThis as { document?: unknown }).document
  const previousWindow = (globalThis as { window?: unknown }).window
  const previousObserver = (globalThis as { MutationObserver?: unknown }).MutationObserver
  ;(globalThis as { document?: unknown }).document = {
    body,
    querySelector: (selector: string) => (selector === '[data-mobile-nav="frame"]' ? frame : null),
    createElement: (tagName: string) => new FakeElement(tagName),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const list = documentListeners.get(type) ?? []
      list.push(fn)
      documentListeners.set(type, list)
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      const list = documentListeners.get(type) ?? []
      documentListeners.set(type, list.filter((entry) => entry !== fn))
    },
  }
  ;(globalThis as { window?: unknown }).window = {
    innerWidth: 360,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn: () => void) => { fn(); return 1 },
  }
  ;(globalThis as { MutationObserver?: unknown }).MutationObserver = class {
    observe(): void {}
    disconnect(): void {}
  }
  return {
    body,
    restore: () => {
      ;(globalThis as { document?: unknown }).document = previous
      ;(globalThis as { window?: unknown }).window = previousWindow
      ;(globalThis as { MutationObserver?: unknown }).MutationObserver = previousObserver
    },
  }
}

/** Task context stub: sessions snapshot + a working subscription + download spy. */
function makeContext() {
  const state: { id?: string } = {}
  const listeners = new Set<() => void>()
  const downloads: string[] = []
  const ctx = {
    locale: { bind: () => (key: string) => key },
    sessions: {
      list: {
        getSnapshot: () => (state.id === undefined ? {} : { current: state.id }),
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
      },
    },
    sessionLogDownload: {
      download: (id: string) => { downloads.push(id) },
    },
  }
  return {
    ctx: ctx as unknown as Parameters<typeof createDrawerSessionLogTask>[0],
    state,
    listeners,
    downloads,
    notify: () => { for (const fn of listeners) fn() },
  }
}

/** Model one host logo row: brand button + host toggle button (both direct children). */
function makeLogoRow(): { row: FakeElement; brand: FakeElement; hostToggle: FakeElement } {
  const row = new FakeElement('div')
  const brand = new FakeElement('button')
  brand.className = 'hHd-Xa_brand'
  const hostToggle = new FakeElement('button')
  hostToggle.className = 'hHd-Xa_iconButton hHd-Xa_toggle'
  row.appendChild(brand)
  row.appendChild(hostToggle)
  return { row, brand, hostToggle }
}

test('ensure mounts the trigger in the brand row, opens the menu and re-mounts after a row swap', () => {
  const { row, brand, hostToggle } = makeLogoRow()
  const { restore, body } = installDocument(row)
  const { ctx, state, listeners, downloads, notify } = makeContext()
  try {
    const task = createDrawerSessionLogTask(ctx)
    task.ensure()

    const wrapper = row.children.find((child) => child.dataset.mobileNav === 'session-log-wrap')
    assert.ok(wrapper !== undefined, 'ensure must mount the wrapper into the logo row')
    const button = wrapper.children[0]
    assert.ok(button !== undefined, 'the wrapper must carry the trigger button')
    assert.equal(button.dataset.mobileNav, 'session-log')
    assert.equal(button.parentElement, wrapper)
    assert.equal(wrapper.parentElement, row)
    // The third-party stamping contract: our button is NOT a direct child
    // button — dsh-web-all adopts the row's last direct button as the sidebar
    // toggle and clicks it to close the drawer.
    const directButtons = row.children.filter((child) => child.tagName === 'button')
    assert.deepEqual(directButtons, [brand, hostToggle])
    assert.equal(directButtons[directButtons.length - 1], hostToggle)
    assert.equal(button.getAttribute('aria-label'), 'downloadMenu')
    assert.equal(button.title, 'downloadMenu')
    assert.equal(button.getAttribute('aria-haspopup'), 'menu')
    assert.equal(button.getAttribute('aria-expanded'), 'false')

    // No current session: the menu still opens (it is the entry point), but the
    // export row is disabled and cannot reach the host service.
    button.fire('click')
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    const panel = body.children.find((child) => child.dataset.mobileNav === 'session-log-menu')
    assert.ok(panel !== undefined, 'the trigger must portal the menu into the body')
    const exportItem = panel.children.find((child) => child.dataset.mobileNav === 'session-log-export')
    assert.ok(exportItem !== undefined, 'the menu must carry the export row')
    assert.equal(exportItem.disabled, true)
    exportItem.fire('click')
    assert.deepEqual(downloads, [])
    assert.equal(body.children.includes(panel), false, 'the menu closes after the export row runs')

    // Becoming the current session re-enables the export row.
    state.id = 'session-1'
    notify()
    button.fire('click')
    const enabledPanel = body.children.find((child) => child.dataset.mobileNav === 'session-log-menu')
    assert.ok(enabledPanel !== undefined)
    const enabledExport = enabledPanel.children.find((child) => child.dataset.mobileNav === 'session-log-export')
    assert.ok(enabledExport !== undefined)
    assert.equal(enabledExport.disabled, false)
    enabledExport.fire('click')
    assert.deepEqual(downloads, ['session-1'])

    // Host React rebuilds the logo row: ensure re-mounts into the new node.
    const swapped = makeLogoRow()
    const installed = installDocument(swapped.row)
    try {
      task.ensure()
      assert.equal(row.children.includes(wrapper), false, 'the old row must lose the wrapper')
      assert.ok(swapped.row.children.includes(wrapper), 'ensure must re-mount after a React row swap')
      const swappedButtons = swapped.row.children.filter((child) => child.tagName === 'button')
      assert.equal(swappedButtons[swappedButtons.length - 1], swapped.hostToggle)
      // The trigger keeps its enabled menu after the swap.
      button.fire('click')
      const swappedPanel = installed.body.children.find(
        (child) => child.dataset.mobileNav === 'session-log-menu',
      )
      assert.ok(swappedPanel !== undefined)
    } finally {
      installed.restore()
    }

    // Disposal removes the node, drops the menu and the subscription.
    task.dispose()
    assert.equal(swapped.row.children.includes(wrapper), false)
    assert.equal(listeners.size, 0)
  } finally {
    restore()
  }
})
