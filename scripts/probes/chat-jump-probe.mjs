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
        <div id="fixture-header" style="height:64px;position:relative;z-index:30;background:white">Header</div>
        <div data-conversation-session="s1" style="position:relative;height:480px">
          <div data-conversation-scroll class="fixture_scrollBody" style="height:100%;overflow:auto">
            <div class="EvIC1a_frame"><div data-chat-flow style="padding-top:6px"></div>
              <div class="EvIC1a_toBottomSlot"><button class="EvIC1a_toBottom">Tail</button></div>
            </div>
            <div data-composer-seat style="height:150px"></div>
          </div>
        </div>
      </div>
    </div>`
  const root = document.querySelector('[data-conversation-session]')
  const scroller = root.querySelector('[data-conversation-scroll]')
  const flow = scroller.querySelector('[data-chat-flow]')
  const turn = (key) => `<div style="height:120px" data-chat-flow-kind="user" data-chat-flow-key="${key}">${key}</div>
    <div style="height:450px" data-chat-flow-kind="turn-process">Reply</div>`
  flow.innerHTML = ['u0', 'u1', 'u2', 'u3'].map(turn).join('') +
    '<div hidden><div data-chat-flow-kind="user" data-chat-flow-key="hidden">Hidden</div></div>'
  const tailButton = scroller.querySelector('button')
  let returned = 0
  tailButton.onclick = () => {
    returned += 1
    scroller.scrollTop = scroller.scrollHeight
    tailButton.remove()
  }

  let served = 0
  const session = {
    getSnapshot: () => ({ hasMore: served < 3 }),
    // Resolve the service call before the browser sees the new rows.
    loadOlder: async () => {
      served += 1
      const key = 'old' + served
      requestAnimationFrame(() => flow.insertAdjacentHTML('afterbegin', turn(key)))
    },
  }
  const ctx = {
    effect: (run) => run(),
    locale: { bind: () => (key) => key },
    sessions: { binding: (id) => id === 's1' ? { session } : undefined },
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
    errors, scroller, root, cluster,
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
      fixtureScript.replaceAll('</script', '<\\/script') + '</script>')
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
    const scroll = (deltaY) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 120, y: 120, deltaX: 0, deltaY })
    const frame = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await evaluate(`window.p = (${mountFixture})(${JSON.stringify(source)}); true`)
    await check('four keys mounted outside the scrolling content', 'p.cluster()?.parentElement === p.root && p.cluster().childElementCount === 4', true)
    await check('initially hidden and click-through', '[p.shown(), getComputedStyle(p.cluster()).pointerEvents]', [false, 'none'])
    await tap(120, 120)
    await check('a tap without scrolling keeps the keys hidden', 'p.shown()', false)
    await scroll(110)
    await frame()
    await check('wheel scroll reveals the keys', 'p.shown()', true)
    await check('right edge stays clear of the touch targets', `
      !document.elementFromPoint(innerWidth - 2, p.cluster().getBoundingClientRect().top + 16)
        ?.closest('[data-mobile-nav="chat-jump"]')`, true)
    await click('next')
    await check('next lands on the following user row', 'p.landed()', 'u1')
    await click('next')
    await check('consecutive next advances one more row', 'p.landed()', 'u2')
    await click('prev')
    await check('prev steps back one row', 'p.landed()', 'u1')
    await click('prev')
    await check('prev reaches the first loaded user row', 'p.landed()', 'u0')
    await click('prev')
    await frame()
    await check('prev can step across a page boundary', '[p.served(), p.landed()]', [1, 'old1'])
    await click('top')
    await waitFor('first prompt after two more pages', 1500, () => evaluate('p.landed() === "old3"'))
    await check('top pages in and lands on the earliest user row', '[p.served(), p.landed()]', [3, 'old3'])
    await click('bottom')
    await check('bottom invokes the host action and reaches the tail', '[p.returned(), p.scroller.scrollTop === p.scroller.scrollHeight - p.scroller.clientHeight]', [1, true])
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
    const detachedChat = await evaluate(`(() => {
      const chat = p.scroller.firstElementChild
      p.switchView()
      window.returnToChat = () => p.scroller.prepend(chat)
      return !chat.isConnected
    })()`)
    assert.equal(detachedChat, true)
    await frame()
    await check('switching tabs detaches keys from the resident scrollport', 'p.cluster() === null', true)
    await evaluate('returnToChat()')
    await frame()
    await check('returning to Chat mounts hidden keys', '[p.cluster()?.childElementCount, p.shown()]', [4, false])
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
