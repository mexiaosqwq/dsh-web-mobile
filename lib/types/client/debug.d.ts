import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Revision from a plugin bundle URL, or null when it carries none.
 * The host mints it per build (`dsh-client-modules` HASH_REVISION_LENGTH = 12)
 * and stamps the same value on the URL it actually serves, so it answers
 * "which build is this page running" with no build-time injection.
 */
export declare function parseBundleRev(url: string | null | undefined): string | null;
/**
 * Revision of the bundle the host served this plugin's code from, read off the
 * head element the host injected for it, or null when that element is absent.
 *
 * The host injects an application-batch combo as
 * `<link rel="preload" as="script" href="/plugins/??…,dsh-web-mobile/client.js,…&rev=…">`
 * and the browser fetches exactly that URL (verified against
 * `performance.getEntriesByType('resource')`), so the `rev` here IS the running
 * build's revision. The bundle id — not "the first rev in head" — selects our
 * row: the only `<script src>` row belongs to the client-modules bootstrap
 * batch and carries a different, unrelated revision.
 */
export declare function readBundleRev(): string | null;
export declare function installDebugBadge(ctx: ClientContext): void;
//# sourceMappingURL=debug.d.ts.map