import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export interface SwipeThresholds {
    openDistanceRatio: number;
    closeDistanceRatio: number;
    velocityWindowMs: number;
    openVelocity: number;
    closeVelocity: number;
    lockPx: number;
    cooldownMs: number;
    startZonePx: number;
}
/**
 * Pure decision: what does this stroke do, given the drawer state?
 * `dx`/`dy` are raw pointer deltas (RTL mirrors X through `rtl`), `velX` is
 * the raw recent-window X velocity. The stroke must be locked horizontal
 * (|dx| > |dy| and past the lock slop) and direction-consistent; then
 * distance OR velocity wins, with the drawer-state-specific threshold.
 */
export declare function classifySwipe(t: SwipeThresholds & {
    viewportWidthPx: number;
    drawerOpen: boolean;
}, m: {
    dx: number;
    dy: number;
    velX: number;
}, rtl: boolean): 'open' | 'close' | 'none';
/**
 * Recent-window instantaneous velocity (px/ms) from the tail of the last
 * `windowMs` milliseconds of samples, up to `now`. Sliding X per ms between
 * the LAST TWO in-window samples — the end-of-stroke slope — so a long slow
 * drag then a quick flick reports the flick, not the drag average. Samples
 * older than the window are ignored. Fewer than two in-window samples → 0.
 */
export declare function slidingVelocity(samples: Array<{
    t: number;
    x: number;
}>, windowMs: number, now: number): number;
/**
 * Geometric start-hit test: the pointer went down in the left edge start
 * zone (when the drawer is closed) or inside the drawer content area (when
 * open). Pure and viewport-relative so it is unit-testable; the runtime
 * variant additionally checks the drawer geometry via the DOM.
 */
export declare function hitTestStart(clientX: number, viewportWidthPx: number, rtl: boolean, t: Pick<SwipeThresholds, 'startZonePx'>): boolean;
/** Install the gesture layer for the current mobile breakpoint. */
export declare function installSidebarSwipe(ctx: ClientContext): void;
//# sourceMappingURL=sidebar-swipe.d.ts.map