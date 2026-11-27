// The files opener ([data-mobile-nav="files"]) must sit in the header's
// top-right corner, mirroring the directory toggle in the top-left one.
//
// The host mounts the session-header actions slot inside its title cluster,
// which reserves padding-right: 44px for a utilities seat that stays empty on
// mobile, so an in-flow button can never reach the right edge - measured at
// 390px before the fix: button [300,16,28,28], i.e. 62px of bare header to its
// right (2026-09-14 phone-side report). layout.css pins it absolutely (right
// 8px, top 12px) in the mobile branch, the same seat the toggle uses on the
// left.
//
// Scenes: the rule itself (mobile branch only), the pinned geometry against
// both viewport edges, hit-testability, the toggle's unchanged seat, the shift
// the frame's safe-area padding applies to both controls, and the absence of
// any overlap with the host's utilities seat. Headless has no safe-area inset,
// so scene 3 simulates the status bar with inline frame padding.
//
// Scene 4 (2026-09-19, task-3 T1b) pins the 0.1.6-alpha.2 header terminal
// values after the seat/centre/overlap fixes: the leading seat box collapsed
// to <=1px, the title cluster back at x=40, the toggle back at 28x28 and the
// files opener at 36x36 with BOTH corner centres on the title band centre
// (previously 28/24/22), and the files left edge clear of the header-actions
// flow right edge (previously the Agent Team chip's right edge at 344 was
// overlapped by the 44px-wide files button starting at 338). A fresh headless
// profile cannot auto-restore a 0.1.6 session (no workspace authorization),
// so the flow first restores one through the drawer UI before measuring.
//
// Env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_SESSION_ID,
// DSH_PROBE_COOKIE (name=value, for an authenticated instance), DSH_PROBE_INSET
// (default 47), DSH_PROBE_CHROME.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const SESSION_ID = process.env.DSH_PROBE_SESSION_ID || ''
const COOKIE = process.env.DSH_PROBE_COOKIE || ''
const INSET = Number(process.env.DSH_PROBE_INSET || 47)
const CHROME = process.env.DSH_PROBE_CHROME || 'chromium'
const PORT = 9357

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
  const dir = await mkdtemp(join(homedir(), 'tmp', 'cdp-files-pin-'))
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

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    if (COOKIE) {
      const eq = COOKIE.indexOf('=')
      await send('Network.setCookie', { name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: URL_ })
    }
    if (SESSION_ID) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `localStorage['dsh.sessions.current'] = JSON.stringify({sessionId:${JSON.stringify(SESSION_ID)}})`,
      })
    }
    await send('Page.navigate', { url: URL_ })
    await waitFor(async () => await evaluate(`document.querySelector('[data-mobile-nav="frame"]') !== null`), 'mobile frame', 30000)
    // 0.1.6-alpha.2: a fresh headless profile lacks the workspace authorization
    // the host needs to auto-restore the saved session, so the page parks in
    // the hero phase and the session header (with the files opener) never
    // mounts. Restore one through the drawer UI: FAB -> first visible session
    // row -> active phase. Without any session row the geometry scenes below
    // cannot run and the probe says so instead of failing on the environment.
    let viaUiRestore = false
    try {
      await waitFor(async () => await evaluate(`document.querySelector('[data-mobile-nav="files"]') !== null`), 'files opener', 8000)
    } catch {
      // Let the host settle first: on 0.1.6 the workspace switch and the
      // saved-selection write-back land ~4s after boot. Clicking the FAB
      // earlier renders drawer rows whose open click is lost (audit-final
      // flow: 6s settle + 1.5s after the FAB, measured 2026-09-19).
      await sleep(6000)
      await evaluate(`(() => { const f = document.querySelector('[data-mobile-nav="fab"]'); if (f) f.click(); return true })()`)
      await sleep(1500)
      await waitFor(async () => await evaluate(`(() => {
        const rows = [...document.querySelectorAll('[role="treeitem"]')]
        return rows.some((el) => /sessionRow/.test(el.className) && el.getBoundingClientRect().width > 0)
      })()`), 'drawer session rows', 15000)
      // Click the first NON-selected session row: the selected row is the
      // blank "new session" placeholder, which never produces an active
      // phase. Retry the next row if a click does not land (max 3).
      const tryRows = async () => await evaluate(`(() => {
        const rows = [...document.querySelectorAll('[role="treeitem"]')].filter((el) => /sessionRow/.test(el.className) && el.getBoundingClientRect().width > 0)
        const target = rows.find((el) => !/selected/.test(el.className)) || rows[0]
        if (target) { target.click(); return rows.length }
        return 0
      })()`)
      if ((await tryRows()) === 0) throw new Error('no drawer session rows to restore')
      let active = false
      for (let attempt = 0; attempt < 3 && !active; attempt++) {
        active = await waitFor(async () => await evaluate(`document.querySelector('[data-phase]')?.getAttribute('data-phase') === 'active'`), 'active phase after drawer restore', 20000).catch(() => false)
        if (!active && attempt < 2) await tryRows()
      }
      if (!active) throw new Error('active phase after drawer restore timeout (3 rows tried)')
      viaUiRestore = true
      await sleep(1500)
      await waitFor(async () => await evaluate(`document.querySelector('[data-mobile-nav="files"]') !== null`), 'files opener after restore', 20000)
    }
    await sleep(500)
    record(true, '0.session-header-present', viaUiRestore ? 'restored through the drawer UI (headless cannot auto-restore 0.1.6 sessions)' : 'auto-restored from the saved selection')

    // ---- 1. the rule lives in the mobile branch ----
    const rawRules = await evaluate(`(() => {
      const hits = []
      const walk = (list, media) => {
        for (const r of list) {
          try {
            if (r.selectorText) {
              if (r.selectorText === '[data-mobile-nav="files"]') hits.push({ css: r.style.cssText, media })
              continue
            }
            if (r.cssRules) walk(r.cssRules, r.conditionText || media)
          } catch {}
        }
      }
      for (const sheet of document.styleSheets) {
        const owner = sheet.ownerNode
        if (!owner || owner.dataset?.plugin !== 'dsh-web-mobile') continue
        try { walk(sheet.cssRules, '') } catch {}
      }
      return JSON.stringify(hits)
    })()`)
    const rules = JSON.parse(rawRules)
    const rule = rules.find((r) => /position:\s*absolute/.test(r.css))
    record(Boolean(rule), '1.pin-rule-injected', JSON.stringify(rules.map((r) => r.css.slice(0, 48))))
    record(Boolean(rule) && /right:\s*8px/.test(rule.css), '1.pin-rule-declaration', rule ? rule.css : 'absent')
    record(Boolean(rule) && /max-width:\s*1023px/.test(rule.media) && /pointer:\s*coarse/.test(rule.media), '1.rule-in-mobile-branch', rule ? rule.media : 'absent')

    // ---- 2. pinned to the right corner, level with the toggle ----
    const measure = `(() => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
      const files = document.querySelector('[data-mobile-nav="files"]')
      const fb = files.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.round(fb.x + fb.width / 2), Math.round(fb.y + fb.height / 2))
      const ut = document.querySelector('[class*="_headerUtilities"]')
      const ub = ut ? ut.getBoundingClientRect() : null
      const overlap = ub !== null && ub.width > 0 && fb.x < ub.right && ub.x < fb.right && fb.y < ub.bottom && ub.y < fb.bottom
      return JSON.stringify({
        files: box('[data-mobile-nav="files"]'), toggle: box('[data-mobile-nav="toggle"]'),
        pos: getComputedStyle(files).position, vw: innerWidth,
        hitIsFiles: hit === files || (hit !== null && files.contains(hit)),
        utilities: ub ? [Math.round(ub.x), Math.round(ub.width)] : null, overlap
      })
    })()`
    const base = JSON.parse(await evaluate(measure))
    record(base.pos === 'absolute', '2.files-out-of-flow', `position=${base.pos}`)
    record(base.files[0] + base.files[2] === base.vw - 8, '2.files-right-edge-pinned', `right edge ${base.files[0] + base.files[2]} of ${base.vw}`)
    record(base.toggle[0] === 8, '2.toggle-still-left-pinned', `toggle x=${base.toggle[0]}`)
    // 0.1.6 terminal values: files 36x36 at top:2 and toggle 28x28 at top:6 are
    // deliberately DIFFERENT tops (36/2+2 = 28/2+6 = 20) - both centres sit on
    // the title-band centre, so compare centres, not tops.
    record(Math.abs((base.files[1] + base.files[3] / 2) - (base.toggle[1] + base.toggle[3] / 2)) <= 0.5,
      '2.corner-controls-centred', `files cy=${base.files[1] + base.files[3] / 2} toggle cy=${base.toggle[1] + base.toggle[3] / 2}`)
    record(base.hitIsFiles, '2.files-hit-testable', 'elementFromPoint at its centre returns the button')
    record(base.overlap === false, '2.no-utilities-overlap', base.utilities === null ? 'utilities seat absent' : `utilities x=${base.utilities[0]} w=${base.utilities[1]}`)
    // 0.2.3-alpha.1 把 Session panel 的入口注册进 utilities 托盘，而本插件的手机档曾把整条托盘
    // display:none（issue #304）：入口 0x0、摸不到，子代理 / 共享任务 / 后台任务在手机上没有任何
    // 其它入口。座位本身才是这个 bug 的判据，所以在这里断言可达性，不只验样式表文本。
    const panel = JSON.parse(await evaluate(`(() => {
      const t = document.querySelector('[data-session-panel-toggle]')
      if (t === null) return JSON.stringify({ present: false })
      const r = t.getBoundingClientRect()
      const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
      const after = getComputedStyle(t, '::after')
      return JSON.stringify({
        present: true, box: [Math.round(r.x), Math.round(r.width), Math.round(r.height)],
        own: at === t || (at !== null && t.contains(at)), inset: after.inset, pos: after.position
      })
    })()`))
    record(!panel.present || (panel.box[1] >= 28 && panel.box[2] >= 28 && panel.own), '2.panel-toggle-reachable',
      panel.present ? `toggle ${panel.box[1]}x${panel.box[2]} @x=${panel.box[0]} own-hit=${panel.own}` : 'no session-panel entry on this host')
    record(!panel.present || (panel.pos === 'absolute' && panel.inset === '-8px'), '2.panel-toggle-44px-hit-area',
      panel.present ? `::after ${panel.pos} inset=${panel.inset}` : 'no session-panel entry on this host')

    // ---- 3. the frame's safe-area padding moves both corner controls together ----
    await evaluate(`(() => { document.querySelector('[data-mobile-nav="frame"]').style.setProperty('padding-top', '${INSET}px', 'important'); return true })()`)
    await sleep(300)
    const sim = JSON.parse(await evaluate(measure))
    record(sim.files[1] === base.files[1] + INSET && sim.toggle[1] === base.toggle[1] + INSET,
      '3.both-corners-follow-the-inset', `files ${base.files[1]} -> ${sim.files[1]}, toggle ${base.toggle[1]} -> ${sim.toggle[1]} (inset ${INSET})`)
    record(sim.files[0] + sim.files[2] === sim.vw - 8, '3.still-right-pinned-with-inset', `right edge ${sim.files[0] + sim.files[2]}`)
    await evaluate(`(() => { document.querySelector('[data-mobile-nav="frame"]').style.removeProperty('padding-top'); return true })()`)

    // ---- 4. 0.1.6-alpha.2 terminal header geometry (task-3 T1b final values,
    // courtesy of the layout fix): seat box <=1px, cluster at x=40, toggle
    // 28x28 @(8,6), files 36x36 @(right 8, top 2), both centres + the title
    // band centre aligned within tolerance, files clear of the actions flow.
    const geoExpr = `(() => {
      const g = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +b.right.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1) } }
      const leading = document.querySelector('[class*="_headerLeading"]')
      const cluster = document.querySelector('[class*="_titleCluster"]')
      const toggle = document.querySelector('[data-mobile-nav="toggle"]')
      const files = document.querySelector('[data-mobile-nav="files"]')
      const titleRow = document.querySelector('[class*="_titleRow"]')
      const actions = document.querySelector('[class*="_headerActions"]')
      if (!leading || !cluster || !toggle || !files || !titleRow || !actions) return null
      let flowRight = 0
      // Measure the CONTENT anchors only: full-width static containers
      // (the actions wrapper itself) reach the header's right edge and would
      // poison a generic descendant scan. The flow content is exactly the
      // crumbs window, the creative-mode chip and the team chip.
      for (const c of cluster.querySelectorAll('[class*="_crumbs"], [class*="SVAs4q"], [data-team-action]')) {
        const b = c.getBoundingClientRect()
        if (b.width > 0) flowRight = Math.max(flowRight, b.right)
      }
      return JSON.stringify({
        leading: g(leading), clusterX: +cluster.getBoundingClientRect().x.toFixed(1),
        toggle: g(toggle), files: g(files), titleBand: g(titleRow),
        flowRight: +flowRight.toFixed(1), vw: innerWidth
      })
    })()`
    const geo = JSON.parse(await evaluate(geoExpr))
    if (geo === null) {
      record(false, '4.header-elements-present', 'a header node is missing - cannot measure terminal geometry')
    } else {
      record(geo.leading.w <= 1, '4.seat-box-collapsed', `headerLeading ${geo.leading.w}x${geo.leading.h} (was 44x0)`)
      record(Math.abs(geo.clusterX - 40) <= 1, '4.title-cluster-at-40', `titleCluster x=${geo.clusterX} (was 84)`)
      record(Math.abs(geo.toggle.w - 28) <= 0.5 && Math.abs(geo.toggle.h - 28) <= 0.5 && Math.abs(geo.toggle.x - 8) <= 1 && Math.abs(geo.toggle.y - 6) <= 1,
        '4.toggle-28-at-8-6', `toggle ${geo.toggle.w}x${geo.toggle.h} @(${geo.toggle.x},${geo.toggle.y})`)
      record(Math.abs(geo.files.w - 36) <= 0.5 && Math.abs(geo.files.h - 36) <= 0.5 && Math.abs(geo.files.r - (geo.vw - 8)) <= 1 && Math.abs(geo.files.y - 2) <= 1,
        '4.files-36-right-pinned-top2', `files ${geo.files.w}x${geo.files.h} right=${geo.files.r} top=${geo.files.y}`)
      record(Math.abs(geo.toggle.cy - geo.files.cy) <= 0.5, '4.corner-centres-aligned', `toggle cy=${geo.toggle.cy} files cy=${geo.files.cy}`)
      record(Math.abs(geo.toggle.cy - geo.titleBand.cy) <= 2, '4.centres-on-title-band', `controls cy=${geo.toggle.cy} title band cy=${geo.titleBand.cy}`)
      record(geo.files.x >= geo.flowRight - 0.5, '4.files-clear-of-actions-flow', `files left=${geo.files.x} vs actions flow right=${geo.flowRight}`)
    }
  } finally {
    chrome.kill()
    await sleep(300)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  if (failures.length > 0) { console.log(`FAILED: ${failures.join(', ')}`); process.exitCode = 1 } else { console.log('ALL PASS') }
}
main().catch((e) => { console.error('ERR', e); process.exitCode = 1 })
