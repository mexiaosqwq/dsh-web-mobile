// Drawer click-path animation probe (2026-09-17). Owner report: opening the
// drawer from the header toggle and closing it from the backdrop both jumped
// without animating, while swipes animated fine. Root cause (design doc
// docs/superpowers/specs/2026-09-17-drawer-click-animation-design.md): the
// host's 0.1.5 narrow-branch rule
//   [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"]   (0,3,0)
// beat our (0,2,0) drawer rule for BOTH width and transform, so the closed
// drawer never reached its -110% slot and the only state delta left was the
// width (52<->280), which "transition: transform" cannot animate.
//
// Scenes:
//   1. the closed drawer sits OFF-SCREEN at the designed slot (width ~280,
//      rect.right <= 0);
//   2. clicking the header toggle animates: at least one sampled frame differs
//      from both the start and the landing transform, and it lands on
//      computed transform:none (the open contract);
//   3. clicking the backdrop animates back out and lands off-screen (late
//      commit: the marker flips only after the slide finishes);
//   4. clicking the toggle while open animates too (same choke point);
//   5. desktop (pointer:fine): no frame marker, pane keeps transform:none.
//
// Env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_SESSION_ID
// (REQUIRED), DSH_PROBE_COOKIE (name=value, for an authenticated instance),
// DSH_PROBE_CHROME.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const SESSION_ID = process.env.DSH_PROBE_SESSION_ID || ''
const COOKIE = process.env.DSH_PROBE_COOKIE || ''
const CHROME = process.env.DSH_PROBE_CHROME || 'chromium'
const PORT = 9367
const FRAME = '[data-mobile-nav="frame"]'
const TOGGLE = '[data-mobile-nav="toggle"]'
const BACKDROP = '[data-mobile-nav="backdrop"]'
const PANE = '[data-pane="sidebar"]'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const record = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`)
  if (!ok) failures.push(name)
}
async function waitFor(fn, label, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const v = await fn()
    if (v) return v
    await sleep(100)
  }
  throw new Error(label + ' timeout')
}

const GEOMETRY = `(() => {
  const frame = document.querySelector('${FRAME}')
  if (frame === null) return 'null'
  const pane = frame.querySelector('[class*="_sidebarCol"]')
  const cs = getComputedStyle(pane)
  const r = pane.getBoundingClientRect()
  return JSON.stringify({
    collapsed: frame.hasAttribute('data-sidebar-collapsed'),
    width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right),
    transform: cs.transform, transition: cs.transitionProperty + ' ' + cs.transitionDuration,
    backdrop: document.querySelectorAll('${BACKDROP}').length,
  })
})()`

async function main() {
  if (SESSION_ID === '') {
    console.error('DSH_PROBE_SESSION_ID is required (the plugin arms inside a session frame)')
    process.exit(1)
  }
  const dir = await mkdtemp(join(homedir(), 'tmp', 'cdp-drawer-anim-'))
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
    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value

    /** Click `clickJs` inside the page and sample the pane's computed transform
     * once per animation frame. before/seen/after let the assertions tell an
     * animation from a jump. */
    const sample = async (clickJs, frames = 16) => await evaluate(`(async () => {
      try {
        const pane = () => document.querySelector('${FRAME} [class*="_sidebarCol"]')
        const before = getComputedStyle(pane()).transform
        void ${clickJs}
        const seen = []
        for (let i = 0; i < ${frames}; i += 1) {
          await new Promise((r) => requestAnimationFrame(r))
          seen.push(getComputedStyle(pane()).transform)
        }
        return { before, seen }
      } catch (error) {
        return { error: String(error), stack: String((error && error.stack) || "").slice(0, 300) }
      }
    })()`)

    /** Animated iff some frame differs from both the start and the landing value. */
    const animated = (s, landing) => s.seen.some((t) => t !== s.before && t !== landing)

    const navigate = async (width, height, mobile, touch) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
      await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
      await send('Page.navigate', { url: URL_ })
    }

    await send('Page.enable')
    await send('Runtime.enable')
    if (COOKIE) {
      const eq = COOKIE.indexOf('=')
      await send('Network.setCookie', { name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: URL_ })
    }
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage['dsh.sessions.current'] = JSON.stringify({sessionId:${JSON.stringify(SESSION_ID)}})`,
    })

    // ---- phone (390x844, coarse) ----
    await navigate(390, 844, true, true)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}') !== null`), 'mobile frame', 30000)
    await waitFor(async () => await evaluate(`document.querySelector('[data-phase="active"]') !== null`), 'session active', 30000)
    // The isolated profile pops the host's Internal Testing Notice: drop the
    // whole root (removing only [aria-modal] leaves a mask that eats touches).
    await evaluate(`(() => {
      for (const el of document.querySelectorAll('[aria-modal="true"]')) {
        const root = el.closest('[class*="_root_"]') || el
        root.remove()
      }
      return true
    })()`)
    await sleep(400)

    // ---- 1. closed drawer is off-screen at the designed slot ----
    const closed = JSON.parse(await evaluate(GEOMETRY))
    // The designed slot is translateX(-110%) of the pane's own width, so
    // left <= -width (390px: left=-308, right=-28). "Off-screen" alone would
    // also pass for a 52px host shell at x=0 - the bug this probe was born for.
    record(closed.collapsed === true && closed.width >= 200 && closed.left <= -closed.width,
      '1.closed-offscreen',
      `rect=[${closed.left},${closed.width}] right=${closed.right} transform=${closed.transform}`)

    record(await evaluate(`document.querySelector('${TOGGLE}') !== null`) === true, '2a.toggle-present')

    // ---- 2. toggle click opens WITH animation ----
    const openSample = await sample(`(() => { document.querySelector('${TOGGLE}').click(); return true })()`)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}').hasAttribute('data-sidebar-collapsed') === false`), 'drawer open', 8000)
    await sleep(400)
    const opened = JSON.parse(await evaluate(GEOMETRY))
    record(animated(openSample, opened.transform),
      '2.toggle-open-animates',
      `before=${openSample.before} seen=${openSample.seen.slice(0, 5).join(' | ')} landing=${opened.transform}`)
    record(opened.transform === 'none' && opened.width >= 200,
      '2b.open-landing', `transform=${opened.transform} width=${opened.width}`)

    // ---- 3. backdrop click closes WITH animation (late commit) ----
    // The catcher is persistent since 2026-11-08 (the dim paints on the frame's
    // ::after), so arm the wait on [data-active] — the state that actually says
    // the close affordance is live — instead of on the element's presence.
    await waitFor(async () => await evaluate(`document.querySelector('${BACKDROP}')?.hasAttribute('data-active') === true`), 'backdrop armed', 8000)
    const closeSample = await sample(`(() => { document.querySelector('${BACKDROP}').click(); return true })()`)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}').hasAttribute('data-sidebar-collapsed') === true`), 'drawer closed', 8000)
    await sleep(300)
    const closedAgain = JSON.parse(await evaluate(GEOMETRY))
    record(animated(closeSample, closedAgain.transform),
      '3.backdrop-close-animates',
      `before=${closeSample.before} seen=${closeSample.seen.slice(0, 5).join(' | ')} landing=${closedAgain.transform}`)
    record(closedAgain.right <= 0, '3b.close-landing', `right=${closedAgain.right} transform=${closedAgain.transform}`)

    // ---- 4. Escape closes with animation (a second entry point into the same
    //         close choke point; the header toggle is unreachable while open -
    //         the drawer covers it and the third-party dismiss shim swallows
    //         frame clicks outside the drawer) ----
    await sleep(500)
    await evaluate(`(() => { document.querySelector('${TOGGLE}').click(); return true })()`)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}').hasAttribute('data-sidebar-collapsed') === false`), 'drawer open again', 8000)
    await sleep(500)
    const closeSample2 = await sample(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
    await waitFor(async () => await evaluate(`document.querySelector('${FRAME}').hasAttribute('data-sidebar-collapsed') === true`), 'drawer closed again', 8000)
    await sleep(300)
    const closedThird = JSON.parse(await evaluate(GEOMETRY))
    record(animated(closeSample2, closedThird.transform),
      '4.escape-close-animates',
      `seen=${closeSample2.seen.slice(0, 5).join(' | ')} landing=${closedThird.transform}`)

    // ---- 5. desktop (pointer:fine): mobile rules must not leak ----
    await navigate(1280, 720, false, false)
    await waitFor(async () => await evaluate(`document.querySelector('${PANE}') !== null`), 'desktop pane', 30000)
    await sleep(800)
    const desktop = JSON.parse(await evaluate(`(() => {
      const pane = document.querySelector('${PANE}')
      const cs = getComputedStyle(pane)
      return JSON.stringify({
        frame: document.querySelector('${FRAME}') !== null,
        transform: cs.transform, width: Math.round(pane.getBoundingClientRect().width),
      })
    })()`))
    // The gate is the activation query itself: pointer:fine must leave it false,
    // so no mobile rule (including the closed slot) can match at any width. The
    // pane's own width is the host's business and is NOT a valid proxy here -
    // the desktop column happens to be 280px too.
    const mobileQuery = await evaluate(`matchMedia('(max-width: 1023px) and (pointer: coarse)').matches`)
    record(desktop.frame === false && desktop.transform === 'none' && mobileQuery === false,
      '5.desktop-zero-impact',
      `frame=${desktop.frame} transform=${desktop.transform} mobileQuery=${mobileQuery} width=${desktop.width}`)
  } finally {
    chrome.kill()
    await sleep(300)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  if (failures.length > 0) { console.log(`FAILED: ${failures.join(', ')}`); process.exitCode = 1 } else { console.log('ALL PASS') }
}

main().catch((e) => { console.error('ERR', e); process.exitCode = 1 })
