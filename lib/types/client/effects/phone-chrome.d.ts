import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { ReconcilerTask } from '../core/reconciler-core.ts';
/** Same width bound as the shell's SIDEBAR_AUTO_COLLAPSE (viewport < 1024),
 *  ANDed with a touch-primary pointer guard. Width alone cannot tell a phone
 *  from a desktop window: split views and OS display scaling push a PC's CSS
 *  viewport below 1024px too, and the whole mobile shell (drawer, header
 *  Files button, gestures) would mount there. (pointer: coarse) keeps the
 *  adaptation on touch-primary devices — phones, tablets, DSHA — while any
 *  mouse-driven window stays desktop at every width. Headless probes have no
 *  pointer at all: arm the mobile branch with Emulation.setTouchEmulation-
 *  Enabled before asserting mobile UI. */
export declare const MOBILE_QUERY = "(max-width: 1023px) and (pointer: coarse)";
/** Informational wide-bound for the debug badge. The authoritative desktop
 *  guard is the CSS hide block in misc.css.ts — the exact complement of
 *  MOBILE_QUERY — because slot-rendered controls exist at every width. */
export declare const DESKTOP_QUERY = "(min-width: 1024px)";
/**
 * Re-arm a mobile-only DOM effect on every width change. Replaces the
 * repeated matchMedia + change-listener scaffold so all breakpoint strings
 * live in one place.
 */
export declare function installMobileEffect(ctx: ClientContext, label: string, install: (narrow: MediaQueryList) => (() => void) | undefined): void;
/** The AppFrame element: direct parent of the shell overlay layer. */
export declare function findFrame(): HTMLElement | null;
/** Resolve the plugin-owned frame marker, falling back to the raw shell frame. */
export declare function getFrame(): HTMLElement | null;
/**
 * Frame marker controller: owns `data-mobile-nav="frame"` and every plugin
 * marker that can survive on the shell-owned frame. Installed once at apply
 * time so effects no longer each need to find/set/clear the frame. Returns a
 * disposer that unregisters the task and resets the installed flag, so a
 * same-environment plugin reload can rebuild the reconciler from scratch.
 */
export declare function installFrameController(): () => void;
/**
 * One unit of DOM reconciliation driven by the shared full-tree observer.
 * Defined in the DOM-free core so registration / dirty routing / coalescing
 * are unit-testable; kept reachable from here so the third-party task modules
 * (aionui-compat, stats-line) keep importing it via `./phone-chrome.ts`.
 */
export type { ReconcilerTask } from '../core/reconciler-core.ts';
/**
 * One full-tree MutationObserver for every mobile DOM reconciler. Tasks can be
 * registered from React or plain effects; they only run while the mobile
 * breakpoint is active and are re-armed automatically on width changes.
 */
export declare function installReconciler(ctx: ClientContext): () => void;
/** Register a reconciler task. The returned disposer removes it immediately. */
export declare function addReconcilerTask(task: ReconcilerTask): () => void;
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
export declare function detectIosWebKit(nav: {
    userAgent: string;
    maxTouchPoints: number;
}, supports: ((condition: string) => boolean) | null): boolean;
export declare function installPhoneChrome(ctx: ClientContext): void;
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
export declare function installOverlayInteractions(ctx: ClientContext): void;
/**
 * Register the shared DOM reconciler tasks. Returns a disposer that
 * unregisters every task and resets the flag, so a same-environment plugin
 * reload can rebuild the reconciler from scratch.
 */
export declare function registerReconcileTasks(ctx: ClientContext): () => void;
//# sourceMappingURL=phone-chrome.d.ts.map