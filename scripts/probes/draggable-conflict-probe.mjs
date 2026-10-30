// 回归门：侧边抽屉手势 × 可拖动悬浮元素（桌宠/悬浮窗类）冲突。
// 历史：2026-09-11 诊断轮复现（zone=176px@390 时按住桌宠右拖误 arm 抽屉），
// 据此落地三层让位体系（识别区保持 45% 不缩——用户拍板）：
//   B. 悬浮窗位置启发式：起点祖先链上存在 position:fixed|absolute 且
//      尺寸 ≤200px 的自由定位浮层（dsh-pet 悬浮球实测 148x160 fixed）
//      → 手势层整笔让位。可拖动悬浮件在 DOM 上没有标准标记，位置形状
//      是唯一可通用的识别信号。
//   C. 让位标记接口：拖动组件拖动期间挂 data-mobile-nav-dragging
//      （起点元素/祖先或 documentElement/body），pointerdown 与每次锁轴
//      判定前读取，标记在场即让位。配合实现的组件不依赖形状猜测。
// 本探针断言：
//   组1 纯几何（zone=176 语义）：zone 内慢拖闪现（机制保留）、fling 保持
//       打开、zone 外（x=220>176）不触发、向左拖不触发。
//   组2 悬浮窗启发式（B 侧）：注入仿 dsh-pet 真实形状（fixed 148x160 +
//       touch-action:none + pointer 拖动实现，无任何标记）→ zone 内从球上
//       右拖抽屉不开 + 球跟手（让位≠拦截）；zone 外左拖对照。
//   组2b 按名认领：注入 dsh-pet 0.3.x 的真实形态（.dsh-pet-root，命中区
//       173x206 超过 200px 形状上限，且注册在本 frame 子树内）→ 从宠物上右拖
//       抽屉不开 + 宠物跟手；用完即删，避免组3 被按名分支提前接走。
//   组3 让位标记接口（C 侧）：球挂标记后右拖不开 + 跟手；body 全局标记
//       让位普通手势；清除后手势恢复。
// 用法：DSH_PROBE_URL=http://127.0.0.1:3080/ node scripts/probes/draggable-conflict-probe.mjs
//       Termux: DSH_PROBE_CHROME=/data/data/com.termux/files/usr/lib/chromium/chrome
//               + TMPDIR/XDG_RUNTIME_DIR 指向可写目录
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createVerdict } from '../lib/probe-verdict.mjs'

const URL = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const CHROME = process.env.DSH_PROBE_CHROME || 'google-chrome'

const FRAME_SELECTOR = '[data-mobile-nav="frame"]'
const PET_ID = 'probe-pet'
// 与 sidebar-swipe.ts 的 START_ZONE_RATIO / FLOATING_WIDGET_MAX_PX 同步。
const START_ZONE_RATIO = 0.45
const FLOATING_WIDGET_MAX_PX = 200
const VIEWPORT_W = 390

// C11：结论收口（同 cdp-swipe-failures.mjs）。此前本探针只有过程内 SUMMARY、
// **没有 verdict、也没有退出码** —— 断言红了照样 exit 0，绿色退出被当成通过。
const verdict = createVerdict('draggable-conflict-probe')
const results = []
const pass = (name, detail = '') => record('PASS', name, detail)
const fail = (name, detail = '') => record('FAIL', name, detail)
const skip = (name, detail = '') => record('SKIP', name, detail)
function record(status, name, detail = '') {
  results.push({ status, name, detail })
  console.log(`${status} ${name}${detail ? ` ${detail}` : ''}`)
  // 每条断言同步进 verdict：只要有一条 FAIL，退出码就是 1（SKIP 不改变退出码，
  // 但不能用来声称完整验收通过）。
  if (status === 'PASS') verdict.pass(name, detail)
  else if (status === 'FAIL') verdict.fail(name, detail)
  else verdict.skip(name, detail)
}
function check(name, condition, detail = '') {
  if (condition) pass(name, detail)
  else fail(name, detail)
  return condition
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 故意失败自证（隔离夹具，不需要宿主/浏览器）：PROBE_SELFTEST=1 ⇒ 注入一条合成 FAIL，
  // 必须 exit 1；PROBE_SELFTEST=clean ⇒ 只有一条合成 PASS，exit 0。
  // 走的与真实断言完全同一条 check/record → verdict → exitCode 路径。
  if (process.env.PROBE_SELFTEST === '1' || process.env.PROBE_SELFTEST === 'clean') {
    check('selftest.synthetic-pass', true, 'synthetic pass')
    if (process.env.PROBE_SELFTEST === '1') {
      check('selftest.deliberate-failure', false, 'synthetic deliberate failure（预期让退出码非零）')
    }
    return
  }
  const port = await allocatePort()
  const profileDir = await mkdtemp(join(homedir(), '.cache', 'dsh-nav-pet-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir,
    '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' })
  try {
    await run(port)
  } finally {
    chrome.kill()
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function run(port) {
  let wsUrl = null
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page) { wsUrl = page.webSocketDebuggerUrl; break }
    } catch { /* retry */ }
    await sleep(250)
  }
  if (!wsUrl) throw new Error('chrome 未就绪')

  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.rej(new Error(msg.error.message))
      else p.res(msg.result)
    }
  }
  await new Promise((res) => (ws.onopen = res))
  const evalv = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true,
  })
  // MOBILE_QUERY gates the mobile shell on (pointer: coarse); headless has no
  // pointer, so touch emulation must arm the mobile branch.
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Page.navigate', { url: URL })
  await sleep(6000)

  // 等插件 frame 就绪
  let ready = false
  for (let i = 0; i < 30; i++) {
    if (await evalv(`!!document.querySelector(${JSON.stringify(FRAME_SELECTOR)})`)) { ready = true; break }
    await sleep(500)
  }
  if (!ready) throw new Error('插件 frame 未就绪')
  await sleep(1500)

  // 移除宿主 "Internal Testing Notice" 模态（含 mask+aria-modal），否则其
  // mask 拦截一切触摸、aria-modal 让位使手势层全部 inert（同 cdp-swipe-probe.mjs）。
  await evalv(`(() => {
    const root = document.querySelector('[class*="_root_15u5s"]')
    if (root !== null && root.parentElement === document.body) root.remove()
    for (const m of document.querySelectorAll('[aria-modal="true"]')) m.remove()
  })()`)
  await sleep(500)

  // 屏蔽页面上已存在的真实悬浮件（本机 profile 装着 dsh-pet，其 148x160
  // fixed 悬浮球可能落在起手区内触发启发式让位、污染几何场景）：把所有
  // 命中启发式条件的既有元素临时 display:none（仅探针会话，无持久化），
  // 后续悬浮窗场景全部用注入的 probe-pet 球，环境差异即被钉死。
  await evalv(`(() => {
    let n = 0
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('[data-mobile-nav="frame"]')) continue
      const cs = getComputedStyle(el)
      if ((cs.position === 'fixed' || cs.position === 'absolute') &&
          el.offsetWidth > 0 && el.offsetWidth <= ${FLOATING_WIDGET_MAX_PX} &&
          el.offsetHeight <= ${FLOATING_WIDGET_MAX_PX}) {
        el.style.display = 'none'
        n++
      }
    }
    window.__probeHiddenFloaters = n
  })()`)
  await sleep(300)

  const zone = await evalv(`Math.round(${VIEWPORT_W} * ${START_ZONE_RATIO})`)
  check('zone.width-matches-0.45-ratio', zone === 176, `zone=${zone}px @${VIEWPORT_W}（识别区保持 45%）`)

  const state = async () => {
    return evalv(`(() => {
      const frame = document.querySelector(${JSON.stringify(FRAME_SELECTOR)})
      const pet = document.getElementById(${JSON.stringify(PET_ID)})
      return {
        open: frame ? !frame.hasAttribute('data-sidebar-collapsed') : null,
        petExists: !!pet,
        petLeft: pet ? parseFloat(pet.style.left || '60') : null,
        petTop: pet ? parseFloat(pet.style.top || '360') : null,
      }
    })()`)
  }

  // touch 笔画：start -> 逐点 move（每点自带间隔）-> end。
  const touchStroke = async (x0, y0, points, endGapMs = 120) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    for (const [x, y, gapMs] of points) {
      await sleep(gapMs)
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    }
    await sleep(endGapMs)
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  // 慢拖：n 步 x step px，每步 16ms（末速 = step/16 px/ms，用于速度阈值判定）。
  const slowDrag = (x0, y0, step, n, dyPerStep = 0) => {
    const pts = []
    for (let i = 1; i <= n; i++) {
      pts.push([x0 + step * i, y0 + dyPerStep * i, 16])
    }
    return touchStroke(x0, y0, pts, 140)
  }
  // fling：单步大位移（末速 = dist/gap，远超 0.45px/ms）。
  const fling = (x0, y0, x1, y1) => touchStroke(x0, y0, [[x1, y1, 16]], 60)

  // 抽屉复位到关闭。
  const ensureClosed = async (label) => {
    let d = await state()
    if (d.open === null) { skip(`${label}.frame-missing`); return false }
    if (d.open) {
      // 打开态全 frame 可滑关：快速左滑。
      await fling(300, 400, 120, 400)
      await sleep(700)
      d = await state()
      if (d.open) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 350, y: 400 }] })
        await sleep(60)
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await sleep(700)
        d = await state()
      }
      if (d.open) { fail(`${label}.reset-failed`, 'drawer still open'); return false }
    }
    await sleep(300)
    return true
  }

  // 组1 ─────────────────────────────────────────────────────────────
  console.log('\n== 组1：纯几何（zone=176 语义）==')

  // S1 机制保留：zone 内（x=60）慢拖 30px -> arm（打开）-> 释放不足 -> 关回。
  {
    const ok = await ensureClosed('s1')
    if (ok) {
      await slowDrag(60, 400, 3, 10)
      const during = await state()
      check('zone.in-zone-slow-drag-arms', during.open === true,
        `during drag open=${during.open}（预期 true：8px 锁轴即提前提交，机制保留）`)
      await sleep(700)
      const after = await state()
      check('zone.in-zone-slow-drag-reverts', after.open === false,
        `after release open=${after.open}（预期 false：距离30<62px 且速度不足 -> 关回=闪现）`)
      await ensureClosed('s1.cleanup')
    }
  }

  // S2 机制保留：zone 内 fling -> 保持打开。
  {
    const ok = await ensureClosed('s2')
    if (ok) {
      await fling(60, 400, 170, 400) // 110px 快甩
      await sleep(700)
      const after = await state()
      check('zone.in-zone-fling-stays-open', after.open === true,
        `after fling open=${after.open}（预期 true：110px>62px 距离阈值）`)
      await ensureClosed('s2.cleanup')
    }
  }

  // S6 区外对照：x=220（>176，0.45 区外）慢拖 -> 不触发。
  {
    const ok = await ensureClosed('s6')
    if (ok) {
      await slowDrag(220, 400, 3, 10)
      const during = await state()
      check('zone.outside-no-arm', during.open === false,
        `during drag open=${during.open}（预期 false：起点 220 > zone 176）`)
      await ensureClosed('s6.cleanup')
    }
  }

  // S4 方向对照：zone 内向左拖（全程 dx<0）-> 不触发。
  {
    const ok = await ensureClosed('s4')
    if (ok) {
      await slowDrag(60, 400, -3, 10)
      const during = await state()
      check('zone.leftward-no-arm', during.open === false,
        `during drag open=${during.open}（预期 false：arm 只认 travel>=+8px 向右）`)
      await ensureClosed('s4.cleanup')
    }
  }

  // 组2 ─────────────────────────────────────────────────────────────
  console.log('\n== 组2：悬浮窗位置启发式（仿 dsh-pet：fixed 148x160，无标记）==')

  // 仿 dsh-pet 真实形状：fixed + touch-action:none + pointerdown/move 拖动
  // + setPointerCapture（rg 实证 dsh-pet/lib/client.js 即此实现），尺寸用
  // 实测的 148x160。不挂任何 data-mobile-nav-dragging 标记——它代表的是
  // 「不配合的第三方悬浮窗」。
  const injectPet = `(() => {
    const old = document.getElementById(${JSON.stringify(PET_ID)})
    if (old) old.remove()
    const ball = document.createElement('div')
    ball.id = ${JSON.stringify(PET_ID)}
    ball.style.cssText = 'position:fixed;left:60px;top:300px;width:148px;height:160px;border-radius:12px;background:rgba(233,30,99,0.85);z-index:2147483000;touch-action:none;user-select:none;'
    ball.__drag = null
    ball.addEventListener('pointerdown', (e) => {
      ball.__drag = { sx: e.clientX, sy: e.clientY, ox: ball.offsetLeft, oy: ball.offsetTop }
      try { ball.setPointerCapture(e.pointerId) } catch {}
    })
    ball.addEventListener('pointermove', (e) => {
      if (!ball.__drag) return
      ball.style.left = (ball.__drag.ox + (e.clientX - ball.__drag.sx)) + 'px'
      ball.style.top = (ball.__drag.oy + (e.clientY - ball.__drag.sy)) + 'px'
    })
    const end = () => { ball.__drag = null }
    ball.addEventListener('pointerup', end)
    ball.addEventListener('pointercancel', end)
    document.body.appendChild(ball)
  })()`

  await evalv(injectPet)
  const petInit = await state()
  check('pet.injected-in-zone', petInit.petExists && petInit.petLeft === 60,
    `petLeft=${petInit.petLeft}（球 148 宽覆盖 x∈[60,208]，中心 134 < zone 176 = 在识别区内）`)

  // W1 核心断言（B 侧证据）：无标记的悬浮球在 zone 内被按住右拖
  // -> 抽屉不开（启发式让位）+ 球跟手（让位≠拦截，拖动照常）。
  {
    const ok = await ensureClosed('w1')
    if (ok) {
      await slowDrag(134, 380, 4, 10) // 起点=球中心，40px 向右
      const during = await state()
      check('pet.unmarked.no-arm', during.open === false,
        `during drag open=${during.open}（预期 false：fixed 148x160 小浮层命中启发式，手势层让位）`)
      check('pet.unmarked.ball-follows', during.petLeft !== null && during.petLeft > 60,
        `petLeft=${during.petLeft}（预期 >60：让位不等于拦截，悬浮窗拖动本身被执行）`)
      await ensureClosed('w1.cleanup')
    }
  }

  // W2 对照：球放 zone 外（left=250）从球上左拖 -> 抽屉不开 + 球跟手。
  {
    await evalv(`(() => {
      const b = document.getElementById(${JSON.stringify(PET_ID)})
      b.style.left = '250px'
      b.style.top = '300px'
    })()`)
    const ok = await ensureClosed('w2')
    if (ok) {
      await slowDrag(324, 380, -4, 25) // 起点=球中心(250+74)，向左 100px
      const during = await state()
      check('pet.zone-out.leftward-no-arm', during.open === false,
        `during drag open=${during.open}（预期 false：起点 324 > zone 且 dx<0 双闸）`)
      check('pet.zone-out.ball-follows-left', during.petLeft !== null && during.petLeft < 250,
        `petLeft=${during.petLeft}（预期 <250：球跟手左移）`)
      await ensureClosed('w2.cleanup')
    }
  }

  // 组2b ────────────────────────────────────────────────────────────
  console.log('\n== 组2b：按名认领（.dsh-pet-root，173x206 超出形状上限）==')

  // dsh-pet 0.3.x 的真实形态：根节点 .dsh-pet-root 注册在 shell.overlay（在本
  // frame 子树内），命中区实测 173x206（默认 462px stage）——超过 200px 形状
  // 上限，位置启发式抓不到，只有按名分支能让位（#249-1）。用完即删：组 3 的
  // 起点 (134,380) 落在这只宠物覆盖区内，留着会让组 3 走到按名分支、标记接口
  // 反而没被测到（假绿）。
  const NAMED_PET_ID = 'probe-pet-named'
  await evalv(`(() => {
    const old = document.getElementById(${JSON.stringify(NAMED_PET_ID)})
    if (old) old.remove()
    const pet = document.createElement('div')
    pet.id = ${JSON.stringify(NAMED_PET_ID)}
    pet.className = 'dsh-pet-root'
    pet.style.cssText = 'position:fixed;left:60px;top:300px;width:173px;height:206px;border-radius:16px;background:rgba(0,150,255,0.85);z-index:2147483000;touch-action:none;user-select:none;'
    pet.__drag = null
    pet.addEventListener('pointerdown', (e) => {
      pet.__drag = { sx: e.clientX, sy: e.clientY, ox: pet.offsetLeft, oy: pet.offsetTop }
      try { pet.setPointerCapture(e.pointerId) } catch {}
    })
    pet.addEventListener('pointermove', (e) => {
      if (!pet.__drag) return
      pet.style.left = (pet.__drag.ox + (e.clientX - pet.__drag.sx)) + 'px'
      pet.style.top = (pet.__drag.oy + (e.clientY - pet.__drag.sy)) + 'px'
    })
    const end = () => { pet.__drag = null }
    pet.addEventListener('pointerup', end)
    pet.addEventListener('pointercancel', end)
    document.body.appendChild(pet)
  })()`)
  {
    const ok = await ensureClosed('w2b')
    if (ok) {
      await slowDrag(146, 403, 4, 10) // 起点=宠物中心(60+173/2, 300+206/2)，向右 40px
      const after = await evalv(`(() => {
        const pet = document.getElementById(${JSON.stringify(NAMED_PET_ID)})
        const frame = document.querySelector(${JSON.stringify(FRAME_SELECTOR)})
        return {
          open: frame ? !frame.hasAttribute('data-sidebar-collapsed') : null,
          left: pet ? parseFloat(pet.style.left || '60') : null,
        }
      })()`)
      check('named-pet.drawer-stays-closed', after.open === false,
        `during drag open=${after.open}（预期 false：按名让位，173x206 超形状上限）`)
      check('named-pet.follows-finger', after.left !== null && after.left > 60,
        `left=${after.left}（预期 >60：让位≠拦截，宠物照常跟手）`)
    }
    await evalv(`document.getElementById(${JSON.stringify(NAMED_PET_ID)})?.remove()`)
  }

  // 组3 ─────────────────────────────────────────────────────────────
  console.log('\n== 组3：让位标记接口（data-mobile-nav-dragging）==')

  // G1 配合的桌宠：拖动期间球自身挂标记 -> 按住右拖抽屉不开 + 球跟手。
  {
    await evalv(`(() => {
      const b = document.getElementById(${JSON.stringify(PET_ID)})
      b.style.left = '60px'
      b.style.top = '300px'
      b.__drag = null
      const down = (e) => {
        b.__drag = { sx: e.clientX, sy: e.clientY, ox: b.offsetLeft, oy: b.offsetTop }
        b.setAttribute('data-mobile-nav-dragging', '')
        try { b.setPointerCapture(e.pointerId) } catch {}
      }
      const move = (e) => {
        if (!b.__drag) return
        b.style.left = (b.__drag.ox + (e.clientX - b.__drag.sx)) + 'px'
        b.style.top = (b.__drag.oy + (e.clientY - b.__drag.sy)) + 'px'
      }
      const up = () => { b.__drag = null; b.removeAttribute('data-mobile-nav-dragging') }
      b.onpointerdown = down
      b.onpointermove = move
      b.onpointerup = up
      b.onpointercancel = up
    })()`)
    const ok = await ensureClosed('g1')
    if (ok) {
      await slowDrag(134, 380, 4, 10) // 起点=球中心，40px 向右（球挂标记）
      const during = await state()
      check('yield.marked-pet.no-arm', during.open === false,
        `during drag open=${during.open}（预期 false：标记在场，手势层整条笔画让位）`)
      check('yield.marked-pet.ball-follows', during.petLeft !== null && during.petLeft > 60,
        `petLeft=${during.petLeft}（预期 >60：让位不等于拦截，拖动照常）`)
      await ensureClosed('g1.cleanup')
    }
  }

  // G2 body 全局标记：拖动方挂 documentElement/body 时普通右滑也让位。
  {
    await evalv(`(() => {
      const b = document.getElementById(${JSON.stringify(PET_ID)})
      b.removeAttribute('data-mobile-nav-dragging')
      b.onpointerdown = null; b.onpointermove = null; b.onpointerup = null; b.onpointercancel = null
      document.body.setAttribute('data-mobile-nav-dragging', '')
    })()`)
    const ok = await ensureClosed('g2')
    if (ok) {
      await slowDrag(60, 400, 4, 10)
      const during = await state()
      check('yield.body-mark.no-arm', during.open === false,
        `during drag open=${during.open}（预期 false：body 全局标记让位普通滑动手势）`)
      await evalv(`document.body.removeAttribute('data-mobile-nav-dragging')`)
      await ensureClosed('g2.cleanup')
    }
  }

  // G3 悬浮窗移除后手势恢复：zone 内右滑正常打开（B 侧无残留）。
  {
    await evalv(`(() => { document.getElementById(${JSON.stringify(PET_ID)})?.remove() })()`)
    const ok = await ensureClosed('g3')
    if (ok) {
      await slowDrag(60, 400, 4, 25) // 100px 右滑
      await sleep(700)
      const after = await state()
      check('yield.cleanup-gesture-works', after.open === true,
        `after drag open=${after.open}（预期 true：悬浮窗移除后手势层照常认领）`)
      await ensureClosed('g3.cleanup')
    }
  }

  // 汇总不在这里打：收口统一走 finishLifecycle，正文与致命错误两条路都会打，
  // 这样「探针结尾崩了」不会把已经记下的 FAIL 一起吞掉（本仓出过这个事故）。
}

/**
 * C11：单一收口出口。断言失败必须影响退出码，且**结尾崩溃**时前面记下的 FAIL
 * 仍要报出来 —— 所以正常返回与抛错都走这里，汇总与 verdict 两条路都打。
 */
function finishLifecycle(error) {
  if (error) {
    console.error(error)
    verdict.fail('fatal', error instanceof Error ? error.message : String(error))
  }
  const count = (s) => results.filter((r) => r.status === s).length
  console.log(`\nSUMMARY pass=${count('PASS')} fail=${count('FAIL')} skip=${count('SKIP')}`)
  const failed = results.filter((r) => r.status === 'FAIL')
  if (failed.length > 0) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`)
  }
  console.log('判读：pet.unmarked.no-arm / yield.* 的 FAIL = 让位体系回归；')
  console.log('zone.* 的 FAIL = 手势机制本身回归。')
  console.log(verdict.summary())
  process.exit(verdict.exitCode())
}

main().then(
  () => finishLifecycle(null),
  (error) => finishLifecycle(error),
)
