import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { consumeIfGestured, isStrokeLocked } from './gesture-guard.ts'
import { findSessionIdInFiber, isTapWithinSlop, reactFiberOf } from './session-row-fiber.ts'
import { createReconcilerCore } from '../core/reconciler-core.ts'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { currentSessionIdOf, sessionsCanOpen } from '../core/sessions-compat.ts'
import { NS } from '../i18n/locales.ts'
import { createPreviewCloseTask, createSheetRiseTask } from './aionui-compat.ts'
import { createStatsLineTask } from './stats-line.ts'
import { createPreviewFullscreenTask } from './preview-fullscreen.ts'
import { createOverlayTask } from './overlay-backdrop-fab.ts'
import { createFileViewerMarkerTask } from './file-viewer-compat.ts'
import type { PanelExit } from './panel-exit.ts'
import { closeDrawerAnimated } from './sidebar-swipe.ts'

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

/** The third-party mobile compat shim shipped inside `@linxin666/dsh-web-all`
 *  collapses the drawer on ANY click inside `[role="treeitem"]` at ≤768px by
 *  clicking the host's logo-row toggle — with no `_rowActions` exemption, so a
 *  tap on a row's ⋯ closed the drawer instead of opening its menu (2026-09-14;
 *  its sibling implementation inside `@linxin666/dsh-remote-web-ui` does exempt
 *  the row actions). It resolves that toggle with
 *  `frame.querySelector('[data-dsh-responsive-part="sidebar-toggle"]')`, so an
 *  inert element carrying the same stamp EARLIER in tree order turns every one
 *  of its dismiss calls into a no-op and leaves dismiss ownership to us (row
 *  taps close through the navigation observer, backdrop taps through the
 *  capture click path). Gated on the shim's own stamp: hosts without it stay
 *  untouched. */
const HOST_TOGGLE_SELECTOR = '[data-dsh-responsive-part="sidebar-toggle"]:not([data-mobile-nav])'
const DISMISS_SHADOW_SELECTOR = '[data-mobile-nav="dismiss-shadow"]'

export function ensureDismissShadow(): void {
  if (typeof document === 'undefined') return
  const shadow = document.querySelector<HTMLElement>(DISMISS_SHADOW_SELECTOR)
  const real = document.querySelector<HTMLElement>(HOST_TOGGLE_SELECTOR)
  const pane = real?.closest<HTMLElement>('[data-pane="sidebar"]') ?? null
  if (real === null || pane === null) {
    shadow?.remove()
    return
  }
  // Must stay a no-op once in place: the reconciler observes the whole tree and
  // a task that mutates on every flush would re-trigger itself forever.
  if (shadow !== null && shadow.parentElement === pane && pane.firstElementChild === shadow) return
  const element = shadow ?? document.createElement('span')
  if (shadow === null) {
    element.setAttribute('data-mobile-nav', 'dismiss-shadow')
    element.setAttribute('data-dsh-responsive-part', 'sidebar-toggle')
    element.setAttribute('aria-hidden', 'true')
    // The shim's collapsed-rail rule forces `display: inline-flex !important`
    // on anything carrying the stamp; only an inline !important outranks it.
    element.style.setProperty('display', 'none', 'important')
  }
  pane.insertBefore(element, pane.firstElementChild)
}

/**
 * Height of the phone conversation header, published as a CSS variable so the
 * scroll body can extend up under it (layout.css.ts "selection-drag autoscroll
 * ramp": the distance from the list's top edge decides how fast Blink
 * autoscrolls a selection drag). Measured from the frame's top to the header's
 * bottom - exactly how far the scrollport's box has to grow upward - which also
 * stays correct when the header's own top is pushed down by safe-area padding.
 */
const HEADER_HEIGHT_VAR = '--mobile-nav-header-h'
const HEADER_SELECTOR = '[data-mobile-nav="frame"] [data-phase] header'

let observedHeader: Element | null = null
let headerObserver: ResizeObserver | null = null

/** Publish the header height, idempotently: the variable write is itself an
 *  attribute mutation on <html>, so an unconditional write would keep dirtying
 *  the reconciler. */
function publishHeaderHeight(): void {
  if (typeof document === 'undefined') return
  const frame = getFrame()
  const header = observedHeader
  const unmeasurable = header === null || frame === null
    || !(header instanceof HTMLElement)
    || header.offsetHeight === 0
  const next = unmeasurable
    ? '0px'
    : `${Math.round(Math.max(0, header.getBoundingClientRect().bottom - frame.getBoundingClientRect().top))}px`
  const root = document.documentElement
  if (root.style.getPropertyValue(HEADER_HEIGHT_VAR) !== next) {
    root.style.setProperty(HEADER_HEIGHT_VAR, next)
  }
}

/** Reattach the ResizeObserver when React swaps the header element, then
 *  publish. Cheap while nothing changes: one querySelector + an identity
 *  compare, no layout work until the header is actually replaced. */
function syncHeaderHeight(): void {
  if (typeof document === 'undefined') return
  const header = document.querySelector(HEADER_SELECTOR)
  if (header !== observedHeader) {
    headerObserver?.disconnect()
    observedHeader = header
    if (header !== null && typeof ResizeObserver !== 'undefined') {
      headerObserver = headerObserver ?? new ResizeObserver(() => { publishHeaderHeight() })
      headerObserver.observe(header)
    }
  }
  publishHeaderHeight()
}

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

/**
 * Frame marker controller: owns `data-mobile-nav="frame"` and every plugin
 * marker that can survive on the shell-owned frame. Installed once at apply
 * time so effects no longer each need to find/set/clear the frame. Returns a
 * disposer that unregisters the task and resets the installed flag, so a
 * same-environment plugin reload can rebuild the reconciler from scratch.
 * (The host-generation probe this controller used to call was dead code —
 * nothing ever read `data-mobile-nav-gen`, and the plugin deliberately does
 * not yield the drawer to the host's one: see docs/maintenance/pitfalls.md
 * §0.1.5 抽屉 z 与遮罩.)
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
      ensureDismissShadow()
    },
    dispose: () => {
      if (frame !== null) {
        frame.removeAttribute('data-mobile-nav')
        frame.removeAttribute('data-mobile-preview-full')
        frame.removeAttribute('data-aionui-explorer-open')
        frame.removeAttribute('data-aionui-preview-open')
      }
      if (typeof document !== 'undefined') {
        document.querySelector(DISMISS_SHADOW_SELECTOR)?.remove()
      }
      frame = null
    },
  })
  const removeHeaderMetrics = addReconcilerTask({
    name: 'header-metrics',
    scopes: ['*'],
    ensure: () => {
      syncHeaderHeight()
    },
    dispose: () => {
      headerObserver?.disconnect()
      headerObserver = null
      observedHeader = null
      if (typeof document !== 'undefined') {
        document.documentElement.style.removeProperty(HEADER_HEIGHT_VAR)
      }
    },
  })
  return () => {
    removeHeaderMetrics()
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

/**
 * CSS custom property carrying the viewport height WITHOUT the soft keyboard
 * (px), maintained by the viewport effect below. Mobile cards that must not
 * move when the keyboard appears size themselves with it instead of a viewport
 * unit — see the settings sheet / shortcut card rules in layout.css.ts.
 */
export const STABLE_VIEWPORT_VAR = '--dsh-web-mobile-vh'

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

    // The keyboard-less viewport height (STABLE_VIEWPORT_VAR).
    //
    // Measured 2026-09-25 on the reporter's phone (Android 16 WebView,
    // adjustResize): raising the soft keyboard takes the layout viewport from
    // 754 to 471, and vh / svh / lvh / dvh ALL follow it (all four measured at
    // 471) — no CSS unit on this engine can ignore the keyboard. So every card
    // sized by a viewport unit shrank with it: the settings sheet and the
    // shortcut modal each collapsed a step, which is the reporter's 「又闪一下」
    // when they tapped the search field; the previous release's .2s max-height
    // transition only turned that step into a 150ms slow-motion lurch.
    //
    // The keyboard changes height but NOT width, so the height is tracked on a
    // monotonic rule: update only when it grows, or when the width changes
    // (rotation / real window resize). The value therefore stays at the
    // keyboard-less height, the two cards keep their size when the keyboard
    // appears, and the keyboard simply covers their lower half. Content that
    // would fall behind the keyboard gets a keyboard-sized bottom padding on
    // the scroller (layout.css.ts), which shifts nothing visible.
    let stableVh = 0
    let stableWidth = 0
    // Writing a custom property on :root invalidates style for the WHOLE
    // document, so the value is compared before the property is touched: a
    // width change that leaves the height alone (split-screen resize, a
    // rotation that lands back on the same height) used to re-run the document
    // style pass for an identical string. Measured 2026-10-09 on Android 16
    // WebView: the monotonic rule above already suppresses every keyboard
    // driven write (the keyboard only lowers the height, and a lower height
    // never passes the growth test), so no per-frame dedup is needed here —
    // this guard only removes the redundant identical writes.
    let stableValue = ''
    const syncStableViewport = (): void => {
      const height = window.innerHeight
      const width = window.innerWidth
      if (stableVh === 0 || height > stableVh || width !== stableWidth) {
        stableVh = height
        stableWidth = width
        const next = `${height}px`
        if (next !== stableValue) {
          stableValue = next
          root.style.setProperty(STABLE_VIEWPORT_VAR, next)
        }
      }
    }
    syncStableViewport()
    window.addEventListener('resize', syncStableViewport)

    return () => {
      window.removeEventListener('resize', syncStableViewport)
      stableValue = ''
      root.style.removeProperty(STABLE_VIEWPORT_VAR)
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
    const onDrawerPointerDown = (event: PointerEvent): void => {
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

/**
 * Register the shared DOM reconciler tasks. Returns a disposer that
 * unregisters every task and resets the flag, so a same-environment plugin
 * reload can rebuild the reconciler from scratch.
 *
 * @param panelExit - the sidebar-panel exit face (panel-exit.ts): its system-back
 *   route is registered here so it shares this reconciler, and the FAB reads it
 *   to switch its meaning while a panel owns the main area.
 */
export function registerReconcileTasks(ctx: ClientContext, panelExit: PanelExit): () => void {
  if (reconcileTasksRegistered) return () => {}
  reconcileTasksRegistered = true
  const t = ctx.locale.bind(NS)
  const removeTasks = [
    addReconcilerTask(createPreviewFullscreenTask(t)),
    addReconcilerTask(createPreviewCloseTask()),
    addReconcilerTask(createSheetRiseTask()),
    addReconcilerTask(createStatsLineTask()),
    addReconcilerTask(createOverlayTask(t, () => toggleDrawer(ctx), panelExit)),
    addReconcilerTask(panelExit.task),
    addReconcilerTask(createFileViewerMarkerTask()),
  ]
  return () => {
    for (const remove of removeTasks) remove()
    reconcileTasksRegistered = false
  }
}

