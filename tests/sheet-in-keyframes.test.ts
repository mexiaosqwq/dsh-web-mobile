// Entrance-flash fix (2026-09-27): the settings sheet entrance is animation-
// free. The device report pinned the bleed frame (panel text present, white
// background missing, full-open drawer showing through) on the .22s transform
// slide racing the WebView compositor's first-frame rasterization (desktop
// CDP clean). dsh-web-mobile-sheet-in is deleted outright — keyframes and
// its only consumer — and the mask fade that silently never ran (:has-inside-
// :has is an invalid selector, the whole rule was dropped on parse) is gone
// with it. This file now guards the deletions against resurrection: the
// history lives in docs/handover/2026-09-27-entrance-animation-audit-scout.md.
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

test('the settings sheet entrance is animation: none', () => {
  assert.notEqual(SETTINGS_RULE.indexOf(SETTINGS_RULE_HEAD), -1, 'settings sheet rule missing')
  assert.match(settingsBody, /animation: none !important/, 'the sheet must mount without any entrance animation')
  assert.doesNotMatch(settingsBody, /dsh-web-mobile-sheet-in/, 'the deleted keyframes must not be re-referenced')
})

test('dsh-web-mobile-sheet-in stays deleted across all four style modules', () => {
  assert.doesNotMatch(STYLES, /dsh-web-mobile-sheet-in/, 'the sheet-in keyframes were removed on 2026-09-27 — do not resurrect')
})

test('no :has(> [aria-modal=...]:has( nesting in the styles (invalid selector, silently dropped)', () => {
  // Exact-string pin, not a generic regex: nested-brace patterns are prone
  // to false positives, and this literal is precisely the shape that died.
  assert.doesNotMatch(STYLES, /:has\(> \[aria-modal="true"\]:has\(/, ':has() parameters must not nest :has() — the whole rule is dropped on parse')
})
