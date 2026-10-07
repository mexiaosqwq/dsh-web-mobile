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
 *
 * The remote is read lazily rather than injected: making `remote.settings` a
 * required fiber dependency would keep this whole plugin dormant on host
 * generations that do not provide it.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from './phone-chrome.ts'

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
 * Plan the default-level fill for one `llm-pi-ai` section. Neither argument is
 * mutated. `resolved` decides where a level set is missing, `user` supplies what
 * may be written.
 *
 * @param resolved - the live merged section (`section.value`).
 * @param user - the user layer (`section.user`).
 * @returns ordered path ops plus how many models they cover.
 */
export function planReasoningEffortFill(resolved: unknown, user: unknown): ReasoningFillPlan {
  const ops: SettingsPathOp[] = []
  let filled = 0
  if (!isRecord(user) || !isRecord(user.providers)) return { ops, filled }
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
        if (isRecord(entry) && entry.reasoningEfforts === undefined && !hasLevels(resolvedEntry)) {
          models.push({ ...entry, reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } })
          changed += 1
          continue
        }
        models.push(entry)
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
      if (!isRecord(entry) || entry.reasoningEfforts !== undefined) continue
      if (hasLevels(resolvedOverrides?.[id])) continue
      ops.push({
        op: 'set',
        path: ['providers', route, 'modelOverrides', id, 'reasoningEfforts'],
        value: { ...DEFAULT_REASONING_EFFORTS },
      })
      filled += 1
    }
  }

  return { ops, filled }
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
 *
 * @param ctx - the client plugin context.
 */
export function installReasoningDefaults(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: reasoning level defaults', () => {
    const context = ctx as unknown as ReasoningDefaultsContext
    let running = false
    const warn = (message: string): void => {
      context.logger?.warn?.(message)
    }
    const fill = (): void => {
      if (running) return
      const remote = settingsRemoteOf(context)
      if (remote === undefined) return
      running = true
      void (async () => {
        try {
          const described = await withTimeout(remote.describe(), REMOTE_TIMEOUT_MS)
          if (described?.ok !== true) return
          const namespaces = isRecord(described.value) ? described.value.namespaces : undefined
          if (!Array.isArray(namespaces)) return
          const section = namespaces.find((row): row is Record<string, unknown> => isRecord(row) && row.ns === LLM_PI_AI_ENTRY)
          if (section === undefined) return
          const plan = planReasoningEffortFill(section.value, section.user)
          if (plan.ops.length === 0) return
          const revision = typeof section.revision === 'number' ? section.revision : undefined
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
      clearTimeout(retry)
      clearInterval(sweep)
      if (typeof off === 'function') off()
    }
  })
}
