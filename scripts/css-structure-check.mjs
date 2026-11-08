// Structural checks for the four concatenated CSS modules.
//
// The repo has no linter and the CSS lives in TypeScript template literals, so
// these defect classes survive every existing gate (verify / test:core /
// docs-consistency): indentation that lies about nesting, declarations that can
// never apply, and blocks that escaped the mobile media query.
// Sibling, not duplicate: src/client/core/css-rules.ts reads the same sheets for
// SOURCE-LEVEL cascade questions ("which font-size would reach this element") and
// deliberately drops at-rule conditions. This script is the structural half —
// nesting depth, indentation, dead declarations, allowed top-level blocks — which
// that reader cannot answer by design.
// node:builtin-only.  Usage: node scripts/css-structure-check.mjs
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = process.env.CSS_STRUCTURE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = ['base', 'layout', 'compat', 'misc']

// Top-level at-rules that are legitimate in a module. Anything else must sit
// inside the mobile query, or it applies to desktop too.
const TOP_LEVEL_ALLOWED = [
  '@media (max-width: 1023px) and (pointer: coarse)',
  '@media (min-width: 1024px) and (pointer: coarse)',
  '@media (min-width: 1024px), (pointer: fine), (pointer: none)',
  '@media (pointer: fine), (pointer: none)',
  '@media (min-width: 768px) and (max-width: 1023px) and (pointer: coarse)',
  '@media (prefers-reduced-motion: reduce)',
  // Capability query, not a width query: hover feedback must exist on desktop and
  // must NOT exist on touch (Chromium sticks :hover after a tap). It applies at
  // every width by design, so it is legitimate at the top level.
  '@media (hover: hover)',
]

// ---- DOM markers: CSS consumers must have a non-CSS producer ----------------
//
// A selector on [data-mobile-nav="x"] / [data-mobile-nav-flag] / a host marker is
// only half a contract: the other half is the code that writes the attribute.
// Rename one side and the rule silently never matches while every gate stays
// green (2026-11-08 T4 audit: the forward direction was clean, but nothing
// enforced it). Only the forward direction is checked: code may produce markers
// the CSS does not consume yet (deliberate revival guards), which is not a
// defect.
//
// data-mobile-nav* is ours, so a *valued* selector must see its value in the
// source. data-phase / data-sidebar-collapsed are host-owned: the host picks the
// values (hero / active / ...), so only the attribute name can be required.
const MARKER_SELECTOR = /\[(data-mobile-nav[\w-]*|data-phase|data-sidebar-collapsed)(?:="([^"]*)")?/g
const HOST_OWNED_MARKERS = new Set(['data-phase', 'data-sidebar-collapsed'])
// dsh-zen-remote injects data-mobile-nav="header-back" (the zen-remote-header-yield
// @patch block in layout.css.ts explains the collaboration); no producer exists
// in this repo by design, so it is exempt from the producer requirement.
const FOREIGN_MARKERS = new Set(['data-mobile-nav=header-back'])
// Anti-vacuity floors: a broken extractor must fail, not silently pass.
const MIN_CSS_MARKERS = 30
const MIN_SOURCE_FILES = 40

const markerUse = new Map()

const problems = []
const fatal = []
const info = []
const note = (file, line, msg) => fatal.push(file + ':' + line + '  ' + msg)
const soft = (file, line, msg) => info.push(file + ':' + line + '  ' + msg)

function load(name) {
  const file = name + '.css.ts'
  const source = fs.readFileSync(join(root, 'src/client/styles', file), 'utf8')
  const match = source.match(/=\s*`([\s\S]*)`\s*;?\s*$/)
  if (!match) throw new Error(file + ': no CSS template literal found')
  const css = match[1]
  // Lines reported must be real file lines: the template body starts after the
  // backtick on some earlier line, so shift every report by that many lines.
  const lineOffset = source.slice(0, match.index).split('\n').length - 1
  return { file, css, lineOffset, masked: css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) }
}

// One pass: every block gets depth + indentation; every style rule also gets
// its raw body and the enclosing at-rule scopes.
function parse(file, css, masked, lineOffset) {
  const lines = css.split('\n')
  const blocks = []
  const rules = []
  const stack = []
  let line = 1
  let buf = ''
  let preludeLine = null
  const newlinesBefore = (from, to) => {
    let n = 0
    for (let k = from; k < to; k++) if (masked[k] === '\n') n++
    return n
  }
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]
    if (c === '\n') { line++; buf += ' '; continue }
    if (c === '{') {
      const prelude = buf.trim()
      buf = ''
      const frame = {
        prelude, line: preludeLine ?? line, start: i + 1,
        depth: stack.length,
        scope: stack.filter((f) => f.prelude.startsWith('@')).map((f) => f.prelude),
      }
      stack.push(frame)
      blocks.push(frame)
      preludeLine = null
      continue
    }
    if (c === '}') {
      const frame = stack.pop()
      if (frame && !frame.prelude.startsWith('@') && frame.prelude) {
        frame.body = css.slice(frame.start, i)
        frame.bodyStart = frame.start
        rules.push(frame)
      }
      buf = ''
      preludeLine = null
      continue
    }
    if (!/\s/.test(c) && preludeLine === null) preludeLine = line
    buf += c
  }
  if (stack.length) note(file, lines.length + lineOffset, 'brace balance broken at EOF')
  return { lines, blocks, rules, newlinesBefore }
}

// A :has() nested inside another :has() is an INVALID selector (Selectors 4).
// Chromium rejects the entire rule at parse time with no console message, so it
// silently never applies — this is how the settings mask fade sat dead through
// two separate discoveries (2026-09-27, 2026-10-10). Detect `:has(` opening
// while another `:has(` is still open. Only :has() nesting is illegal:
// `:not(:has(…))` / `:where(:has(…))` are fine, so track the kind of each paren.
function nestedHas(prelude) {
  const open = []
  let quote = null
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i]
    if (quote !== null) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === ')') { open.pop(); continue }
    if (c !== '(') continue
    const isHas = /:has$/i.test(prelude.slice(0, i))
    if (isHas && open.some(Boolean)) return true
    open.push(isHas)
  }
  return false
}

// Non-CSS source files: the producer side of the marker contract. `.css.ts` is
// excluded because that is the consumer side being checked.
function walkSource(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkSource(path, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.css.ts')) out.push(path)
  }
  return out
}

/** `data-mobile-nav` + camelCase dataset suffix -> attribute name. */
function datasetAttribute(prop) {
  return 'data-' + prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}

/** Attribute names and slug-shaped string values present anywhere in the source.
 *
 * Presence, not data flow: a value may travel through a helper
 * (`ensurePositioned(el, 'stats-tps-row')`) or a shared constant, which a
 * structural scan cannot follow. The contract enforced here is the one that
 * breaks silently: the marker must still exist on both sides after a rename.
 */
function collectMarkerProducers(files) {
  const names = new Set()
  const values = new Set()
  const attribute = /(data-mobile-nav[\w-]*|data-phase|data-sidebar-collapsed)/g
  const noteString = (literal) => {
    for (const m of literal.matchAll(attribute)) names.add(m[1])
    if (/^[a-z0-9][a-z0-9-]{0,40}$/.test(literal)) values.add(literal)
  }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    // Query selector strings are consumers, not producers: blank the ones that
    // carry an attribute selector so a query for the marker cannot justify the
    // style that queries it.
    const code = text.replace(/'[^'\n]*\[[^'\n]*'/g, ' ')
    for (const m of code.matchAll(/'([^'\n]*)'/g)) noteString(m[1])
    for (const m of code.matchAll(/"([^"\n]*)"/g)) noteString(m[1])
    // dataset.mobileNavXxx = ... writes data-mobile-nav-xxx (value irrelevant
    // for a boolean/flag attribute, so the name alone proves the producer).
    for (const m of code.matchAll(/dataset\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(datasetAttribute(m[1]))
  }
  return { names, values }
}

function formatMarker(key) {
  const split = key.indexOf('=')
  return split === -1 ? key : key.slice(0, split) + '="' + key.slice(split + 1) + '"'
}

for (const name of MODULES) {
  const { file, css, masked, lineOffset } = load(name)
  const { lines, blocks, rules, newlinesBefore } = parse(file, css, masked, lineOffset)
  const fail = (l, m) => note(file, l + lineOffset, m)
  const hint = (l, m) => soft(file, l + lineOffset, m)

  // 1. indentation must match real nesting depth
  for (const b of blocks) {
    if (b.depth === 0) continue
    const expected = b.depth * 2
    const actual = (lines[b.line - 1]?.match(/^ */) ?? [''])[0].length
    if (actual !== expected) {
      fail(b.line, 'indent ' + actual + ', nesting expects ' + expected + ': ' + b.prelude.slice(0, 60))
    }
  }

  // 2. top-level blocks that would apply outside the mobile branch
  for (const b of blocks) {
    if (b.depth !== 0 || !b.prelude.startsWith('@')) continue
    if (b.prelude.startsWith('@keyframes')) continue
    if (TOP_LEVEL_ALLOWED.includes(b.prelude)) continue
    fail(b.line, 'top-level at-rule outside the allowed set: ' + b.prelude)
  }

  // 3. the same property twice in one rule (the first can never apply)
  for (const r of rules) {
    const seen = new Map()
    let offset = 0
    for (const chunk of r.body.split(';')) {
      const decl = chunk.split('\n').map((s) => s.trim()).filter(Boolean).join(' ')
      const at = r.line + newlinesBefore(r.bodyStart, r.bodyStart + offset)
      offset += chunk.length + 1
      if (!decl) continue
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      const prop = decl.slice(0, idx).trim()
      if (seen.has(prop)) {
        // A vh/px fallback followed by a dvh/px line is deliberate progressive
        // enhancement, not a mistake — report it as info so a reviewer can see it.
        const fallback = seen.get(prop)
        if (/dvh|dvw/.test(decl) && !/dvh|dvw/.test(fallback)) {
          hint(at, 'progressive-enhancement fallback pair for "' + prop + '"')
        } else {
          fail(at, 'duplicate property "' + prop + '" in one rule (first value: ' + fallback + '): ' + r.prelude.slice(0, 50))
        }
      }
      seen.set(prop, decl.slice(idx + 1).trim())
    }
  }

  // 4. the same selector declared twice in one scope
  const seenSelector = new Map()
  for (const r of rules) {
    const key = r.scope.join(' && ') + ' ||| ' + r.prelude
    if (seenSelector.has(key)) {
      hint(r.line, 'selector split across rules in one scope (first at ' + seenSelector.get(key) + '): ' + r.prelude.slice(0, 60))
    } else seenSelector.set(key, r.line)
  }

  // 5. :has() nested in :has() — invalid selector, whole rule silently dropped
  for (const r of rules) {
    if (nestedHas(r.prelude)) {
      fail(r.line, 'nested :has() inside :has() — invalid selector, the parser drops this whole rule: ' + r.prelude.slice(0, 70))
    }
  }

  // 6. DOM markers this module's selectors consume; the producer side is
  //    checked across all modules against the non-CSS source after this loop.
  for (const r of rules) {
    for (const m of r.prelude.matchAll(MARKER_SELECTOR)) {
      const key = m[2] === undefined ? m[1] : m[1] + '=' + m[2]
      if (!markerUse.has(key)) markerUse.set(key, { file, line: r.line + lineOffset })
    }
  }
}

// 6. Every marker the styles select on must still exist on the producing side.
//    A partial fixture root (styles only) has no code half, so it skips: the
//    floor below is what keeps a broken extractor from passing vacuously in the
//    real tree.
const sourceRoot = join(root, 'src/client')
const sourceFiles = walkSource(sourceRoot)
// Test fixtures mirror only the style modules (no non-CSS source, no entry):
// there is no code half to check, so they skip. The real tree always has source
// files, so a broken walk there hits the floors below instead of skipping.
if (sourceFiles.length > 0 || fs.existsSync(join(sourceRoot, 'index.tsx'))) {
  if (sourceFiles.length < MIN_SOURCE_FILES) {
    note('src/client', 0, 'marker scan found only ' + sourceFiles.length + ' non-CSS source files (expected at least ' + MIN_SOURCE_FILES + ')')
  }
  if (markerUse.size < MIN_CSS_MARKERS) {
    note('src/client/styles', 0, 'marker scan found only ' + markerUse.size + ' distinct CSS markers (expected at least ' + MIN_CSS_MARKERS + ')')
  }
  const { names, values } = collectMarkerProducers(sourceFiles)
  for (const [key, use] of markerUse) {
    if (FOREIGN_MARKERS.has(key)) continue
    const split = key.indexOf('=')
    const attr = split === -1 ? key : key.slice(0, split)
    const value = split === -1 ? undefined : key.slice(split + 1)
    const produced = value === undefined || HOST_OWNED_MARKERS.has(attr)
      ? names.has(attr)
      : names.has(attr) && values.has(value)
    if (!produced) {
      note(use.file, use.line, 'CSS consumes ' + formatMarker(key) + ' but nothing in src/client produces it (one-sided rename?)')
    }
  }
}

console.log('css-structure-check: ' + MODULES.length + ' modules, ' + fatal.length + ' fatal, ' + info.length + ' info')
for (const p of info) console.log('  info ' + p)
for (const p of fatal) console.log('  FAIL ' + p)
process.exit(fatal.length ? 1 : 0)
