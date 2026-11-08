// Syntax gate for the probe battery (2026-11-08 gate-coverage audit).
//
// `scripts/**/*.mjs` (37 files / ~10k lines as of 2026-11-08) is the repo's only
// runtime regression battery, and nothing compiled it: `test:core` is
// `node --test tests/*.test.ts`, and CI's other gates only exercise the built
// client bundle (`client-bundle-smoke.mjs`). A syntax error in a probe
// therefore stayed invisible until a human ran that exact probe.
//
// Cost, measured on this Termux/aarch64 box 2026-11-08: one `node --check`
// spawn per file costs 5.6 s for the 37 files (~150 ms each, spawn-dominated),
// i.e. +50% on top of the ~11.3 s `test:core`. One child process that parses
// every file with `vm.SourceTextModule` costs 0.3 s, so the whole gate is a
// single spawn. `vm.SourceTextModule` still sits behind
// `--experimental-vm-modules` and `test:core` cannot pass flags to itself,
// hence the child; if that flag ever disappears the child exits non-zero and
// this test fails with its stderr rather than passing silently.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Runs inside the child. Parsing a module is what `node --check` does for a
// `.mjs` file, minus one process per file; failures carry the repo-relative
// path so the report is actionable from the test output alone.
const CHECKER = `
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import vm from 'node:vm'

const ROOT = ${JSON.stringify(ROOT)}
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.mjs')) files.push(full)
  }
}
walk(join(ROOT, 'scripts'))

const failures = []
for (const file of files) {
  try {
    new vm.SourceTextModule(readFileSync(file, 'utf8'), { identifier: file })
  } catch (error) {
    failures.push(relative(ROOT, file) + ': ' + error.message)
  }
}

// The parser must reject a known-bad source, otherwise a Node change that made
// SourceTextModule lazy would leave this gate green forever (an always-passing
// assertion is worse than none).
let selfCheck = false
try {
  new vm.SourceTextModule('export const broken = (', { identifier: 'self-check' })
} catch {
  selfCheck = true
}

process.stdout.write(JSON.stringify({ checked: files.length, selfCheck, failures }))
`

test('every probe script parses as an ES module', () => {
  const run = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '--eval', CHECKER],
    { encoding: 'utf8' },
  )
  assert.equal(run.status, 0, 'the syntax checker itself failed to run:\n' + run.stderr)

  const report = JSON.parse(run.stdout) as { checked: number, selfCheck: boolean, failures: string[] }
  // Floor, not an exact count: the probe count is claimed in AGENTS.md/README and
  // reconciled by tests/docs-consistency.test.ts; this only catches a walk that
  // silently found nothing.
  assert.ok(report.checked >= 30, `expected the full probe battery, checked only ${report.checked} files`)
  assert.equal(report.selfCheck, true, 'vm.SourceTextModule no longer rejects broken syntax')
  assert.deepEqual(report.failures, [], 'probe scripts with syntax errors:\n' + report.failures.join('\n'))
})
