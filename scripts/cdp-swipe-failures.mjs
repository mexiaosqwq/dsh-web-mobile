// 诊断探针：复现"手势被识别成对话内容滚动"的失败场景。
// 场景 = 现有 cdp-swipe-probe.mjs 未覆盖的真实用户失败模式：
//   A. 打开失败：起点偏离热区 / 斜向滑动 / 短距离慢速
//   B. 关闭失败：抽屉内斜滑 / 短距离
// 每个场景记录：drawer marker 是否翻转 + 主内容滚动容器 scrollTop 是否变化
//              + 页面是否收到 pointercancel（浏览器把手势当滚动/pan 的证据）。
//
// 用法：DSH_PROBE_URL=http://127.0.0.1:3457/ node scripts/cdp-swipe-failures.mjs
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3457/'
const CHROME = process.env.DSH_PROBE_CHROME || 'google-chrome'

const FRAME_SELECTOR = '[data-mobile-nav="frame"]'
const DRAWER_SELECTOR = '[data-mobile-nav="frame"] > :first-child'
const SCROLL_SELECTOR = '[data-phase] [class*="_scrollBody"]'

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
  const port = await allocatePort()
  const profileDir = await mkdtemp(join(homedir(), '.cache', 'dsh-nav-fail-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir,
    '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' })

  let wsUrl = null
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page) { wsUrl = page.webSocketDebuggerUrl; break }
    } catch { /* retry */ }
    await sleep(250)
  }
  if (!wsUrl) { console.error('chrome 未就绪'); chrome.kill(); process.exit(1) }

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
  await send('Page.navigate', { url: URL })
  await sleep(6000)

  // 等插件 frame 就绪
  let ready = false
  for (let i = 0; i < 30; i++) {
    if (await evalv(`!!document.querySelector(${JSON.stringify(FRAME_SELECTOR)})`)) { ready = true; break }
    await sleep(500)
  }
  if (!ready) { console.error('插件 frame 未就绪'); process.exit(1) }
  await sleep(1500)

  // 移除宿主 "Internal Testing Notice" 模态（BODY > DIV._root_15u5s 含 mask+aria-modal），
  // 否则其 mask 拦截一切触摸、aria-modal 让位使手势层全部 inert（同 cdp-swipe-probe.mjs）。
  await evalv(`(() => {
    const root = document.querySelector('[class*="_root_15u5s"]')
    if (root !== null && root.parentElement === document.body) root.remove()
    for (const m of document.querySelectorAll('[aria-modal="true"]')) m.remove()
  })()`)
  await sleep(500)

  // 注入 pointercancel 记录器 + 主滚动容器记录
  await evalv(`(() => {
    window.__diag = { cancels: [], cancelTargets: [] }
    document.addEventListener('pointercancel', (e) => {
      window.__diag.cancels.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
      window.__diag.cancelTargets.push(e.target && e.target.className ? String(e.target.className).slice(0, 60) : String(e.target))
    }, true)
  })()`)

  const state = async () => {
    const d = await evalv(`(() => {
      const frame = document.querySelector(${JSON.stringify(FRAME_SELECTOR)})
      const scroller = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)})
      return {
        open: frame ? !frame.hasAttribute('data-sidebar-collapsed') : null,
        scrollTop: scroller ? scroller.scrollTop : null,
        scrollHeight: scroller ? scroller.scrollHeight : null,
        clientHeight: scroller ? scroller.clientHeight : null,
        cancels: window.__diag ? window.__diag.cancels.length : -1,
      }
    })()`)
    return d
  }

  const swipe = async (x0, y0, x1, y1, durationMs = 150) => {
    const steps = Math.max(3, Math.round(durationMs / 16))
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    for (let i = 1; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps
      const y = y0 + ((y1 - y0) * i) / steps
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      await sleep(16)
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  const results = []
  const record = (name, detail) => {
    results.push({ name, detail })
    console.log(`${detail.ok ? 'PASS' : 'OBS '} ${name}: ${detail.text}`)
  }

  // --- 前置：关闭抽屉到基线 ---
  const pre = await state()
  if (pre.open) {
    // 点 backdrop 关闭（点抽屉右侧）
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 380, y: 400, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 380, y: 400, button: 'left', clickCount: 1 })
    await sleep(800)
  }

  const baseline = await state()
  console.log('基线: open=' + baseline.open)

    const ensureClosed = async () => {
    // 用内容区横滑关闭（与手势同一确定路径；mouse 点击在触摸视口下不可靠）。
    // 关闭手势本身可能因起点在关闭态而无操作，故循环验证。
    for (let i = 0; i < 3; i++) {
      const s = await state()
      if (!s.open) return true
      await swipe(100, 400, 220, 400, 150)
      await sleep(800)
    }
    return (await state()).open === false
  }
  const ensureOpen = async () => {
    for (let i = 0; i < 3; i++) {
      const s = await state()
      if (s.open) return true
      await swipe(12, 400, 140, 400, 150)
      await sleep(800)
    }
    return (await state()).open === true
  }

  // ===== A. 打开手势回归（drawer 关闭态，2026-08-27 优化后） =====

  // A1. 起点 40px（视觉热区 24px 外，但在 48px 识别区内）横滑 100px
  //     —— 优化前失败（"识别成滚动"）；startZone 48px 后应打开
  await ensureClosed()
  await swipe(40, 400, 140, 400, 150)
  await sleep(700)
  const a1 = await state()
  record('A1 起点40px横滑100px(识别区外起步)', {
    ok: a1.open === true,
    text: `open=${a1.open} (期望 true: 48px 识别区覆盖) cancels=${a1.cancels}`,
  })

  // 复位到关闭态（A1 已打开）
  await ensureClosed()

  // A2. 起点 12px（热区内）斜滑 dx=80 dy=60 —— 优化前 1.5bias 判失败；
  //     新轴锁定 |dx|>|dy| 应接受（drawer 已复位关闭）
  await swipe(12, 400, 92, 460, 150)
  await sleep(700)
  const a2 = await state()
  record('A2 热区内斜滑(80,60)打开', {
    ok: a2.open === true,
    text: `open=${a2.open} (期望 true: |dx|>|dy| 横向主导) cancels=${a2.cancels}`,
  })

  // 复位到关闭态
  await ensureClosed()

  // A3. 起点 12px 短距慢速横滑 40px —— 低于 62px 距离阈值且速度不足，
  //     应保持拒绝（验证阈值仍有效，防止过度触发）
  await swipe(12, 400, 52, 400, 300)
  await sleep(700)
  const a3 = await state()
  record('A3 热区内短距慢速40px(仍应拒绝)', {
    ok: a3.open === false,
    text: `open=${a3.open} (期望 false: 距离62px/速度0.45均不足) cancels=${a3.cancels}`,
  })

  // A4. 起点 12px 标准打开（对照：应成功）
  await swipe(12, 400, 130, 400, 150)
  await sleep(700)
  const a4 = await state()
  record('A4 热区内横滑118px(对照)', {
    ok: a4.open === true,
    text: `open=${a4.open} (期望 true) cancels=${a4.cancels}`,
  })

  // ===== B. 关闭手势回归（drawer 打开态） =====

  // B0. 抽屉内横滑 100px 关闭（对照：应成功，drawer 当前打开）
  await swipe(100, 400, 200, 400, 150)
  await sleep(700)
  const b0 = await state()
  record('B0 抽屉内横滑100px(对照关闭)', {
    ok: b0.open === false,
    text: `open=${b0.open} (期望 false 已关闭) cancels=${b0.cancels}`,
  })

  // 重新打开用于 B1
  await ensureOpen()

  // B1. 抽屉内斜滑 dx=70 dy=60 —— 优化前 1.5bias 判失败保持打开；
  //     新轴锁定应接受并关闭
  await swipe(100, 400, 170, 460, 150)
  await sleep(700)
  const b1 = await state()
  record('B1 抽屉内斜滑(70,60)关闭', {
    ok: b1.open === false,
    text: `open=${b1.open} (期望 false 已关闭: |dx|>|dy| 横向主导) cancels=${b1.cancels}`,
  })

  // 重新打开用于 B2
  await ensureOpen()

  // B2. 抽屉内短距横滑 30px —— 低于 51px 关闭阈值，
  //     应保持打开（验证关闭阈值仍有效）
  await swipe(100, 400, 130, 400, 200)
  await sleep(700)
  const b2 = await state()
  record('B2 抽屉内短距30px关闭(仍应拒绝)', {
    ok: b2.open === true,
    text: `open=${b2.open} (期望 true 保持打开: 距离51px/速度不足) cancels=${b2.cancels}`,
  })

  // B3. S0 回归（2026-08-27 审计）：起点落在宿主关闭集合元素（newSession 行）
  //     右滑 170px。修复前：宿主 onDrawerPointerUp 注册更早、同一 capture
  //     相位先跑，先 toggle；手势层随后用锁定时快照判 'close' 再 toggle ——
  //     双翻抵消，抽屉保持打开，手势看似失灵。
  //     修复后：轴锁定（pointermove 阶段置位 isStrokeLocked）使宿主让位，
  //     手势单翻关闭。
  await ensureOpen()
  const b3pt = await evalv(`(() => {
    const row = document.querySelector('[class*="newSession"]')
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (b3pt) {
    const x0 = Math.min(b3pt.x, 200)
    await swipe(x0, b3pt.y, x0 + 170, b3pt.y, 150)
    await sleep(700)
    const b3 = await state()
    record('B3 S0: newSession行起点右滑170px(宿主让位单翻关闭)', {
      ok: b3.open === false,
      text: `open=${b3.open} (期望 false: 宿主让位; 修复前=true 双翻抵消) cancels=${b3.cancels}`,
    })
  } else {
    console.log('B3 跳过: 无 newSession 行（hero/blank 阶段）')
  }

  // ===== C. 浏览器滚动行为观察 =====
  const diag = await evalv(`({
    cancels: window.__diag.cancels,
    targets: window.__diag.cancelTargets,
  })`)
  console.log('\n-- pointercancel 汇总 --')
  console.log('cancels 数量:', diag.cancels.length)
  if (diag.cancels.length > 0) {
    console.log('前 5 个 cancel:', JSON.stringify(diag.cancels.slice(0, 5)))
    console.log('targets:', JSON.stringify(diag.targets.slice(0, 5)))
  } else {
    console.log('(无 pointercancel —— headless 下浏览器未抢占手势，真实设备可能不同)')
  }

  // 主内容是否可滚动（scrollHeight > clientHeight 才可能"被识别成滚动"）
  const scrollInfo = await evalv(`(() => {
    const scroller = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)})
    return scroller ? {
      scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      overflowY: getComputedStyle(scroller).overflowY,
      touchAction: getComputedStyle(scroller).touchAction,
    } : null
  })()`)
  console.log('\n-- 主内容滚动容器 --')
  console.log(JSON.stringify(scrollInfo))

  ws.close()
  chrome.kill()
  await rm(profileDir, { recursive: true, force: true })
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })