// C10：trash-move 失败的**部分改名/回滚**契约（隔离 fs，不触真实会话数据）。
// 覆盖：成功 · 首个 payload 改名失败 · 第二个 payload 失败后回滚 · stash 失败（精确清单）
// 每个失败用例都跑 cold/live 两种返回形态。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteSession, type DeleteSessionDeps } from '../src/delete-session.ts'

const SESSION_ID = 'sess-123'
const CWD = '/home/u/proj'
const PROJECT_DIR = '--home-u-proj--'
const P1 = 'session.v2.jsonl.zstd'
const P2 = 'session.v3.jsonl.zstd'

function depsFor(root: string, dir: string, live: boolean): DeleteSessionDeps {
  const base: DeleteSessionDeps = {
    persistence: { config: { root }, list: async () => [{ header: { id: SESSION_ID, cwd: CWD } }] },
    workspaceRegistry: { list: () => [] },
  }
  if (!live) return base
  const session = { id: SESSION_ID }
  return {
    ...base,
    sessions: {
      get: () => session,
      flush: async (): Promise<boolean> => true,
      store: new Map([[SESSION_ID, { detach: (): void => {} }]]),
    },
  } as DeleteSessionDeps
}

async function scaffold(root: string): Promise<string> {
  const dir = join(root, PROJECT_DIR, SESSION_ID)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, P1), 'p1\n')
  return dir
}

test('C10 success: payloads stashed, no residual', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-c10-'))
  try {
    const dir = await scaffold(root)
    const result = await deleteSession(depsFor(root, dir, false), SESSION_ID)
    assert.equal(result.status, 200)
    assert.deepEqual(await readdir(dir).catch(() => 'gone'), 'gone')
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const live of [false, true]) {
  const mode = live ? 'live' : 'cold'

  test(`C10 ${mode}: first/only payload rename fails ⇒ rolled-back, directory exactly as before`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-c10-'))
    try {
      const dir = await scaffold(root)
      // 让 P1 → P1.trash 的改名失败：先占位一个**非空目录**在该目标名上。
      await mkdir(join(dir, `${P1}.trash`), { recursive: true })
      await writeFile(join(dir, `${P1}.trash`, 'blocker'), 'x')
      const result = await deleteSession(depsFor(root, dir, live), SESSION_ID)
      assert.equal(result.status, 500)
      assert.ok('error' in result)
      const message = 'error' in result ? result.error.message : ''
      // 没有改名成功 ⇒ 目录确实还是原样（"untouched" 在此为真话），且不得出现残留清单式的 PARTIALLY 说法
      assert.match(message, /untouched/)
      assert.doesNotMatch(message, /PARTIALLY renamed/)
      assert.doesNotMatch(message, /residual still staged/)
      // 规范化 payload 仍在原处（没有被改名）
      assert.ok((await readdir(dir)).includes(P1))
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test(`C10 ${mode}: second payload fails ⇒ previously renamed payload is rolled back`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-c10-'))
    try {
      const dir = await scaffold(root)
      await writeFile(join(dir, P2), 'p2\n')
      // 让 P2 的改名失败（非空目录占位），此时 P1 是否先成功取决 readdir 顺序；
      // 两种顺序下都必须以 rolled-back（无残留）结束。
      await mkdir(join(dir, `${P2}.trash`), { recursive: true })
      await writeFile(join(dir, `${P2}.trash`, 'blocker'), 'x')
      const result = await deleteSession(depsFor(root, dir, live), SESSION_ID)
      assert.equal(result.status, 500)
      const message = 'error' in result ? result.error.message : ''
      if (live) assert.match(message, /will not resume/)
      assert.doesNotMatch(message, /residual still staged/)
      const dirents = await readdir(dir, { withFileTypes: true })
      const names = dirents.map((d) => d.name)
      const trashFiles = dirents.filter((d) => d.isFile() && d.name.endsWith('.trash')).map((d) => d.name)
      // 两个规范化 payload 都必须在原位（已回滚），没有任何 ".trash" 文件残留
      assert.ok(names.includes(P1) && names.includes(P2), `payloads not restored: ${names.join(',')}`)
      assert.equal(trashFiles.length, 0, `unexpected .trash file leftovers: ${trashFiles.join(',')}`)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

for (const live of [false, true]) {
  const mode = live ? 'live' : 'cold'
  test(`C10 ${mode}: stash failure keeps exact renamed list and never claims untouched`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-c10-'))
    try {
      const dir = await scaffold(root)
      // 让 stash（把目录移入 trash）失败：把 .sessions-trash 造成**普通文件**。
      await writeFile(join(root, '.sessions-trash'), 'not a dir')
      const result = await deleteSession(depsFor(root, dir, live), SESSION_ID)
      assert.equal(result.status, 500)
      const message = 'error' in result ? result.error.message : ''
      assert.match(message, /stage=stash/)
      assert.match(message, new RegExp(`${P1} -> ${P1}\\.trash`), `exact renamed list missing: ${message}`)
      assert.match(message, /strip the suffix/)
      assert.doesNotMatch(message, /untouched/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

// C10：**回滚自身失败** —— 最危险分支（可能假称"已全部回滚/已恢复"）。
// 真实 fs 无法构造（rollback 目标不可写在 root 下造不出来），故用 deps.trashRename seam：
// 第一个 payload 前进成功、第二个前进失败、且回滚方向也失败。
for (const live of [false, true]) {
  const mode = live ? 'live' : 'cold'
  test(`C10 ${mode}: rollback itself fails ⇒ partial + exact residual, never claims full recovery`, async () => {
    const { rename } = await import('node:fs/promises')
    const root = await mkdtemp(join(tmpdir(), 'dsh-c10-'))
    try {
      const dir = await scaffold(root)
      await writeFile(join(dir, P2), 'p2\n')
      let forwards = 0
      const trashRename = async (from: string, to: string): Promise<void> => {
        if (to.endsWith('.trash')) {
          forwards += 1
          if (forwards >= 2) throw new Error('fixture: second payload rename failed')
          return rename(from, to)
        }
        throw new Error('fixture: rollback rename failed')
      }
      const deps = { ...depsFor(root, dir, live), trashRename } as DeleteSessionDeps
      const result = await deleteSession(deps, SESSION_ID)
      assert.equal(result.status, 500)
      assert.ok('error' in result)
      if (!('error' in result)) return
      const error = result.error
      // ① 恢复状态必须是 partial（绝不能是 rolled-back）
      assert.equal(error.recovery, 'partial')
      // ② residual 精确列出仍处 .trash 的那一个
      assert.equal(error.residual?.length, 1)
      const residualEntry = error.residual?.[0]
      assert.ok(residualEntry !== undefined)
      assert.ok(residualEntry.to.endsWith('.trash'), `residual.to=${residualEntry.to}`)
      assert.ok((await readdir(dir)).includes(residualEntry.to), 'residual 映射必须与实际文件状态一致')
      // ③ 不得出现 untouched / 不得声称已全部回滚
      assert.doesNotMatch(error.message, /untouched/)
      assert.doesNotMatch(error.message, /were rolled back/)
      assert.doesNotMatch(error.message, /exactly as before/)
      assert.match(error.message, /residual still staged/)
      // ④ renamed 仍如实保留映射
      assert.deepEqual(error.renamed, [{ from: residualEntry.from, to: residualEntry.to }])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
