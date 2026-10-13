import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { panelSelectorOf } from '../core/layout-compat.ts'
import { getFrame } from '../platform/frame.ts'
import { installMobileEffect } from '../platform/breakpoints.ts'

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

/**
 * The instance that last armed `panelLeaving`. Only the owner may clear it, so a
 * torn-down instance can never blank the flag of the instance that replaced it.
 */
let panelLeavingOwner: symbol | null = null

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
  /**
   * Release every handle this instance owns: the main-timeline timer/frame
   * callback, the exit marker (only when this instance still owns it) and the
   * frozen snapshot. Must run from the owning `ctx.effect` disposer.
   */
  dispose: () => void
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
  let disposed = false
  /** Safety net for the main timeline: the animation's own length + buffer. */
  let exitTimer: number | null = null
  /** Frame callback that samples the swapped subtree (React commits a frame late). */
  let settleRaf = 0
  /** The snapshot this instance owns, and its own completion signals. */
  let ghost: HTMLElement | null = null
  let ghostTimer: number | null = null
  let ghostEnd: ((event: AnimationEvent) => void) | null = null
  /** Only the instance that armed `panelLeaving` may clear it. */
  const owner = Symbol('panel-exit')

  /**
   * The animations actually running on the reveal target
   * (`[class*="_centerCol"] > * > *`, layout.css.ts). Deliberately NOT matched by
   * name: the JS side once spelled the keyframe without its `web-` segment, so
   * `animationend` never fired and the marker lived until the 2000ms net; and
   * `prefers-reduced-motion` replaces the animation with `none`. A name test can
   * never cover both — the animation objects can.
   */
  function revealAnimations(): Animation[] {
    const frame = getFrame()
    if (frame === null) return []
    const running: Animation[] = []
    for (const center of frame.querySelectorAll('[class*="_centerCol"]')) {
      const target = center.firstElementChild?.firstElementChild
      if (!(target instanceof HTMLElement)) continue
      for (const animation of target.getAnimations()) {
        if (animation.playState !== 'idle') running.push(animation)
      }
    }
    return running
  }

  /**
   * Finish the MAIN timeline: marker, frame callback, flags — and nothing else.
   * The snapshot owns a longer timeline (PANEL_GHOST_MS); clearing it here was
   * exactly the trap the old name-based path hid behind its 2000ms net.
   */
  function finishMain(): void {
    if (!leaving) return
    if (exitTimer !== null) {
      window.clearTimeout(exitTimer)
      exitTimer = null
    }
    if (settleRaf !== 0) {
      cancelAnimationFrame(settleRaf)
      settleRaf = 0
    }
    // Ownership, not presence: the marker goes on in `exit()` in the same breath
    // as panelLeaving, so the instance that owns that flag also owns the marker.
    // An unconditional removeAttribute would let a disposer that lands after a
    // NEWER instance armed its own exit strip the marker off the reveal that
    // instance is still running (the conversation then flashes at full opacity).
    if (panelLeavingOwner === owner) {
      const frame = getFrame()
      if (frame !== null) frame.removeAttribute(PANEL_EXIT_ATTR)
      panelLeaving = false
      panelLeavingOwner = null
    }
    leaving = false
  }

  /** Drop the snapshot this instance owns (idempotent, independent timeline). */
  function finishGhost(): void {
    if (ghostTimer !== null) {
      window.clearTimeout(ghostTimer)
      ghostTimer = null
    }
    const el = ghost
    ghost = null
    if (el === null) return
    if (ghostEnd !== null) el.removeEventListener('animationend', ghostEnd, true)
    ghostEnd = null
    el.remove()
  }

  /**
   * Wait for the reveal to finish, one frame after the swap so React has
   * committed the incoming subtree. No animation at all (reduced-motion, or a
   * host rule that never applies) finishes on the spot instead of waiting for an
   * event that will never arrive.
   */
  function armExit(attempt: number): void {
    if (disposed || !leaving) return
    const animations = revealAnimations()
    if (animations.length === 0) {
      if (attempt < 2) {
        settleRaf = requestAnimationFrame(() => {
          settleRaf = 0
          armExit(attempt + 1)
        })
        return
      }
      finishMain()
      return
    }
    let longest = 0
    for (const animation of animations) {
      const timing = animation.effect?.getTiming()
      const delay = typeof timing?.delay === 'number' ? timing.delay : 0
      const duration = typeof timing?.duration === 'number' ? timing.duration : 0
      const iterations = typeof timing?.iterations === 'number' ? timing.iterations : 1
      longest = Math.max(longest, delay + duration * iterations)
      // `finished` resolves on completion and rejects on cancel; either way the
      // main timeline is done. The timer below only covers a node React
      // unmounts mid-animation.
      void animation.finished.then(
        () => finishMain(),
        () => finishMain(),
      )
    }
    exitTimer = window.setTimeout(
      finishMain,
      Math.min(PANEL_EXIT_FALLBACK_MS, Math.max(250, longest + 200)),
    )
  }

  /** The panel page element, or null when no panel owns the main area. */
  function panelElement(): HTMLElement | null {
    if (!panelOwnsMainArea()) return null
    const el = document.querySelector(PANEL_ELEMENT_SELECTOR)
    return el instanceof HTMLElement ? el : null
  }

  /**
   * Freeze the outgoing panel into an inert clone that can slide away.
   *
   * An older snapshot of ours is dropped through `finishGhost()` — this
   * instance's own handle — and never through a document-wide sweep of
   * `[data-mobile-nav="panel-ghost"]`. That marker is shared by every instance
   * of this effect, so a sweep (the shape this used to have, in freezePanel and
   * in dispose) lets a stale disposer delete the snapshot a NEWER instance just
   * mounted: the panel vanishes mid-slide and the survivor keeps a handle to a
   * detached node. Ownership is the rule this file already follows for
   * panelLeavingOwner and for the frame marker one function up.
   */
  function freezePanel(panel: HTMLElement): HTMLElement {
    finishGhost()
    const ghost = document.createElement('div')
    ghost.dataset.mobileNav = PANEL_GHOST_VALUE
    ghost.setAttribute('aria-hidden', 'true')
    ghost.append(panel.cloneNode(true))
    document.body.append(ghost)
    return ghost
  }

  const exit = (): void => {
    if (disposed || !supported || leaving) return
    leaving = true
    panelLeaving = true
    panelLeavingOwner = owner
    // The marker goes on BEFORE the swap: the incoming conversation must carry its
    // reveal from its first style resolution (no full-opacity frame).
    const frame = getFrame()
    if (frame !== null) frame.setAttribute(PANEL_EXIT_ATTR, '')
    const panel = panelElement()
    ghost = panel === null ? null : freezePanel(panel)
    // Commit on this very tick — the whole point of the snapshot is that the
    // remount no longer waits for any animation to finish.
    // 2026-10-13：selectPanel 由**宿主**实现，可能抛。它排在本行的上面（冻结全屏快照）
    // 之后、下面两个兜底（采样帧 + 幽灵计时器）之前 —— 裸调一旦抛错，屏幕上会留下
    // 一张**无人清理的全屏 ghost**，而且面板退场状态永远卡住。
    // try/finally 保证后面的排程与兜底**一定**被装上（异常照旧向外抛，不吞宿主错误）。
    try {
      selectPanel()
    } finally {
      // Sample the reveal one frame later: React commits the swapped subtree after
      // this handler returns, and by then the animation objects exist.
      settleRaf = requestAnimationFrame(() => {
        settleRaf = 0
        armExit(0)
      })
      if (ghost !== null) {
        const owned = ghost
        ghostEnd = (event: AnimationEvent): void => {
          if (event.animationName === 'dsh-web-mobile-panel-ghost-out') finishGhost()
        }
        owned.addEventListener('animationend', ghostEnd, true)
        // Fallback: reduced-motion kills the animation, and a layer left behind
        // would cover the whole screen — never rely on animationend alone.
        ghostTimer = window.setTimeout(finishGhost, PANEL_GHOST_MS + 120)
      }
    }
  }

  /**
   * Teardown: the plugin may be unloaded (or the breakpoint flipped) while an
   * exit is in flight, and nothing of ours may survive it — not the marker, not
   * the timers, not a snapshot still covering the screen. Both halves are
   * ownership-scoped: `finishGhost` drops the one snapshot this instance
   * created, so a stale disposer cannot take down a newer instance's.
   */
  function dispose(): void {
    disposed = true
    finishMain()
    finishGhost()
  }

  return {
    exit,
    supported,
    panelOpen: panelOwnsMainArea,
    task: createPanelBackExitTask(exit, supported),
    dispose,
  }
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
