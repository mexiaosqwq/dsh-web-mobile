// Owner report 2026-10-07 (screenshot): opening the model / reasoning-level menu
// raised the soft keyboard over the list the user had just opened. Root cause is
// host-side: `dsh-client-ui-model-selection` drills into the model pane and
// focuses its 「搜索模型…」 field from a PASSIVE effect
// (lib/client.js:29497), so the keyboard comes up uninvited.
//
// The guard mirrors shortcut-modal-keyboard-guard.ts: it shadows
// `HTMLInputElement.prototype.focus` and no-ops it for that one field, armed
// from the capture-phase pointerdown that precedes the pane switch (the last
// deterministic moment before the host's effect runs). A real tap on the field
// still focuses it natively, so searching remains one deliberate tap away.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/model-menu-keyboard-guard.ts'), 'utf8')
const ENTRY = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

test('the shadow swallows exactly the model pane search field', () => {
  assert.match(SRC, /const MODEL_SEARCHBOX =/)
  // Scoped two ways: inside a host menu surface, or carrying the model list's
  // own `-models` control. Neither the shortcut modal's field nor a settings
  // input may match.
  assert.match(SRC, /\[data-menu-material\] input\[role="searchbox"\]/)
  assert.match(SRC, /input\[role="searchbox"\]\[aria-controls\$="-models"\]/)
  assert.match(SRC, /if \(this\.matches\(MODEL_SEARCHBOX\)\) return/)
  // A tap must keep working: only the JS method is replaced, not native focus.
  assert.match(SRC, /previous\.call\(this, options\)/)
})

test('the shadow is armed before the host effect can focus, and given back after', () => {
  // A capture-phase pointerdown is strictly earlier than the drill-in passive
  // effect, which is exactly why this technique is used instead of an observer.
  assert.match(SRC, /document\.addEventListener\('pointerdown', onPointerDown, true\)/)
  assert.match(SRC, /document\.removeEventListener\('pointerdown', onPointerDown, true\)/)
  assert.match(SRC, /installMobileEffect\(ctx, 'dsh-web-mobile: model menu keyboard guard'/)
  // Bounded lifetime: an idle check gives the prototype back only once no host
  // menu is in the DOM, and disposal always restores it.
  assert.match(SRC, /const IDLE_DISARM_MS = 2_000/)
  assert.match(SRC, /document\.querySelector\(HOST_MENU\) === null\) disarm\(\)/)
  assert.match(SRC, /window\.clearTimeout\(idleTimer\)\n      disarm\(\)/)
  // No MutationObserver: the session streams text, so a subtree observer would
  // run on every frame (same cost reasoning as model-menu-anchor.ts).
  assert.doesNotMatch(SRC, /new MutationObserver/)
})

test('the client entry installs the guard', () => {
  assert.match(ENTRY, /import \{ installModelMenuKeyboardGuard \} from '\.\/effects\/model-menu-keyboard-guard\.ts'/)
  assert.match(ENTRY, /installModelMenuKeyboardGuard\(ctx\)/)
})
