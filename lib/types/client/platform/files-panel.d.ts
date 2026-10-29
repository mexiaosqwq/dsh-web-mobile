/** Read-only DOM contract shared by Files controls and gesture routing.
 * Dockkit hosts keep the outer panel visible even while its dock is closed.
 * Session/open markers own that state; geometry is only for pre-Dockkit hosts.
 */
export declare const HOST_FILES_PANEL = "[data-sidebar-right-panel]";
export declare const HOST_FILES_HIDDEN = "[hidden], [aria-hidden=\"true\"]";
export interface FilesPanelSnapshot {
    panel: HTMLElement;
    session: string | null;
}
/** Ignore retained background SessionViews before choosing the active panel. */
export declare function readOpenFilesPanel(doc?: Pick<Document, 'querySelectorAll'>): FilesPanelSnapshot | null;
/** A stroke belongs to one panel node and Session, never its replacement. */
export declare function isCurrentFilesPanel(expected: FilesPanelSnapshot, doc?: Pick<Document, 'querySelectorAll'>): boolean;
//# sourceMappingURL=files-panel.d.ts.map