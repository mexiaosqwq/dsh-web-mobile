import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { consumeIfGestured, isStrokeLocked } from './gesture-guard.ts'
import { findSessionIdInFiber, isTapWithinSlop, reactFiberOf } from './session-row-fiber.ts'
import { createReconcilerCore } from '../core/reconciler-core.ts'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { createPreviewCloseTask, createSheetRiseTask } from './aionui-compat.ts'
import { createStatsLineTask } from './stats-line.ts'
import { createPreviewFullscreenTask } from './preview-fullscreen.ts'
import { createGitChipTask } from './git-chip-reparent.ts'
import { createSettingsToolbarTask } from './settings-toolbar-reparent.ts'
import { createOverlayTask } from './overlay-backdrop-fab.ts'
import { createFileViewerMarkerTask } from './file-viewer-compat.ts'

// The custom client bundler cannot resolve `../` requires from src/client/effects,
// so this mirrors the namespace id from src/client/locales.ts. Keep in sync.
const NS = 'mobileNav'

/** Same width bound as the shell's SIDEBAR_AUTO_COLLAPSE (viewport < 1024),
 *  ANDed with a touch-primary pointer guard. Width alone cannot tell a phone
 *  from a desktop window: split views and OS display scaling push a PC's CSS
 *  viewport below 1024px too, and the whole mobile shell (drawer, header
 *  Files button, gestures) would mount there. (pointer: coarse) keeps the
 *  adaptation on touch-primary devices — phones, tablets, DSHA — while any
 *  mouse-driven window stays desktop at every width. Headless probes have no
 *  pointer at all: arm the mobile branch with Emulation.setTouchEmulation-
 *  Enabled before asserting mobile UI. */
export const MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'

/** Informational wide-bound for the debug badge. The authoritative desktop
 *  guard is the CSS hide block in misc.css.ts — the exact complement of
 *  MOBILE_QUERY — because slot-rendered controls exist at every width. */
export const DESKTOP_QUERY = '(min-width: 1024px)'

/** Pointer-only guard for the ONE feature that has no desktop equivalent:
 *  the session-delete menu injection. Armed on touch-primary devices at
 *  EVERY width — a large tablet in landscape (e.g. 1238px) keeps the desktop
 *  layout but still gets the 「删除会话」 item. Mouse-driven or pointer-less
 *  windows never arm it, at any width. */
export const TOUCH_QUERY = '(pointer: coarse)'

/**
 * Re-arm a mobile-only DOM effect on every query change. Replaces the
 * repeated matchMedia + change-listener scaffold so all breakpoint strings
 * live in one place. `query` defaults to MOBILE_QUERY; effects that arm on a
 * different condition (e.g. TOUCH_QUERY) pass their own string instead of
 * building a private matchMedia scaffold.
 */
export function installMobileEffect(
  ctx: ClientContext,
  label: string,
  install: (narrow: MediaQueryList) => (() => void) | undefined,
  query: string = MOBILE_QUERY,
): void {
  ctx.effect(() => {
    const narrow = window.matchMedia(query)
    let cleanup: (() => void) | undefined
    const arm = (): void => {
      cleanup?.()
      cleanup = narrow.matches ? install(narrow) : undefined
    }
    arm()
    narrow.addEventListener('change', arm)
    return () => {
      narrow.removeEventListener('change', arm)
      cleanup?.()
    }
  }, label)
}

/** The AppFrame element: direct parent of the shell overlay layer. */
export function findFrame(): HTMLElement | null {
  return document.querySelector('[data-shell-overlay]')?.parentElement ?? null
}

/** Resolve the plugin-owned frame marker, falling back to the raw shell frame. */
export function getFrame(): HTMLElement | null {
  return document.querySelector('[data-mobile-nav="frame"]') ?? findFrame()
}

/**
 * Frame marker controller: owns `data-mobile-nav="frame"` and every plugin
 * marker that can survive on the shell-owned frame. Installed once at apply
 * time so effects no longer each need to find/set/clear the frame. Returns a
 * disposer that unregisters the task and resets the installed flag, so a
 * same-environment plugin reload can rebuild the reconciler from scratch.
 */
export function installFrameController(): () => void {
  if (frameControllerInstalled) return () => {}
  frameControllerInstalled = true
  let frame: HTMLElement | null = null
  const removeTask = addReconcilerTask({
    name: 'frame-marker',
    scopes: ['*'],
    ensure: () => {
      frame = findFrame()
      if (frame !== null && !frame.hasAttribute('data-mobile-nav')) {
        frame.setAttribute('data-mobile-nav', 'frame')
      }
    },
    dispose: () => {
      if (frame !== null) {
        frame.removeAttribute('data-mobile-nav')
        frame.removeAttribute('data-mobile-preview-full')
        frame.removeAttribute('data-aionui-explorer-open')
        frame.removeAttribute('data-aionui-preview-open')
      }
      frame = null
    },
  })
  return () => {
    removeTask()
    frameControllerInstalled = false
  }
}

/**
 * One unit of DOM reconciliation driven by the shared full-tree observer.
 * Defined in the DOM-free core so registration / dirty routing / coalescing
 * are unit-testable; kept reachable from here so the third-party task modules
 * (aionui-compat, stats-line) keep importing it via `./phone-chrome.ts`.
 */
export type { ReconcilerTask } from '../core/reconciler-core.ts'

let frameControllerInstalled = false
let reconcileTasksRegistered = false
let reconcilerInstalled = false

// The DOM-free core owns the task registry, dirty-key routing, and coalesced
// flush scheduling; this module is the thin browser adapter that feeds it
// MutationObserver records and drives its lifecycle from the mobile effect.
const core = createReconcilerCore({
  requestFrame: (flush) => {
    let id = 0
    const run = (): void => {
      id = 0
      flush()
    }
    id = requestAnimationFrame(run)
    return () => {
      if (id !== 0) cancelAnimationFrame(id)
    }
  },
})

/**
 * One full-tree MutationObserver for every mobile DOM reconciler. Tasks can be
 * registered from React or plain effects; they only run while the mobile
 * breakpoint is active and are re-armed automatically on width changes.
 */
export function installReconciler(ctx: ClientContext): () => void {
  if (reconcilerInstalled) return () => {}
  reconcilerInstalled = true
  installMobileEffect(ctx, 'dsh-web-mobile: DOM reconciler', () => {
    // Coalesce every mutation burst (typing, animations, per-token TPS
    // re-renders) into one dirty-key pass per animation frame. Each task
    // declares scopes so only intersecting tasks run on a given flush.
    const observer = new MutationObserver((records) => {
      const keys = new Set<string>()
      for (const record of records) {
        keys.add(
          record.type === 'attributes' && record.attributeName !== null ? record.attributeName : '*',
        )
      }
      core.note(keys)
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'style',
        'class',
        'data-phase',
        'data-sidebar-collapsed',
        'data-aionui-explorer-open',
        'data-aionui-preview-open',
        'data-mobile-preview-full',
      ],
    })
    core.activate()
    return () => {
      observer.disconnect()
      core.deactivate()
    }
  })
  return () => {
    reconcilerInstalled = false
  }
}

/** Register a reconciler task. The returned disposer removes it immediately. */
export function addReconcilerTask(task: ReconcilerTask): () => void {
  return core.register(task)
}

/**
 * Whether the page runs on iOS / iPadOS WebKit, where focusing a text field
 * whose computed font-size is below 16px zooms the whole visual viewport
 * (#45). Every other engine ignores field font-size, so the 16px floor in
 * misc.css.ts is gated on this marker instead of applying to every phone —
 * Android would only get bigger search boxes for no benefit.
 *
 * Pure and injectable so the decision table is unit-testable:
 * - The feature probe is the reliable signal: `font: -apple-system-body` is
 *   Safari-only and `-webkit-touch-callout` is an iOS property, so the pair
 *   is true on iOS WebKit (including Chrome / Edge / Opera on iOS, which are
 *   WebKit and zoom identically) and false on Chromium (measured) and on
 *   macOS Safari.
 * - The UA fallback covers engines whose CSS.supports is missing or which
 *   parse the probe differently: iPhone / iPad / iPod UAs, plus iPadOS 13+
 *   which reports a Macintosh UA and is told apart by its touch points.
 */
export function detectIosWebKit(
  nav: { userAgent: string; maxTouchPoints: number },
  supports: ((condition: string) => boolean) | null,
): boolean {
  if (supports !== null) {
    try {
      if (supports('(font: -apple-system-body) and (-webkit-touch-callout: none)')) return true
    } catch {
      // A UA that rejects the condition string falls through to the UA test.
    }
  }
  const ua = nav.userAgent
  if (/iP(hone|ad|od)/.test(ua)) return true
  return /Macintosh/.test(ua) && nav.maxTouchPoints > 1
}

/** Marker the iOS-only zoom-guard CSS is scoped to (html element). */
const IOS_MARKER = 'data-mobile-nav-ios'

/**
 * Viewport content the plugin owns while the mobile branch is armed.
 * Deliberately zoom-free: iOS 10+ ignores maximum-scale/user-scalable for
 * user pinch but other engines honor them, so writing them would only take
 * zoom away from Android/DSHA; the iOS focus-zoom fix is the >=16px field
 * floor (data-mobile-nav-ios), not a zoom ban (#45).
 */
const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover'

const findViewportMeta = (): HTMLMetaElement | null =>
  document.querySelector<HTMLMetaElement>('meta[name="viewport"]')

/**
 * Phone chrome: KEEP the system status bar (no fullscreen) and make it
 * blend into the page. On narrow screens:
 * - The viewport meta is OWNED by the plugin while armed:
 *   width=device-width, initial-scale=1, viewport-fit=cover, re-asserted on
 *   every host rewrite, node replacement, or late injection, so
 *   env(safe-area-inset-top) stays the real status-bar / notch height
 *   instead of silently going stale when the host touches the meta. No zoom
 *   tokens here: iOS 10+ ignores them for user pinch but other engines
 *   honor them, and the focus-zoom fix is the >=16px field floor (#45), not
 *   a zoom ban. Dispose restores the host's own content as observed at arm
 *   time.
 * - A theme-color meta tracks the shell background (the official theme is
 *   toggled by body[data-ds-dark-theme], which flips --dsw-alias-bg-base):
 *   Android then paints the status bar / URL bar with the page's own base
 *   color, so the status bar reads as part of the UI instead of a foreign
 *   strip. The drawer paints the same strip on iOS / notch displays.
 * - documentElement carries data-mobile-nav-ios on iOS WebKit so the
 *   stylesheet can hold every text field at >=16px and Safari never
 *   focus-zooms the viewport (#45). Double-tap zoom is off through
 *   touch-action; pinch zoom stays available on purpose — it is the only way
 *   back out of a zoom the browser applied on its own.
 */
export function installPhoneChrome(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: status bar theme + viewport + zoom guard', () => {
    const themeMeta = document.createElement('meta')
    themeMeta.name = 'theme-color'
    const bodyBg = (): string => getComputedStyle(document.body).backgroundColor
    const root = document.documentElement
    let originalViewport: string | null = null
    let observedMeta: HTMLMetaElement | null = null
    // Our own write retriggers the observers; the equality check in
    // assertViewport turns that pass into a no-op. `applying` guards the
    // write itself against re-entrant observer callbacks on exotic engines.
    let applying = false

    // The plugin owns the meta while armed, so a host rewrite, a node
    // replacement, or a meta that arrives after this effect arms cannot
    // silently drop viewport-fit=cover and shift every surface under the
    // notch. Both observers funnel into the same assertion;
    // attachMetaObserver re-binds to the current node so a replacement keeps
    // being watched.
    const assertViewport = (): void => {
      const viewport = findViewportMeta()
      if (viewport === null) return
      if (originalViewport === null) originalViewport = viewport.content
      if (applying || viewport.content === VIEWPORT_CONTENT) return
      applying = true
      viewport.content = VIEWPORT_CONTENT
      applying = false
    }
    const metaObserver = new MutationObserver(assertViewport)
    const attachMetaObserver = (): void => {
      const viewport = findViewportMeta()
      if (viewport === observedMeta) return
      if (observedMeta !== null) metaObserver.disconnect()
      observedMeta = viewport
      if (viewport !== null) {
        metaObserver.observe(viewport, { attributes: true, attributeFilter: ['content'] })
      }
    }
    const headObserver = new MutationObserver((): void => {
      attachMetaObserver()
      assertViewport()
    })
    headObserver.observe(document.head, { childList: true })
    attachMetaObserver()
    assertViewport()

    const observer = new MutationObserver(() => {
      themeMeta.content = bodyBg()
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    const cssSupports =
      typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
        ? (condition: string): boolean => CSS.supports(condition)
        : null
    if (detectIosWebKit(navigator, cssSupports)) root.setAttribute(IOS_MARKER, '')
    themeMeta.content = bodyBg()
    if (themeMeta.parentElement === null) document.head.appendChild(themeMeta)
    return () => {
      metaObserver.disconnect()
      headObserver.disconnect()
      observer.disconnect()
      const viewport = findViewportMeta()
      // Hand the meta back only if it still holds OUR content; a host value
      // written while we were armed wins on dispose.
      if (viewport !== null && originalViewport !== null && viewport.content === VIEWPORT_CONTENT) {
        viewport.content = originalViewport
      }
      themeMeta.remove()
      root.removeAttribute(IOS_MARKER)
    }
  })
}





/**
 * Drawer close interactions that are plain event listeners, not DOM
 * reconciliation:
 * - Escape closes the drawer (yielding to any open modal dialog, which owns
 *   its own Escape handling).
 * - Tapping a navigation target inside the drawer (session row, task board /
 *   ssh takeover entries, search results) closes the drawer so the content
 *   it opened gets the whole screen. Session-row action buttons (kebab) are
 *   excluded — they open a menu that must survive the tap.
 */
export function installOverlayInteractions(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: drawer close (Escape + navigate)', () => {
    const toggleSidebar = (): void => ctx.layout.toggleSidebar()
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

    const shouldCloseOnTapInsideDrawer = (target: EventTarget | null): boolean => {
      if (document.querySelector('[aria-modal="true"]') !== null) return false
      if (!drawerOpen()) return false
      if (!(target instanceof Element)) return false
      const drawer = drawerRoot()
      if (drawer === null || !drawer.contains(target)) return false
      if (target.closest('[class*="sessionRow"] button') !== null) return false
      return target.closest(
        'button[data-dsh-taskboard-entry], button[data-dsh-ssh-entry], [class*="newSession"], [class*="sessionRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"]',
      ) !== null
    }
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

    /**
     * A finger travel limit for the tap fallback below: past this the release
     * is a drag/scroll, not a tap, and must not navigate.
     */
    const TAP_NAV_SLOP_PX = 12
    let touchDownAt: { x: number; y: number } | null = null

    const onDrawerPointerDown = (event: PointerEvent): void => {
      touchDownAt =
        event.pointerType === 'touch' || event.pointerType === 'pen'
          ? { x: event.clientX, y: event.clientY }
          : null
    }

    /** Known session ids, per the host session list (fiber-id membership test). */
    const sessionListSnapshot = (): { current?: string | null; ids?: readonly string[]; byId?: Record<string, unknown> } => {
      try {
        return ctx.sessions.list.getSnapshot()
      } catch {
        return {}
      }
    }

    const isKnownSessionId = (id: string): boolean => {
      const snapshot = sessionListSnapshot()
      return snapshot.byId?.[id] !== undefined || (snapshot.ids ?? []).includes(id)
    }

    /**
     * Session id of a tapped drawer row, or null when the release was not a tap
     * on a resolvable row.
     *
     * The reference iPhone does not reliably synthesize a `click` for a row tap
     * (measured: two identical taps, one with a click and one with none at all —
     * no preventDefault, no touch/pointer cancel, no hit-target change), so the
     * row's React onClick and with it the whole "navigate, then close the drawer
     * once the selected row changes" chain never runs. The id is read from the
     * row's React fiber chain (the DOM carries no session id) and handed to
     * `ctx.sessions.open`, exactly what the row's own onClick does.
     */
    const tappedRowSessionId = (row: Element, event: PointerEvent): string | null => {
      if (touchDownAt === null) return null
      // Past this the release is a drag or a list scroll, not a tap.
      if (!isTapWithinSlop(touchDownAt, { x: event.clientX, y: event.clientY }, TAP_NAV_SLOP_PX)) return null
      const id = findSessionIdInFiber(reactFiberOf(row), isKnownSessionId)
      if (id === null) return null
      return sessionListSnapshot().current === id ? null : id
    }

    /** When the tap fallback last navigated (its trailing click is dropped). */
    let fallbackNavAt = 0
    let closeOnNavUnsub: (() => void) | null = null
    let closeOnNavTimer: number | null = null
    let closeOnNavDone = false

    const disarmCloseOnNav = (): void => {
      closeOnNavUnsub?.()
      closeOnNavUnsub = null
      if (closeOnNavTimer !== null) window.clearTimeout(closeOnNavTimer)
      closeOnNavTimer = null
    }

    /**
     * Close the drawer once the host reports the session actually selected,
     * instead of waiting for the selected ROW to change in the DOM.
     *
     * Upstream's observer keys on a mutation, which only lands after React has
     * committed the whole update — including rendering the conversation that was
     * just opened — so the drawer (and the visible switch) waits on that render.
     * The session-list store flips `current` during `sessions.open(id)` itself,
     * so the close can start immediately. One-shot by construction: the
     * subscription and its timeout are torn down by the first close, and the tap
     * fallback deliberately does NOT arm the DOM observer for the same tap, so
     * exactly one close can happen.
     */
    const closeOnNavigation = (id: string): void => {
      disarmCloseOnNav()
      closeOnNavDone = false
      const fire = (): void => {
        if (closeOnNavDone) return
        closeOnNavDone = true
        disarmCloseOnNav()
        if (drawerOpen()) toggleSidebar()
      }
      const current = (): string | null => {
        try {
          return ctx.sessions.list.getSnapshot().current ?? null
        } catch {
          return null
        }
      }
      try {
        closeOnNavUnsub =
          ctx.sessions.list.subscribe?.(() => {
            if (current() !== id) return
            // A fresh task, so the close never re-enters the host's own
            // select() call stack.
            window.setTimeout(fire, 0)
          }) ?? null
      } catch {
        closeOnNavUnsub = null
      }
      // The subscription may land after the store already moved (the host
      // notifies asynchronously): read the fact directly, and re-check once
      // shortly after, so the close does not wait on a notification that has
      // already been coalesced away.
      if (current() === id) window.setTimeout(fire, 0)
      window.setTimeout(() => {
        if (closeOnNavDone) return
        if (current() === id) fire()
      }, 60)
      closeOnNavTimer = window.setTimeout(disarmCloseOnNav, 900)
    }

    const onDrawerClick = (event: MouseEvent): void => {
      // A classified swipe already toggled the drawer; never let its
      // synthetic tap also close it / navigate a row (gesture-guard).
      // isStrokeLocked: a stroke axis-locked mid-swipe (audit S0) — the
      // consume marks do not exist until the gesture layer's own pointerup,
      // which runs AFTER this handler on the same release event.
      if (isStrokeLocked() || consumeIfGestured(event)) return
      // A touch row-tap owns the close (pointerup or the navigation observer);
      // let the row's click reach React without toggling the drawer twice.
      if (performance.now() - lastTouchNavAt < 500) {
        // ...except when the tap already navigated through the fiber path: the
        // row's own onClick would open the same session a second time, and the
        // re-render that costs is what made the switch feel late.
        if (performance.now() - fallbackNavAt < 600) event.stopPropagation()
        return
      }
      if (shouldCloseOnTapInsideDrawer(event.target)) toggleSidebar()
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
          const tappedId = tappedRowSessionId(row, event)
          if (tappedId === null) {
            // Unresolved id: the click path stays the only way in, so keep
            // upstream's DOM-fact observer as the close.
            armNav()
          } else {
            closeOnNavigation(tappedId)
            try {
              ctx.sessions.open(tappedId)
              fallbackNavAt = performance.now()
            } catch {
              // The host refused the id: fall back to the observer path.
              disarmCloseOnNav()
              armNav()
            }
          }
        }
        return
      }

      // Non-row nav targets (newSession / taskboard / ssh / search rows that
      // are not treeitems): the pointerup close path is still correct.
      toggleSidebar()
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onDrawerPointerDown, true)
    document.addEventListener('click', onDrawerClick, true)
    document.addEventListener('pointerup', onDrawerPointerUp, true)
    return () => {
      disarmNav()
      disarmCloseOnNav()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onDrawerPointerDown, true)
      document.removeEventListener('click', onDrawerClick, true)
      document.removeEventListener('pointerup', onDrawerPointerUp, true)
    }
  })
}

/**
 * Register the shared DOM reconciler tasks. Returns a disposer that
 * unregisters every task and resets the flag, so a same-environment plugin
 * reload can rebuild the reconciler from scratch.
 */
export function registerReconcileTasks(ctx: ClientContext): () => void {
  if (reconcileTasksRegistered) return () => {}
  reconcileTasksRegistered = true
  const t = ctx.locale.bind(NS)
  const removeTasks = [
    addReconcilerTask(createPreviewFullscreenTask(t)),
    addReconcilerTask(createGitChipTask()),
    addReconcilerTask(createSettingsToolbarTask()),
    addReconcilerTask(createPreviewCloseTask()),
    addReconcilerTask(createSheetRiseTask()),
    addReconcilerTask(createStatsLineTask()),
    addReconcilerTask(createOverlayTask(t, () => ctx.layout.toggleSidebar())),
    addReconcilerTask(createFileViewerMarkerTask()),
  ]
  return () => {
    for (const remove of removeTasks) remove()
    reconcileTasksRegistered = false
  }
}

