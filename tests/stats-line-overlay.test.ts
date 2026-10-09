import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Issue #104: relocating a React-owned node (the context ring, the TPS
// readout) makes the host's unmount removeChild throw NotFoundError — React
// calls it against the parent it rendered the node into — and the
// SlotErrorBoundary then blanks the whole composer slot. The stats-line task
// must therefore never move a host node: plugin-owned placeholder reserves
// plus absolutely positioned overlays only.

const src = await readFile(new URL('../src/client/effects/stats-line.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/client/styles/compat.css.ts', import.meta.url), 'utf8')

test('stats-line never relocates a host node (issue #104 contract)', () => {
  // The two historic movers: ring into the trailing row, TPS into the strip.
  assert.doesNotMatch(src, /insertBefore\(ring\b/)
  assert.doesNotMatch(src, /appendChild\(el\b/)
  // The only nodes this task creates are plugin-owned placeholder spans.
  assert.doesNotMatch(src, /createElement\('(?!span)/)
  // Host nodes are overlaid where React rendered them, not parked elsewhere.
  assert.match(src, /placeOverlay\(ring, reserve\)/)
  assert.match(src, /placeOverlay\(el, reserve\)/)
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

test('placeOverlay centers the host on its slot (issue #140 alignment)', () => {
  // The 20px ring top-aligned on its 16px reserve hung its center 2-4px
  // below the neighbouring keys (measured 2026-09-29: ring center y=793 vs
  // model key 791 / send key 789, reported as「不与其他小UI对齐」); the
  // overlay must center on the reserve box. Same-height overlays (the
  // 0.1.5/0.1.6 TPS text) are unaffected by the centering.
  assert.match(src, /const hostRect = host\.getBoundingClientRect\(\)/)
  assert.match(src, /const top = box\.top - base\.top - container\.clientTop - \(hostRect\.height - box\.height\) \/ 2/)
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
