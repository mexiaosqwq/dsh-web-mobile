// 回归探针：iOS 输入聚焦自动放大守卫（#45）。
// 三个场景（同一浏览器依次导航）：
//   A. 手机 + Chromium UA：不得出现 iOS 标记，第三方 13px 搜索框保持原样
//      （安卓不该为不存在的问题变大字号），composer 仍是 16px。
//   B. 手机 + iPhone UA：标记出现，所有可见文本输入域计算值 >=16px，
//      composer 三件套（textarea / mirror / backdrop）同尺寸，
//      checkbox 等控件类 input 不被改，select 保持官方尺寸。
//   C. 桌面（关触摸模拟）+ iPhone UA：移动分支未激活 → 标记必须缺席。
// A11/B7 是 D-1 决策（2026-09-16）的守卫：ask composer 的自定义字段与文件
// 面板的搜索/跳转字段只在 iOS 需要 16px 下限（那里才有聚焦放大），安卓保持
// 宿主紧凑字号。两个族都不在本 profile 的屏上，故注入形状再读计算值。
// 另断言根与抽屉的 touch-action 仍含 pinch-zoom（浏览器自行放大后用户要能
// 双指缩回；#45 报告的"关掉重开或旋转才恢复"就是缩不回来的表现），
// 且 gesturestart 不再被 preventDefault（那会在 iOS 上掐死双指缩放）。
//
// 用法：DSH_PROBE_URL=http://127.0.0.1:3080/ DSH_PROBE_SESSION_ID=<id> \
//       DSH_PROBE_CHROME=/path/to/chrome node scripts/cdp-zoom-probe.mjs
import { prepareHostScenario } from './lib/probe-host-scenario.mjs'
import { spawn } from 'node:child_process'
import { createCdpClient } from './lib/probe-cdp-client.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { installExitGuard, REQUEST_DEADLINE_MS, createCleanup } from './lib/probe-cdp-lifecycle.mjs'

// C13：资源句柄模块级 + 进程退出兜底（早退/抛错也必须回收）
let chrome = null
let profileDir = null
import { homedir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.DSH_PROBE_URL || 'http://127.0.0.1:3080/'
const CHROME = process.env.DSH_PROBE_CHROME || 'chromium'
const SESSION = process.env.DSH_PROBE_SESSION_ID || ''
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const TEXT_FIELDS =
  'input:not([type="button"]):not([type="checkbox"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="image"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"]), textarea, [contenteditable="true"]'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const allocatePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })

import { createVerdict } from './lib/probe-verdict.mjs'
const verdict = createVerdict('cdp-zoom-probe')
let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  if (ok) verdict.pass(name, detail)
  else verdict.fail(name, detail)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
}
const skip = (name, detail) => { verdict.skip(name, detail); console.log(`SKIP ${name}: ${detail}`) }

async function main() {
  const port = await allocatePort()
  profileDir = await mkdtemp(join(homedir(), 'tmp', 'dsh-zoom-'))
  chrome = spawn(
    CHROME,
    [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir,
      '--window-size=430,932', 'about:blank',
    ],
    { stdio: 'ignore', env: { ...process.env, TMPDIR: join(homedir(), 'tmp'), XDG_RUNTIME_DIR: join(homedir(), 'tmp') } },
  )

  let launchError = null
  chrome.once('error', (error) => { launchError = error })
  let wsUrl = null
  for (let i = 0; i < 60; i++) {
    if (launchError !== null) throw launchError
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page) { wsUrl = page.webSocketDebuggerUrl; break }
    } catch { /* retry */ }
    await sleep(250)
  }
  if (!wsUrl) throw new Error('chrome 未就绪')

  const ws = new WebSocket(wsUrl)
  // 统一 CDP 客户端（goal ①）：不再手写 send/onmessage/pending —— 该类手写引入过多次裸标识符与应答关联缺陷
  const { send, waitFor } = createCdpClient({ ws, requestDeadlineMs: REQUEST_DEADLINE_MS })
  await new Promise((res) => { ws.onopen = res })
  const evalv = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  if (SESSION !== '') {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: SESSION }))})`,
    })
  }

  // 隔离 profile 首启会弹宿主 "Internal Testing Notice" 模态（连 mask 一起
  // 移除，只删 aria-modal 会留遮罩拦截）。
  const dismissHostModal = () => prepareHostScenario(evalv)

  const boot = async ({ width, height, touch }) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: touch })
    // maxTouchPoints 必须 >=1，关触摸时也不能传 0（CDP 直接报错）。
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
    if (process.env.DSH_PROBE_COOKIE) {
      const raw = process.env.DSH_PROBE_COOKIE
      const eq = raw.indexOf('=')
      await send('Network.setCookie', { name: raw.slice(0, eq), value: raw.slice(eq + 1), url: URL })
    }
    await send('Page.navigate', { url: URL })
    for (let i = 0; i < 60; i++) {
      const ready = await evalv('document.readyState === "complete" && !!document.querySelector("[data-phase]")')
      if (ready) break
      await sleep(500)
    }
    await sleep(2500)
    await dismissHostModal()
    await sleep(400)
  }

  const survey = () =>
    evalv(`(() => {
      const marker = document.documentElement.hasAttribute('data-mobile-nav-ios')
      const fields = [...document.querySelectorAll(${JSON.stringify(TEXT_FIELDS)})]
        .map((el) => {
          const rect = el.getBoundingClientRect()
          return {
            tag: el.tagName,
            type: el.getAttribute('type'),
            cls: String(el.className || '').slice(0, 40),
            fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
            visible: rect.width > 0 && rect.height > 0,
          }
        })
      const widgets = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"], input[type="range"], select')]
        .map((el) => ({ tag: el.tagName, type: el.getAttribute('type'), fontSize: Number.parseFloat(getComputedStyle(el).fontSize) }))
      const composer = (() => {
        const card = document.querySelector('[data-composer-card]')
        if (card === null) return null
        const editor = card.querySelector('[data-composer-input]')
        if (editor !== null) return {
          kind: 'lexical', editable: editor.isContentEditable,
          editor: Number.parseFloat(getComputedStyle(editor).fontSize),
          phase: editor.getAttribute('data-phase'),
        }
        const pick = (sel) => {
          const el = card.querySelector(sel)
          return el === null ? null : Number.parseFloat(getComputedStyle(el).fontSize)
        }
        return { textarea: pick('textarea'), mirror: pick('[data-input-mirror]'), backdrop: pick('[data-input-backdrop]') }
      })()
      const drawer = document.querySelector('[data-mobile-nav="frame"] > :first-child')
      const gesture = (() => {
        const event = new Event('gesturestart', { bubbles: true, cancelable: true })
        document.dispatchEvent(event)
        return event.defaultPrevented
      })()
      return {
        marker,
        frame: document.querySelector('[data-mobile-nav="frame"]') !== null,
        fields,
        widgets,
        composer,
        touchAction: {
          html: getComputedStyle(document.documentElement).touchAction,
          body: getComputedStyle(document.body).touchAction,
          drawer: drawer === null ? null : getComputedStyle(drawer).touchAction,
        },
        gesturePrevented: gesture,
      }
    })()`)

  // dsh 0.1.2-rc.1 swaps the composer textarea for a Lexical contenteditable
  // whose card reads font-size: var(--dsh-content-font-size, 14px) — 14px by
  // default, i.e. squarely in the zoom-triggering range. The installed host
  // still ships the 16px textarea, so inject the shape the next host renders:
  // a 14px editable holding a contenteditable="false" decorator at 12px,
  // which the floor must NOT touch.
  const editableProbe = () =>
    evalv(`(() => {
      const host = document.querySelector('[data-phase]') || document.body
      const editor = document.createElement('div')
      editor.setAttribute('contenteditable', 'true')
      editor.setAttribute('role', 'textbox')
      editor.style.fontSize = '14px'
      const decorator = document.createElement('span')
      decorator.setAttribute('contenteditable', 'false')
      decorator.style.fontSize = '12px'
      decorator.textContent = 'chip'
      editor.appendChild(decorator)
      host.appendChild(editor)
      const read = (el) => Number.parseFloat(getComputedStyle(el).fontSize)
      const out = { editable: read(editor), decorator: read(decorator) }
      editor.remove()
      return out
    })()`)

  // The two field families the audit's D-1 decision moved under the iOS gate.
  // Inject one of each and read what the stylesheet actually gives them - an
  // assertion on the rule text would pass even with the rule inert.
  const floorProbe = () =>
    evalv(`(() => {
      const host = document.querySelector('[data-phase]') || document.body
      const ask = document.createElement('div')
      ask.setAttribute('data-question-key', 'probe')
      const customInput = document.createElement('input')
      customInput.className = 'probe_customInput'
      const customTextarea = document.createElement('textarea')
      customTextarea.className = 'probe_customTextarea'
      ask.append(customInput, customTextarea)
      const viewer = document.createElement('input')
      viewer.className = 'probe-dsfv-search-input'
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      const frameHost = frame === null ? host : frame
      frameHost.appendChild(viewer)
      host.appendChild(ask)
      const read = (el) => Number.parseFloat(getComputedStyle(el).fontSize)
      const out = { customInput: read(customInput), customTextarea: read(customTextarea), dsfvSearch: read(viewer) }
      ask.remove()
      viewer.remove()
      return out
    })()`)

  const describe = (fields) =>
    fields.filter((f) => f.visible).map((f) => `${f.cls || f.tag.toLowerCase()}=${f.fontSize}`).join(' ')

  // ===== A. 手机 + Chromium UA =====
  await boot({ width: 430, height: 932, touch: true })
  const a = await survey()
  check('A0 移动分支已激活', a.frame === true, `frame=${a.frame}`)
  check('A1 非 iOS 引擎无 iOS 标记', a.marker === false, `marker=${a.marker} (期望 false: Chromium 不会聚焦放大)`)
  const aSmall = a.fields.filter((f) => f.visible && f.fontSize < 16)
  const aSample = await evalv(`(() => {
    const input = document.createElement('input')
    input.type = 'text'; input.style.fontSize = '13px'
    document.body.appendChild(input)
    const font = Number.parseFloat(getComputedStyle(input).fontSize)
    input.remove(); return font
  })()`)
  check(
    'A2 非iOS的13px输入夹具保持原样',
    aSample === 13,
    `controlledSample=${aSample}px; installedVisibleSmallFields=${aSmall.length}（未安装样本不计覆盖）`,
  )
  if (a.composer?.kind === 'lexical') skip('A3.legacy textarea/mirror/backdrop', '本宿主为Lexical；旧三件套不适用')
  check(
    'A3 当前composer字号与编辑前置',
    a.composer?.kind === 'lexical'
      ? a.composer.editable === true && Number.isFinite(a.composer.editor)
      : a.composer !== null && a.composer.textarea !== null && a.composer.textarea === a.composer.mirror && a.composer.textarea === a.composer.backdrop,
    `composer=${JSON.stringify(a.composer)}; Lexical要求可编辑；旧宿主要求三件套一致`,
  )
  check(
    'A4 根与抽屉保留 pinch-zoom',
    a.touchAction.html.includes('pinch-zoom') && a.touchAction.body.includes('pinch-zoom') &&
      (a.touchAction.drawer === null || a.touchAction.drawer.includes('pinch-zoom')),
    `html=${a.touchAction.html} body=${a.touchAction.body} drawer=${a.touchAction.drawer}`,
  )
  check(
    'A5 不再 preventDefault gesturestart',
    a.gesturePrevented === false,
    `defaultPrevented=${a.gesturePrevented} (期望 false: 拦它等于在 iOS 上掐死双指缩放)`,
  )
  check(
    'A6 根仍禁横向 pan（手势层依赖）',
    !/\bpan-x\b/.test(a.touchAction.html) && !/\bpan-x\b/.test(a.touchAction.body),
    `html=${a.touchAction.html} body=${a.touchAction.body}`,
  )
  const aEditable = await editableProbe()
  check(
    'A7 非 iOS 下 14px 可编辑域不被抬高',
    aEditable.editable === 14 && aEditable.decorator === 12,
    `editable=${aEditable.editable} decorator=${aEditable.decorator} (期望 14/12: 安卓不放大，抬字号只会改版式)`,
  )

  // A8-A10. viewport meta 所有权（PR #46）：插件武装期间拥有该 meta，宿主
  // 改写 / 换节点 / 迟到注入都必须被重申，且写入内容里绝不能出现缩放锁
  // （maximum-scale / user-scalable）——那会把安卓的缩放一并拿掉。
  const viewportOf = async () =>
    await evalv(`(() => { const m = document.querySelector('meta[name="viewport"]'); return m === null ? null : m.content })()`)
  const armed = await viewportOf()
  check(
    'A8 武装期 viewport 由插件拥有且无缩放锁',
    armed === 'width=device-width, initial-scale=1, viewport-fit=cover',
    `content=${JSON.stringify(armed)} (期望恰好 width/initial-scale/viewport-fit: 出现 maximum-scale 或 user-scalable 即 WCAG 1.4.4 回归)`,
  )
  await evalv(`(() => { document.querySelector('meta[name="viewport"]').content = 'width=device-width, initial-scale=1, maximum-scale=1' })()`)
  await sleep(200)
  const rewritten = await viewportOf()
  check(
    'A9 宿主改写被重申回来',
    rewritten === 'width=device-width, initial-scale=1, viewport-fit=cover',
    `content=${JSON.stringify(rewritten)} (期望重申: 否则 viewport-fit=cover 静默失效、安全区归零)`,
  )
  await evalv(`(() => {
    const old = document.querySelector('meta[name="viewport"]')
    old.remove()
    const next = document.createElement('meta')
    next.name = 'viewport'
    next.content = 'width=device-width, initial-scale=1'
    document.head.appendChild(next)
  })()`)
  await sleep(200)
  const replaced = await viewportOf()
  check(
    'A10 换节点后新 meta 也被接管',
    replaced === 'width=device-width, initial-scale=1, viewport-fit=cover',
    `content=${JSON.stringify(replaced)} (期望重申: head childList observer 必须重新绑定到新节点)`,
  )

  const aFloor = await floorProbe()
  const aRaised = Object.entries(aFloor).filter(([, v]) => v >= 16).map(([k]) => k)
  check(
    'A11 安卓不抬高 ask / 文件面板字段',
    aRaised.length === 0,
    `${JSON.stringify(aFloor)} (期望三个字段都 <16px${aRaised.length > 0 ? '，被抬高的是 ' + aRaised.join('/') : ''}: 这两个族只在 iOS 需要 16px 下限，安卓抬高它们只是改版式)`,
  )

  // ===== B. 手机 + iPhone UA =====
  await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA })
  await boot({ width: 430, height: 932, touch: true })
  const b = await survey()
  check('B0 iOS UA 下移动分支已激活', b.frame === true, `frame=${b.frame}`)
  check('B1 iOS 标记出现', b.marker === true, `marker=${b.marker}`)
  const bSmall = b.fields.filter((f) => f.visible && f.fontSize < 16)
  check(
    'B2 所有可见文本输入域 >=16px',
    b.fields.some(f => f.visible) && bSmall.length === 0,
    bSmall.length === 0
      ? `全部 ${b.fields.filter((f) => f.visible).length} 个可见输入域: ${describe(b.fields)}`
      : `仍有 <16px: ${describe(bSmall)} (iOS 会对它们聚焦放大)`,
  )
  if (b.composer?.kind === 'lexical') skip('B3.legacy textarea/mirror/backdrop', '本宿主为Lexical；旧三件套不适用')
  check(
    'B3 当前composer可编辑且至少16px',
    b.composer?.kind === 'lexical'
      ? b.composer.editable === true && b.composer.editor >= 16
      : b.composer !== null && b.composer.textarea === 16 && b.composer.mirror === 16 && b.composer.backdrop === 16,
    `composer=${JSON.stringify(b.composer)}; required-precondition editable=true`,
  )
  const bWidgetChanged = b.widgets.filter((w) => w.fontSize === 16)
  check(
    'B4 控件类 input / select 未被改字号',
    b.widgets.length === 0 || bWidgetChanged.length === 0,
    `widgets=${JSON.stringify(b.widgets)} (期望不含被强制 16px 的项: 无键盘可打，改了只会撑破 28px 控件)`,
  )
  check(
    'B5 iOS 下同样保留 pinch-zoom 且禁横向 pan',
    b.touchAction.html.includes('pinch-zoom') && !/\bpan-x\b/.test(b.touchAction.html),
    `html=${b.touchAction.html} drawer=${b.touchAction.drawer}`,
  )
  const bEditable = await editableProbe()
  check(
    'B6 iOS 下 14px 可编辑域抬到 16px，装饰节点不动',
    bEditable.editable === 16 && bEditable.decorator === 12,
    `editable=${bEditable.editable} decorator=${bEditable.decorator} (0.1.2-rc.1 的 Lexical composer 就是这形状: 14px contenteditable + contenteditable=false 装饰节点)`,
  )

  const bFloor = await floorProbe()
  const bFlat = Object.entries(bFloor).filter(([, v]) => v < 16).map(([k]) => k)
  check(
    'B7 iOS 下同三个字段仍 >=16px',
    bFlat.length === 0,
    `${JSON.stringify(bFloor)} (期望都 >=16px${bFlat.length > 0 ? '，未抬高的是 ' + bFlat.join('/') : ''}: 注入形状无人抬高，靠 html[data-mobile-nav-ios] 那条网兜底；<16px 即 Safari 聚焦放大)`,
  )

  // ===== C. 桌面（鼠标指针）+ iPhone UA =====
  await boot({ width: 1440, height: 900, touch: false })
  const c = await survey()
  check('C0 桌面未激活移动分支', c.frame === false, `frame=${c.frame}`)
  check('C1 桌面无 iOS 标记', c.marker === false, `marker=${c.marker} (标记随移动 effect 生灭)`)
  const cSmall = c.fields.filter((f) => f.visible && f.fontSize < 16)
  check(
    'C2 桌面字号完全不受影响',
    cSmall.length > 0 || c.fields.length === 0,
    `${cSmall.length} 个可见输入域 <16px: ${describe(cSmall) || '(无可见输入域)'}`,
  )

  console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`)
  ws.close()
  // C13：收尾统一走 createCleanup（精确 PID + profile 旁证）；exited/removed 为 false **必须判 FAIL**。
  const cleanupEvidence = await createCleanup({ child: chrome, profileDir, rm })()
  const cleanupOk = cleanupEvidence.exited === true && cleanupEvidence.removed === true
  if (!cleanupOk) failures += 1
  console.log('CLEANUP ' + JSON.stringify(cleanupEvidence))
  if (!cleanupOk) verdict.fail('cleanup', 'exited/removed not true')
  console.log(verdict.summary())
  process.exit(verdict.exitCode())
}

main().catch(async (error) => {
  console.error(error)
  const evidence = await createCleanup({ child: chrome, profileDir, rm })()
  console.log('CLEANUP ' + JSON.stringify(evidence))
  const cleanupOk = evidence.exited === true && evidence.removed === true
  verdict.fail('fatal', error instanceof Error ? error.message : String(error))
  if (!cleanupOk) verdict.fail('cleanup', 'exited/removed not true')
  console.log(verdict.summary())
  console.log('FATAL cleanup=' + (cleanupOk ? 'PASS' : 'FAIL') + ' cause=' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
})

installExitGuard({ getChild: () => chrome, getProfileDir: () => profileDir })
