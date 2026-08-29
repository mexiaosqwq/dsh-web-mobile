import type { ReconcilerTask } from '../core/reconciler-core.ts'

// The official conversation status row (turns / steps / LLM time / TTFT /
// cache) has a hashed class, so the stylesheet cannot target it directly.
// Mark the exact row on narrow screens by text: a [class*=_root] that
// carries the metrics text and no textarea (the composer card also ends in
// _root and can mention turns in its model line). The CSS then lays the
// marked row out as ONE horizontally scrolling line with every metric
// reachable.
// Fast-path predicate: is the previously marked strip still alive in place?
// Re-verifying one anchor per flush is O(1); the full-tree hunt in mark()
// grows with the conversation and runs on every streaming token.
export function statsAnchorAlive(el: Element | null): boolean {
  if (el === null || !el.isConnected) return false
  if (el.closest('[data-phase]') === null) return false
  return el.closest('[class*="_composerStack"]') !== null
}

export function createStatsLineTask(): ReconcilerTask {
  // The composer root renders the TPS readout ("TPS 89.4 tok/s") as its
  // own row BELOW the status strip; fold it into the strip so every
  // metric scrolls together. The suite re-renders its own tree, so this
  // must be idempotent and re-run on every mutation. Where the readout
  // came from is recorded so disposal can put it back — on a
  // narrow→wide transition the desktop layout must be the official one
  // again, and `[data-mobile-nav="stats"]` is not covered by the
  // desktop hide rules.
  let tpsOrigin: { parent: Node; next: Node | null } | null = null
  const moveTps = (stats: Element): void => {
    if ([...stats.children].some((c) => /^TPS\s+\d/.test((c.textContent ?? '').trim()))) return
    const stack = stats.closest('[class*="_composerStack"]')
    if (stack === null) return
    for (const el of stack.querySelectorAll('div')) {
      const text = (el.textContent ?? '').trim()
      if (!/^TPS\s+\d/.test(text)) continue
      if (el.children.length > 0) continue
      // The composer stack can be rebuilt by React between mutations:
      // refresh the origin every time we actually move the TPS readout, so
      // disposal returns it where it currently belongs.
      if (el.parentElement !== null) {
        tpsOrigin = { parent: el.parentElement, next: el.nextSibling }
      }
      stats.appendChild(el)
      return
    }
  }
  const mark = (): void => {
    // Fast path: the marked strip usually survives React rebuilds between
    // tokens; re-verifying the anchor is O(1) while the full-tree hunt below
    // grows with the conversation. moveTps still re-runs so a rebuilt TPS
    // readout is re-folded.
    const anchor = document.querySelector('[data-mobile-nav="stats"]')
    if (anchor !== null && statsAnchorAlive(anchor)) {
      moveTps(anchor)
      return
    }
    // Stale marker on a node that left the composer stack/phase context:
    // drop it so the slow path can re-anchor cleanly.
    anchor?.removeAttribute('data-mobile-nav')
    for (const root of document.querySelectorAll('[data-phase] [class*="_root"]')) {
      // The status row lives inside the composer stack; message-area
      // blocks can also mention turns/steps and must be skipped.
      if (root.closest('[class*="_composerStack"]') === null) continue
      // The todo plan strip also lives in the composer stack and its root
      // ends in _root. Its items may legitimately contain "步"/"steps" in
      // their text, so never mistake it (or any interactive dock panel)
      // for the stats strip.
      if (root.matches('[data-testid="todo-panel"]')) continue
      if (root.querySelector('button') !== null) continue
      const text = root.textContent ?? ''
      if (!/(turns|steps|\bLLM\b|轮|步)/.test(text)) continue
      if (root.querySelector('textarea') !== null) continue
      root.setAttribute('data-mobile-nav', 'stats')
      moveTps(root)
      return
    }
  }
  // Scope decision: the TPS readout updates are childList/characterData text
  // mutations inside the composer stack, so this task can only wake on the
  // tree key. A subtree-scoped observer would need one observer per
  // container, which the single full-tree observer design intentionally
  // avoids; the expensive composer-stack scan stays the cost of re-anchoring
  // markers that React rebuilds every token.
  return {
    name: 'stats-line',
    scopes: ['*'],
    ensure: mark,
    dispose: () => {
      // Hand the official layout back: return the TPS readout to its own
      // row, then drop the marker that drives the one-line strip.
      if (tpsOrigin !== null && tpsOrigin.parent.isConnected) {
        // Find the TPS readout only inside the marked stats strip we moved
        // it into — a global text search could pick up a different element.
        for (const stats of document.querySelectorAll('[data-mobile-nav="stats"]')) {
          const tps = [...stats.querySelectorAll('div')].find(
            (el) => el.children.length === 0 && /^TPS\s+\d/.test((el.textContent ?? '').trim()),
          )
          if (tps !== undefined) {
            tpsOrigin.parent.insertBefore(tps, tpsOrigin.next)
            break
          }
        }
      }
      for (const el of document.querySelectorAll('[data-mobile-nav="stats"]')) {
        el.removeAttribute('data-mobile-nav')
      }
      tpsOrigin = null
    },
  }
}