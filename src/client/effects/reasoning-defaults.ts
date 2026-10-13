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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from '../platform/breakpoints.ts'

/** Loader entry id whose config owns `llm-pi-ai.providers`. */
export const LLM_PI_AI_ENTRY = 'llm-pi-ai'

/**
 * Levels added to a hand-declared model that declares none — the UNION of the
 * classic OpenAI trio (`low`/`medium`/`high`) and the DeepSeek/kimi/GLM family
 * (`low`/`high`/`max`), plus `off` (`null` = omit the parameter). Kept identical
 * to the host twin's set; `src/reasoning-effort.ts` documents why the union is
 * the factory default and why `minimal`/`xhigh` stay out.
 */
export const DEFAULT_REASONING_EFFORTS: Readonly<Record<string, string | null>> = Object.freeze({
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
})

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
export const AUTO_REASONING_EFFORTS = 'auto'

/** One settings path edit, as the settings remote takes them. */
export interface SettingsPathOp {
  readonly op: 'set'
  readonly path: ReadonlyArray<string | number>
  readonly value: unknown
}

/** What one planning pass would write. */
export interface ReasoningFillPlan {
  readonly ops: SettingsPathOp[]
  readonly filled: number
  /** Entries parked in the `auto` 档 (see {@link AUTO_REASONING_EFFORTS}). */
  readonly auto: number
}

/** Structural slice of the `remote.settings` face these calls return. */
interface RemoteResponse {
  readonly ok?: unknown
  readonly value?: unknown
}

interface SettingsRemote {
  describe: () => Promise<RemoteResponse | undefined>
  mutate: (ns: string, ops: SettingsPathOp[], revision?: number) => Promise<RemoteResponse | undefined>
}

/**
 * The client-side gateway that carries HOST events (`ctx.remote.$on`).
 *
 * Host → browser events do NOT travel over the client-local bus: `ctx.on` is
 * the page's own event bus, while `settings/document-updated` is declared as an
 * `emit` remote event (`@deepseek-ai/dsh-api-remotes`) and dispatched by the
 * api-gateway service. Every official client plugin subscribes through
 * `ctx.remote.$on(event, listener)` (e.g. `dsh-client-ui-settings`,
 * `dsh-client-ui-model-selection`) — and so must we: the 2026-10-07 audit found
 * this file using `ctx.on`, so the immediate pass after a document change never
 * ran and only the slow sweep did.
 */
interface RemoteEventFace {
  $on?: (event: string, listener: (...args: unknown[]) => void) => unknown
}

/** How long one remote settings call may take before the pass gives up. */
const REMOTE_TIMEOUT_MS = 15_000

/**
 * Bound one remote call.
 *
 * `running` is cleared in `finally`, so a promise that never settles (a silent
 * carrier, a host stuck mid-write) would otherwise disable every later pass —
 * the 10s sweep included. Bounding the call keeps the fill recoverable; a write
 * that lands after its timeout is harmless, the next pass finds nothing to do.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => { reject(new Error(`settings remote did not answer within ${ms}ms`)) }, ms)
    promise.then(
      (value) => { clearTimeout(timer); resolvePromise(value) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/** Narrow one unknown value to a plain object (arrays excluded). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a model entry already carries a level set (possibly `false`). */
function hasLevels(entry: unknown): boolean {
  return isRecord(entry) && entry.reasoningEfforts !== undefined
}

/**
 * One layer's answer to "does this model take a reasoning-effort parameter?".
 *
 * `compat.supportsReasoningEffort` is a host schema field a route AND a model
 * entry may set (`@deepseek-ai/dsh-llm-pi-ai:lib/index.js:966`, offered for the
 * completion protocols at `:382`); pi-ai uses it as the gate that decides
 * whether the effort reaches the wire at all
 * (`@earendil-works/pi-ai:dist/api/openai-completions.js:622,712`). Within one
 * layer the model's own switch wins over its route's (`dsh-llm-pi-ai:lib/
 * index.js:617-625` merges route first, then model). Identical to the host
 * twin's private helper; kept in step by the parity table.
 */
function layerTakesReasoningEffort(modelCompat: unknown, routeCompat: unknown): boolean | undefined {
  const model = isRecord(modelCompat) ? modelCompat.supportsReasoningEffort : undefined
  if (typeof model === 'boolean') return model
  const route = isRecord(routeCompat) ? routeCompat.supportsReasoningEffort : undefined
  return typeof route === 'boolean' ? route : undefined
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
export function reasoningEffortDecision(
  entry: unknown,
  resolvedEntry: unknown,
  userProfile: unknown,
  resolvedProfile: unknown,
): typeof AUTO_REASONING_EFFORTS | 'fill' {
  if (!isRecord(entry)) return AUTO_REASONING_EFFORTS
  if (hasLevels(entry) || hasLevels(resolvedEntry)) return AUTO_REASONING_EFFORTS
  const user = layerTakesReasoningEffort(entry.compat, isRecord(userProfile) ? userProfile.compat : undefined)
  const resolved = layerTakesReasoningEffort(
    isRecord(resolvedEntry) ? resolvedEntry.compat : undefined,
    isRecord(resolvedProfile) ? resolvedProfile.compat : undefined,
  )
  if (user === false || resolved === false) return AUTO_REASONING_EFFORTS
  return 'fill'
}

/**
 * Plan the default-level fill for one `llm-pi-ai` section. Neither argument is
 * mutated. `resolved` decides where a level set is missing, `user` supplies what
 * may be written.
 */
export function planReasoningEffortFill(resolved: unknown, user: unknown): ReasoningFillPlan {
  const ops: SettingsPathOp[] = []
  let filled = 0
  let auto = 0
  if (!isRecord(user) || !isRecord(user.providers)) return { ops, filled, auto }
  const resolvedProviders = isRecord(resolved) && isRecord(resolved.providers) ? resolved.providers : {}

  for (const [route, userProfile] of Object.entries(user.providers)) {
    if (!isRecord(userProfile)) continue
    const resolvedProfile = isRecord(resolvedProviders[route]) ? resolvedProviders[route] : undefined

    if (Array.isArray(userProfile.models)) {
      const userModels = userProfile.models
      const resolvedModels =
        resolvedProfile !== undefined && Array.isArray(resolvedProfile.models) ? resolvedProfile.models : []
      let changed = 0
      const models: unknown[] = []
      for (const [index, entry] of userModels.entries()) {
        const resolvedEntry = resolvedModels[index]
        const decision = reasoningEffortDecision(entry, resolvedEntry, userProfile, resolvedProfile)
        if (decision === 'fill' && isRecord(entry)) {
          models.push({ ...entry, reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } })
          changed += 1
          continue
        }
        models.push(entry)
        // Count only what the `auto` 档 saves from a write: an entry that lacks
        // levels everywhere AND says it takes none. A declared set was never a
        // candidate, and a non-object entry is not a model at all — the host
        // half books those under `unresolved`, which this half does not track,
        // so both halves must agree on NOT counting them here
        // (`tests/reasoning-defaults-parity.test.ts` compares this number).
        if (isRecord(entry) && !hasLevels(entry) && !hasLevels(resolvedEntry)) auto += 1
      }
      if (changed > 0) {
        ops.push({ op: 'set', path: ['providers', route, 'models'], value: models })
        filled += changed
      }
      continue
    }
  }

  for (const [route, userProfile] of Object.entries(user.providers)) {
    if (!isRecord(userProfile) || !isRecord(userProfile.modelOverrides)) continue
    const resolvedProfile = isRecord(resolvedProviders[route]) ? resolvedProviders[route] : undefined
    const resolvedOverrides =
      resolvedProfile !== undefined && isRecord(resolvedProfile.modelOverrides)
        ? resolvedProfile.modelOverrides
        : undefined
    for (const [id, entry] of Object.entries(userProfile.modelOverrides)) {
      const resolvedOverride = resolvedOverrides?.[id]
      if (reasoningEffortDecision(entry, resolvedOverride, userProfile, resolvedProfile) !== 'fill') {
        // Record-only, exactly like the host twin's override branch.
        if (isRecord(entry) && !hasLevels(entry) && !hasLevels(resolvedOverride)) auto += 1
        continue
      }
      ops.push({
        op: 'set',
        path: ['providers', route, 'modelOverrides', id, 'reasoningEfforts'],
        value: { ...DEFAULT_REASONING_EFFORTS },
      })
      filled += 1
    }
  }

  return { ops, filled, auto }
}

/** Structural slice of the client context this installer drives. */
interface ReasoningDefaultsContext {
  get?: (service: string) => unknown
  logger?: { warn?: (message: string) => void }
}

/** Read the settings remote lazily, tolerating host shapes without it. */
function settingsRemoteOf(ctx: ReasoningDefaultsContext): SettingsRemote | undefined {
  const value = ctx.get?.('remote.settings')
  if (!isRecord(value)) return undefined
  const describe = value.describe
  const mutate = value.mutate
  if (typeof describe !== 'function' || typeof mutate !== 'function') return undefined
  return value as unknown as SettingsRemote
}

/** Read the host-event gateway lazily, tolerating host shapes without it. */
function remoteEventsOf(ctx: ReasoningDefaultsContext): RemoteEventFace | undefined {
  // ONLY `ctx.get(name)` may reach a service outside this plugin's `inject`
  // list. A property read (`ctx.remote`) throws
  // `cannot get property "remote" without inject` from the client runtime's
  // service proxy — and that read runs inside `apply()`, so the throw fails the
  // WHOLE client entry activation ("Failed to load plugins / dsh-web-mobile:
  // failed", 2026-10-07 hot-load incident). `get` reads the registry without the
  // inject requirement, which is how the settings remote above is reached too.
  let candidate: unknown
  try {
    candidate = ctx.get?.('remote')
  } catch {
    // A host whose context refuses the lookup must not fail activation either.
    return undefined
  }
  if (isRecord(candidate) && typeof candidate.$on === 'function') return candidate as unknown as RemoteEventFace
  return undefined
}

/**
 * Install the browser-half fill: one attempt at install, one short retry (the
 * remote may not have answered the first describe yet), a slow sweep for edits
 * nobody re-describes, and an immediate pass on the `llm-pi-ai` document event.
 */
export function installReasoningDefaults(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: reasoning level defaults', () => {
    const context = ctx as unknown as ReasoningDefaultsContext
    let running = false
    // Set by the disposer (plugin unload, or the breakpoint dropping back to
    // desktop): every step below re-checks it, so a resuming await stays zero-write.
    let disposed = false
    const warn = (message: string): void => {
      context.logger?.warn?.(message)
    }
    const fill = (): void => {
      if (disposed || running) return
      const remote = settingsRemoteOf(context)
      if (remote === undefined) return
      running = true
      void (async () => {
        try {
          const described = await withTimeout(remote.describe(), REMOTE_TIMEOUT_MS)
          if (disposed) return
          if (described?.ok !== true) return
          const namespaces = isRecord(described.value) ? described.value.namespaces : undefined
          if (!Array.isArray(namespaces)) return
          const section = namespaces.find((row): row is Record<string, unknown> => isRecord(row) && row.ns === LLM_PI_AI_ENTRY)
          if (section === undefined) return
          const plan = planReasoningEffortFill(section.value, section.user)
          if (plan.ops.length === 0) return
          const revision = typeof section.revision === 'number' ? section.revision : undefined
          if (disposed) return
          const response = await withTimeout(remote.mutate(LLM_PI_AI_ENTRY, plan.ops, revision), REMOTE_TIMEOUT_MS)
          if (response?.ok !== true) {
            warn('dsh-web-mobile: the host refused the reasoning-level fill')
          }
        } catch (error) {
          warn(`dsh-web-mobile: reasoning-level fill failed: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          running = false
        }
      })()
    }
    const retry = setTimeout(fill, 2_000)
    const sweep = setInterval(fill, 10_000)
    fill()
    // Host event, therefore the remote gateway — never the client-local bus.
    // The whole wiring is best-effort: this effect is an optimization over the
    // 10s sweep, so NOTHING here may throw out of `apply()` (a throwing entry
    // activation takes the entire plugin down on the page).
    let off: unknown
    try {
      off = remoteEventsOf(context)?.$on?.('settings/document-updated', (...args: unknown[]) => {
        // The payload is the changed namespace; a payload-less emit still counts
        // (the fill only writes when a level set is actually missing).
        if (args.length === 0 || args[0] === LLM_PI_AI_ENTRY) fill()
      })
    } catch (error) {
      warn(`dsh-web-mobile: reasoning-level document event unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
    return () => {
      disposed = true
      clearTimeout(retry)
      clearInterval(sweep)
      if (typeof off === 'function') off()
    }
  })
}
