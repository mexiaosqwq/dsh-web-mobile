// Drawer brand-row swipe-gesture toggle (issue #297, 2026-11-15).
//
// The reporter asked for a way to switch the sidebar swipe gestures off after
// a scrolling flick pulled the drawer out. The two gesture bugs are fixed in
// sidebar-swipe.ts; this module is the user-facing switch itself. It follows
// the same injection shape as drawer-session-log.ts: a plugin-owned button in
// the host's logo row, wrapped in a <span> because the third-party
// dsh-web-all responsive layer adopts that row's LAST direct <button> as its
// sidebar toggle and would otherwise click our control on an outside tap.
//
// The preference lives in localStorage and is read on EVERY pointerdown by
// beginStroke(), so switching takes effect without a reload. Default is ON:
// an absent or unreadable value must never change existing behaviour.
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { NS } from '../i18n/locales.ts'
import { getFrame } from '../platform/frame.ts'

const STORAGE_KEY = 'dsh-web-mobile:gestures'

/** Read the preference. Fail-open: a blocked/corrupt store means gestures ON. */
export function gesturesEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Persist the preference. A blocked store degrades to this session only. */
export function setGesturesEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, 'off')
  } catch {
    // Storage blocked (private mode / sandbox): fail-open, no persistence.
    // The next sync() reads gestures ON again, so the tap simply does not
    // stick — an honest fallback instead of a pretend in-memory preference.
  }
}

/** 16px edge-swipe glyph: a screen edge with a horizontal two-way arrow. */
const GESTURE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
  + '<path d="M1.6 2.6v10.8" stroke="currentColor" stroke-width="1" opacity=".55"/>'
  + '<path d="M4 8h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
  + '<path d="M6.4 5.6 4 8l2.4 2.4M10.6 5.6 13 8l-2.4 2.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'
  + '</svg>'

/**
 * The drawer's brand-row gesture switch. `scopes: ['*']` because React may
 * recreate the logo row on any sidebar re-render; `ensure()` re-appends the
 * wrapper idempotently and re-reads the preference, so the button never shows
 * a stale state after another part of the UI writes the same key.
 *
 * @param t - our dictionary (the `NS` locale namespace).
 * @returns the reconciler task.
 */
export function createGestureToggleTask(t: TranslateNS<typeof NS>): ReconcilerTask {
  let wrapper: HTMLSpanElement | null = null
  let button: HTMLButtonElement | null = null

  const logoRow = (): HTMLElement | null => {
    const frame = getFrame()
    if (frame === null) return null
    return frame.querySelector<HTMLElement>('[class*="sidebarCol"] [class*="logoRow"]')
      ?? frame.querySelector<HTMLElement>('[class*="logoRow"]')
  }

  /** Publish the current preference onto the button's a11y + visual state. */
  const sync = (): void => {
    if (button === null) return
    const on = gesturesEnabled()
    button.setAttribute('aria-pressed', String(on))
    button.dataset.state = on ? 'on' : 'off'
    const label = on ? t('gestureToggleOn') : t('gestureToggleOff')
    button.setAttribute('aria-label', label)
    button.title = label
  }

  return {
    name: 'gesture-toggle',
    scopes: ['*'],
    ensure: () => {
      const row = logoRow()
      if (row === null) return
      if (button === null) {
        wrapper = document.createElement('span')
        wrapper.dataset.mobileNav = 'gesture-toggle-wrap'
        button = document.createElement('button')
        button.type = 'button'
        button.dataset.mobileNav = 'gesture-toggle'
        button.innerHTML = GESTURE_SVG
        button.addEventListener('click', () => {
          setGesturesEnabled(!gesturesEnabled())
          sync()
        })
        wrapper.appendChild(button)
      }
      // Nested, never a direct row child (see the module header).
      if (wrapper !== null && wrapper.parentElement !== row) row.appendChild(wrapper)
      sync()
    },
    dispose: () => {
      wrapper?.remove()
      wrapper = null
      button = null
    },
  }
}
