export declare const USER_ROW = "[data-chat-flow-kind=\"user\"]:not([hidden]):not([hidden] *)";
interface ChatJumpHistory<T> {
    session: T;
    eventSource?: {
        getSnapshot(): {
            hasMore: boolean;
            entries: readonly {
                type: string;
                event: {
                    type: string;
                    surfaceOp?: unknown;
                    data?: {
                        id?: unknown;
                        source?: {
                            kind?: string;
                        };
                    };
                };
            }[];
        };
    };
}
/** Whether the exhausted event window's first prompt is mounted; undefined without an exact target. */
export declare function firstPromptCommitted(binding: ChatJumpHistory<object>, row: HTMLElement | null | undefined): boolean | undefined;
/**
 * A successful history request is not a transcript commit. Wait for a prepend
 * or proof that the first prompt is already mounted. Keep the transport lock
 * when the view leaves or times out.
 */
export declare function loadChatJumpPage<T extends object & {
    loadOlder(): Promise<void>;
}>(binding: ChatJumpHistory<T>, flow: HTMLElement, signal: AbortSignal, timeout: number, inFlight: WeakSet<T>, toStart: boolean): Promise<boolean>;
export {};
//# sourceMappingURL=chat-jump-history.d.ts.map