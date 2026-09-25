// State-machine anchor for src/client/effects/shortcut-modal-keyboard-guard.ts
// (scout review 2026-09-26), exercised through the public installer with fake
// stubs only — no src changes. The guard shadows
// HTMLInputElement.prototype.focus while either shortcut modal is in the DOM
// and no-ops it for the autofocus search field only; the shadow must be
// restored the moment neither modal is present (and on dispose), so nothing
// outlives the visit. Regression shape: a swap without restore (keyboard dead
// forever), or a double wrap (one disarm unwraps to a wrapper instead of the
// real method). NOTE: plain Node runs these files in strip-only mode, so no
// TS parameter properties / enums are allowed in test stubs.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const AUTOFOCUS_FIELD = '[data-shortcut-modal="shortcuts"] [data-modal-autofocus]'
const SETTINGS_MODAL = '[data-shortcut-modal="settings"]'

const state = {
  opts: null as Record<string, unknown> | null,
  disconnected: false,
  modalNodes: null as Record<string, unknown> | null,
  focusCalls: [] as unknown[],
  protoFocus: null as unknown,
}
let lastObserver: { trigger: () => void } | null = null

class FakeInputElement {
  private stub: { autofocusField: boolean }
  constructor(stub: { autofocusField: boolean }) {
    this.stub = stub
  }
  matches(selector: string): boolean {
    return selector === AUTOFOCUS_FIELD ? this.stub.autofocusField : false
  }
  focus(): void {
    state.focusCalls.push(this)
  }
}

Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: FakeInputElement })
;(globalThis as Record<string, unknown>).document = {
  querySelector: (selector: string) => state.modalNodes?.[selector] ?? null,
  body: {},
}
;(globalThis as Record<string, unknown>).window = {
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
}
;(globalThis as Record<string, unknown>).MutationObserver = class {
  constructor(cb: () => void) {
    lastObserver = { trigger: () => cb() }
  }
  observe(_target: unknown, opts: Record<string, unknown>): void {
    state.opts = opts
  }
  disconnect(): void {
    state.disconnected = true
  }
}

const { installShortcutModalKeyboardGuard } = await import('../src/client/effects/shortcut-modal-keyboard-guard.ts')

let lastEffectDisposer: (() => void) | undefined = undefined
const ctx = {
  effect: (fn: () => (() => void) | undefined) => {
    lastEffectDisposer = fn()
  },
} as unknown as Parameters<typeof installShortcutModalKeyboardGuard>[0]

function freshState(): void {
  state.opts = null
  state.disconnected = false
  state.modalNodes = { [SETTINGS_MODAL]: null, '[data-shortcut-modal="shortcuts"]': null }
  state.focusCalls = []
  state.protoFocus = (FakeInputElement.prototype as unknown as { focus: unknown }).focus
  lastEffectDisposer = undefined
}

function install(): void {
  installShortcutModalKeyboardGuard(ctx)
}

function armWithModal(): void {
  state.modalNodes![SETTINGS_MODAL] = {}
  lastObserver!.trigger()
}

test('initial sync with no modal in the DOM leaves prototype.focus untouched', () => {
  freshState()
  install()
  assert.equal(currentFocus(), state.protoFocus, 'guard armed with nothing to guard')
})

test('a modal in the DOM arms the shadow: autofocus no-oped, plain field passes through', () => {
  freshState()
  install()
  armWithModal()
  assert.notEqual(currentFocus(), state.protoFocus, 'presence of a modal must arm the shadow')

  const field = new FakeInputElement({ autofocusField: true })
  ;(field.focus as () => void)()
  assert.equal(state.focusCalls.length, 0, 'the autofocus field must be no-oped while armed')

  const plain = new FakeInputElement({ autofocusField: false })
  ;(plain.focus as () => void)()
  assert.equal(state.focusCalls.length, 1, 'a plain input must pass through to the real focus')
})

test('removing the modal restores the real focus method', () => {
  freshState()
  install()
  armWithModal()
  assert.notEqual(currentFocus(), state.protoFocus)
  state.modalNodes![SETTINGS_MODAL] = null
  lastObserver!.trigger()
  assert.equal(currentFocus(), state.protoFocus, 'shadow must be restored once no modal is present')
})

test('repeated syncs do not double-wrap (one disarm reaches the real method)', () => {
  freshState()
  install()
  armWithModal()
  assert.notEqual(currentFocus(), state.protoFocus)
  state.modalNodes!['[data-shortcut-modal="shortcuts"]'] = {}
  lastObserver!.trigger()
  assert.notEqual(currentFocus(), state.protoFocus, 'still armed with the shortcut modal present')
  state.modalNodes![SETTINGS_MODAL] = null
  state.modalNodes!['[data-shortcut-modal="shortcuts"]'] = null
  lastObserver!.trigger()
  assert.equal(currentFocus(), state.protoFocus, 'after two syncs one disarm must still reach the real method')
})

test('the effect disposer restores focus and disconnects the observer', () => {
  freshState()
  install()
  armWithModal()
  assert.notEqual(currentFocus(), state.protoFocus)
  assert.equal(typeof lastEffectDisposer, 'function', 'installMobileEffect must expose a disposer')
  lastEffectDisposer?.()
  assert.equal(currentFocus(), state.protoFocus, 'dispose must disarm')
  assert.equal(state.disconnected, true, 'dispose must disconnect the observer')
})

test('the observer watches document.body childList only (no subtree)', () => {
  freshState()
  install()
  assert.deepEqual(state.opts, { childList: true }, 'a subtree observer would run on every app mutation')
})

function currentFocus(): unknown {
  return (FakeInputElement.prototype as unknown as { focus: unknown }).focus
}
