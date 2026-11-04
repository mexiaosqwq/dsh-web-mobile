/** The AppFrame element: direct parent of the shell overlay layer. */
export declare function findFrame(): HTMLElement | null;
/** Resolve the plugin-owned frame marker, falling back to the raw shell frame. */
export declare function getFrame(): HTMLElement | null;
/**
 * The sidebar column, i.e. the frame's drawer element.
 *
 * Hosts up to 0.2.1 kept the sidebar as the frame's first element child, so
 * every drawer rule and gesture anchored on `> :first-child`. Host 0.2.2 renders
 * a native drawer mask BEFORE the sidebar whenever the shell is in drawer mode,
 * which turned that anchor into the mask (drawer chrome drawn on the mask, real
 * drawer unstyled, gestures aimed at the mask). The column's `_sidebarCol` class
 * suffix is stable across generations (0.1.7 → 0.2.2); keep the first-child form
 * only as the fallback for a host that ever renames it.
 */
export declare function getDrawer(): HTMLElement | null;
//# sourceMappingURL=frame.d.ts.map