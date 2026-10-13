/**
 * dsh-web-mobile, host half: default thinking-effort levels for hand-declared
 * models.
 *
 * `llm-pi-ai` describes reasoning per MODEL (`models[].reasoningEfforts`), so a
 * provider route the user declares by hand gets no 「推理等级」 control in the
 * composer until every model entry spells its levels out — which on a phone
 * means finding the profile patch file and writing YAML. This module removes
 * that step: at load, and whenever the settings document changes, it adds the
 * conventional level set to exactly those models of the USER'S OWN layer that
 * declare none.
 *
 * Store contract (DSH 0.2.0-rc.2 `entry-config` settings model, verified
 * against the installed `dsh-settings`):
 *
 *   `settings.describe()` → one descriptor per configurable Loader entry, with
 *   `ns` = the entry id (`llm-pi-ai` for `@deepseek-ai/dsh-llm-pi-ai`),
 *   `value` = the live merged section (every layer), and `user` = the profile
 *   patch layer only. `settings.mutate(ns, ops, expectedRevision)` applies
 *   ordered path ops, refusing paths the schema does not mark volatile.
 *
 * Safety invariants, all load-bearing:
 *
 * 1. Only the user's own layer is written. A model that only a lower layer
 *    supplies is counted, never materialized: `models` is an ARRAY, config
 *    layers replace arrays wholesale, so materializing one entry would drop
 *    that lower layer's `name` / `contextWindow` / `input` / `compat` for it.
 * 2. Nothing that already declares `reasoningEfforts` is touched — neither a
 *    user entry nor its resolved counterpart — so hand-written wire spellings
 *    (e.g. mapping `high` to a gateway's `ultra`) survive.
 * 3. No settings service (older hosts) means no work at all: the installer
 *    waits on the inject scope and silently does nothing when the service
 *    never arrives.
 * 4. `mutate` carries the revision read in the same pass, so a fill that races
 *    a user edit in the Models page fails the write instead of clobbering it.
 * 5. A model that says it takes no custom thinking level lands in the `auto`
 *    档 and is left ALONE — see {@link AUTO_REASONING_EFFORTS} for why "alone"
 *    means "write nothing", never "write the string `auto`", and
 *    {@link reasoningEffortDecision} for the two declarations that say it.
 *
 * The default set is deliberately the three levels an OpenAI-compatible
 * gateway accepts most often; a route needing different vocabulary declares it
 * itself, which is also the documented escape hatch (README).
 */
/** Loader entry id whose config owns `llm-pi-ai.providers`. */
export declare const LLM_PI_AI_ENTRY = "llm-pi-ai";
/**
 * Levels added to a hand-declared model that declares none.
 *
 * The UNION of the two conventions found in the wild — the classic OpenAI trio
 * (`low`/`medium`/`high`) and the DeepSeek/kimi/GLM family (`low`/`high`/`max`)
 * — plus `off`. A single-convention set leaves one family without a level it
 * supports, and this is a factory default for users whose gateways and models
 * nobody here can enumerate; the union is also a strict superset of the three
 * levels shipped before, so no install loses a level. `off` stays `null` (the
 * parameter is omitted), the most compatible way to say "off" on a custom
 * endpoint. `minimal`/`xhigh` are left out on purpose: they are the newest
 * official values and the ones gateways reject most often, and a rejected level
 * costs a failed request when the user picks it.
 * (2026-10-07 ecosystem survey: `docs/handover/2026-10-07-reasoning-defaults-*`.)
 */
export declare const DEFAULT_REASONING_EFFORTS: Readonly<Record<string, string | null>>;
/**
 * The `auto` 档 — the plugin's name for 「不干预」: leave the model's
 * `reasoningEfforts` ABSENT so the model keeps its own / the installed
 * catalog's capability, and the composer shows the host's provider-default
 * choice.
 *
 * This is NOT a host value, and must never be written into the profile.
 * Reasoning levels are a closed enum on the host — `THINKING_LEVELS`
 * (`@deepseek-ai/dsh-llm-pi-ai:lib/index.js:296-304`) holds exactly
 * `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` — and it is
 * used as the `reasoningEfforts` dict KEY type (`:1001`) and as the profile
 * `reasoning` type (`:1029`). There is **no `auto`**: the `"auto"` at `:1040`
 * belongs to `transport`, and `:2533`'s `{ auto: false }` is an unrelated
 * settings call. Handing the enum the string `auto` is refused by the schema —
 * which is the same class of mistake as the 2026-10-14 user report (a
 * hand-declared model that rejects a level errors out once the fill writes
 * one).
 *
 * The host's own spelling of "no explicit level" is the ABSENT field:
 * `resolveModelReasoning` then returns `{ reasoning: base?.reasoning ?? false }`
 * (`:566-570`), i.e. 「跟着模型自己的默认」, and the composer's effort list shows
 * the `provider-default` entry (`@deepseek-ai/dsh-client-ui-model-selection:
 * lib/client.js:565-569`).
 */
export declare const AUTO_REASONING_EFFORTS = "auto";
/**
 * Decide which 档 one model entry belongs to: `auto` (leave it alone) or
 * `fill` (give it {@link DEFAULT_REASONING_EFFORTS}).
 *
 * `auto` covers exactly the entries this feature must not touch:
 *
 * 1. Anything that is not a plain object — rewriting an array element this
 *    module cannot read is how a stray scalar becomes an object.
 * 2. An entry that already states its capability, on its own or through a
 *    lower layer — including the host's own `reasoningEfforts: false`
 *    (`dsh-llm-pi-ai:lib/index.js:1008`, resolved to `{ reasoning: false }` at
 *    `:570`), the sanctioned way to declare 「这个模型不参与思考档位」.
 * 3. An entry whose `supportsReasoningEffort` is `false` in either layer:
 *    writing levels there hands the composer levels the model refuses, and the
 *    request path throws `UNSUPPORTED_REASONING_EFFORT`
 *    (`dsh-llm-pi-ai:lib/index.js:1705-1709`) — the reported failure.
 *    A model-level `true` in the same layer outranks its route's `false`; a
 *    layer that says nothing is not evidence of absence, so it never forces
 *    `auto` on an entry the other layer is willing to fill.
 *
 * @param entry - the user-layer model entry (or `modelOverrides` value).
 * @param resolvedEntry - the same entry in the merged section, when any.
 * @param userProfile - the user-layer route object (for its route-level `compat`).
 * @param resolvedProfile - the merged route object (for its route-level `compat`).
 * @returns `AUTO_REASONING_EFFORTS` to leave the entry untouched, else `'fill'`.
 */
export declare function reasoningEffortDecision(entry: unknown, resolvedEntry: unknown, userProfile: unknown, resolvedProfile: unknown): typeof AUTO_REASONING_EFFORTS | 'fill';
/** One settings path edit, as `settings.mutate` takes them. */
export interface SettingsPathOp {
    readonly op: 'set';
    readonly path: ReadonlyArray<string | number>;
    readonly value: unknown;
}
/** What one planning pass would write, plus the entries it cannot reach. */
export interface ReasoningFillPlan {
    /** Ordered path ops; empty when every reachable model already declares levels. */
    readonly ops: SettingsPathOp[];
    /** Model entries that would receive the default level set. */
    readonly filled: number;
    /** Entries that still lack levels but live below the user's layer. */
    readonly unresolved: number;
    /**
     * Entries left at the model's own default by the `auto` 档: they lack levels
     * and declare no reasoning-effort support, so adding a level set would offer
     * the composer levels the model refuses. Counted (never written) so the log
     * can say why a hand-declared model shows no 「推理等级」 control.
     */
    readonly auto: number;
}
/**
 * Structural slice of the host settings service. Both members are optional:
 * an older host exposes a different shape, and a missing member must degrade
 * to "no fill", never to a throw.
 */
export interface SettingsFace {
    describe?: () => unknown;
    mutate?: (ns: string, ops: SettingsPathOp[], expectedRevision?: number) => unknown;
}
/**
 * Plan the default-level fill for one `llm-pi-ai` section.
 *
 * `resolved` decides WHERE a level set is missing; `user` supplies WHAT may be
 * written. Neither argument is mutated.
 *
 * @param resolved - the live merged section (`descriptor.value`).
 * @param user - the profile patch layer (`descriptor.user`).
 * @returns the ordered path ops, the number of models the fill covers, the
 *   number left unresolved below the user's layer, and the number parked in the
 *   `auto` 档.
 */
export declare function planReasoningEffortFill(resolved: unknown, user: unknown): ReasoningFillPlan;
/** Outcome of one fill attempt; `status` is what the caller logs. */
export interface ReasoningFillOutcome {
    readonly status: 'filled' | 'nothing-to-do' | 'unavailable' | 'failed';
    readonly filled: number;
    readonly unresolved: number;
    /** Entries parked in the `auto` 档 (see {@link ReasoningFillPlan.auto}). */
    readonly auto: number;
    /** Why an attempt could not land (empty when it did) — logged, never thrown. */
    readonly reason: string;
}
/**
 * Add the default level set to every reachable hand-declared model that lacks
 * one, in one `mutate` batch. Never throws: a host without the settings face,
 * a refused write, and a concurrent edit all report through the returned
 * status and `reason` (the caller decides whether to log, and a refusal is
 * worth retrying — see the installer).
 *
 * @param settings - the host settings service face.
 * @returns what happened, including the counts and reason worth logging.
 */
export declare function fillReasoningEffortDefaults(settings: SettingsFace | undefined): Promise<ReasoningFillOutcome>;
//# sourceMappingURL=reasoning-effort.d.ts.map