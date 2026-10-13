// dsh-file-viewer port probe (fork 2ff7976, re-scoped per design
// 2026-09-06-conversation-overlay-takeover-design.md §5.1). This host profile
// has no dsh-file-viewer installed, so the viewer DOM is injected as the shape
// the plugin renders: <section class="dsfv-panel" data-conversation-composer-overlay>.
// Scenes 1-4 cover the dsfv shape (marker set + CSS + takeover). Scene 5 covers
// the generic-overlay-only shape (attribute without the .dsfv-panel class —
// e.g. the built-in trajectory tab): the marker must NOT be set, but the edge
// swipe must still yield. Scene 6 proves the gesture recovers once overlays
// are gone.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
const SESSION_ID = 'session-404e3554-5059-4645-9e67-0138caec4df9'
const CHROME = '/data/data/com.termux/files/usr/lib/chromium/chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, label, timeoutMs) { const s = Date.now(); while (Date.now() - s < timeoutMs) { const v = await fn(); if (v) return v; await sleep(300) } throw new Error(label + ' timeout') }
const failures = []
const record = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`); if (!ok) failures.push(name) }
async function touchSwipe(c, x0, y0, x1, y1) {
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, radiusX: 2, radiusY: 2, force: 1, id: 0 }] })
  for (let i = 1; i <= 8; i += 1) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8, radiusX: 2, radiusY: 2, force: 1, id: 0 }] })
    await sleep(16)
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
async function main() {
  const dir = await mkdtemp(join(homedir(), 'tmp', 'cdp-fv-'))
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=9339',`--user-data-dir=${dir}`,'about:blank'], { env: { ...process.env, TMPDIR: dir, XDG_RUNTIME_DIR: dir }, stdio: 'ignore' })
  try {
    let wsUrl
    await waitFor(async () => { try { const r = await fetch('http://127.0.0.1:9339/json'); const l = await r.json(); wsUrl = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; return wsUrl } catch { return null } }, 'boot', 30000)
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    let id = 0; const pending = new Map()
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) } }
    const client = {
      ws,
      send(method, params = {}) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })) }) },
    }
    const evaluate = async (expr) => { const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value }
    await client.send('Page.enable'); await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await client.send('Page.navigate', { url: 'http://127.0.0.1:3080/' })
    await waitFor(() => evaluate(`document.readyState === 'complete'`), 'load', 30000)
    await sleep(1500)
    await evaluate(`localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: SESSION_ID }))})`)
    await client.send('Page.navigate', { url: 'http://127.0.0.1:3080/' })
    await waitFor(() => evaluate(`document.querySelector('[data-phase]')?.getAttribute('data-phase') === 'active'`), 'active', 30000)
    await sleep(1500)

    // ---- 0. marker absent before injection ----
    const m0 = await evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-file-viewer-open') ?? null`)
    record(m0 === false, '0.marker-absent-initially', `m0=${m0}`)

    // ---- 1. inject viewer DOM shape, marker must appear via reconciler ----
    await evaluate(`(() => {
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      if (!frame) return
      const sec = document.createElement('section')
      sec.className = 'dsfv-panel'
      sec.setAttribute('data-conversation-composer-overlay', '')
      sec.innerHTML = '<div class="dsfv-titlebar"><div class="dsfv-titlebar-path"><span class="dsfv-path">/home/user/very/long/path/to/file.csv</span><span class="dsfv-meta">1.2MB</span></div><div class="dsfv-titlebar-actions"><button class="dsfv-toolbar-btn">A</button><button class="dsfv-icon-btn">i</button></div></div>' +
        '<div class="dsfv-statusbar">line 1/100</div>' +
        '<div class="dsfv-scroll" style="overflow-x:visible"><div class="dsfv-renderer"><div class="dsfv-csv-scroll"><table></table></div></div></div>' +
        '<div class="dsfv-file-list"><div class="dsfv-file-row"><span class="dsfv-name">f.csv</span></div></div>' +
        '<div class="dsfv-search-input" contenteditable="true"></div>' +
        '<div class="dsfv-produced-chip">f.csv</div>'
      frame.appendChild(sec)
    })()`)
    const m1 = await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-file-viewer-open') ?? false`), '1.marker-appears', 10000)
    record(m1 === true, '1.marker-appears-on-inject')

    // ---- 2. CSS rules hit the injected shape ----
    const css = await evaluate(`(() => {
      const p = document.querySelector('.dsfv-panel')
      const tb = document.querySelector('.dsfv-toolbar-btn')
      const ib = document.querySelector('.dsfv-icon-btn')
      const fr = document.querySelector('.dsfv-file-row')
      const sc = document.querySelector('.dsfv-scroll')
      const meta = document.querySelector('.dsfv-meta')
      const chip = document.querySelector('.dsfv-produced-chip')
      return {
        panelOverflowX: getComputedStyle(p).overflowX,
        tbMinH: getComputedStyle(tb).minHeight,
        ibMinW: getComputedStyle(ib).minWidth,
        frMinH: getComputedStyle(fr).minHeight,
        scOverflowX: getComputedStyle(sc).overflowX,
        metaDisplay: getComputedStyle(meta).display,
        chipMinH: getComputedStyle(chip).minHeight,
      }
    })()`)
    record(css.panelOverflowX === 'hidden', '2.panel-no-hscroll', `ovx=${css.panelOverflowX}`)
    record(css.tbMinH === '34px', '2.toolbar-btn-34', `minH=${css.tbMinH}`)
    record(css.ibMinW === '34px', '2.icon-btn-34', `minW=${css.ibMinW}`)
    record(css.frMinH === '44px', '2.file-row-44', `minH=${css.frMinH}`)
    // 这里原本是一条 dsfv-search-input === 16px 的断言，2026-10-13（C14）删除：
    // 那条 16px 是 **iOS 门控**的规则（misc.css.ts 的
    // html[data-mobile-nav-ios] [data-mobile-nav="frame"] [class*="dsfv-search-input"]），
    // 而本探针没有 iPhone UA 覆盖（页面上的 iOS 标记由 viewport-meta.ts 按
    // platform/device.ts 的 detectIosWebKit 判定，Chromium UA 下恒缺席）⇒ 在非 iOS
    // 场景里它要么必红、要么只能被改成恒真，两种都不是在测它声称的东西。
    // iOS 门控的规则不该在非 iOS 场景断言；真实覆盖在 scripts/cdp-zoom-probe.mjs 的
    // B 场景（setUserAgentOverride 到 iPhone UA，B7 断言同一批 dsfv/ask 字段 >=16px，
    // 形状由该文件的 floorProbe 注入），另有一条不变量在 tests/ios-zoom-guard.test.ts
    // 守着这条边界（要么给该档补 iPhone UA、要么不要断言它）。
    record(css.scOverflowX === 'auto', '2.scroll-owns-hscroll', `ovx=${css.scOverflowX}`)
    record(css.metaDisplay === 'none', '2.meta-hidden-under-480', `disp=${css.metaDisplay}`)
    record(css.chipMinH === '40px', '2.produced-chip-40', `minH=${css.chipMinH}`)

    // ---- 3. takeover: left-edge swipe must NOT open the drawer while marker is set ----
    const pre = await evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed')`)
    await touchSwipe(client, 5, 400, 60, 400)
    await sleep(600)
    const during = await evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed')`)
    record(during === pre && during === true, '3.takeover-blocks-open-swipe', `pre=${pre} during=${during}`)

    // ---- 4. remove panel: marker clears ----
    await evaluate(`document.querySelector('.dsfv-panel')?.remove()`)
    const m2 = await waitFor(() => evaluate(`!(document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-file-viewer-open') ?? false)`), '4.marker-clears', 10000)
    record(m2 === true, '4.marker-clears-on-remove')

    // ---- 5. generic-overlay-only shape (trajectory-tab look-alike): attribute
    //      set, NO .dsfv-panel class. The marker must stay OFF, but the edge
    //      swipe must still yield — takeoverActive reads the attribute directly.
    await evaluate(`(() => {
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      if (!frame) return
      const div = document.createElement('div')
      div.setAttribute('data-conversation-composer-overlay', '')
      div.dataset.probeOverlayOnly = '1'
      frame.appendChild(div)
    })()`)
    await sleep(1200) // let the reconciler flush several passes over the mutation
    const m5 = await evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-file-viewer-open') ?? false`)
    record(m5 === false, '5.marker-not-set-by-attribute-only', `m5=${m5}`)
    await sleep(500) // gesture cooldown from scene 3
    const pre5 = await evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed')`)
    await touchSwipe(client, 5, 400, 60, 400)
    await sleep(600)
    const during5 = await evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed')`)
    record(pre5 === true && during5 === true, '5.swipe-still-yields-to-generic-overlay', `pre=${pre5} during=${during5}`)
    await evaluate(`document.querySelector('[data-probe-overlay-only]')?.remove()`)

    // ---- 6. with every overlay gone the same swipe opens the drawer (gesture alive) ----
    await sleep(500) // cooldown
    await touchSwipe(client, 5, 400, 60, 400)
    await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === false`), '6.drawer-opens', 10000)
    record(true, '6.drawer-opens-after-remove')
  } finally {
    chrome.kill()
    await sleep(300)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  if (failures.length > 0) { console.log(`FAILED: ${failures.join(', ')}`); process.exitCode = 1 } else { console.log('ALL PASS') }
}
main().catch((e) => { console.error('ERR', e); process.exitCode = 1 })
