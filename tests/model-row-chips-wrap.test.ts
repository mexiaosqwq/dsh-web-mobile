// Owner report 2026-10-05 (393px, Android WebView): expanding a provider's
// "Model capabilities" area on the Models page rendered the model id as a
// vertical sliver - "gpt-6.1-sol" / "deepseek-v4.1-flash" broke one character
// per line. Measured: the model row is 259px wide, the reasoning summary chip
// ("reasoning: minimal/low/medium/high/xhigh/max") is 322px at min-content,
// and the chips wrapper inherits the flex default min-width:auto - so it grew
// past the row, squeezed the id to 8px, and overflow-wrap:anywhere on the id
// broke it character by character.
//
// Upstream already declares flex-wrap:wrap on the wrapper, i.e. the chips are
// MEANT to move to another line; a single over-long chip defeats that. The fix
// lets the ROW wrap and gives the chips a full-width line of their own.
// Measured at 393px afterwards: id 8x270 vertical -> 131x15 one line.
//
// This pins the shape, because the failure mode of a partial fix is silent:
// min-width:0 alone still left the id crushed (44x60, still vertical), and
// white-space:nowrap alone kept it unreadably narrow (44px).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPAT = readFileSync(join(ROOT, 'src/client/styles/compat.css.ts'), 'utf8')

const sectionStart = COMPAT.indexOf('/* ---------- dsh-model-capabilities:')
const sectionEnd = COMPAT.indexOf('/* ---------- dsh-web-ui polish: explorer sheet', sectionStart)
const section =
  sectionStart !== -1 && sectionEnd > sectionStart ? COMPAT.slice(sectionStart, sectionEnd) : ''

// The section sits inside the file's single mobile media wrapper, so prove the
// block is still open at the section by brace counting (comments stripped -
// they quote braces and would skew the depth).
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')

test('model-row chips rules live inside the mobile media block', () => {
  assert.notEqual(sectionStart, -1, 'model-capabilities section marker not found')
  assert.ok(sectionEnd > sectionStart, 'explorer sheet marker not found')

  const MOBILE_MEDIA = '@media (max-width: 1023px) and (pointer: coarse)'
  const mediaAt = COMPAT.indexOf(MOBILE_MEDIA)
  assert.notEqual(mediaAt, -1, 'mobile media query not found')
  assert.ok(mediaAt < sectionStart, 'mobile block must open before the section')

  const opened = stripComments(COMPAT.slice(mediaAt, sectionStart))
  let depth = 0
  for (const ch of opened) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
  }
  assert.ok(depth > 0, 'mobile media block must still be open at the section')
})

test('the row wraps and the chips take a full-width line', () => {
  // Without the row wrap the chips wrapper cannot move to a second line; with
  // flex-basis 100% it takes the whole line and its own chips wrap inside it.
  const header = /\[class\*="Qzh-QG_rowHeader"\]\s*\{[^}]*flex-wrap:\s*wrap\s*!important/.test(section)
  assert.ok(header, 'row header must wrap (flex-wrap: wrap !important)')

  const chips = /\[class\*="Qzh-QG_chips"\]\s*\{[^}]*flex:\s*1\s+0\s+100%\s*!important/.test(section)
  assert.ok(chips, 'chips wrapper must claim a full line (flex: 1 0 100% !important)')

  const chipsMin = /\[class\*="Qzh-QG_chips"\]\s*\{[^}]*min-width:\s*0/.test(section)
  assert.ok(chipsMin, 'chips wrapper must be shrinkable (min-width: 0)')
})

test('a single over-long chip stays inside its line', () => {
  // 322px chip in a ~259px row: it must be allowed to break internally,
  // otherwise it re-inflates the wrapper and crushes the id again.
  const chip = /\[class\*="Qzh-QG_chip"\]:not\(\[class\*="Qzh-QG_chips"\]\)\s*\{[^}]*max-width:\s*100%/.test(section)
  assert.ok(chip, 'chip must be capped to the row width (max-width: 100%)')
  const wrap = /\[class\*="Qzh-QG_chip"\]:not\(\[class\*="Qzh-QG_chips"\]\)\s*\{[^}]*overflow-wrap:\s*anywhere/.test(section)
  assert.ok(wrap, 'an over-long chip must be allowed to break (overflow-wrap: anywhere)')
})

test('the chip selector does not over-match its own wrapper', () => {
  // [class*="..._chip"] is a substring match: "..._chips" contains "..._chip",
  // so a bare selector also hits the container and paints max-width /
  // overflow-wrap onto it. The repo's established fix is a :not() on the
  // overlapping prefix (pitfall: 哈希子串). Verified live: the bare selector
  // matched 33 elements including the wrapper.
  const chipSelectors = section.match(/\[aria-modal="true"\]\s*\[class\*="Qzh-QG_chip"\][^{]*\{/g) ?? []
  assert.ok(chipSelectors.length > 0, 'expected a chip selector')
  for (const selector of chipSelectors) {
    assert.match(
      selector,
      /:not\(\[class\*="Qzh-QG_chips"\]\)/,
      `chip selector over-matches the chips wrapper: ${selector.trim()}`,
    )
  }
})

test('the chips take a full line only after the id/name', () => {
  // Without order:1 the chevron (the row's LAST child) is pushed onto a line
  // of its own at the far LEFT - measured 237px from the right edge, i.e.
  // flush left: the orphaned arrow the first cut of this rule produced.
  const order = /\[class\*="Qzh-QG_chips"\]\s*\{[^}]*order:\s*1\s*!important/.test(section)
  assert.ok(order, 'chips must be ordered after the id/name (order: 1 !important)')

  const chevron = /\[class\*="Qzh-QG_rowHeader"\]\s*>\s*svg\s*\{[^}]*margin-left:\s*auto/.test(section)
  assert.ok(chevron, 'chevron must stay flush right on the first line (margin-left: auto)')

  const name = /\[class\*="Qzh-QG_modelName"\]\s*\{[^}]*min-width:\s*0/.test(section)
  assert.ok(name, 'display name must be shrinkable too (min-width: 0)')
})

test('the model id is shrinkable but the row never forces it vertical', () => {
  const id = /\[class\*="Qzh-QG_modelId"\]\s*\{[^}]*min-width:\s*0/.test(section)
  assert.ok(id, 'model id must be shrinkable (min-width: 0)')
  // Guard the rejected alternatives: forcing nowrap on the id hides the vertical
  // break while leaving the name too narrow to read; truncating the chip hides
  // which reasoning levels the model offers.
  assert.doesNotMatch(
    section,
    /\[class\*="Qzh-QG_modelId"\]\s*\{[^}]*white-space:\s*nowrap/,
    'nowrap on the id was measured unreadable (44px) and is not the fix',
  )
  assert.doesNotMatch(
    section,
    /\[class\*="Qzh-QG_chip"\]\s*\{[^}]*text-overflow:\s*ellipsis/,
    'truncating the chip hides the reasoning summary and is not the fix',
  )
})

test('the rules stay scoped to the settings dialog', () => {
  // Never a bare global class rule: every selector must carry the aria-modal
  // scope so the desktop (and other dialogs) keep the official layout.
  const selectors = section.match(/^\s*\[[^\]]*\][^{]*\{/gm) ?? []
  assert.ok(selectors.length > 0, 'expected scoped selectors in the section')
  for (const selector of selectors) {
    assert.match(
      selector,
      /\[aria-modal="true"\]/,
      `selector is not scoped to the settings dialog: ${selector.trim()}`,
    )
  }
})
