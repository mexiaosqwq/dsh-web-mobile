import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * Mobile guard: the keyboard-shortcut modal must not raise the soft keyboard
 * by itself.
 *
 * `dsh-client-ui-shortcuts` renders its search field with the host marker
 * `data-modal-autofocus` (`<input data-modal-autofocus …/>`), and the
 * primitives Modal focuses that field when the modal mounts. On desktop that
 * is the right default. On a phone it costs the user half the screen the
 * moment the sheet opens — the page is a shortcut EDITOR and the search box is
 * its secondary affordance — and it also makes the sheet jump, because the
 * modal is sized by `100dvh`: the keyboard shrinking the viewport resizes it
 * (measured 2026-09-25: `dvh` 844 → 520 takes the dialog from 600px to 496px,
 * i.e. the card snaps right after it appears; on the host's centered card the
 * same change moved the top edge 152 → 84, the earlier 「抽搐」 report).
 *
 * Why not the own-property shadow `composer-keyboard-guard.ts` uses: that
 * focus happens during React's COMMIT (the Modal's layout-effect path), which
 * is still inside the task that inserted the node. A MutationObserver callback
 * is a microtask and therefore runs AFTER it — measured: with the own no-op
 * `focus` already installed on the field, `document.activeElement` was still
 * the field. So the guard has to be in place BEFORE the modal is inserted,
 * which leaves exactly one synchronous hook: the method itself. While either
 * modal of this family is in the DOM we shadow `HTMLInputElement.prototype.focus`
 * and no-op it for the shortcut modal's autofocus field; the shadow is removed
 * as soon as neither modal is present (and on dispose), so nothing outlives the
 * user's visit to that sheet.
 *
 * A TAP is unaffected: the browser focuses natively, and the shadow only
 * replaces the JS method. Search therefore stays one tap away, and the shadow
 * also stops the host's `modifiedCount`-driven re-focus from pulling the caret
 * out of a field the user is already using.
 *
 * DOM contract (verified against 0.1.7-rc.2):
 * - `[data-shortcut-modal="settings"]` — the settings sheet (the only opener).
 * - `[data-shortcut-modal="shortcuts"]` — the shortcut modal.
 * - `[data-modal-autofocus]` — the field the Modal focuses on mount.
 * Re-audit all three when the host or dsh-client-ui-shortcuts upgrades.
 */
const SETTINGS_MODAL = '[data-shortcut-modal="settings"]'
const SHORTCUT_MODAL = '[data-shortcut-modal="shortcuts"]'
/** The field the Modal's mount-time focus must not reach, on phones only. */
const AUTOFOCUS_FIELD = SHORTCUT_MODAL + ' [data-modal-autofocus]'

/**
 * Keep the shortcut modal's search field from grabbing focus (and the soft
 * keyboard) by itself, on the mobile breakpoint only.
 * @param ctx - client root context.
 */
export function installShortcutModalKeyboardGuard(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: shortcut modal keyboard guard', () => {
    const proto = HTMLInputElement.prototype
    // Captured once per arming so restore always puts the real method back.
    let original: ((this: HTMLInputElement, options?: FocusOptions) => void) | null = null

    const arm = (): void => {
      if (original !== null) return
      const previous = proto.focus
      original = previous
      proto.focus = function focus(this: HTMLInputElement, options?: FocusOptions): void {
        if (this.matches(AUTOFOCUS_FIELD)) return
        previous.call(this, options)
      }
    }

    const disarm = (): void => {
      if (original === null) return
      proto.focus = original
      original = null
    }

    const sync = (): void => {
      const present =
        document.querySelector(SETTINGS_MODAL) !== null ||
        document.querySelector(SHORTCUT_MODAL) !== null
      if (present) arm()
      else disarm()
    }

    // childList only (no subtree): both modal roots are portaled to body as
    // direct children, and a subtree observer would run on every mutation the
    // app makes. The settings sheet is present before the shortcut modal mounts,
    // so the shadow is already installed when the Modal focuses its field.
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true })
    sync()

    return () => {
      observer.disconnect()
      disarm()
    }
  })
}
