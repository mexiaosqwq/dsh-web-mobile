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
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/css-structure-check.mjs', import.meta.url))

// Every temp root made by buildStyleRoot is removed when the file finishes,
// including after a failing assertion.
const TEMP_ROOTS: string[] = []
after(() => { for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true }) })

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

// The nested-:has() guard (task-15) shipped with only a one-off hand-run
// mutation as evidence, which is proof the checker *can* fire but not a
// regression net: a later "relax the check" edit (or an accidental delete of
// the loop) would leave every gate green. The checker has no unit-testable
// export, so the test drives it through the seam it already has - the
// CSS_STRUCTURE_ROOT env var - over a temp copy of the four style modules with
// one extra rule appended.
//
// The legal cases are the point, not decoration: an assertion that "anything
// fed in goes red" is itself satisfiable by a checker that always reports, so
// the boundaries have to be pinned on both sides. All three legal shapes are
// ones a future author could plausibly break the checker by forbidding:
//   * `:has():has()` PARALLEL (two sibling :has on one element) - legal;
//   * `:not(:has(...))` - legal, and load-bearing in this repo's modal family
//     gates, so forbidding it would break real rules;
//   * a single-layer `:has(> [attrs])` - the fix shipped in task-15 itself
//     (settings mask), attribute-only by design (Selectors 4 rejects only
//     NESTING, not :has usage).
function buildStyleRoot(extraRule?: string): string {
  const src = fileURLToPath(new URL('../src/client/styles', import.meta.url))
  const root = mkdtempSync(join(tmpdir(), 'css-structure-test-'))
  TEMP_ROOTS.push(root)
  const dir = join(root, 'src', 'client', 'styles')
  mkdirSync(dir, { recursive: true })
  for (const name of ['base', 'layout', 'compat', 'misc']) {
    const from = join(src, `${name}.css.ts`)
    let text = readFileSync(from, 'utf8')
    if (extraRule !== undefined && name === 'layout') {
      const end = text.lastIndexOf('`')
      text = text.slice(0, end) + '\n' + extraRule + '\n' + text.slice(end)
    }
    writeFileSync(join(dir, `${name}.css.ts`), text)
  }
  return root
}

function runChecker(root: string): { out: string, code: number } {
  try {
    return { out: execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, CSS_STRUCTURE_ROOT: root } }), code: 0 }
  } catch (error) {
    const e = error as { status?: number, stdout?: string }
    return { out: e.stdout ?? '', code: e.status ?? -1 }
  }
}

const NESTED_DEAD_RULE = ':has(> [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])):not([data-shortcut-modal="shortcuts"])) > :first-child { animation: none; }'
const LEGAL_PARALLEL = '[aria-modal="true"]:has(> :first-child):has(> :last-child) { animation: none; }'
const LEGAL_NOT_HAS = '[aria-modal="true"]:not(:has([role="navigation"])) { animation: none; }'
const LEGAL_ATTR_ONLY = ':has(> [aria-modal="true"][data-shortcut-modal="settings"]) > [class*="_mask"] { animation: none; }'

test('a nested :has() is detected and reported fatal', () => {
  const baseline = runChecker(buildStyleRoot())
  assert.equal(baseline.code, 0, 'the temp copy of the real tree must be clean: ' + baseline.out)
  assert.match(baseline.out, /0 fatal/)

  const { out, code } = runChecker(buildStyleRoot(NESTED_DEAD_RULE))
  assert.match(out, /nested :has\(\) inside :has\(\)/, 'the checker must name the nested :has() rule')
  assert.doesNotMatch(out, /0 fatal/, 'a nested :has() must not report zero fatals')
  assert.equal(code, 1, 'a nested :has() must fail the checker (exit 1)')
  // the appended rule is the ONLY new finding, so the tree is otherwise intact
  const baselineFatal = Number(/ (\d+) fatal/.exec(baseline.out)?.[1])
  const nestedFatal = Number(/ (\d+) fatal/.exec(out)?.[1])
  assert.equal(nestedFatal, baselineFatal + 1, `exactly one new fatal expected, got ${nestedFatal} vs ${baselineFatal}`)
})

test('legal :has() shapes are not reported fatal', () => {
  for (const [label, rule] of [['parallel :has():has()', LEGAL_PARALLEL], [':not(:has(...))', LEGAL_NOT_HAS], ['single-layer attribute-only :has', LEGAL_ATTR_ONLY]] as const) {
    const { out, code } = runChecker(buildStyleRoot(rule))
    assert.equal(code, 0, `${label} must stay legal, got: ` + out)
    assert.match(out, /0 fatal/, `${label} must not add a fatal`)
    assert.doesNotMatch(out, /nested :has\(\)/, `${label} must not be reported as nested`)
  }
})
