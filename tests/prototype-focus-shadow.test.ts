// Issue #84: two mobile guards shadowed `HTMLInputElement.prototype.focus` with
// their own save/restore, so the interleaving arm A → arm B → disarm A →
// disarm B wrote A's STALE wrapper back to the prototype (both guards' saved
// "originals" were null by then) and no rule was left managing it. The shared
// manager in core/prototype-focus-shadow.ts owns the one patch and restores the
// real method only when the last predicate is gone.
//
// The manager is DOM-agnostic, so this runs for real in Node: a fake
// HTMLInputElement is installed before the module is imported, and the
// assertions observe which elements actually reached the real focus().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const calls: string[] = []

class FakeInput {
  readonly id: string
  constructor(id: string) {
    this.id = id
  }
  matches(selector: string): boolean {
    return selector === 'model-searchbox' && this.id === 'search'
  }
}

const REAL = function realFocus(this: FakeInput): void {
  calls.push(this.id)
}
;(FakeInput.prototype as unknown as { focus: (options?: FocusOptions) => void }).focus = REAL
;(globalThis as unknown as { HTMLInputElement: unknown }).HTMLInputElement = FakeInput

const { shadowFocus } = await import('../src/client/core/prototype-focus-shadow.ts')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_GUARD = readFileSync(join(ROOT, 'src/client/effects/model-menu-keyboard-guard.ts'), 'utf8')
const SHORTCUT_GUARD = readFileSync(join(ROOT, 'src/client/effects/shortcut-modal-keyboard-guard.ts'), 'utf8')

const focusOf = (id: string): void => {
  const element = new FakeInput(id)
  ;(element as unknown as HTMLInputElement).focus()
}

test('two predicates coexist, and the real method returns after the last one leaves', () => {
  const before = (FakeInput.prototype as unknown as { focus: unknown }).focus
  calls.length = 0
  const releaseA = shadowFocus((element) => element.matches('model-searchbox'))
  const releaseB = shadowFocus(() => false)

  focusOf('search')
  assert.deepEqual(calls, [], "A's predicate swallows the model search box")
  focusOf('other')
  assert.deepEqual(calls, ['other'], "B's predicate lets everything through")

  // Disarming A must NOT restore the prototype: B is still armed.
  releaseA()
  focusOf('search')
  assert.deepEqual(calls, ['other', 'search'], 'B keeps the patch alive after A leaves')

  releaseB()
  assert.equal((FakeInput.prototype as unknown as { focus: unknown }).focus, before, 'the exact original method is back')
  focusOf('search')
  assert.deepEqual(calls, ['other', 'search', 'search'], 'nothing is swallowed once every guard is gone')
})

test('the stale-wrapper interleaving leaves the real method installed', () => {
  calls.length = 0
  const releaseShortcut = shadowFocus((element) => element.matches('shortcut-autofocus'))
  const releaseModel = shadowFocus((element) => element.matches('model-searchbox'))
  releaseShortcut()
  releaseModel()
  focusOf('search')
  focusOf('other')
  assert.deepEqual(calls, ['search', 'other'], 'both guards unloaded ⇒ plain native focus')
  assert.equal((FakeInput.prototype as unknown as { focus: unknown }).focus, REAL, 'the stale wrapper never survives')
})

test('the two keyboard guards both delegate to the shared manager', () => {
  for (const source of [MODEL_GUARD, SHORTCUT_GUARD]) {
    assert.match(source, /import \{ shadowFocus \} from '\.\.\/core\/prototype-focus-shadow\.ts'/)
    assert.match(source, /release = shadowFocus\(/)
    // Neither guard writes the prototype itself any more (comments may still
    // name it — check the assignments).
    assert.doesNotMatch(source, /HTMLInputElement\.prototype\.focus\s*=/)
    assert.doesNotMatch(source, /proto\.focus =/)
  }
  // Each keeps its own field predicate — the manager must not merge them.
  assert.match(MODEL_GUARD, /element\.matches\(MODEL_SEARCHBOX\)/)
  assert.match(SHORTCUT_GUARD, /element\.matches\(AUTOFOCUS_FIELD\)/)
})
