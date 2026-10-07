import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headerValue, isDeferrable, parseAcceptedEncodings, pickEncoding, varyWithAcceptEncoding } from '../src/compress.ts'
import type { ServerResponse } from 'node:http'

test('headerValue finds keys regardless of casing', () => {
  assert.equal(headerValue({ 'Content-Type': 'application/json' }, 'content-type'), 'application/json')
  assert.equal(headerValue({ 'content-type': 'text/html' }, 'content-type'), 'text/html')
  assert.equal(headerValue({ 'CONTENT-ENCODING': 'gzip' }, 'content-encoding'), 'gzip')
  assert.equal(headerValue({ 'x-foo': '1' }, 'content-type'), undefined)
  assert.equal(headerValue({}, 'vary'), undefined)
  // Mixed-case keys are the raw writeHead argument reality.
  assert.equal(headerValue({ 'Content-Length': 123 }, 'content-length'), '123')
})

test('isDeferrable honors case-insensitive content-encoding / content-type', () => {
  // Lowercase keys (the pre-fix working case).
  assert.equal(isDeferrable({ 'content-type': 'application/json' }), true)
  assert.equal(isDeferrable({ 'content-type': 'application/json', 'content-encoding': 'gzip' }), false)
  assert.equal(isDeferrable({ 'content-type': 'text/html' }), false)
  // Mixed-case keys silently missed by the pre-fix direct lookup.
  assert.equal(isDeferrable({ 'Content-Type': 'application/json' }), true)
  assert.equal(isDeferrable({ 'Content-Type': 'application/json', 'Content-Encoding': 'br' }), false)
})

test('varyWithAcceptEncoding appends without clobbering, preserving key casing', () => {
  const none = {}
  varyWithAcceptEncoding(none)
  assert.deepEqual(none, { vary: 'Accept-Encoding' })

  const lowercase = { vary: 'Origin' }
  varyWithAcceptEncoding(lowercase)
  assert.equal(lowercase.vary, 'Origin, Accept-Encoding')

  const mixed = { Vary: 'Origin' }
  varyWithAcceptEncoding(mixed)
  assert.equal(mixed.Vary, 'Origin, Accept-Encoding')
  assert.equal(mixed.vary, undefined)
})

test('varyWithAcceptEncoding is idempotent and respects an existing token', () => {
  // Re-running the merge (plugin reload, several compressed responses sharing
  // one headers object) must not pile up tokens — a duplicated Vary value
  // pollutes the cache key.
  const already = { vary: 'Accept-Encoding' }
  varyWithAcceptEncoding(already)
  assert.equal(already.vary, 'Accept-Encoding')

  const mixedCase = { Vary: 'accept-encoding' }
  varyWithAcceptEncoding(mixedCase)
  assert.equal(mixedCase.Vary, 'accept-encoding')

  const inList = { vary: 'Origin, Accept-Encoding' }
  varyWithAcceptEncoding(inList)
  assert.equal(inList.vary, 'Origin, Accept-Encoding')

  // `*` already covers every request header.
  const star = { vary: '*' }
  varyWithAcceptEncoding(star)
  assert.equal(star.vary, '*')

  const empty = { vary: '' }
  varyWithAcceptEncoding(empty)
  assert.equal(empty.vary, 'Accept-Encoding')
})

test('pickEncoding honors q=0 refusals, weights and the wildcard (issue #81)', () => {
  const of = (acceptEncoding: string) =>
    pickEncoding({ req: { headers: { 'accept-encoding': acceptEncoding } } } as unknown as ServerResponse)

  // q=0 is a refusal: never hand the client a coding it said it cannot decode.
  assert.equal(of('br;q=0, gzip'), 'gzip')
  assert.equal(of('br;q=0'), null)
  assert.equal(of('gzip;q=0, br'), 'br')
  assert.equal(of('gzip;q=0'), null)
  // Weights pick the better coding.
  assert.equal(of('br;q=0.5, gzip;q=0.9'), 'gzip')
  assert.equal(of('br;q=0.9, gzip;q=0.5'), 'br')
  assert.equal(of('br;q=1.0, gzip;q=1.0'), 'br')
  // The wildcard is an offer, not a refusal; a named q=0 still overrides it.
  assert.equal(of('*'), 'br')
  assert.equal(of('br;q=0, *'), 'gzip')
  // Malformed weights are treated as a refusal rather than trusted.
  assert.equal(of('gzip;q=nonsense'), null)
  assert.equal(of('gzip;q=7'), 'gzip')
  // Unrelated codings stay untouched; no header means no compression.
  assert.equal(of('deflate'), null)
  assert.equal(of('identity'), null)
  assert.equal(of(''), null)
})

test('parseAcceptedEncodings reads weights, casing and the wildcard', () => {
  const parsed = parseAcceptedEncodings(' BR;q=0.8 , gzip ; q=0.2, *;q=0.1')
  assert.equal(parsed.get('br'), 0.8)
  assert.equal(parsed.get('gzip'), 0.2)
  assert.equal(parsed.get('*'), 0.1)
  assert.equal(parseAcceptedEncodings('br').get('br'), 1)
  // First occurrence wins; a duplicate never overrides an explicit refusal.
  assert.equal(parseAcceptedEncodings('br;q=0, br').get('br'), 0)
})

test('end() after flushHeaders() delivers the body instead of throwing (issue #81)', async () => {
  const { installResponseCompression } = await import('../src/compress.ts')
  const http = await import('node:http')
  const restore = installResponseCompression()
  const payload = JSON.stringify({ data: 'z'.repeat(8 * 1024) })
  const server = http.createServer((req, res) => {
    // A caller that flushes headers early: the deferred writeHead can no
    // longer be replayed and must not throw out of end().
    res.writeHead(200, { 'content-type': 'application/json' })
    res.flushHeaders()
    res.end(payload)
  })
  try {
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen))
    const port = (server.address() as { port: number }).port
    const out = await new Promise<{ status: number, headers: Record<string, string | string[]>, body: Buffer }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, headers: { 'accept-encoding': 'br' } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
    assert.equal(out.status, 200)
    // The headers are already on the wire, so the body goes out verbatim.
    assert.equal(out.headers['content-encoding'], undefined)
    assert.equal(out.body.toString(), payload)
  } finally {
    server.close()
    restore()
  }
})

test('end() after an early write() delivers every buffered byte (issue #81)', async () => {
  const { installResponseCompression } = await import('../src/compress.ts')
  const http = await import('node:http')
  const restore = installResponseCompression()
  const payload = JSON.stringify({ data: 'w'.repeat(8 * 1024) })
  const server = http.createServer((req, res) => {
    // A write() before writeHead() sends the implicit headers; the deferred
    // writeHead never lands and end() must still flush the whole body.
    res.write('lead:')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(payload)
  })
  try {
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen))
    const port = (server.address() as { port: number }).port
    const out = await new Promise<{ status: number, body: Buffer }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, headers: { 'accept-encoding': 'br' } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
    assert.equal(out.status, 200)
    assert.equal(out.body.toString(), `lead:${payload}`)
  } finally {
    server.close()
    restore()
  }
})

test('patched end() replays neither the encoding argument nor callback source (issue #78)', async () => {
  // Raw-socket assertions: fetch/undici tolerate a few trailing bytes, so
  // read the declared length against the actual framed body directly.
  const { installResponseCompression } = await import('../src/compress.ts')
  const http = await import('node:http')
  const { gunzipSync } = await import('node:zlib')
  const restore = installResponseCompression()
  const payload = JSON.stringify({ data: 'x'.repeat(8 * 1024) })
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url === '/two-arg') {
      res.end(payload, 'utf8')
    } else {
      res.write(payload)
      res.end(function done() {})
    }
  })
  try {
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen))
    const port = (server.address() as { port: number }).port
    const read = (path: string) => new Promise<{ status: number; headers: Record<string, string | string[]>, body: Buffer }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path, headers: { 'accept-encoding': 'gzip' } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
    // end(data, 'utf8'): nothing but the compressed payload may be written.
    const twoArg = await read('/two-arg')
    assert.equal(twoArg.headers['content-encoding'], 'gzip')
    assert.equal(twoArg.body.byteLength, Number(twoArg.headers['content-length']), 'body bytes must equal the declared content-length')
    assert.equal(gunzipSync(twoArg.body).toString(), payload, 'the payload round-trips without the encoding string appended')
    // end(callback): the callback must not leak as body data.
    const withCb = await read('/with-callback')
    assert.equal(withCb.headers['content-encoding'], 'gzip')
    assert.equal(withCb.body.byteLength, Number(withCb.headers['content-length']))
    assert.equal(gunzipSync(withCb.body).toString(), payload, 'callback source text must never reach the body')
  } finally {
    server.close()
    restore()
  }
})

test('patched write() replays buffered callbacks fire-once, in order, after end (issue #80)', async () => {
  const { installResponseCompression } = await import('../src/compress.ts')
  const http = await import('node:http')
  const restore = installResponseCompression()
  const fired: string[] = []
  const payload = JSON.stringify({ data: 'y'.repeat(8 * 1024) })
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write(payload, function firstWrite() { fired.push('first') })
    res.write(payload, function secondWrite() { fired.push('second') })
    res.end(function endCallback() { fired.push('end') })
  })
  try {
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen))
    const port = (server.address() as { port: number }).port
    await new Promise<void>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, headers: { 'accept-encoding': 'br' } }, (res) => {
        res.resume()
        res.on('end', () => resolve())
      }).on('error', reject)
    })
    // Write callbacks replay right after the real end(); the end callback
    // fires on Node's finish event — one bounded beat covers both.
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.deepEqual(fired, ['first', 'second', 'end'])
  } finally {
    server.close()
    restore()
  }
})

test('buffered strings honor the write()/end() encoding, e.g. latin1 (issue #80)', async () => {
  const { installResponseCompression } = await import('../src/compress.ts')
  const http = await import('node:http')
  const { gunzipSync } = await import('node:zlib')
  const restore = installResponseCompression()
  // 'é' is 0xE9 in latin1 but 0xC3 0xA9 in utf8 — a >4KB run makes the
  // silent re-encoding visible in the decompressed byte stream.
  const latin1Chunk = 'é'.repeat(4 * 1024)
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write(latin1Chunk, 'latin1')
    res.end('é', 'latin1')
  })
  try {
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen))
    const port = (server.address() as { port: number }).port
    const out = await new Promise<{ headers: Record<string, string | string[]>, body: Buffer }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, headers: { 'accept-encoding': 'gzip' } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
    assert.equal(out.headers['content-encoding'], 'gzip')
    const expected = Buffer.concat([Buffer.from(latin1Chunk, 'latin1'), Buffer.from('é', 'latin1')])
    assert.equal(gunzipSync(out.body).equals(expected), true, 'decompressed bytes must be latin1, not silently re-encoded utf8')
  } finally {
    server.close()
    restore()
  }
})
