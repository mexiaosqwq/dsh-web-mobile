/**
 * Gesture-consumption contract between the sidebar swipe layer and every
 * other document-level listener that would otherwise treat the release as a
 * plain tap (the overlay's drawer-close click/pointerup handlers and the
 * FAB / backdrop element listeners).
 *
 * Two independent signals, because they answer questions at different times:
 * - the axis-lock flag (`markStrokeLocked` at tryLock, i.e. during
 *   pointermove) tells a host handler running EARLIER in the same release
 *   event's capture phase that this pointerup is a swipe release, not a tap;
 * - the consume marks (`markGestureConsumed` at the gesture layer's own
 *   pointerup, after classification) cover the events that come AFTER the
 *   release.
 *
 * When the gesture layer classifies a stroke as a real swipe it calls
 * `markGestureConsumed(target, windowMs, upTo)`; any later listener that
 * calls `consumeIfGestured(event)` on the same stroke returns true and bails
 * out, so a swipe can never toggle the drawer twice or navigate a session
 * row — including the synthetic click the browser dispatches after the
 * stroke (its target is the release point or an ancestor of it, which is why
 * the mark walks the ancestor chain up to `upTo`).
 *
 * Non-gesture taps leave both signals clear, so the host's own close / tap /
 * nav-arm logic keeps working untouched.
 */

/** Marked targets with their expiry timestamp (monotonic performance.now). */
const consumed = new Map<EventTarget, number>()

/**
 * True while the live stroke is axis-locked horizontal. Unlike the consume
 * marks (written at the gesture layer's OWN pointerup, after
 * classification), this flag is written at tryLock time — during
 * pointermove, strictly before any pointerup can fire — so a host handler
 * registered earlier in the capture phase can consult it on the same
 * release event without losing the race (audit S0/S1, 2026-08-27): while
 * the flag is up, the pointerup it is seeing is a swipe release, never a
 * tap, classified or not.
 */
let strokeLocked = false

/** Flag the live stroke as axis-locked horizontal (called by tryLock). */
export function markStrokeLocked(): void {
  strokeLocked = true
}

/** Clear the axis-lock flag (called by reset and on a new pointer epoch). */
export function clearStrokeLocked(): void {
  strokeLocked = false
}

/** True while a stroke is axis-locked horizontal (host handlers yield). */
export function isStrokeLocked(): boolean {
  return strokeLocked
}

/**
 * True when the value looks like a DOM node that can carry an ancestor
 * chain. Feature-detected (no `instanceof Element`) so the guard stays
 * importable and testable in non-DOM environments (node:test).
 */
function isElementLike(value: unknown): value is { parentElement: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parentElement' in value &&
    (value as { parentElement?: unknown }).parentElement !== undefined
  )
}

/**
 * Register that the stroke ending on `target` is a gesture. The mark covers
 * `target` itself and every ancestor up to and including `upTo` (when given
 * and present in the chain), so a follow-up synthetic click — whose target
 * is usually an ancestor of the release point — is reported as consumed
 * too. Multiple marks accumulate independently and expire after `windowMs`.
 */
export function markGestureConsumed(
  target: EventTarget,
  windowMs: number,
  upTo?: Element | null,
): void {
  const until = performance.now() + windowMs
  if (!isElementLike(target)) {
    consumed.set(target, until)
    return
  }
  let el: { parentElement: unknown } | null = target
  while (el !== null) {
    consumed.set(el as unknown as EventTarget, until)
    if (el === upTo) break
    el = isElementLike(el.parentElement) ? el.parentElement : null
  }
}

/**
 * True when the event belongs to a stroke already marked as a gesture.
 * Matches the event target itself or any of its ancestors. Stale marks are
 * dropped lazily.
 */
export function consumeIfGestured(event: Event): boolean {
  const now = performance.now()
  const target = event.target
  if (!isElementLike(target)) {
    for (const [t, until] of consumed) {
      if (until <= now) consumed.delete(t)
    }
    return false
  }
  let el: { parentElement: unknown } | null = target
  while (el !== null) {
    const until = consumed.get(el as unknown as EventTarget)
    if (until !== undefined) {
      if (until <= now) {
        consumed.delete(el as unknown as EventTarget)
      } else {
        return true
      }
    }
    el = isElementLike(el.parentElement) ? el.parentElement : null
  }
  return false
}

/**
 * Test-only probe: true when a gesture mark is still live for the given
 * element (tests/sidebar-swipe.test.ts asserts expiry with it; production
 * code never calls it — the swipe layer gates on its own consumedEl
 * instead). Returns false for stale marks.
 */
export function isGestureConsumed(target: Element): boolean {
  const until = consumed.get(target)
  if (until === undefined) return false
  if (until <= performance.now()) {
    consumed.delete(target)
    return false
  }
  return true
}
