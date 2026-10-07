/**
 * dsh-web-mobile, node half. Mostly a client UI plugin: apply() exists so the
 * plugin appears in the host Loader. It installs transparent gzip/brotli
 * compression for large JSON responses (long-session history is megabytes on
 * a phone; patches http.ServerResponse.prototype, disposer restores it), and
 * — ported from community-fork wzxmt-zhc v2.7.0 — the ONE host capability the
 * mobile drawer needs that the harness does not provide: deleting a session
 * (the host session menu only knows rename / fork / archive; archive only
 * hides a row).
 *
 * `POST /api/mobile-nav.session.delete` receives `{ sessionId }` and hands
 * the work to `deleteSession()` (see `delete-session.ts`). Services are read
 * at request time through `ctx.get()` so the row fails with a clear error
 * (never crashes) in host shapes that omit them.
 *
 * The browser half ships via exports["./client"], discovered through the
 * package.json dsh.client declaration. Host packages are intentionally NOT
 * type-imported: this repo's node_modules only carries the client-side
 * @deepseek-ai packages, so all host faces are declared structurally below.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { installResponseCompression } from './compress.js'
import { deleteSession, type DeleteSessionDeps, type DeleteSessionResult } from './delete-session.js'
import { LLM_PI_AI_ENTRY, fillReasoningEffortDefaults, type SettingsFace } from './reasoning-effort.js'

/** Minimal structural slice of the host cordis Context that apply() needs. */
export interface HostContext {
  /** Register one disposable installer; its return value disposes on unload. */
  effect(install: () => unknown, label?: string): unknown
  /** Read one optional service by name (undefined when the host omits it). */
  get(service: string): unknown
  /** Run apply once the named services exist (cordis fiber inject). */
  inject(services: readonly string[], apply: (scoped: ScopedContext) => void): void
  /** Subscribe to one host event; scoped contexts forward to their parent and
   * dispose the subscription with the scope. Absent on minimal host shapes. */
  on?(event: string, handler: (...args: unknown[]) => void): unknown
  /** Host logger service face (warn-level is all this plugin uses). */
  logger: { warn(message: string): void }
}

/** Context shape inside the `webServer` inject scope. */
export interface ScopedContext extends HostContext {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): unknown
  }
}

/** Wire contract of the session-delete endpoint. */
interface DeleteSessionBody {
  sessionId?: unknown
}

/** Maximum accepted request body size (1 MiB — the delete body is one id). */
const MAX_BODY_BYTES = 1_048_576

/** Sentinel: the request body grew past MAX_BODY_BYTES. */
class PayloadTooLargeError extends Error {}

/** Drain a request body as UTF-8 text, rejecting with PayloadTooLargeError
 * once the accumulated size exceeds MAX_BODY_BYTES. Past the limit the
 * buffered data is released and further chunks are discarded (the socket is
 * left to drain so the 413 response can actually be delivered — destroying
 * the request mid-stream would race the response and yield an empty reply). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let bytes = 0
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true
        data = ''
        return
      }
      if (!tooLarge) data += chunk
    })
    req.on('end', () => {
      if (tooLarge) reject(new PayloadTooLargeError())
      else resolve(data)
    })
    req.on('error', reject)
  })
}

/** Same-origin gate: a browser-supplied Origin header must name the same host
 * as the request itself. Missing/empty Origin = non-browser client = allowed.
 * No allowlist: localhost / 127.0.0.1 / LAN entries all work via host
 * equality, so same-origin browser POSTs (which always carry Origin) pass. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** Write one JSON response with a fixed content type. */
function respond(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Keep hand-declared `llm-pi-ai` models usable straight from the composer.
 *
 * `llm-pi-ai` describes reasoning per MODEL, so a route the user declared by
 * hand shows no 「推理等级」 control until its entries spell their levels out.
 * This installer fills the conventional set into the user's own layer (see
 * `reasoning-effort.ts` for the store contract and the safety invariants): once
 * when the settings service is available, and again whenever the `llm-pi-ai`
 * document changes — a model added in the Models page therefore gains its
 * levels without anyone editing the profile file. A host without the settings
 * service (older DSH) never registers the scope and does nothing.
 *
 * @param ctx - host context (the fill lives in the `settings` inject scope).
 */
function installReasoningEffortDefaults(ctx: HostContext): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.get('settings') as SettingsFace | undefined
    if (settings === undefined) return
    /** Delays between attempts while `llm-pi-ai` is not yet describable. */
    const RETRY_DELAYS_MS = [200, 800, 2000]
    // One fill at a time: our own write emits `settings/document-updated`, and
    // a second pass while the first is in flight would only restate it.
    let running = false
    // Set once the section was describable: the initial-pass retries and the
    // service-provision re-runs both stop there.
    let settled = false
    // Latched by the scope disposer. The retry timer is armed from INSIDE the
    // async fill's `.then`, so disposing while a fill is in flight cannot be
    // handled by clearing handles alone — without this flag that late `.then`
    // would arm a fresh timer after the scope is gone (2026-10-07 audit H1).
    let disposed = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let scheduled: ReturnType<typeof setTimeout> | undefined
    // Declared here (not at its assignment below) so the disposer registered
    // next can always reference it — the assignment happens a few statements
    // later and a synchronous dispose must not hit a TDZ (audit H2).
    let sweep: ReturnType<typeof setInterval> | undefined
    // Log the unreachable count only when it changes, so a stable profile does
    // not repeat the same line on every settings change.
    let lastUnresolved = -1
    const run = (): void => {
      if (disposed || running) return
      running = true
      void fillReasoningEffortDefaults(settings)
        .then((outcome) => {
          const retryable = outcome.status === 'unavailable' || outcome.status === 'failed'
          if (!disposed && retryable && attempts < RETRY_DELAYS_MS.length) {
            // Two transient refusals must not disable the feature:
            // · `unavailable` — `describe()` only lists ACTIVE entries, and this
            //   plugin can apply while `llm-pi-ai` is still loading;
            // · `failed` — the event that woke us is emitted from inside the
            //   settings service's own write (`describe()` detects the change
            //   there), so our batch can still collide with that transaction or
            //   with the edit that produced it. Neither is an error the user
            //   can act on, and nothing else would re-describe the section.
            timer = setTimeout(run, RETRY_DELAYS_MS[attempts++])
            return
          }
          settled = true
          if (outcome.status === 'filled') {
            settingsCtx.logger.warn(
              `dsh-web-mobile: added default reasoning levels to ${outcome.filled} hand-declared model(s)`,
            )
          } else if (outcome.status === 'failed') {
            settingsCtx.logger.warn(
              `dsh-web-mobile: reasoning-level fill gave up after ${RETRY_DELAYS_MS.length + 1} attempts: ${outcome.reason}`,
            )
          }
          if (outcome.unresolved > 0 && outcome.unresolved !== lastUnresolved) {
            settingsCtx.logger.warn(
              `dsh-web-mobile: ${outcome.unresolved} model(s) below the profile layer declare no reasoning levels and stay untouched`,
            )
          }
          lastUnresolved = outcome.unresolved
        })
        .catch((error: unknown) => {
          settingsCtx.logger.warn(
            `dsh-web-mobile: reasoning-level fill failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        .finally(() => {
          running = false
        })
    }
    settingsCtx.effect(() => () => {
      // Stop every later pass first: the retry timer is armed from inside the
      // async fill's `.then` and the sweep from a `setInterval`, so clearing
      // handles without latching `disposed` would let an in-flight fill arm a
      // new timer after disposal (audit H1/H2).
      disposed = true
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (scheduled !== undefined) clearTimeout(scheduled)
      scheduled = undefined
      if (sweep !== undefined) clearInterval(sweep)
      sweep = undefined
    })
    /**
     * Defer a fill out of the settings service's own write.
     *
     * `settings/document-updated` is emitted from inside `describe()`, which the
     * service calls while it holds its write transaction — a `mutate` issued
     * synchronously from that listener is refused as a nested transaction (the
     * same trap the community plugin documents). Leaving the current turn first
     * makes the fill a normal write again. Coalesced: one pending fill per turn.
     */
    const schedule = (): void => {
      if (disposed || scheduled !== undefined) return
      scheduled = setTimeout(() => {
        scheduled = undefined
        run()
      }, 0)
    }
    // Safety net: nothing guarantees that some other component re-describes the
    // section after a user edit (the change event is a SIDE EFFECT of the next
    // `describe()`), so a slow sweep re-reads it. `describe()` is a cheap walk
    // over the configurable entries, and the fill only writes when a level set
    // is actually missing.
    const SWEEP_INTERVAL_MS = 10_000
    sweep = setInterval(schedule, SWEEP_INTERVAL_MS)
    run()
    // A service provided later is the other moment the section can become
    // describable; stop listening once the first pass landed.
    settingsCtx.on?.('internal/service', () => {
      if (!settled) run()
    })
    settingsCtx.on?.('settings/document-updated', (...args: unknown[]) => {
      if (args[0] === LLM_PI_AI_ENTRY) schedule()
    })
  })
}

/**
 * Plugin name, per the official minimal plugin shape (name + apply). The patch
 * row in cordis.patch.yml carries the same id, so nothing resolves through this
 * value in this repo; it labels the runtime record and is what the documented
 * form declares. Kept in sync with package.json name.
 */
export const name = 'dsh-web-mobile'

export function apply(ctx: HostContext): void {
  // Transparent gzip/brotli for large JSON responses (long-session history
  // is megabytes on a phone). Patches http.ServerResponse.prototype; the
  // disposer restores it on plugin unload/reload.
  ctx.effect(() => installResponseCompression(), 'dsh-web-mobile: response compression')

  // Hand-declared custom-API models: give them the conventional thinking-level
  // set so the composer's official 「推理等级」 control is populated without
  // anyone hand-writing `reasoningEfforts` in the profile patch.
  installReasoningEffortDefaults(ctx)

  // Session-delete route (port of fork wzxmt-zhc v2.7.0). Registers once the
  // web route registry exists; the persistence / session / agent / workspace
  // services are read per request so host shapes without them degrade to a
  // structured 503 instead of a crash.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/api/mobile-nav.session.delete',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          respond(res, 405, { error: { code: 'method-not-allowed', message: 'POST required' } })
          return
        }
        if (!sameOrigin(req)) {
          respond(res, 403, { error: { code: 'cross-origin', message: 'cross-origin request rejected: Origin host does not match the request host' } })
          return
        }
        let body: DeleteSessionBody
        try {
          body = JSON.parse(await readBody(req)) as DeleteSessionBody
        } catch (error) {
          if (error instanceof PayloadTooLargeError) {
            respond(res, 413, { error: { code: 'payload-too-large', message: `request body exceeds the ${MAX_BODY_BYTES}-byte limit` } })
            return
          }
          respond(res, 400, {
            error: { code: 'invalid-body', message: 'expected a JSON body of the form { "sessionId": string }' },
          })
          return
        }
        const { sessionId } = body
        if (typeof sessionId !== 'string' || sessionId === '') {
          respond(res, 400, {
            error: { code: 'invalid-session-id', message: 'sessionId must be a non-empty string' },
          })
          return
        }

        const persistence = ctx.get('sessionPersistence')
        if (persistence === undefined) {
          respond(res, 503, {
            error: { code: 'persistence-unavailable', message: 'session persistence is not configured' },
          })
          return
        }
        // The pure core reports structured failures, but a defect or an
        // unexpected host rejection must still answer the client: this handler
        // owns the response, so it may never reject with the socket open (the
        // host's dispatcher would then answer a bare 400 with no body).
        let result: DeleteSessionResult
        try {
          result = await deleteSession({
            persistence: persistence as DeleteSessionDeps['persistence'],
            sessions: ctx.get('sessions') as DeleteSessionDeps['sessions'] | undefined,
            agents: ctx.get('agents') as DeleteSessionDeps['agents'] | undefined,
            workspaceRegistry: ctx.get('workspaceRegistry') as DeleteSessionDeps['workspaceRegistry'] | undefined,
          }, sessionId)
        } catch (error) {
          ctx.logger.warn(`dsh-web-mobile: session-delete threw for '${sessionId}': ${String(error)}`)
          respond(res, 500, { error: { code: 'delete-failed', message: 'session delete failed unexpectedly' } })
          return
        }
        if (result.ok) {
          respond(res, 200, { ok: true, deleted: result.deleted })
          return
        }
        ctx.logger.warn(
          `dsh-web-mobile: session-delete failed for '${sessionId}' (${result.error.code}): ${result.error.message}`,
        )
        respond(res, result.status, { error: result.error })
      },
    }), 'dsh-web-mobile: session-delete route')
  })
}
