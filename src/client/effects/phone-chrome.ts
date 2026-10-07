import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { consumeIfGestured, isStrokeLocked } from './gesture-guard.ts'
import { findSessionIdInFiber, isTapWithinSlop, reactFiberOf } from './session-row-fiber.ts'
import { createReconcilerCore } from '../core/reconciler-core.ts'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { currentSessionIdOf, sessionsCanOpen } from '../core/sessions-compat.ts'
import { createPreviewCloseTask, createSheetRiseTask } from './aionui-compat.ts'
import { createStatsLineTask } from './stats-line.ts'
import { createPreviewFullscreenTask } from './preview-fullscreen.ts'
import { createOverlayTask } from './overlay-backdrop-fab.ts'
import { createFileViewerMarkerTask } from './file-viewer-compat.ts'
import type { PanelExit } from './panel-exit.ts'
import { closeDrawerAnimated } from './sidebar-swipe.ts'

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

/** Long press on a session row renames it (2026-09-22 contract; the ⋯ menu is
 *  only the fallback when the title cannot be found).
 *
 *  2026-10-07（真浏览器实测，二轮）：2s 阈值配 14px 容差的组合按不出来 ——
 *  在 390×844 触屏仿真下逐项实测：
 *    · 手指完全不动，2.05s → 改名框出现（对照通过）；
 *    · 手指在 2s 内累计漂移 20px → 动作被 LONG_PRESS_MOVE_PX 静默取消，无任何反馈；
 *    · 按住 1.7s 松手 → 同样什么都不发生（2s 没到）。
 *  而人手的自然长按在 0.5~1s，2s 的保持期里累计漂移超过 14px 是常态 ⇒「长按没反应」。
 *  现在取 900ms：明显长于普通点按/「按住想一下」（≤300ms），又落在人手自然长按区间；
 *  容差同时放宽到 32px（滚动仍然照旧取消：横向由滑动手势层 8px 锁轴 + isStrokeLocked，
 *  纵向由浏览器 pan-y 的 pointercancel，见 onDrawerPointerCancel）。
 *  进度条（`data-mobile-nav-press="fill"`，base.css.ts）负责让「还在计时」看得见。 */
export const LONG_PRESS_MS = 500
/** Pointer travel that cancels a long press. 32px since 2026-10-07: the
 *  measured 20px drift over a 2s hold cancelled every attempt. Still far above
 *  the swipe layer's 8px LOCK_PX, so a horizontal stroke is cancelled through
 *  `isStrokeLocked()` and a vertical stroke through the browser's pan-y
 *  `pointercancel`. */
export const LONG_PRESS_MOVE_PX = 32
/** Hold time before the progress fill appears: a normal tap (≈100-250ms)
 *  must not flash it. */
export const LONG_PRESS_FILL_DELAY_MS = 200
/** Duration the fill animation should take so it completes exactly when the
 *  long press fires: the hold remaining after the fill delay (never negative). */
export function longPressFillMs(holdMs: number, delayMs: number): number {
  return Math.max(0, holdMs - delayMs)
}
/** Row marker while a long press is armed: any value = no callout / no text
 *  selection; `fill` = the progress fill is running. Plugin-owned attribute on
 *  a host row (React never renders it), always removed by clearPress. */
const PRESS_ATTR = 'data-mobile-nav-press'
/** Inline custom property carrying the fill duration; removed by clearPress. */
const PRESS_MS_VAR = '--mobile-nav-press-ms'
/** How long the lift may not close the menu the press opened: the host menu
 *  closes on pointerleave, and the finger lift itself fires one. */
const LONG_PRESS_MENU_GUARD_MS = 1200
/** Window in which the press's own synthesized click is swallowed, so the lift
 *  neither navigates the row nor collapses the drawer. */
const LONG_PRESS_CLICK_SWALLOW_MS = 800
/** 抬手后等这么久复核「改名 UI 是否真的出现」；没出现就退到行菜单
 *  （宿主对 blank 行不响应标题双击，模态也可能被同一手势的那一击关掉）。 */
const RENAME_SETTLE_MS = 350
/** 系统长按（Android 在约 500ms 派发 contextmenu）到这个时长就直接触发，
 *  不再等 LONG_PRESS_MS 计时器 —— 实测真机上扫光出现却什么都没发生，
 *  最可能是系统随后接管手势把我们的计时器取消掉了。 */
export const LONG_PRESS_SYSTEM_MS = 300
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
    const syncStableViewport = (): void => {
      const height = window.innerHeight
      const width = window.innerWidth
      if (stableVh === 0 || height > stableVh || width !== stableWidth) {
        stableVh = height
        stableWidth = width
        root.style.setProperty(STABLE_VIEWPORT_VAR, `${height}px`)
      }
    }
    syncStableViewport()
    window.addEventListener('resize', syncStableViewport)

    return () => {
      window.removeEventListener('resize', syncStableViewport)
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

    // 2026-09-22 交互契约（群内统一）：单击 = 选中、双击 = 打开、长按 = 改会话名。
    // 宿主 0.1.7 把「改会话名」挂在会话行标题的 dblclick 上（onRenameRequest），
    // 而这恰好是双击手势要用的那个事件：双击会既打开会话又弹改名框。所以真实
    // dblclick 在这里被吞掉（下方 onDrawerDoubleClick），长按则重放同一个事件去
    // 开宿主自己的改名框（requestRowRename）——只有我们派发的那一个事件被放行。
    // Touch has no hover, so the host's `_rowActions` — the ⋯ menu anchor — never
    // shows up by itself: only `:hover` and `menuOpen` reveal it. Long press used
    // to be the touch path to that menu; it belongs to rename now, so the mobile
    // stylesheet pins `_rowActions` open instead (删除 / 归档 / 分叉 仍有触屏入口).
    // The host menu closes on pointerleave, which the finger lift itself fires,
    // and that lift still synthesizes a click on the row: both need guarding.
    let pressTimer: number | null = null
    let pressFillTimer: number | null = null
    let pressOrigin: { x: number; y: number } | null = null
    let pressRow: HTMLElement | null = null
    let pressFired = false
    let menuGuardUntil = 0
    let swallowClickUntil = 0
    let swallowClickRow: HTMLElement | null = null
    /** 长按抬手合成的那一击「不看到哪都吞」：宿主改名弹层是模态（覆盖全屏），
       抬手时手指已经落在它的遮罩上，按目标判定就吞不到 ⇒ 弹层被自己那一击关掉，
       用户看到的就是「扫光走了、改名框没出来」。 */
    let swallowClickAnyTarget = false
    /** 抬手后的落地复核：改名 UI 没站住就退到行菜单。 */
    let renameSettleTimer: number | null = null
    /** 本次按住的起点时刻（判断系统长按是否已经够久）。 */
    let pressStartedAt = 0

    /** Drop the press marker and the inline duration variable from a row —
     *  only our own attribute/property, never the host's class or style. */
    const unmarkPressRow = (row: HTMLElement): void => {
      row.removeAttribute(PRESS_ATTR)
      row.style.removeProperty(PRESS_MS_VAR)
    }

    const clearPress = (): void => {
      if (pressTimer !== null) window.clearTimeout(pressTimer)
      pressTimer = null
      if (pressFillTimer !== null) window.clearTimeout(pressFillTimer)
      pressFillTimer = null
      if (pressRow !== null) unmarkPressRow(pressRow)
      pressOrigin = null
      pressRow = null
      pressFired = false
    }

    const openRowMenu = (row: HTMLElement): void => {
      // A menu already on screen owns the gesture (host touch path, another
      // plugin's long press); clicking the anchor again would close it.
      if (document.querySelector('[role="menu"]') !== null) return
      const button = row.querySelector<HTMLButtonElement>('[class*="_rowActions"] button')
      if (button === null) return
      menuGuardUntil = performance.now() + LONG_PRESS_MENU_GUARD_MS
      button.click()
    }

    /** 触发之后的收尾：抬手那一击必须吞掉（宿主改名弹层是模态，会盖住手指），
     *  并在稍后复核改名 UI 是否真的站住，没站住就退到行菜单。 */
    const afterFire = (row: HTMLElement): void => {
      swallowClickUntil = performance.now() + LONG_PRESS_CLICK_SWALLOW_MS
      swallowClickRow = row
      swallowClickAnyTarget = true
      if (renameSettleTimer !== null) window.clearTimeout(renameSettleTimer)
      renameSettleTimer = window.setTimeout(() => {
        renameSettleTimer = null
        if (!row.isConnected) return
        if (document.querySelector('[class*="_renameInput"]') === null) openRowMenu(row)
      }, RENAME_SETTLE_MS)
    }

    /** 长按到点（计时器 / 系统 contextmenu / 系统接管时的 pointercancel，任一先到，只生效一次）。 */
    const firePress = (): void => {
      const row = pressRow
      if (row === null || pressFired) return
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer)
        pressTimer = null
      }
      if (pressFillTimer !== null) {
        window.clearTimeout(pressFillTimer)
        pressFillTimer = null
      }
      pressFired = true
      // The hold is over: the fill has done its job, drop the marker before
      // the rename dialog opens (pressRow stays for the lift's click swallow).
      unmarkPressRow(row)
      // 长按 = 改会话名。拿不到标题（宿主标记变了）就退回 ⋯ 菜单：长按至少还能
      // 到达行操作，而不是变成一个什么都不做的死手势。
      if (!requestRowRename(row)) openRowMenu(row)
      afterFire(row)
    }

    /** The only `dblclick`s allowed through to the host are the ones we
     *  dispatch ourselves: a real one is the double *tap* that means "open the
     *  session", and letting it reach the title would open the rename dialog on
     *  the same gesture. Identity, not a flag on the event: nothing else can
     *  forge it. */
    const syntheticDoubleClicks = new WeakSet<Event>()

    /** 长按 = 改会话名：宿主把改名挂在标题的 dblclick 上，这里重放那个事件，
     *  而不是复制一套弹窗链路（宿主的 rename 状态机是包内私有的）。
     *  @returns 是否成功派发；宿主标记变了、拿不到标题时为 false，调用方回退。 */
    const requestRowRename = (row: HTMLElement): boolean => {
      const title = row.querySelector<HTMLElement>('[class*="_title"]')
      if (title === null) return false
      const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window })
      syntheticDoubleClicks.add(event)
      title.dispatchEvent(event)
      return true
    }

    /** Swallow the host's title-double-click rename (the 2026-09-22 contract puts
     *  rename on long press, and double tap on "open"). Capture phase on
     *  `document`, so the event never reaches React's root container and the
     *  title's own onDoubleClick cannot run. Armed only inside the mobile
     *  environment (this effect is MOBILE_QUERY-gated), so mouse-driven desktops
     *  keep the host behaviour untouched. */
    const onDrawerDoubleClick = (event: MouseEvent): void => {
      if (syntheticDoubleClicks.has(event)) return
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

    const onDrawerPointerDown = (event: PointerEvent): void => {
      touchDownAt = event.pointerType === 'touch' || event.pointerType === 'pen'
        ? { x: event.clientX, y: event.clientY }
        : null
      clearPress()
      // 新手势开始：上一轮的「任意目标吞击」到此为止（WebView 不补 click 时不会残留）。
      swallowClickAnyTarget = false
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      if (isStrokeLocked()) return
      const target = event.target
      // isDrawerNavTarget already means "inside the drawer, on a row navigation
      // target, and not on one of its buttons" — and it must stay the
      // exemption-free base: arming long-press through the tap-close predicate
      // made DSHA rows un-armable, killing their only touch path to the ⋯ menu.
      if (!isDrawerNavTarget(target) || !(target instanceof Element)) return
      const row = target.closest<HTMLElement>('[class*="_sessionRow"]')
      if (row === null || target.closest('[class*="_rowActions"]') !== null) return
      pressOrigin = { x: event.clientX, y: event.clientY }
      pressRow = row
      pressStartedAt = performance.now()
      // Armed from the first frame: CSS turns off the system callout and text
      // selection on the row, so neither can start inside the 2s hold.
      row.setAttribute(PRESS_ATTR, 'armed')
      pressFillTimer = window.setTimeout(() => {
        pressFillTimer = null
        if (pressRow === null) return
        pressRow.style.setProperty(PRESS_MS_VAR, `${longPressFillMs(LONG_PRESS_MS, LONG_PRESS_FILL_DELAY_MS)}ms`)
        pressRow.setAttribute(PRESS_ATTR, 'fill')
      }, LONG_PRESS_FILL_DELAY_MS)
      pressTimer = window.setTimeout(firePress, LONG_PRESS_MS)
    }

    // The browser claimed the stroke (pan-y scroll start, a system gesture, a
    // drag): no pointermove/pointerup follows, so without this the 2s timer
    // would keep counting and rename a row mid-scroll.
    const onDrawerPointerCancel = (event: PointerEvent): void => {
      // 真机实测（店主）：进度扫光走到一半就消失、改名框始终不出现 —— 按住被
      // 中途取消，计时器根本没跑到。系统（Android 自己的长按/选择/滚动接管）取消
      // 掉这一笔时，如果手指其实没怎么动、而且已经按住过系统长按的时长，那这次
      // 接管就**正是用户要的长按**：直接触发，而不是把整个手势丢掉。
      // 真滚动/真滑动会在取消之前先累积位移（> LONG_PRESS_MOVE_PX）或先锁轴，
      // 那两条路径仍然走 clearPress（不触发）。
      const heldMs = performance.now() - pressStartedAt
      const movedPx = pressOrigin === null
        ? 0
        : Math.max(Math.abs(event.clientX - pressOrigin.x), Math.abs(event.clientY - pressOrigin.y))
      if (pressRow !== null && !pressFired && heldMs >= LONG_PRESS_SYSTEM_MS && movedPx <= LONG_PRESS_MOVE_PX) {
        firePress()
        return
      }
      clearPress()
    }

    // Android dispatches contextmenu ~500ms into a touch hold — well inside the
    // 2s window. Left alone it may open the system callout / start a text
    // selection, either of which pointercancels the stroke and kills the
    // timer. Only while OUR press is counting, only on the pressed row.
    const onDrawerContextMenu = (event: MouseEvent): void => {
      if (pressTimer === null || pressRow === null) return
      const target = event.target
      if (!(target instanceof Node) || !pressRow.contains(target)) return
      event.preventDefault()
      event.stopPropagation()
      // Android 的系统长按就在这个事件上（约 500ms）：它一到就直接触发，
      // 不再赌 LONG_PRESS_MS 计时器能活到点（真机实测扫光出现却什么都没发生）。
      if (performance.now() - pressStartedAt >= LONG_PRESS_SYSTEM_MS) firePress()
    }

    const onDrawerPointerMove = (event: PointerEvent): void => {
      if (pressOrigin === null) return
      if (isStrokeLocked()) {
        clearPress()
        return
      }
      if (
        Math.abs(event.clientX - pressOrigin.x) > LONG_PRESS_MOVE_PX
        || Math.abs(event.clientY - pressOrigin.y) > LONG_PRESS_MOVE_PX
      ) {
        clearPress()
      }
    }

    // The host menu closes on pointerleave of its anchor; the finger lift fires
    // one right after the press opened the menu, so stay out of the way until
    // the finger is long gone.
    const onDrawerPointerLeave = (event: PointerEvent): void => {
      if (performance.now() > menuGuardUntil) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[class*="_rowActions"]') === null
        && target.closest('[class*="_sessionRow"]') === null) return
      event.stopPropagation()
    }

    const onDrawerClick = (event: MouseEvent): void => {
      // The long press's own synthesized click is the one click that must not
      // act: the row was not tapped, and the menu it opened must survive. One
      // click only — a later tap on the ⋯ reaches React normally.
      const target = event.target
      if (swallowClickRow !== null && performance.now() <= swallowClickUntil) {
        const insideRow = target instanceof Element
          && (target === swallowClickRow || swallowClickRow.contains(target))
        if (insideRow || swallowClickAnyTarget) {
          swallowClickUntil = 0
          swallowClickRow = null
          swallowClickAnyTarget = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
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
      if (isStrokeLocked() || consumeIfGestured(event)) {
        // The finger is up either way: a yielded release must still disarm the
        // press, or a stale 2s timer renames the row after the lift.
        clearPress()
        return
      }
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      const pressed = pressFired
      const pressedRow = pressRow
      clearPress()
      if (pressed && pressedRow !== null) {
        // The press already opened the menu: the lift must not also navigate
        // or close the drawer. The swallow is target-blind for this one click
        // (the rename modal covers the finger), and a short settle check turns
        // 「改名 UI 没出来」 into the row menu instead of a dead gesture.
        afterFire(pressedRow)
        return
      }
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
    document.addEventListener('pointermove', onDrawerPointerMove, true)
    document.addEventListener('pointerleave', onDrawerPointerLeave, true)
    document.addEventListener('pointerup', onDrawerPointerUp, true)
    document.addEventListener('pointercancel', onDrawerPointerCancel, true)
    document.addEventListener('contextmenu', onDrawerContextMenu, true)
    return () => {
      disarmNav()
      // Also marks the close spent, so a queued `fire` cannot outlive the effect.
      disarmCloseOnNav()
      touchDownAt = null
      clearPress()
      document.removeEventListener('dsha-session-open', onDshaSessionOpen)
      document.removeEventListener('dblclick', onDrawerDoubleClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('click', onDrawerClick, true)
      document.removeEventListener('pointerdown', onDrawerPointerDown, true)
      document.removeEventListener('pointermove', onDrawerPointerMove, true)
      document.removeEventListener('pointerleave', onDrawerPointerLeave, true)
      document.removeEventListener('pointerup', onDrawerPointerUp, true)
      document.removeEventListener('pointercancel', onDrawerPointerCancel, true)
      document.removeEventListener('contextmenu', onDrawerContextMenu, true)
      if (renameSettleTimer !== null) window.clearTimeout(renameSettleTimer)
      renameSettleTimer = null
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

