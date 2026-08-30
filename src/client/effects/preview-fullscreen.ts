import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { getFrame } from './phone-chrome.ts'

export function createPreviewFullscreenTask(t: TranslateNS<'mobileNav'>): ReconcilerTask {
  let button: HTMLButtonElement | null = null
  const syncLabel = (target: HTMLButtonElement): void => {
    const full = getFrame()?.hasAttribute('data-mobile-preview-full') ?? false
    const label = t(full ? 'previewExitFullscreen' : 'previewFullscreen')
    if (target.getAttribute('aria-label') === label) return
    target.setAttribute('aria-label', label)
    target.title = label
  }
  const onClick = (): void => {
    getFrame()?.toggleAttribute('data-mobile-preview-full')
    if (button !== null) syncLabel(button)
  }
  return {
    name: 'preview-fullscreen-toggle',
    scopes: ['data-aionui-preview-open', 'data-mobile-preview-full'],
    ensure: () => {
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
