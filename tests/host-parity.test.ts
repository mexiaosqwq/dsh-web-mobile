import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

// The entry is read as text rather than imported: tsc with moduleResolution
// "bundler" leaves the host half's relative specifiers as the `.js` spelling
// tsc will emit (`./compress.js`), and Node's ESM resolver does not map that
// back to `src/compress.ts` — so `import('../src/index.ts')` dies on
// ERR_MODULE_NOT_FOUND before any export is visible. The built entry, which
// does resolve, is checked by the lib probe in the task runbook instead.
test('the host entry declares the documented plugin name', () => {
  const declaredName = source.match(/export const name = ['"]([^'"]+)['"]/)
  assert.equal(declaredName?.[1], pkg.name)
  assert.match(source, /export function apply\(/)
})

// issue #114: the delete endpoint gained a same-origin gate and a body-size
// cap. The entry cannot be imported in tests (`.js` relative specifiers), so
// these text anchors lock the security contract into the source.
test('the delete endpoint enforces same-origin and a 1 MiB body cap', () => {
  assert.match(source, /const MAX_BODY_BYTES = 1_048_576/)
  // Origin present → must equal the request Host; absent/empty → allowed.
  assert.match(source, /function sameOrigin\(req: IncomingMessage\): boolean/)
  assert.match(source, /new URL\(origin\)\.host === req\.headers\.host/)
  assert.match(source, /origin === undefined \|\| origin === ''\) return true/)
  assert.match(source, /code: 'cross-origin'/)
  // Oversized body → 413; buffered data released, rest drained, so the
  // response is deliverable (no mid-stream destroy racing the reply).
  assert.match(source, /class PayloadTooLargeError extends Error/)
  assert.match(source, /code: 'payload-too-large'/)
  assert.match(source, /tooLarge = true/)
  assert.match(source, /data = ''/)
  // Gate runs after the method check and before the body is read.
  const originGate = source.indexOf('if (!sameOrigin(req))')
  const bodyRead = source.indexOf('await readBody(req)')
  const methodCheck = source.indexOf("req.method !== 'POST'")
  assert.notEqual(originGate, -1)
  assert.notEqual(bodyRead, -1)
  assert.ok(methodCheck < originGate && originGate < bodyRead)
})

// The delete handler must never reject without responding: a throwing deps
// face (persistence/sessions/agents/workspaceRegistry) is answered with the
// structured 500 like every other failure mode.
test('the delete handler wraps deleteSession in a catch-all 500', () => {
  const at = source.indexOf('await deleteSession(')
  assert.notEqual(at, -1, 'deleteSession call missing')
  const body = source.slice(source.indexOf('try {', Math.max(0, at - 40)), source.indexOf("code: 'delete-failed'", at))
  assert.ok(body.includes('await deleteSession('), 'the deleteSession call must sit inside the try')
  assert.match(body, /catch \(error\)/, 'the call must be wrapped in a catch')
  assert.match(body, /respond\(res, 500, \{/, 'the catch must answer 500')
  assert.match(source, /code: 'delete-failed'/, 'the crash path must use the structured delete-failed code')
})
