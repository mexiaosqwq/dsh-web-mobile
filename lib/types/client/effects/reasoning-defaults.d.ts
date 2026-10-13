/**
 * dsh-web-mobile: default thinking levels for hand-declared `llm-pi-ai` models,
 * browser half.
 *
 * `llm-pi-ai` describes reasoning per MODEL (`models[].reasoningEfforts`), so a
 * provider route the user declared by hand offers no 「推理等级」 in the composer
 * until its entries spell their levels out. This effect fills the conventional
 * set into the user's own layer through the HOST settings remote, exactly like
 * the host-half twin (`src/reasoning-effort.ts`) — keep the two in step.
 *
 * Why the same job exists in both halves:
 *
 * · The host half covers every install: it runs inside the DSH host and works
 *   on hosts whose client remote is unavailable.
 * · The browser half is the one that can fix a DSHA phone. DSHA replays its
 *   signed builtin payload at every app start, so a hot-loaded host half never
 *   takes effect there (`dsh web` imports the plugin once, at startup) — while
 *   the browser half hot-reloads with the page and the settings remote is
 *   ordinary DSH machinery, not our code.
 *
 * Rules (identical to the host twin, and load-bearing):
 *
 * 1. Only the user's own layer is filled. `models` is an ARRAY and config layers
 *    replace arrays wholesale, so materializing an entry that only a lower layer
 *    supplies would drop that layer's `name`/`contextWindow`/`input`/`compat`.
 * 2. Nothing that already declares `reasoningEfforts` is touched — hand-written
 *    wire spellings survive.
 * 3. Mobile-only (`installMobileEffect`): the plugin's desktop contract is a
 *    complete no-op, and desktop installs keep the host half.
 * 4. A model that declares no reasoning-effort support lands in the `auto` 档
 *    and is left at its own default; see {@link AUTO_REASONING_EFFORTS} and
 *    {@link reasoningEffortDecision}.
 *
 * The remote is read lazily rather than injected: making `remote.settings` a
 * required fiber dependency would keep this whole plugin dormant on host
 * generations that do not provide it.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Loader entry id whose config owns `llm-pi-ai.providers`. */
export declare const LLM_PI_AI_ENTRY = "llm-pi-ai";
/**
 * Levels added to a hand-declared model that declares none — the UNION of the
 * classic OpenAI trio (`low`/`medium`/`high`) and the DeepSeek/kimi/GLM family
 * (`low`/`high`/`max`), plus `off` (`null` = omit the parameter). Kept identical
 * to the host twin's set; `src/reasoning-effort.ts` documents why the union is
 * the factory default and why `minimal`/`xhigh` stay out.
 */
export declare const DEFAULT_REASONING_EFFORTS: Readonly<Record<string, string | null>>;
/**
 * The `auto` 档: the plugin's name for 「不干预」 — leave the model's
 * `reasoningEfforts` ABSENT so it keeps its own / the catalog's capability and
 * the composer shows the host's provider-default choice.
 *
 * NOT a host value; never write this string into the profile. The host's level
 * enum is closed — `THINKING_LEVELS`, `@deepseek-ai/dsh-llm-pi-ai:lib/index.js:
 * 296-304` = `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`,
 * used as the `reasoningEfforts` dict KEY type (`:1001`) and the profile
 * `reasoning` type (`:1029`) — and it has no `auto` (the `"auto"` at `:1040` is
 * `transport`'s). Hard-writing the string is refused by the schema; the host's
 * own word for 「不写档位」 is the absent field (`resolveModelReasoning`,
 * `:566-570`). `src/reasoning-effort.ts` carries the full evidence trail — the
 * two halves cannot share a module (see the header above), so this constant and
 * {@link reasoningEffortDecision} are duplicated there on purpose and held in
 * step by `tests/reasoning-defaults-parity.test.ts`.
 */
export declare const AUTO_REASONING_EFFORTS = "auto";
/** One settings path edit, as the settings remote takes them. */
export interface SettingsPathOp {
    readonly op: 'set';
    readonly path: ReadonlyArray<string | number>;
    readonly value: unknown;
}
/** What one planning pass would write. */
export interface ReasoningFillPlan {
    readonly ops: SettingsPathOp[];
    readonly filled: number;
    /** Entries parked in the `auto` 档 (see {@link AUTO_REASONING_EFFORTS}). */
    readonly auto: number;
}
/**
 * Decide which 档 one model entry belongs to: `auto` (leave it alone) or `fill`.
 *
 * `auto` covers exactly the entries this feature must not touch: a non-object
 * entry; an entry that already states its capability on its own or through a
 * lower layer (the host's `reasoningEfforts: false`, `dsh-llm-pi-ai:lib/
 * index.js:1008` → `{ reasoning: false }` at `:570`, is its sanctioned spelling
 * of 「不参与思考档位」); and an entry whose `supportsReasoningEffort` is `false`
 * in either layer — filling that one offers the composer levels the model
 * refuses, and the request path throws `UNSUPPORTED_REASONING_EFFORT`
 * (`:1705-1709`). A layer that says nothing never forces `auto`.
 *
 * Same rules as the host twin (`src/reasoning-effort.ts`), which documents the
 * full evidence trail; the two are held in step by
 * `tests/reasoning-defaults-parity.test.ts`.
 */
export declare function reasoningEffortDecision(entry: unknown, resolvedEntry: unknown, userProfile: unknown, resolvedProfile: unknown): typeof AUTO_REASONING_EFFORTS | 'fill';
/**
 * Plan the default-level fill for one `llm-pi-ai` section. Neither argument is
 * mutated. `resolved` decides where a level set is missing, `user` supplies what
 * may be written.
 */
export declare function planReasoningEffortFill(resolved: unknown, user: unknown): ReasoningFillPlan;
/**
 * Install the browser-half fill: one attempt at install, one short retry (the
 * remote may not have answered the first describe yet), a slow sweep for edits
 * nobody re-describes, and an immediate pass on the `llm-pi-ai` document event.
 */
export declare function installReasoningDefaults(ctx: ClientContext): void;
//# sourceMappingURL=reasoning-defaults.d.ts.map