import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { NS } from '../i18n/locales.ts'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * 手机档：输入框回形针 → 「上传图片 / 上传附件」两选弹层。
 *
 * 背景（2026-10-06 报障：「输入框中的文件上传打开的界面不行……点击输入框的回形针，
 * 会弹出上传图片，上传附件两个选项」）：`ComposerFileButton` 直接点宿主的隐藏
 * `input[type=file]`，Android WebView 于是弹系统文件选择器 —— 形态由系统决定，
 * 插件控制不了，也没有「只挑图片」这条路。
 *
 * 修法：插件自绘一个小浮层给两个选项，选完把点击交回宿主那个 hidden input
 * （`input.click()`），只给图片那一路临时写 image 通配 accept（click 返回后立刻
 * 还原；附件那路不动属性）—— 系统选择器在 click 的同一次调用里读走 accept，所以还原不影响已弹出的
 * 选择器；校验、上传、可用性策略、草稿生成全部仍是宿主的 intake，插件不另起一套。
 *
 * 形态归属（2026-10-08 结论，已提 DSH-APP/DSHA#101）：「上传附件」弹出来的是安卓文件管理
 * 还是系统「打开方式」列表，**只由 App 侧 `WebChromeClient.onShowFileChooser` 决定** ——
 * 现在那是 `params.createIntent()` 直接 launch，没有 `Intent.createChooser`，所以默认处理者
 * （文件管理）直接接管。插件能改的只有 accept，而「全通配 accept」与「不写 accept」生成的 Intent 完全
 * 一致（2026-10-07 店主真机实测「形态没变」），因此这条路插件换不出 chooser。
 *
 * 三路并存（按可用性排序，都是宿主 intake，不另起一套）：
 *   1. App 侧给了 `window.DSHA.pickFile` 桥 → 走桥（原生自己弹「打开方式」），文件以 `File[]`
 *      回来，写进宿主 hidden input 再派发 `change`；
 *   2. 没有桥但 App 侧合入了 #101 的补丁 → 仍走 hidden input，系统这次会弹 chooser；
 *   3. 以上都没有 → 现状（系统文件管理），行为与今天一致。
 * 图片那一路不上桥：宿主 input + `accept="image/*"` 已经是「只挑图片」，桥反而可能带回通用选择器。
 *
 * DOM 契约（0.2.0-rc.2 核对）：入口 `[data-mobile-nav="file-upload"]` 由
 * components/ComposerFileButton.tsx 渲染（官方 `conversation.input.left` 槽）；
 * 宿主 input 在 `[data-composer-card]` 内，选择器 `input[type=file]`（0.1.6 起宿主
 * 删掉了自己的回形针按钮，只留这个隐藏 input，其「文件」菜单项也是这么点的）。
 * 弹层挂 `document.body`（与 session-menu.ts 同一取舍：挂在 frame 里会被第三方
 * dismiss shim 的捕获期点击链吞掉）。宿主恢复自带的两选项入口后可整体删除本效果。
 */

/** 回形针入口按钮。 */
const TRIGGER_SELECTOR = '[data-mobile-nav="file-upload"]'
/** composer 卡片：宿主 hidden input 在其中。 */
const CARD_SELECTOR = '[data-composer-card]'
/** 宿主真正接收文件的 input —— 插件不另起 intake。 */
const HOST_INPUT_SELECTOR = 'input[type=file]'

/**
 * 当前打开着的那张浮层的 close（一次只会有一张）。
 *
 * 存在的理由：效果的 disposer 与「再点一次回形针」都必须走 close 才能把
 * keydown / resize / orientationchange / visualViewport(resize+scroll) 这几个
 * 持久监听和 rAF 链一起摘掉；只 remove() 节点会把这些监听留在 document/window 上，
 * 每次手机档 ↔ 桌面档切换（或插件热重载）叠一套，回调还在找已经不在的浮层。
 */
let activeClose: (() => void) | null = null

/** 两个选项：图片走 image 通配，附件优先走桥（见文件头「三路并存」）。 */
export type FilePickerKind = 'image' | 'file'

/**
 * 选项对应的 accept（空串 = 不改宿主 input 的属性）。
 *
 * 2026-10-07 实验记录（已回退）：曾给附件那路显式写全通配 accept，想验证「空的
 * acceptTypes」是不是让 DSHA 起了文档选择器（DownloadsUI）而不是店主想要的
 * 「打开方式」+ 应用列表。店主真机实测**形态没变**。
 * 2026-10-08 补上根因：`WebPreviewActivity.onShowFileChooser` 是
 * `params.createIntent()` 直接 launch，少包一层 `Intent.createChooser`，而「全通配 accept」
 * 与「不写 accept」生成的 Intent 完全一致 ⇒ 插件只能影响 accept、换不出 chooser 形态。
 * 已提 DSH-APP/DSHA#101；桥（`window.DSHA.pickFile`）落地后附件那路改走桥。
 * 所以这里仍是「不改属性」，不给宿主 input 写多余的 accept。
 * @param kind - 用户选择的入口。
 * @returns 要临时写到宿主 input 上的 accept；空串表示不动该属性。
 */
export function acceptForKind(kind: FilePickerKind): string {
  return kind === 'image' ? 'image/*' : ''
}

/** 本效果用到的两条文案（不把 locales 的类型拖进 effects 层）。 */
type PickerTranslate = (
  key: 'fileUploadImage' | 'fileUploadAttachment',
) => string

/**
 * App 侧文件选择桥（DSH-APP/DSHA#101 的备选方案）。
 *
 * 命名空间与插件已经在用的分享桥（`window.DSHA.canShareFile` / `shareFile`）一致；
 * 这里只声明本效果用得到的那一个方法，缺方法就当作没有桥（半实现的桥不能把附件路带进死胡同）。
 */
export interface DshaPickFileBridge {
  pickFile?: (options: DshaPickFileOptions) => Promise<unknown>
}

/** 桥的入参：accept 空数组 = 不限类型（与宿主 hidden input 不写 accept 等价）。 */
export interface DshaPickFileOptions {
  accept: string[]
  multiple: boolean
  title: string
}

/** 桥的结果分类：拿到文件 / 用户取消 / 该回落宿主 input。 */
export type BridgePickOutcome = 'files' | 'cancelled' | 'fallback'

/**
 * 取出可用的 `pickFile`（绑定好 this）；没有桥或方法不是函数时返回 undefined。
 * @param bridge - `window.DSHA`。
 * @returns 可直接调用的桥方法。
 */
export function bridgePickFile(
  bridge: DshaPickFileBridge | undefined,
): ((options: DshaPickFileOptions) => Promise<unknown>) | undefined {
  return typeof bridge?.pickFile === 'function' ? bridge.pickFile.bind(bridge) : undefined
}

/**
 * 桥的返回值 → 可信的 `File` 列表（脏数据一律丢弃，不把非 File 塞进宿主 input）。
 * @param value - 桥的 resolve 值。
 * @returns 通过 `instanceof File` 的元素。
 */
export function pickResultFiles(value: unknown): File[] {
  return Array.isArray(value)
    ? value.filter((item): item is File => typeof File !== 'undefined' && item instanceof File)
    : []
}

/**
 * 桥的结果该走哪条路。
 *
 * 用户取消（`null` / `undefined` / 空数组）**不回落** —— 否则一次取消会紧接着弹出第二个
 * 选择器；桥抛错或返回脏数据才回落，宁可回落到现状也不能让按钮点了没反应。
 * @param value - 桥的 resolve 值。
 * @param failed - 桥是否抛错（Promise reject / 同步抛出）。
 * @returns 分类结果。
 */
export function classifyBridgeResult(value: unknown, failed: boolean): BridgePickOutcome {
  if (failed) return 'fallback'
  if (value === null || value === undefined) return 'cancelled'
  if (!Array.isArray(value)) return 'fallback'
  // 空数组 = 用户没选（原生侧通常这么回）；元素全不是 File = 桥返回了脏数据，回落到现状。
  if (value.length === 0) return 'cancelled'
  return pickResultFiles(value).length > 0 ? 'files' : 'fallback'
}

/** 宿主 hidden input（图片/附件两路唯一的 intake）。 */
function hostInput(): HTMLInputElement | null {
  const card = document.querySelector(CARD_SELECTOR)
  return card === null ? null : card.querySelector<HTMLInputElement>(HOST_INPUT_SELECTOR)
}

/**
 * 把桥挑好的文件交给宿主 intake：写进 hidden input 再派发 `change`。
 *
 * 与 `input.click()` 那条路是同一个入口 —— 校验、大小/数量策略、上传、草稿生成全部仍归宿主。
 * @param files - 桥返回的文件。
 * @returns 是否成功交给宿主（false 时调用方回落 `openHostPicker`）。
 */
export function handFilesToHost(files: File[]): boolean {
  const input = hostInput()
  if (input === null) return false
  try {
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    input.files = transfer.files
  } catch {
    return false
  }
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

/** 两个选项的行图标（内联静态 SVG，无用户数据）。 */
const IMAGE_ICON =
  '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" width="20" height="20">' +
  '<rect x="2.5" y="3.5" width="15" height="13" rx="2.5" stroke="currentColor" stroke-width="1.5"/>' +
  '<circle cx="7.2" cy="8" r="1.4" fill="currentColor"/>' +
  '<path d="M4.2 14.6l3.6-3.4 2.6 2.4 2.3-2.3 3.1 3.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'

const FILE_ICON =
  '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" width="20" height="20">' +
  '<path d="M12.6 3.2H6.4A1.9 1.9 0 0 0 4.5 5.1v9.8a1.9 1.9 0 0 0 1.9 1.9h7.2a1.9 1.9 0 0 0 1.9-1.9V6.6l-2.9-3.4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
  '<path d="M12.4 3.4v3.3h3.1" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
  '</svg>'

/**
 * 把点击交回宿主的 hidden input，按选项临时改 accept（两路都会写，click 返回后还原）。
 * @param kind - 用户选择的入口。
 */
function openHostPicker(kind: FilePickerKind): void {
  const card = document.querySelector(CARD_SELECTOR)
  const input = card === null ? null : card.querySelector<HTMLInputElement>(HOST_INPUT_SELECTOR)
  if (input === null) return
  const accept = acceptForKind(kind)
  const hadAccept = input.hasAttribute('accept')
  const priorAccept = input.getAttribute('accept')
  if (accept !== '') input.setAttribute('accept', accept)
  try {
    input.click()
  } finally {
    if (accept !== '') {
      if (hadAccept) input.setAttribute('accept', priorAccept ?? '')
      else input.removeAttribute('accept')
    }
  }
}

/**
 * 附件那一路：App 侧有 `pickFile` 桥就先走桥（原生自己弹「打开方式」），没有就回落宿主 input。
 *
 * 回落链：桥不存在 → 直接 `openHostPicker('file')`；桥抛错 / 返回脏数据 / 注入失败 →
 * 也回落（那时候 App 侧若已合入 #101，宿主 input 自己就会弹 chooser）。
 * @param t - 插件 `NS` 命名空间文案。
 */
export async function openAttachmentPicker(t: PickerTranslate): Promise<void> {
  const bridge = (window as unknown as { DSHA?: DshaPickFileBridge }).DSHA
  const pick = bridgePickFile(bridge)
  if (pick === undefined) {
    openHostPicker('file')
    return
  }
  let value: unknown = null
  let failed = false
  try {
    value = await pick({ accept: [], multiple: true, title: t('fileUploadAttachment') })
  } catch {
    failed = true
  }
  const outcome = classifyBridgeResult(value, failed)
  if (outcome === 'cancelled') return
  if (outcome === 'files' && handFilesToHost(pickResultFiles(value))) return
  openHostPicker('file')
}

/**
 * 弹出两选小浮层；已打开时先关掉旧的（幂等）。
 *
 * 形态（2026-10-06 店主反馈：「这个 UI 太丑了，缩小点，不要从底部弹出」）：
 * 不是整宽底部弹层，而是贴着回形针的小浮层 —— 宽度贴着内容（「max-content」，
 * 上限 min(78vw,240px)），行高 34px、间距 0、字号 14px，位置由触发按钮的 rect 算：
 * 优先落在按钮**上方** 8px，上方放不下才翻到下方，并夹进视口 8px 内边距。
 * 位置**每次视口变化都重算**（软键盘收起会整体下移一个键盘高，算一次的浮层会
 * 停在会话中部 —— 2026-10-07 真机报障）。
 * 无「取消」行：点浮层外或按返回键关闭（浮层外的透明遮罩只负责收点击）。
 * @param t - 插件 `NS` 命名空间文案。
 * @param trigger - 被点的回形针入口（定位锚点）。
 */
function openSheet(t: PickerTranslate, trigger: Element): void {
  // 关掉上一张浮层 —— 必须走它自己的 close（摘监听/rAF/计时器），
  // 只 remove() 节点会把监听留在 document/window 上（见下方的 disposer 注释）。
  activeClose?.()
  activeClose = null
  const backdrop = document.createElement('div')
  backdrop.dataset.mobileNav = 'file-picker-backdrop'
  const sheet = document.createElement('div')
  sheet.dataset.mobileNav = 'file-picker'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-label', t('fileUploadAttachment'))

  const rows: ReadonlyArray<{ kind: FilePickerKind; icon: string; label: string }> = [
    { kind: 'image', icon: IMAGE_ICON, label: t('fileUploadImage') },
    { kind: 'file', icon: FILE_ICON, label: t('fileUploadAttachment') },
  ]
  /** 打开期间挂上的监听/rAF，关闭时逐个摘掉。 */
  const teardown: Array<() => void> = []
  const close = (): void => {
    if (activeClose === close) activeClose = null
    for (const off of teardown.splice(0)) off()
    backdrop.remove()
  }
  activeClose = close
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }
  for (const row of rows) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.mobileNav = 'file-picker-option'
    button.dataset.kind = row.kind
    const icon = document.createElement('span')
    icon.dataset.mobileNav = 'file-picker-icon'
    icon.innerHTML = row.icon
    const label = document.createElement('span')
    label.textContent = row.label
    button.append(icon, label)
    button.addEventListener('click', () => {
      close()
      // 附件优先走桥（App 侧有的话），图片仍走宿主的 accept="image/*"。
      if (row.kind === 'file') void openAttachmentPicker(t)
      else openHostPicker(row.kind)
    })
    sheet.append(button)
  }
  // 只认浮层外的点按（浮层内的单击不关，避免选完立刻又被关闭）。
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })
  document.addEventListener('keydown', onKey, true)
  teardown.push(() => document.removeEventListener('keydown', onKey, true))
  backdrop.append(sheet)
  document.body.append(backdrop)

  // 定位：锚点 rect → 上方优先，夹进视口。挂载后再量，所以这里量得到自身尺寸。
  const GAP = 8
  const EDGE = 8
  // 先定好位再显形（2026-10-07 店主：「点击回形针弹出来的两个选项，会弹一下」）：
  // 点回形针会让软键盘收起，视口在随后约 200ms 里持续变化。若按旧坐标立刻画出来，
  // 用户看到的是「先出现在键盘上方、再跳一下」。所以隐藏挂载（`visibility` 不参与
  // 布局，仍能量尺寸），等**连续两帧位置相同**再显形；follow 跑完或 400ms 兜底也必须
  // 显形，免得 rAF 停摆（后台标签页）把浮层永久留在隐藏态。
  sheet.style.visibility = 'hidden'
  let revealed = false
  const reveal = (): void => {
    if (revealed) return
    revealed = true
    sheet.style.visibility = ''
  }
  let stableKey = ''
  let stableFrames = 0
  const revealTimer = window.setTimeout(reveal, 400)
  teardown.push(() => window.clearTimeout(revealTimer))
  const place = (): void => {
    if (!trigger.isConnected) {
      close()
      return
    }
    const anchor = trigger.getBoundingClientRect()
    const own = sheet.getBoundingClientRect()
    let top = anchor.top - GAP - own.height
    if (top < EDGE) top = Math.min(anchor.bottom + GAP, window.innerHeight - own.height - EDGE)
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - own.width - EDGE))
    const settledTop = Math.round(Math.max(EDGE, top))
    const settledLeft = Math.round(left)
    sheet.style.top = `${settledTop}px`
    sheet.style.left = `${settledLeft}px`
    const key = `${settledTop}:${settledLeft}`
    if (key === stableKey) stableFrames += 1
    else {
      stableKey = key
      stableFrames = 0
    }
    if (stableFrames >= 2) reveal()
  }
  place()
  // 重锚定（2026-10-07 真机报障）：浮层是 position:fixed，坐标若只在打开时算一次，
  // 点回形针导致软键盘收起时，布局整体下移约一个键盘高，浮层却留在旧视口坐标 ——
  // 真机上就停在会话中部（离回形针 ≈350px）。视口一变就重算；键盘动画是渐进的，
  // 所以再跟 12 帧 rAF 追一段。锚点已不在文档里时直接收起浮层。
  const onViewport = (): void => place()
  window.addEventListener('resize', onViewport)
  window.addEventListener('orientationchange', onViewport)
  window.visualViewport?.addEventListener('resize', onViewport)
  window.visualViewport?.addEventListener('scroll', onViewport)
  teardown.push(() => window.removeEventListener('resize', onViewport))
  teardown.push(() => window.removeEventListener('orientationchange', onViewport))
  teardown.push(() => window.visualViewport?.removeEventListener('resize', onViewport))
  teardown.push(() => window.visualViewport?.removeEventListener('scroll', onViewport))
  let frames = 0
  let raf = requestAnimationFrame(function follow() {
    // The keyboard animation is progressive, so the anchored position only
    // stops changing after ~10 frames; reveal on the last one at the latest.
    place()
    if (++frames < 12) raf = requestAnimationFrame(follow)
    else reveal()
  })
  teardown.push(() => cancelAnimationFrame(raf))
}

/**
 * 安装手机档的输入框文件入口弹层。
 * @param ctx - client 上下文。
 */
export function installComposerFilePicker(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: composer file picker', () => {
    const t = ctx.locale.bind(NS) as PickerTranslate
    const onClick = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const trigger = target.closest(TRIGGER_SELECTOR)
      if (trigger === null || trigger.hasAttribute('disabled')) return
      // 入口自己不再直点宿主 input（ComposerFileButton 2026-10-06 起只渲染按钮），
      // 这里吞掉这一击，唯一的后续是弹层。
      event.preventDefault()
      event.stopPropagation()
      openSheet(t, trigger)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      // 浮层还开着就按它自己的路径关掉（先摘监听/rAF，再删节点）——只 remove()
      // 节点会把 5 个持久监听留在 document/window 上，切换档位/热重载就叠一套。
      activeClose?.()
      activeClose = null
      document.querySelector('[data-mobile-nav="file-picker-backdrop"]')?.remove()
    }
  })
}
