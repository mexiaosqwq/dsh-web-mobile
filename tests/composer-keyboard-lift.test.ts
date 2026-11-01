// Issue #149: on iOS Safari the composer block sinks ~158px on the first
// keystroke (iPhone 13 Pro: send button 300–331 → 458–470) and the text row
// lands behind the system form-assistant bar (427–471). Root cause (host side,
// unfixed through dsh-client-ui-conversation 0.2.1-alpha.1): the bundled
// Lexical selection-scroll helper compares its window-branch visible band
// [visualViewport.offsetTop, offsetTop + height] — LAYOUT coordinates — with
// the caret's getBoundingClientRect — VISUAL coordinates. The frames only
// agree at window scroll 0 (desktop, Android adjustResize), while the iOS
// keyboard forces a nonzero window scroll (417 = 844 − 427 on the reporter's
// device), so every keystroke fires a bogus negative scrollBy that drops the
// sticky composer seat behind the keyboard.
//
// The plugin-side mitigation (composer-keyboard-lift.ts) pins the seat back
// above the keyboard while the composer holds focus. Design rules pinned by
// these tests:
// ① the overlap is computed from screen-space quantities only — the seat's
//    rect.bottom and visualViewport.height — never layout coordinates
//    (that mixup is the incident itself, so the state carries no such input);
// ② fail open on any suspicion (pinch scale ≠ 1, scroll channels disagreeing
//    beyond tolerance): the known bad status quo beats a fresh mis-lift;
// ③ a rect includes our own transform, so the adapter adds the applied lift
//    back before the comparison — otherwise the fixed point oscillates.
// The iOS active path is unverifiable headless (detectIosWebKit is false in
// chromium, pitfalls §键盘 guard); behaviour acceptance is real-device.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHANNEL_TOLERANCE_PX, computeComposerLift } from '../src/client/effects/composer-keyboard-lift.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIFT = readFileSync(join(ROOT, 'src/client/effects/composer-keyboard-lift.ts'), 'utf8')
const INDEX = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

// Reporter measurements (iPhone 13 Pro, 390×844 css, keyboard+assistant top 427):
// at focus the seat bottom is flush with the keyboard (iOS scrolled to 417);
// after the helper's first keystroke it sits at 585 (= 427 + 158).
const KEYBOARD_TOP = 427
const FOCUSED = { seatBottom: 427, viewportHeight: KEYBOARD_TOP, scale: 1, scrollY: 417, offsetTop: 417 }
const MISFIRED = { seatBottom: 585, viewportHeight: KEYBOARD_TOP, scale: 1, scrollY: 259, offsetTop: 259 }

test('the reporter geometry: no lift while flush, 158px lift after the helper misfires', () => {
  assert.equal(computeComposerLift(FOCUSED), 0)
  assert.equal(computeComposerLift(MISFIRED), 158)
})

test('the overlap half decides everything: positive lifts, zero and negative rest', () => {
  assert.equal(computeComposerLift({ ...MISFIRED, seatBottom: 440 }), 13)
  assert.equal(computeComposerLift({ ...MISFIRED, seatBottom: 300 }), 0)
  assert.equal(computeComposerLift({ ...MISFIRED, seatBottom: -200 }), 0)
})

test('pinch zoom fails open: the screen-space mapping is only trusted at scale 1', () => {
  assert.equal(computeComposerLift({ ...MISFIRED, scale: 1.4 }), 0)
})

test('scroll-channel disagreement fails open: the layout-coordinate model is unverified', () => {
  // A visual-viewport pan (pinch pan, or an engine switching its keyboard
  // scroll model) separates offsetTop from scrollY; then rect.bottom is no
  // longer a screen position and lifting from it would double-shift.
  assert.equal(computeComposerLift({ ...MISFIRED, offsetTop: 300 }), 0)
  // The documented tolerance is inclusive: exactly CHANNEL_TOLERANCE_PX
  // drift is still trusted, one px more bails.
  assert.equal(computeComposerLift({ ...MISFIRED, seatBottom: 440, offsetTop: 259 + CHANNEL_TOLERANCE_PX }), 13)
  assert.equal(computeComposerLift({ ...MISFIRED, seatBottom: 440, offsetTop: 259 + CHANNEL_TOLERANCE_PX + 1 }), 0)
  // Within tolerance the rounding/event-order drift is still trusted. The
  // channels are the focused-state pair (417 vs 400, 17px apart) — MISFIRED's
  // own 259/259 pair would not distinguish tolerance from bail.
  assert.equal(computeComposerLift({ ...MISFIRED, seatBottom: 440, scrollY: 417, offsetTop: 400 }), 13)
})

test('garbage readings rest at zero', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(computeComposerLift({ ...MISFIRED, seatBottom: bad }), 0)
    assert.equal(computeComposerLift({ ...MISFIRED, viewportHeight: bad }), 0)
    assert.equal(computeComposerLift({ ...MISFIRED, scale: bad }), 0)
    assert.equal(computeComposerLift({ ...MISFIRED, scrollY: bad }), 0)
    assert.equal(computeComposerLift({ ...MISFIRED, offsetTop: bad }), 0)
  }
})

test('the effect is iOS-gated, focus-scoped, seat-anchored and restores on release', () => {
  assert.match(LIFT, /detectIosWebKit\(/)
  assert.match(LIFT, /addEventListener\('focusin'/)
  assert.match(LIFT, /addEventListener\('focusout'/)
  assert.match(LIFT, /\[data-composer-input\]/)
  assert.match(LIFT, /\[data-mobile-nav="frame"\] \[class\*="_composerSeat"\]/)
  assert.match(LIFT, /translateY\(/)
  // The rect includes the applied transform: the adapter must add it back.
  assert.match(LIFT, /\.bottom \+ appliedLift/)
  // Arm-clear and teardown both restore the inline transform.
  assert.match(LIFT, /style\.transform = ''/)
})

test('the installer is registered next to the composer guards', () => {
  assert.match(INDEX, /import \{ installComposerKeyboardLift \} from '\.\/effects\/composer-keyboard-lift\.ts'/)
  // 2026-10-31：武装被撤（实现原样保留，见 index.tsx 的注释），所以这里钉的是
  // 「不再调用」，而不是「必须调用」。
  assert.doesNotMatch(INDEX, /^\s*installComposerKeyboardLift\(ctx\)$/m)
})
