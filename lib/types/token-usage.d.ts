/**
 * dsh-web-mobile, host half: lifetime token accounting.
 *
 * Folds the durable session corpus into ONE figure: every token the harness
 * has ever billed, across all sessions of all workspaces — the number the
 * drawer footer's 「总消耗 Token」 pill shows. The per-session sessionStats
 * projection only carries turn/step counts and wall times, and the turn
 * usage panel only knows the current conversation, so this module reads the
 * session corpus directly through the host's sessionQuery service (the same
 * service the community usage plugins fold).
 *
 * Accounting rule (mirrors the ecosystem's 「总花费 Token」 semantics):
 * for every `assistant/message` event whose data carries a projected usage,
 * add input + output + cache read + cache write + reasoning tokens. Stream
 * chunks are deliberately ignored — the projected `data.usage` is the
 * settled value the host already folded from the final stream chunk, and a
 * chunk-level fallback would double-count once both shapes coexist.
 *
 * The pure fold takes a structural `sessionQuery` slice (never a harness
 * import) so it unit-tests with synthetic sessions; unreadable sessions are
 * skipped and counted as failed, never failing the whole aggregate.
 */
/** Structural sessionQuery slice this fold needs (the host service is never imported). */
export interface TokenUsageQuery {
    /** List every persisted session in the corpus (generation-agnostic entries). */
    listSessions(): Promise<unknown[]>;
    /** Read one complete session log snapshot (live-preferred). */
    readSession(sessionId: string): Promise<unknown>;
}
/** Dependencies of the aggregate fold; injected per request. */
export interface TokenUsageDeps {
    sessionQuery?: TokenUsageQuery;
}
/** One settled aggregate. */
export interface TokenUsageResult {
    ok: boolean;
    /** Sum of input + output + cache read/write + reasoning tokens across all sessions. */
    totalTokens: number;
    /** Sessions that contributed at least one usable read. */
    sessions: number;
    /** Sessions whose log could not be read (skipped, not fatal). */
    failed: number;
}
/**
 * Aggregate lifetime token usage from the session corpus.
 * @param deps - Injected services; the fold never imports the harness.
 * @returns The settled total; unavailable corpus yields `ok: false`.
 */
export declare function aggregateTokenUsage(deps: TokenUsageDeps): Promise<TokenUsageResult>;
//# sourceMappingURL=token-usage.d.ts.map