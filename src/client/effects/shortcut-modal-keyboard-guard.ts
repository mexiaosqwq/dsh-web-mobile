import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from '../platform/breakpoints.ts'
import { shadowFocus } from '../core/prototype-focus-shadow.ts'

const AUTOFOCUS_FIELD = '[data-shortcut-modal="shortcuts"] [data-modal-autofocus]'

/** DSHA: suppress only the first automatic focus, retaining user search access. */
export function installShortcutModalKeyboardGuard(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: shortcut modal keyboard guard', () => {
    const initialized = new WeakSet(document.querySelectorAll(AUTOFOCUS_FIELD))
    const pending = new WeakSet<HTMLInputElement>()
    const release = shadowFocus(element => {
      if (element.matches(AUTOFOCUS_FIELD)) {
        if (!initialized.has(element) && element.hasAttribute('data-dsh-automatic-focus')) {
          if (!pending.has(element)) {
            pending.add(element)
            Promise.resolve().then(() => initialized.add(element))
            const dialog = element.closest<HTMLElement>('[role="dialog"][aria-modal="true"]')
            if (dialog !== null && !dialog.contains(document.activeElement)) {
              dialog.focus({ preventScroll: true })
            }
          }
          return true
        }
        initialized.add(element)
      }
      return false
    })
    return () => release()
  })
}
