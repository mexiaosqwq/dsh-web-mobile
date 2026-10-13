// Drawer-close interactions, moved verbatim out of effects/phone-chrome.ts
// (architecture P1 split, 2026-10-12): Escape + navigation-tap closing and the
// one shared drawer toggle every non-gesture closer routes through. The bodies
// below are a pure move - do not reflow or reword them.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from '../platform/breakpoints.ts'
import { getFrame } from '../platform/frame.ts'
import { consumeIfGestured, isStrokeLocked } from './gesture-guard.ts'
import { findSessionIdInFiber, isTapWithinSlop, reactFiberOf } from './session-row-fiber.ts'
import { currentSessionIdOf, sessionsCanOpen } from '../core/sessions-compat.ts'
import { closeDrawerAnimated } from './sidebar-swipe.ts'

/** Finger-down to finger-up travel that still counts as a tap on a session row
 *  (#49). Per-axis (`isTapWithinSlop` is max-norm, not Euclidean): the drawer
 *  list scrolls vertically, so a 60px vertical drift must not navigate while a
 *  diagonal wobble still reads as a tap. */
const TAP_NAV_SLOP_PX = 12

/** Where the current touch started (null for a mouse, and between touches).
 *  The no-click row-tap fallback resolves the row's session id at pointerup and
 *  only when the finger stayed put, so every touch pointerdown records this
 *  BEFORE any early return — a missed record silently disables the whole
 *  fallback. Cleared by the effect's disposer. */
let touchDownAt: { x: number; y: number } | null = null

/**
 * Drawer close interactions that are plain event listeners, not DOM
 * reconciliation:
 * - Escape closes the drawer (yielding to any open modal dialog, which owns
 *   its own Escape handling).
 * - Tapping a navigation target inside the drawer (session row, sidebar panel
 *   row, task board / ssh takeover entries, search results) closes the drawer
 *   so the content it opened gets the whole screen. Session-row action buttons
 *   (kebab) are excluded — they open a menu that must survive the tap.
 *
 * The touch close always rides the synthesized click. Closing a non-row
 * target from pointerup collapsed the drawer before that click existed, and
 * a collapsed drawer no longer owns the touch point, so the browser
 * dispatched no click at all and the target's own onClick never ran (「新会话」
 * did nothing but retract the drawer, 2026-09-13).
 */
export const TAP_CLOSE_NAV_SELECTOR =
  'button[data-dsh-taskboard-entry], button[data-dsh-ssh-entry], [class*="newSession"], [class*="sessionRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="panelRow"]'

/**
 * The one drawer toggle every non-gesture entry point shares: a CLOSE animates
 * into the closed slot and flips the host marker only once it has landed
 * (closeDrawerAnimated's late commit — spec 2026-08-27), an OPEN stays a plain
 * toggle so the host's own .28s transform transition plays.
 *
 * Load-bearing for layering, not just for looks (2026-09-25): the popover
 * band's modal-root raise is gated on our backdrop being on screen, and the
 * backdrop outlives the marker flip by design (fade .2s + removal 260ms). A
 * closer that flips the marker while the column is still painted therefore
 * leaves an open modal under the drawer band for the length of the
 * transition — that is the 快捷键弹层「抽搐/闪」 root cause. Routing every
 * closer through here removes the window at the source instead of relying on
 * the band to cover it.
 */
export function toggleDrawer(ctx: ClientContext): void {
  if (!closeDrawerAnimated(ctx)) ctx.layout.toggleSidebar()
}

export function installOverlayInteractions(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: drawer close (Escape + navigate)', () => {
    // Every non-gesture close funnels through here (backdrop tap, Escape, the
    // nav observers, navigation taps). A close animates first - the host tears
    // the pane's subtree and surface at the marker flip, so the slide has to
    // land before it (closeDrawerAnimated) - while opening stays a plain toggle
    // so the host's own .28s transform transition plays.
    const toggleSidebar = (): void => {
      toggleDrawer(ctx)
    }
    const drawerOpen = (): boolean => {
      const frame = getFrame()
      return frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('[aria-modal="true"]') !== null) return
      if (drawerOpen()) toggleSidebar()
    }
    // Capture phase: run before the shell or a plugin processes the click,
    // so takeover panels never render under the open drawer.
    const drawerRoot = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-mobile-nav="frame"] > :first-child')

    // Shared frame: inside the drawer, on a row navigation target, and not on
    // one of its buttons. Deliberately free of the DSHA tap-close exemption —
    // onDrawerPointerDown arms long-press through this base, and starving that
    // arming would make the host's ⋯ row menu unreachable (#82).
    const isDrawerNavTarget = (target: EventTarget | null): boolean => {
      if (document.querySelector('[aria-modal="true"]') !== null) return false
      if (!drawerOpen()) return false
      if (!(target instanceof Element)) return false
      const drawer = drawerRoot()
      if (drawer === null || !drawer.contains(target)) return false
      if (target.closest('[class*="sessionRow"] button') !== null) return false
      return target.closest(TAP_CLOSE_NAV_SELECTOR) !== null
    }
    // DSHA_SESSION_INTERACTION_V1：宿主把「单击=选中、双击=打开」拆成了两步
    // （data-dsha-session-select 标记 + dsha-session-open 事件）。上游的
    // 「点行即关抽屉」会在第一次单击就把抽屉收掉，双击永远到不了。
    // 这些行改由 dsha-session-open 事件关闭（见下方 document 监听）。
    // 非 DSHA 宿主没有这个标记，这一条天然不命中。
    // 豁免只属于点行关抽屉的两个调用方（click / pointerup），不得回流进
    // 长按武装门，否则 DSHA 行长按开不了 ⋯ 菜单（#82）。
    const shouldCloseOnTapInsideDrawer = (target: EventTarget | null): boolean =>
      !(target instanceof Element && target.closest('[data-dsha-session-select]') !== null)
      && isDrawerNavTarget(target)
    // Touch path for session/search rows: never close the drawer from pointer
    // events. Closing at pointerup (or deferring the close) races the browser's
    // synthesized click; some iOS shells suppress that click entirely, so the
    // row's onClick never runs. Instead arm the drawer to close on the *fact*
    // of navigation: when the selected row's title changes, React has already
    // opened the conversation, so the drawer can close safely.
    let lastTouchNavAt = 0
    let navSignatureAtArm = ''
    let navObserver: MutationObserver | null = null
    let navTimer: number | null = null

    /** Swallow the host's title double-click rename: on touch a double *tap*
     *  means "open the session" (DSHA's own two-tap detection sits on the row's
     *  click handler), and letting the browser's `dblclick` reach the title would
     *  open the host's rename dialog on that same gesture. Capture phase on
     *  `document`, so the event never reaches React's root container. Only real
     *  (trusted) events are swallowed — nothing here dispatches a synthetic
     *  dblclick since the long-press rename was dropped (2026-10-07). Armed only
     *  inside the mobile environment (this effect is MOBILE_QUERY-gated), so
     *  mouse-driven desktops keep the host behaviour untouched. */
    const onDrawerDoubleClick = (event: MouseEvent): void => {
      if (!event.isTrusted) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[class*="sessionRow"] [class*="_title"]') === null) return
      event.preventDefault()
      event.stopPropagation()
    }

    const selectedRowSignature = (): string | null => {
      const selected = drawerRoot()?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')
      const title = selected?.querySelector<HTMLElement>('[class*="_title"]')
      return title?.textContent?.trim() ?? null
    }

    const disarmNav = (): void => {
      navObserver?.disconnect()
      navObserver = null
      if (navTimer !== null) window.clearTimeout(navTimer)
      navTimer = null
      navSignatureAtArm = ''
    }

    const armNav = (): void => {
      disarmNav()
      navSignatureAtArm = selectedRowSignature() ?? ''
      const root = drawerRoot()
      if (root === null) return
      navObserver = new MutationObserver(() => {
        if (!drawerOpen()) {
          disarmNav()
          return
        }
        const signature = selectedRowSignature()
        if (signature !== null && signature !== navSignatureAtArm) {
          disarmNav()
          toggleSidebar()
        }
      })
      navObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-selected'],
      })
      navTimer = window.setTimeout(disarmNav, 2000)
    }

    /** Whether the session list really knows an id. The fiber walk has no
     *  shape heuristic on purpose: hop 32 of a row's chain is a ScopeProvider
     *  whose `props.scope` is the literal 'session-maybe', and
     *  `ctx.sessions.open` fails loud on unknown ids — membership is the only
     *  filter that can never hand the host a guess. */
    const isKnownSessionId = (id: string): boolean => {
      const snapshot = ctx.sessions.list.getSnapshot()
      return snapshot.byId[id] !== undefined
    }

    /** The session a finished tap on `row` should open, or null to fall back to
     *  the DOM observer: no finger-down record, a release that travelled (a
     *  scroll or a swipe, not a tap), a fiber chain offering no known id, or a
     *  row that is already the current session. */
    const tappedRowSessionId = (row: Element, event: PointerEvent): string | null => {
      if (touchDownAt === null) return null
      if (!isTapWithinSlop(touchDownAt, { x: event.clientX, y: event.clientY }, TAP_NAV_SLOP_PX)) return null
      const id = findSessionIdInFiber(reactFiberOf(row), isKnownSessionId)
      if (id === null) return null
      return currentSessionIdOf(ctx.sessions.list.getSnapshot()) === id ? null : id
    }

    // Close the drawer once the navigation we started ourselves lands (#49).
    // `armNav` watched the drawer's *selected row* change, but when WebKit drops
    // the tap's click the row's own onClick never runs, so that signal never
    // arrives — the store is the honest source of "navigation happened".
    let closeOnNavUnsub: (() => void) | null = null
    let closeOnNavDone = false
    /** The queued `fire` handle: cleared on disarm so disposal leaves no timer. */
    let closeOnNavTimer = 0

    /** Disarming means spent: mark the close done before dropping the
     *  subscription, so a `fire` a subscription tick already queued cannot
     *  toggle the drawer after the close was handed to the other closer. */
    const disarmCloseOnNav = (): void => {
      closeOnNavDone = true
      closeOnNavUnsub?.()
      closeOnNavUnsub = null
      if (closeOnNavTimer !== 0) {
        window.clearTimeout(closeOnNavTimer)
        closeOnNavTimer = 0
      }
    }

    const closeOnNavigation = (id: string): void => {
      disarmCloseOnNav()
      closeOnNavDone = false
      const fire = (): void => {
        if (closeOnNavDone) return
        disarmCloseOnNav()
        if (drawerOpen()) toggleSidebar()
      }
      closeOnNavUnsub = ctx.sessions.list.subscribe(() => {
        if (currentSessionIdOf(ctx.sessions.list.getSnapshot()) !== id) return
        if (closeOnNavTimer !== 0) window.clearTimeout(closeOnNavTimer)
        closeOnNavTimer = window.setTimeout(() => {
          closeOnNavTimer = 0
          fire()
        }, 0)
      })
    }

    /** Record where a touch started. The no-click row-tap fallback in
     *  onDrawerPointerUp resolves the row's session id at the lift and needs the
     *  down point to tell a tap from a scroll or a swipe, so every touch
     *  pointerdown records it BEFORE any early return. */
    let touchStartedAt = 0
    const onDrawerPointerDown = (event: PointerEvent): void => {
      touchStartedAt = performance.now()
      touchDownAt = event.pointerType === 'touch' || event.pointerType === 'pen'
        ? { x: event.clientX, y: event.clientY }
        : null
    }

    const onDrawerClick = (event: MouseEvent): void => {
      const target = event.target
      // A classified swipe already toggled the drawer; never let its
      // synthetic tap also close it / navigate a row (gesture-guard).
      // isStrokeLocked: a stroke axis-locked mid-swipe (audit S0) — the
      // consume marks do not exist until the gesture layer's own pointerup,
      // which runs AFTER this handler on the same release event.
      if (isStrokeLocked() || consumeIfGestured(event)) return
      // The backdrop keeps its own listener, but the third-party mobile shim
      // stops click propagation at the frame for anything outside the drawer
      // (its own dismiss path), so that listener never sees the tap. Decide
      // here instead — before both the shim and the element handler.
      if (target instanceof Element && target.closest('[data-mobile-nav="backdrop"]') !== null) {
        if (drawerOpen()) toggleSidebar()
        return
      }
      // DSHA detail=0 follows the host's keyboard/programmatic open path.
      // Replace the real click, rather than opening on pointerup and allowing
      // the later native click to select again. dsha-session-open owns closing.
      const dshaRow = target instanceof Element
        ? target.closest('[role="treeitem"][data-dsha-session-select]') : null
      if (dshaRow !== null && event.detail > 0 && isDrawerNavTarget(target)) {
        if (event.defaultPrevented || touchDownAt !== null &&
          (performance.now() - touchStartedAt >= 500 ||
           !isTapWithinSlop(touchDownAt,
             { x: event.clientX, y: event.clientY }, TAP_NAV_SLOP_PX))) return
        event.preventDefault()
        event.stopPropagation()
        disarmNav()
        disarmCloseOnNav()
        lastTouchNavAt = performance.now()
        dshaRow.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window, detail: 0,
        }))
        return
      }
      // A touch row-tap owns the close (pointerup or the navigation observer);
      // let the row's click reach React without toggling the drawer twice.
      if (performance.now() - lastTouchNavAt < 500) return
      if (shouldCloseOnTapInsideDrawer(target)) toggleSidebar()
    }

    const onDrawerPointerUp = (event: PointerEvent): void => {
      // A classified swipe must not arm the nav observer or toggle again
      // (gesture-guard): the drawer already toggled, and the row under the
      // stroke was never a tap. isStrokeLocked covers the release event of
      // a stroke locked mid-swipe but not yet classified — this handler
      // runs before the gesture layer's own pointerup (audit S0/S1: without
      // it the host toggled first and the gesture toggled back, net zero).
      if (isStrokeLocked() || consumeIfGestured(event)) return
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      const target = event.target
      if (!(target instanceof Element)) return
      if (!shouldCloseOnTapInsideDrawer(target)) return

      const row = target.closest('[role="treeitem"]')
      if (row !== null) {
        lastTouchNavAt = performance.now()
        if (row.getAttribute('aria-selected') === 'true') {
          // Already-selected row will not navigate; closing immediately is safe.
          toggleSidebar()
        } else {
          // Unselected row: navigate from the id we resolved at the touch point
          // when this tap can supply one — on WebKit the row's own click may
          // never come, and then nothing else would open the session. Fall back
          // to closing once the DOM shows a navigation landed when it cannot.
          const tappedId = tappedRowSessionId(row, event)
          if (tappedId === null) {
            // Exactly one closer at a time: this tap closes through the DOM
            // observer, so drop the store subscription an earlier resolved tap
            // armed — its stale id would toggle the drawer again on landing.
            disarmCloseOnNav()
            armNav()
          } else {
            // The mirror case: this tap closes through the store, so drop the
            // observer an earlier fallback tap armed — otherwise both fire on
            // this one navigation (the observer on the selected-title change,
            // the subscription on the landing) and race to toggle twice.
            disarmNav()
            if (sessionsCanOpen(ctx.sessions)) {
              closeOnNavigation(tappedId)
              ctx.sessions.open(tappedId)
            } else {
              // a2 removed sessions.open (retain-model navigation) — the
              // store-subscription closer above watches `current`, which a2
              // no longer publishes, so arming it would only leak a
              // subscription that can never fire. Degrade to the DOM
              // observer: the row's own onClick still navigates where the
              // browser dispatches it (audit doc §10.1 / F1).
              disarmCloseOnNav()
              armNav()
            }
          }
        }
        return
      }

      // Non-row nav targets (newSession / taskboard / ssh / search rows that
      // are not treeitems) are closed by the capture click handler below:
      // closing here would retract the drawer before the browser dispatches
      // the tap's click, and the target's onClick would never run.
    }

    // DSHA 宿主在「真正打开会话」时才派发 dsha-session-open（单击只选中），
    // 所以抽屉的关闭挂在这个事实上，而不是挂在点击上。
    const onDshaSessionOpen = (): void => {
      if (drawerOpen()) toggleSidebar()
    }
    document.addEventListener('dsha-session-open', onDshaSessionOpen)
    document.addEventListener('dblclick', onDrawerDoubleClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('click', onDrawerClick, true)
    document.addEventListener('pointerdown', onDrawerPointerDown, true)
    document.addEventListener('pointerup', onDrawerPointerUp, true)
    return () => {
      disarmNav()
      // Also marks the close spent, so a queued `fire` cannot outlive the effect.
      disarmCloseOnNav()
      touchDownAt = null
      document.removeEventListener('dsha-session-open', onDshaSessionOpen)
      document.removeEventListener('dblclick', onDrawerDoubleClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('click', onDrawerClick, true)
      document.removeEventListener('pointerdown', onDrawerPointerDown, true)
      document.removeEventListener('pointerup', onDrawerPointerUp, true)
    }
  })
}
