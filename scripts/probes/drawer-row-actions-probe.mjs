// Regression anchor: inside the mobile drawer, row action controls must not
// dismiss the drawer.
//
// Why this file exists (2026-09-14, root cause):
//   The session row's ⋯ menu is the only way to reach rename / fork / archive /
//   delete on a phone. Two defects killed it:
//   1. `@linxin666/dsh-web-all`'s compat shim (`installMobileSidebarDismiss`)
//      collapses the drawer on ANY click inside `[role="treeitem"]` at
//      ≤768px by clicking the host logo-row toggle — with no `_rowActions`
//      exemption, so the tap on the ⋯ closed the drawer instead of opening
//      the menu (its sibling implementation inside `@linxin666/dsh-remote-web-ui`
//      does exempt `_rowActions`). Measured: the closing click is an
//      UNTRUSTED `.click()` on `[data-dsh-responsive-part="sidebar-toggle"]`.
//   2. Nothing revealed the ⋯ on touch at all: host CSS shows `_rowActions` on
//      `:hover` / `menuOpen` only, so a phone user never saw the dots (the
//      third-party long-press that would show them is gated on that plugin's
//      own `active` flag, which is false on this profile).
//
// Assertions (the user's symptoms, in order):
//   3. long-pressing a session row opens its ⋯ menu (4 items: 3 host + our
//      injected delete) with the drawer still open;
//   4. lifting the finger keeps that menu and the drawer (the host menu closes
//      on pointerleave, and the lift's synthesized click must not navigate);
//   5. tapping the ⋯ itself leaves the drawer open (the exact reported bug);
//   6. tapping a *different* row still navigates and closes the drawer, and
//   7. tapping the backdrop still closes it — both guard that neutralizing the
//      third-party dismiss did not remove the dismiss paths we keep.
//
// The ⋯ sits above its menu (measured: button [244,502,16,16], menu
// [160,522,218,168] — no overlap), so assertion 5 can tap it while the menu is
// open without hitting a menu item.
//
// Env: DSH_PROBE_URL (default http://127.0.0.1:3080/), DSH_PROBE_SESSION_ID,
//      DSH_PROBE_COOKIE, DSH_PROBE_CHROME, DSH_PROBE_TIMEOUT_MS.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.DSH_PROBE_CHROME || '/data/data/com.termux/files/usr/lib/chromium/chrome'
const PORT = 9344
const URL_BASE = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const TIMEOUT_MS = Number(process.env.DSH_PROBE_TIMEOUT_MS || 30000)
const DRAWER = '[data-mobile-nav="frame"] [class*="_sidebarCol"]'
const LONG_PRESS_MS = 650
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

/** Session dirs are named by session id; newest first (see drawer-new-session-probe). */
async function recentSessionIds(limit = 4) {
  const encoded = `--${process.cwd().replace(/\//g, '-')}--`
  for (const dir of [encoded, '--data-data-com.termux-files-home--']) {
    const root = join(homedir(), '.dsh', 'sessions', dir)
    let names = []
    try { names = (await readdir(root)).filter((n) => n.startsWith('session-')) } catch { continue }
    const dated = []
    for (const name of names) dated.push({ name, mtimeMs: (await stat(join(root, name))).mtimeMs })
    dated.sort((a, b) => b.mtimeMs - a.mtimeMs)
    if (dated.length > 0) return dated.slice(0, limit).map((entry) => entry.name)
  }
  return []
}

async function main() {
  const dir = await mkdtemp(join(homedir(), 'tmp', 'cdp-rowactions-'))
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
    const touchStart = (x, y) => send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 0 }] })
    const touchEnd = () => send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const tap = async (x, y) => { await touchStart(x, y); await sleep(50); await touchEnd() }

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

    const state = () => evaluate(`(() => {
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      const items = [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim())
      // Reachability, not just presence: the whole point of this probe is that
      // a rendered-but-buried menu used to pass every DOM-only assertion while
      // the owner saw nothing (2026-09-14).
      const menu = document.querySelector('[role="menu"]')
      let reachable = null
      if (menu !== null) {
        const r = menu.getBoundingClientRect()
        const at = (x, y) => document.elementFromPoint(x, y)
        const hits = [
          [Math.round(r.x + 8), Math.round(r.y + r.height / 2)],
          [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)],
          [Math.round(r.right - 6), Math.round(r.y + r.height / 2)],
        ].map(([x, y]) => { const el = at(x, y); return el !== null && menu.contains(el) })
        reachable = {
          z: getComputedStyle(menu).zIndex,
          all: hits.every(Boolean),
        }
      }
      return { collapsed: frame === null ? null : frame.hasAttribute('data-sidebar-collapsed'), items, reachable }
    })()`)
    const openDrawer = async () => {
      const toggle = await evaluate(`(() => { const el = document.querySelector('[data-mobile-nav="toggle"], [data-mobile-nav="fab"]'); if (el === null) return null; const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
      if (toggle === null) throw new Error('no plugin drawer control to tap')
      await tap(toggle.x, toggle.y)
      return waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === false`), 'drawer-open', 10000).catch(() => false)
    }
    /** One visible session row: its ⋯ button and a tap point on its title.
     *  `unselected` skips the current session's row (tapping that one cannot
     *  navigate, so it proves nothing about the dismiss-on-navigate path). */
    const rowInfo = (index, unselected = false) => evaluate(`(() => {
      const drawer = document.querySelector(${JSON.stringify(DRAWER)})
      if (drawer === null) return null
      let rows = [...drawer.querySelectorAll('[class*="sessionRow"]')].filter((r) => r.getBoundingClientRect().width > 0)
      ${unselected ? 'rows = rows.filter((r) => r.getAttribute("aria-selected") !== "true")' : ''}
      const row = rows[${index}]
      if (row === undefined) return null
      const rr = row.getBoundingClientRect()
      const button = [...row.querySelectorAll('button')].pop()
      const br = button.getBoundingClientRect()
      return {
        title: row.querySelector('[class*="_title"]')?.textContent?.trim() ?? '',
        selected: row.getAttribute('aria-selected') === 'true',
        titleTap: { x: Math.round(rr.x + 40), y: Math.round(rr.y + rr.height / 2) },
        ellipsisTap: { x: Math.round(br.x + br.width / 2), y: Math.round(br.y + br.height / 2) },
      }
    })()`)

    record((await openDrawer()) === true, '2.drawer-opens')
    await sleep(700)

    const target = (await rowInfo(1)) ?? (await rowInfo(0))
    if (target === null) throw new Error('no session row rendered in the drawer')

    // 3/4 — long press opens the row menu; the lift must keep menu and drawer.
    await touchStart(target.titleTap.x, target.titleTap.y)
    await sleep(LONG_PRESS_MS)
    const during = await state()
    await touchEnd()
    await sleep(400)
    const after = await state()
    record(during.items.length === 4 && during.collapsed === false, '3.long-press-opens-row-menu', `items=[${during.items.join('|')}] collapsed=${during.collapsed}`)
    record(after.items.length === 4 && after.collapsed === false, '4.lift-keeps-menu-and-drawer', `items=[${after.items.join('|')}] collapsed=${after.collapsed}`)

    // 4b — the second half of the report: the popup the ⋯ opens must not be
    // pressed under the drawer. The host portals its menus to <body> at
    // z-index 1100 while the drawer column sits at 1300, so the menu was
    // painted (and measured) completely underneath it: elementFromPoint at the
    // menu's centre and at both ends returned drawer elements.
    record(after.reachable !== null && after.reachable.all === true, '4b.row-menu-above-drawer', `z=${after.reachable === null ? 'n/a' : after.reachable.z}`)

    // 5 — the reported bug: tapping the ⋯ must toggle the menu, never the drawer.
    // A closed drawer hides the rows, so a failed 3/4 has nothing left to tap:
    // report it as a failure instead of crashing the probe.
    if (during.collapsed === true || after.collapsed === true) {
      record(false, '5.tap-ellipsis-keeps-drawer', 'SKIP: drawer already collapsed after the long press')
      record(false, '5b.tap-ellipsis-closed-menu', 'SKIP: drawer already collapsed after the long press')
    } else {
      const withMenu = (await rowInfo(1)) ?? (await rowInfo(0))
      await tap(withMenu.ellipsisTap.x, withMenu.ellipsisTap.y)
      await sleep(500)
      const dotState = await state()
      record(dotState.collapsed === false, '5.tap-ellipsis-keeps-drawer', `collapsed=${dotState.collapsed} items=[${dotState.items.join('|')}]`)
      record(dotState.items.length === 0, '5b.tap-ellipsis-closed-menu', `items=[${dotState.items.join('|')}]`)
      // The dots are live, not just inert: a second tap reopens the same menu
      // (and still must not touch the drawer).
      const again = (await rowInfo(1)) ?? (await rowInfo(0))
      await tap(again.ellipsisTap.x, again.ellipsisTap.y)
      await sleep(500)
      const reopened = await state()
      record(reopened.items.length === 4 && reopened.collapsed === false, '5c.tap-ellipsis-reopens-menu', `items=[${reopened.items.join('|')}] collapsed=${reopened.collapsed}`)
      await tap(again.ellipsisTap.x, again.ellipsisTap.y)
      await sleep(400)
    }

    // 5d/5e — our own confirm card spends its life in the same band: it is
    // mounted on <body> (the third-party shim swallows every click inside the
    // frame but outside the drawer in its capture phase, which left the card's
    // buttons dead) and must sit above the drawer. Cancelling keeps the probe
    // non-destructive.
    // 5c left the menu closed, so re-open it with the real gesture (long press)
    // before reaching for the delete item — the card is the next surface in the
    // same journey the owner reported.
    await touchStart(target.titleTap.x, target.titleTap.y)
    await sleep(LONG_PRESS_MS)
    await touchEnd()
    await sleep(600)
    const menuForCard = await evaluate(`(() => {
      const m = document.querySelector('[role="menu"]')
      if (m === null) return null
      const del = [...m.querySelectorAll('[role="menuitem"]')].find((i) => /delete/i.test(i.textContent))
      if (del === undefined) return null
      const r = del.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    if (menuForCard !== null) { await tap(menuForCard.x, menuForCard.y); await sleep(800) }
    const cardState = await evaluate(`(() => {
      const card = document.querySelector('[data-mobile-nav="delete-dialog"]')
      if (card === null) return null
      const r = card.getBoundingClientRect()
      const el = document.elementFromPoint(Math.round(r.x + 20), Math.round(r.y + r.height / 2))
      const cancel = card.querySelector('[data-mobile-nav="delete-confirm-no"]')
      const cr = cancel === null ? null : cancel.getBoundingClientRect()
      return {
        parentIsBody: card.parentElement === document.body,
        z: getComputedStyle(card).zIndex,
        cardOwnsDrawerBand: el !== null && card.contains(el),
        cancelTap: cr === null ? null : { x: Math.round(cr.x + cr.width / 2), y: Math.round(cr.y + cr.height / 2) },
      }
    })()`)
    if (cardState === null || cardState.cancelTap === null) {
      record(false, '5d.confirm-card-above-drawer', 'SKIP: no confirm card (delete item missing)')
      record(false, '5e.confirm-card-cancel-closes', 'SKIP: no confirm card')
    } else {
      record(cardState.parentIsBody === true && cardState.cardOwnsDrawerBand === true && Number(cardState.z) >= 1400, '5d.confirm-card-above-drawer', `z=${cardState.z} parentBody=${cardState.parentIsBody} ownsDrawerBand=${cardState.cardOwnsDrawerBand}`)
      await tap(cardState.cancelTap.x, cardState.cancelTap.y)
      await sleep(500)
      const closed = await evaluate(`document.querySelector('[data-mobile-nav="delete-dialog"]') === null && document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === false`)
      record(closed === true, '5e.confirm-card-cancel-closes')
    }

    // 5f/5g — the workspace row's ⋯ → Rename opens the HOST's own modal: it
    // portals to a direct body child stacking at z 1000, under the drawer
    // column (1300), so the dialog was only usable after closing the drawer
    // (owner report 2026-09-19). The plugin raises that portal root to 1400
    // while the drawer is open; the dialog itself (inner z 1) sorts inside the
    // root, so the assertion must target the root. Cancel keeps it
    // non-destructive. The workspace ⋯ button is hover-only (0x0 box), so the
    // click is dispatched programmatically like the real touch flow does.
    const wsRename = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Workspace actions'))
      if (btn === undefined) return { skip: 'no workspace row' }
      btn.click()
      return { clicked: true }
    })()`)
    if (wsRename === null || wsRename.skip !== undefined) {
      record(false, '5f.workspace-rename-above-drawer', 'SKIP: ' + (wsRename?.skip || 'no workspace actions button'))
      record(false, '5g.workspace-rename-cancel-closes', 'SKIP: no workspace actions button')
    } else {
      await sleep(500)
      const renamed = await evaluate(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((i) => /rename/i.test(i.textContent))
        if (item === undefined) return null
        item.click()
        return true
      })()`)
      await sleep(600)
      const dlgState = await evaluate(`(() => {
        const dlg = document.querySelector('[role="dialog"][aria-modal="true"]')
        if (dlg === null) return null
        const root = dlg.parentElement
        const r = dlg.getBoundingClientRect()
        const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
        const cancel = [...dlg.querySelectorAll('button')].find((b) => /cancel|取消/i.test(b.textContent))
        const cr = cancel === null ? null : cancel.getBoundingClientRect()
        return { rootZ: root === null ? null : getComputedStyle(root).zIndex, inside: dlg.contains(hit), cancelTap: cr === null ? null : { x: Math.round(cr.x + cr.width / 2), y: Math.round(cr.y + cr.height / 2) } }
      })()`)
      if (renamed === null || dlgState === null || dlgState.cancelTap === null) {
        record(false, '5f.workspace-rename-above-drawer', 'SKIP: rename dialog did not open')
        record(false, '5g.workspace-rename-cancel-closes', 'SKIP: rename dialog did not open')
      } else {
        record(Number(dlgState.rootZ) >= 1400 && dlgState.inside === true, '5f.workspace-rename-above-drawer', `rootZ=${dlgState.rootZ} centerHitInside=${dlgState.inside}`)
        await tap(dlgState.cancelTap.x, dlgState.cancelTap.y)
        await sleep(500)
        const dlgGone = await evaluate(`document.querySelector('[role="dialog"][aria-modal="true"]') === null`)
        record(dlgGone === true, '5g.workspace-rename-cancel-closes', `dialogClosedAfterCancel=${dlgGone}`)
      }
    }

    // 6 — navigation still dismisses: a different row must switch sessions.
    // The drawer is usually still open here (assertion 5 kept it that way):
    // tapping the toggle again would CLOSE it, so only reopen when collapsed.
    const wasClosed = (await state()).collapsed === true
    const openNow = wasClosed ? (await openDrawer()) === true : true
    const other = openNow ? ((await rowInfo(0, true)) ?? (await rowInfo(1))) : null
    if (other !== null && other.selected !== true) {
      await tap(other.titleTap.x, other.titleTap.y)
      const switched = await waitFor(async () => {
        const raw = await evaluate(`localStorage.getItem('dsh.sessions.current')`)
        const current = raw === null ? null : JSON.parse(raw).sessionId
        return current !== null && current !== seeded ? current : null
      }, 'session-switch', 8000).catch(() => null)
      const closed = await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === true`), 'drawer-close', 5000).catch(() => false)
      record(switched !== null && closed === true, '6.row-tap-navigates-and-closes', `switched=${switched === null ? 'no' : 'yes'} collapsedAfterTap=${!closed}`)
    } else {
      const diag = await evaluate(`(() => {
        const d = document.querySelector(${JSON.stringify(DRAWER)})
        const rows = d === null ? [] : [...d.querySelectorAll('[class*="sessionRow"]')]
        return { wasClosed: ${wasClosed}, openNow: ${openNow}, total: rows.length, visible: rows.filter((r) => r.getBoundingClientRect().width > 0).length, selected: rows.findIndex((r) => r.getAttribute('aria-selected') === 'true') }
      })()`)
      // SKIP, not PASS: this item is the only anchor for the 2026-09-13
      // "row tap navigates AND closes" regression, so an environment without a
      // second row must not read as a green assertion (the other SKIPs in this
      // file record false for the same reason).
      record(false, '6.row-tap-navigates-and-closes', `SKIP (no unselected second row) diag=${JSON.stringify(diag)}`)
    }

    // 7 — backdrop tap still dismisses (the third-party path is neutralized, ours must hold).
    record((await openDrawer()) === true, '7a.drawer-reopens')
    await sleep(600)
    const beforeBackdrop = await state()
    await tap(360, 420)
    const backdropClosed = await waitFor(() => evaluate(`document.querySelector('[data-mobile-nav="frame"]')?.hasAttribute('data-sidebar-collapsed') === true`), 'backdrop-close', 5000).catch(() => false)
    record(beforeBackdrop.collapsed === false && backdropClosed === true, '7b.backdrop-tap-closes', `collapsedAfterTap=${!backdropClosed}`)
  } finally {
    chrome.kill()
    await sleep(300)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  if (failures.length > 0) { console.log(`FAILED: ${failures.join(', ')}`); process.exitCode = 1 } else { console.log('ALL PASS') }
}

main().catch((error) => { console.error('ERR', error.message); process.exitCode = 1 })
