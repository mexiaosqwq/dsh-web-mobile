import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { NS } from '../i18n/locales.ts'
import { getFrame } from '../platform/frame.ts'

export function createPreviewFullscreenTask(t: TranslateNS<typeof NS>): ReconcilerTask {
  let button: HTMLButtonElement | null = null
  // Mobile keeps the marker on the marked frame so the mobile CSS can find it.
  // Tablet landscape has no marked frame (host desktop layout), so the marker
  // falls back to <html>; both the label and the click must read the same
  // owner. Note getFrame() also falls back to the raw shell frame without the
  // marker, so test the marker itself instead of `getFrame() === null`.
  const owner = (): HTMLElement => {
    const frame = getFrame()
    return frame !== null && frame.getAttribute('data-mobile-nav') === 'frame'
      ? frame
      : document.documentElement
  }
  // Preview is open when either the mobile frame or the tablet <html> marker
  // is present. The task is armed at every width, so this gates the button
  // instead of relying on a breakpoint-specific observer.
  const isOpen = (): boolean => {
    if (getFrame()?.hasAttribute('data-aionui-preview-open') === true) return true
    return document.documentElement.hasAttribute('data-aionui-preview-open')
  }
  const syncLabel = (target: HTMLButtonElement): void => {
    const full = owner().hasAttribute('data-mobile-preview-full')
    const label = t(full ? 'previewExitFullscreen' : 'previewFullscreen')
    if (target.getAttribute('aria-label') === label) return
    target.setAttribute('aria-label', label)
    target.title = label
  }
  const onClick = (): void => {
    owner().toggleAttribute('data-mobile-preview-full')
    if (button !== null) syncLabel(button)
  }
  return {
    name: 'preview-fullscreen-toggle',
    // `pointer: coarse` keeps the button off desktop, where there is no mobile
    // frame and no reason to offer this control. The open marker wakes the
    // task on tablet, where the host has no frame to carry it.
    scopes: ['data-aionui-preview-open', 'data-mobile-preview-full'],
    ensure: () => {
      if (!window.matchMedia('(pointer: coarse)').matches) {
        button?.remove()
        button = null
        return
      }
      if (!isOpen()) {
        button?.remove()
        button = null
        return
      }
      const col = document.querySelector('[data-aionui-preview-col]')
      if (col === null) return
      if (button === null) {
        button = document.createElement('button')
        button.type = 'button'
        button.dataset.mobileNav = 'preview-full-toggle'
        button.innerHTML = [
          '<svg class="dsh-web-mobile-full-in" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
          '<path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
          '</svg>',
          '<svg class="dsh-web-mobile-full-out" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
          '<path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
          '</svg>',
        ].join('')
        button.addEventListener('click', onClick)
      }
      syncLabel(button)
      if (button.parentElement !== col) col.appendChild(button)
    },
    dispose: () => {
      button?.remove()
      button = null
    },
  }
}
