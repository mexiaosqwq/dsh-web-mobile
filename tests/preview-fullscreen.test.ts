// 预览全屏切换按钮（preview-fullscreen-toggle）与 suite 自行收起预览列时的标记
// 清理（preview-close-sync）——评审 #6723001340 钉两件事：
//
//  1. `ensure()` 的 `!isOpen()` 早退是纯逻辑：开标记在场 → 按钮挂进预览列；标记
//     清掉 → 同一次 ensure 必须把按钮摘除。手机档开标记在带标记的 frame 上，
//     平板档（≥1024 粗指针）没有带标记的 frame，`<html>` 标记是唯一开态来源
//     （getFrame() 在平板回落到未标记的壳 frame，所以判定只认标记本身）。
//  2. `createPreviewCloseTask` 在 suite 用 inline visibility 自行收列（切 / 关
//     标签，不走 _panelCollapse 点击）时，必须把 frame 与 `<html>` 两个 owner
//     的标记都清掉：共享 reconciler 只在 MOBILE_QUERY 武装，这条任务是平板上
//     唯一的 suite 侧清理路径；少清一边，fullscreen overlay（fixed + inset:0 +
//     z-index:56）与 `body { overflow: hidden }` 就留屏，页面滚动锁死。
//  3. 评审 #6872117016 补第三条生命周期：suite 不写 inline visibility、直接把
//     开着的列摘掉（卸载 / 换节点）时，close-sync 必须放掉标记 —— 平板的
//     `body { overflow: hidden }` 只认 `<html>` 标记，列没了锁也留着。用闩
//     （「见过挂载着的开列」）区分两种列缺席：「还没挂载」（tap 先于列挂载，
//     标记必须活着）与「开着时被摘」（放掉标记）；列在场但已关会重置闩，
//     上一轮会话的旧闩不许吃掉重开时新打的标记。
//
// 平板档的武装（tablet close-sync effect 与两条 tap 路径的 spoof）在 Node 里跑
// 不动（installMobileEffect 需要 matchMedia），用源码断言钉住。
//
// 源码断言 + 一个最小 DOM 桩（Node 没有 document）：桩只实现两个 task 用到的
// querySelector / createElement / documentElement / 标记读写 / 挂载 / style。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPreviewCloseTask } from '../src/client/effects/aionui-compat.ts'
import { createPreviewFullscreenTask } from '../src/client/effects/preview-fullscreen.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'src/client/effects/aionui-compat.ts'), 'utf8')

/** Source with comments blanked: prose may name the identifiers the assertions
 * pin, and only executable text may satisfy a source assertion. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Minimal element stub: only what the two tasks touch. */
class FakeElement {
  tagName: string
  dataset: Record<string, string> = {}
  attrs: Record<string, string> = {}
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  innerHTML = ''
  title = ''
  type = ''
  isConnected = true
  style = { visibility: '' }
  private listeners: Record<string, Array<() => void>> = {}

  constructor(tagName: string) {
    this.tagName = tagName
  }

  addEventListener(name: string, fn: () => void): void {
    (this.listeners[name] ??= []).push(fn)
  }

  fire(name: string): void {
    for (const fn of this.listeners[name] ?? []) fn()
  }

  setAttribute(key: string, value: string): void {
    this.attrs[key] = value
  }

  getAttribute(key: string): string | null {
    return this.attrs[key] ?? null
  }

  removeAttribute(key: string): void {
    delete this.attrs[key]
  }

  hasAttribute(key: string): boolean {
    return key in this.attrs
  }

  toggleAttribute(key: string): boolean {
    if (key in this.attrs) {
      delete this.attrs[key]
      return false
    }
    this.attrs[key] = ''
    return true
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  remove(): void {
    if (this.parentElement === null) return
    this.parentElement.children = this.parentElement.children.filter((entry) => entry !== this)
    this.parentElement = null
  }
}

type Harness = {
  frame: FakeElement | null
  col: FakeElement
  html: FakeElement
  /** Every element the fixture created; restore() disconnects them so the
   * memoized frame cache in platform/frame.ts cannot leak across tests. */
  all: FakeElement[]
  /** Toggle the column's presence in the document, simulating the suite
   * unmounting / re-mounting the preview column mid-session. */
  setColPresent: (present: boolean) => void
  restore: () => void
}

/** Install a fake document. `frame: false` = tablet: no marked frame anywhere
 * (getFrame() falls through findFrame() to null), so `<html>` is the owner.
 * `col: false` = the preview column is not mounted at all. */
function installHarness(
  { frame = true, col = true, coarse = true }: { frame?: boolean; col?: boolean; coarse?: boolean } = {},
): Harness {
  const html = new FakeElement('html')
  const shellFrame = frame ? new FakeElement('div') : null
  if (shellFrame !== null) shellFrame.attrs['data-mobile-nav'] = 'frame'
  const colEl = new FakeElement('div')
  const state = { colPresent: col }
  const all: FakeElement[] = frame ? [html, shellFrame!, colEl] : [html, colEl]
  const harness: Harness = {
    frame: shellFrame,
    col: colEl,
    html,
    all,
    setColPresent: (present: boolean) => {
      state.colPresent = present
    },
    restore: () => {},
  }
  const previousDocument = (globalThis as { document?: unknown }).document
  const previousWindow = (globalThis as { window?: unknown }).window
  const g = globalThis as Record<string, unknown>
  g.document = {
    documentElement: html,
    querySelector: (selector: string) => {
      if (selector === '[data-mobile-nav="frame"]') return shellFrame
      if (selector === '[data-aionui-preview-col]') return state.colPresent ? colEl : null
      return null // findFrame()'s [data-shell-overlay] probe: tablet falls to null
    },
    createElement: (tagName: string) => {
      const el = new FakeElement(tagName)
      all.push(el)
      return el
    },
  }
  g.window = { matchMedia: (query: string) => ({ matches: coarse && /pointer: coarse/.test(query) }) }
  harness.restore = () => {
    for (const el of all) el.isConnected = false
    g.document = previousDocument
    g.window = previousWindow
  }
  return harness
}

/** The fullscreen task with a pass-through label function, mounted once. */
function fullscreenTask(): ReturnType<typeof createPreviewFullscreenTask> {
  return createPreviewFullscreenTask(((key: string) => key) as Parameters<typeof createPreviewFullscreenTask>[0])
}

const buttonIn = (col: FakeElement): FakeElement | undefined =>
  col.children.find((child) => child.dataset.mobileNav === 'preview-full-toggle')

test('marker present -> button mounts into the preview column (mobile frame path)', () => {
  const harness = installHarness()
  try {
    harness.frame!.attrs['data-aionui-preview-open'] = ''
    const task = fullscreenTask()
    task.ensure()
    const button = buttonIn(harness.col)
    assert.ok(button !== undefined, 'the open marker must mount the toggle')
    assert.equal(button.getAttribute('aria-label'), 'previewFullscreen')
    assert.match(button.innerHTML, /<svg /)
    // Idempotent across passes (the reconciler wakes it on every flush).
    task.ensure()
    assert.equal(buttonIn(harness.col), button, 'a second pass must keep the same button')
  } finally {
    harness.restore()
  }
})

test('marker cleared -> the same ensure removes the button (!isOpen early return)', () => {
  const harness = installHarness()
  try {
    harness.frame!.attrs['data-aionui-preview-open'] = ''
    const task = fullscreenTask()
    task.ensure()
    assert.ok(buttonIn(harness.col) !== undefined)
    harness.frame!.removeAttribute('data-aionui-preview-open')
    task.ensure()
    assert.equal(buttonIn(harness.col), undefined, 'a cleared marker must take the button back off')
  } finally {
    harness.restore()
  }
})

test('tablet path: no marked frame, <html> carries the marker -> button mounts; cleared -> removed', () => {
  const harness = installHarness({ frame: false })
  try {
    assert.equal(harness.frame, null)
    harness.html.attrs['data-aionui-preview-open'] = ''
    const task = fullscreenTask()
    task.ensure()
    assert.ok(buttonIn(harness.col) !== undefined, 'the <html> marker is the only open signal on tablet')
    harness.html.removeAttribute('data-aionui-preview-open')
    task.ensure()
    assert.equal(buttonIn(harness.col), undefined)
  } finally {
    harness.restore()
  }
})

test('close-sync clears both owners only when the suite hides the column itself', () => {
  const harness = installHarness()
  try {
    for (const owner of [harness.frame!, harness.html]) {
      owner.attrs['data-aionui-preview-open'] = ''
      owner.attrs['data-mobile-preview-full'] = ''
    }
    const task = createPreviewCloseTask()
    // Column rendered and visible: a tap just opened the preview — the suite has
    // not closed anything, so the task must not undo the markers (it is
    // deliberately scoped to the inline visibility, not to the open marker).
    task.ensure()
    assert.equal(harness.frame!.hasAttribute('data-aionui-preview-open'), true, 'visible col: frame markers stay')
    assert.equal(harness.html.hasAttribute('data-mobile-preview-full'), true, 'visible col: html markers stay')
    // The suite hides the column on its own (tab switch / tab close).
    harness.col.style.visibility = 'hidden'
    task.ensure()
    assert.equal(harness.frame!.hasAttribute('data-aionui-preview-open'), false, 'hidden col: frame marker cleared')
    assert.equal(harness.frame!.hasAttribute('data-mobile-preview-full'), false, 'hidden col: frame overlay marker cleared')
    assert.equal(harness.html.hasAttribute('data-aionui-preview-open'), false, 'hidden col: html marker cleared')
    assert.equal(harness.html.hasAttribute('data-mobile-preview-full'), false, 'hidden col: html overlay marker cleared')
  } finally {
    harness.restore()
  }
})

test('close-sync clears the <html> markers with no frame at all (tablet)', () => {
  const harness = installHarness({ frame: false })
  try {
    harness.html.attrs['data-aionui-preview-open'] = ''
    harness.html.attrs['data-mobile-preview-full'] = ''
    harness.col.style.visibility = 'hidden'
    createPreviewCloseTask().ensure()
    assert.equal(harness.html.hasAttribute('data-aionui-preview-open'), false)
    assert.equal(harness.html.hasAttribute('data-mobile-preview-full'), false)
  } finally {
    harness.restore()
  }
})

// 「还没挂载」：全新任务没见过挂载着的开列，列缺席只是 tap 先于挂载的正常
// 窗口——标记必须活着，否则一打标记就被冲掉（这也是任务只认 inline visibility、
// 不认开标记的原因）。
test('close-sync pays nothing while the column has never mounted (not mounted yet)', () => {
  const harness = installHarness({ frame: false, col: false })
  try {
    harness.html.attrs['data-mobile-preview-full'] = ''
    createPreviewCloseTask().ensure()
    assert.equal(harness.html.hasAttribute('data-mobile-preview-full'), true, 'no column: nothing to close, markers stay')
  } finally {
    harness.restore()
  }
})

// 评审 #6872117016 的回归链（平板 fixture 同款）：开 fullscreen → suite 不写
// inline visibility，直接把开着的列摘掉 → close-sync 必须放掉两个 <html> 标记
// （body 的滚动锁只认标记，列没了锁也留着），fullscreen 的下一次 ensure 摘按钮。
test('close-sync releases the markers when the suite unmounts an open fullscreen column', () => {
  const harness = installHarness({ frame: false })
  try {
    harness.html.attrs['data-aionui-preview-open'] = ''
    harness.html.attrs['data-mobile-preview-full'] = ''
    const fullscreen = fullscreenTask()
    const closeSync = createPreviewCloseTask()
    fullscreen.ensure()
    closeSync.ensure() // latches "open column seen"
    assert.ok(buttonIn(harness.col) !== undefined)
    // The suite takes the column away without any inline visibility write.
    harness.setColPresent(false)
    closeSync.ensure()
    assert.equal(harness.html.hasAttribute('data-aionui-preview-open'), false, 'removed after opening: open marker must go')
    assert.equal(harness.html.hasAttribute('data-mobile-preview-full'), false, 'removed after opening: fullscreen marker must go (the body lock keys on it)')
    fullscreen.ensure()
    assert.equal(buttonIn(harness.col), undefined, 'and the fullscreen task must take the button off')
  } finally {
    harness.restore()
  }
})

// 放掉一次之后闩已被消耗：重新打标记而列仍未挂载（新一轮 tap）不许再被清。
test('after a release, a fresh open marker with the column still absent survives', () => {
  const harness = installHarness({ frame: false })
  try {
    harness.html.attrs['data-aionui-preview-open'] = ''
    harness.html.attrs['data-mobile-preview-full'] = ''
    const closeSync = createPreviewCloseTask()
    closeSync.ensure() // latch
    harness.setColPresent(false)
    closeSync.ensure() // release; latch consumed
    assert.equal(harness.html.hasAttribute('data-mobile-preview-full'), false)
    // New tap: the marker leads the column again until the suite mounts it.
    harness.html.setAttribute('data-aionui-preview-open', '')
    closeSync.ensure()
    assert.equal(harness.html.hasAttribute('data-aionui-preview-open'), true, 'not mounted yet: the fresh marker must survive')
  } finally {
    harness.restore()
  }
})

// 列在场但已关会重置闩：收起（标记清掉、列还挂着）→ 重打标记 → 列被换掉的
// 窗口里，旧闩不许把新标记当成「被摘」清掉。
test('a closed column resets the latch, so a re-tap marker survives a column swap window', () => {
  const harness = installHarness({ frame: false })
  try {
    harness.html.attrs['data-aionui-preview-open'] = ''
    const closeSync = createPreviewCloseTask()
    closeSync.ensure() // latch: present + open
    // Collapse clears the markers; the column stays mounted and visible.
    harness.html.removeAttribute('data-aionui-preview-open')
    closeSync.ensure() // resets the latch
    // Re-tap sets the marker again before the suite swaps the column out.
    harness.html.attrs['data-aionui-preview-open'] = ''
    harness.setColPresent(false)
    closeSync.ensure()
    assert.equal(harness.html.hasAttribute('data-aionui-preview-open'), true, 'a stale latch must not clear the fresh marker')
  } finally {
    harness.restore()
  }
})

// 评审复现链（平板）：开标记 + 按钮已挂 → suite 自己收列 → close-sync 清 <html>
// 标记 → fullscreen 的下一次 ensure 摘按钮。少掉中间任何一环，本用例必须红。
test('tablet repro chain: suite hides the column, the markers and the button both go', () => {
  const harness = installHarness({ frame: false })
  try {
    harness.html.attrs['data-aionui-preview-open'] = ''
    const fullscreen = fullscreenTask()
    const closeSync = createPreviewCloseTask()
    fullscreen.ensure()
    assert.ok(buttonIn(harness.col) !== undefined)
    // The suite closes the preview without the collapse chevron.
    harness.col.style.visibility = 'hidden'
    closeSync.ensure()
    assert.equal(harness.html.hasAttribute('data-aionui-preview-open'), false, 'close-sync must clear the marker')
    fullscreen.ensure()
    assert.equal(buttonIn(harness.col), undefined, 'and the fullscreen button must come off')
  } finally {
    harness.restore()
  }
})

// ── 源码断言：平板档武装与 spoof 平价（installMobileEffect 在 Node 里跑不动）──

test('the tablet close-sync is armed under TABLET_TOUCH_QUERY with a style observer', () => {
  assert.match(CODE, /'dsh-web-mobile: tablet preview close sync'/)
  // The shared reconciler only arms under MOBILE_QUERY, so the close-sync must
  // carry its own observer — scoped to the inline style writes, like the two
  // sibling tablet effects.
  assert.match(
    CODE,
    /'dsh-web-mobile: tablet preview close sync'[\s\S]*?attributeFilter: \['style'\][\s\S]*?TABLET_TOUCH_QUERY/,
  )
  assert.match(CODE, /const task = createPreviewCloseTask\(\)/)
})

test('both tap paths spoof the navigator and restore it on disposal', () => {
  assert.match(CODE, /function createNavigatorSpoof\(/)
  assert.equal(CODE.match(/spoofDesktop\(\)/g)?.length, 2, 'mobile and tablet onTap must both spoof')
  assert.equal(CODE.match(/restoreNavigator\(\)/g)?.length, 2, 'both disposals must restore')
  // Spoof lands before the marker on the tablet path, same order as mobile.
  assert.match(CODE, /spoofDesktop\(\)\s*document\.documentElement\.setAttribute\('data-aionui-preview-open', ''\)/)
})
