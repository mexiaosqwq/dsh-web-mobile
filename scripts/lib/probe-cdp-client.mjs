// 统一的 CDP 客户端（goal ①）：send / waitFor 只此一份实现，四脚本消费它。
// 语义 = 已验证的主探针版本 + zoom/failures 的加固：
//   • 每请求 deadline（结算即清定时器；超时同时清 pending）
//   • readyState 门（非 OPEN 立即拒绝）
//   • ws.send 同步抛错 → 清 pending + 拒绝
//   • 应答按 id 关联，收到即删 pending
export function createCdpClient({ ws, requestDeadlineMs = 15000 }) {
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }
    if (!msg || !msg.id || !pending.has(msg.id)) return
    const entry = pending.get(msg.id)
    pending.delete(msg.id)
    clearTimeout(entry.timer)
    if (msg.error) entry.rej(new Error(msg.error.message ?? 'cdp error'))
    else entry.res(msg.result)
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    if (ws.readyState !== 1) { rej(new Error(`socket not open (readyState=${ws.readyState}): ${method}`)); return }
    const mid = ++id
    const timer = setTimeout(() => {
      if (pending.has(mid)) pending.delete(mid)
      rej(new Error(`request deadline ${requestDeadlineMs}ms exceeded: ${method}`))
    }, requestDeadlineMs)
    pending.set(mid, { res, rej, timer })
    try { ws.send(JSON.stringify({ id: mid, method, params })) }
    catch (error) { pending.delete(mid); clearTimeout(timer); rej(error instanceof Error ? error : new Error(String(error))) }
  })
  // C13 修正：waitFor 必须**整体**受总 deadline 约束 —— probe 自身永不 settle 时
  // 循环里的 await 会让"只在迭代之间看时间"的写法永久挂住（原缺口）。
  // 就绪判据保持原语义：只认**真值**（undefined / 0 / '' / null / false 都不算就绪）。
  const waitFor = async (label, timeoutMs, probe) => {
    // C13 修正②：超时/取消后后台循环必须**立即停止** —— 只用 Promise.race 会让
    // 循环继续 probe() 并排新的 100ms 定时器（实测 5ms 超时后 130ms 内 probeCalls 1→2）。
    // 这里用停止旗标 + 可取消的 sleep + clearTimeout：停止后不再 probe、不再排定时器。
    let stopped = false
    let timer = null
    let cancelSleep = null
    const stop = () => {
      if (stopped) return
      stopped = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      if (cancelSleep) { const cancel = cancelSleep; cancelSleep = null; cancel() }
    }
    const pacedSleep = () => new Promise((resolve) => {
      const t = setTimeout(() => { cancelSleep = null; resolve() }, 100)
      cancelSleep = () => { clearTimeout(t); resolve() }
    })
    const loop = (async () => {
      for (;;) {
        if (stopped) return undefined
        let value
        try { value = await probe() } catch { value = undefined }
        if (stopped) return undefined
        if (value) return value
        await pacedSleep()
      }
    })()
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => {
        stop()
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
    try { return await Promise.race([loop, guard]) } finally { stop() }
  }
  return { send, waitFor, pending }
}
