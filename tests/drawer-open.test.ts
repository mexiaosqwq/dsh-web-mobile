// platform/drawer-open.ts — the shared drawer-open entry (2026-11-05 drawer-jank report, R2).
// Behavior is exercised against stub globals: focus release, the keyboard wait,
// the cap, and the cancel-on-second-call rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'src/client/platform/drawer-open.ts'), 'utf8')
const SWIPE = readFileSync(join(ROOT, 'src/client/effects/sidebar-swipe.ts'), 'utf8')
const ENTRY = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

type Listener = () => void

interface Env {
  stableVh: number
  visible: number
  active: { matches: (s: string) => boolean; blur: () => void } | null
  blurs: number
  timers: Map<number, { at: number; run: () => void }>
  now: number
  vvListeners: Set<Listener>
  winListeners: Set<Listener>
}

function installEnv(): Env {
  const env: Env = {
    stableVh: 800, visible: 800, active: null, blurs: 0,
    timers: new Map(), now: 0, vvListeners: new Set(), winListeners: new Set(),
  }
  let nextId = 1
  class HTMLElementStub {}
  const g = globalThis as unknown as Record<string, unknown>
  g.HTMLElement = HTMLElementStub
  g.document = {
    get activeElement() { return env.active },
    documentElement: { style: { getPropertyValue: () => `${env.stableVh}px` } },
  }
  g.window = {
    get innerHeight() { return env.stableVh },
    visualViewport: {
      get height() { return env.visible },
      addEventListener: (_t: string, fn: Listener) => { env.vvListeners.add(fn) },
      removeEventListener: (_t: string, fn: Listener) => { env.vvListeners.delete(fn) },
    },
    addEventListener: (_t: string, fn: Listener) => { env.winListeners.add(fn) },
    removeEventListener: (_t: string, fn: Listener) => { env.winListeners.delete(fn) },
    setTimeout: (run: () => void, ms: number) => { const id = nextId++; env.timers.set(id, { at: env.now + ms, run }); return id },
    clearTimeout: (id: number) => { env.timers.delete(id) },
  }
  return env
}

function focusText(env: Env): void {
  const el = Object.assign(Object.create((globalThis as { HTMLElement: { prototype: object } }).HTMLElement.prototype), {
    matches: (s: string) => s.includes('[contenteditable]'),
    blur: () => { env.blurs += 1; env.active = null },
  })
  env.active = el
}

function advance(env: Env, ms: number): void {
  env.now += ms
  for (const [id, timer] of [...env.timers].sort((a, b) => a[1].at - b[1].at)) {
    if (timer.at <= env.now && env.timers.has(id)) { env.timers.delete(id); timer.run() }
  }
}

function resize(env: Env): void {
  for (const fn of [...env.vvListeners]) fn()
}

const mod = await import('../src/client/platform/drawer-open.ts')

test('no focused text: opens immediately, no blur', () => {
  const env = installEnv()
  let opens = 0
  mod.openDrawerAfterKeyboard(() => { opens += 1 })
  assert.equal(opens, 1)
  assert.equal(env.blurs, 0)
})

test('focused text with keyboard down: blur, then open immediately', () => {
  const env = installEnv()
  focusText(env)
  let opens = 0
  mod.openDrawerAfterKeyboard(() => { opens += 1 })
  assert.equal(env.blurs, 1)
  assert.equal(opens, 1)
})

test('keyboard up: blur, wait until it reads down and the viewport is quiet, then open once', () => {
  const env = installEnv()
  env.visible = 450
  focusText(env)
  let opens = 0
  mod.openDrawerAfterKeyboard(() => { opens += 1 })
  assert.equal(env.blurs, 1)
  assert.equal(opens, 0, 'must not open while the keyboard is still up')
  resize(env) // still up (450)
  advance(env, 100)
  assert.equal(opens, 0)
  env.visible = 800
  resize(env)
  advance(env, 30)
  assert.equal(opens, 0, 'waits for the quiet window')
  advance(env, 40)
  assert.equal(opens, 1)
  assert.equal(env.vvListeners.size, 0, 'listeners released')
  assert.equal(env.timers.size, 0, 'timers released')
  advance(env, 1000)
  assert.equal(opens, 1, 'the cap does not fire a second open')
})

test('keyboard up and no resize ever arrives: the cap opens', () => {
  const env = installEnv()
  env.visible = 450
  focusText(env)
  let opens = 0
  mod.openDrawerAfterKeyboard(() => { opens += 1 })
  advance(env, 449)
  assert.equal(opens, 0)
  advance(env, 1)
  assert.equal(opens, 1)
})

test('a second call during the wait cancels the pending open and does nothing else', () => {
  const env = installEnv()
  env.visible = 450
  focusText(env)
  let opens = 0
  mod.openDrawerAfterKeyboard(() => { opens += 1 })
  mod.openDrawerAfterKeyboard(() => { opens += 10 })
  advance(env, 1000)
  assert.equal(opens, 0)
  assert.equal(env.vvListeners.size, 0)
  // The next call after the cancel is a fresh open.
  mod.openDrawerAfterKeyboard(() => { opens += 1 })
  assert.equal(opens, 1)
})

test('non-text focus is left alone', () => {
  const env = installEnv()
  env.active = Object.assign(Object.create((globalThis as { HTMLElement: { prototype: object } }).HTMLElement.prototype), {
    matches: () => false, blur: () => { env.blurs += 1 },
  })
  assert.equal(mod.releaseTextFocus(), false)
  assert.equal(env.blurs, 0)
})

test('openers are wired: header toggle via toggleDrawer, gesture arm blurs before the flip', () => {
  assert.match(ENTRY, /toggleSidebar: \(\) => toggleDrawer\(ctx\)/)
  assert.doesNotMatch(ENTRY, /toggleSidebar: \(\) => ctx\.layout\.toggleSidebar\(\)/)
  const arm = SWIPE.slice(SWIPE.indexOf('function armOpenFollow('), SWIPE.indexOf('\n}', SWIPE.indexOf('function armOpenFollow(')))
  assert.ok(arm.indexOf('releaseTextFocus()') !== -1 && arm.indexOf('releaseTextFocus()') < arm.indexOf('ctx.layout.toggleSidebar()'))
  // The gesture never waits: no deferred open on the arm path.
  assert.doesNotMatch(arm, /openDrawerAfterKeyboard/)
  // Platform stays effect-free.
  assert.doesNotMatch(SOURCE, /from '\.\.\/effects\//)
})

// ── R3: the backdrop mounts in the opening task (drawer-layer showNow) ──

class FakeNode {
  tagName: string
  children: FakeNode[] = []
  parentElement: FakeNode | null = null
  dataset: Record<string, string> = {}
  attrs = new Map<string, string>()
  style = {
    props: new Map<string, string>(),
    set pointerEvents(v: string) { this.props.set('pointer-events', v) },
    set opacity(v: string) { this.props.set('opacity', v) },
    removeProperty(k: string) { this.props.delete(k) },
  }
  constructor(tag: string) { this.tagName = tag }
  get isConnected(): boolean { return true }
  appendChild(child: FakeNode): void { child.parentElement = this; this.children.push(child) }
  remove(): void {
    const p = this.parentElement
    if (p !== null) p.children = p.children.filter((c) => c !== this)
    this.parentElement = null
  }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); if (k === 'data-mobile-nav') this.dataset.mobileNav = v }
  getAttribute(k: string): string | null { return k === 'data-mobile-nav' ? this.dataset.mobileNav ?? null : this.attrs.get(k) ?? null }
  hasAttribute(k: string): boolean { return this.attrs.has(k) }
  removeAttribute(k: string): void { this.attrs.delete(k) }
  addEventListener(): void {}
}

const frames: FakeNode[] = []

async function overlayHarness() {
  const env = installEnv()
  // platform/frame.ts memoizes the frame; retire earlier fakes so the cache re-queries.
  for (const old of frames) delete old.dataset.mobileNav
  const frame = new FakeNode('div')
  frames.push(frame)
  frame.dataset.mobileNav = 'frame'
  frame.setAttribute('data-sidebar-collapsed', '')
  const g = globalThis as unknown as Record<string, unknown>
  const doc = g.document as Record<string, unknown>
  doc.createElement = (tag: string) => new FakeNode(tag)
  // The active session view exists, so the FAB stays out of the picture.
  doc.querySelector = (sel: string) => (sel === '[data-mobile-nav="frame"]' ? frame : sel === '[data-phase="active"]' ? {} : null)
  const { createDrawerLayerTask } = await import('../src/client/effects/drawer-layer.ts')
  const task = createDrawerLayerTask(((k: string) => k) as never, () => {}, null)
  task.ensure()
  const backdrops = (): FakeNode[] => frame.children.filter((c) => c.dataset.mobileNav === 'hit')
  return { env, frame, task, backdrops }
}

test('the opening hook starts the dim synchronously, before the host commit', async () => {
  const { env, frame, task, backdrops } = await overlayHarness()
  assert.equal(backdrops().length, 1, 'the catcher is mounted once and stays')
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '0', 'closed state has no dim')
  mod.drawerOpening()
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '1', 'dim starts in the opener task')
  // The host commit lands: the next ensure keeps the dim and disarms the confirm.
  frame.removeAttribute('data-sidebar-collapsed')
  task.ensure()
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '1')
  assert.equal(env.timers.size, 0, 'confirm timer cleared once the open state is seen')
  task.dispose()
  assert.equal(backdrops().length, 0)
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), null, 'dispose clears the marker')
})

test('an ensure before the commit lands keeps the optimistic dim in the confirm window', async () => {
  const { env, frame, task } = await overlayHarness()
  mod.drawerOpening()
  task.ensure() // frame still reads collapsed
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '1', 'not faded inside the confirm window')
  // The open never lands: when the confirm window ends, the closed branch fades it.
  advance(env, 120)
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '0')
  task.dispose()
})

test('a mutation during a late close commit does not re-light the pre-faded dim', async () => {
  const { frame, task } = await overlayHarness()
  const { fadeDimOut } = await import('../src/client/effects/drawer-layer.ts')
  mod.drawerOpening()
  frame.removeAttribute('data-sidebar-collapsed')
  task.ensure()
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '1')
  fadeDimOut() // the close commit starts animating; the marker has not flipped
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '0')
  task.ensure() // any tree mutation landing inside the 280ms window
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '0', 'the pre-fade must survive the marker lag')
  frame.setAttribute('data-sidebar-collapsed', '')
  task.ensure() // the flip releases the hold
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '0')
  mod.drawerOpening()
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '1', 'the next open dims again')
  task.dispose()
})

test('the catcher is a role-less, aria-hidden hit target, inert while closed', async () => {
  const { frame, task, backdrops } = await overlayHarness()
  const catcher = backdrops()[0]
  assert.ok(catcher !== undefined, 'the catcher exists while the drawer is closed')
  assert.equal(catcher.getAttribute('aria-hidden'), 'true', 'stays out of the a11y tree')
  assert.equal(catcher.getAttribute('role'), null, 'no interactive role on a full-screen surface')
  assert.equal(catcher.getAttribute('aria-label'), null, 'no label that makes it read as a button')
  assert.equal(catcher.style.props.get('pointer-events'), 'none', 'inert while closed')
  frame.removeAttribute('data-sidebar-collapsed')
  task.ensure()
  assert.equal(catcher.style.props.get('pointer-events'), 'auto', 'the hit target arms with the dim')
  task.dispose()
})

test('opening hook is a no-op while the drawer already reads open', async () => {
  const { frame, task, backdrops } = await overlayHarness()
  frame.removeAttribute('data-sidebar-collapsed')
  mod.drawerOpening()
  assert.equal(frame.getAttribute('data-mobile-nav-dim'), '0', 'the no-op hook writes no dim')
  task.dispose()
  mod.drawerOpening()
  assert.equal(backdrops().length, 0, 'dispose unregisters the hook')
})

test('both openers fire the hook right before the flip', () => {
  const DRAWER_CLOSE = readFileSync(join(ROOT, 'src/client/effects/drawer-close.ts'), 'utf8')
  const open = DRAWER_CLOSE.slice(DRAWER_CLOSE.indexOf('openDrawerAfterKeyboard(() => {'))
  assert.ok(open.indexOf('drawerOpening()') < open.indexOf('ctx.layout.toggleSidebar()'))
  const arm = SWIPE.slice(SWIPE.indexOf('function armOpenFollow('), SWIPE.indexOf('\n}', SWIPE.indexOf('function armOpenFollow(')))
  assert.ok(arm.indexOf('drawerOpening()') !== -1 && arm.indexOf('drawerOpening()') < arm.indexOf('ctx.layout.toggleSidebar()'))
})
