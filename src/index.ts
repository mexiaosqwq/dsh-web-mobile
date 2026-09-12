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
import { deleteSession, type DeleteSessionDeps } from './delete-session.js'

/** Minimal structural slice of the host cordis Context that apply() needs. */
export interface HostContext {
  /** Register one disposable installer; its return value disposes on unload. */
  effect(install: () => unknown, label?: string): unknown
  /** Read one optional service by name (undefined when the host omits it). */
  get(service: string): unknown
  /** Run apply once the named services exist (cordis fiber inject). */
  inject(services: readonly string[], apply: (scoped: ScopedContext) => void): void
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

/** Drain a request body as UTF-8 text. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
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

export const name = 'dsh-web-mobile'

export function apply(ctx: HostContext): void {
  // Transparent gzip/brotli for large JSON responses (long-session history
  // is megabytes on a phone). Patches http.ServerResponse.prototype; the
  // disposer restores it on plugin unload/reload.
  ctx.effect(() => installResponseCompression(), 'dsh-web-mobile: response compression')

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
        let body: DeleteSessionBody
        try {
          body = JSON.parse(await readBody(req)) as DeleteSessionBody
        } catch {
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
        const result = await deleteSession({
          persistence: persistence as DeleteSessionDeps['persistence'],
          sessions: ctx.get('sessions') as DeleteSessionDeps['sessions'] | undefined,
          agents: ctx.get('agents') as DeleteSessionDeps['agents'] | undefined,
          workspaceRegistry: ctx.get('workspaceRegistry') as DeleteSessionDeps['workspaceRegistry'] | undefined,
        }, sessionId)
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
