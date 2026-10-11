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
]

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
}

console.log('css-structure-check: ' + MODULES.length + ' modules, ' + fatal.length + ' fatal, ' + info.length + ' info')
for (const p of info) console.log('  info ' + p)
for (const p of fatal) console.log('  FAIL ' + p)
process.exit(fatal.length ? 1 : 0)
