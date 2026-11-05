// #247: the 0.2.0 dockkit refactor dropped the panel's own z-index. 0.1.5
// shipped .P3OORG_panel{z-index:10;background:var(--dsw-alias-bg-base)}; 0.2.x
// keeps only pointer-events/position, so the panel surface falls to z auto
// while the active conversation's composer seat is sticky z-index:7 — the
// input card paints over the sheet's bottom band (measured 2026-10-29 at
// 390x844: panel z auto, seat z 7). The restore must stay gated on the OPEN
// marker: the fullscreen value is derived from the viewport width and survives
// a closed panel, whose box also spans the viewport ([0,0,390,844] closed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const layout = await readFile(new URL('../src/client/styles/layout.css.ts', import.meta.url), 'utf8')

test('fullscreen panel restores the 0.1.5 sheet band', () => {
  assert.match(
    layout,
    /\[data-sidebar-right-open\]\[data-sidebar-right-panel="fullscreen"\] \{\s*\/\*[\s\S]*?\*\/\s*z-index: 11 !important;\s*\}/,
    '全屏面板必须是 11：高过会话顶栏（10）与 composerSeat（9），低于 overlay 层（20）',
  )
})

// 2026-11-05 real device: the session header sat at z 30 (above the sheet) and its
// opaque background hid the panel's own tab strip. Header drops to 10, the sheet
// rises to 11, so the sheet covers the header and the strip stays visible.
test('the sheet out-ranks the session header while staying under the overlay layer', () => {
  const header = /header:has\(\[class\*="_headerLeading"\]\) \{[\s\S]*?z-index: (\d+) !important/.exec(layout)?.[1]
  const sheet = /\[data-sidebar-right-open\]\[data-sidebar-right-panel="fullscreen"\] \{[\s\S]*?z-index: (\d+) !important/.exec(layout)?.[1]
  assert.equal(header, '10')
  assert.equal(sheet, '11')
  assert.ok(Number(sheet) > Number(header), 'the full-bleed sheet must paint over the session header')
  assert.ok(Number(header) > 9, 'the header must still cover the sticky composer seat (z-index:9)')
})

test('the band value sits between the composer seat and the overlay layer', () => {
  const value = Number(
    /\[data-sidebar-right-open\]\[data-sidebar-right-panel="fullscreen"\] \{[\s\S]*?z-index: (\d+)/.exec(layout)?.[1],
  )
  assert.equal(value, 11)
  assert.ok(value > 9, 'must out-rank the active composer seat (0.2.2: z-index:9)')
  assert.ok(value < 20, 'must stay below the AppFrame overlay layer (z-index:20) so portaled sheets still cover it')
})

test('no panel z-index rule applies to a closed panel', () => {
  // A rule keyed on the form value alone would lift the closed fullscreen box
  // (which spans the viewport) into a sheet and mask the conversation.
  // Only selector lines count: the @patch metadata mentions "z-index" in prose.
  const selectors = layout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('{') && !line.startsWith('/*') && !line.startsWith('@'))
  for (const selector of selectors) {
    if (!selector.includes('data-sidebar-right-panel="fullscreen"')) continue
    if (!selector.includes('z-index')) continue
    assert.ok(
      selector.includes('[data-sidebar-right-open]'),
      'panel z-index rule without the open gate: ' + selector,
    )
  }
})
