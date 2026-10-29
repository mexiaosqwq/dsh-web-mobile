/** The host composer seat, including the question-card variant rendered inside it. */
export declare const COMPOSER_SEAT_SELECTOR = "[data-composer-seat], [class*=\"_composerSeat\"]";
/** Host conversation roots observed in 0.2.1 and the structural fallback. */
export declare const CONVERSATION_ROOT_CLASS_SELECTOR = ".wSkVaW_root[data-phase]";
export declare const CONVERSATION_PHASE_SELECTOR = "[data-phase]";
/** Whether a node is an editable surface rather than a control that merely has focus. */
export declare function isEditableElement(element: Element): boolean;
/** Find the nearest editable ancestor for activeElement (contenteditable descendants included). */
export declare function closestEditable(element: Element | null): HTMLElement | null;
/** Find the conversation root without depending on the hashed class alone. */
export declare function findConversationRoot(node: Element | null): HTMLElement | null;
/** Find the seat that owns an editable, including an answer field in a question card. */
export declare function findComposerSeat(node: Element | null): HTMLElement | null;
/** Visible, connected focus is required; stale DOM focus must never own a keyboard episode. */
export declare function isVisibleFocusedEditable(element: HTMLElement | null): boolean;
/** The active conversation editable, or null for settings/panels/other apps. */
export declare function findConversationEditable(root?: HTMLElement | null): HTMLElement | null;
/** Read the root-local visible band, if a scope effect published one. */
export declare function readConversationHeight(root: HTMLElement | null): number;
//# sourceMappingURL=composer-focus.d.ts.map