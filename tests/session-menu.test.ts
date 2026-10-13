// Session-menu dual-generation contract: the host's per-row menu changed
// shape in 0.1.5 (label lives directly in the menuitem button, no
// `_itemLabel`/`_itemIcon` spans). Recognition and the injected delete item
// must keep working on both shapes — a _itemLabel-only read silently
// disables the whole feature on 0.1.5 (menu no longer recognized).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { currentSessionIdOf, sessionsCanClear, verifySessionDeleted } from '../src/client/core/sessions-compat.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'src/client/effects/session-menu.ts'), 'utf8')

test('menu recognition reads labels via the label-or-item fallback, not _itemLabel alone', () => {
  // The fallback helper exists and is documented for both generations.
  assert.match(SOURCE, /const itemLabel = \(item: HTMLElement\): string =>/)
  assert.match(SOURCE, /puts it directly in the button/)
  // isSessionMenu maps over the menuitem list through the helper — the
  // rc.2-only selector `[role="menuitem"] [class*="_itemLabel"]` must be gone
  // from the recognition path.
  assert.doesNotMatch(SOURCE, /querySelectorAll<HTMLElement>\('\[role="menuitem"\] \[class\*="_itemLabel"\]'\)/)
  assert.match(SOURCE, /querySelectorAll<HTMLElement>\('\[role="menuitem"\]'\)/)
  assert.match(SOURCE, /\.map\(itemLabel\)/)
})

test('injected delete item covers both menu shapes', () => {
  // rc.2: the `_itemLabel` span gets the text + danger color.
  assert.match(SOURCE, /label\.textContent = navT\('deleteSession'\)/)
  assert.match(SOURCE, /label\.style\.color = DANGER_COLOR/)
  // 0.1.5: a childless button gets its whole text replaced; a button with
  // element children but no label span is an unknown shape and must be left
  // alone (no text guessing).
  assert.match(SOURCE, /else if \(button\.firstElementChild === null\) \{[\s\S]*?button\.textContent = navT\('deleteSession'\)/)
  assert.match(SOURCE, /button\.style\.color = DANGER_COLOR/)
  assert.match(SOURCE, /unknown future shape/)
})

test('the host delete-endpoint flow is unchanged', () => {
  // Marker + dialog ids (the browser-review and probe contract).
  assert.match(SOURCE, /DELETE_ITEM_MARKER = 'data-mobile-nav="session-delete"'/)
  assert.match(SOURCE, /delete-dialog-backdrop/)
  // The host menu is closed through its own anchor before the flow starts.
  assert.match(SOURCE, /captured\?\.button\.click\(\)/)
})

test('menu recognition is containment-style: rename + fork + archive', () => {
  // 0.1.7 added a fourth 「置顶会话」 item — an exact item-count gate
  // silently disabled the whole feature there, so the counted form must
  // stay gone from the predicate (the source comment may still cite it as
  // history).
  assert.doesNotMatch(SOURCE, /labels\.length === 3/)
  assert.match(SOURCE, /labels\.includes\(rename\) && labels\.includes\(fork\)/)
  assert.match(SOURCE, /labels\.includes\(wsT\('menu\.archiveSession'\)\)/)
  // The discriminating-triple rationale (fork label exists only in the
  // session menu) is documented next to the predicate.
  assert.match(SOURCE, /fork label exists only in ui-workspace/)
})

test('archived rows (unarchive swap) never get the injected delete item', () => {
  // #V1 N1: the former unarchive branch recognized archived-row menus and
  // injected a delete item that resolution can never satisfy (archived ids
  // are filtered out) — the tap always ended in deleteErrorResolve. The
  // predicate must key on archiveSession only; the unarchive call form must
  // stay gone from the code (negative assertion pinned to the call shape,
  // NOT a bare word — source comments may still cite the history).
  assert.doesNotMatch(SOURCE, /labels\.includes\(wsT\('menu\.unarchiveSession'\)\)/)
  assert.match(SOURCE, /Archived rows swap archive/)
  assert.match(SOURCE, /delete via unarchive first/)
})

test('blank (new-session) rows never get the injected delete item', () => {
  // A blank row renders the host's localized "New session" label while
  // displayTitle stays empty — resolution could never succeed, so the item
  // is withheld and the menu stays host-native.
  assert.match(SOURCE, /const blankLabel = wsT\('session\.new'\)/)
  assert.match(SOURCE, /anchor\.title === blankLabel/)
  // The accepted ceiling (a session manually titled exactly the host label)
  // is annotated in the source so it is not re-litigated as a bug.
  assert.match(SOURCE, /Known ceiling/)
})

test('the row id comes from the host\'s stable anchors, never from title guessing (2026-10-07)', () => {
  // 宿主 0.2.0-rc.2 把会话行包进 HoverCard 的 <span>，于是 `:scope > _sessionRow` 取不到行
  // → rowIndex=-1 → 重名标题被静默算成"第一个同名会话"（**会删错会话**）。整套按标题猜 id
  // 的做法已删除，改成读宿主自己的稳定锚。
  assert.doesNotMatch(SOURCE, /resolveSessionId/, '按标题/组内位置猜 id 的路径必须不存在')
  // 只查代码形态（注释里保留历史说明是刻意的）。
  assert.doesNotMatch(SOURCE, /querySelectorAll<HTMLElement>\(':scope > \[class\*="_sessionRow"\]'\)/, '不再用 :scope > 取行（HoverCard 已包一层）')
  assert.doesNotMatch(SOURCE, /querySelector<HTMLElement>\(':scope > \[class\*="_projectRow"\]/, '组头锚同样已失效，不许再用')
  // 1) data-row-key="session:<id>"（宿主 AnimatedRows 同源依赖的稳定属性）
  assert.match(SOURCE, /row\.getAttribute\('data-row-key'\)/)
  assert.match(SOURCE, /rowKey\.startsWith\('session:'\)/)
  assert.match(SOURCE, /rowKey\.slice\('session:'\.length\)/)
  // 2) DSHA 构建直接戳了 id
  assert.match(SOURCE, /row\.getAttribute\('data-dsha-session-select'\)/)
  // 3) 最后才回落到 fiber
  assert.match(SOURCE, /return findSessionIdInFiber\(reactFiberOf\(row\), isKnownSessionId\)/)
  // 删除时只用录制到的 id；读不到就报错（不许猜）
  assert.match(SOURCE, /const sessionId = captured\.sessionId/)
  assert.match(SOURCE, /if \(sessionId === null\) \{[\s\S]{0,120}?deleteErrorResolve/)
  // ⋯ 按钮按 aria-label 识别，显式排除同行的归档/置顶按钮（每行三个按钮）
  assert.match(SOURCE, /\/session actions\/i\.test\(label\)/)
  assert.match(SOURCE, /!\/archive session\|pin session\/i\.test\(label\)/)
  assert.doesNotMatch(SOURCE, /row\.querySelector<HTMLButtonElement>\('button'\)/, '不再赌行里只有一个按钮')
  assert.match(SOURCE, /const sessionId = rowSessionId\(row\)/)
})

test('an unanswered delete is verified against the session list before it is reported as failed (2026-10-07)', () => {
  // 设备上工厂版宿主半区会在「会话已移入回收站之后」掐断响应，于是浏览器拿到的
  // 是 `Failed to fetch`（net::ERR_EMPTY_RESPONSE）——删成功的会话被报成失败。
  // 判据只能是会话列表，不是 fetch 的 promise。
  assert.match(SOURCE, /import \{[^}]*verifySessionDeleted[^}]*\} from '\.\.\/core\/sessions-compat\.ts'/)
  assert.match(SOURCE, /landed = await verifySessionDeleted\(\{/)
  assert.match(SOURCE, /listed: \(\) => ctx\.sessions\.list\.getSnapshot\(\)\?\.byId\?\.\[sessionId\] !== undefined/)
  // refresh 必须仍以 ctx.sessions 为 receiver 调用（抽出来的引用会 this undefined）。
  assert.match(SOURCE, /await \(ctx\.sessions as \{ refresh\?: \(\) => Promise<void> \}\)\.refresh\?\.\(\)/)
  // 旧的「catch 了就直接报失败」路径必须不存在。
  assert.doesNotMatch(SOURCE, /\} catch \(reason\) \{\s*\n\s*fail\(mapError\(null, reason\)\)/)
  // 验证本身不许变成新的失败模式：快照形状意外时退回普通错误行。
  assert.match(SOURCE, /let landed = false/)
  assert.match(SOURCE, /\} catch \{[\s\S]{0,40}?landed = false/)
  // 响应本身有答案时（HTTP 403/404 等）不进验证路径，直接按服务端口径报错。
  assert.match(SOURCE, /fail\(mapError\(payload, new Error\(`HTTP \$\{response\.status\}`\)\)\)/)
})

test('完成后才核对当前会话、并在过期结果上停手（源码不变式）', () => {
  // 请求期前算好的旧 wasCurrent 会在切会话后清掉新当前会话的选中态（2026-10-11）。
  assert.match(SOURCE, /const wasCurrent = currentSessionIdOf\(ctx\.sessions\.list\.getSnapshot\(\)\) === sessionId/)
  assert.match(SOURCE, /let deleteEpoch = 0/)
  assert.match(SOURCE, /const epoch = \+\+deleteEpoch/)
  assert.match(SOURCE, /if \(epoch !== deleteEpoch\) return/)
  // 收尾顺序：先核对、再判过期，然后才是 closeDialog / clear。
  const finish = SOURCE.slice(SOURCE.indexOf('const wasCurrent ='), SOURCE.indexOf('const sessions = ctx.sessions as'))
  assert.ok(finish.indexOf('if (epoch !== deleteEpoch) return') < finish.indexOf('ctx.sessions.clear()'))
  // refresh 失败单独 warn，不得反称删除失败、也不许漏成未处理 rejection。
  assert.match(SOURCE, /console\.warn\('\[dsh-web-mobile\] session list refresh after delete failed:', reason\)/)
  assert.match(SOURCE, /const frame = getFrame\(\)/)
  assert.match(SOURCE, /if \(frame === null \|\| frame\.hasAttribute\('data-sidebar-collapsed'\)\) return/)
})

// --- 行为层：把真实的点击处理跑在桩 DOM 上 --------------------------------------
// 形状断言看不出「请求期间切会话 / refresh 抛错 / 抽屉已关」这三态的真行为，
// 所以照 mobile-navigation-behavior.test.ts 的路子：ts.transpileModule 编成
// CommonJS，在 vm 里用桩 document / window / fetch 执行真代码。
// 核心会话判定 helpers 用真货（core 是纯函数），只有宿主侧通道是桩。

type Listener = (event: unknown) => unknown

const COMPILED_MENU = ts.transpileModule(SOURCE, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function selectorMatches(node: FakeNode, selector: string): boolean {
  if (!selector.startsWith('[')) return node.tagName.toLowerCase() === selector.toLowerCase()
  const parsed = /^\[([\w-]+)(?:(\*?=)"([^"]*)")?\]$/.exec(selector)
  if (parsed === null) return false
  const actual = node.getAttribute(parsed[1])
  if (parsed[2] === undefined) return actual !== null
  if (parsed[2] === '=') return actual === parsed[3]
  return actual !== null && actual.includes(parsed[3] ?? '')
}

/** 只够这套效果的桩 DOM：属性选择器 + 子树查找 + 监听器 + `data-mobile-nav`
 *  标记解析（`innerHTML` 只需认出卡片里那几颗按钮，不需要真 HTML 解析）。 */
class FakeNode {
  tagName: string
  children: FakeNode[] = []
  parentElement: FakeNode | null = null
  attrs: Record<string, string> = {}
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  listeners = new Map<string, Listener[]>()
  textContent = ''
  hidden = false
  disabled = false
  isConnected = true
  markup = ''

  constructor(tagName = 'div') {
    this.tagName = tagName
  }

  setAttribute(key: string, value: string): void {
    this.attrs[key] = value
  }

  getAttribute(key: string): string | null {
    return this.attrs[key] ?? null
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener))
  }

  appendChild(child: FakeNode): FakeNode {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  remove(): void {
    if (this.parentElement !== null) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
      this.parentElement = null
    }
    this.isConnected = false
  }

  get firstElementChild(): FakeNode | null {
    return this.children[0] ?? null
  }

  cloneNode(): FakeNode {
    const copy = new FakeNode(this.tagName)
    copy.attrs = { ...this.attrs }
    copy.dataset = { ...this.dataset }
    copy.style = { ...this.style }
    copy.textContent = this.textContent
    for (const child of this.children) copy.appendChild(child.cloneNode())
    return copy
  }

  set innerHTML(value: string) {
    this.markup = value
    this.children = [...value.matchAll(/data-mobile-nav="([^"]+)"/g)].map((match) => {
      const node = new FakeNode()
      node.setAttribute('data-mobile-nav', match[1])
      node.dataset.mobileNav = match[1]
      return node
    })
    for (const child of this.children) child.parentElement = this
  }

  get innerHTML(): string {
    return this.markup
  }

  descendants(): FakeNode[] {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  querySelectorAll(selector: string): FakeNode[] {
    return this.descendants().filter((node) => selectorMatches(node, selector))
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  closest(selector: string): FakeNode | null {
    let node: FakeNode | null = this
    while (node !== null) {
      if (selectorMatches(node, selector)) return node
      node = node.parentElement
    }
    return null
  }

  async fire(type: string, event: Record<string, unknown> = {}): Promise<void> {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      await listener({ target: this, preventDefault() {}, stopPropagation() {}, ...event })
    }
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) {
      listener({ target: this, preventDefault() {}, stopPropagation() {} })
    }
  }
}

interface DeleteFixtureOptions {
  /** MOBILE_QUERY 命中（手机档）。 */
  mobile?: boolean
  /** 抽屉当前是否开着（frame 不带 collapsed 标记）。 */
  drawerOpen?: boolean
  /** `sessions.refresh()` 是否抛错。 */
  refreshError?: Error | null
}

function deleteFixture(options: DeleteFixtureOptions = {}) {
  const mobile = options.mobile ?? true
  const drawer = { open: options.drawerOpen ?? true }
  const refreshError = options.refreshError ?? null
  const documentListeners = new Map<string, Listener>()
  const pendings: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = []
  const posts: string[] = []
  const warns: unknown[][] = []
  const drawerToggles: string[] = []
  const byId: Record<string, { id: string }> = { 's-old': { id: 's-old' }, 's-new': { id: 's-new' } }
  let clears = 0
  let current = 's-old'
  let cleanup: (() => void) | undefined

  const make = (tag: string, attrs: Record<string, string> = {}, text = ''): FakeNode => {
    const node = new FakeNode(tag)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    node.textContent = text
    return node
  }

  // 一行会话 + 宿主自己的三项菜单（识别 signature = rename + fork + archive）。
  const row = make('div', { class: '_sessionRow_abc', 'data-row-key': 'session:s-old' })
  row.appendChild(make('span', { class: '_title_xyz' }, '会话标题'))
  row.appendChild(make('button', { 'aria-label': 'Session actions for 会话标题' }))
  row.appendChild(make('button', { 'aria-label': 'Archive session' }))
  const viewport = make('div', { class: '_viewport_1' })
  const wrap = make('div')
  wrap.appendChild(make('button', { role: 'menuitem' }, 'Rename'))
  wrap.appendChild(make('button', { role: 'menuitem' }, 'Fork'))
  wrap.appendChild(make('button', { role: 'menuitem' }, 'Archive'))
  viewport.appendChild(wrap)
  const menu = make('div', { role: 'menu' })
  menu.appendChild(viewport)

  const labels: Record<string, string> = {
    rename: 'Rename', 'menu.fork': 'Fork', 'menu.archiveSession': 'Archive',
  }
  const translate = (key: string, params?: Record<string, unknown>): string =>
    (params === undefined ? labels[key] ?? key : `${key}(${params.title ?? ''})`)

  const documentStub = {
    body: new FakeNode('body'),
    createElement: (tag: string) => new FakeNode(tag),
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === '[role="menu"]' ? [menu] : []),
    addEventListener: (type: string, listener: Listener) => { documentListeners.set(type, listener) },
    removeEventListener: (type: string, listener: Listener) => {
      if (documentListeners.get(type) === listener) documentListeners.delete(type)
    },
  }

  const context = {
    locale: { bind: () => translate },
    sessions: {
      list: { getSnapshot: () => ({ current, byId }) },
      clear: () => { clears += 1 },
      refresh: async () => { if (refreshError !== null) throw refreshError },
    },
  }

  const fetchStub = (url: string, init: { body: string }): Promise<unknown> => {
    posts.push((JSON.parse(init.body) as { sessionId: string }).sessionId)
    return new Promise((resolve, reject) => { pendings.push({ resolve, reject }) })
  }

  const requireStub = (specifier: string): unknown => {
    // The breakpoint primitives live in the platform layer; getFrame is still
    // phone-chrome's and toggleDrawer moved to drawer-close.ts (P1 拆分，
    // 2026-10-12；effects may not import each other for infrastructure, but a
    // feature helper is a different thing).
    if (specifier.includes('platform/breakpoints')) {
      return {
        MOBILE_QUERY: 'mobile-query',
        TOUCH_QUERY: 'touch-query',
        installMobileEffect: (_ctx: unknown, _label: string, install: () => (() => void) | undefined) => {
          cleanup = install()
        },
      }
    }
    if (specifier.includes('drawer-close')) {
      return {
        toggleDrawer: () => { drawerToggles.push('toggle') },
      }
    }
    if (specifier.includes('platform/frame')) {
      return {
        getFrame: () => ({
          hasAttribute: (name: string) => name === 'data-sidebar-collapsed' && !drawer.open,
        }),
      }
    }
    if (specifier.includes('sessions-compat')) {
      return { currentSessionIdOf, sessionsCanClear, verifySessionDeleted }
    }
    if (specifier.includes('locales')) return { NS: 'dshWebMobileNav' }
    if (specifier.includes('session-row-fiber')) {
      return { findSessionIdInFiber: () => null, reactFiberOf: () => null }
    }
    throw new Error(`unexpected require: ${specifier}`)
  }

  class MutationObserverStub {
    observe(): void {}
    disconnect(): void {}
  }

  const module = { exports: {} as Record<string, unknown> }
  vm.runInNewContext(COMPILED_MENU, {
    module,
    exports: module.exports,
    require: requireStub,
    document: documentStub,
    window: {
      matchMedia: (query: string) => ({
        matches: query === 'mobile-query' && mobile,
        addEventListener() {},
        removeEventListener() {},
      }),
      setTimeout: () => 1,
      clearTimeout: () => {},
    },
    console: {
      warn: (...args: unknown[]) => { warns.push(args) },
      error: (...args: unknown[]) => { warns.push(args) },
      log: () => {},
    },
    MutationObserver: MutationObserverStub,
    requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    cancelAnimationFrame: () => {},
    fetch: fetchStub,
  })
  ;(module.exports.installSessionMenuDelete as (ctx: unknown) => void)(context)

  const yesButton = (): FakeNode => {
    const backdrop = documentStub.body.children[0]
    const button = backdrop.children[0].querySelector('[data-mobile-nav="delete-confirm-yes"]')
    assert.ok(button !== null, '确认卡片必须存在')
    return button
  }

  return {
    clearCalls: () => clears,
    posts: () => [...posts],
    warns: () => warns,
    drawerToggles: () => [...drawerToggles],
    dialogOpen: () => documentStub.body.children.length > 0,
    setCurrent: (id: string) => { current = id },
    setDrawerOpen: (value: boolean) => { drawer.open = value },
    /** 模拟宿主真的把会话移走了（响应被掐断的那一路要靠列表判定）。 */
    dropSession: (id: string) => { delete byId[id] },
    /** 点行上的 ⋯（录制 anchor 的那条 capture 路径）。 */
    openMenu: () => { documentListeners.get('click')?.({ target: row }) },
    /** 点注入的「删除会话」项（会弹确认卡片）。 */
    tapDelete: () => { viewport.children[1].children[0].click() },
    /** 点确认——await 到处理函数真正跑完（含在途请求）。 */
    confirm: () => yesButton().fire('click'),
    resolveFetch: (index = pendings.length - 1) => {
      pendings[index].resolve({ ok: true, status: 200, json: async () => ({ ok: true, deleted: posts[index] }) })
    },
    /** 响应被掐断：net::ERR_EMPTY_RESPONSE → fetch 直接 reject。 */
    rejectFetch: (index = pendings.length - 1) => {
      pendings[index].reject(new TypeError('Failed to fetch'))
    },
    dispose: () => cleanup?.(),
  }
}

test('请求期间切到别的会话：不得 clear 新当前会话（行为）', async () => {
  const fixture = deleteFixture()
  fixture.openMenu()
  fixture.tapDelete()
  const pending = fixture.confirm()
  fixture.setCurrent('s-new')
  fixture.resolveFetch()
  await pending

  assert.deepEqual(fixture.posts(), ['s-old'], '删的仍是被点的那个会话')
  assert.equal(fixture.clearCalls(), 0, '旧 wasCurrent 会把新当前会话的选中态清掉')
  assert.deepEqual(fixture.drawerToggles(), [], '新当前会话还在用，抽屉不该被收')
  fixture.dispose()
})

test('删的仍是当前会话：clear 一次并收起抽屉（行为）', async () => {
  const fixture = deleteFixture()
  fixture.openMenu()
  fixture.tapDelete()
  const pending = fixture.confirm()
  fixture.resolveFetch()
  await pending

  assert.equal(fixture.clearCalls(), 1)
  assert.deepEqual(fixture.drawerToggles(), ['toggle'])
  assert.equal(fixture.dialogOpen(), false, '成功后卡片必须收尾')
  fixture.dispose()
})

test('refresh 抛错：删除仍算成功、单独 warn、不成未处理 rejection（行为）', async () => {
  const fixture = deleteFixture({ refreshError: new Error('refresh offline') })
  fixture.openMenu()
  fixture.tapDelete()
  const pending = fixture.confirm()
  fixture.resolveFetch()
  await assert.doesNotReject(pending)

  assert.equal(fixture.clearCalls(), 1, '删除成功的结论不因刷新失败而改变')
  assert.deepEqual(fixture.drawerToggles(), ['toggle'], '收尾照常')
  assert.equal(fixture.dialogOpen(), false)
  assert.equal(fixture.warns().length, 1, 'refresh 失败单独 warn，不反称删除失败')
  assert.match(String(fixture.warns()[0][0]), /refresh/)
  fixture.dispose()
})

test('抽屉已经关掉：不得把它重新打开（行为）', async () => {
  const fixture = deleteFixture({ drawerOpen: false })
  fixture.openMenu()
  fixture.tapDelete()
  const pending = fixture.confirm()
  fixture.resolveFetch()
  await pending

  assert.equal(fixture.clearCalls(), 1, '删除本身照常收尾')
  assert.deepEqual(fixture.drawerToggles(), [], '盲 toggle 会把已关的抽屉打开')
  fixture.dispose()
})

test('桌面档（MOBILE_QUERY 未命中）：面板不得被收起（行为）', async () => {
  const fixture = deleteFixture({ mobile: false })
  fixture.openMenu()
  fixture.tapDelete()
  const pending = fixture.confirm()
  fixture.resolveFetch()
  await pending

  assert.equal(fixture.clearCalls(), 1)
  assert.deepEqual(fixture.drawerToggles(), [], '桌面面板不得被收起')
  fixture.dispose()
})

test('过期响应：更晚的一次删除让在途结果失效（行为）', async () => {
  const fixture = deleteFixture()
  fixture.openMenu()
  fixture.tapDelete()
  const first = fixture.confirm()
  fixture.openMenu()
  fixture.tapDelete()
  const second = fixture.confirm()
  fixture.resolveFetch(0)
  await first
  assert.equal(fixture.clearCalls(), 0, '过期结果不得动状态')

  fixture.resolveFetch(1)
  await second
  assert.equal(fixture.clearCalls(), 1, '有效的那次照常收尾')
  fixture.dispose()
})

test('网络未知但确实删掉了：按成功收尾，且不动切走后的新当前会话（行为）', async () => {
  const fixture = deleteFixture()
  fixture.openMenu()
  fixture.tapDelete()
  const pending = fixture.confirm()
  fixture.setCurrent('s-new')
  fixture.dropSession('s-old')   // 宿主半区已经移走了会话，响应才被掐断
  fixture.rejectFetch()
  await assert.doesNotReject(pending)

  assert.equal(fixture.clearCalls(), 0, '期间切走 → 不得清新当前会话')
  assert.deepEqual(fixture.drawerToggles(), [])
  assert.equal(fixture.dialogOpen(), false, '列表证明已落地 → 必须按成功收尾，不报失败')
  fixture.dispose()
})
