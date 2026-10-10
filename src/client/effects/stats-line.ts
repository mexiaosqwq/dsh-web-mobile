import type { ReconcilerTask } from '../core/reconciler-core.ts'

// The official conversation status row (turns / steps / LLM time / TTFT /
// cache) has a hashed class, so the stylesheet cannot target it directly.
// Mark the exact row on narrow screens by text: a [class*=_root] that
// carries the metrics text and no composer input (textarea or the
// data-composer-input Lexical node; the composer card also ends in
// _root and can mention turns in its model line). The CSS then lays the
// marked row out as ONE horizontally scrolling line with every metric
// reachable.
// Fast-path predicate: is the previously marked strip still alive in place?
// Re-verifying one anchor per flush is O(1); the full-tree hunt in mark()
// grows with the conversation and runs on every streaming token.
export function statsAnchorAlive(el: Element | null): boolean {
  if (el === null || !el.isConnected) return false
  if (el.closest('[data-phase]') === null) return false
  // The strip must stay inside the composer stack, but it need not be a
  // DIRECT child of it: 0.1.5 nests the status row (bOPqQW_root) under the
  // composer card wrapper (uV2eYG_root), so the marked element sits one level
  // deeper than on rc.2 hosts. Ancestry is still the right test — only the
  // marker's own subtree position changed, not its container relationship.
  return el.closest('[class*="_composerStack"]') !== null
}

export function createStatsLineTask(): ReconcilerTask {
  // React-owned nodes must never be relocated (issue #104): on unmount React
  // calls parent.removeChild(child) against the parent it rendered the node
  // into, so a node this task moved makes that throw NotFoundError and the
  // SlotErrorBoundary blanks the whole composer slot until a reload. The
  // offline-reconnect rebuild hits exactly this path. Both folded readouts
  // (context ring, TPS text) therefore STAY where React rendered them; the
  // visible slot is held by a plugin-owned placeholder element React does not
  // track, and the host node is absolutely positioned on top of it.
  // Coordinates refresh on every flush and on viewport resizes — the keyboard
  // changes layout without any DOM mutation to wake the reconciler.

  // The overlay must resolve against a positioned ancestor. The host rarely
  // positions these containers, so mark the expected one (CSS sets
  // position: relative for the marker, without !important so host styles stay
  // in charge) and let placeOverlay walk to whichever ancestor actually ends
  // up positioned — the math is self-consistent with any container.
  const ensurePositioned = (el: Element, marker: string): void => {
    if (getComputedStyle(el).position === 'static') el.setAttribute('data-mobile-nav', marker)
  }
  const positionedAncestor = (el: Element): Element | null => {
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).position !== 'static') return node
    }
    return null
  }
  const placeOverlay = (host: Element, reserve: Element): void => {
    const container = positionedAncestor(host)
    if (container === null) return
    const box = reserve.getBoundingClientRect()
    const base = container.getBoundingClientRect()
    const left = box.left - base.left - container.clientLeft
    // Center the host on its slot vertically, not top-align it. Measured
    // 2026-09-29 (issue #140 acceptance): the 20px ring top-aligned on its
    // 16px reserve hung its center at y=793 while the neighbouring keys sit
    // at 789-791 — reported as「不与其他小UI对齐」. Centering is a no-op for
    // same-height overlays (the 0.1.5/0.1.6 TPS text) and aligns the ring
    // with the cluster. hostRect is read BEFORE the style write below; its
    // height does not depend on top/left, so the math is stable across flushes.
    const hostRect = host.getBoundingClientRect()
    const top = box.top - base.top - container.clientTop - (hostRect.height - box.height) / 2
    const styled = host as HTMLElement
    if (styled.style.left !== `${left}px`) styled.style.left = `${left}px`
    if (styled.style.top !== `${top}px`) styled.style.top = `${top}px`
  }

  // The composer root renders the TPS readout ("TPS 89.4 tok/s") as its own
  // row BELOW the status strip; fold it into the strip so every metric sits
  // on one line. Idempotent: the placeholder's text mirrors the readout and
  // the readout itself is overlaid on the placeholder's box.
  const moveTps = (stats: Element): void => {
    const stack = stats.closest('[class*="_composerStack"]')
    if (stack === null) return
    let reserve = stats.querySelector(':scope > [data-mobile-nav="stats-tps-reserve"]')
    for (const el of stack.querySelectorAll('div')) {
      const text = (el.textContent ?? '').trim()
      if (!/^TPS\s+\d/.test(text)) continue
      if (el.children.length > 0) continue
      if (el.getAttribute('data-mobile-nav') === 'stats-tps') continue
      if (reserve === null) {
        reserve = document.createElement('span')
        reserve.setAttribute('data-mobile-nav', 'stats-tps-reserve')
        reserve.setAttribute('aria-hidden', 'true')
        stats.appendChild(reserve)
      }
      const live = el.textContent ?? ''
      if (reserve.textContent !== live) reserve.textContent = live
      el.setAttribute('data-mobile-nav', 'stats-tps')
      const tpsRow = el.parentElement
      if (tpsRow === null) continue
      ensurePositioned(tpsRow, 'stats-tps-row')
      placeOverlay(el, reserve)
      // The strip's last child is the flex shrink group: mirror whatever
      // width the placeholder settled on so the overlay clips with the same
      // ellipsis instead of overlapping the neighbouring group.
      const width = reserve.getBoundingClientRect().width
      const styled = el as HTMLElement
      if (styled.style.maxWidth !== `${width}px`) styled.style.maxWidth = `${width}px`
      return
    }
  }
  // 2026-09-23（店主最终确认）：**环要、百分比数字不要** —— 环显示在输入框行
  // 的右簇（模型/麦克风旁），CSS 用 font-size:0 只留环、隐掉 "45%" 文本；统计条
  // 拿满整宽。与 moveTps 同款 overlay：环留在 React 渲染的 dock 原位，插件自建
  // 占位 span 顶住右簇槽位（16px 环 + 2px 边距，行 gap 补足余量）。
  const moveRing = (stats: Element): void => {
    const holder = stats.parentElement
    const dock = holder === null ? null : holder.parentElement
    if (dock === null) return
    const ring = [...dock.children].find(
      (child) => !child.contains(stats) && /\d\s*%/.test(child.textContent ?? ''),
    )
    if (ring === undefined) return
    const row = document.querySelector('[data-composer-card] [class*="_row"] [class*="_trailing"]')
    if (row === null) return
    let reserve = row.querySelector(':scope > [data-mobile-nav="stats-ring-reserve"]')
    const primary = row.querySelector(':scope > [class*="_primary"]')
    if (reserve === null) {
      reserve = document.createElement('span')
      reserve.setAttribute('data-mobile-nav', 'stats-ring-reserve')
      row.insertBefore(reserve, primary)
    } else if (
      primary === null ? row.lastElementChild !== reserve : reserve.nextElementSibling !== primary
    ) {
      // React rebuilt the row and shuffled its children around our
      // placeholder: put the reserved slot back at the anchor position.
      row.insertBefore(reserve, primary)
    }
    if (ring.getAttribute('data-mobile-nav') !== 'stats-ring') {
      ring.setAttribute('data-mobile-nav', 'stats-ring')
    }
    ensurePositioned(dock, 'stats-ring-dock')
    placeOverlay(ring, reserve)
  }
  let viewportHandler: (() => void) | null = null
  // The keyboard animation drives visualViewport.resize once per frame, and the
  // two folds below read rects and write styles (forced synchronous layout), so
  // one event per frame meant one overlay pass per frame. Coalesce every event
  // in a frame into a single pass, and skip the pass entirely when the anchor
  // box did not move. Measured 2026-10-09 on Android 16 WebView: opening the
  // drawer went from a 58ms long task to none. A React rebuild that re-creates
  // the TPS readout at the same box is still re-folded by mark()'s own fast
  // path, which runs on every tree mutation (scopes: the tree key).
  let relayoutRaf = 0
  let relayoutKey = ''
  const relayoutNow = (): void => {
    const anchor = document.querySelector('[data-mobile-nav="stats"]')
    if (anchor === null) return
    const rect = anchor.getBoundingClientRect()
    const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
    if (key === relayoutKey) return
    relayoutKey = key
    moveTps(anchor)
    moveRing(anchor)
  }
  const relayout = (): void => {
    if (relayoutRaf !== 0) return
    relayoutRaf = requestAnimationFrame(() => {
      relayoutRaf = 0
      relayoutNow()
    })
  }
  const mark = (): void => {
    // Keyboard open/close and viewport rotations relayout the composer without
    // any DOM mutation, so the overlays need their own re-layout channel.
    if (viewportHandler === null) {
      viewportHandler = relayout
      window.addEventListener('resize', relayout)
      window.visualViewport?.addEventListener('resize', relayout)
    }
    // Fast path: the marked strip usually survives React rebuilds between
    // tokens; re-verifying the anchor is O(1) while the full-tree hunt below
    // grows with the conversation. moveTps still re-runs so a rebuilt TPS
    // readout is re-folded.
    const anchor = document.querySelector('[data-mobile-nav="stats"]')
    if (anchor !== null && statsAnchorAlive(anchor)) {
      moveTps(anchor)
      moveRing(anchor)
      return
    }
    // Stale marker on a node that left the composer stack/phase context:
    // drop it so the slow path can re-anchor cleanly.
    anchor?.removeAttribute('data-mobile-nav')
    // Scope decision: the status row is a DESCENDANT of the composer stack,
    // not necessarily its child. On rc.2 hosts it is a direct child (its own
    // `_root`); on 0.1.5 the composer card wrapper (uV2eYG_root) sits between
    // the stack and the row (bOPqQW_root), so requiring a direct child made
    // the hunt permanently miss and the strip was never marked (measured: row
    // present at 16,814 carrying "8 turns 582 steps · 103 tok/s" while
    // [data-mobile-nav="stats"] was absent). Body blocks outside the stack are
    // still skipped by the containment test below.
    const stack = document.querySelector('[class*="_composerStack"]')
    if (stack === null) return
    for (const root of stack.querySelectorAll('[class*="_root"]')) {
      // The status row lives inside the composer stack. The query is already
      // scoped to the stack, so every candidate is inside it by construction —
      // message-area blocks that mention turns/steps never enter this loop. (A
      // `stack.contains(root)` guard stood here and its comment claimed to skip
      // those blocks; it was unreachable.)
      // The todo plan strip also lives in the composer stack and its root
      // ends in _root. Its items may legitimately contain "步"/"steps" in
      // their text, so never mistake it (or any interactive dock panel)
      // for the stats strip.
      if (root.matches('[data-testid="todo-panel"]')) continue
      // Dock panels are skipped by never marking a candidate whose buttons are
      // actionable controls. 0.1.5 renders the status row ITSELF as two
      // popover buttons (bOPqQW_pill, aria-haspopup="dialog"), so an
      // "any button" guard excluded the one row this task exists to mark
      // (measured: bOPqQW_root rejected solely by hasButton, marker count 0).
      // Every popover button counts as a status widget: the composer's real
      // controls (model bar, context meter) carry no metrics text and are
      // filtered by the text test above, and a panel with an actionable button
      // still fails here.
      const buttons = root.querySelectorAll('button')
      if (buttons.length > 0 && ![...buttons].every((button) => button.getAttribute('aria-haspopup') !== null)) continue
      const text = root.textContent ?? ''
      if (!/(turns|steps|\bLLM\b|轮|步)/.test(text)) continue
      // Composer card must never be mistaken for the status strip; exclude
      // its input region across both composer DOMs (textarea / Lexical
      // contentEditable marked data-composer-input).
      if (root.querySelector('textarea, [data-composer-input]') !== null) continue
      root.setAttribute('data-mobile-nav', 'stats')
      moveTps(root)
      moveRing(root)
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
      // Hand the official layout back: drop every marker (the strip loses its
      // one-line layout, ring/TPS overlays return to static flow) and remove
      // the plugin-owned placeholders.
      if (relayoutRaf !== 0) {
        cancelAnimationFrame(relayoutRaf)
        relayoutRaf = 0
      }
      relayoutKey = ''
      if (viewportHandler !== null) {
        window.removeEventListener('resize', viewportHandler)
        window.visualViewport?.removeEventListener('resize', viewportHandler)
        viewportHandler = null
      }
      for (const el of document.querySelectorAll('[data-mobile-nav="stats-ring"], [data-mobile-nav="stats-tps"]')) {
        const styled = el as HTMLElement
        styled.style.left = ''
        styled.style.top = ''
        styled.style.maxWidth = ''
      }
      for (const key of ['stats', 'stats-ring', 'stats-ring-dock', 'stats-tps', 'stats-tps-row']) {
        for (const el of document.querySelectorAll(`[data-mobile-nav="${key}"]`)) {
          el.removeAttribute('data-mobile-nav')
        }
      }
      for (const el of document.querySelectorAll('[data-mobile-nav="stats-ring-reserve"], [data-mobile-nav="stats-tps-reserve"]')) {
        el.remove()
      }
    },
  }
}
