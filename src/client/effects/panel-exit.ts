import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { panelSelectorOf } from '../core/layout-compat.ts'
import { getFrame, installMobileEffect } from './phone-chrome.ts'

/**
 * Sidebar panel exit.
 *
 * The host's sidebar panels REPLACE the main area (`ctx.layout.selectPanel(id)`),
 * and the host ships no way back out of one: `PanelRow.onClick` is just
 * `selectPanel(id)` (tapping the already-selected row stays on the panel), and
 * the only caller of `selectPanel(null)` in the whole host is
 * `workspace.replaceMain` — i.e. opening a session. So on a phone, once the
 * drawer row puts you on the plugin-manager page, that page is a dead end
 * unless you already know to open the drawer and pick a session.
 *
 * Three exits, roughly in the order a phone user reaches for them:
 *  1. the system back key / back gesture (popstate) — the returned task
 *  2. tapping the already-selected panel row again — installPanelRowExit
 *  3. the top-left FAB, which reads as 「返回会话」 while a panel owns the main
 *     area — see createOverlayTask in overlay-backdrop-fab.ts
 *
 * All three funnel through the same `exit`, so they cannot drift apart.
 */

/**
 * The host marks the SELECTED sidebar panel row with `aria-current="page"`.
 * Measured on 0.1.6-alpha.2: `null` in the conversation, `"page"` on a panel —
 * the two states are cleanly separable. `panelRow` is a CSS-module fragment
 * (the host class is `hHd-Xa_panelRow`), so it is matched as a substring per
 * the repo's hashed-class convention.
 *
 * Why DOM and not `ctx.layout`: the layout face carries no readable panel id —
 * the selected panel lives on the host's own `PanelInfo` store, which is handed
 * only to the host's components.
 */
const PANEL_ROW_ACTIVE = '[class*="panelRow"][aria-current="page"]'

/**
 * True from the moment an exit starts until React has committed the swap.
 * During that window the panel row STILL carries `aria-current="page"`, but the
 * panel is semantically gone — history bookkeeping must treat it as closed,
 * otherwise it arms a second entry while the first exit is still in flight.
 */
let panelLeaving = false

/** Whether a panel owns the main area (DOM truth, ignoring the exit window). */
export function panelOwnsMainArea(): boolean {
  return document.querySelector(PANEL_ROW_ACTIVE) !== null
}

/** Whether a panel owns the main area, counting the in-flight exit as closed. */
function panelViewOpen(): boolean {
  return !panelLeaving && panelOwnsMainArea()
}

/** Marker set on the frame while the incoming conversation fades in. */
const PANEL_EXIT_ATTR = 'data-mobile-panel-exit'

/** Safety net: clears the marker if the reveal animation never fires. */
const PANEL_EXIT_FALLBACK_MS = 2000

/** The frozen panel snapshot that slides back out (see `exit`). */
const PANEL_GHOST_VALUE = 'panel-ghost'

/**
 * Ghost slide-out length. Must stay in sync with `dsh-web-mobile-panel-ghost-out`
 * in layout.css.ts (same .28s as the drawer's transition); this constant only
 * drives the "animation never fired" cleanup.
 */
const PANEL_GHOST_MS = 280

/**
 * The panel page React swaps into the main area — the very element the enter
 * rule animates (`[class*="_centerCol"] > * > *`). Queried only while a panel
 * row is active, so it can never pick up conversation content.
 */
const PANEL_ELEMENT_SELECTOR = '[data-mobile-nav="frame"] [class*="_centerCol"] > * > *'

/**
 * `ctx.layout.selectPanel` exists on 0.1.6-alpha.2 but NOT on rc.6, whose
 * layout face carries only toggleSidebar/openDetails/closeDetails (the same
 * generation drift `core/sessions-compat.ts` documents). The sidebar panel list
 * is an alpha.2-era surface, so on rc.6 nothing ever arms this feature — but the
 * call is capability-checked rather than assumed, so the plugin stays
 * compile-green against rc.6 typings and goes inert there instead of throwing.
 * The probe itself lives in core/layout-compat.ts so it stays unit-testable.
 */

/** The three exit routes plus the capability gate they all share. */
export interface PanelExit {
  /** Leave the panel (no-op when the host has no panel-selection API). */
  exit: () => void
  /** Whether the host can select a panel at all; false on rc.6. */
  supported: boolean
  /**
   * Whether a panel owns the main area, IGNORING the in-flight exit window.
   * The FAB reads this one: its icon must not flip back to 「打开目录」 halfway
   * through the panel's departure.
   */
  panelOpen: () => boolean
  /** The system-back route, for the shared reconciler. */
  task: ReconcilerTask
}

/**
 * Leave the panel: freeze the panel into a plugin-owned snapshot that slides back
 * out to the side, and let the conversation come back on the SAME tick
 * (2026-10-07: 店主先报「退出像掉帧、直接回聊天界面」，再报「空档有点久了。」)
 *
 * Two earlier shapes and why they failed:
 *  · marker-then-swap only: React unmounts the panel inside that same commit, so
 *    the exit animation painted an empty 0×0 slot — measured frame by frame, the
 *    panel element was already gone on the first frame after the tap;
 *  · animate-the-real-panel-first: the departure became visible, but the
 *    conversation's remount commit (~390ms on a long session) then started 220ms
 *    later — the owner felt exactly that added blank window.
 *
 * Current shape: clone the panel into `[data-mobile-nav="panel-ghost"]` (fixed,
 * pointer-events:none), swap RIGHT AWAY, then slide the clone out over
 * `PANEL_GHOST_MS` (the drawer's .28s). The clone's transform/opacity run on the
 * compositor, so the slide stays smooth while the main thread pays for the
 * conversation remount — no added gap, and the direction matches the drawer the
 * owner asked to copy.
 *
 * @param layout - `ctx.layout`; probed, never assumed.
 * @returns the exit action (idempotent while an exit is in flight, so a double
 *   tap cannot queue two swaps) and the system-back reconciler task.
 */
export function createPanelExit(layout: unknown): PanelExit {
  const selectPanel = panelSelectorOf(layout)
  const supported = selectPanel !== null
  let leaving = false
  let cleanupTimer: number | null = null

  // The reveal animation runs on a descendant of the frame, so listen in the
  // capture phase; that is also the precise end-of-transition signal, which
  // beats guessing a timeout.
  function onAnimationEnd(event: AnimationEvent): void {
    if (event.animationName === 'dsh-mobile-panel-reveal') cleanup()
  }

  function cleanup(): void {
    if (cleanupTimer !== null) {
      window.clearTimeout(cleanupTimer)
      cleanupTimer = null
    }
    const frame = getFrame()
    if (frame !== null) {
      frame.removeEventListener('animationend', onAnimationEnd, true)
      frame.removeAttribute(PANEL_EXIT_ATTR)
    }
    removeGhosts()
    panelLeaving = false
    leaving = false
  }

  /** The panel page element, or null when no panel owns the main area. */
  function panelElement(): HTMLElement | null {
    if (!panelOwnsMainArea()) return null
    const el = document.querySelector(PANEL_ELEMENT_SELECTOR)
    return el instanceof HTMLElement ? el : null
  }

  /** Drop any frozen snapshot (idempotent; also called from cleanup). */
  function removeGhosts(): void {
    document.querySelectorAll(`[data-mobile-nav="${PANEL_GHOST_VALUE}"]`).forEach((el) => el.remove())
  }

  /** Freeze the outgoing panel into an inert clone that can slide away. */
  function freezePanel(panel: HTMLElement): HTMLElement {
    removeGhosts()
    const ghost = document.createElement('div')
    ghost.dataset.mobileNav = PANEL_GHOST_VALUE
    ghost.setAttribute('aria-hidden', 'true')
    ghost.append(panel.cloneNode(true))
    document.body.append(ghost)
    return ghost
  }

  const exit = (): void => {
    if (!supported || leaving) return
    leaving = true
    panelLeaving = true
    // The marker goes on BEFORE the swap: the incoming conversation must carry its
    // reveal from its first style resolution (no full-opacity frame).
    const frame = getFrame()
    if (frame !== null) {
      frame.setAttribute(PANEL_EXIT_ATTR, '')
      frame.addEventListener('animationend', onAnimationEnd, true)
    }
    const panel = panelElement()
    const ghost = panel === null ? null : freezePanel(panel)
    // Commit on this very tick — the whole point of the snapshot is that the
    // remount no longer waits for any animation to finish.
    selectPanel()
    cleanupTimer = window.setTimeout(cleanup, PANEL_EXIT_FALLBACK_MS)
    if (ghost !== null) {
      let dropped = false
      const drop = (): void => {
        if (dropped) return
        dropped = true
        ghost.removeEventListener('animationend', onGhostEnd, true)
        ghost.remove()
      }
      const onGhostEnd = (event: AnimationEvent): void => {
        if (event.animationName === 'dsh-web-mobile-panel-ghost-out') drop()
      }
      ghost.addEventListener('animationend', onGhostEnd, true)
      // Fallback: reduced-motion kills the animation, and a layer left behind
      // would cover the whole screen — never rely on animationend alone.
      window.setTimeout(drop, PANEL_GHOST_MS + 120)
    }
  }

  return { exit, supported, panelOpen: panelOwnsMainArea, task: createPanelBackExitTask(exit, supported) }
}

/**
 * The system back key / back gesture exits the panel.
 *
 * The host core does not touch the browser history at all (only the PDF preview
 * plugin does, and that is unrelated), and measured on a phone the panel view
 * sits at `history.length === 1` — pressing back there leaves the page
 * entirely. So this layer is free to take over: arm one history entry while a
 * panel is open, and exit the panel when it is popped.
 *
 * Two edges are handled explicitly:
 *  - Our own `history.back()` (used when the panel is left by another route)
 *    echoes back as a popstate. `selfBackPending` swallows that echo, with a
 *    timeout so a host WebView that never emits popstate cannot leave the flag
 *    stuck and eat the user's next real back press.
 *  - Between the click and React's commit the panel row is still marked active;
 *    `panelViewOpen()` reports closed during that window, so no second history
 *    entry is armed.
 *
 * @param exitPanel - the shared exit action.
 * @param supported - false on hosts with no panel-selection API; the task then
 *   never arms a history entry at all.
 */
export function createPanelBackExitTask(exitPanel: () => void, supported: boolean): ReconcilerTask {
  let armed = false
  let listening = false
  let selfBackPending = false
  let selfBackTimer: number | null = null

  function clearSelfBack(): void {
    selfBackPending = false
    if (selfBackTimer !== null) {
      window.clearTimeout(selfBackTimer)
      selfBackTimer = null
    }
  }

  function selfBack(): void {
    selfBackPending = true
    if (selfBackTimer !== null) window.clearTimeout(selfBackTimer)
    selfBackTimer = window.setTimeout(clearSelfBack, 1200)
    try {
      history.back()
    } catch {
      clearSelfBack()
    }
  }

  function onPopState(): void {
    if (selfBackPending) {
      clearSelfBack()
      return
    }
    if (!armed) return
    armed = false
    if (panelViewOpen()) exitPanel()
  }

  function listen(): void {
    if (listening) return
    window.addEventListener('popstate', onPopState)
    listening = true
  }

  function unlisten(): void {
    if (!listening) return
    window.removeEventListener('popstate', onPopState)
    listening = false
  }

  return {
    name: 'panel-back-exit',
    scopes: ['*'],
    ensure: (): void => {
      if (!supported) return
      listen()
      if (panelViewOpen()) {
        if (armed) return
        armed = true
        try {
          // Second argument empty: add a poppable entry without touching the URL.
          history.pushState({ mobilePanelExit: true }, '')
        } catch {
          // Sandboxed frames refuse pushState; give up on this exit rather than
          // breaking anything else.
          armed = false
        }
        return
      }
      if (armed) {
        armed = false
        selfBack()
      }
    },
    dispose: (): void => {
      unlisten()
      clearSelfBack()
      if (armed) {
        armed = false
        selfBack()
      }
    },
  }
}

/**
 * Tapping the already-selected panel row again returns to the conversation.
 * Unselected rows are left alone — they still go through the host's own
 * `selectPanel(id)`.
 *
 * Runs in the capture phase so it can stop the host's onClick. The drawer close
 * rides the same click (phone-chrome's navigation-tap whitelist), which is the
 * only ordering that survives a touch: closing the drawer on pointerup cancels
 * the synthesized click entirely (see the 抽屉导航 click pitfall).
 */
export function installPanelRowExit(ctx: ClientContext, exitPanel: () => void): void {
  installMobileEffect(ctx, 'dsh-web-mobile: panel row returns to conversation', () => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || typeof target.closest !== 'function') return
      const row = target.closest('[class*="panelRow"]')
      if (row === null) return
      if (row.getAttribute('aria-current') !== 'page') return
      event.preventDefault()
      event.stopPropagation()
      exitPanel()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  })
}
