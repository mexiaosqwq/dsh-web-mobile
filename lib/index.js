/**
 * dsh-web-mobile, node half. Mostly a client UI plugin: apply() exists so the
 * plugin appears in the host Loader, and installs transparent gzip/brotli
 * compression for large JSON responses (long-session history is megabytes on
 * a phone); the browser half ships via exports["./client"], discovered through
 * the package.json dsh.client declaration.
 */
import { installResponseCompression } from './compress.js';
export function apply(ctx) {
    // Transparent gzip/brotli for large JSON responses (long-session history
    // is megabytes on a phone). Patches http.ServerResponse.prototype; the
    // disposer restores it on plugin unload/reload.
    ctx.effect(() => installResponseCompression(), 'dsh-web-mobile: response compression');
}
//# sourceMappingURL=index.js.map