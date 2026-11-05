// Platform layer: the one "the drawer is about to open" entry every opener shares.
//
// Why it lives here and not in an effect: the openers are drawer-close.ts
// (toggleDrawer: header toggle, FAB) and sidebar-swipe.ts (the gesture's arm
// step). Sharing it through either effect would add an effects → effects edge
// (the architecture ledger only shrinks), so it sits on platform/.
//
// Job (2026-11-05 drawer-jank report, R2):
// Release text focus before the host opens the drawer. The host's
//    useModalLayer moves focus into the drawer from a layout effect
//    (dsh-client-ui-primitives lib/index.js:1683). With the composer focused,
//    that focus move closes the soft keyboard WHILE the slide runs, the visual
//    viewport grows mid-transition, viewport-meta republishes
//    --dsha-mobile-visible-vh and the whole shell re-lays out under the moving
//    drawer. Tap openers blur first and open once the keyboard has gone; the
//    gesture opener blurs at arm time without waiting (the finger is moving).

/** Text-entry surfaces whose focus keeps a soft keyboard up. */
const TEXT_ENTRY_SELECTOR =
  '[contenteditable]:not([contenteditable="false"]), textarea, ' +
  'input:not([type]), input[type="text"], input[type="search"], input[type="email"], ' +
  'input[type="url"], input[type="tel"], input[type="password"], input[type="number"]'

/** Keyboard at least this tall counts as up (same threshold as composer-keyboard-guard.ts). */
const KEYBOARD_MIN_PX = 120

/** Quiet time after the last viewport resize, once the keyboard reads down, before opening. */
const KEYBOARD_SETTLE_MS = 60

/** Hard cap on the wait: an engine that never resizes must not hold the drawer back. */
const KEYBOARD_WAIT_CAP_MS = 450

/**
 * The one piece of module state: the pending deferred open. A const object
 * (not a `let`), so this file adds no entry to the architecture ledger's
 * module-state table.
 */
const state: { cancelPending: (() => void) | null } = {
  cancelPending: null,
}

/**
 * Whether the soft keyboard is up: the keyboard-less height viewport-meta keeps
 * in --dsh-web-mobile-vh (falls back to innerHeight) against the visual
 * viewport height.
 */
export function softKeyboardUp(): boolean {
  const stable = Number.parseFloat(document.documentElement.style.getPropertyValue('--dsh-web-mobile-vh'))
  const base = Number.isFinite(stable) && stable > 0 ? stable : window.innerHeight
  const visible = window.visualViewport?.height ?? window.innerHeight
  return base - visible > KEYBOARD_MIN_PX
}

/**
 * Blur the focused text-entry element, if any.
 * @returns true when focus was released AND the soft keyboard was up at that moment.
 */
export function releaseTextFocus(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.matches(TEXT_ENTRY_SELECTOR)) return false
  const keyboardWasUp = softKeyboardUp()
  active.blur()
  return keyboardWasUp
}

/**
 * Tap-opener entry: release text focus, then open — immediately when no
 * keyboard was up, otherwise once the keyboard has gone (it reads down and the
 * viewport has been quiet for KEYBOARD_SETTLE_MS) or after KEYBOARD_WAIT_CAP_MS.
 * A second call while an open is pending cancels it (the user tapped the toggle
 * again) and does nothing else.
 * @param open - flips the host state.
 */
export function openDrawerAfterKeyboard(open: () => void): void {
  if (state.cancelPending !== null) {
    state.cancelPending()
    return
  }
  if (!releaseTextFocus()) {
    open()
    return
  }
  let quietTimer = 0
  const onResize = (): void => {
    window.clearTimeout(quietTimer)
    if (!softKeyboardUp()) quietTimer = window.setTimeout(finish, KEYBOARD_SETTLE_MS)
  }
  const cancel = (): void => {
    window.clearTimeout(quietTimer)
    window.clearTimeout(capTimer)
    window.visualViewport?.removeEventListener('resize', onResize)
    window.removeEventListener('resize', onResize)
    state.cancelPending = null
  }
  const finish = (): void => {
    cancel()
    open()
  }
  const capTimer = window.setTimeout(finish, KEYBOARD_WAIT_CAP_MS)
  state.cancelPending = cancel
  window.visualViewport?.addEventListener('resize', onResize)
  window.addEventListener('resize', onResize)
}
