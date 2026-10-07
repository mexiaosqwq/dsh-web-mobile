// Composer keyboard guard: keeps a dismissed keyboard down when the composer's
// fixed buttons (send/stop/+) are tapped.
//
// Upstream keepFocus calls editor.focus() on the composer buttons' mousedown,
// which re-raises the on-screen keyboard: on iOS WebKit a programmatic focus
// always re-raises it, and on Android the IME comes back for an editable that
// never lost logical focus (keepFocus preventDefaults the blur) the moment a
// real gesture arrives. The guard shadows the editor element's own `focus`
// property while a tap is in flight, then restores it.
//
// Scope (2026-09-23): both engines, i.e. iOS WebKit **or** `(pointer: coarse)`.
// The original iOS-only gate measured "never fires" on Android — the shop
// device kept re-raising the keyboard on `+` because the guard was not
// installed at all.
//
// The DOM half (capture listeners, closest() scoping) is browser-only; these
// tests audit the source invariants the fix depends on, mirroring how
// ios-zoom-guard.test.ts audits the CSS floor via stylesheet constants.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/client/effects/composer-keyboard-guard.ts', import.meta.url)),
  'utf8',
)

test('guard covers iOS WebKit and coarse pointers via the shared probes', () => {
  assert.match(SOURCE, /detectIosWebKit\(/)
  assert.match(SOURCE, /matchMedia\('\(pointer: coarse\)'\)/)
  // Fine-pointer (desktop) hosts never install the listeners at all.
  assert.match(SOURCE, /if \(!ios && !coarse\) \{/)
  assert.match(SOURCE, /return undefined/)
})

test('guard listens on all three touch entry points in the capture phase', () => {
  // mousedown alone is a no-op on Android WebView: the compatibility mousedown
  // is often swallowed once touchstart's default is prevented (measured
  // 2026-09-23 — the shadow was never installed).
  for (const event of ['pointerdown', 'touchstart', 'mousedown']) {
    assert.match(SOURCE, new RegExp(`addEventListener\\('${event}', onPointerDown, true\\)`))
    assert.match(SOURCE, new RegExp(`removeEventListener\\('${event}', onPointerDown, true\\)`))
  }
})

test('guard scopes the shadow to composer-card taps outside the editor surface', () => {
  assert.match(SOURCE, /\[data-composer-card\]/)
  assert.match(SOURCE, /target\.closest\(COMPOSER_INPUT_SELECTOR\) !== null/)
  // A tap on the editing surface is the user saying "I want to type": the
  // window is disarmed on the spot so the fallback blur cannot eat it.
  assert.match(SOURCE, /\{\s*\n\s*restore\(\)\s*\n\s*return\s*\n\s*\}/)
})

test('only presses on a control inside the card arm the blur window (B2 long-press paste)', () => {
  // Regression pin (2026-10-04): any non-editor press inside the card used to
  // open the 700ms window. A long-press on blank card padding/gap lands its
  // pointerdown on the card while the engine's long-press focuses the editor
  // (~500ms, touch-adjusted) — inside the window — so onFocusIn blurred it and
  // the system menu's Paste went nowhere (headless probe: afterPaste stayed
  // "draft"). Blank presses now take the editor-press path.
  assert.match(SOURCE, /COMPOSER_CONTROL_SELECTOR =\s*\n\s*'button, /)
  assert.match(
    SOURCE,
    /const control = target\.closest\(COMPOSER_CONTROL_SELECTOR\)\s*\n\s*if \(control === null \|\| !card\.contains\(control\)\) \{\s*\n\s*restore\(\)\s*\n\s*return\s*\n\s*\}/,
  )
  // The control gate runs after the editor early-return and before the shadow install.
  const editorGate = SOURCE.indexOf('target.closest(COMPOSER_INPUT_SELECTOR) !== null')
  const controlGate = SOURCE.indexOf('target.closest(COMPOSER_CONTROL_SELECTOR)')
  const install = SOURCE.indexOf("editor.setAttribute(SHADOW_MARKER, '')")
  assert.ok(editorGate > 0 && editorGate < controlGate && controlGate < install)
})

test('shadow restores deterministically and never outlives the tap', () => {
  assert.match(SOURCE, /setTimeout\(restore, 700\)/)
  assert.match(SOURCE, /SHADOW_MARKER = 'data-mobile-nav-focus-shadow'/)
})

test('restoring the shadow also closes the guard window', () => {
  // Regression pin (2026-09-23): restore() used to delete the shadow but leave
  // `shadowTimer` non-zero, and onFocusIn's gate IS `shadowTimer === 0` — so
  // after a single composer-button tap the guard stayed armed forever and every
  // focusin on the editor was blurred synchronously. The shop device could no
  // longer open the keyboard at all ("输入框动不了了"; measured on-device:
  // blurWorked=true focusHeld=false, vv pinned at 754).
  assert.match(SOURCE, /window\.clearTimeout\(shadowTimer\)\s*\n\s*shadowTimer = 0/)
})

test('the focusin fallback is gated by the window and blurs the editor', () => {
  assert.match(SOURCE, /onFocusIn = \(event: Event\): void => \{\s*\n\s*if \(shadowTimer === 0\) return/)
  assert.match(SOURCE, /target\.blur\(\)/)
})

test('disposal restores any live shadow — reloads never leak the no-op', () => {
  // The disposer detaches every listener and then calls restore() unconditionally.
  assert.match(SOURCE, /removeEventListener\('focusin', onFocusIn, true\)\s*\n\s*restore\(\)/)
})

test('the effect is wired into the client entry', () => {
  const entry = readFileSync(
    fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
    'utf8',
  )
  assert.match(entry, /installComposerKeyboardGuard\(ctx\)/)
})

test('a hot swap puts the conversation scroll back where it was (2026-10-07 店主报障)', () => {
  // 宿主热换插件走 client-modules.replace()：tearDown → import → refresh，我们那张
  // <style> 在窗口里整段消失 ⇒ 长会话 content-visibility 估算与布局翻转，Chromium 把
  // 会话滚动区重锚到顶部（店主：「聊到一半突然闪到最上面」）。卸载前记、重挂后回填。
  const source = readFileSync(fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)), 'utf8')
  assert.match(source, /const SWAP_RESTORE_MS = 10_000/, '存档要有保鲜期常量')
  assert.match(source, /function conversationScrollers\(\): HTMLElement\[\] \{\s*return \[\.\.\.document\.querySelectorAll<HTMLElement>\('\[data-mobile-nav="frame"\] \[class\*="scrollBody"\]'\)\]\s*\}/,
    '滚动区取宿主的 _scrollBody（overflow-y:auto 的那个盒子）')
  // 卸载路径：先记位置，再删表（顺序不可换，删完就读不到了）。
  assert.match(source, /return \(\) => \{\s*rememberConversationScroll\(\)\s*tag\.remove\(\)/,
    'disposer 必须先记滚动位置再删样式表')
  assert.match(source, /restoreConversationScroll\(\)\n\s*return \(\) => \{/, 'apply 路径要尝试回位')
  // 只在「被弹到 0」时回填：宿主自己滚到底/滚到新消息时不抢。
  assert.match(source, /element\.scrollTop === 0\) element\.scrollTop = top/, '只回填被弹到顶的那种')
  assert.match(source, /top > 0 && element\.scrollTop === 0/, '没有存档或本来就在顶部时不动作')
})
