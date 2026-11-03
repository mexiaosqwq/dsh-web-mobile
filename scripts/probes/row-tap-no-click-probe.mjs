// Regression anchor: a drawer session-row tap must still navigate (and close
// the drawer) when the browser synthesizes no click at all.
//
// Why this file exists (2026-09-15, PR #49 premise):
//   On some WebKit/iOS builds a tap on a session row produces no `click`, so
//   the row's React onClick never runs and tapping another session silently
//   does nothing. Headless Chromium ALWAYS synthesizes that click, so the
//   symptom has to be simulated: a document-capture listener eats the click
//   before it can reach React's root container (React 18 delegates to the root
//   container, so a document-capture stopImmediatePropagation() means the
//   row's handler never runs — exactly the WebKit case being fixed).
//   The code under test is `onDrawerPointerUp`'s row branch in
//   `src/client/effects/phone-chrome.ts`: resolve the session id from the
//   row's React fiber chain, `ctx.sessions.open(id)`, and let the sessions
//   store close the drawer once the navigation lands. Delete that fallback and
//   this file goes red while every other gate stays green (headless Chromium
//   always dispatches the click, so no other probe needs it).
//
// Two scenes, same tap geometry:
//   A (control, click NOT suppressed): the tap must switch sessions. This
//     proves the probe's geometry/tap really does drive the host path, so a
//     failure can be told apart: A red = the whole tap path broke, A green +
//     B red = our no-click fallback broke.
//   B (click suppressed, `__navProbe.suppressed >= 1`): this is the #49 case.
//     BEFORE the fix: session unchanged and drawer stays open (red).
//     AFTER  the fix: session switches and the drawer closes (green).
// Assertion 5 is what makes B meaningful: if no click were dispatched at all,
// the suppression would be doing nothing and B would prove nothing.
//
// What this cannot prove: real WebKit behaviour. The suppression reproduces
// "the row's onClick never runs" at the event-system level only — it cannot
// reproduce a WebKit-specific pointerup ordering, a `pointercancel`, or an iOS
// shell that swallows events wholesale. A real-device failure here means
// `onDrawerPointerUp`'s row branch was never reached.
//
// Env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_SESSION_ID,
//      DSH_PROBE_COOKIE, DSH_PROBE_CHROME, DSH_PROBE_TIMEOUT_MS. Termux needs
//      a writable TMPDIR / XDG_RUNTIME_DIR for chromium (see AGENTS.md).
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.DSH_PROBE_CHROME || '/data/data/com.termux/files/usr/lib/chromium/chrome'
const PORT = 9355
const URL_BASE = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const TIMEOUT_MS = Number(process.env.DSH_PROBE_TIMEOUT_MS || 30000)
const DRAWER = '[data-mobile-nav="frame"] > [class*="sidebarCol"]'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const record = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`)
  if (!ok) failures.push(name)
}

async function waitFor(fn, label, timeoutMs = TIMEOUT_MS) {
  const started = Date.now()
  for (;;) {
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`${label} timeout`)
    await sleep(250)
  }
}

async function main() {
  const dir = await mkdtemp(join(homedir(), 'tmp', 'cdp-noclick-'))
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank'], { env: { ...process.env, TMPDIR: dir, XDG_RUNTIME_DIR: dir }, stdio: 'ignore' })
  try {
    let wsUrl
    await waitFor(async () => {
      try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; return wsUrl } catch { return null }
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
    /** Remove the Internal Testing Notice: its mask swallows touches. */
    const dropNotice = () => evaluate(`for (const m of document.querySelectorAll('[n="true"]')) m.remove()`)
    const current = () => evaluate(`(() => { const raw = localStorage.getItem('dsh.sessions.current'); return raw === null ? null : JSON.parse(raw).sessionId })()`)
    const collapsed = () => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed')`)
    /** One visible session row (optionally skipping the tapped/selected one). */
    const rowInfo = (opts = {}) => evaluate(`(() => {
      const drawer = document.querySelector(${JSON.stringify(DRAWER)})
      if (drawer === null) return null
      let rows = [...drawer.querySelectorAll('[role="treeitem"][class*="sessionRow"]')].filter((r) => r.getBoundingClientRect().width > 0)
      ${opts.unselected ? 'rows = rows.filter((r) => r.getAttribute("aria-selected") !== "true")' : ''}
      ${opts.skipTitle ? `rows = rows.filter((r) => (r.querySelector('[class*="_title"]')?.textContent || '').trim() !== ${JSON.stringify(opts.skipTitle)})` : ''}
      const row = rows[0]
      if (row === undefined) return null
      const rr = row.getBoundingClientRect()
      return {
        title: (row.querySelector('[class*="_title"]')?.textContent || '').trim(),
        selected: row.getAttribute('aria-selected') === 'true',
        total: drawer.querySelectorAll('[role="treeitem"][class*="sessionRow"]').length,
        tap: { x: Math.round(rr.x + 40), y: Math.round(rr.y + rr.height / 2) },
      }
    })()`)
    const openDrawer = async () => {
      if ((await collapsed()) === false) return true
      const toggle = await evaluate(`(() => { const el = document.querySelector('[data-mobile-nav="toggle"], [data-mobile-nav="fab"]'); if (el === null) return null; const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
      if (toggle === null) throw new Error('no plugin drawer control to tap')
      await tap(toggle.x, toggle.y)
      return waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === false`), 'drawer-open', 10000).catch(() => false)
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
    const seeded = process.env.DSH_PROBE_SESSION_ID || null
    if (seeded === null) throw new Error('DSH_PROBE_SESSION_ID is required')
    await send('Page.navigate', { url: URL_BASE })
    await waitFor(() => evaluate(`document.readyState === 'complete'`), 'load')
    await sleep(1500)
    await dropNotice()
    await evaluate(`localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: seeded }))})`)
    await send('Page.navigate', { url: URL_BASE })
    const active = await waitFor(() => evaluate(`document.querySelector('[data-phase]')?.getAttribute('data-phase') === 'active'`), 'active-phase', 15000).catch(() => false)
    record(active === true, '1.conversation-active', `seeded=${seeded}`)
    if (active !== true) throw new Error('seeded session did not reach the active phase')
    await sleep(1500)
    await dropNotice()

    // The no-click simulation. A document-capture listener runs before React's
    // root-container delegation, so eating the click here is byte-for-byte what
    // WebKit-no-click does to the row's onClick. Counting the eaten clicks is
    // what separates "the browser never dispatched one" from "we suppressed it".
    await evaluate(`(() => {
      window.__navProbe = { suppress: false, seen: 0, suppressed: 0 }
      document.addEventListener('click', (event) => {
        const target = event.target
        if (!(target instanceof Element) || target.closest('[class*="sessionRow"]') === null) return
        window.__navProbe.seen += 1
        if (!window.__navProbe.suppress) return
        window.__navProbe.suppressed += 1
        event.preventDefault()
        event.stopImmediatePropagation()
      }, true)
      return true
    })()`)

    // ---- scene A: control tap, click NOT suppressed ------------------------
    record((await openDrawer()) === true, '2.drawer-opens')
    await sleep(700)
    const control = await rowInfo({ unselected: true })
    if (control === null) throw new Error('no unselected session row in the drawer')
    const beforeControl = await current()
    await tap(control.tap.x, control.tap.y)
    const afterControl = await waitFor(async () => {
      const now = await current()
      return now !== null && now !== beforeControl ? now : null
    }, 'control-switch', 8000).catch(() => null)
    record(afterControl !== null, '3.control-tap-switches', `row="${control.title}" before=${beforeControl} after=${afterControl ?? 'unchanged'}`)
    await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === true`), 'control-close', 5000).catch(() => false)
    await sleep(500)

    // ---- scene B: the same tap with the click eaten ------------------------
    record((await openDrawer()) === true, '4.drawer-reopens')
    await sleep(700)
    const simulated = await rowInfo({ unselected: true, skipTitle: control.title })
    if (simulated === null) throw new Error('no second unselected session row in the drawer')
    const beforeSim = await current()
    await evaluate(`window.__navProbe.suppress = true`)
    await tap(simulated.tap.x, simulated.tap.y)
    const counters = await evaluate(`window.__navProbe`)
    record(counters.suppressed >= 1, '5.no-click-suppressed', `seen=${counters.seen} suppressed=${counters.suppressed}`)
    const afterSim = await waitFor(async () => {
      const now = await current()
      return now !== null && now !== beforeSim ? now : null
    }, 'simulated-switch', 8000).catch(() => null)
    record(afterSim !== null, '6.no-click-tap-switches', `row="${simulated.title}" before=${beforeSim} after=${afterSim ?? 'unchanged'}`)
    const closedAfterSim = await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === true`), 'simulated-close', 5000).catch(() => false)
    record(closedAfterSim === true, '7.no-click-tap-closes-drawer', `collapsedAfterTap=${closedAfterSim}`)
    await evaluate(`window.__navProbe.suppress = false`)
  } finally {
    chrome.kill()
    await sleep(300)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  if (failures.length > 0) { console.log(`FAILED: ${failures.join(', ')}`); process.exitCode = 1 } else { console.log('ALL PASS') }
}

main().catch((error) => { console.error('ERR', error.message); process.exitCode = 1 })
