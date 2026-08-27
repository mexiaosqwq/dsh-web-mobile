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
/**
 * Register that the stroke ending on `target` is a gesture. The mark covers
 * `target` itself and every ancestor up to and including `upTo` (when given
 * and present in the chain), so a follow-up synthetic click — whose target
 * is usually an ancestor of the release point — is reported as consumed
 * too. Multiple marks accumulate independently and expire after `windowMs`.
 */
export declare function markGestureConsumed(target: EventTarget, windowMs: number, upTo?: Element | null): void;
/**
 * True when the event belongs to a stroke already marked as a gesture.
 * Matches the event target itself or any of its ancestors. Stale marks are
 * dropped lazily.
 */
export declare function consumeIfGestured(event: Event): boolean;
/**
 * True when a gesture mark is still live for the given element (used by the
 * swipe layer itself to decide whether the release click should be blocked
 * at document capture). Returns false for stale marks.
 */
export declare function isGestureConsumed(target: Element): boolean;
//# sourceMappingURL=gesture-guard.d.ts.map