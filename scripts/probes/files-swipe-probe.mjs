// Files-panel swipe probe (right-edge gesture, spec
// 2026-09-13-files-swipe-gesture-design.md).
//
// The right edge zone (45% of the viewport, mirroring the drawer's start
// zone) drives the files gesture: a LEFTWARD stroke opens the host files
// panel (only when nothing is open), a RIGHTWARD stroke closes whatever is
// on top (the panel when it is open, the drawer when IT is open). A leftward
// stroke NEVER collapses anything (the 2026-09-13 narrowing: drawer open +
// right-edge leftward = a deliberate no-op).
//
// Scenes:
//   1. the files opener is present in the session frame;
//   2. right-edge leftward swipe opens the panel, drawer untouched;
//   3. panel open + rightward swipe closes it, drawer untouched;
//   4. panel closed + rightward swipe = no action;
//   5. drawer open + right-edge leftward swipe = drawer stays open (the
//      narrowing), panel stays closed;
//   6. drawer open + right-edge rightward swipe = drawer closes via the
//      animated path, panel untouched;
//   7. the synthetic click after a committed stroke does not re-toggle;
//   8. mouse pointer (touch emulation kept on): the same right-edge drag is
//      inert — the pointerType guard rejects mouse strokes; desktop
//      zero-impact is additionally covered by the pointer media gate.
//   9. the drawer footer carries no Files entry any more (only session log).
//  10. the files panel survives the drawer overlay: the drawer owns the hit
//      test over the panel column and the panel is still open underneath;
//  11. dismissing the drawer (backdrop tap) leaves the panel open.
//
// Env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_SESSION_ID
// (REQUIRED - the opener lives in a session frame), DSH_PROBE_COOKIE
// (name=value, for an authenticated instance), DSH_PROBE_CHROME.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const SESSION_ID = process.env.DSH_PROBE_SESSION_ID || ''
const COOKIE = process.env.DSH_PROBE_COOKIE || ''
const CHROME = process.env.DSH_PROBE_CHROME || 'chromium'
const PORT = 9363
const FRAME = '[data-mobile-nav="frame"]'
const PANEL = '[data-sidebar-right-panel]'
const OPENER = '[data-sidebar-right-expand]'
const TOGGLE = '[data-mobile-nav="toggle"]'
// Measured on 0.1.5: the panel element is persistent; the closed fullscreen
// form sits at visibility:hidden with its rect pushed off-viewport. Presence
// alone is not the panel-state read — test the same open-state logic the
// gesture layer uses (filesPanelOpen in sidebar-swipe.ts).
const PANEL_OPEN_JS = `(() => {
  const el = document.querySelector('${PANEL}')
  if (el === null) return false
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.display === 'none') return false
  return el.getBoundingClientRect().left < window.innerWidth
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const record = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`)
  if (!ok) failures.push(name)
}
async function waitFor(fn, label, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) { const v = await fn(); if (v) return v; await sleep(300) }
  throw new Error(label + ' timeout')
}

async function main() {
  if (SESSION_ID === '') {
    console.error('DSH_PROBE_SESSION_ID is required (the files opener lives in a session frame)')
    process.exit(1)
  }
  const dir = await mkdtemp(join(homedir(), 'tmp', 'cdp-files-swipe-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank',
  ], { env: { ...process.env, TMPDIR: dir, XDG_RUNTIME_DIR: dir }, stdio: 'ignore' })

  try {
    let wsUrl
    await waitFor(async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
        wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
        return wsUrl
      } catch { return null }
    }, 'chrome boot', 30000)

    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    let id = 0
    const pending = new Map()
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id)
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
      }
    }
    const send = (method, params = {}) => new Promise((res, rej) => {
      const mid = ++id; pending.set(mid, { res, rej })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value

    // Same stroke synthesis as cdp-swipe-probe.mjs (16ms input pacing keeps
    // the velocity window populated).
    const touchSwipe = async (x0, y0, x1, y1, durationMs = 120) => {
      const steps = Math.max(2, Math.round(durationMs / 16))
      await send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: x0, y: y0, radiusX: 2, radiusY: 2, force: 1, id: 0 }],
      })
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps
        await send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, radiusX: 2, radiusY: 2, force: 1, id: 0 }],
        })
        await sleep(16)
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    if (COOKIE) {
      const eq = COOKIE.indexOf('=')
      await send('Network.setCookie', { name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: URL_ })
    }
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage['dsh.sessions.current'] = JSON.stringify({sessionId:${JSON.stringify(SESSION_ID)}})`,
    })
    await send('Page.navigate', { url: URL_ })
    // Readiness is a DOM contract: the plugin frame marker proves the mobile
    // branch armed; [data-phase="active"] proves the host session is ready
    // (body.dataset.dshPhase does not exist in this host).
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}') !== null`), 'mobile frame', 30000)
    await waitFor(async () => await evaluate(`document.querySelector('[data-phase="active"]') !== null`), 'session active', 30000)

    const state = async () => JSON.parse(await evaluate(`(() => {
      const frame = document.querySelector('${FRAME}')
      return JSON.stringify({
        panel: ${PANEL_OPEN_JS},
        collapsed: frame === null ? null : frame.hasAttribute('data-sidebar-collapsed'),
      })
    })()`))

    // ---- 1. the files opener is present ----
    await waitFor(async () => await evaluate(`document.querySelector('${OPENER}') !== null`), 'files opener', 15000)
    record(true, '1.files-opener-present')

    // ---- 2. right-edge leftward swipe opens the panel, drawer untouched ----
    await touchSwipe(388, 400, 250, 400, 120)
    await waitFor(async () => await evaluate(`${PANEL_OPEN_JS}`), 'panel open', 8000)
    const s2 = await state()
    record(s2.collapsed === true, '2.files-open-drawer-untouched', `collapsed=${s2.collapsed}`)

    // ---- 3. panel open + rightward swipe closes it ----
    await sleep(600) // reverse gesture waits out the 350ms cooldown
    await touchSwipe(300, 400, 440, 400, 100)
    await waitFor(async () => await evaluate(`!(${PANEL_OPEN_JS})`), 'panel closed', 8000)
    const s3 = await state()
    record(s3.collapsed === true, '3.files-close-drawer-untouched', `collapsed=${s3.collapsed}`)

    // ---- 4. panel closed + rightward swipe = no action ----
    await sleep(600)
    await touchSwipe(388, 400, 500, 400, 100)
    await sleep(700)
    const s4 = await state()
    record(s4.panel === false && s4.collapsed === true, '4.rightward-closed-noop', `panel=${s4.panel} collapsed=${s4.collapsed}`)

    // ---- 5+6. drawer interplay (the 2026-09-13 narrowing) ----
    await evaluate(`(() => { document.querySelector('${TOGGLE}')?.click(); return true })()`)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}')?.hasAttribute('data-sidebar-collapsed') === false`), 'drawer open', 8000)
    await sleep(600)
    await touchSwipe(388, 400, 250, 400, 120) // leftward beside the open drawer
    await sleep(700)
    const s5 = await state()
    record(s5.collapsed === false && s5.panel === false, '5.drawer-leftward-noop',
      `collapsed=${s5.collapsed} panel=${s5.panel} (a leftward stroke beside the drawer must not close it and must not open the panel)`)
    await touchSwipe(388, 400, 520, 400, 100) // rightward beside the open drawer
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}')?.hasAttribute('data-sidebar-collapsed') === true`), 'drawer closed', 8000)
    const s6 = await state()
    record(s6.panel === false, '6.drawer-rightward-close-only', `panel=${s6.panel}`)

    // ---- 7. the synthetic click after a committed stroke does not re-toggle ----
    await sleep(600)
    await touchSwipe(388, 400, 250, 400, 120)
    await waitFor(async () => await evaluate(`${PANEL_OPEN_JS}`), 'panel reopen', 8000)
    await sleep(700) // outlast the consume window + cooldown
    const s7 = await state()
    record(s7.panel === true, '7.synthetic-click-no-retoggle', `panel=${s7.panel}`)

    // ---- 8. mouse pointer: the same right-edge drag is inert ----
    // Touch emulation stays ON so the mobile branch stays armed (turning it
    // off disarms the plugin entirely); the gesture layer's pointerType guard
    // must reject the mouse stroke on its own.
    await evaluate(`(() => { document.querySelector('[data-sidebar-right-toggle]')?.click(); return true })()`)
    await waitFor(async () => await evaluate(`!(${PANEL_OPEN_JS})`), 'panel closed again', 8000)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 388, y: 400, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 8; i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 388 - i * 17, y: 400 })
      await sleep(16)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 252, y: 400, button: 'left' })
    await sleep(700)
    const s8 = await state()
    record(s8.panel === false && s8.collapsed === true, '8.mouse-drag-inert', `panel=${s8.panel} collapsed=${s8.collapsed}`)

    // ---- 9. no plugin entry in the drawer footer; the export icon lives in the brand row ----
    // The hit test needs the drawer on screen: its closed slot sits at a
    // negative x, where elementFromPoint returns null by definition.
    await evaluate(`(() => { document.querySelector('${TOGGLE}')?.click(); return true })()`)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}')?.hasAttribute('data-sidebar-collapsed') === false`), 'drawer open for footer check', 8000)
    await sleep(400)
    const footer = JSON.parse(await evaluate(`(() => {
      const actions = document.querySelector('[data-mobile-nav="drawer-actions"]')
      const log = document.querySelector('[data-mobile-nav="session-log"]')
      const r = log === null ? null : log.getBoundingClientRect()
      const hit = r === null ? null : document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return JSON.stringify({
        actions: actions !== null,
        explorer: document.querySelector('[data-mobile-nav="explorer"]') !== null,
        log: log !== null,
        brandRow: log !== null && log.closest('[class*="logoRow"]') !== null,
        logHit: hit !== null && (hit === log || log.contains(hit)),
      })
    })()`))
    // explorer === false is a revive guard, not a live assertion: no src/ producer remains, so it turns red only if the entry returns.
    // actions === false pins issue #225: the footer no longer carries a plugin row.
    record(footer.actions === false && footer.explorer === false && footer.log === true && footer.brandRow === true && footer.logHit === true,
      '9.footer-no-plugin-entry',
      `actions=${footer.actions} explorer=${footer.explorer} log=${footer.log} brandRow=${footer.brandRow} logHit=${footer.logHit}`)
    // Close with Escape rather than a second TOGGLE click: while the drawer is
    // open the header toggle sits outside the drawer, so dsh-web-all's
    // installMobileSidebarDismiss swallows the click — programmatic ones too —
    // and the plugin's own handler never runs; Escape is the plugin's own
    // working close path (docs/specs/2026-09-17-sidebar-files-coexistence-design.md §2).
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}')?.hasAttribute('data-sidebar-collapsed') === true`), 'drawer closed after footer check', 8000)
    await sleep(600)

    // ---- 10. the panel survives the drawer overlay (coexistence contract) ----
    await touchSwipe(388, 400, 250, 400, 120)   // right-edge leftward: open the panel
    await waitFor(async () => await evaluate(`${PANEL_OPEN_JS}`), 'panel open for coexistence', 8000)
    await sleep(600)
    await touchSwipe(20, 420, 210, 420, 120)    // left-edge rightward: drawer over the panel
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}')?.hasAttribute('data-sidebar-collapsed') === false`), 'drawer over panel', 8000)
    await sleep(400)
    const over = JSON.parse(await evaluate(`(() => {
      const drawer = document.querySelector('${FRAME}')?.firstElementChild
      if (!(drawer instanceof HTMLElement)) return JSON.stringify({ drawer: false, inDrawer: false, panel: false })
      const r = drawer.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return JSON.stringify({
        drawer: true,
        inDrawer: hit !== null && drawer.contains(hit),
        panel: ${PANEL_OPEN_JS},
      })
    })()`))
    record(over.drawer === true && over.inDrawer === true && over.panel === true,
      '10.panel-survives-drawer-overlay',
      `drawer=${over.drawer} inDrawer=${over.inDrawer} panel=${over.panel}`)

    // ---- 11. the panel is still there once the drawer is dismissed ----
    // A trusted tap on the backdrop, past the drawer column's right edge: the
    // column is min(88vw, 280px) wide (280px at 390px), so x = 350 is outside it.
    await touchSwipe(350, 420, 350, 420, 40)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}')?.hasAttribute('data-sidebar-collapsed') === true`), 'drawer dismissed', 8000)
    await sleep(400)
    const s11 = await state()
    record(s11.panel === true, '11.panel-visible-after-drawer-close', `panel=${s11.panel}`)
  } finally {
    chrome.kill()
    await sleep(300)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  if (failures.length > 0) { console.log(`FAILED: ${failures.join(', ')}`); process.exitCode = 1 } else { console.log('ALL PASS') }
}
main().catch((e) => { console.error('ERR', e); process.exitCode = 1 })
