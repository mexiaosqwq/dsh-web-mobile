// Regression anchor: tapping 新会话 (New session) inside the mobile drawer must
// actually start a session — not merely retract the drawer.
//
// Why this file exists (2026-09-13, root cause):
//   installOverlayInteractions used to close the drawer from a document-capture
//   pointerup handler for every non-row nav target (newSession / taskboard /
//   ssh / search). Closing at pointerup collapses the drawer before the browser
//   synthesizes the tap's click, and a collapsed drawer no longer owns the
//   touch point, so Chrome dispatches NO click at all: the host's onClick
//   (startSession) never ran and the user only saw the drawer retract. Mouse
//   input never took that path, which is why the defect was touch-only.
//   Fix: non-row targets close through the existing capture click path.
//
// Assertions: session switches to a NEW id after the touch tap (the user's
// symptom), and the drawer still closes (UX kept). The pointer/click trace is
// printed as detail so a future failure shows which half regressed.
//
// Env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_SESSION_ID
//      (default: newest session of this repo's project dir), DSH_PROBE_COOKIE,
//      DSH_PROBE_CHROME, DSH_PROBE_TIMEOUT_MS.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.DSH_PROBE_CHROME || '/data/data/com.termux/files/usr/lib/chromium/chrome'
const PORT = 9342
const URL_BASE = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const TIMEOUT_MS = Number(process.env.DSH_PROBE_TIMEOUT_MS || 30000)
const DRAWER = '[data-mobile-nav="frame"] > [class*="sidebarCol"]'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const record = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`); if (!ok) failures.push(name) }

async function waitFor(fn, label, timeoutMs = TIMEOUT_MS) {
  const started = Date.now()
  for (;;) {
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`${label} timeout`)
    await sleep(250)
  }
}

/**
 * Session dirs are named by session id: --<cwd with / as ->-<sep>--/session-<uuid>.
 * Newest first, several of them: the newest may be an empty session another
 * probe just created, and only a session with content opens the active phase.
 */
async function recentSessionIds(limit = 4) {
  const encoded = `--${process.cwd().replace(/\//g, '-')}--`
  for (const dir of [encoded, '--data-data-com.termux-files-home--']) {
    const root = join(homedir(), '.dsh', 'sessions', dir)
    let names = []
    try { names = (await readdir(root)).filter((n) => n.startsWith('session-')) } catch { continue }
    const dated = []
    for (const name of names) {
      const info = await stat(join(root, name))
      dated.push({ name, mtimeMs: info.mtimeMs })
    }
    dated.sort((a, b) => b.mtimeMs - a.mtimeMs)
    if (dated.length > 0) return dated.slice(0, limit).map((entry) => entry.name)
  }
  return []
}

async function main() {
  const dir = await mkdtemp(join(homedir(), 'tmp', 'cdp-newsession-'))
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank'], { env: { ...process.env, TMPDIR: dir, XDG_RUNTIME_DIR: dir }, stdio: 'ignore' })
  try {
    let wsUrl
    await waitFor(async () => {
      try { const res = await fetch(`http://127.0.0.1:${PORT}/json`); const list = await res.json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; return wsUrl } catch { return null }
    }, 'chrome boot')
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    let id = 0
    const pending = new Map()
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined || !pending.has(message.id)) return
      const entry = pending.get(message.id)
      pending.delete(message.id)
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
    }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
    const evaluate = async (expression) => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (response.exceptionDetails) throw new Error(String(response.exceptionDetails.exception?.description || response.exceptionDetails.text))
      return response.result.value
    }
    const tap = async (x, y) => {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 0 }] })
      await sleep(50)
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    if (process.env.DSH_PROBE_COOKIE) {
      const raw = process.env.DSH_PROBE_COOKIE
      const eq = raw.indexOf('=')
      await send('Network.setCookie', { name: raw.slice(0, eq), value: raw.slice(eq + 1), url: URL_BASE })
    }
    await send('Page.navigate', { url: URL_BASE })
    await waitFor(() => evaluate(`document.readyState === 'complete'`), 'load')
    await sleep(1500)
    // The isolated profile raises the host's Internal Testing Notice; its mask
    // swallows touches, so the whole root must go.
    await evaluate(`for (const m of document.querySelectorAll('[n="true"]')) m.remove()`)

    const candidates = process.env.DSH_PROBE_SESSION_ID
      ? [process.env.DSH_PROBE_SESSION_ID]
      : await recentSessionIds()
    if (candidates.length === 0) throw new Error('no session id to seed (set DSH_PROBE_SESSION_ID)')
    let seeded = null
    let active = false
    for (const candidate of candidates) {
      seeded = candidate
      await evaluate(`localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: candidate }))})`)
      await send('Page.navigate', { url: URL_BASE })
      active = await waitFor(() => evaluate(`document.querySelector('[data-phase]')?.getAttribute('data-phase') === 'active'`), 'active-phase', 12000).catch(() => false)
      if (active === true) break
    }
    record(active === true, '1.conversation-active', `seeded=${seeded}`)
    if (active !== true) throw new Error(`none of the seeded sessions opened (tried ${candidates.join(', ')}; pass DSH_PROBE_SESSION_ID)`)
    await sleep(1500)
    await evaluate(`for (const m of document.querySelectorAll('[n="true"]')) m.remove()`)

    // Record the tap's pointer/click trace: the click on the button is the
    // input the host's onClick needs, and its absence is this bug's signature.
    await evaluate(`(() => {
      window.__tap = []
      const onButton = (el) => el instanceof Element && el.closest('[class*="newSession"]') !== null
      for (const kind of ['pointerdown', 'pointerup', 'click']) {
        document.addEventListener(kind, (event) => {
          if (!onButton(event.target)) return
          const frame = document.querySelector('[data-mobile-nav="frame"]')
          window.__tap.push(kind + (frame?.hasAttribute('data-sidebar-collapsed') ? '@closed' : '@open'))
        }, true)
      }
      return true
    })()`)

    // Open the drawer: the plugin toggle when present, edge swipe otherwise.
    const toggle = await evaluate(`(() => { const el = document.querySelector('[data-mobile-nav="toggle"], [data-mobile-nav="fab"]'); if (el === null) return null; const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
    if (toggle !== null) {
      await tap(toggle.x, toggle.y)
    } else {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 5, y: 400, radiusX: 2, radiusY: 2, force: 1, id: 0 }] })
      for (let i = 1; i <= 8; i += 1) {
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 5 + (55 * i) / 8, y: 400, radiusX: 2, radiusY: 2, force: 1, id: 0 }] })
        await sleep(16)
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const opened = await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === false`), 'drawer-open', 10000).catch(() => false)
    record(opened === true, '2.drawer-opens')
    await sleep(700)

    const button = await evaluate(`(() => {
      const drawer = document.querySelector(${JSON.stringify(DRAWER)})
      const el = drawer === null ? null : [...drawer.querySelectorAll('[class*="newSession"]')].find((x) => x.getBoundingClientRect().width > 0)
      if (el === null || el === undefined) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) }
    })()`)
    record(button !== null, '3.new-session-button-visible', button === null ? '' : `label=${button.label}`)
    if (button === null) throw new Error('new-session button not rendered in the drawer')

    await tap(button.x, button.y)
    const switched = await waitFor(async () => {
      const now = await evaluate(`localStorage.getItem('dsh.sessions.current')`)
      const current = now === null ? null : JSON.parse(now).sessionId
      return current !== null && current !== seeded ? current : null
    }, 'session-switch', 8000).catch(() => null)
    const trace = await evaluate(`window.__tap`)
    record(switched !== null, '4.tap-starts-new-session', `seeded=${seeded} current=${switched ?? 'unchanged'} trace=${trace.join('>') || 'none'}`)

    const closed = await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === true`), 'drawer-close', 5000).catch(() => false)
    record(closed === true, '5.drawer-closes-after-tap')
  } finally {
    chrome.kill()
    await sleep(300)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  if (failures.length > 0) { console.log(`FAILED: ${failures.join(', ')}`); process.exitCode = 1 } else { console.log('ALL PASS') }
}

main().catch((error) => { console.error('ERR', error.message); process.exitCode = 1 })
