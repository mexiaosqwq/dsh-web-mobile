// 2026-11-05 owner report: 「随便一个返回就会唤起输入法」. Host flows focus text
// fields programmatically (mount autoFocus, returning from a subpage, tab
// switches). focus-gesture-guard blocks those unless the user's own finger
// landed on the field; non-text targets (menus, dialogs, buttons) stay untouched
// so host focus management and screen readers keep working.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTextEntry, shouldBlockProgrammaticFocus } from '../src/client/effects/focus-gesture-guard.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/focus-gesture-guard.ts'), 'utf8')
const ENTRY = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

/** 一个满足 isTextEntry 判定所需的最小假元素。 */
function fake(tag: string, extra: Record<string, unknown> = {}) {
  return {
    tagName: tag,
    type: 'text',
    getAttribute: () => null,
    contains: () => false,
    ...extra,
  } as unknown as Element
}

test('text inputs, textareas and contenteditable count as text-entry surfaces', () => {
  assert.equal(isTextEntry(fake('INPUT')), true)
  assert.equal(isTextEntry(fake('INPUT', { type: 'search' })), true)
  assert.equal(isTextEntry(fake('INPUT', { type: 'checkbox' })), false)
  assert.equal(isTextEntry(fake('INPUT', { type: 'file' })), false)
  assert.equal(isTextEntry(fake('TEXTAREA')), true)
  assert.equal(isTextEntry(fake('DIV', { getAttribute: () => '' })), true)
  assert.equal(isTextEntry(fake('DIV', { getAttribute: () => 'false' })), false)
  assert.equal(isTextEntry(fake('DIV', { getAttribute: () => null })), false)
  assert.equal(isTextEntry(null), false)
})

test('a programmatic focus without any gesture is blocked', () => {
  assert.equal(shouldBlockProgrammaticFocus(fake('INPUT'), null, Number.POSITIVE_INFINITY), true)
})

test('a stale gesture is blocked, a fresh one on the field is allowed', () => {
  const field = fake('INPUT')
  assert.equal(shouldBlockProgrammaticFocus(field, field, 500), false)
  assert.equal(shouldBlockProgrammaticFocus(field, field, 5000), true)
})

test('a tap inside the field (or on its wrapper) counts; a tap elsewhere does not', () => {
  const inner = fake('SPAN')
  const field = fake('INPUT', {
    contains: (node: unknown) => node === inner,
  })
  const wrapper = fake('LABEL', {
    contains: (node: unknown) => node === field || node === inner,
  })
  const elsewhere = fake('BUTTON')
  assert.equal(shouldBlockProgrammaticFocus(field, inner, 100), false)
  assert.equal(shouldBlockProgrammaticFocus(field, wrapper, 100), false, 'wrapper 包含输入框')
  assert.equal(shouldBlockProgrammaticFocus(field, elsewhere, 100), true, '点在别处不许弹键盘')
})

test('non-text targets are never blocked', () => {
  const dialog = fake('DIV', { getAttribute: () => 'false' })
  assert.equal(shouldBlockProgrammaticFocus(dialog, null, Number.POSITIVE_INFINITY), false)
  assert.equal(shouldBlockProgrammaticFocus(fake('BUTTON'), null, Number.POSITIVE_INFINITY), false)
})

test('the guard patches every focus prototype and is armed from the entry', () => {
  assert.match(SRC, /installMobileEffect\(ctx,/)
  assert.match(SRC, /globalThis\.HTMLElement/)
  assert.match(SRC, /HTMLInputElement\.prototype/)
  assert.match(SRC, /HTMLTextAreaElement\.prototype/)
  assert.match(ENTRY, /installFocusGestureGuard\(ctx\)/)
})
