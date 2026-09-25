import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat, utimes, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteSession, type DeleteSessionDeps, type DeleteSessionResult } from '../src/delete-session.ts'

// Layout conventions mirrored from the JSONL backend (format.ts):
//   sessionDir(root, cwd, id) = <root>/<projectKey(cwd)>/<encodeSegment(id)>/
// projectKey('/home/u/proj') = '--home-u-proj--'
// encodeSegment('a/b')       = 'a~002Fb'
const SESSION_ID = 'sess-123'
const CWD = '/home/u/proj'
const PROJECT_DIR = '--home-u-proj--'

function storedHeader(id = SESSION_ID, cwd = CWD): { id: string; cwd?: string } {
  return { id, cwd }
}

async function scaffoldSession(root: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  // Canonical payload name (mirror of the backend's CANONICAL_LOG_FILENAME):
  // only canonical names get the .trash rename in moveToTrash.
  await writeFile(join(dir, 'session.v2.jsonl.zstd'), 'header\n')
}

test('moves the stored session directory into the trash and reports ok', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const dir = join(root, PROJECT_DIR, SESSION_ID)
    await scaffoldSession(root, dir)
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 200)
    assert.equal('deleted' in result && result.deleted, SESSION_ID)
    // The canonical directory is gone (ENOENT holds under trash semantics too:
    // the directory was renamed into the trash, not deleted).
    await assert.rejects(stat(dir), { code: 'ENOENT' })
    // Trash contract: exactly one entry, payload renamed non-canonical,
    // manifest.json records the restore mapping, no canonical names remain.
    const trashRoot = join(root, '.sessions-trash')
    const trashNames = (await readdir(trashRoot)).filter((n) => n !== 'manifest.json')
    assert.equal(trashNames.length, 1)
    // <UTC timestamp>-<projectKey>-<encodedId>: '-' is a legal segment char
    // and is NOT escaped by encodeSegment.
    assert.equal(trashNames[0].endsWith(`-${PROJECT_DIR}-${SESSION_ID}`), true)
    const trashDir = join(trashRoot, trashNames[0])
    const trashFiles = await readdir(trashDir)
    assert.deepEqual(trashFiles.sort(), ['manifest.json', 'session.v2.jsonl.zstd.trash'])
    const manifest = JSON.parse(await readFile(join(trashDir, 'manifest.json'), 'utf8')) as {
      id?: unknown
      cwd?: unknown
      deletedAt?: unknown
      files?: { from?: string; to?: string }[]
    }
    assert.equal(manifest.id, SESSION_ID)
    assert.equal(manifest.cwd, CWD)
    assert.equal(typeof manifest.deletedAt, 'string')
    assert.deepEqual(manifest.files, [{ from: 'session.v2.jsonl.zstd', to: 'session.v2.jsonl.zstd.trash' }])
    // The parent project directory survives.
    await assert.doesNotReject(stat(join(root, PROJECT_DIR)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('escapes unsafe cwd and id segments while computing the directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const cwd = 'C:\\dev\\x'
    const id = 'a/b'
    const dir = join(root, '--C-dev-x--', 'a~002Fb')
    await scaffoldSession(root, dir)
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader(id, cwd) }],
      },
    }
    const result = await deleteSession(deps, id)
    assert.equal(result.status, 200)
    await assert.rejects(stat(dir), { code: 'ENOENT' })
    // The parent project directory survives; only the session directory is
    // moved into the trash.
    await assert.doesNotReject(stat(join(root, '--C-dev-x--')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reports 404 when the session is unknown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader('other-session') }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 404)
    assert.equal('error' in result && result.error.code, 'session-not-found')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reports 503 when the persistence backend exposes no root', async () => {
  const deps: DeleteSessionDeps = {
    persistence: {
      config: {},
      list: async () => [{ header: storedHeader() }],
    },
  }
  const result = await deleteSession(deps, SESSION_ID)
  assert.equal(result.status, 503)
  assert.equal('error' in result && result.error.code, 'persistence-unavailable')
})

test('stops a live agent, flushes, unregisters, then moves the directory into the trash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const dir = join(root, PROJECT_DIR, SESSION_ID)
    await scaffoldSession(root, dir)
    const calls: string[] = []
    const live = { id: SESSION_ID }
    const agentEntry = { id: SESSION_ID }
    const agents = {
      get: () => ({
        cancel: (cause: unknown): void => {
          calls.push('cancel')
          assert.deepEqual(cause, { kind: 'disposed' })
        },
        whenIdle: async (): Promise<void> => { calls.push('whenIdle') },
      }),
      store: new Map([[SESSION_ID, agentEntry]]),
      detachEntered: (entry: unknown): void => {
        calls.push('detachEntered')
        assert.equal(entry, agentEntry)
      },
    }
    const sessionEntry = { detach: (): void => { calls.push('detach') } }
    const sessions = {
      get: () => live,
      flush: async (session: unknown): Promise<boolean> => {
        calls.push('flush')
        assert.equal(session, live)
        return true
      },
      store: new Map([[SESSION_ID, sessionEntry]]),
    }
    const detached: string[] = []
    const workspaceRegistry = {
      list: () => [
        { detachSession: async (id: string): Promise<void> => { detached.push(id) } },
        { detachSession: async (id: string): Promise<void> => { detached.push(id) } },
      ],
    }
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
      sessions,
      agents,
      workspaceRegistry,
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 200)
    assert.deepEqual(calls, ['cancel', 'whenIdle', 'flush', 'detachEntered', 'detach'])
    assert.deepEqual(detached, [SESSION_ID, SESSION_ID])
    await assert.rejects(stat(dir), { code: 'ENOENT' })
    // The live session lands in the trash like a cold one.
    const trashNames = (await readdir(join(root, '.sessions-trash'))).filter((n) => n !== 'manifest.json')
    assert.equal(trashNames.length, 1)
    assert.match(trashNames[0], /--home-u-proj--/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reports 409 when the live agent does not converge to idle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const dir = join(root, PROJECT_DIR, SESSION_ID)
    await scaffoldSession(root, dir)
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
      sessions: {
        get: () => ({ id: SESSION_ID }),
        flush: async () => true,
      },
      agents: {
        get: () => ({
          cancel: (): void => {},
          whenIdle: async (): Promise<void> => { throw new Error('agent stuck') },
        }),
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 409)
    assert.equal('error' in result && result.error.code, 'session-busy')
    // Nothing was removed while the session could not be stopped.
    await assert.doesNotReject(stat(dir))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reports 500 when the artifact cannot be removed', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    // A regular file where the session storage root is expected: the trash
    // move resolves the session directory to a nested path under a file and
    // the mkdir/rename fails (ENOTDIR family).
    const root = join(base, 'not-a-dir')
    await writeFile(root, 'not a directory')
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 500)
    assert.equal('error' in result && result.error.code, 'delete-failed')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// issue #115: a failed trash move on a live (already stopped+unregistered)
// session must not be reported as an intact delete-failure — the session is
// dead, the workspace accounting must still be settled, and the client needs
// a distinct message. A cold session keeps the plain delete-failed semantics.

test('reports cleanup-failed and settles workspace accounting when a live session trash move fails', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    // Same injection as the cold failure case above (root is a regular file).
    const root = join(base, 'not-a-dir')
    await writeFile(root, 'not a directory')
    const liveTeardown: string[] = []
    const detached: string[] = []
    const live = { id: SESSION_ID }
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
      sessions: {
        get: () => live,
        flush: async (session: unknown): Promise<boolean> => {
          liveTeardown.push('flush')
          assert.equal(session, live)
          return true
        },
        store: new Map([[SESSION_ID, { detach: (): void => { liveTeardown.push('detach') } }]]),
      },
      workspaceRegistry: {
        list: () => [{ detachSession: async (id: string): Promise<void> => { detached.push(id) } }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 500)
    assert.equal('error' in result && result.error.code, 'cleanup-failed')
    assert.equal('deletedLiveSession' in result && result.deletedLiveSession, true)
    // The live session was really stopped and unregistered before the move.
    assert.deepEqual(liveTeardown, ['flush', 'detach'])
    // The workspace accounting was settled despite the failed trash move.
    assert.deepEqual(detached, [SESSION_ID])
    assert.equal('error' in result && /will not resume/.test(result.error.message), true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// issue #114 fix round 1: once the payloads carry the .trash suffix the
// session is hidden from the host list, so a retry delete would 404 — the
// live stash-stage message must guide a restore of the file names instead of
// promising that a bare retry cleans up. Injected by stripping the write bit
// of the PARENT project directory: renaming payloads only needs write access
// to the session directory (succeeds), while renaming the directory itself
// needs write access to its parent (fails) — precisely the stash stage.
test('the live stash-stage message guides a suffix restore instead of a bare retry', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const root = base
    const projectDir = join(root, PROJECT_DIR)
    const dir = join(projectDir, SESSION_ID)
    await scaffoldSession(root, dir)
    const liveTeardown: string[] = []
    const detached: string[] = []
    const live = { id: SESSION_ID }
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
      sessions: {
        get: () => live,
        flush: async (): Promise<boolean> => { liveTeardown.push('flush'); return true },
        store: new Map([[SESSION_ID, { detach: (): void => { liveTeardown.push('detach') } }]]),
      },
      workspaceRegistry: {
        list: () => [{ detachSession: async (id: string): Promise<void> => { detached.push(id) } }],
      },
    }
    await chmod(projectDir, 0o500)
    let result: DeleteSessionResult | undefined
    try {
      result = await deleteSession(deps, SESSION_ID)
    } finally {
      await chmod(projectDir, 0o755)
    }
    assert.equal(result?.status, 500)
    assert.equal('error' in result && result.error.code, 'cleanup-failed')
    assert.equal('deletedLiveSession' in result && result.deletedLiveSession, true)
    assert.deepEqual(liveTeardown, ['flush', 'detach'])
    assert.deepEqual(detached, [SESSION_ID])
    // The restore guidance is present and the (now impossible) bare-retry
    // promise is gone.
    const message = 'error' in result ? result.error.message : ''
    assert.match(message, /strip the suffix/)
    assert.doesNotMatch(message, /retry the delete/)
    // The rename-payloads stage ran: payloads are renamed, the directory
    // itself never reached the trash.
    const payload = await readdir(dir)
    assert.deepEqual(payload, ['session.v2.jsonl.zstd.trash'])
    await assert.doesNotReject(stat(dir))
    const trashCount = await readdir(join(root, '.sessions-trash')).then((n) => n.length).catch(() => 0)
    assert.equal(trashCount, 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('keeps delete-failed semantics for a cold session trash-move failure without workspace accounting', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const root = join(base, 'not-a-dir')
    await writeFile(root, 'not a directory')
    const detached: string[] = []
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
      workspaceRegistry: {
        list: () => [{ detachSession: async (id: string): Promise<void> => { detached.push(id) } }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 500)
    assert.equal('error' in result && result.error.code, 'delete-failed')
    assert.equal('deletedLiveSession' in result, false)
    // The cold session directory is still the session's home: no accounting.
    assert.deepEqual(detached, [])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('purges stale trash entries (older than 24h) after a successful move', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    // A pre-existing trash entry whose mtime is beyond the 24h TTL.
    const trashRoot = join(root, '.sessions-trash')
    const stale = join(trashRoot, '2026-09-24T00-00-00.000Z---home-u-proj---sess-old')
    await mkdir(stale, { recursive: true })
    await writeFile(join(stale, 'session.jsonl.zstd.trash'), 'old\n')
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(stale, old, old)
    // Plus a fresh entry that must survive the purge.
    const fresh = join(trashRoot, 'fresh-entry')
    await mkdir(fresh, { recursive: true })
    const dir = join(root, PROJECT_DIR, SESSION_ID)
    await scaffoldSession(root, dir)
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        list: async () => [{ header: storedHeader() }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 200)
    const names = await readdir(trashRoot)
    // The stale entry is gone; the fresh one and the new entry remain.
    assert.equal(names.length, 2)
    assert.equal(names.includes('fresh-entry'), true)
    assert.equal(names.some((n) => n.includes(SESSION_ID)), true)
    assert.equal(names.some((n) => n.startsWith('2026-09-24')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('uses the _no-cwd project key for a session without cwd (host parity)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const dir = join(root, '_no-cwd', SESSION_ID)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session.jsonl.zstd'), 'header\n')
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        // No cwd on the header → host projectDir() resolves to <root>/_no-cwd.
        list: async () => [{ header: { id: SESSION_ID } }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 200)
    await assert.rejects(stat(dir), { code: 'ENOENT' })
    const trashNames = (await readdir(join(root, '.sessions-trash'))).filter((n) => n !== 'manifest.json')
    assert.equal(trashNames.length, 1)
    // The trash name carries the _no-cwd key so a restore resolves without
    // parsing the payload header.
    assert.match(trashNames[0], /-_no-cwd-/)
    const manifest = JSON.parse(await readFile(join(root, '.sessions-trash', trashNames[0], 'manifest.json'), 'utf8')) as { id?: unknown; cwd?: unknown }
    assert.equal(manifest.id, SESSION_ID)
    assert.equal(manifest.cwd, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── mainline baselines（0.1.1-rc.2 / 0.1.2-rc.1 适配，非 fork 行为）──

test('accepts the flat SessionHeader[] list shape (0.1.1/0.1.2 hosts)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const dir = join(root, PROJECT_DIR, SESSION_ID)
    await scaffoldSession(root, dir)
    const deps: DeleteSessionDeps = {
      persistence: {
        config: { root },
        // 0.1.2 及更早：list() 返回扁平 SessionHeader[]（无 .header 包裹）
        list: async () => [{ id: SESSION_ID, cwd: CWD }],
      },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 200)
    await assert.rejects(stat(dir), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses a live session whose agent face lacks the disposal API with 409', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const dir = join(root, PROJECT_DIR, SESSION_ID)
    await scaffoldSession(root, dir)
    const deps: DeleteSessionDeps = {
      persistence: { config: { root }, list: async () => [{ header: storedHeader() }] },
      sessions: { get: () => ({ id: SESSION_ID }), flush: async () => true },
      // 0.1.1/0.1.2 的 agents.get() 返回不带 cancel/whenIdle 的 Agent face
      agents: { get: () => ({ id: SESSION_ID }) },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 409)
    assert.equal('error' in result && result.error.code, 'session-busy')
    // 目录必须原封未动：拒删不能附带破坏。
    await assert.doesNotReject(stat(dir))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('skips workspaces that expose no detachSession (0.1.1/0.1.2 hosts)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-del-'))
  try {
    const dir = join(root, PROJECT_DIR, SESSION_ID)
    await scaffoldSession(root, dir)
    const deps: DeleteSessionDeps = {
      persistence: { config: { root }, list: async () => [{ header: storedHeader() }] },
      workspaceRegistry: { list: () => [{}, { detachSession: async (): Promise<void> => {} }] },
    }
    const result = await deleteSession(deps, SESSION_ID)
    assert.equal(result.status, 200)
    await assert.rejects(stat(dir), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
