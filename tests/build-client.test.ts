// Issue #85: the custom client bundler is the upstream of the white-screen
// gate, and it used to fail silently. Its dependency scan ran a
// double-quote-only regex over raw text, so a single-quoted (or template
// literal) relative require was neither inlined nor rewritten — the bundle
// merely threw at runtime — and a require written inside a COMMENT failed the
// whole build. There were no tests on it at all.
//
// These tests drive the real script against a throwaway fixture project.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/build-client.mjs')

async function buildFixture(files: Record<string, string>): Promise<{ status: number, stdout: string, stderr: string, bundle?: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bundle-'))
  try {
    await mkdir(join(root, 'scripts'), { recursive: true })
    await mkdir(join(root, '.client-build'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bundle-fixture', version: '0.0.0' }))
    await writeFile(join(root, 'scripts', 'build-client.mjs'), await readFile(SCRIPT, 'utf8'))
    for (const [name, content] of Object.entries(files)) {
      const target = join(root, '.client-build', name)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    const run = spawnSync(process.execPath, ['scripts/build-client.mjs'], { cwd: root, encoding: 'utf8' })
    let bundle: string | undefined
    try {
      bundle = await readFile(join(root, 'lib', 'client.js'), 'utf8')
    } catch {
      bundle = undefined
    }
    return { status: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '', ...(bundle === undefined ? {} : { bundle }) }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Run a built bundle through a stub loader and return the factory's exports. */
function loadBundle(bundle: string): unknown {
  let captured: { factory: (require: (id: string) => unknown) => unknown } | null = null
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: (spec: { factory: (require: (id: string) => unknown) => unknown }) => { captured = spec } } },
  })
  vm.runInContext(bundle, context)
  assert.ok(captured, 'the bundle must register its factory')
  return captured.factory((id: string) => {
    throw new Error(`unexpected platform require: ${id}`)
  })
}

test('a single-quoted relative require is inlined and usable (used to be dropped)', async () => {
  const built = await buildFixture({
    'index.js': "const dep = require('./dep.js')\nexports.answer = dep.value\n",
    'dep.js': 'exports.value = 42\n',
  })
  assert.equal(built.status, 0, built.stderr)
  assert.ok(built.bundle?.includes('__modules["dep.js"]'), 'the dependency must be inlined')
  assert.deepEqual({ ...(loadBundle(built.bundle) as object) }, { answer: 42 })
})

test('a template-literal relative require is inlined too', async () => {
  const built = await buildFixture({
    'index.js': "const dep = require(`./dep.js`)\nexports.answer = dep.value\n",
    'dep.js': 'exports.value = 7\n',
  })
  assert.equal(built.status, 0, built.stderr)
  assert.ok(built.bundle?.includes('__modules["dep.js"]'))
  assert.deepEqual({ ...(loadBundle(built.bundle) as object) }, { answer: 7 })
})

test('a require written inside a comment neither fails the build nor inlines', async () => {
  const built = await buildFixture({
    'index.js': '// was require("./ghost.js") once\nexports.ok = true\n',
  })
  assert.equal(built.status, 0, built.stderr)
  assert.ok(built.bundle?.includes('__modules["index.js"]'))
  assert.equal(built.bundle?.includes('ghost.js"] = function'), false, 'a commented require is not a dependency')
  assert.deepEqual({ ...(loadBundle(built.bundle) as object) }, { ok: true })
})

test('a genuinely missing dependency still fails loudly', async () => {
  const built = await buildFixture({
    'index.js': "const dep = require('./missing.js')\nexports.answer = dep.value\n",
  })
  assert.notEqual(built.status, 0)
  assert.match(built.stderr, /client module not found for require: missing\.js/)
})

test('leftover ESM syntax in the emit fails the build instead of shipping', async () => {
  const built = await buildFixture({
    'index.js': 'export const answer = 42\n',
  })
  assert.notEqual(built.status, 0)
  assert.match(built.stderr, /syntax self-check/)
})

test('the emitted program is parseable and self-contained', async () => {
  const built = await buildFixture({
    'index.js': "const nested = require('./nested/deep.js')\nexports.answer = nested.value\n",
    'nested/deep.js': 'exports.value = 1\n',
  })
  assert.equal(built.status, 0, built.stderr)
  assert.ok(built.bundle)
  assert.doesNotThrow(() => new vm.Script(built.bundle as string))
  assert.deepEqual({ ...(loadBundle(built.bundle) as object) }, { answer: 1 })
  assert.match(built.stdout, /2 modules inlined/)
})

// Debug badge bundle revision (2026-10-10). The badge's first line used to be
// the literal `build 20260919`, which no rebuild could ever change — the worst
// kind of lie, sitting on the first line of the only online diagnostic channel
// ("is the phone running my latest build?"). It now reports the `rev` the host
// stamped on this plugin's own bundle URL, so the pure core below is what
// stands between a report and a false answer: a miss must read as unknown, not
// as a stale constant.
//
// Lives in this file because it is the client-bundle-to-browser pipeline's
// neighbour and this file already owns that surface (adding a new test file
// would also desync the AGENTS.md test-count gate).
import { parseBundleRev } from '../src/client/debug.ts'

const OUR_BUNDLE = 'plugins/??@deepseek-ai/dsh-client-ui-open-in-app/client.js,dsh-web-mobile/client.js,@linxin666/dsh-web-all/client.js&rev=b621b7df1541'

test('bundle rev: reads the revision off our own combo URL', () => {
  assert.equal(parseBundleRev(OUR_BUNDLE), 'b621b7df1541')
})

test('bundle rev: survives extra query parameters and parameter order', () => {
  assert.equal(parseBundleRev('/plugins/??dsh-web-mobile/client.js&rev=0123456789ab&sourceMap=1'), '0123456789ab')
  assert.equal(parseBundleRev('/plugins/??dsh-web-mobile/client.js&x=1&rev=deadbeef1234'), 'deadbeef1234')
  assert.equal(parseBundleRev('http://127.0.0.1:3080/plugins/??dsh-web-mobile/client.js&rev=f7b7d26bbd58'), 'f7b7d26bbd58')
})

test('bundle rev: no rev means unknown, never a fallback value', () => {
  assert.equal(parseBundleRev('plugins/??a/client.js,b/client.js'), null)
  assert.equal(parseBundleRev('plugins/??dsh-web-mobile/client.js&rev='), null)
})

test('bundle rev: empty and non-string input means unknown', () => {
  assert.equal(parseBundleRev(''), null)
  assert.equal(parseBundleRev(undefined), null)
  assert.equal(parseBundleRev(null), null)
})
