// Platform layer: the plugin-owned frame marker lookup.
//
// Moved out of effects/phone-chrome.ts (architecture P1). Six effects plus the
// open-files-panel component needed this lookup, which made phone-chrome the
// shared surface of the effects layer (the only runtime import cycle in
// src/client) and the one components → effects layer violation. Nothing here
// knows about features; the marker itself is still owned and set by
// phone-chrome's frame-marker task.

/** The AppFrame element: direct parent of the shell overlay layer. */
export function findFrame(): HTMLElement | null {
  return document.querySelector('[data-shell-overlay]')?.parentElement ?? null
}

/**
 * Memoized frame lookup. The marked column survives React swaps, so the cached
 * node stays valid while it is still connected AND still carries the marker;
 * anything else re-queries. Streamed output wakes every `*` task each frame and
 * each task resolves the frame again (measured: 1063 full-document
 * `[data-mobile-nav="frame"]` queries in a 4s mutation storm at ~60Hz).
 *
 * The cache is the one piece of module-level state this layer owns; the
 * architecture ledger carries that fact explicitly.
 */
let frameCache: HTMLElement | null = null

/** Resolve the plugin-owned frame marker, falling back to the raw shell frame. */
export function getFrame(): HTMLElement | null {
  const cached = frameCache
  if (cached !== null && cached.isConnected && cached.getAttribute('data-mobile-nav') === 'frame') {
    return cached
  }
  const marked = document.querySelector('[data-mobile-nav="frame"]')
  const found = (marked ?? findFrame()) as HTMLElement | null
  frameCache = found
  return found
}
