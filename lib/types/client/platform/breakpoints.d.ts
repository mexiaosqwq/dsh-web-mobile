import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
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
/** Pointer-only guard for the ONE feature that has no desktop equivalent:
 *  the session-delete menu injection. Armed on touch-primary devices at
 *  EVERY width — a large tablet in landscape (e.g. 1238px) keeps the desktop
 *  layout but still gets the 「删除会话」 item. Mouse-driven or pointer-less
 *  windows never arm it, at any width. */
export declare const TOUCH_QUERY = "(pointer: coarse)";
/**
 * Re-arm a mobile-only DOM effect on every query change. Replaces the
 * repeated matchMedia + change-listener scaffold so all breakpoint strings
 * live in one place. `query` defaults to MOBILE_QUERY; effects that arm on a
 * different condition (e.g. TOUCH_QUERY) pass their own string instead of
 * building a private matchMedia scaffold.
 */
export declare function installMobileEffect(ctx: ClientContext, label: string, install: (narrow: MediaQueryList) => (() => void) | undefined, query?: string): void;
//# sourceMappingURL=breakpoints.d.ts.map