import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect, getFrame, addReconcilerTask } from './phone-chrome.ts'
import { markGestureConsumed, consumeIfGestured } from './gesture-guard.ts'
import type { ReconcilerTask } from '../core/reconciler-core.ts'

/**
 * Sidebar drawer swipe gestures (release-classified, no follow-the-finger
 * transform — A 档 per docs/specs/2026-08-27-sidebar-swipe-gestures.md).
 *
 * Two gestures, both a rightward stroke:
 * - edge swipe-in: the pointer goes down inside the left hotspot (24px) and
 *   the drawer is closed → opens it;
 * - content swipe-out: the pointer goes down anywhere inside the open drawer
 *   content and the drawer is open → closes it.
 *
 * On release the stroke is classified by distance ratio (of the viewport
 * width) OR recent-window velocity — whichever hits first — and the commit
 * is just `ctx.layout.toggleSidebar()`: the .28s CSS transition owned by the
 * host stylesheet drives the animation, so this layer writes ZERO inline
 * transforms and creates NO backdrop (both were the fatal flaws of the
 * follow-the-finger design).
 *
 * Coexistence with the host's overlay interactions (document capture click /
 * pointerup + the iOS self-healing re-dispatch) is via the gesture-guard
 * predicate: a classified swipe marks its target chain as consumed, the
 * host handlers' first line returns early for consumed events, and a
 * capture-phase click handler swallows the synthetic tap that follows the
 * stroke — so a swipe can never toggle twice or navigate a row.
 */

/**
 * Start-zone width for geometry hit-testing: the pointer counts as "from the
 * left edge" anywhere inside this strip. Wider than the visual hotspot
 * (24px, owned by layout.css.ts `[data-mobile-nav="hotspot"]`) on purpose —
 * the hotspot is just a hint; real fingers land 30-50px off the edge and a
 * 24px-only gate is what made swipes read as plain content scrolling
 * ("识别成对话内容滚动", 2026-08-27 user feedback). The distance / velocity
 * thresholds below still gate the commit, so widening the start zone cannot
 * accidentally open on a tap. Edge-touch priority (iOS
 * UIScreenEdgePanGestureRecognizer semantics): strokes starting here get
 * their touchmove preventDefaulted so the browser cannot claim them as
 * scrolling.
 */
const START_ZONE_PX = 48
/**
 * Axis-lock threshold: once the stroke's dominant axis has moved this far,
 * the axis is decided. Horizontal-dominant (|dx| > |dy|) locks the stroke
 * to X (a swipe); vertical-dominant abandons it to native scrolling.
 * Replaces the old 4px slop + 1.5× direction-bias pair — a 1.5× bias
 * rejected natural ~45° diagonal swipes (the other half of the
 * "识别成滚动" report). MUI uses a 3px uncertainty threshold; 8px is a
 * comfortable margin against tap jitter while still deciding in the first
 * ~16ms of movement.
 */
const LOCK_PX = 8
/** Distance thresholds as a fraction of the viewport width.
 *  Second tuning pass (2026-08-27, "识别成滚动" feedback): 0.16 open = ~62px
 *  on a 390px phone, 0.13 close = ~51px. Keep the open threshold above the
 *  close threshold so an accidental reverse swipe cannot re-open. */
const OPEN_DISTANCE_RATIO = 0.16
const CLOSE_DISTANCE_RATIO = 0.13
/** Velocity window: most-recent-60ms instantaneous speed (end-segment slope). */
const VELOCITY_WINDOW_MS = 60
/** px/ms speed thresholds for open / close (MUI uses 0.45). */
const OPEN_VELOCITY = 0.45
const CLOSE_VELOCITY = 0.45
/** Covers the .28s CSS transition; prevents reverse-gesture double-toggles. */
const COOLDOWN_MS = 350
/** How long a consumed gesture mark stays live (covers the synthetic click).
 * Short by design: browsers dispatch the synthetic click within tens of ms,
 * while iOS shells suppress it entirely — a long window with no delivery
 * would let the marks swallow the user's next genuine tap (dead-tap bug).
 * When upTo is absent from the release chain (edge swipe-in releases over
 * the main content) the mark walk reaches the document root, so this short
 * window is also the bound on how long any tap can be suppressed. */
const CONSUME_WINDOW_MS = 300

/** Pointer id we are tracking (multi-touch is ignored). */
let trackingPointer = 0
/** True once the stroke is axis-locked (direction bias passed). */
let tracking = false
/** Stroke samples (x + timestamp) for the recent-window velocity. */
let samples: Array<{ t: number; x: number }> = []
/** Stroke origin (for the direction-bias check). */
let startX = 0
let startY = 0
/** Drawer visibility at lock time. */
let lockDrawerOpen = false
/** Expiry of the post-release cooldown (performance.now()). */
let cooldownUntil = 0
/** Element whose stroke was marked consumed (null = no live mark). */
let consumedEl: Element | null = null

export interface SwipeThresholds {
  openDistanceRatio: number
  closeDistanceRatio: number
  velocityWindowMs: number
  openVelocity: number
  closeVelocity: number
  lockPx: number
  cooldownMs: number
  startZonePx: number
}

/**
 * Pure decision: what does this stroke do, given the drawer state?
 * `dx`/`dy` are raw pointer deltas (RTL mirrors X through `rtl`), `velX` is
 * the raw recent-window X velocity. The stroke must be locked horizontal
 * (|dx| > |dy| and past the lock slop) and direction-consistent; then
 * distance OR velocity wins, with the drawer-state-specific threshold.
 */
export function classifySwipe(
  t: SwipeThresholds & { viewportWidthPx: number; drawerOpen: boolean },
  m: { dx: number; dy: number; velX: number },
  rtl: boolean,
): 'open' | 'close' | 'none' {
  // RTL mirrors the X axis: a rightward stroke (positive dx in LTR) is
  // leftward in RTL. Normalize to the logical direction before judging.
  const dx = rtl ? -m.dx : m.dx
  if (Math.abs(dx) <= t.lockPx) return 'none'
  if (Math.abs(dx) <= Math.abs(m.dy)) return 'none'
  if (t.drawerOpen) {
    if (dx <= 0) return 'none'
    if (dx / t.viewportWidthPx >= t.closeDistanceRatio) return 'close'
    const velX = rtl ? -m.velX : m.velX
    return velX >= t.closeVelocity ? 'close' : 'none'
  }
  if (dx <= 0) return 'none'
  if (dx / t.viewportWidthPx >= t.openDistanceRatio) return 'open'
  const velX = rtl ? -m.velX : m.velX
  return velX >= t.openVelocity ? 'open' : 'none'
}

/**
 * Recent-window instantaneous velocity (px/ms) from the tail of the last
 * `windowMs` milliseconds of samples, up to `now`. Sliding X per ms between
 * the LAST TWO in-window samples — the end-of-stroke slope — so a long slow
 * drag then a quick flick reports the flick, not the drag average. Samples
 * older than the window are ignored. Fewer than two in-window samples → 0.
 */
export function slidingVelocity(
  samples: Array<{ t: number; x: number }>,
  windowMs: number,
  now: number,
): number {
  const cutoff = now - windowMs
  const inWindow = samples.filter((s) => s.t >= cutoff)
  if (inWindow.length < 2) return 0
  const a = inWindow[inWindow.length - 2]!
  const b = inWindow[inWindow.length - 1]!
  const dt = b.t - a.t
  if (dt <= 0) return 0
  return (b.x - a.x) / dt
}

/**
 * Geometric start-hit test: the pointer went down in the left edge start
 * zone (when the drawer is closed) or inside the drawer content area (when
 * open). Pure and viewport-relative so it is unit-testable; the runtime
 * variant additionally checks the drawer geometry via the DOM.
 */
export function hitTestStart(
  clientX: number,
  viewportWidthPx: number,
  rtl: boolean,
  t: Pick<SwipeThresholds, 'startZonePx'>,
): boolean {
  const edge = rtl ? viewportWidthPx - clientX : clientX
  return edge >= 0 && edge <= t.startZonePx
}

/** The open drawer element: first child of the plugin frame. */
function findDrawer(): HTMLElement | null {
  const frame = getFrame()
  return frame !== null && frame.firstElementChild instanceof HTMLElement
    ? frame.firstElementChild
    : null
}

/** True when the drawer is currently open (per the collapsed marker). */
function drawerOpen(): boolean {
  const frame = getFrame()
  return frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
}

/** Whether a modal dialog owns the screen (gestures must yield to it). */
function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

/** True when a full-screen takeover (taskboard / ssh) owns the frame. */
function takeoverActive(): boolean {
  return (
    document.documentElement.hasAttribute('data-dsh-taskboard-active') ||
    document.documentElement.hasAttribute('data-dsh-ssh-active')
  )
}

/** Whether the swipe layer is on cooldown (animation in flight). */
function onCooldown(): boolean {
  return performance.now() < cooldownUntil
}

/** Start a stroke; returns true when it may be tracked. */
function beginStroke(
  event: PointerEvent,
  rtl: boolean,
  viewportWidthPx: number,
): boolean {
  if (onCooldown()) return false
  if (modalOpen()) return false
  if (takeoverActive()) return false
  if (!(event.target instanceof Element)) return false
  const open = drawerOpen()
  if (open) {
    // Content swipe-out: the pointer must start over the open drawer's
    // GEOMETRY (left of the drawer's right edge), not on the backdrop (it
    // closes on tap already) and not on a session-row action menu (kebab)
    // that owns its tap. Geometry-first, because an empty drawer (hero /
    // blank phase) has no content element under the finger — the pointerdown
    // target would be the frame background, and a target-tree check would
    // wrongly reject the stroke.
    const drawer = findDrawer()
    if (drawer === null) return false
    const rect = drawer.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right) return false
    if (event.clientY < rect.top || event.clientY > rect.bottom) return false
    if (event.target.closest('[data-mobile-nav="backdrop"]') !== null) return false
    if (event.target.closest('[class*="sessionRow"] button') !== null) return false
  } else if (!hitTestStart(event.clientX, viewportWidthPx, rtl, { startZonePx: START_ZONE_PX })) {
    return false
  }
  trackingPointer = event.pointerId
  tracking = false
  startX = event.clientX
  startY = event.clientY
  samples = [{ t: event.timeStamp, x: event.clientX }]
  return true
}

/**
 * Axis-lock the stroke once its dominant axis has moved LOCK_PX. Horizontal
 * dominance (|dx| > |dy|) locks to X and is tracked; vertical dominance
 * abandons the stroke back to native scrolling (browser takes over, no
 * further preventDefault). Once locked the axis never re-decides — matching
 * MUI's UNCERTAINTY_THRESHOLD semantics.
 */
function tryLock(event: PointerEvent): boolean {
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return false
  if (Math.abs(dx) <= Math.abs(dy)) {
    // Vertical-dominant: hand the touch back to scrolling.
    reset()
    return false
  }
  tracking = true
  lockDrawerOpen = drawerOpen()
  return true
}

/** Append a sample and prune the window. */
function pushSample(event: PointerEvent): void {
  samples.push({ t: event.timeStamp, x: event.clientX })
  const cutoff = event.timeStamp - VELOCITY_WINDOW_MS
  let i = 0
  while (i < samples.length - 1 && samples[i]!.t < cutoff) i += 1
  if (i > 0) samples = samples.slice(i)
}

/** Release the stroke: classify and commit, or reset to idle. */
function endStroke(
  ctx: ClientContext,
  event: PointerEvent,
  rtl: boolean,
  viewportWidthPx: number,
): void {
  const wasTracking = tracking
  // Velocity must be computed before reset() clears the samples.
  const vel = slidingVelocity(samples, VELOCITY_WINDOW_MS, event.timeStamp)
  // Distance is measured from the stroke START (not the axis-lock point):
  // the slop is an activation gate, not travel that should consume the
  // user's swipe distance. Measuring from the lock point made the effective
  // travel = slop + threshold (e.g. 4px + 78px), so a 78px threshold
  // actually needed ~82px+ of finger travel — the "feels like half the
  // screen" complaint. From the start, a 78px threshold is a 78px swipe.
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  reset()
  if (!wasTracking) return
  if (!(event.target instanceof Element)) return
  if (modalOpen()) return
  if (onCooldown()) return
  const verdict = classifySwipe(
    {
      openDistanceRatio: OPEN_DISTANCE_RATIO,
      closeDistanceRatio: CLOSE_DISTANCE_RATIO,
      velocityWindowMs: VELOCITY_WINDOW_MS,
      openVelocity: OPEN_VELOCITY,
      closeVelocity: CLOSE_VELOCITY,
      lockPx: LOCK_PX,
      cooldownMs: COOLDOWN_MS,
      startZonePx: START_ZONE_PX,
      viewportWidthPx,
      drawerOpen: lockDrawerOpen,
    },
    { dx, dy, velX: vel },
    rtl,
  )
  if (verdict === 'none') return
  // Commit through the host layout service (same path as the toggle button),
  // then mark the stroke consumed so the tap's synthetic click cannot
  // double-toggle or navigate a row. The mark walks the ancestor chain up
  // to the DRAWER (not the frame): the synthetic click always lands on the
  // stroke's own start target (left-edge hotspot / drawer content), never
  // on the backdrop — but the backdrop is a frame child, so marking up to
  // the frame would make the host treat a genuine backdrop tap within the
  // 1s window as consumed and swallow the close (the "tap twice to close"
  // bug). The host's synthetic re-dispatched click targets the row root,
  // which sits inside the drawer and is still covered.
  const drawer = findDrawer()
  const markUpTo = drawer ?? null
  markGestureConsumed(event.target, CONSUME_WINDOW_MS, markUpTo)
  consumedEl = event.target
  ctx.layout.toggleSidebar()
  cooldownUntil = performance.now() + COOLDOWN_MS
}

/** Forget stroke state (called on cancel / visibility change / blur). */
function reset(): void {
  trackingPointer = 0
  tracking = false
  samples = []
}

/** The logical reading direction of the frame (RTL support). */
function frameRtl(): boolean {
  const frame = getFrame()
  return frame !== null && getComputedStyle(frame).direction === 'rtl'
}

/**
 * Hotspot task: keep the left-edge strip mounted while the mobile effect is
 * active, exactly like the other reconciler tasks (it is just a visual /
 * touch-affordance layer — start-hit is decided purely by geometry, so the
 * hotspot itself carries no listeners). The task runs on `data-phase` /
 * `data-sidebar-collapsed` changes so the effect re-evaluates takeovers.
 */
function createHotspotTask(): ReconcilerTask {
  let hotspot: HTMLDivElement | null = null
  return {
    name: 'sidebar-swipe-hotspot',
    scopes: ['*', 'data-sidebar-collapsed', 'data-phase'],
    ensure: () => {
      const frame = getFrame()
      if (frame === null) return
      if (takeoverActive()) {
        hotspot?.remove()
        hotspot = null
        return
      }
      if (hotspot === null) {
        hotspot = document.createElement('div')
        hotspot.dataset.mobileNav = 'hotspot'
        hotspot.setAttribute('aria-hidden', 'true')
        frame.appendChild(hotspot)
      }
    },
    dispose: () => {
      hotspot?.remove()
      hotspot = null
    },
  }
}

/** Install the gesture layer for the current mobile breakpoint. */
export function installSidebarSwipe(ctx: ClientContext): void {
  let removeHotspotTask: (() => void) | null = null
  installMobileEffect(ctx, 'dsh-mobile-nav: sidebar swipe gestures', () => {
    const viewportWidth = (): number =>
      window.innerWidth || document.documentElement.clientWidth || 0

    removeHotspotTask = addReconcilerTask(createHotspotTask())

    const onPointerDown = (event: PointerEvent): void => {
      // A new pointer starts a new interaction epoch: drop the previous
      // stroke's click gate. When the browser never delivers the synthetic
      // click (iOS shells suppress it after a swipe), this — together with
      // the short CONSUME_WINDOW_MS — keeps the next genuine tap alive
      // instead of eating it at the document-capture click handler.
      consumedEl = null
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      if (trackingPointer !== 0 && trackingPointer !== event.pointerId) return
      beginStroke(event, frameRtl(), viewportWidth())
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== trackingPointer) return
      // A modal may rise mid-stroke (e.g. an a11y trap opening); abandon.
      if (modalOpen()) {
        reset()
        return
      }
      if (!tracking) {
        if (tryLock(event)) pushSample(event)
      } else {
        pushSample(event)
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== trackingPointer) return
      endStroke(ctx, event, frameRtl(), viewportWidth())
    }

    const onPointerCancel = (event: PointerEvent): void => {
      if (event.pointerId !== trackingPointer) return
      reset()
    }

    // The browser may synthesize a click a few ms after the stroke's
    // pointerup. The host overlay handlers and the FAB / backdrop element
    // listeners would treat it as a tap; swallow it at document capture so
    // a swipe can never toggle twice or navigate a row. Non-gesture taps
    // (no live mark) pass through untouched.
    //
    // A click whose target is (or is inside) the backdrop or the FAB is
    // NEVER a gesture's synthetic click: the stroke start is always the
    // left-edge hotspot or the drawer content, never the backdrop (outside
    // the drawer, on the right) or the FAB. The mark chain can reach them
    // in degenerate hit-test cases (e.g. a stroke starting on a point where
    // the empty drawer does not register as the event target), and
    // swallowing that click would break the "tap the backdrop to close"
    // path — the "tap twice to close" bug. Let those clicks through.
    const onClick = (event: MouseEvent): void => {
      if (consumedEl === null) return
      if (!(event.target instanceof Element)) return
      if (event.target.closest('[data-mobile-nav="backdrop"], [data-mobile-nav="fab"]') !== null) return
      if (!consumeIfGestured(event)) return
      event.stopPropagation()
      event.preventDefault()
      consumedEl = null
    }

    const onVisibility = (): void => {
      if (document.hidden) reset()
    }

    // Edge-touch priority (iOS UIScreenEdgePanGestureRecognizer semantics):
    // a stroke that began inside the left-edge start zone must never be
    // claimed by native scrolling. touch-action: pan-y already forbids the
    // browser from panning it horizontally; this preventDefault (passive:
    // false) additionally stops the vertical-scroll claim, so the pointer
    // event stream reaches the gesture layer intact on browsers where the
    // scroller wins the race (iOS Safari in particular — headless cannot
    // reproduce that behavior). Vertical-dominant strokes abandon the
    // gesture (reset() clears trackingPointer), so scrolling resumes for
    // touches that were never swipes.
    const onTouchMove = (event: TouchEvent): void => {
      if (trackingPointer !== 0) event.preventDefault()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', reset)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('touchmove', onTouchMove, { capture: true } as EventListenerOptions)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', reset)
      if (removeHotspotTask !== null) {
        removeHotspotTask()
        removeHotspotTask = null
      }
      reset()
    }
  })
}
