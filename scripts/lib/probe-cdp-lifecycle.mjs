// CDP 探针生命周期收口（C13）：request deadline · readyState/同步失败清理 ·
// waitFor 的总 deadline（probe 自己不响应也要被切断）· **精确 PID** 资源回收。
import { existsSync, rmSync } from 'node:fs'

export const REQUEST_DEADLINE_MS = Number(process.env.DSH_PROBE_REQUEST_MS ?? 15000)

/** 总时限竞速：probe 自己永远不 settle 也必须被切断。 */
export function raceTotal(label, timeoutMs, promise) {
  let timer
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: total deadline ${timeoutMs}ms exceeded (probe did not respond)`)), timeoutMs)
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

/** 精确 PID 是否已退出（/proc 判定，不做进程名模糊匹配）。 */
export function pidExited(pid) {
  return pid === undefined || pid === null ? true : !existsSync(`/proc/${pid}`)
}

export async function waitForPidExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (!pidExited(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  return pidExited(pid)
}

/** 幂等的收尾：kill 自己那个 PID → 等它真的退出 → 删 profile；返回旁证。 */
export function createCleanup({ child, profileDir, rm, pid = child?.pid }) {
  let once = null
  return function cleanup() {
    // 并发幂等：**先**把进行中的 Promise 缓存下来（旧实现在 await 之后才赋值，
    // 同时两个调用会各自 kill/rm 一遍）。
    if (once !== null) return once
    once = (async () => {
    const evidence = { pid, killed: false, exited: pidExited(pid), removed: false }
    if (child && !pidExited(pid)) {
      evidence.killed = true
      try { child.kill('SIGTERM') } catch { /* 已退出 */ }
      if (!(await waitForPidExit(pid, 3000))) {
        try { child.kill('SIGKILL') } catch { /* 已退出 */ }
        await waitForPidExit(pid, 2000)
      }
    }
    evidence.exited = pidExited(pid)
    if (profileDir) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => {})
      evidence.removed = !existsSync(profileDir)
    }
    return evidence
    })()
    return once
  }
}

/**
 * C13：把「main + 回收 + SUMMARY」收进一个**错误也能回收**的入口。
 * 调用方（探针脚本）只需：`const ok = await runWithCleanup({ main, child: chrome, profileDir, rm, verdict })`
 * 不再需要在正常尾部手写清理、更不能在 catch 里 `process.exit(1)` 绕过回收。
 */
export async function runWithCleanup({ main, child, profileDir, rm, verdict = null, label = 'probe' }) {
  let failure = null
  try {
    await main()
  } catch (error) {
    failure = error
    const message = error instanceof Error ? error.message : String(error)
    if (verdict !== null) verdict.fail(`${label}:fatal`, message)
    else console.error(`FATAL ${label}: ${message}`)
  } finally {
    const evidence = await createCleanup({ child, profileDir, rm })()
    console.log('CLEANUP ' + JSON.stringify(evidence))
    if (evidence.exited !== true || evidence.removed !== true) {
      const message = `exited=${evidence.exited} removed=${evidence.removed}`
      if (verdict !== null) verdict.fail(`${label}:cleanup`, message)
      else throw new Error(`cleanup failed: ${message}`)
    }
    if (verdict !== null) {
      console.log(verdict.summary())
      console.log(`[${label}] exit=${verdict.exitCode()}`)
    }
  }
  return failure === null && (verdict === null || verdict.exitCode() === 0)
}

/**
 * C13 兜底：脚本被 `process.exit()` 直接终止时，'exit' 回调仍会同步执行。
 * 这里做**同步**回收（SIGKILL + rmSync），保证早退路径也不会留下自有 PID/profile。
 * 正常路径仍应走 createCleanup / runWithCleanup（它们提供异步等待与旁证）。
 */
export function installExitGuard({ getChild, getProfileDir }) {
  let done = false
  process.on('exit', () => {
    if (done) return
    done = true
    try {
      const child = getChild?.()
      if (child && child.pid && !pidExited(child.pid)) { try { child.kill('SIGKILL') } catch { /* 已退出 */ } }
    } catch { /* 忽略 */ }
    try { const dir = getProfileDir?.(); if (dir) rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })
}
