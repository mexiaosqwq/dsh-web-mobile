/** The AppFrame element: direct parent of the shell overlay layer. */
export declare function findFrame(): HTMLElement | null;
/** Resolve the plugin-owned frame marker, falling back to the raw shell frame. */
export declare function getFrame(): HTMLElement | null;
/**
 * The sidebar column, i.e. the frame's drawer element.
 *
 * Host 0.2.2 renders a native drawer mask BEFORE the sidebar whenever the shell
 * is in drawer mode, so a `> :first-child` anchor resolves to the mask (drawer
 * chrome drawn on the mask, real drawer unstyled, gestures aimed at the mask).
 * The column is matched by its `_sidebarCol` class suffix, which every
 * supported host (>=0.2.2-rc.1, dsh-client-ui-layout) renders; the first-child
 * fallback for pre-0.2.2 hosts was removed with the host floor.
 */
export declare function getDrawer(): HTMLElement | null;
//# sourceMappingURL=frame.d.ts.map