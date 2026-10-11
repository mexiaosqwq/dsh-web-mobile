// The structural checker (scripts/css-structure-check.mjs) was a manual-only
// gate: nothing in the repo invoked it, so the 16 fatals it exists to catch -
// a media block written at column zero, a duplicated media query, a selector
// split across rules - could all come back with every gate still green. This
// wires its exit code into test:core, which is the gate CI actually runs.
//
// Two info findings are expected and reviewed on purpose (a progressive-
// enhancement fallback pair and one deliberate selector split), so the
// assertion is on the fatal count rather than on empty output. The module
// count is asserted too: a resolver that finds no files would otherwise
// report zero fatals and pass vacuously.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/css-structure-check.mjs', import.meta.url))

test('the four style modules keep zero structural fatals', () => {
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  assert.match(out, /4 modules/)
  assert.match(out, /0 fatal/)
})

// The desktop hide block in misc.css.ts is the exact complement of MOBILE_QUERY:
// everything the mobile branch would touch is hidden when the width clears 1024
// OR the pointer is not coarse. Each style module already asserts the mobile
// half of that contract at its own top-level media block, and the checker's
// allowed-at-rule set pins the hide block's exact prelude - but nothing tied
// the two together: widening MOBILE_QUERY to 767px would leave the hide block
// untouched and every gate green, so the desktop half would stop covering the
// 768-1023px band in silence. That link is what this asserts.
//
// The (pointer: fine) arm specifically cannot be covered by a CDP scene:
// headless Chromium reports (pointer: none) with touch emulation off, and
// neither Emulation.setEmulatedMedia nor --blink-settings=primaryPointerType
// makes it report fine (both tried, 2026-09-16). The arm is the one the
// 2026-08-30 PC leak came through, so it is pinned here against the query it
// has to complement.
test('the desktop hide block stays the complement of MOBILE_QUERY', () => {
  const CHROME = readFileSync(new URL('../src/client/effects/phone-chrome.ts', import.meta.url), 'utf8')
  const query = /MOBILE_QUERY\s*=\s*'([^']+)'/.exec(CHROME)?.[1]
  assert.equal(query, '(max-width: 1023px) and (pointer: coarse)', 'MOBILE_QUERY moved: the hide block below must move with it')

  const width = /max-width:\s*(\d+)px/.exec(query)?.[1]
  assert.ok(width !== undefined)
  const MISC = readFileSync(new URL('../src/client/styles/misc.css.ts', import.meta.url), 'utf8')
  const hide = /@media\s+([^{]*\(pointer:\s*none\)[^{]*)\{/.exec(MISC)
  assert.ok(hide !== null, 'no desktop hide block in misc.css.ts')

  assert.match(hide[1], new RegExp(`\\(min-width:\\s*${Number(width) + 1}px\\)`), 'hide block must be the width complement (1023 -> 1024)')
  assert.match(hide[1], /\(pointer:\s*fine\)/, 'hide block must hide for a mouse pointer at any width')
  assert.match(hide[1], /\(pointer:\s*none\)/, 'hide block must hide when there is no pointer at all')
})
