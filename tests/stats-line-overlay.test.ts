import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickTpsReadout } from '../src/client/effects/stats-line.ts'
import { readFile } from 'node:fs/promises'

// Issue #104: relocating a React-owned node (the context ring, the TPS
// readout) makes the host's unmount removeChild throw NotFoundError — React
// calls it against the parent it rendered the node into — and the
// SlotErrorBoundary then blanks the whole composer slot. The stats-line task
// must therefore never move a host node: plugin-owned placeholder reserves
// plus absolutely positioned overlays only.

const src = await readFile(new URL('../src/client/effects/stats-line.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/client/styles/compat.css.ts', import.meta.url), 'utf8')
const layout = await readFile(new URL('../src/client/styles/layout.css.ts', import.meta.url), 'utf8')

test('stats-line never relocates a host node (issue #104 contract)', () => {
  // The two historic movers: ring into the trailing row, TPS into the strip.
  assert.doesNotMatch(src, /insertBefore\(ring\b/)
  assert.doesNotMatch(src, /appendChild\(el\b/)
  // The only nodes this task creates are plugin-owned placeholder spans.
  assert.doesNotMatch(src, /createElement\('(?!span)/)
  // Host nodes are overlaid where React rendered them, not parked elsewhere.
  assert.match(src, /measureOverlay\(ring, reserve\)/)
  assert.match(src, /measureOverlay\(el, reserve\)/)
})

test('overlay markers exist in source and stylesheet', () => {
  const markers = ['stats-ring-reserve', 'stats-tps-reserve', 'stats-ring-dock', 'stats-tps-row', 'stats-tps']
  for (const marker of markers) {
    assert.ok(src.includes(marker), `stats-line.ts: ${marker}`)
    assert.ok(css.includes(`"${marker}"`), `compat.css.ts: ${marker}`)
  }
  // The ring overlay resolves against a positioned container and the
  // reserves stay invisible (they only hold the slot).
  assert.match(css, /\[data-mobile-nav="stats-ring"\]\s*\{[^}]*position: absolute !important/)
  assert.match(
    css,
    /\[data-mobile-nav="stats-ring-reserve"\],\s*\[data-mobile-nav="stats-tps-reserve"\]\s*\{[^}]*visibility: hidden/,
  )
})

test('the overlay measurement centers the host on its slot (issue #140 alignment)', () => {
  // The 20px ring top-aligned on its 16px reserve hung its center 2-4px
  // below the neighbouring keys (measured 2026-09-29: ring center y=793 vs
  // model key 791 / send key 789, reported as「不与其他小UI对齐」); the
  // overlay must center on the reserve box. Same-height overlays (the
  // 0.1.5/0.1.6 TPS text) are unaffected by the centering.
  // 2026-10-10 (#194): the measurement moved out of the old placeOverlay into
  // measureOverlay, which returns the numbers instead of writing them — the
  // centering expression is unchanged, it is now the returned `top` field.
  assert.match(src, /const hostRect = host\.getBoundingClientRect\(\)/)
  assert.match(src, /top: box\.top - base\.top - container\.clientTop - \(hostRect\.height - box\.height\) \/ 2,/)
})

test('the enlarged ring keeps a visible track (issue #140 spinner look)', () => {
  // 2026-09-29 acceptance: the ring svg was enlarged 16 -> 24px, and the
  // host track (12% black) became invisible next to the thick fill arc —
  // the meter read as a broken loading spinner. The track must be
  // deepened so the donut is a complete ring. Issue #142: the deepened
  // track must follow the theme — 25% of the label token via color-mix
  // (label-primary is near-black light, near-white dark); a literal 25%
  // black vanishes on the dark theme and the spinner look returns there.
  assert.match(
    css,
    /\[data-mobile-nav="stats-ring"\]\s*\[class\*="_track"\]\s*\{[^}]*stroke:\s*color-mix\(in srgb,\s*var\(--dsw-alias-label-primary,\s*#000\)\s*25%,\s*transparent\)/,
  )
  // The theme-blind literal must not come back on the track rule.
  const trackRule = css.match(/\[data-mobile-nav="stats-ring"\]\s*\[class\*="_track"\]\s*\{[^}]*\}/)
  assert.ok(trackRule, 'track rule exists')
  assert.doesNotMatch(trackRule[0], /rgba\(0,\s*0,\s*0,\s*0?\.25\)/)
})

test('pickTpsReadout keeps an already-marked readout selectable (#194 repair)', () => {
  // Why THIS is the check that matters: the marker is written on the FIRST fold,
  // so from the second pass on every readout carries `data-mobile-nav="stats-tps"`.
  // If the scan treated "already marked" as "nothing left to do", locateTps would
  // report "no readout" forever after, and both fold inputs would be lost at once
  // — the reading drops out of the pass key, AND writeTps stops running, so
  // maxWidth keeps the width measured before the reading (or the slot) changed.
  // Three leaks were measured on that path (in-place text change, anchor resize,
  // removed placeholder); the previous assertion here only compared source
  // strings and could not fail on any of them.
  // See docs/handover/2026-10-10-issue194-closer.md §4.
  const row = (text: string, opts: { children?: number; marked?: boolean; parent?: boolean } = {}) =>
    ({
      textContent: text,
      children: { length: opts.children ?? 0 },
      parentElement: opts.parent === false ? null : ({} as Element),
      getAttribute: (name: string) => (name === 'data-mobile-nav' && opts.marked ? 'stats-tps' : null),
    })

  // The regression case, first: a marked readout is still THE readout.
  assert.deepEqual(pickTpsReadout([row('TPS 88.4 tok/s', { marked: true })]), {
    index: 0,
    mark: false,
  })
  // First fold — same row, marker not written yet.
  assert.deepEqual(pickTpsReadout([row('TPS 88.4 tok/s')]), { index: 0, mark: true })
  // Not readouts: other rows, wrappers with children, rows mid-teardown.
  assert.deepEqual(pickTpsReadout([row('steps 12')]), { index: -1, mark: false })
  assert.deepEqual(pickTpsReadout([row('TPS 88.4 tok/s', { children: 2 })]), {
    index: -1,
    mark: false,
  })
  assert.deepEqual(pickTpsReadout([row('TPS 88.4 tok/s', { parent: false })]), {
    index: -1,
    mark: false,
  })
  // A rejected row must not hide the live one behind it.
  assert.deepEqual(
    pickTpsReadout([row('TPS 1.0 tok/s', { parent: false }), row('TPS 2.0 tok/s', { marked: true })]),
    { index: 1, mark: false },
  )
  assert.deepEqual(pickTpsReadout([]), { index: -1, mark: false })
})

test('the skip key still re-folds when the ring is rebuilt (#194 guard)', () => {
  // The 4 liveness guards cannot be driven through the pure core (they read
  // isConnected/attribute), so they stay pinned structurally — but the point of
  // this one is narrow and real: dropping any guard would leave a rebuilt
  // readout unfolded, because the old fast path used to re-fold unconditionally.
  for (const guard of [
    "stillFolded(foldedTps, 'stats-tps')",
    "stillFolded(foldedTpsReserve, 'stats-tps-reserve')",
    "stillFolded(foldedRing, 'stats-ring')",
    "stillFolded(foldedRingReserve, 'stats-ring-reserve')",
  ]) {
    assert.ok(src.includes(guard), `skip guard missing: ${guard}`)
  }
})

test('dispose hands the official layout back', () => {
  for (const key of ['stats', 'stats-ring', 'stats-ring-dock', 'stats-tps', 'stats-tps-row']) {
    assert.ok(src.includes(`'${key}'`), key)
  }
  assert.match(src, /removeEventListener\('resize', viewportHandler\)/)
  assert.match(src, /el\.remove\(\)/)
})

test('viewport relayout is coalesced and skips an unmoved anchor (2026-10-09 实测)', () => {
  // 输入法动画期间 visualViewport.resize 每帧一次，而落位要读 rect + 写样式
  // （强制同步布局）⇒ 原本是每帧一次 overlay 落位。真机读数：侧边栏打开时的
  // 58ms 长任务归零。
  assert.match(src, /if \(relayoutRaf !== 0\) return/, '同一帧只排一次 rAF')
  assert.match(
    src,
    /requestAnimationFrame\(\(\) => \{\s*relayoutRaf = 0\s*relayoutNow\(\)/,
    'rAF 回调里清账再落位',
  )
  assert.match(src, /if \(key === relayoutKey\) return/, '锚点盒子没动就不重复落位')
  // dispose 必须把排队的帧和缓存的 key 一起收回，否则热重载后旧回调仍会落位。
  assert.match(src, /cancelAnimationFrame\(relayoutRaf\)/)
  assert.match(src, /relayoutKey = ''/)
})

// 2026-10-11（真机会话复现）：宿主在「正在输出 + 已输入内容」时把发送键换成
// 「Stop generating + Steer message」，composer 车道重排、我们的环形占位槽左移
// （实测 310 -> 265px），而统计条所在 dock 的盒子一点没动。旧的跳过判据只看统计条
// 盒子，于是整趟跳过、环保留旧 left/top，正好压在停止键上（12×20px 重叠）。
// 两条判据一起钉住：环形占位槽的盒子必须参与「跳过」与「视口重排」两个 key。
test('ring reserve box participates in both skip keys (stale-offset regression)', () => {
  assert.match(src, /const ringReserveBoxKey = \(reserve: Element \| null\): string =>/,
    '缺了取占位槽盒子的辅助函数')
  // 快路径：key 必须带上已缓存的环形占位槽（不查询，沿用上一趟折过的节点）
  assert.match(src, /const key = `\$\{box\}\|\$\{located === null \? 'none' : located\.live\}\|\$\{ringReserveBoxKey\(foldedRingReserve\)\}`/,
    '快路径的跳过 key 没把环形占位槽算进去，环会停在旧坐标')
  // 视口重排路径：同一条 key 也要带占位槽（这条路径没有缓存，允许查询）
  assert.match(src, /Math\.round\(rect\.height\)\}\|\$\{ringReserveBoxKey\(document\.querySelector\('\[data-mobile-nav="stats-ring-reserve"\]'\)\)\}/,
    '视口重排的 key 没把环形占位槽算进去')
  // 折叠后必须用「已知的占位槽」重新记 key，否则下一趟会白折一次
  assert.match(src, /fastKey = `\$\{box\}\|\$\{located === null \? 'none' : located\.live\}\|\$\{ringReserveBoxKey\(foldedRingReserve\)\}`/,
    '折叠后没有重建 key —— 下一趟未变化也会重新折叠')
})

// issue #176（F03）深色顶栏断层：宿主会话头部自带层色（实测深色 #232324），页面底色是
// #151517（--dsw-alias-bg-base），手机档头部上方还有一条跟随页面底色的安全区带
// ⇒ 三段断层。规则必须：① 只在手机档（本文件读的 LAYOUT_CSS 移动块内）；
// ② 只在深色标记下生效；③ 用同一个 bg-base token 取色，跟着主题走。
test('dark conversation header blends into the page background (issue #176)', () => {
  assert.match(layout,
    /body\[data-ds-dark-theme\] \[data-mobile-nav="frame"\] \[data-phase\] header\.wSkVaW_header,\s*\n\s*html\[data-ds-dark-theme\] \[data-mobile-nav="frame"\] \[data-phase\] header\.wSkVaW_header \{/,
    '缺了深色头部同色的规则（body/html 两个深色标记都要覆盖）')
  assert.match(layout, /background-color: var\(--dsw-alias-bg-base, #151517\) !important/,
    '头部底色必须取页面底色的同一个 token，写死颜色会在换主题时失真')
})
