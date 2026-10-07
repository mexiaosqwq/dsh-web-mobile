// Composer paperclip (owner report 2026-10-06): the system file picker is the
// wrong shape and cannot pick "images only", so composer-file-picker.ts opens a
// plugin-owned two-option sheet and hands the choice back to the host's hidden
// input (accept is written per route — image/* or */* — and restored right after
// click). These tests pin the accept mapping, the wiring, and the handoff.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptForKind } from '../src/client/effects/composer-file-picker.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/composer-file-picker.ts'), 'utf8')
const BUTTON = readFileSync(join(ROOT, 'src/client/components/ComposerFileButton.tsx'), 'utf8')
const BASE_CSS = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')

test('only the image route writes accept; attachments leave the host input untouched', () => {
  assert.equal(acceptForKind('image'), 'image/*')
  // 2026-10-07 试过给附件路写显式全通配 accept，真机形态没变 ⇒ 那是 App 侧 Intent 语义，
  // 已回退（不给宿主 input 写多余的 accept）。
  assert.equal(acceptForKind('file'), '')
})

test('the effect is mobile-gated, capture-phase, and disposes both listeners', () => {
  assert.match(SRC, /installMobileEffect\(ctx, 'dsh-web-mobile: composer file picker'/)
  assert.match(SRC, /addEventListener\('click', onClick, true\)/)
  assert.match(SRC, /removeEventListener\('click', onClick, true\)/)
  assert.match(SRC, /removeEventListener\('keydown', onKey, true\)/)
})

test('the sheet is built from the two kinds and mounted on document.body', () => {
  assert.match(SRC, /kind: 'image'/)
  assert.match(SRC, /kind: 'file'/)
  assert.match(SRC, /document\.body\.append\(backdrop\)/)
  // 挂在 body 而不是 frame 里：frame 内的点击会被第三方 dismiss shim 吞掉
  // （与 session-menu.ts 的 delete-dialog 同一取舍）。
  assert.doesNotMatch(SRC, /getFrame\(\)\?\.append/)
})

test('accept is written for the image route and always restored after click', () => {
  const body = SRC.slice(SRC.indexOf('function openHostPicker'))
  const set = body.indexOf("input.setAttribute('accept', accept)")
  const click = body.indexOf('input.click()')
  const restore = body.indexOf("input.removeAttribute('accept')")
  assert.ok(set > -1 && click > set && restore > click, 'set → click → restore order')
  assert.match(body, /const hadAccept = input\.hasAttribute\('accept'\)/)
  assert.match(body, /if \(hadAccept\) input\.setAttribute\('accept', priorAccept \?\? ''\)/)
})

test('the sheet is positioned BEFORE it is shown, so the keyboard-collapse reflow cannot make it jump (2026-10-07)', () => {
  // 店主原话：「点击回形针弹出来的两个选项，会弹一下」——点回形针会让软键盘收起，
  // 视口在随后约 200ms 内持续变化；按旧坐标立刻画出来就会「先出现在键盘上方、再跳一次」。
  // 所以隐藏挂载（visibility 不参与布局、仍能量尺寸），连续两帧位置相同再显形。
  assert.match(SRC, /sheet\.style\.visibility = 'hidden'/)
  assert.match(SRC, /const reveal = \(\): void => \{/)
  assert.match(SRC, /revealed = true\n    sheet\.style\.visibility = ''/)
  assert.match(SRC, /if \(stableFrames >= 2\) reveal\(\)/)
  // 兜底：rAF 停摆（后台标签页）或 follow 跑完时也必须显形，不能永远藏着。
  assert.match(SRC, /const revealTimer = window\.setTimeout\(reveal, 400\)/)
  assert.match(SRC, /teardown\.push\(\(\) => window\.clearTimeout\(revealTimer\)\)/)
  assert.match(SRC, /if \(\+\+frames < 12\) raf = requestAnimationFrame\(follow\)\n    else reveal\(\)/)
})

test('it is an anchored popover, not a full-width bottom sheet (owner feedback 2026-10-06)', () => {
  // 定位来自回形针自身的 rect：上方优先、夹进视口；必须先挂载再量自身尺寸。
  assert.match(SRC, /trigger\.getBoundingClientRect\(\)/)
  assert.match(SRC, /sheet\.getBoundingClientRect\(\)/)
  assert.match(SRC, /sheet\.style\.top = /)
  assert.match(SRC, /sheet\.style\.left = /)
  assert.ok(
    SRC.indexOf('document.body.append(backdrop)') < SRC.indexOf('const own = sheet.getBoundingClientRect()'),
    'measure the sheet only after it is mounted',
  )
  // 没有独立「取消」行：点浮层外或返回键关闭。
  assert.doesNotMatch(SRC, /file-picker-cancel/)
})

test('the entry button no longer drives the host input itself (single picker path)', () => {
  assert.match(BUTTON, /data-mobile-nav="file-upload"/)
  assert.doesNotMatch(BUTTON, /input\.click\(\)/)
  assert.doesNotMatch(BUTTON, /querySelector<HTMLInputElement>/)
  assert.match(BUTTON, /disabled=\{disabled\}/)
})

test('the popover re-anchors when the viewport changes (owner report 2026-10-07)', () => {
  // 真机报障：先点输入框（键盘弹起）再点回形针 → 键盘收起 → 布局整体下移一个键盘高，
  // 只在打开时算一次坐标的 fixed 浮层会停在会话中部（离回形针 ≈350px）。
  assert.match(SRC, /window\.addEventListener\('resize', onViewport\)/)
  assert.match(SRC, /window\.addEventListener\('orientationchange', onViewport\)/)
  assert.match(SRC, /window\.visualViewport\?\.addEventListener\('resize', onViewport\)/)
  assert.match(SRC, /window\.visualViewport\?\.addEventListener\('scroll', onViewport\)/)
  // 键盘动画是渐进的：开完还要跟若干帧。
  assert.match(SRC, /requestAnimationFrame\(function follow\(\)/)
  // 关闭时必须把监听与 rAF 全部摘掉，否则浮层关了还在算坐标。
  assert.match(SRC, /for \(const off of teardown\.splice\(0\)\) off\(\)/)
  assert.match(SRC, /cancelAnimationFrame\(raf\)/)
  assert.match(SRC, /removeEventListener\('resize', onViewport\)/)
  // 锚点已被 React 换掉时不留一个飘着的浮层。
  assert.match(SRC, /if \(!trigger\.isConnected\)/)
})

test('the two rows sit tight and the sheet frame is slim (owner feedback 2026-10-07)', () => {
  // 取「带 position: fixed 的那条」浮层规则 —— 同名的 reduced-motion 规则排在它前面，
  // 那里没有 gap/padding 声明。
  const sheetStart = BASE_CSS.indexOf('[data-mobile-nav="file-picker"] {\n  position: fixed;')
  assert.ok(sheetStart > -1, 'the positioned sheet rule is present')
  const sheet = BASE_CSS.slice(sheetStart, BASE_CSS.indexOf('}', sheetStart))
  assert.match(sheet, /gap: 0;/)
  assert.match(sheet, /padding: 5px;/)
  // 宽度贴内容，不许再回到固定 168px 起步（右侧会留一大块空白）。
  assert.match(sheet, /width: max-content;/)
  assert.doesNotMatch(sheet, /min-width: 168px/)
  const optionStart = BASE_CSS.indexOf('[data-mobile-nav="file-picker-option"] {')
  assert.ok(optionStart > -1, 'the option rule is present')
  const option = BASE_CSS.slice(optionStart, BASE_CSS.indexOf('}', optionStart))
  assert.match(option, /min-height: 34px;/)
})

test('unmounting and re-opening close the sheet through its own teardown (issue #83)', () => {
  // 浮层打开的 5 个持久监听（keydown + resize + orientationchange + visualViewport
  // 的 resize/scroll）只在 close() 里摘。效果卸载原先只删节点，于是每次手机档 ↔
  // 桌面档切换、或插件热重载，都会留下一套还在找浮层的监听。
  assert.match(SRC, /let activeClose: \(\(\) => void\) \| null = null/)
  // 卸载：先走 close（摘监听 + rAF + 计时器），再删节点。
  const disposer = SRC.slice(SRC.indexOf("document.removeEventListener('click', onClick, true)"))
  assert.match(disposer, /activeClose\?\.\(\)/)
  assert.ok(
    disposer.indexOf('activeClose?.()') < disposer.indexOf('file-picker-backdrop'),
    'teardown must run before the node is dropped',
  )
  // 重开：上一张也必须走 close，不能只 remove() 节点（同一条泄漏路径）。
  assert.match(SRC, /activeClose\?\.\(\)\n  activeClose = null/)
  assert.match(SRC, /if \(activeClose === close\) activeClose = null/)
})
