// Documentation consistency guard for the knowledge layer.
//
// Keeps four drift classes out of the tree:
// 1. AGENTS.md must reference only tracked assets that actually exist
//    (dead-reference class — the original multi-maintainer audit P0-1).
// 2. AGENTS.md must stay within the shared workspace-instruction budget
//    (65,536 bytes across the global ~/.dsh/AGENTS.md, this root file and any
//    nested AGENTS.md); narrative overflow belongs in docs/.
// 3. The machine-readable contract layer (docs/upstream/compat-contracts.json)
//    and the pitfalls archive (docs/maintenance/pitfalls.md) must stay
//    parseable and non-empty, because the condensed AGENTS.md entries point
//    into them.
// 4. Counted claims must match the tree (counted-claim class). The 2026-09-18
//    audit found the specs count (7 vs 8), the probe/anchor counts and the test
//    count all stale at once, each one silently: nothing compared the prose
//    numbers with the directories they describe. A number that can be derived
//    gets derived here; numbers that cannot (third-party installed versions)
//    belong to the audit procedure in docs/upstream/upgrade-runbook.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const readRepoFile = (relPath: string) => readFile(join(root, relPath), 'utf8')

// The 65,536-byte workspace-instruction budget is SHARED: the renderer batches
// the global ~/.dsh/AGENTS.md (33,266 B), this root file and any nested
// AGENTS.md under one ceiling and drops whole files from the least specific
// end once the batch stops fitting — so an oversized root file silently evicts
// the global instructions every turn (measured 2026-10-14: 45,513 + 33,266 =
// 78,779 B, global file dropped). The ceiling is derived from that sum, not
// from this file alone: 30,000 keeps the global file plus framing overhead
// inside the budget with ~2 KB to spare.
const SESSION_INSTRUCTION_BUDGET_BYTES = 30_000

const REFERENCED_PATH_PATTERN =
  /(scripts\/probes\/[\w.-]+\.mjs|scripts\/cdp-[\w-]+\.mjs|docs\/specs\/[\w-]+\.md|docs\/audits\/[\w-]+\.md|docs\/upstream\/[\w-]+\.(?:md|json)|docs\/maintenance\/[\w-]+\.md)/g

test('AGENTS.md references only tracked assets that exist', async () => {
  const agents = await readRepoFile('AGENTS.md')
  const referenced = new Set(agents.match(REFERENCED_PATH_PATTERN) ?? [])
  assert.ok(
    referenced.size >= 10,
    `expected a healthy reference graph, found only ${referenced.size} references`,
  )
  for (const relPath of referenced) {
    await stat(join(root, relPath))
  }
})

test('AGENTS.md stays within the session instruction budget', async () => {
  const { size } = await stat(join(root, 'AGENTS.md'))
  assert.ok(
    size <= SESSION_INSTRUCTION_BUDGET_BYTES,
    `AGENTS.md is ${size} bytes (budget ${SESSION_INSTRUCTION_BUDGET_BYTES}) — move narrative into docs/maintenance/pitfalls.md`,
  )
})

test('compat-contracts.json entries are well-formed', async () => {
  const parsed = JSON.parse(await readRepoFile('docs/upstream/compat-contracts.json'))
  assert.ok(Array.isArray(parsed.contracts), 'contracts must be an array')
  assert.ok(parsed.contracts.length >= 20, 'expected the full runbook §2 contract set')
  for (const contract of parsed.contracts) {
    assert.ok(contract.id, 'contract missing id')
    assert.ok(contract.needle, `contract ${contract.id} missing needle`)
    assert.ok(
      contract.kind === 'hash' || contract.kind === 'marker',
      `contract ${contract.id} has unknown kind ${contract.kind}`,
    )
  }
})

// The index in AGENTS.md is a list of bare names, and each name IS the anchor of
// its archived entry (`### <name>` in docs/maintenance/pitfalls.md), so pointers
// resolve by equality. Before 2026-09-18 this test scored CJK-window overlap
// between thematic § labels and archive text, with a measured ceiling: the real
// label 断点与设备 (0.571) and an invented 不存在的主题xyz (0.556) were not
// separable by any threshold. The name-slug scheme replaced that estimate with
// an exact check, so the scoring helpers are gone.
test('pitfalls archive mirrors the AGENTS.md name index', async () => {
  const agents = await readRepoFile('AGENTS.md')
  const archive = await readRepoFile('docs/maintenance/pitfalls.md')

  const pitfalls = agents.split(/^## /m).find((section) => section.startsWith('Pitfalls\n')) ?? ''
  const names = (pitfalls.match(/^- `([^`]+)`$/gm) ?? []).map((line) => line.slice(3, -1))
  assert.ok(names.length >= 40, `AGENTS.md Pitfalls index has only ${names.length} names`)

  const anchors = new Set((archive.match(/^### .+$/gm) ?? []).map((line) => line.slice(4)))
  const missing = names.filter((name) => !anchors.has(name))
  assert.deepEqual(
    missing,
    [],
    'index names with no `### <name>` anchor in the archive: ' + missing.join(' | '),
  )
})

// Cross-generation safety of the rules added for the 0.1.5 host. The plugin
// supports every host generation at once (the installed one plus the older
// rc.2 line), so a fix aimed at a new host must be inert on an old one. The
// mechanism that buys that is structural, and it is easy to break by moving a
// rule out of the mobile media block or by anchoring it on something the old
// host also has under a different meaning:
// - every 0.1.5-specific rule lives in a @media (… pointer: coarse) block and
//   is scoped under [data-mobile-nav="frame"] [data-phase], which only exists
//   while the plugin itself is active on a touch device;
// - hash-anchored rules use substring matching and are inert when the class is
//   absent (the old host ships different hashes), never negative selectors.
test('0.1.5-era rules stay scoped to the mobile branch', async () => {
  const { LAYOUT_CSS } = await import('../src/client/styles/layout.css.ts')
  const { MISC_CSS } = await import('../src/client/styles/misc.css.ts')
  const { COMPAT_CSS } = await import('../src/client/styles/compat.css.ts')
  const sheets = [LAYOUT_CSS, MISC_CSS, COMPAT_CSS]

  // 1. The two selectors that only 0.1.5 has must be present…
  const wSkVaW = sheets.filter((css) => css.includes('wSkVaW_headerUtilities'))
  assert.ok(wSkVaW.length > 0, 'the header-utilities rules disappeared')
  // …and every mention must be scoped under the mobile frame marker, so an old
  // host (and any desktop window) can never match them.
  for (const css of sheets) {
    for (const line of css.split('\n')) {
      if (!line.includes('wSkVaW_') || !line.includes('{')) continue
      assert.ok(
        line.includes('[data-mobile-nav="frame"]'),
        'a wSkVaW_ rule escaped the mobile frame scope: ' + line.trim(),
      )
    }
  }

  // 2. No rule may target a bare hash prefix without a property context: a
  // hash-only selector would also match unrelated elements on a newer host.
  for (const css of sheets) {
    for (const line of css.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.endsWith('{') || trimmed.startsWith('@') || trimmed.startsWith('/*')) continue
      assert.ok(
        !/^\.[A-Za-z0-9_-]+_\s*\{$/.test(trimmed),
        'a bare hash class selector has no owner scope: ' + trimmed,
      )
    }
  }
})

// Counted claims, derived rather than remembered. Keep the phrase in the doc and
// the pattern here in sync when a wording changes — a silently unmatched pattern
// is itself the drift this test exists to catch.
test('counted claims match the tree', async () => {
  const [agents, readme] = await Promise.all([readRepoFile('AGENTS.md'), readRepoFile('README.md')])
  const tally = async (dir: string, match: RegExp): Promise<number> =>
    (await readdir(join(root, dir))).filter((name) => match.test(name)).length

  const effects = await tally('src/client/effects', /\.ts$/)
  const anchors = await tally('scripts/probes', /\.mjs$/)
  const testFiles = await tally('tests', /\.test\.ts$/)
  const specs = await tally('docs/specs', /\.md$/)

  const claims = [
    { what: '效果模块', actual: effects, doc: agents, docName: 'AGENTS.md', pattern: /effects\/\s+← (\d+) 个效果模块/ },
    { what: '回归锚点', actual: anchors, doc: agents, docName: 'AGENTS.md', pattern: /probes\/\s+← (\d+) 个回归锚点/ },
    { what: '测试文件', actual: testFiles, doc: agents, docName: 'AGENTS.md', pattern: /（(\d+) 个测试文件/ },
    { what: '设计文档', actual: specs, doc: agents, docName: 'AGENTS.md', pattern: /specs\/\s+← (\d+) 篇权威设计文档/ },
    { what: '回归锚点', actual: anchors, doc: readme, docName: 'README.md', pattern: /scripts\/probes\/` (\d+) 个锚点/ },
  ]

  const drift: string[] = []
  for (const claim of claims) {
    const found = claim.doc.match(claim.pattern)
    if (found === null) drift.push(`${claim.docName} no longer states the ${claim.what} count`)
    else if (Number(found[1]) !== claim.actual) {
      drift.push(`${claim.docName}: ${claim.what} says ${found[1]}, the tree has ${claim.actual}`)
    }
  }
  assert.deepEqual(drift, [])
})

// CSS files are TypeScript template literals, so a Markdown backtick inside a
// comment terminates the template early and tsc reports a confusing TS1005.
// This bit the same file three times during the 0.1.5 work; the check is cheap
// and the failure mode is otherwise cryptic.
test('CSS template literals carry no stray backticks', async () => {
  for (const file of ['base.css.ts', 'layout.css.ts', 'compat.css.ts', 'misc.css.ts']) {
    const source = await readRepoFile('src/client/styles/' + file)
    const ticks = (source.match(/`/g) ?? []).length
    assert.equal(ticks, 2, file + ' must contain exactly the two template delimiters, found ' + ticks)
  }
})
