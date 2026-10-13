// Patch registry gate (2026-10-13).
//
// WHY THIS EXISTS
// This plugin is a guest on a host DOM it does not own: it reaches into other
// people's class names, positions itself against structures it cannot change,
// and ships rules whose only reason to exist is "the host does it this way
// today". That makes patches unavoidable here — the problem is never that they
// exist, it is patches NOBODY OWNS: no stated target, no reason, no expiry, no
// test. Those are the ones a later reader cannot delete, so they get stacked
// on instead.
//
// So the rule is mechanical, not aspirational: every patch block self-declares
// four things, and this checker fails the build when one is missing or when the
// registry no longer matches the source.
//
//   for:   which host structure / which generation it adapts to
//   why:   why the regular way is not available (no reason => it is debt)
//   until: the condition under which it can be deleted
//   test:  the file that watches it (must EXIST — that is checkable, so it is
//          checked; a patch nobody tests is a patch nobody will notice rotting)
//
// Marker syntax (one block per patch, same shape in .css.ts and .ts):
//
//   /* @patch
//      id: short-kebab-id
//      for: ...
//      why: ...
//      until: ...
//      test: tests/some.test.ts
//   */
//
// Usage:
//   node scripts/patch-registry-check.mjs           # check (exit 1 on failure)
//   node scripts/patch-registry-check.mjs --write    # regenerate the registry
//
// NOTE: this file is plain ASCII on purpose — no backticks in CSS-adjacent
// tooling text, and no smart quotes, so it stays readable in any terminal.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// PATCH_REGISTRY_ROOT is the test seam (mirrors CSS_STRUCTURE_ROOT in
// css-structure-check.mjs): it lets tests/css-structure.test.ts drive this
// checker over a temp copy with one marker deliberately broken, so "the checker
// can fire" becomes a regression net instead of a one-off hand run.
const ROOT = process.env.PATCH_REGISTRY_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const REGISTRY = join(ROOT, 'docs/maintenance/patch-registry.md')
const BEGIN = '<!-- BEGIN:generated -->'
const END = '<!-- END:generated -->'
const REQUIRED = ['id', 'for', 'why', 'until', 'test']

/** Every .ts under src/, deterministic order. */
function sourceFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Parse every @patch block. Returns { entries, problems }. */
function collect() {
  const entries = []
  const problems = []
  const seen = new Map()
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file)
    let index = 0
    while (true) {
      const at = text.indexOf('@patch', index)
      if (at === -1) break
      index = at + 1
      const open = text.lastIndexOf('/*', at)
      const close = text.indexOf('*/', at)
      if (open === -1 || close === -1) {
        problems.push(`${rel}: @patch at offset ${at} is not inside a /* */ block`)
        continue
      }
      const line = text.slice(0, at).split('\n').length
      const body = text.slice(at, close)
      const fields = {}
      for (const key of REQUIRED) {
        const match = body.match(new RegExp(`(?:^|\\n)\\s*${key}:(.*)`))
        if (match !== null) fields[key] = match[1].trim()
      }
      const missing = REQUIRED.filter((key) => fields[key] === undefined || fields[key] === '')
      if (missing.length > 0) {
        problems.push(`${rel}:${line}: patch is missing ${missing.join(', ')}`)
        continue
      }
      // The test pointer is the one field a machine can really verify, so it is.
      if (!fields.test.startsWith('tests/') || !existsSync(join(ROOT, fields.test))) {
        problems.push(`${rel}:${line}: test points at a file that does not exist: ${fields.test}`)
        continue
      }
      if (fields.until.length < 8 || /^(tbd|none|-|\?+)$/i.test(fields.until)) {
        problems.push(`${rel}:${line}: until must state a real expiry condition, got "${fields.until}"`)
        continue
      }
      const first = seen.get(fields.id)
      if (first !== undefined) {
        problems.push(`${rel}:${line}: duplicate patch id "${fields.id}" (first seen at ${first})`)
        continue
      }
      seen.set(fields.id, `${rel}:${line}`)
      entries.push({ ...fields, where: `${rel}:${line}` })
    }
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { entries, problems }
}

function render(entries) {
  const rows = entries.map(
    (e) => `| \`${e.id}\` | ${e.where} | ${e.for} | ${e.until} | \`${e.test}\` |`,
  )
  return [
    BEGIN,
    '',
    `共 ${entries.length} 条。此表由 \`node scripts/patch-registry-check.mjs --write\` 生成，`,
    '手改无效 —— 检查器会把不一致判为 fatal。',
    '',
    '| id | 位置 | 适配对象（for） | 到期条件（until） | 测试（test） |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '`why`（为何不能用正规写法）逐条写在源码的 @patch 块里 —— 它必须贴着代码，',
    '因为读代码的人不会先来翻这张表。',
    '',
    END,
  ].join('\n')
}

// --- legacy inventory ---------------------------------------------------------
//
// The gate above only covers patches that SELF-DECLARE. The bulk that predates
// it cannot be swept in one pass without touching geometry that was just
// verified on a device, so the promise made instead is narrower and honest:
// COUNT IT, mechanically. A pile that is measured cannot grow in silence, and
// the day someone sweeps a generation they can see the number move.
//
// Three mechanical signals, because they are the three that make a stylesheet
// hard to change safely: how much force it needs (!important), how much it
// depends on host class-name fragments (a contract nobody signed), and how many
// rules need subtree matching (:has). These are generated, never hand-written.
const INV_BEGIN = '<!-- BEGIN:inventory -->'
const INV_END = '<!-- END:inventory -->'

function inventory() {
  const rows = []
  for (const file of sourceFiles()) {
    const rel = relative(ROOT, file)
    const text = readFileSync(file, 'utf8')
    const important = (text.match(/!important/g) ?? []).length
    const hashedSel = (text.match(/\[class\*=/g) ?? []).length
    const hasFn = (text.match(/:has\(/g) ?? []).length
    if (important === 0 && hashedSel === 0 && hasFn === 0) continue
    rows.push({ rel, important, hashedSel, hasFn })
  }
  rows.sort((a, b) => b.important - a.important || (a.rel < b.rel ? -1 : 1))
  return rows
}

function renderInventory(rows) {
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0)
  return [
    INV_BEGIN,
    '',
    '### 存量盘点（未自报的历史补丁）',
    '',
    '下表由 `--write` 生成。**它不是待办清单，也不是许可** —— 是"这堆东西有多大"的机械读数：',
    '存量补丁不可能一次清完（会动到刚在真机验收过的几何），但**可以不再无声增长**。',
    '按代际分批收编时，看的就是这几列数字有没有往下走。',
    '',
    '| 模块 | `!important` | 哈希子串选择器 | `:has(` |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| \`${r.rel}\` | ${r.important} | ${r.hashedSel} | ${r.hasFn} |`),
    `| **合计** | **${sum((r) => r.important)}** | **${sum((r) => r.hashedSel)}** | **${sum((r) => r.hasFn)}** |`,
    '',
    INV_END,
  ].join('\n')
}

function readSection(text, begin, end) {
  const from = text.indexOf(begin)
  const to = text.indexOf(end)
  if (from === -1 || to === -1) return null
  return { from, to, body: text.slice(from, to + end.length).trim() }
}

function readRegistry() {
  if (!existsSync(REGISTRY)) return null
  const text = readFileSync(REGISTRY, 'utf8')
  const patches = readSection(text, BEGIN, END)
  if (patches === null) return null
  const inv = readSection(text, INV_BEGIN, INV_END)
  return {
    text,
    patches,
    inventory: inv,
    base: text.slice(0, patches.from),
    tail: inv === null ? text.slice(patches.to + END.length) : text.slice(inv.to + INV_END.length),
  }
}

const { entries, problems } = collect()
const rows = inventory()
const write = process.argv.includes('--write')

if (write) {
  const current = readRegistry()
  const base = current === null
    ? '# 补丁登记表（patch registry）\n\n每个补丁必须在源码里用 @patch 块自报 for / why / until / test 四要素。\n\n'
    : current.base
  const tail = current === null ? '\n' : current.tail
  const body = `${render(entries)}\n\n${renderInventory(rows)}`
  writeFileSync(REGISTRY, `${base}${body}${tail}`, 'utf8')
  process.stdout.write(`patch-registry: wrote ${entries.length} entries + ${rows.length} inventory rows to ${relative(ROOT, REGISTRY)}\n`)
  process.exit(problems.length > 0 ? 1 : 0)
}

if (problems.length > 0) {
  for (const problem of problems) process.stdout.write(`  FAIL ${problem}\n`)
  process.stdout.write(`patch-registry: ${problems.length} problem(s); ${entries.length} patch(es) registered\n`)
  process.exit(1)
}

const current = readRegistry()
if (current === null || current.inventory === null) {
  process.stdout.write('  FAIL docs/maintenance/patch-registry.md missing a generated section\n')
  process.stdout.write('       run: node scripts/patch-registry-check.mjs --write\n')
  process.exit(1)
}

if (render(entries).trim() !== current.patches.body) {
  process.stdout.write('  FAIL registry does not match the source markers\n')
  process.stdout.write('       run: node scripts/patch-registry-check.mjs --write\n')
  process.exit(1)
}

if (renderInventory(rows).trim() !== current.inventory.body) {
  process.stdout.write('  FAIL legacy inventory is stale (source counts moved)\n')
  process.stdout.write('       run: node scripts/patch-registry-check.mjs --write\n')
  process.exit(1)
}

process.stdout.write(`patch-registry: ${entries.length} patch(es) self-declared, ${rows.length} modules inventoried, registry in sync\n`)
