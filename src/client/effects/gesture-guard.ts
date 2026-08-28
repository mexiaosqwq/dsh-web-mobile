/**
 * Gesture-consumption contract between the sidebar swipe layer and every
 * other document-level listener that would otherwise treat the release as a
 * plain tap (the overlay's drawer-close click/pointerup handlers, the FAB /
 * backdrop element listeners, the iOS self-healing re-dispatch path).
 *
 * The gesture layer is capture-phase and runs first on pointerdown/up/click.
 * When it classifies a stroke as a real swipe it calls
 * `markGestureConsumed(target, windowMs, upTo)`; any later listener that
 * calls `consumeIfGestured(event)` on the same stroke returns true and bails
 * out, so a swipe can never toggle the drawer twice or navigate a session
 * row — including the host's synthetic re-dispatched click (whose target is
 * the row root, an ancestor of the original release point, which is why the
 * mark walks the ancestor chain up to `upTo`).
 *
 * Non-gesture taps leave the registry empty, so the host's own close / tap /
 * self-healing logic keeps working untouched.
 */

/** Marked targets with their expiry timestamp (monotonic performance.now). */
const consumed = new Map<EventTarget, number>()

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
 * True when a gesture mark is still live for the given element (used by the
 * swipe layer itself to decide whether the release click should be blocked
 * at document capture). Returns false for stale marks.
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
