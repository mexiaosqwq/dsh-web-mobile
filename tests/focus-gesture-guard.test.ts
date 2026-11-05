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

// 真机 2026-11-05（返回会话时输入法自己弹起）：那颗输入框在打开面板前拿过焦点，
// 面板撤掉时 WebView 直接把键盘还给「已聚焦的可编辑面」——不经过任何 JS focus()，
// 拦不到。所以按在输入面之外时要主动 blur，让「已聚焦」这件事本身不存在。
test('the guard blurs the active text entry when the finger lands elsewhere', () => {
  assert.match(SRC, /const blurUnfocusedTap = \(target: Element\): void => \{/)
  assert.match(SRC, /blurUnfocusedTap\(target\)/)
  assert.match(SRC, /\(active as HTMLElement\)\.blur\(\)/)
})

// 真机第二次取证：返回会话时键盘仍弹起。除 JS focus() 外还有引擎自己的「焦点还原」
// （面板移除时把焦点还给上一个聚焦过的可编辑面），那条路径不调 focus()，只能在
// focusin 这个共同出口上复核并当场收掉。
test('every focus is re-checked on focusin, so engine-side restores are dropped too', () => {
  assert.match(SRC, /document\.addEventListener\('focusin', onFocusIn, true\)/)
  assert.match(SRC, /document\.removeEventListener\('focusin', onFocusIn, true\)/)
  assert.match(SRC, /if \(isAllowed\(target\)\) return/)
})

// 真机 2026-11-05：「点发送，键盘退下去了但消息没发出去，要再点一次」——按下时收掉
// 焦点，这一次 tap 被 Android 当成「关键盘」吃掉，click 不再派发。卡内按钮放行。
test('a press inside the composer card does not drop the caret (send must fire on one tap)', () => {
  assert.match(SRC, /const COMPOSER_CARD_SELECTOR = '\[data-composer-card\]'/)
  assert.match(SRC, /if \(target\.closest\(COMPOSER_CARD_SELECTOR\) !== null\) return/)
})
