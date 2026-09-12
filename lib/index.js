import { installResponseCompression } from './compress.js';
import { deleteSession } from './delete-session.js';
/** Drain a request body as UTF-8 text. */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}
/** Write one JSON response with a fixed content type. */
function respond(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
}
export const name = 'dsh-web-mobile';
export function apply(ctx) {
    // Transparent gzip/brotli for large JSON responses (long-session history
    // is megabytes on a phone). Patches http.ServerResponse.prototype; the
    // disposer restores it on plugin unload/reload.
    ctx.effect(() => installResponseCompression(), 'dsh-web-mobile: response compression');
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
                    respond(res, 405, { error: { code: 'method-not-allowed', message: 'POST required' } });
                    return;
                }
                let body;
                try {
                    body = JSON.parse(await readBody(req));
                }
                catch {
                    respond(res, 400, {
                        error: { code: 'invalid-body', message: 'expected a JSON body of the form { "sessionId": string }' },
                    });
                    return;
                }
                const { sessionId } = body;
                if (typeof sessionId !== 'string' || sessionId === '') {
                    respond(res, 400, {
                        error: { code: 'invalid-session-id', message: 'sessionId must be a non-empty string' },
                    });
                    return;
                }
                const persistence = ctx.get('sessionPersistence');
                if (persistence === undefined) {
                    respond(res, 503, {
                        error: { code: 'persistence-unavailable', message: 'session persistence is not configured' },
                    });
                    return;
                }
                const result = await deleteSession({
                    persistence: persistence,
                    sessions: ctx.get('sessions'),
                    agents: ctx.get('agents'),
                    workspaceRegistry: ctx.get('workspaceRegistry'),
                }, sessionId);
                if (result.ok) {
                    respond(res, 200, { ok: true, deleted: result.deleted });
                    return;
                }
                ctx.logger.warn(`dsh-web-mobile: session-delete failed for '${sessionId}' (${result.error.code}): ${result.error.message}`);
                respond(res, result.status, { error: result.error });
            },
        }), 'dsh-web-mobile: session-delete route');
    });
}
//# sourceMappingURL=index.js.map