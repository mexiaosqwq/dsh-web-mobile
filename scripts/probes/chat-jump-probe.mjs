// Chromium regression for #299 using the built effect, CSS and reconciler.
// The fixture mirrors ConversationRoot > scrollBody > ChatView/Composer. No
// DSH profile or sessions are needed. Run after pnpm build:
//   node scripts/probes/chat-jump-probe.mjs [lib/client.js]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCdpClient } from '../lib/probe-cdp-client.mjs'
import { runWithCleanup, raceTotal } from '../lib/probe-cdp-lifecycle.mjs'

const bundlePath = process.argv.slice(2).find((arg) => arg !== '--preview')
const bundle = readFileSync(bundlePath ?? new URL('../../lib/client.js', import.meta.url), 'utf8')
const marker = 'var module = { exports: {} };'
const tail = bundle.lastIndexOf(marker)
assert.ok(tail >= 0, 'expected the bundle factory epilogue')
const source = bundle.slice(0, tail) + 'window.__fixtureRequire = __localRequire;' + bundle.slice(tail)

function mountFixture(source) {
  const errors = []
  window.addEventListener('error', (event) => errors.push(event.message))
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
  document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">'
  document.body.style.margin = '0'
  document.body.innerHTML = `
    <div data-mobile-nav="frame" style="--mobile-nav-header-h:64px">
      <div data-phase="active">
        <header id="fixture-header" style="height:64px;position:relative;z-index:30;background:white">Header</header>
        <div data-conversation-content data-conversation-session="s1" data-conversation-region="chat" style="position:relative;height:600px">
          <div data-conversation-scroll class="fixture_scrollBody" style="height:100%;overflow:auto;box-sizing:border-box">
            <div class="EvIC1a_frame"><div data-chat-flow style="padding-top:6px"></div>
              <div class="EvIC1a_toBottomSlot"><button class="EvIC1a_toBottom">Tail</button></div>
            </div>
            <div data-composer-seat style="position:sticky;bottom:0;height:150px;background:white"></div>
          </div>
        </div>
      </div>
    </div>`
  const root = document.querySelector('[data-conversation-session]')
  const scroller = root.querySelector('[data-conversation-scroll]')
  const flow = scroller.querySelector('[data-chat-flow]')
  const calls = []
  const scrollTo = scroller.scrollTo.bind(scroller)
  scroller.scrollTo = (options) => { calls.push(options); scrollTo(options) }
  const turn = (key, height = 55) => `<div style="height:120px" data-chat-flow-kind="user" data-chat-node-key="13:input-message${key}" data-chat-flow-key="${key}">${key}</div>
    <div style="height:${height}px" data-chat-flow-kind="assistant-step" data-chat-flow-key="${key}-reply">Reply</div>`
  flow.innerHTML = ['u0', 'u1', 'u2', 'u3'].map((key) => turn(key, key === 'u3' ? 480 : 55)).join('') +
    '<div hidden><div data-chat-flow-kind="user" data-chat-flow-key="hidden">Hidden</div></div>'
  const tailButton = scroller.querySelector('button')
  let returned = 0
  let following = false
  tailButton.onclick = () => {
    returned += 1
    following = true
    scroller.scrollTop = scroller.scrollHeight
    tailButton.remove()
  }
  const extendReply = () => {
    flow.querySelector('[data-chat-flow-key="u3-reply"]').style.height = '560px'
    if (following) scroller.scrollTop = scroller.scrollHeight
  }

  let served = 0
  let commit = null
  const input = (id, seq) => ({ type: 'event', event: { seq, type: 'user/message', surfaceOp: 'append', data: { id, source: { kind: 'user' } } } })
  const entries = ['u0', 'u1', 'u2', 'u3'].map((id, index) => input(id, 100 + index))
  const history = {
    limit: 4, held: true, flush: () => { commit?.(); commit = null },
    retainHead: () => flow.insertAdjacentHTML('afterbegin', '<div hidden data-chat-flow-key="retained-head"></div>'),
    insertNonPrompt: () => flow.insertAdjacentHTML('afterbegin', '<div hidden data-chat-flow-key="partial-commit"></div>'),
  }
  const hasMore = () => served < history.limit
  const eventSource = { getSnapshot: () => ({ hasMore: hasMore(), entries }) }
  const session = {
    getSnapshot: () => ({ hasMore: hasMore() }),
    // Service completion and DOM commit are explicitly separate; the test controls the delay.
    loadOlder: async () => {
      const key = 'old' + (++served)
      if (served === 4) {
        entries.unshift({ type: 'event', event: { seq: 100 - served, type: 'session/title', data: {} } })
        return
      }
      entries.unshift(input(key, 100 - served))
      commit = () => {
        const prefix = flow.querySelector('[data-chat-flow-key="retained-head"]')
        ;(prefix ?? flow).insertAdjacentHTML(prefix ? 'afterend' : 'afterbegin', turn(key))
      }
      if (!history.held) setTimeout(history.flush, 90)
    },
  }
  const ctx = {
    effect: (run) => run(),
    locale: { bind: () => (key) => key },
    sessions: { binding: (id) => id === 's1' ? { session, eventSource } : undefined },
  }
  const hostStub = new Proxy(() => hostStub, { get: () => hostStub })
  window.__ModuleLoader__ = { load: ({ factory }) => factory(() => hostStub) }
  new Function(source)()
  const require = window.__fixtureRequire
  delete window.__ModuleLoader__
  delete window.__fixtureRequire
  const style = document.createElement('style')
  style.textContent = require('./styles/index.js').MOBILE_CSS
  document.head.appendChild(style)
  require('./effects/reconciler-adapter.js').installReconciler(ctx)
  require('./effects/chat-jump.js').installChatJump(ctx)

  const cluster = () => root.querySelector('[data-mobile-nav="chat-jump"]')
  return {
    errors, scroller, root, cluster, calls, extendReply, history,
    cueCount: (key) => flow.querySelector(`[data-chat-flow-key="${key}"]`).getAnimations().length,
    key: (name) => cluster()?.querySelector('[data-mobile-nav="chat-jump-' + name + '"]'),
    shown: () => cluster()?.dataset.mobileNavShown === '1',
    returned: () => returned,
    served: () => served,
    landed: () => [...flow.querySelectorAll('[data-chat-flow-kind="user"]')]
      .find((row) => {
        const offset = row.getBoundingClientRect().top - document.querySelector('#fixture-header').getBoundingClientRect().bottom
        return row.offsetHeight > 0 && offset >= 0 && offset <= 8
      })?.dataset.chatFlowKey,
    switchView: () => flow.parentElement.remove(),
  }
}

const fixtureScript = `window.p = (${mountFixture})(${JSON.stringify(source)}); true`
if (process.argv.includes('--preview')) {
  const { createServer } = await import('node:http')
  createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><meta charset="utf-8"><title>会话四键预览</title><body><script>' +
      fixtureScript.replaceAll('</script', '<\\/script') + '\nwindow.p.history.retainHead(); window.p.history.held = false;</script>')
  }).listen(3197, '127.0.0.1', () => console.log('http://127.0.0.1:3197/'))
} else {
  await runProbe()
}

async function runProbe() {
const profileDir = await mkdtemp(join(tmpdir(), 'chat-jump-probe-'))
const child = spawn(process.env.DSH_PROBE_CHROME ?? 'chromium-browser', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
  '--no-first-run', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' })
let launchError
child.on('error', (error) => { launchError = error })

const ok = await runWithCleanup({ child, profileDir, rm, label: 'chat-jump', main: async () => {
  let page
  for (let i = 0; i < 100 && !page && !launchError; i++) {
    try {
      const port = (readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
      page = (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) }).then((r) => r.json()))
        .find((target) => target.type === 'page')
    } catch { /* Chromium is still starting. */ }
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (launchError) throw launchError
  assert.ok(page, 'expected a Chromium CDP page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const { send, waitFor } = createCdpClient({ ws })
  try {
    await raceTotal('Chrome socket open', 5000, new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    }))
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    }
    let failures = 0
    const check = async (name, expression, expected) => {
      const actual = await evaluate(expression)
      try {
        assert.deepEqual(actual, expected)
        console.log(`PASS ${name}`)
      } catch {
        failures += 1
        console.error(`FAIL ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
      }
    }
    const touch = (type, points = []) => send('Input.dispatchTouchEvent', { type, touchPoints: points })
    const tap = async (x, y) => {
      await touch('touchStart', [{ x, y }])
      await touch('touchEnd')
    }
    const click = async (key) => {
      const [x, y] = await evaluate(`(() => {
        const rect = p.key('${key}').getBoundingClientRect()
        return [rect.x + rect.width / 2, rect.y + rect.height / 2]
      })()`)
      await tap(x, y)
    }
    const landed = async (key) => {
      try {
        await waitFor(`land on ${key}`, 1400, () => evaluate(`p.landed() === ${JSON.stringify(key)}`))
      } catch (error) {
        console.error(await evaluate(`({ top: p.scroller.scrollTop, landed: p.landed(), calls: p.calls, shown: p.shown(), disabled: [...p.cluster().children].map(b => b.disabled) })`))
        throw error
      }
    }
    const scroll = (deltaY) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 120, y: 120, deltaX: 0, deltaY })
    const frame = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
    const settleScroll = () => evaluate(`new Promise(resolve => {
      let previous = p.scroller.scrollTop, stable = 0
      const check = () => {
        const top = p.scroller.scrollTop
        stable = top === previous ? stable + 1 : 0
        previous = top
        if (stable >= 5) resolve(true)
        else requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })`)
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await evaluate(`window.p = (${mountFixture})(${JSON.stringify(source)}); true`)
    await check('four keys mounted outside the scrolling content', 'p.cluster()?.parentElement === p.root && p.cluster().childElementCount === 4', true)
    await check('initially hidden and click-through', '[p.shown(), getComputedStyle(p.cluster()).pointerEvents]', [false, 'none'])
    await check('native tail is parked even while the jump keys are hidden', `
      (() => { const b = p.scroller.querySelector('button.EvIC1a_toBottom'); return b?.isConnected && getComputedStyle(b).display === 'none' })()`, true)
    await check('whole column is centered about 70% down the reading band', `
      (() => { const box = p.cluster().getBoundingClientRect(); return Math.abs(box.top + box.height / 2 - 334.2) < 2 })()`, true)
    await evaluate(`p.scroller.querySelector('[data-composer-seat]').style.height = '420px'`)
    await frame()
    await check('if the composer leaves no room, the native entry becomes available', `
      getComputedStyle(p.scroller.querySelector('button.EvIC1a_toBottom')).display !== 'none' && p.cluster().inert`, true)
    await evaluate(`p.scroller.querySelector('[data-composer-seat]').style.height = '150px'`)
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 230, deviceScaleFactor: 2, mobile: true })
    await frame()
    await check('when the visible viewport is too short, leave the native entry alone',
      `p.cluster().inert && getComputedStyle(p.scroller.querySelector('button.EvIC1a_toBottom')).display !== 'none'`, true)
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await frame()
    await tap(120, 120)
    await check('a tap without scrolling keeps the keys hidden', 'p.shown()', false)
    const startCenter = await evaluate('p.cluster().getBoundingClientRect().top')
    await scroll(110)
    await frame()
    await check('wheel scroll reveals the keys', 'p.shown()', true)
    await check('scrolling leaves the keys vertically anchored',
      `Math.abs(p.cluster().getBoundingClientRect().top - ${startCenter}) < 1`, true)
    await check('right edge stays clear of the touch targets', `
      !document.elementFromPoint(innerWidth - 2, p.cluster().getBoundingClientRect().top + 16)
        ?.closest('[data-mobile-nav="chat-jump"]')`, true)
    await waitFor('keys settle after reveal', 800, () => evaluate('getComputedStyle(p.cluster()).opacity === "1"'))
    await check('visible key faces sit at the right edge with centered arrows', `
      [...p.cluster().children].map(key => {
        const button = key.getBoundingClientRect()
        const face = getComputedStyle(key, '::before')
        const right = button.right - parseFloat(face.right)
        const left = button.left + parseFloat(face.left)
        const arrow = key.querySelector('svg').getBoundingClientRect()
        const gap = Math.round(innerWidth - right)
        return gap === 3 && right - left === 30 &&
          Math.abs((left + right) / 2 - (arrow.left + arrow.right) / 2) < 1 ? 'aligned' : gap
      })`, Array(4).fill('aligned'))
    await check('every key has a real 44px hit area without overlapping its neighbour', `
      [...p.cluster().children].every(key => {
        const r = key.getBoundingClientRect()
        const hit = (x, y) => document.elementFromPoint(x, y)?.closest('button') === key
        return r.width === 44 && r.height === 44 && hit(r.left + 1, r.top + 1) && hit(r.right - 1, r.bottom - 1)
      })`, true)
    await click('next')
    await click('next')
    await check('two rapid next presses call native smooth once each', 'p.calls.map(call => call.behavior)', ['smooth', 'smooth'])
    await waitFor('rapid next lands two prompts ahead', 1400, () => evaluate('p.landed() === "u2"'))
    await click('prev')
    await waitFor('native jump is in progress before touch takeover', 800, () => evaluate('p.scroller.scrollTop > 176 && p.scroller.scrollTop < 349'))
    await touch('touchStart', [{ x: 120, y: 320 }])
    await touch('touchMove', [{ x: 120, y: 250 }])
    await touch('touchMove', [{ x: 120, y: 165 }])
    await touch('touchEnd')
    await waitFor('touch cancels the native target and takes over', 1000, () => evaluate(`
      p.calls.at(-1)?.behavior === 'instant' && p.scroller.scrollTop > p.calls.at(-1).top + 10`))
    await settleScroll()
    await evaluate('p.scroller.scrollTop = 350')
    await frame()
    await click('prev')
    await landed('u1')
    await click('prev')
    await landed('u0')
    await click('prev')
    await click('top')
    await evaluate('new Promise(r => setTimeout(r, 1650))')
    await check('historical fetch remains visible and nonrepeatable until DOM commit',
      '[p.shown(), [...p.cluster().children].every(key => key.disabled), p.served(), p.landed()]', [true, true, 1, 'u0'])
    await evaluate('p.history.flush()')
    await waitFor('prev lands on committed old1', 1400, () => evaluate('p.landed() === "old1"'))
    await evaluate('p.history.retainHead(); p.history.held = false; p.scroller.scrollTop = 110; true')
    await frame()
    await click('top')
    await landed('old3')
    await check('top lands on the oldest question even with a retained flow head', `
      p.root.querySelector('[data-chat-flow-key]').dataset.chatFlowKey`, 'retained-head')
    await check('top lands instantly across pages including the metadata-only terminal page',
      '[p.served(), p.calls.at(-1)?.behavior, p.cueCount("old3"), p.cueCount("old2")]', [4, 'instant', 1, 0])
    await scroll(160)
    await settleScroll()
    await click('top')
    await landed('old3')
    await check('repeat top reuses the loaded first prompt', 'p.served()', 4)
    const callsBeforeBottom = await evaluate('p.calls.length')
    await click('bottom')
    await check('bottom invokes host action without plugin scrolling',
      '[p.returned(), p.scroller.scrollTop === p.scroller.scrollHeight - p.scroller.clientHeight, p.calls.length]', [1, true, callsBeforeBottom])
    await waitFor('only latest visible reply cues after native tail landing', 900, () => evaluate('p.cueCount("u3-reply") === 1 && p.cueCount("u2-reply") === 0'))
    await evaluate('p.extendReply()')
    await check('host still follows after new content', 'p.scroller.scrollTop === p.scroller.scrollHeight - p.scroller.clientHeight', true)
    await waitFor('chat jump idle hide', 3500, () => evaluate('!p.shown()'))
    await check('idle state is click-through again', 'getComputedStyle(p.cluster()).pointerEvents', 'none')
    await evaluate('p.scroller.scrollTop = 160')
    await frame()
    await check('programmatic scroll does not reveal the keys', 'p.shown()', false)
    await touch('touchStart', [{ x: 120, y: 320 }])
    await touch('touchMove', [{ x: 120, y: 260 }])
    await touch('touchMove', [{ x: 120, y: 190 }])
    await touch('touchEnd')
    await waitFor('native touch scroll', 1500, () => evaluate('p.shown() && p.scroller.scrollTop > 160'))
    console.log('PASS native touch scroll reveals the keys')
    await settleScroll()
    await evaluate('p.history.limit = 5; p.history.held = true; p.scroller.scrollTop = 190; true')
    await frame()
    const beforeTimeout = await evaluate('[p.calls.length, p.scroller.scrollTop]')
    await click('top')
    await waitFor('missing commit enters busy state', 800, () => evaluate('p.served() === 5 && p.key("top").disabled'))
    await evaluate('p.history.insertNonPrompt()')
    // Commit the real first prompt after the old per-page cap, but within the jump deadline.
    await evaluate('new Promise(resolve => setTimeout(() => resolve(true), 2700))')
    await check('a partial final page never treats the loaded head as the true first prompt',
      '[p.calls.length, p.scroller.scrollTop, p.served()]', [...beforeTimeout, 5])
    await evaluate('p.history.flush()')
    await landed('old5')
    await check('one top press waits for the late first prompt and lands', 'p.served()', 5)
    await evaluate('p.history.limit = 6; true')
    await frame()
    await click('top')
    await waitFor('page request is held before manual takeover', 800, () => evaluate('p.served() === 6 && p.key("top").disabled'))
    const callsBeforeTakeover = await evaluate('p.calls.length')
    await scroll(120)
    await waitFor('manual scrolling cancels the pending jump', 800, () => evaluate('!p.key("top").disabled && p.scroller.scrollTop > 0'))
    await evaluate('p.history.flush(); p.history.limit = 7; true')
    await frame()
    await check('late first prompt never scrolls after manual takeover', 'p.calls.length', callsBeforeTakeover)
    await click('top')
    await waitFor('page request is held while tab leaves', 800, () => evaluate('p.served() === 7 && p.key("top").disabled'))
    const callsBeforeSwitch = await evaluate('p.calls.length')
    const detachedChat = await evaluate(`(() => {
      const chat = p.scroller.firstElementChild
      p.switchView()
      window.returnToChat = () => p.scroller.prepend(chat)
      return !chat.isConnected
    })()`)
    assert.equal(detachedChat, true)
    await frame()
    await check('switching tabs detaches keys from the resident scrollport', 'p.cluster() === null', true)
    await evaluate('p.history.flush()')
    await frame()
    await check('late history commit never writes into the departed view', 'p.calls.length', callsBeforeSwitch)
    await evaluate('returnToChat()')
    await frame()
    await check('returning to Chat mounts hidden keys', '[p.cluster()?.childElementCount, p.shown()]', [4, false])
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await evaluate('p.scroller.scrollTop = 0')
    await frame()
    const left = await evaluate('p.cluster().getBoundingClientRect().left')
    await scroll(110)
    await waitFor('reduced-motion viewport actually scrolls', 1200, () => evaluate('p.scroller.scrollTop > 0'))
    await check('reduced motion reveals without a slide or fade', `
      [p.shown(), p.cluster().getBoundingClientRect().left, getComputedStyle(p.cluster()).transitionProperty]`, [true, left, 'none'])
    await click('next')
    await check('reduced motion jump reaches the next question without animation',
      '[p.landed(), p.calls.at(-1)?.behavior, p.cueCount("old6")]', ['old6', 'instant', 0])
    await send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await waitFor('chat jump desktop detach', 2000, () => evaluate('p.cluster() === null'))
    console.log('PASS desktop removes the keys')
    await check('no page errors', 'p.errors', [])
    assert.equal(failures, 0, 'failed browser assertions')
  } finally {
    ws.close()
  }
} })
process.exitCode = ok ? 0 : 1
}
