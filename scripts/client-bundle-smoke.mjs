// Load-time smoke check for the built client bundle (lib/client.js).
//
// Why this exists (2026-10-06 incident): a hot-loaded bundle whose module graph
// throws while loading blanks the whole page, and the phone-side symptom is
// "进不来了" with no readable error. The unit tests never execute the bundle and
// `pnpm build` only proves it was written, so this script is the missing
// pre-flight gate: it evaluates the bundle in Node with a stub
// `window.__ModuleLoader__` and then RUNS the plugin's entry module (which
// pulls the whole inlined graph through the bundle's own local require), so a
// syntax error, a missing module key, or a top-level throw fails here instead
// of on the owner's phone.
//
// Usage: node scripts/client-bundle-smoke.mjs [path/to/client.js]
// Exit 0 = the bundle loads and the entry module evaluates; 1 = it does not.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const file = process.argv[2] ?? join(ROOT, 'lib', 'client.js')

/** A stand-in for one host module (react, the primitives table, …). */
function hostStub(name) {
  const fn = function () { return hostStub(name) }
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === '__esModule') return true
      if (prop === 'default') return hostStub(name)
      if (prop === 'then') return undefined
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => `[host:${name}]`
      return hostStub(`${name}.${String(prop)}`)
    },
    apply() { return hostStub(name) },
    construct() { return hostStub(name) },
  })
}

const source = readFileSync(file, 'utf8')
const registered = []
const windowStub = {
  __ModuleLoader__: {
    load(entry) {
      if (typeof entry?.id !== 'string' || typeof entry?.factory !== 'function') {
        throw new Error('__ModuleLoader__.load got a malformed entry')
      }
      registered.push(entry.id)
    },
  },
}

// 1) evaluation: the bundle registers itself (a syntax error surfaces here).
new Function('window', source)(windowStub)

const entryId = 'dsh-web-mobile'
if (!registered.includes(entryId)) {
  console.error(`SMOKE FAIL: entry module "${entryId}" was not registered (saw ${JSON.stringify(registered)})`)
  process.exit(1)
}

// 2) execution: run the entry factory; its internal require pulls every inlined
//    module, so any top-level throw in the graph surfaces here.
const entryFactory = (() => {
  let found
  const win = {
    __ModuleLoader__: {
      load(entry) { if (entry.id === entryId) found = entry.factory },
    },
  }
  new Function('window', source)(win)
  return found
})()

let exports
try {
  exports = entryFactory((specifier) => hostStub(specifier))
} catch (error) {
  console.error(`SMOKE FAIL: the entry module threw while loading: ${error?.stack ?? error}`)
  process.exit(1)
}

const missing = ['apply', 'inject'].filter((key) => exports?.[key] === undefined)
if (missing.length > 0) {
  console.error(`SMOKE FAIL: entry exports missing ${missing.join(', ')} (got ${Object.keys(exports ?? {}).join(', ')})`)
  process.exit(1)
}

// Count module DEFINITIONS only: the entry call line also reads
// `__modules["index.js"](...)`, so the old `__modules["` count reported one
// module more than the bundle inlines (issue #86).
const moduleCount = (source.match(/__modules\["[^"]+"\] = function/g) ?? []).length
console.log(`SMOKE PASS: ${file} — entry loaded, ${moduleCount} inlined modules, exports ${Object.keys(exports).join(', ')}`)
