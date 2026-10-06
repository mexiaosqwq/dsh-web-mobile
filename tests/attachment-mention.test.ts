// 「本次附件」 @ source (effects/attachment-mention.ts): the pure half in
// core/attachment-mention-core.ts is pinned here — host-shape normalization,
// candidate building, query filtering, pick → insert, and the model
// serialization. Plus source invariants of the adapter (mobile gating, own
// locale namespace, no DOM/fiber reads).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ATTACHMENT_SOURCE,
  ATTACHMENT_SOURCE_ORDER,
  buildCandidates,
  buildRefs,
  clipboardTextOf,
  draftAttachmentIdsOf,
  formatBytes,
  insertForPick,
  matchesQuery,
  normalizeDraftAttachments,
  parseRef,
  serializeRef,
} from '../src/client/core/attachment-mention-core.ts'
import type { AttachmentCopy, DraftAttachment } from '../src/client/core/attachment-mention-core.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EFFECT = readFileSync(join(ROOT, 'src/client/effects/attachment-mention.ts'), 'utf8')
const CORE = readFileSync(join(ROOT, 'src/client/core/attachment-mention-core.ts'), 'utf8')

const COPY: AttachmentCopy = {
  section: '本次附件',
  kindFile: '文件',
  kindImage: '图片',
  uploading: '上传中',
  failed: '上传失败',
  unnamed: (n) => `附件 ${n}`,
  mention: '附件',
}

const RAIL: DraftAttachment[] = [
  { id: 'a', kind: 'file', name: 'report.pdf', bytes: 2048, status: 'ready' },
  { id: 'b', kind: 'image', name: 'photo.png', bytes: 500 },
  { id: 'c', kind: 'file', name: 'notes-report.txt', bytes: 3 * 1024 * 1024, status: 'uploading' },
]

test('ids: rc.2 attachmentIds, rc.6 imageIds fallback, junk → []', () => {
  assert.deepEqual(draftAttachmentIdsOf({ attachmentIds: ['x', 'y'] }), ['x', 'y'])
  assert.deepEqual(draftAttachmentIdsOf({ imageIds: ['i'] }), ['i'])
  assert.deepEqual(draftAttachmentIdsOf({ attachmentIds: ['x', 3, null] }), ['x'])
  assert.deepEqual(draftAttachmentIdsOf(undefined), [])
  assert.deepEqual(draftAttachmentIdsOf({ draft: '' }), [])
})

test('normalize: host descriptors + upload snapshot; unknown shapes dropped', () => {
  const file = { name: 'a.pdf', size: 10 }
  const out = normalizeDraftAttachments(
    [
      { kind: 'file', id: 'f1', file },
      { kind: 'image', id: 'i1', file: { name: '', size: 5 }, previewUrl: 'blob:x' },
      { kind: 'video', id: 'v1', file },
      { id: 'no-kind' },
      null,
    ],
    { f1: { status: 'error', message: 'boom' }, i1: { status: 'ready' } },
  )
  assert.deepEqual(out, [
    { id: 'f1', kind: 'file', name: 'a.pdf', bytes: 10, status: 'error' },
    // images never carry an upload status
    { id: 'i1', kind: 'image', name: '', bytes: 5 },
  ])
  assert.deepEqual(normalizeDraftAttachments(undefined), [])
})

test('formatBytes', () => {
  assert.equal(formatBytes(500), '500 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3 MB')
})

test('empty rail → no candidates (section does not appear)', () => {
  assert.deepEqual(buildCandidates([], '', false, COPY), [])
})

test('candidates: section, icon, description, rail order on empty query', () => {
  const rows = buildCandidates(RAIL, '', false, COPY)
  assert.deepEqual(rows.map((r) => r.name), ['report.pdf', 'photo.png', 'notes-report.txt'])
  assert.ok(rows.every((r) => r.section === '本次附件' && r.icon === 'file'))
  assert.equal(rows[0]?.description, '文件 · 2 KB')
  assert.equal(rows[1]?.description, '图片 · 500 B')
  assert.equal(rows[2]?.description, '文件 · 3 MB · 上传中')
})

test('query filter: case-insensitive substring, prefix first; paths/drill excluded', () => {
  assert.deepEqual(buildCandidates(RAIL, 'REPORT', false, COPY).map((r) => r.name), ['report.pdf', 'notes-report.txt'])
  assert.deepEqual(buildCandidates(RAIL, 'png', false, COPY).map((r) => r.name), ['photo.png'])
  assert.deepEqual(buildCandidates(RAIL, 'zzz', false, COPY), [])
  // a path-shaped query or a drilled listing belongs to @文件
  assert.deepEqual(buildCandidates(RAIL, 'src/', false, COPY), [])
  assert.deepEqual(buildCandidates(RAIL, '', true, COPY), [])
  assert.equal(matchesQuery('a', '  ', false), true)
})

test('unnamed attachments get an ordinal label and still match it', () => {
  const rail: DraftAttachment[] = [{ id: 'p', kind: 'image', name: '' }]
  const rows = buildCandidates(rail, '附件', false, COPY)
  assert.deepEqual(rows.map((r) => r.name), ['附件 1'])
})

test('refs: ordinal is rail position; ambiguity = empty or duplicate name', () => {
  const refs = buildRefs([
    { id: '1', kind: 'image', name: 'image.png' },
    { id: '2', kind: 'file', name: 'a.txt' },
    { id: '3', kind: 'image', name: 'image.png' },
    { id: '4', kind: 'image', name: '' },
  ])
  assert.deepEqual(refs.map((r) => [r.ordinal, r.ambiguous]), [[1, true], [2, false], [3, true], [4, true]])
})

test('onPick → non-editable reference insert routed to this source', () => {
  const row = buildCandidates(RAIL, 'photo', false, COPY)[0]
  const insert = insertForPick(row?.value, COPY)
  assert.ok(insert)
  assert.equal(insert.source, ATTACHMENT_SOURCE)
  assert.equal(insert.appearance, 'file')
  assert.equal(insert.label, 'photo.png')
  assert.equal(insert.clipboardText, '@附件:photo.png')
  assert.equal(parseRef(insert.ref)?.id, 'b')
  // values minted elsewhere (ui-reference rows) are not ours
  assert.equal(insertForPick(JSON.stringify({ kind: 'file', mention: '@a' }), COPY), undefined)
  assert.equal(insertForPick('not json', COPY), undefined)
  assert.equal(insertForPick(undefined, COPY), undefined)
})

test('serialize: mirrors the host identity of the attachment block', () => {
  const [file, image] = buildRefs(RAIL)
  assert.equal(serializeRef(JSON.stringify(file)), '[attachment: File "report.pdf"]')
  assert.equal(serializeRef(JSON.stringify(image)), '[attachment: Image "photo.png"]')
  const [dupA, , unnamed] = buildRefs([
    { id: '1', kind: 'image', name: 'image.png' },
    { id: '2', kind: 'image', name: 'image.png' },
    { id: '3', kind: 'image', name: '' },
  ])
  assert.equal(serializeRef(JSON.stringify(dupA)), '[attachment #1: Image "image.png"]')
  assert.equal(serializeRef(JSON.stringify(unnamed)), '[attachment #3: Image]')
  // names are JSON-quoted like dsh-llm's `quoted()`
  const [quoted] = buildRefs([{ id: 'q', kind: 'file', name: 'a "b".txt' }])
  assert.equal(serializeRef(JSON.stringify(quoted)), '[attachment: File "a \\"b\\".txt"]')
  assert.equal(clipboardTextOf(unnamed!, COPY), '@附件:#3')
})

test('serialize rejects foreign refs (send must fail loud, not downgrade)', () => {
  assert.throws(() => serializeRef('@src/a.ts'))
  assert.throws(() => serializeRef(JSON.stringify({ v: 99, id: 'x', kind: 'file', name: 'a', ordinal: 1, ambiguous: false })))
})

test('group order sits before ui-reference (order 0)', () => {
  assert.ok(ATTACHMENT_SOURCE_ORDER < 0)
})

test('adapter invariants: mobile-gated, own locale NS, public services only', () => {
  assert.match(EFFECT, /installMobileEffect\(/)
  assert.match(EFFECT, /registerSource\(/)
  assert.match(EFFECT, /trigger: '@'/)
  assert.match(EFFECT, /locale\.register\(ATTACHMENT_NS/)
  assert.doesNotMatch(EFFECT, /i18n\/locales/)
  assert.doesNotMatch(EFFECT, /document\.|__reactFiber|querySelector/)
  assert.doesNotMatch(CORE, /^import /m)
})

test('candidates() never throws: the host calls it synchronously and unguarded', () => {
  // ui-input-trigger fetchCandidates 是「for (const source of roster)
  // source.candidates(projection, …).then(ok, fail)」——同步抛点不是 promise
  // rejection，处理不了，会打崩那一拍 `@` / `/` 菜单。所以同步读必须兜住，
  // 且兜住后的语义与「宿主这代没有这些成员」一致：空列表。
  const body = EFFECT.slice(EFFECT.indexOf('candidates(session, req)'))
  assert.ok(body.length > 0, 'candidates() is present')
  const open = body.indexOf('try {')
  const read = body.indexOf('readDraftAttachments(')
  const closed = body.indexOf('catch {')
  assert.ok(open > -1 && read > open && closed > read, 'the synchronous read sits inside try, catch follows it')
  assert.match(body.slice(closed, body.indexOf('}', closed)), /return Promise\.resolve\(\[\]\)/)
})
