// Drawer-back fix: sheets portaled into the AppFrame overlayLayer
// (position:absolute + z-index:20 — its own stacking context) can never
// out-rank the drawer column's 1300 in the root context, no matter what
// z-index the sheet itself carries. Measured 2026-09-22 (Playwright, 390px,
// drawer open): a layer child lost elementFromPoint to drawer elements at
// z auto AND z 9999 alike; only raising the layer ROOT to 1400 revealed it.
// This pins the class fix: the overlayLayer raise must stay drawer-open-
// gated, inside the mobile popover band, at the 1400 band value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sliceBand, POPOVER_BAND_START, POPOVER_BAND_END } from './lib/css.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')

const { start: bandStart, end: bandEnd, text: band } = sliceBand(
  BASE,
  POPOVER_BAND_START,
  POPOVER_BAND_END,
)

/** Declarations of the rule whose selector starts at `selectorAt`.
 *
 * A plain `indexOf('}')` cannot delimit a band rule here (closing braces are
 * indented by two spaces and nested media blocks are common), and matching the
 * selector plus `{ z-index }` anywhere in the band is satisfied by a sibling
 * rule with the same selector. Balance from this selector's own brace. */
const declarations = (selectorAt: number): string => {
  const open = band.indexOf('{', selectorAt)
  assert.ok(open > -1, 'overlayLayer rule has no declaration block')
  let depth = 0
  for (let i = open; i < band.length; i += 1) {
    if (band[i] === '{') depth += 1
    else if (band[i] === '}') {
      depth -= 1
      if (depth === 0) return band.slice(open + 1, i)
    }
  }
  return assert.fail('overlayLayer rule has an unbalanced declaration block')
}

test('overlayLayer band raise lives in the mobile popover band section', () => {
  assert.notEqual(bandStart, -1, 'popover band marker not found in base.css.ts')
  assert.ok(bandEnd > bandStart, 'popover band end marker not found')
  assert.match(band, /@media \(max-width: 1023px\) and \(pointer: coarse\)/)
})

test('overlayLayer raise is drawer-open-gated at the 1400 band', () => {
  const selectorAt = band.indexOf('[class*="_overlayLayer"]')
  assert.ok(selectorAt !== -1, 'overlayLayer rule missing from the popover band')
  // The gate must belong to THIS rule, not a sibling's: nothing may close a
  // block between the nearest gate and the selector. `lastIndexOf` is scoped to
  // this selector because the same gate also precedes the usage-stats rule.
  const gate = 'body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed]))'
  const gateAt = band.lastIndexOf(gate, selectorAt)
  assert.ok(gateAt !== -1, 'overlayLayer raise must be drawer-open-gated')
  assert.doesNotMatch(
    band.slice(gateAt + gate.length, selectorAt),
    /\}/,
    'gate must belong to the overlayLayer rule itself',
  )
  // Read only this selector's own declarations: the fullscreen sibling rule
  // carries the same selector and the same 1400, so a band-wide regex stayed
  // green when this rule's value was broken.
  assert.match(declarations(selectorAt), /z-index: 1400 !important/)
})

// 0.1.7 fullscreen sidebar panels (terminal / files / preview / browser) put the
// dockkit cell at z 40 (--dsh-dockkit-dock-layer: 40), above the host's overlay
// layer (20) and our FAB (21). Measured 2026-09-23 at 390px with the terminal
// open: the FAB's centre hit-test returned a panel child and a real tap left the
// drawer closed. The band must raise our own two surfaces for that state — and
// only for it: the presentation attribute alone survives a closed panel.
const FIX = '[data-sidebar-right-open][data-sidebar-right-panel="fullscreen"]'

test('fullscreen right-sidebar panel raises our FAB above the dock layer band', () => {
  const gate = `body:has(${FIX}) [data-mobile-nav="fab"]`
  const at = band.indexOf(gate)
  assert.notEqual(at, -1, 'FAB raise for the fullscreen right sidebar is missing')
  const body = band.slice(at, band.indexOf('}', at))
  assert.match(body, /z-index: 55 !important/, 'FAB must rise to the below-the-drawer band (55)')
  // Below the drawer stack by design: an open drawer still covers the FAB.
  const value = Number(/(\d+)/.exec(body)?.[1])
  assert.ok(value > 40, `FAB band must out-rank the dock layer 40 (got ${String(value)})`)
  assert.ok(value < 1250, `FAB band must stay under the backdrop 1250 (got ${String(value)})`)
})

test('fullscreen right-sidebar panel also raises the overlayLayer root', () => {
  const selection = `body:has(${FIX})\n    [class*="_overlayLayer"]`
  assert.ok(band.includes(selection), 'overlayLayer raise for the fullscreen right sidebar is missing')
  const at = band.indexOf(selection)
  assert.match(band.slice(at, band.indexOf('}', at)), /z-index: 1400 !important/)
})

test('the right-sidebar raise is gated on the OPEN attribute, not the presentation', () => {
  // `data-sidebar-right-panel="fullscreen"` stays on the panel while it is
  // closed (measured 2026-09-23), so the gate must include the open marker.
  assert.doesNotMatch(
    band,
    /body:has\(\[data-sidebar-right-panel="fullscreen"\]\)/,
    'a presentation-only gate would raise the band on a closed panel',
  )
  assert.match(band, new RegExp(FIX.replace(/[[\]"]/g, '\\$&')))
})
