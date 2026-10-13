// Selection chrome: while a non-collapsed selection lives in the conversation the
// header drops out of the hit test, so the native handle drag keeps its extent
// local instead of teleporting the viewport to the flow's first item.
//
// 2026-10-12 P1 拆分第三片：由 effects/phone-chrome.ts 逐字搬出（纯搬运，不改行为）。
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from '../platform/breakpoints.ts'

/**
 * Marker set on <html> while a non-collapsed text selection lives in the
 * conversation. CSS uses it to drop the header out of the hit test (see
 * layout.css.ts "selection handle drag: keep the extent local"):
 * the native Android handle drag resolves the selection extent by hit-testing
 * the handle position, and an unselectable bar sitting there makes Blink walk
 * FORWARD in DOM order to the first selectable node - measured on the live host
 * as the flow's very first item (the "Load earlier" gate) - which the browser
 * then reveals, so the viewport teleports to the top of the conversation instead
 * of extending the selection by a line. Drop the bar out of the hit test and the
 * same point resolves to the message the lifted scroll box now puts there.
 */
const SELECTING_ATTR = 'data-mobile-nav-selecting'

/** True while the document selection is a non-collapsed range inside the
 *  conversation (composer / drawer selections do not count - they must keep
 *  their own chrome interactive). Cheap by design: no layout reads, because
 *  selectionchange fires on every handle move. */
function selectionLivesInConversation(): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed) return false
  const node = selection.anchorNode
  if (node === null) return false
  const element = node instanceof HTMLElement ? node : node.parentElement
  if (element === null) return false
  if (element.closest('[data-composer-card]') !== null) return false
  return element.closest('[data-phase]') !== null
}

/** Toggle the selection marker for the duration of a conversation selection. */
export function installSelectionChromeYield(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: selection chrome yield', () => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    const sync = (): void => {
      const wanted = selectionLivesInConversation()
      if (wanted === root.hasAttribute(SELECTING_ATTR)) return
      if (wanted) root.setAttribute(SELECTING_ATTR, '')
      else root.removeAttribute(SELECTING_ATTR)
    }
    document.addEventListener('selectionchange', sync)
    sync()
    return () => {
      document.removeEventListener('selectionchange', sync)
      root.removeAttribute(SELECTING_ATTR)
    }
  })
}
