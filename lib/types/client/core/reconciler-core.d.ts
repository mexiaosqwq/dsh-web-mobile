/**
 * Tree-change key: the sentinel for a childList record (a node was added,
 * removed or moved anywhere in the observed tree). Coarse on purpose -- one
 * observer watches the whole tree, so any structural change can invalidate a
 * task's cached node, and the core cannot know which subtree a task cares
 * about.
 */
export declare const TREE_MUTATION_SCOPE = "*";
/**
 * Text-change key: one characterData record (a text node's value was rewritten
 * in place, no node added or removed). Kept separate from the tree sentinel so
 * a task that only measures structure is not re-run for every streamed token,
 * while a task that reads text declares this key and stays woken. A text
 * reader MUST declare it next to TREE_MUTATION_SCOPE: React rebuilds a node
 * for some updates and rewrites the text in place for others, so both record
 * shapes reach a live readout.
 */
export declare const TEXT_MUTATION_SCOPE = "characterData";
/** The part of a mutation record this mapping reads (structural: no DOM). */
export interface MutationLike {
    readonly type: string;
    readonly attributeName: string | null;
}
/**
 * Map one observer record onto the dirty key it dirties: attribute records
 * route by attribute name, text records to TEXT_MUTATION_SCOPE, tree records
 * to TREE_MUTATION_SCOPE. Fail-open on the two shapes it cannot name -- an
 * attribute record without a name, and any record type this mapping does not
 * know, both widen to the tree sentinel, so a mapping gap can only cost extra
 * wakeups, never a missed one.
 */
export declare function mutationDirtyKey(record: MutationLike): string;
/** One unit of DOM reconciliation driven by the shared full-tree observer. */
export interface ReconcilerTask {
    readonly name: string;
    /**
     * Dirty keys that must be present for this task to re-run on a flush.
     * Undefined = unscoped: run on every non-empty flush (legacy behavior).
     * A key is TREE_MUTATION_SCOPE, TEXT_MUTATION_SCOPE, or an attribute name;
     * the core compares keys literally and never interprets them.
     */
    readonly scopes?: readonly string[];
    /** Called once on activation and after every matching DOM mutation. */
    ensure(): void;
    /** Called on deactivation, disposal, or explicit removal. */
    dispose(): void;
}
/**
 * Schedule `flush` on the next frame and return a cancel for a still-pending
 * frame. Injected so the core stays DOM-free: browsers pass an
 * requestAnimationFrame adapter, tests pass a manual queue.
 */
export type FrameRequest = (flush: () => void) => () => void;
/** Error sink for task failures. Defaults to a console.error shim. */
export type ReconcilerErrorHandler = (taskName: string, error: unknown, phase: 'ensure' | 'dispose') => void;
export interface ReconcilerCoreOptions {
    readonly requestFrame: FrameRequest;
    readonly onError?: ReconcilerErrorHandler;
}
export interface ReconcilerCore {
    /** Number of tasks in the registry (registered but not necessarily active). */
    readonly size: number;
    /** Register a task; the returned disposer removes and disposes it. */
    register(task: ReconcilerTask): () => void;
    /** Snapshot the registry as the active task set and run every task once. */
    activate(): void;
    /** Dispose every active task, cancel any pending frame, clear dirty keys. */
    deactivate(): void;
    /** Mark scope keys dirty and schedule one coalesced flush. */
    note(keys: Iterable<string>): void;
    /** Run dirty tasks now (activation runs everything; empty dirty runs none). */
    flush(): void;
}
export declare function createReconcilerCore(options: ReconcilerCoreOptions): ReconcilerCore;
//# sourceMappingURL=reconciler-core.d.ts.map