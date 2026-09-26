// Entrance ruling history (2026-09-27, two rounds):
// — morning: the .22s transform slide produced the device bleed frame (panel
//   text present, white background missing); the entrance was cut to none.
// — evening: the reporter re-ruled — they want a transition back (「过渡动画
//   没了/一闪一闪」: the hard pop-cut itself reads as flashing). The restored
//   entrance is OPACITY-ONLY (dsh-web-mobile-fade): geometry never moves, so a
//   late first raster is visually indistinguishable from the fade's early
//   frames — the race artifact is swallowed by the fade by construction. The
//   transform slide stays banned, and the shortcut paper stays animation:none
//   (two identical-white layers fading over each other = the double-print).
// sheet-in remains deleted; the dead mask-fade rule is not resurrected.
// History: docs/handover/2026-09-27-entrance-animation-audit-scout.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')
const LAYOUT = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')
const COMPAT = readFileSync(join(ROOT, 'src/client/styles/compat.css.ts'), 'utf8')
const MISC = readFileSync(join(ROOT, 'src/client/styles/misc.css.ts'), 'utf8')
const STYLES = BASE + LAYOUT + COMPAT + MISC

// The settings sheet rule: anchored on its unique full selector text so the
// slice cannot drift onto another animation: none declaration (the shortcut
// paper block has its own).
const SETTINGS_RULE_HEAD =
  '[aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])):not(:has([class*="ZuhsRW"])):not([data-shortcut-modal="shortcuts"]) {'
const SETTINGS_RULE = LAYOUT.slice(LAYOUT.indexOf(SETTINGS_RULE_HEAD))
const settingsBody = SETTINGS_RULE.slice(0, SETTINGS_RULE.indexOf('\n  }'))

test('the settings sheet entrance is opacity-only, never a transform slide', () => {
  assert.notEqual(SETTINGS_RULE.indexOf(SETTINGS_RULE_HEAD), -1, 'settings sheet rule missing')
  assert.match(
    settingsBody,
    /animation: dsh-web-mobile-fade \.18s var\(--ds-ease-out, ease-in-out\) 100ms backwards;/,
    'the entrance must be the opacity-only fade with the first-raster cover delay',
  )
  assert.doesNotMatch(settingsBody, /dsh-web-mobile-sheet-in/, 'the deleted keyframes must not be re-referenced')
  // The offender is banned by name anywhere in the styles: no transform-bearing
  // entrance may come back on this sheet.
  assert.doesNotMatch(STYLES, /animation:[^;]*sheet-in/, 'no transform-slide entrance on the sheet')
})

test('the shortcut paper stays animation: none (double-print guard)', () => {
  const at = LAYOUT.indexOf('[aria-modal="true"][data-shortcut-modal="shortcuts"] {')
  assert.notEqual(at, -1, 'the paper rule is missing')
  const rule = LAYOUT.slice(at, LAYOUT.indexOf('}', at))
  assert.match(rule, /animation: none !important/, 'identical-white layers must not fade over each other')
})

test('dsh-web-mobile-sheet-in stays deleted across all four style modules', () => {
  assert.doesNotMatch(STYLES, /dsh-web-mobile-sheet-in/, 'the sheet-in keyframes were removed on 2026-09-27 — do not resurrect')
})

test('no :has(> [aria-modal=...]:has( nesting in the styles (invalid selector, silently dropped)', () => {
  // Exact-string pin, not a generic regex: nested-brace patterns are prone
  // to false positives, and this literal is precisely the shape that died.
  assert.doesNotMatch(STYLES, /:has\(> \[aria-modal="true"\]:has\(/, ':has() parameters must not nest :has() — the whole rule is dropped on parse')
})
