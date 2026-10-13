// 两步注入法 v2：boot → 等 6s（宿主迟到回写先完成）→ setItem → 重导航 → 轮询 active → dump 气泡
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
const URL_ = 'http://127.0.0.1:3080/'
const CHROME = '/data/data/com.termux/files/usr/lib/chromium/chrome'
const SESSION = process.env.DSH_PROBE_SESSION_ID || 'd2bd6659-e128-485c-90fb-0898660621b9'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function allocatePort() { return new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close((e) => e ? rej(e) : res(port)) }) }) }
function createCdpClient(ws) {
  let n = 0; const p = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id !== undefined) { const q = p.get(m.id); if (!q) return; p.delete(m.id); m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result) } }
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++n; p.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
  return { send, evaluate, close: () => ws.close() }
}
async function waitFor(label, probe, timeout = 90000) { const d = Date.now() + timeout; while (Date.now() < d) { try { const v = await probe(); if (v) return v } catch { } await sleep(150) } throw new Error(label + ' timed out') }
const tmp = '/data/data/com.termux/files/home/tmp/cdp-fix'; await mkdir(tmp, { recursive: true })
const env = { ...process.env, TMPDIR: tmp, XDG_RUNTIME_DIR: tmp }
const port = await allocatePort(); const profileDir = await mkdtemp(join(homedir(), '.cache', 'dsh-diag17-'))
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, '--window-size=412,915', 'about:blank'], { stdio: 'ignore', env })
const target = await waitFor('target', async () => { try { const r = await fetch(`http://127.0.0.1:${port}/json`); if (!r.ok) return null; const t = await r.json(); return t.length ? t[0] : null } catch { return null } })
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const client = createCdpClient(ws); await client.send('Page.enable'); await client.send('Runtime.enable')
await client.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' })
await client.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenWidth: 412, screenHeight: 915 })
await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await client.send('Page.navigate', { url: URL_ })
await waitFor('boot1', async () => { const s = await client.evaluate(`({r:document.readyState==='complete'})`); return s.r ? s : null })
// 等宿主迟到回写完成（实测 ~4s），并等它稳定
let stable = null
for (let i = 0; i < 10; i++) {
  await sleep(1000)
  const v = await client.evaluate(`localStorage.getItem('dsh.sessions.current')?.slice(0, 80) ?? null`)
  if (v === stable && i >= 4) break
  stable = v
}
console.log('LS stabilized at:', stable)
await client.evaluate(`localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: SESSION }))}); 'ok'`)
const lsNow = await client.evaluate(`localStorage.getItem('dsh.sessions.current')?.slice(0, 80)`)
console.log('LS right before nav2:', lsNow)
await client.send('Page.navigate', { url: URL_ })
// C14：这里原本写的是 `client.evaluate(...) === 'active'`——与 Promise 比较，
// 恒 false，于是每次都在这里白等满 120s 再继续（诊断脚本的假红灯）。
// evaluate 的返回值必须 await 之后再比。
const act = await waitFor('active', async () => (await client.evaluate(`(()=>{const ph=document.querySelector('[data-phase]');return ph?ph.getAttribute('data-phase'):null})()`)) === 'active', 120000).catch(() => false)
console.log('active reached:', act)
await sleep(3000)
const d = await client.evaluate(`(() => {
  const cs = (el) => { const s = getComputedStyle(el); return { disp: s.display, vis: s.visibility, op: s.opacity } }
  const all = [...document.querySelectorAll('[data-phase] [class*="_bubble"]')]
  const inUser = all.filter((b) => b.closest('[class*="_userStack"]'))
  const others = all.filter((b) => !b.closest('[class*="_userStack"]'))
  const brief = (b) => { const r = b.getBoundingClientRect(); return { cls: (b.className || '').toString().slice(0, 50), ...cs(b), w: Math.round(r.width), h: Math.round(r.height), text: (b.textContent || '').slice(0, 30) } }
  const us = [...document.querySelectorAll('[data-phase] [class*="_userStack"]')].slice(0, 4).map((u) => { const r = u.getBoundingClientRect(); return { cls: (u.className || '').toString().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top), text: (u.textContent || '').slice(0, 30) } })
  const sb = document.querySelector('[data-phase] [class*="_scrollBody"]')
  return { total: all.length, userBubbles: inUser.slice(0, 4).map(brief), otherBubbles: others.slice(0, 4).map(brief), userStacks: us, tooltips: document.querySelectorAll('[data-phase] [role="tooltip"]').length, hasFlow: !!sb }
})()`)
console.log(JSON.stringify(d, null, 1))
const hidden = d.userBubbles.filter((b) => b.disp === 'none' || b.vis === 'hidden' || b.op === '0')
console.log('--- VERDICT --- userBubbles:', d.userBubbles.length, 'hidden:', hidden.length)
if (d.userBubbles.length) console.log('sample:', JSON.stringify(d.userBubbles[0]))
client.close(); chrome.kill('SIGTERM'); await Promise.race([once(chrome, 'exit').catch(() => { }), sleep(3000)]); chrome.kill('SIGKILL')
