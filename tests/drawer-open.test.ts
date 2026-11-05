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
