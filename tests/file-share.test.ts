// Mobile file share (effects/file-share.ts): the share-vs-download decision
// and the windowed read are pure functions with injected platform seams, so
// every route is pinned here without a DOM: canShare true → share sheet;
// sheet dismissed (AbortError) → silent; no file sharing (Android WebView) →
// download; over the 50 MB share cap → download without asking; read
// failures map to stable codes; oversized files are refused after one read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  CHUNK_BYTES,
  hasWebShare,
  FileShareError,
  SHARE_MAX_BYTES,
  deliverFile,
  fileNameOf,
  isAbortError,
  mimeTypeOf,
  readWholeFile,
} from '../src/client/components/file-share-core.ts'
import type { ReadBytesResult, ShareableFile } from '../src/client/components/file-share-core.ts'

const file = (size = 10, name = 'report.pdf'): ShareableFile => ({ name, size })

/** Records every seam call so each route proves what it did NOT do too. */
function seams(opts: { canShare?: boolean | 'throw' | 'absent'; share?: 'ok' | Error | 'absent' } = {}) {
  const calls: string[] = []
  const canShare = opts.canShare ?? true
  const share = opts.share ?? 'ok'
  return {
    calls,
    deps: {
      canShare: canShare === 'absent' ? undefined : (data: { files: ShareableFile[] }) => {
        calls.push('canShare:' + data.files.length)
        if (canShare === 'throw') throw new TypeError('bad data')
        return canShare
      },
      share: share === 'absent' ? undefined : async (data: { files: ShareableFile[]; title: string }) => {
        calls.push('share:' + data.title)
        if (share instanceof Error) throw share
      },
      download: (f: ShareableFile) => { calls.push('download:' + f.name) },
    },
  }
}

const named = (name: string, message = name): Error => Object.assign(new Error(message), { name })

test('canShare true → navigator.share with the file and its name as title', async () => {
  const { calls, deps } = seams()
  assert.deepEqual(await deliverFile(file(), deps), { kind: 'shared' })
  assert.deepEqual(calls, ['canShare:1', 'share:report.pdf'])
})

test('a dismissed share sheet (AbortError) is silent: no download, cancelled outcome', async () => {
  const { calls, deps } = seams({ share: named('AbortError') })
  assert.deepEqual(await deliverFile(file(), deps), { kind: 'cancelled' })
  assert.deepEqual(calls, ['canShare:1', 'share:report.pdf'])
})

test('canShare false (e.g. Android WebView) → download, share never called', async () => {
  const { calls, deps } = seams({ canShare: false })
  assert.deepEqual(await deliverFile(file(), deps), { kind: 'downloaded', reason: 'unsupported' })
  assert.deepEqual(calls, ['canShare:1', 'download:report.pdf'])
})

test('no navigator.canShare / navigator.share at all → download', async () => {
  for (const variant of [{ canShare: 'absent' as const }, { share: 'absent' as const }]) {
    const { calls, deps } = seams(variant)
    assert.deepEqual(await deliverFile(file(), deps), { kind: 'downloaded', reason: 'unsupported' })
    assert.equal(calls.includes('share:report.pdf'), false)
    assert.equal(calls.at(-1), 'download:report.pdf')
  }
})

test('canShare throwing is treated as unsupported, not as a failure', async () => {
  const { calls, deps } = seams({ canShare: 'throw' })
  assert.deepEqual(await deliverFile(file(), deps), { kind: 'downloaded', reason: 'unsupported' })
  assert.equal(calls.at(-1), 'download:report.pdf')
})

test('over the share cap → download directly, the share sheet is never consulted', async () => {
  const { calls, deps } = seams()
  assert.deepEqual(await deliverFile(file(SHARE_MAX_BYTES + 1), deps), { kind: 'downloaded', reason: 'too-large' })
  assert.deepEqual(calls, ['download:report.pdf'])
  // Exactly at the cap still shares.
  const atCap = seams()
  assert.deepEqual(await deliverFile(file(SHARE_MAX_BYTES), atCap.deps), { kind: 'shared' })
  // The cap is injectable.
  const custom = seams()
  assert.deepEqual(await deliverFile(file(11), { ...custom.deps, shareMax: 10 }), { kind: 'downloaded', reason: 'too-large' })
})

test('any other share rejection (NotAllowedError, …) still delivers via download', async () => {
  const { calls, deps } = seams({ share: named('NotAllowedError') })
  assert.deepEqual(await deliverFile(file(), deps), { kind: 'downloaded', reason: 'share-failed' })
  assert.deepEqual(calls, ['canShare:1', 'share:report.pdf', 'download:report.pdf'])
})

test('isAbortError recognizes DOMException-shaped and plain named errors only', () => {
  assert.equal(isAbortError(named('AbortError')), true)
  assert.equal(isAbortError({ name: 'AbortError' }), true)
  assert.equal(isAbortError(named('NotAllowedError')), false)
  assert.equal(isAbortError(null), false)
  assert.equal(isAbortError('AbortError'), false)
})

/** A fake ranged reader over one byte array, recording each window it served. */
function fakeRemote(content: Uint8Array, opts: { reportSize?: boolean } = {}) {
  const windows: string[] = []
  const read = async (_path: string, range: { offset: number; length: number }): Promise<ReadBytesResult> => {
    windows.push(range.offset + '+' + range.length)
    const data = content.slice(range.offset, range.offset + range.length)
    return {
      ok: true,
      value: {
        offset: range.offset,
        data,
        eof: range.offset + data.length >= content.length,
        ...(opts.reportSize === false ? {} : { bytes: content.length }),
      },
    }
  }
  return { read, windows }
}

test('readWholeFile pulls windows until EOF and reassembles the bytes in order', async () => {
  const content = Uint8Array.from({ length: 25 }, (_, i) => i)
  const { read, windows } = fakeRemote(content)
  const result = await readWholeFile(read, 'a.bin', new AbortController().signal, 10)
  assert.equal(result.size, 25)
  assert.deepEqual(windows, ['0+10', '10+10', '20+10'])
  assert.deepEqual([...new Uint8Array(await new Blob(result.parts).arrayBuffer())], [...content])
})

test('readWholeFile refuses an oversized file after the first window', async () => {
  const { read, windows } = fakeRemote(new Uint8Array(50))
  await assert.rejects(
    readWholeFile(read, 'big.bin', new AbortController().signal, 10, 40),
    (error: unknown) => error instanceof FileShareError && error.code === 'too-large',
  )
  assert.deepEqual(windows, ['0+10'])
  // Without a reported size the running total still trips the cap.
  const unsized = fakeRemote(new Uint8Array(50), { reportSize: false })
  await assert.rejects(
    readWholeFile(unsized.read, 'big.bin', new AbortController().signal, 10, 40),
    (error: unknown) => error instanceof FileShareError && error.code === 'too-large',
  )
})

test('readWholeFile maps host failures onto stable codes', async () => {
  const failing = (code: string) => async (): Promise<ReadBytesResult> => ({ ok: false, error: { code, message: code } })
  const codeOf = async (code: string): Promise<string> => {
    try {
      await readWholeFile(failing(code), 'x', new AbortController().signal)
      return 'resolved'
    } catch (error) {
      return error instanceof FileShareError ? error.code : 'other'
    }
  }
  assert.equal(await codeOf('workspace-file/not-found'), 'not-found')
  assert.equal(await codeOf('workspace-file/not-regular-file'), 'not-found')
  assert.equal(await codeOf('workspace-file/too-large'), 'too-large')
  assert.equal(await codeOf('gateway/internal'), 'read-failed')
})

test('readWholeFile stops on abort and on an empty non-EOF window', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readWholeFile(fakeRemote(new Uint8Array(5)).read, 'x', controller.signal))
  const empty = async (): Promise<ReadBytesResult> => ({ ok: true, value: { offset: 0, data: new Uint8Array(0), eof: false } })
  assert.equal((await readWholeFile(empty, 'x', new AbortController().signal)).size, 0)
})

test('the default window stays under the host per-call cap (2 MiB default)', () => {
  assert.ok(CHUNK_BYTES <= 2 * 1024 * 1024)
})

test('fileNameOf and mimeTypeOf', () => {
  assert.equal(fileNameOf('/work/space/docs/report.PDF'), 'report.PDF')
  assert.equal(fileNameOf('C:\\work\\a.txt'), 'a.txt')
  assert.equal(mimeTypeOf('report.PDF'), 'application/pdf')
  assert.equal(mimeTypeOf('photo.jpeg'), 'image/jpeg')
  assert.equal(mimeTypeOf('Makefile'), 'application/octet-stream')
  assert.equal(mimeTypeOf('.env'), 'application/octet-stream')
  assert.equal(mimeTypeOf('a.unknownext'), 'application/octet-stream')
})

// Source contracts the runtime cannot show without a host: official slots,
// mobile gating, and the #104 rule (append only, never move host nodes).
test('installer registers both official slots inside installMobileEffect', async () => {
  const source = await readFile(new URL('../src/client/effects/file-share.ts', import.meta.url), 'utf8')
  assert.match(source, /installMobileEffect\(scope,/)
  assert.match(source, /'sidebar\.right\.tab\.document\.actions'/)
  assert.match(source, /'sidebar\.right\.tab\.files\.actions'/)
  assert.match(source, /locale\.register\(FILE_SHARE_NS/)
})

test('row decoration appends plugin buttons and never re-parents host nodes', async () => {
  const source = await readFile(new URL('../src/client/components/file-share-controls.tsx', import.meta.url), 'utf8')
  assert.match(source, /row\.appendChild\(button\)/)
  assert.doesNotMatch(source, /insertBefore|replaceWith|replaceChild|\.prepend\(/)
  assert.match(source, /li\[data-files-entry="file"\]/)
  assert.match(source, /aria-label/)
})

test('a running share blocks every row button, not only the tapped one', async () => {
  const source = await readFile(new URL('../src/client/components/file-share-controls.tsx', import.meta.url), 'utf8')
  // 单飞是 per-tree 的（inFlight 在本组件里），share() 在飞行中直接 return ⇒
  // 点另一行原本毫无反馈。整棵树的按钮一起进禁用态，只有被点的那行保留「分享中」。
  assert.match(source, /const blocked = busy !== null/)
  assert.match(source, /button\.disabled = blocked/)
  assert.doesNotMatch(source, /button\.disabled = active/)
  assert.match(source, /if \(active\) button\.setAttribute\('aria-busy', 'true'\)/)
})

test('hasWebShare only reports true when the platform really has Web Share', () => {
  // 诚实语义的地基：DSHA 的 WebView 两个成员都没有 ⇒ 按钮必须叫「下载」而不是「分享」。
  const noop = (): void => {}
  assert.equal(hasWebShare({ share: noop, canShare: () => true, download: noop }), true)
  assert.equal(hasWebShare({ share: undefined, canShare: () => true, download: noop }), false)
  assert.equal(hasWebShare({ share: noop, canShare: undefined, download: noop }), false)
  assert.equal(hasWebShare({ share: undefined, canShare: undefined, download: noop }), false)
})

test('the button is labelled 下载 (and gets a download glyph) when sharing is impossible', async () => {
  const source = await readFile(new URL('../src/client/components/file-share-controls.tsx', import.meta.url), 'utf8')
  // 两个标签点（预览头 + 文件树行）都必须走同一个诚实标签函数。
  assert.match(source, /function shareLabel\(t: Translate, name: string\): string \{/)
  assert.match(source, /hasWebShare\(platformDeps\(\)\) \? t\('shareFile', \{ name \}\) : t\('downloadFile', \{ name \}\)/)
  assert.equal((source.match(/shareLabel\(/g) ?? []).length, 3, '定义 1 + 使用 2')
  assert.doesNotMatch(source, /busy \? t\('sharing'\) : t\('shareFile'/, '预览头不再无条件叫分享')
  assert.doesNotMatch(source, /active \? tr\('sharing'\) : tr\('shareFile'/, '文件树行不再无条件叫分享')
  // 图标也跟着换：分享图标配「下载」标签会自相矛盾。
  assert.match(source, /hasWebShare\(platformDeps\(\)\) \? <ShareGlyph \/> : <DownloadGlyph \/>/)
  assert.match(source, /button\.innerHTML = hasWebShare\(platformDeps\(\)\) \? SHARE_SVG : DOWNLOAD_SVG/)
  const locale = await readFile(new URL('../src/client/components/file-share-locale.ts', import.meta.url), 'utf8')
  assert.match(locale, /'downloadFile': '下载「\{name\}」'/)
  assert.match(locale, /'downloadFile': 'Download "\{name\}"'/)
})
