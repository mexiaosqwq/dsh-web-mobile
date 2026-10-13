/**
 * CSS custom property carrying the viewport height WITHOUT the soft keyboard
 * (px), maintained by `syncStableViewportHeight()` in this module. Mobile
 * cards that must not move when the keyboard appears size themselves with it
 * instead of a viewport unit — see the settings sheet / shortcut card rules in
 * layout.css.ts.
 *
 * 本模块不自起 effect：`syncStableViewportHeight()` 是返回 disposer 的普通函数，
 * 调用方是 phone-chrome 的 status-bar effect（P1 拆分第五片，2026-10-12）。
 */
export declare const STABLE_VIEWPORT_VAR = "--dsh-web-mobile-vh";
/** Viewport meta ownership: re-assert our content on every host rewrite, node
 *  replacement, or late injection while the mobile branch is armed. */
export declare function preserveViewportMeta(): () => void;
/** The keyboard-less viewport height (STABLE_VIEWPORT_VAR). */
export declare function syncStableViewportHeight(): () => void;
/** iOS-only: mark documentElement so the stylesheet can hold text fields at
 *  >=16px and Safari never focus-zooms the viewport (#45). */
export declare function applyIosMarker(isIosWebKit: boolean): (() => void) | undefined;
//# sourceMappingURL=viewport-meta.d.ts.map