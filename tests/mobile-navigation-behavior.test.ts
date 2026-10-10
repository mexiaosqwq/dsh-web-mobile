// Execute actual TypeScript handlers with controlled DOM/event fixtures.
// These tests cover routing and geometry, not a full React/WebView render.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { isTapWithinSlop } from '../src/client/effects/session-row-fiber.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')
const tree = ts.createSourceFile('phone.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const handler = tree.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'installOverlayInteractions')
assert.ok(handler)
const compile = (text: string) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiledHandler = compile(handler.getText(tree))

function sessionFixture() {
  const listeners = new Map()
  let now = 1000
  let open = true
  let navigations = 0
  let closes = 0
  let selected = 0
  let modal = false
  let locked = false
  class Element {
    button: boolean
    constructor(button = false) { this.button = button }
    closest(selector: string) {
      if (selector.includes('sessionRow') && selector.includes('button')) return this.button ? this : null
      if (selector.includes('backdrop')) return null
      return row
    }
  }
  const row = new Element()
  const button = new Element(true)
  const frame = { hasAttribute: () => !open }
  const drawer = { contains: () => true, querySelector: () => null }
  const doc = {
    querySelector: (selector: string) => selector.includes('aria-modal') ? (modal ? {} : null)
      : selector.endsWith('> :first-child') ? drawer : frame,
    addEventListener: (type: string, fn: Function) => listeners.set(type, fn),
    removeEventListener: (type: string, fn: Function) => {
      if (listeners.get(type) === fn) listeners.delete(type)
    },
  }
  class MouseEvent {
    defaultPrevented = false
    stopped = false
    constructor(type: string, opts: object) { Object.assign(this, opts) }
    preventDefault() { this.defaultPrevented = true }
    stopPropagation() { this.stopped = true }
  }
  // The current DSHA host opens detail=0 immediately and then emits this event.
  const dispatchClick = event => {
    listeners.get('click')?.(event)
    if (event.stopped) return
    if (event.detail === 0) {
      navigations += 1
      listeners.get('dsha-session-open')?.({})
    } else selected += 1
  }
  row.dispatchEvent = event => { event.target = row; dispatchClick(event) }
  let cleanup
  const context = {
    document: doc,
    window: { clearTimeout() {}, setTimeout() { return 1 } },
    performance: { now: () => now }, Element, MouseEvent, exports: {},
    TAP_CLOSE_NAV_SELECTOR: '[class*="sessionRow"]', TAP_NAV_SLOP_PX: 12,
    getFrame: () => frame,
    installMobileEffect: (_ctx, _label, install) => { cleanup = install() },
    toggleDrawer: () => { open = !open; closes += 1 },
    isStrokeLocked: () => locked,
    consumeIfGestured: () => false,
    isTapWithinSlop,
  }
  vm.runInNewContext(`let touchDownAt = null; ${compiledHandler}; installOverlayInteractions({})`, context)
  const tap = ({ target = row, dx = 0, duration = 60, detail = 1 } = {}) => {
    listeners.get('pointerdown')({ pointerType: 'touch', clientX: 20, clientY: 50, target })
    now += duration
    listeners.get('pointerup')({ pointerType: 'touch', clientX: 20 + dx, clientY: 50, target })
    const event = new MouseEvent('click', { detail, clientX: 20 + dx, clientY: 50, target })
    dispatchClick(event)
    return event
  }
  return {
    tap, button, listeners, cleanup: () => cleanup(),
    setModal: value => { modal = value }, setLocked: value => { locked = value },
    counts: () => ({ navigations, closes, selected }),
  }
}

test('DSHA single click opens once and closes once without reselecting', () => {
  const fixture = sessionFixture()
  assert.equal(fixture.tap().stopped, true)
  assert.deepEqual(fixture.counts(), { navigations: 1, closes: 1, selected: 0 })
})
test('scrolling and long-press releases do not open sessions', () => {
  for (const gesture of [{ dx: 60 }, { duration: 650 }]) {
    const fixture = sessionFixture()
    fixture.tap(gesture)
    assert.equal(fixture.counts().navigations, 0)
  }
})
test('row action buttons do not open sessions', () => {
  const fixture = sessionFixture()
  fixture.tap({ target: fixture.button })
  assert.equal(fixture.counts().navigations, 0)
})
test('modal and locked gestures retain navigation ownership', () => {
  for (const gate of ['setModal', 'setLocked']) {
    const fixture = sessionFixture()
    fixture[gate](true)
    fixture.tap()
    assert.equal(fixture.counts().navigations, 0)
  }
})
test('host detail=0 clicks are not dispatched recursively', () => {
  const fixture = sessionFixture()
  fixture.tap({ detail: 0 })
  assert.equal(fixture.counts().navigations, 1)
})
test('session effect disposal removes every listener', () => {
  const fixture = sessionFixture()
  assert.ok(fixture.listeners.size > 0)
  fixture.cleanup()
  assert.equal(fixture.listeners.size, 0)
})

const modelBody = compile(readFileSync(join(ROOT, 'src/client/effects/model-menu-anchor.ts'), 'utf8'))
function modelFixture({ viewport, menuWidth, triggerRight, cardLeft, cardWidth }) {
  const listeners = new Map()
  const frames = new Map()
  const timers = new Map()
  let next = 1
  let queries = 0
  let cleanup
  const menu = { style: { left: 'original' }, getBoundingClientRect: () => ({ width: menuWidth, height: 100 }) }
  const trigger = {
    getBoundingClientRect: () => ({ left: triggerRight - 30, right: triggerRight, width: 30, height: 28 }),
    closest: selector => selector.includes('trigger') ? trigger : null,
  }
  const card = { getBoundingClientRect: () => ({ left: cardLeft, width: cardWidth, height: 90 }) }
  const doc = {
    documentElement: { clientWidth: viewport },
    querySelectorAll: () => { queries += 1; return [menu] },
    querySelector: selector => { queries += 1; return selector.includes('trigger') ? trigger : card },
    addEventListener: (type, fn) => listeners.set('d:' + type, fn),
    removeEventListener: type => listeners.delete('d:' + type),
  }
  const win = {
    requestAnimationFrame: fn => { const id = next++; frames.set(id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { const id = next++; timers.set(id, fn); return id },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, fn) => listeners.set('w:' + type, fn),
    removeEventListener: type => listeners.delete('w:' + type),
  }
  class Element {}
  Object.setPrototypeOf(trigger, Element.prototype)
  const module = { exports: {} }
  vm.runInNewContext(modelBody, {
    module, exports: module.exports, document: doc, window: win, Element,
    require: () => ({ installMobileEffect: (_ctx, _label, install) => { cleanup = install() } }),
  })
  module.exports.installModelMenuAnchor({})
  const flush = () => {
    for (let round = 0; round < 10 && (frames.size || timers.size); round += 1) {
      const pending = [...frames.values(), ...timers.values()]
      frames.clear()
      timers.clear()
      pending.forEach(fn => fn())
    }
  }
  return {
    menu, listeners, frames, timers,
    queries: () => queries, dispose: () => cleanup(),
    open: () => { listeners.get('d:click')({ target: trigger }); flush() },
    scroll: () => { listeners.get('d:scroll')({}); flush() },
  }
}
const WIDE = { viewport: 820, menuWidth: 300, triggerRight: 780, cardLeft: 20, cardWidth: 780 }
test('wide model menu aligns its right edge with the trigger', () => {
  const fixture = modelFixture(WIDE)
  fixture.open()
  assert.equal(fixture.menu.style.left, '480px')
})
test('a narrow model menu falls back to the composer center', () => {
  const fixture = modelFixture({ viewport: 360, menuWidth: 320, triggerRight: 249, cardLeft: 16, cardWidth: 326 })
  fixture.open()
  assert.equal(fixture.menu.style.left, '19px')
})
test('scrolling reuses cached anchors and disposal releases listeners and placement', () => {
  const fixture = modelFixture(WIDE)
  fixture.open()
  const before = fixture.queries()
  fixture.scroll()
  assert.equal(fixture.queries(), before)
  fixture.dispose()
  assert.equal(fixture.menu.style.left, '')
  assert.equal(fixture.listeners.size, 0)
  assert.equal(fixture.frames.size, 0)
  assert.equal(fixture.timers.size, 0)
})
test('phone panel chrome ignores split eligibility and preserves collapse', () => {
  const css = LAYOUT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = css.indexOf('@media (max-width: 767px) and (pointer: coarse)')
  const end = css.indexOf('\n  }', start)
  assert.ok(start >= 0 && end > start)
  const phone = css.slice(start, end)
  assert.match(phone, /\[data-sidebar-right-panel\] \[data-dockkit-split-button\]/)
  assert.match(phone, /span:has\(> \[data-dockkit-split-button\]\)/)
  assert.doesNotMatch(phone, /data-dockkit-split-blocked/)
  assert.match(phone, /display:\s*none\s*!important/)
  assert.doesNotMatch(phone, /data-sidebar-right-toggle/)
  assert.doesNotMatch(phone, /data-sidebar-right-mode="fullscreen"/)
})
test('subagent hash correction retains both selector families', () => {
  const text = readFileSync(join(ROOT, 'src/client/effects/subagent-chip-touch.ts'), 'utf8')
  assert.match(text, /Defensive dual hash/)
  for (const selector of ['ZKlsPq_root', 'ZKlsPq_menu', 'h8S2Va_root', 'h8S2Va_menu']) {
    assert.ok(text.includes(`[class*="${selector}"]`))
  }
})
