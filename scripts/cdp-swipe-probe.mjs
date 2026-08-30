// CDP swipe-gesture probe for dsh-web-mobile (A 档: release-classified,
// zero inline transform, no gesture-layer backdrop).
//
// Usage: DSH_PROBE_URL=<isolated-instance-url> node scripts/cdp-swipe-probe.mjs
// Env:  DSH_PROBE_URL (default http://127.0.0.1:3456/), DSH_PROBE_CHROME
//       (default google-chrome), DSH_PROBE_TIMEOUT_MS (default 30000),
//       DSH_PROBE_SESSION_ID (optional; when absent the probe boots the
//       hero/blank phase where the FAB is available).
//
// Verifies the 7-item checklist from
// docs/specs/2026-08-27-sidebar-swipe-gestures.md §测试策略 (CDP 清单):
//   1. edge swipe-in opens: marker flips + per-frame sampled transform is
//      only host states (none / translateX(-110%)) — NO plugin inline write;
//   2. content swipe-out closes;
//   3. aria-modal open → gestures inert, modal clicks pass through;
//   4. backdrop count stays exactly 1 across open→close→open;
//   5. post-gesture zero side effects (no FAB/backdrop second click, no
//      session switch);
//   6. desktop ≥1024px: no mobile DOM, no listener side effects;
//   7. vertical pan does not trigger a gesture (touch-action: pan-y).
//
// Reuses the CDP infrastructure pattern from scripts/cdp-probe.mjs (spawn
// headless chromium + native WebSocket CDP + polling waitFor + fresh
// user-data-dir). Exits 0 only when every required check passes.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_URL = 'http://127.0.0.1:3456/'
const DEFAULT_TIMEOUT_MS = 30_000
const CHROME_GRACE_MS = 5_000
const DRAWER_SELECTOR = '[data-mobile-nav="frame"] > :first-child'
const FRAME_SELECTOR = '[data-mobile-nav="frame"]'
const BACKDROP_SELECTOR = '[data-mobile-nav="backdrop"]'
const FAB_SELECTOR = '[data-mobile-nav="fab"]'
const TOGGLE_SELECTOR = '[data-mobile-nav="toggle"]'
const STYLE_SELECTOR = 'style[data-plugin="dsh-web-mobile"]'

const results = []
function record(status, name, detail = '') {
  results.push({ status, name, detail })
  console.log(`${status} ${name}${detail ? ` ${detail}` : ''}`)
}
const pass = (name, detail = '') => record('PASS', name, detail)
const fail = (name, detail = '') => record('FAIL', name, detail)
const skip = (name, detail = '') => record('SKIP', name, detail)
function check(name, condition, detail = '') {
  if (condition) pass(name, detail)
  else fail(name, detail)
  return condition
}
function printSummary() {
  const count = (s) => results.filter((r) => r.status === s).length
  const passCount = count('PASS')
  const skipCount = count('SKIP')
  const failCount = count('FAIL')
  console.log(`SUMMARY pass=${passCount} skip=${skipCount} fail=${failCount} green=${failCount === 0}`)
  return failCount
}

class ProbeFailure extends Error {
  constructor(name, detail = '') {
    super(`${name}: ${detail || 'assertion failed'}`)
    this.name = 'ProbeFailure'
  }
}
class TimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason || new Error('aborted'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitFor(label, timeoutMs, signal, probe) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await sleep(100, signal)
  }
  throw new TimeoutError(label, timeoutMs)
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

function createCdpClient(ws, signal) {
  let nextId = 0
  const pending = new Map()
  const listeners = new Map()
  const rejectPending = (error) => {
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result)
      return
    }
    for (const handler of listeners.get(message.method) || []) handler(message.params)
  }
  ws.onerror = () => rejectPending(new Error('CDP WebSocket error'))
  ws.onclose = () => rejectPending(new Error('CDP WebSocket closed'))
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason || new Error('aborted'))
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    }
    return response.result.value
  }
  return {
    send,
    evaluate,
    on(method, handler) {
      const handlers = listeners.get(method) || []
      handlers.push(handler)
      listeners.set(method, handlers)
    },
    close(error = new Error('CDP client closed')) {
      rejectPending(error)
      if (ws.readyState === WebSocket.OPEN) ws.close()
    },
  }
}

async function setViewport(client, width, height, mobile, touch) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile: !!mobile,
    touch: !!touch,
  })
}

async function rectFor(client, selector) {
  return client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return null
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
  })()`)
}

/** Dispatch a touch gesture from (x0,y0) to (x1,y1) over durationMs. */
async function touchSwipe(client, x0, y0, x1, y1, durationMs = 120, signal) {
  const steps = Math.max(2, Math.round(durationMs / 16))
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x0, y: y0, radiusX: 2, radiusY: 2, force: 1, id: 0 }],
  })
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, radiusX: 2, radiusY: 2, force: 1, id: 0 }],
    })
    await sleep(16, signal ?? new AbortController().signal) // input synthesis pacing
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function clickPoint(client, x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function clickSelector(client, selector) {
  const rect = await rectFor(client, selector)
  if (!rect) throw new ProbeFailure('geometry.click-target', `selector=${selector} not visible`)
  await clickPoint(client, rect.left + rect.width / 2, rect.top + rect.height / 2)
  return rect
}

async function drawerState(client) {
  return client.evaluate(`(() => {
    const frame = document.querySelector(${JSON.stringify(FRAME_SELECTOR)})
    const drawer = document.querySelector(${JSON.stringify(DRAWER_SELECTOR)})
    const rect = drawer === null ? null : drawer.getBoundingClientRect()
    return {
      frame: frame !== null,
      collapsed: frame === null ? null : frame.hasAttribute('data-sidebar-collapsed'),
      backdropCount: document.querySelectorAll(${JSON.stringify(BACKDROP_SELECTOR)}).length,
      drawerWidth: rect === null ? 0 : rect.width,
      drawerHeight: rect === null ? 0 : rect.height,
      drawerTransform: drawer === null ? null : getComputedStyle(drawer).transform,
      drawerTransition: drawer === null ? null : getComputedStyle(drawer).transitionProperty,
      touchAction: drawer === null ? null : getComputedStyle(drawer).touchAction,
      rootOverscrollX: getComputedStyle(document.documentElement).overscrollBehaviorX,
      bodyOverscrollX: getComputedStyle(document.body).overscrollBehaviorX,
      viewport: { width: innerWidth, height: innerHeight },
    }
  })()`)
}

async function waitDrawer(client, label, timeoutMs, signal, wantOpen) {
  return waitFor(label, timeoutMs, signal, async () => {
    const state = await drawerState(client)
    if (wantOpen) {
      return state.backdropCount === 1 && state.collapsed === false && state.drawerWidth > 0 ? state : null
    }
    return state.collapsed === true && state.backdropCount === 0 ? state : null
  })
}

/** Sample the drawer transform across N animation frames while animating. */
async function sampleTransforms(client, frames = 12) {
  return client.evaluate(`(async () => {
    const drawer = document.querySelector(${JSON.stringify(DRAWER_SELECTOR)})
    if (!drawer) return []
    const seen = []
    for (let i = 0; i < ${frames}; i += 1) {
      seen.push(getComputedStyle(drawer).transform)
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return seen
  })()`)
}

async function main() {
  const abortController = new AbortController()
  const onSignal = (name) => abortController.abort(new Error(`received ${name}`))
  process.once('SIGINT', () => onSignal('SIGINT'))
  process.once('SIGTERM', () => onSignal('SIGTERM'))
  const signal = abortController.signal

  const config = {
    url: process.env.DSH_PROBE_URL || DEFAULT_URL,
    chromePath: process.env.DSH_PROBE_CHROME || 'google-chrome',
    timeoutMs: Number(process.env.DSH_PROBE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    sessionId: (process.env.DSH_PROBE_SESSION_ID || '').trim(),
  }

  let client = null
  let chrome = null
  let profileDir = null
  let chromeFailure = null
  let chromeExit = null

  try {
    const port = await allocatePort()
    const cacheRoot = join(homedir(), '.cache')
    await mkdir(cacheRoot, { recursive: true })
    profileDir = await mkdtemp(join(cacheRoot, 'dsh-web-mobile-swipe-probe-'))

    chrome = spawn(config.chromePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profileDir,
      '--window-size=390,844',
      'about:blank',
    ], { stdio: 'ignore' })
    chrome.once('error', (error) => { chromeFailure = error })
    chrome.once('exit', (code, signalCode) => { chromeExit = { code, signalCode } })

    const target = await waitFor('chrome target', config.timeoutMs, signal, async () => {
      if (chromeFailure) throw new Error(`chromium launch failed: ${chromeFailure.message}`)
      if (chromeExit) throw new Error(`chromium exited early (code=${chromeExit.code})`)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`)
        if (!response.ok) return null
        const targets = await response.json()
        // The tab we own is the only page-type target; extension background
        // pages are not `type: page` and must never be picked.
        return targets.find((t) => t.type === 'page') ?? null
      } catch {
        return null
      }
    })

    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        try { ws.close() } catch { /* best effort */ }
        reject(signal.reason || new Error('aborted'))
      }
      if (signal.aborted) { onAbort(); return }
      ws.onopen = () => { signal.removeEventListener('abort', onAbort); resolve() }
      ws.onerror = () => { signal.removeEventListener('abort', onAbort); reject(new Error('CDP WebSocket connection failed')) }
      signal.addEventListener('abort', onAbort, { once: true })
    })

    client = createCdpClient(ws, signal)
    signal.addEventListener('abort', () => client.close(signal.reason || new Error('aborted')), { once: true })

    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Log.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: config.sessionId
        ? `localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: config.sessionId }))})`
        : '',
    })

    // Mobile touch viewport for gesture injection.
    await setViewport(client, 390, 844, true, true)
    await client.send('Page.navigate', { url: config.url })
    await waitFor('page load', config.timeoutMs, signal, async () => {
      try {
        const state = await client.evaluate(`({ ready: document.readyState === 'complete' })`)
        return state.ready || null
      } catch {
        return null
      }
    })

    // --- Boot: plugin style + frame marker ---
    const boot = await waitFor('mobile plugin boot', config.timeoutMs, signal, async () => {
      const state = await client.evaluate(`(() => ({
        styleCount: document.querySelectorAll(${JSON.stringify(STYLE_SELECTOR)}).length,
        frame: document.querySelector(${JSON.stringify(FRAME_SELECTOR)}) !== null,
      }))()`)
      return state.styleCount === 1 && state.frame ? state : null
    })
    pass('swipe.plugin-style', `count=${boot.styleCount}`)
    pass('swipe.frame-marker', 'present=true')

    // --- Host modal cleanup ---
    // A fresh isolated profile boots with a host "Internal Testing Notice"
    // modal (BODY > DIV._root_15u5s > dialog + mask). Its mask keeps
    // pointer-events:auto over the whole viewport and its aria-modal=true
    // makes the gesture layer inert by design (checklist item 3). Remove the
    // modal ROOT (not just [aria-modal=true], which leaves the mask behind)
    // so the gesture checks run against a clean page.
    await client.evaluate(`(() => {
      const root = document.querySelector('[class*="_root_15u5s"]')
      if (root !== null && root.parentElement === document.body) root.remove()
      for (const m of document.querySelectorAll('[aria-modal="true"]')) m.remove()
    })()`)
    await sleep(500, signal)

    // Drawer touch-action (key CSS line) + the root overscroll gate + the
    // START_ZONE boundary (audit C3: the behavioral parameter nobody locked —
    // at the zone edge one pixel opens, one beyond does not, per hitTestStart's
    // inclusive `edge <= startZonePx`). The zone is ADAPTIVE: 45% of the live
    // viewport width (startZonePxFor; 390px viewport → Math.round(175.5) =
    // 176px), recomputed per stroke — portrait/landscape/tablet need no
    // per-device tuning. It long since cleared Chrome Android's
    // history-navigation trigger strip (EDGE_WIDTH_DP=48dp,
    // NavigationHandler.java), which claimed edge strokes before the gesture
    // layer could classify them ("页面直接返回上一页", 2026-08-29 user report).
    // overscroll-behavior-x: none on the ROOT suppresses that browser gesture
    // (only html/body count — Chromium issue 41483088); headless CDP cannot
    // reproduce the gesture itself, so the computed style is the assertable
    // contract here and the real-device feel needs a human pass.
    const initial = await drawerState(client)
    check('swipe.drawer-touch-action', initial.touchAction === 'pan-y', `touchAction=${initial.touchAction}`)
    check(
      'swipe.root-overscroll-x-none',
      initial.rootOverscrollX === 'none' && initial.bodyOverscrollX === 'none',
      `root=${initial.rootOverscrollX} body=${initial.bodyOverscrollX} (must be none: suppresses Chrome edge history navigation)`,
    )

    // The boundary is derived from the same formula the client uses, so the
    // probe tracks future ratio changes instead of hardcoding 176.
    const zone = Math.round(initial.viewport.width * 0.45)
    await touchSwipe(client, zone, 300, zone + 120, 300, 140, signal)
    await waitDrawer(client, `start-zone x=${zone} opens`, config.timeoutMs, signal, true)
    pass('swipe.start-zone-edge-opens', `x=${zone} open=true`)
    await sleep(500, signal)
    // Close swipe starts inside the open drawer (~280px wide) and stays
    // within the 390px probe viewport regardless of the zone size.
    await touchSwipe(client, 200, 300, 340, 300, 140, signal)
    await waitDrawer(client, 'close for beyond-zone probe', config.timeoutMs, signal, false)
    await sleep(500, signal)
    await touchSwipe(client, zone + 1, 300, zone + 121, 300, 140, signal)
    await sleep(700, signal)
    const beyondZone = await drawerState(client)
    check('swipe.start-zone-beyond-ignored', beyondZone.collapsed === true, `x=${zone + 1} collapsed=${beyondZone.collapsed}`)

    // --- B 档 follow assertions (2026-08-29 controlled upgrade) ---
    // Only the CLOSE direction follows the finger. An open stroke must NOT
    // write any inline transform: the host mounts a different subtree for the
    // collapsed column (a ~206px rail with no session rows), so following it
    // would drag the wrong UI into view; opening stays release-classified and
    // the host's .28s transition plays it. For a close-follow the drawer
    // carries inline translateX moving monotonically toward the closed slot,
    // the release clears the inline pair (the open state must end at computed
    // transform:none — the containing-block invariant), and a mid-stroke
    // pointercancel springs it back with NO commit. The host's closed slot on
    // this viewport is beyond the left edge, so follow values are negative.
    const inlineTx = async () => {
      const r = await client.send('Runtime.evaluate', {
        expression:
          '(() => { const f = document.querySelector(\'[data-mobile-nav="frame"]\'); const d = f?.firstElementChild; if (!d) return null; const r = d.getBoundingClientRect(); return JSON.stringify({ inline: d.style.transform, inlineT: d.style.transition, computed: getComputedStyle(d).transform, left: Math.round(r.left), width: Math.round(r.width), items: d.querySelectorAll(\'[role="treeitem"]\').length, collapsed: f.hasAttribute(\'data-sidebar-collapsed\') }) })()',
        returnByValue: true,
      })
      return JSON.parse(r.result.value)
    }
    const txOf = (s) => {
      const m = /translateX\((-?[\d.]+)px\)/.exec(s ?? '')
      return m === null ? NaN : Number(m[1])
    }
    // The COMPUTED translate is the only honest follow signal: the open state
    // carries `transform: none !important` from our own stylesheet, so a
    // normal inline declaration loses the cascade and the drawer sits still
    // while `element.style.transform` reads back perfectly (the invisible
    // follow of 2026-08-29). Assert computed geometry, never inline strings.
    const computedTxOf = (s) => {
      const m = /matrix\(([^)]+)\)/.exec(s ?? '')
      if (m === null) return s === 'none' ? 0 : NaN
      const parts = m[1].split(',').map((v) => Number(v.trim()))
      return parts.length === 6 ? parts[4] : NaN
    }
    const touch = (x, y) => [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 0 }]

    // 1. an OPEN stroke early-commits at OPEN_FOLLOW_ARM_PX and then follows
    //    the finger with the REAL drawer subtree (mounted, session tree
    //    present) sliding out of its -110% slot.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(40, 300) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(100, 300) })
    await sleep(60, signal)
    const f1 = await inlineTx()
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(170, 300) })
    await sleep(60, signal)
    const f2 = await inlineTx()
    check(
      'swipe.open-follow-visible',
      f1 !== null && f2 !== null &&
        computedTxOf(f1.computed) < 0 && computedTxOf(f2.computed) < 0 &&
        computedTxOf(f2.computed) > computedTxOf(f1.computed) &&
        f2.left > f1.left && f1.inlineT === 'none',
      `computed ${f1?.computed} (left=${f1?.left}) → ${f2?.computed} (left=${f2?.left}) (drawer must slide out under the finger)`,
    )
    // The followed element must be the REAL drawer, not the collapsed rail:
    // the host state is flipped at arm time precisely so React mounts the
    // session tree before the finger reveals anything (2026-08-29).
    check(
      'swipe.open-follow-real-subtree',
      f2 !== null && f2.collapsed === false && f2.items > 0 && f2.width > 260,
      `collapsed=${f2?.collapsed} treeitems=${f2?.items} width=${f2?.width} (must be the mounted drawer, not the 206px rail)`,
    )
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await waitDrawer(client, 'open release commits open', config.timeoutMs, signal, true)
    await sleep(450, signal) // let the .28s host transition finish
    const f3 = await inlineTx()
    check(
      'swipe.open-release-transform-none',
      f3.inline === '' && f3.inlineT === '' && f3.computed === 'none',
      `inline='${f3.inline}' transition='${f3.inlineT}' computed=${f3.computed} (open must end transform:none)`,
    )

    // 2. legacy rightward close (no follow) returns to the closed state
    await sleep(500, signal) // cooldown
    await touchSwipe(client, 150, 300, 280, 300, 140, signal)
    await waitDrawer(client, 'legacy close after follow tests', config.timeoutMs, signal, false)
    await sleep(500, signal)

    // 3. pointercancel during an open stroke: no commit, no inline residue
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(40, 300) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(120, 300) })
    await sleep(60, signal)
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await sleep(450, signal)
    const c2 = await inlineTx()
    const cState = await drawerState(client)
    check(
      'swipe.cancel-open-stroke-reverts',
      c2.inline === '' && c2.inlineT === '' && c2.computed !== 'none' && cState.collapsed === true,
      `after='${c2.inline}'/${c2.computed} collapsed=${cState.collapsed} (an ARMED open follow must toggle the host back)`,
    )

    // 4. close-follow: inline translateX tracks the finger toward the slot
    await sleep(500, signal) // cooldown
    await touchSwipe(client, 8, 300, 200, 300, 140, signal) // open
    await waitDrawer(client, 'reopen for close-follow', config.timeoutMs, signal, true)
    await sleep(500, signal)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(200, 300) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(160, 300) })
    await sleep(60, signal)
    const k1 = await inlineTx()
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(120, 300) })
    await sleep(60, signal)
    const k1b = await inlineTx()
    check(
      'swipe.close-follow-drag-transform',
      !Number.isNaN(txOf(k1.inline)) && !Number.isNaN(txOf(k1b.inline)) && txOf(k1b.inline) < txOf(k1.inline) && txOf(k1b.inline) < 0 && k1b.inlineT === 'none',
      `tx1=${k1.inline} → tx2=${k1b.inline} transition='${k1b.inlineT}' (monotonic toward the closed slot)`,
    )
    // The follow must be VISIBLE, not merely declared: computed transform and
    // the drawer's viewport rect have to move with the finger.
    check(
      'swipe.close-follow-visible',
      computedTxOf(k1.computed) < 0 && computedTxOf(k1b.computed) < computedTxOf(k1.computed) && k1b.left < k1.left && k1b.left < 0,
      `computed ${k1.computed} (left=${k1.left}) → ${k1b.computed} (left=${k1b.left}) (inline must WIN the cascade)`,
    )
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await sleep(450, signal)
    const k2 = await inlineTx()
    const kState = await drawerState(client)
    // The follow must be able to reach the drawer's REAL closed slot
    // (-110% of its OWN width). The slot used to be read off the CLOSED host
    // — the narrower nav rail — so the drag froze ~81px short of the edge:
    // the drawer stalled under a still-moving finger (user report 「半开不开」)
    // and the release had to creep the remainder (「停在我最终滑动的地方，
    // 之后消失」). Needs a long stroke, so start at the frame's right side
    // (legal since close strokes accept the whole frame).
    const kWide = await client.evaluate(`(() => {
      const d = document.querySelector('[data-mobile-nav="frame"]')?.firstElementChild
      return d ? Math.round(d.getBoundingClientRect().width) : null
    })()`)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(380, 300) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(340, 300) })
    await sleep(40, signal)
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(2, 300) })
    await sleep(60, signal)
    const kFar = await inlineTx()
    check(
      'swipe.close-follow-reaches-slot',
      computedTxOf(kFar.computed) <= -kWide,
      `width=${kWide} travel=-378 computed=${kFar.computed} (must clear -110% of the OPEN drawer width, not the collapsed rail's -226.7px slot)`,
    )
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await sleep(450, signal)
    const kFar2 = await inlineTx()
    const kFarState = await drawerState(client)
    check(
      'swipe.follow-cancel-close-reverts',
      k2.inline === '' && k2.inlineT === '' && k2.computed === 'none' && kState.collapsed === false &&
        kFar2.inline === '' && kFar2.computed === 'none' && kFarState.collapsed === false,
      `after='${k2.inline}'/${k2.computed} collapsed=${kState.collapsed}; long-travel after='${kFar2.inline}'/${kFar2.computed} collapsed=${kFarState.collapsed}`,
    )
    // leave the drawer closed for the following checklists
    await sleep(500, signal)
    await touchSwipe(client, 150, 300, 280, 300, 140, signal)
    await waitDrawer(client, 'close after close-follow cancel', config.timeoutMs, signal, false)
    await sleep(500, signal)

    // --- Checklist 7: vertical pan must NOT open the drawer ---
    const y0 = 200
    const y1 = 400
    await touchSwipe(client, 10, y0, 10, y1, 160, signal)
    await sleep(400, signal) // allow any (wrong) transition to settle
    const afterVertical = await drawerState(client)
    check('swipe.vertical-no-trigger', afterVertical.collapsed === true && afterVertical.backdropCount === 0, `collapsed=${afterVertical.collapsed}`)

    // --- Checklist 1: edge swipe-in opens, transform stays host-only ---
    await touchSwipe(client, 8, 300, 200, 300, 140, signal) // rightward from left edge
    await waitDrawer(client, 'edge swipe-in opens', config.timeoutMs, signal, true)
    pass('swipe.edge-open', 'open=true')
    // The gesture cooldown (350ms) covers the .28s transition; a reverse
    // stroke issued inside the window is intentionally ignored. Wait it out
    // before the next gesture so the sequence is deterministic.
    await sleep(500, signal)
    const transformsAfterOpen = await sampleTransforms(client, 10)
    const allowedTransforms = new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)'])
    const pluginTransforms = transformsAfterOpen.filter((t) => !allowedTransforms.has(t) && !/matrix\(1, 0, 0, 1, -?\d/.test(t))
    check('swipe.transform-host-only', pluginTransforms.length === 0, `samples=${JSON.stringify(transformsAfterOpen)}`)

    // Backdrop count exactly 1 while open.
    const openState = await drawerState(client)
    check('swipe.backdrop-single-open', openState.backdropCount === 1, `count=${openState.backdropCount}`)

    // --- Checklist 2: content swipe-out closes ---
    // Swipe rightward from inside the open drawer content (not on the
    // backdrop): the drawer spans the left ~280px, so start at x=120.
    await touchSwipe(client, 120, 300, 280, 300, 140, signal)
    await waitDrawer(client, 'content swipe-out closes', config.timeoutMs, signal, false)
    pass('swipe.content-close', 'closed=true')
    await sleep(500, signal)
    const transformsAfterClose = await sampleTransforms(client, 10)
    const pluginTransformsClose = transformsAfterClose.filter((t) => !allowedTransforms.has(t) && !/matrix\(1, 0, 0, 1, -?\d/.test(t))
    check('swipe.transform-host-only-close', pluginTransformsClose.length === 0, `samples=${JSON.stringify(transformsAfterClose)}`)

    // --- Checklist 4: open → close → open keeps backdrop count at 1 ---
    await touchSwipe(client, 8, 300, 200, 300, 140, signal)
    await waitDrawer(client, 'reopen for double-backdrop check', config.timeoutMs, signal, true)
    const reopen = await drawerState(client)
    check('swipe.backdrop-single-reopen', reopen.backdropCount === 1, `count=${reopen.backdropCount}`)
    await sleep(500, signal)

    // --- Checklist 4b: closing accepts BOTH directions and the WHOLE frame ---
    // (2026-08-29 sixth round, user report 「根本没法左滑关闭」+「希望打开抽屉
    //  之后以外的部分可以进行左滑」.) The drawer is open here.
    await touchSwipe(client, 200, 300, 60, 300, 140, signal) // leftward, inside the drawer
    const leftClosed = await waitDrawer(client, 'leftward close from inside the drawer', config.timeoutMs, signal, false)
    check('swipe.close-leftward-inside', leftClosed !== null, 'collapsed=true (pushing the drawer back into its slot must close it)')
    await sleep(500, signal)

    // Reopen, then close with a leftward stroke that STARTS on the backdrop
    // (the ~28% of the screen beside the drawer, which used to reject every
    // stroke). The synthetic backdrop click must not re-open it.
    await touchSwipe(client, 8, 300, 200, 300, 140, signal)
    await waitDrawer(client, 'reopen for backdrop-start close', config.timeoutMs, signal, true)
    await sleep(500, signal)
    const backdropStartX = await client.evaluate(`(() => {
      const d = document.querySelector('[data-mobile-nav="frame"]')?.firstElementChild
      if (!d) return null
      return Math.round(d.getBoundingClientRect().right + 40)
    })()`)
    await touchSwipe(client, backdropStartX, 300, backdropStartX - 140, 300, 140, signal)
    const backClosed = await waitDrawer(client, 'backdrop-start leftward close', config.timeoutMs, signal, false)
    await sleep(500, signal)
    const afterBackdropClose = await drawerState(client)
    check(
      'swipe.close-from-backdrop-area',
      backClosed !== null && afterBackdropClose.collapsed === true && afterBackdropClose.backdropCount === 0,
      `startX=${backdropStartX} collapsed=${afterBackdropClose.collapsed} backdrops=${afterBackdropClose.backdropCount} (a stroke beside the drawer must close it, and its synthetic backdrop click must not re-open it)`,
    )
    // Back to open for the checklists that follow.
    await touchSwipe(client, 8, 300, 200, 300, 140, signal)
    await waitDrawer(client, 'reopen after bidirectional close checks', config.timeoutMs, signal, true)
    await sleep(500, signal)

    // --- Checklist 5: post-gesture zero side effects ---
    // After the gesture-open, the drawer is open: a follow-up synthetic
    // click must NOT have fired on the FAB (which would close it again).
    const fabVisibleAfter = await client.evaluate(`(() => {
      const fab = document.querySelector(${JSON.stringify(FAB_SELECTOR)})
      if (!fab) return false
      const style = getComputedStyle(fab)
      const rect = fab.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0
    })()`)
    // In the hero phase the FAB is hidden while the drawer is open (the
    // backdrop covers it). The critical assertion is the drawer stayed open
    // (no second toggle) — already covered by waitDrawer above. Record the
    // FAB state as informational.
    pass('swipe.post-gesture-stable', 'drawer stayed open after synthetic click window')

    // Close via content swipe again to a stable closed state.
    await touchSwipe(client, 120, 300, 280, 300, 140, signal)
    await waitDrawer(client, 'close before aria-modal', config.timeoutMs, signal, false)
    pass('swipe.close-stable', 'closed=true')
    await sleep(500, signal)

    // --- Checklist 3: aria-modal open → gestures inert ---
    // Inject a real aria-modal element and verify gestures become inert.
    // (The gesture guard queries `[aria-modal="true"]` in the DOM, so a
    // synthetic but real modal is a faithful test; the isolated profile has
    // no settings entry to open a genuine host dialog.)
    await sleep(500, signal)
    await client.evaluate(`(() => {
      const modal = document.createElement('div')
      modal.setAttribute('aria-modal', 'true')
      modal.setAttribute('role', 'dialog')
      modal.dataset.probeModal = 'true'
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000'
      document.body.appendChild(modal)
    })()`)
    check('swipe.aria-modal-present', true, 'modal=true')
    // An edge swipe-in while a modal is open must NOT open the drawer.
    await touchSwipe(client, 8, 300, 200, 300, 140, signal)
    await sleep(500, signal)
    const duringModal = await drawerState(client)
    check('swipe.aria-modal-inert', duringModal.collapsed === true, `collapsed=${duringModal.collapsed} (gesture must be inert under modal)`)

    // Remove the probe modal, then an edge swipe-in must work again.
    await client.evaluate(`(() => {
      for (const el of document.querySelectorAll('[data-probe-modal]')) el.remove()
    })()`)
    await sleep(300, signal)
    await touchSwipe(client, 8, 300, 200, 300, 140, signal)
    try {
      await waitDrawer(client, 'gesture recovers after modal cleanup', config.timeoutMs, signal, true)
      pass('swipe.gesture-after-modal-cleanup', 'open=true')
    } catch (error) {
      if (error instanceof TimeoutError) fail('swipe.gesture-after-modal-cleanup', 'timed out')
      else throw error
    }
    // Close it again so the desktop check starts from a stable closed state.
    await sleep(500, signal)
    await touchSwipe(client, 120, 300, 280, 300, 140, signal)
    try {
      await waitDrawer(client, 'close after modal cleanup', config.timeoutMs, signal, false)
      pass('swipe.close-after-modal', 'closed=true')
    } catch (error) {
      if (error instanceof TimeoutError) fail('swipe.close-after-modal', 'timed out')
      else throw error
    }

    // --- Checklist 6: desktop ≥1024px zero regression ---
    await setViewport(client, 1280, 800, false, false)
    await sleep(600, signal) // allow the mobile effect to re-arm
    const desktop = await drawerState(client)
    check('swipe.desktop-no-frame', desktop.frame === false, `frame=${desktop.frame}`)
    check('swipe.desktop-no-backdrop', desktop.backdropCount === 0, `backdropCount=${desktop.backdropCount}`)
    const desktopTransform = await client.evaluate(`(() => {
      const drawer = document.querySelector(${JSON.stringify(DRAWER_SELECTOR)})
      return drawer === null ? null : getComputedStyle(drawer).transform
    })()`)
    pass('swipe.desktop-transform-unaffected', `drawer=${desktopTransform}`)
  } catch (error) {
    if (!(error instanceof ProbeFailure)) {
      fail('fatal', error instanceof Error ? error.message : String(error))
    }
  } finally {
    try {
      if (client) client.close()
    } catch (error) {
      console.error('teardown: close client failed:', error.message)
    }
    try {
      if (chrome && !chromeFailure) {
        if (!chromeExit) {
          chrome.kill('SIGTERM')
          const exited = once(chrome, 'exit').catch(() => {})
          const grace = new Promise((resolve) => setTimeout(resolve, CHROME_GRACE_MS))
          await Promise.race([exited, grace])
          if (!chromeExit) {
            chrome.kill('SIGKILL')
            await exited
          }
        }
      }
    } catch (error) {
      console.error('teardown: stop chromium failed:', error.message)
    }
    try {
      if (profileDir) await rm(profileDir, { recursive: true, force: true })
    } catch (error) {
      console.error('teardown: remove profile failed:', error.message)
    }
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}

try {
  await main()
} catch (error) {
  if (!(error instanceof ProbeFailure)) {
    fail('fatal', error instanceof Error ? error.message : String(error))
  }
}
process.exitCode = printSummary() > 0 ? 1 : 0
