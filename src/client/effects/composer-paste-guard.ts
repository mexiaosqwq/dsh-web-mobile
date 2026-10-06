import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * 手机档：多行粘贴只剩首行（输入法上屏之后再粘贴）。
 *
 * 机制（宿主 dsh-client-ui-conversation 内置 Lexical，0.2.0-rc.2 / 0.2.1-alpha.1 同形）：
 * Android WebView 的长按「粘贴」菜单与输入法 commitText（含剪贴板候选）派发的是
 * `beforeinput` + `inputType: 'insertText'`，而不是 `paste` 事件。Lexical 的 beforeinput
 * 分发里，`data` 恰为 '\n' 才走换行命令；含换行的整段文本落进
 * CONTROLLED_TEXT_INSERTION_COMMAND。输入法上屏后节点处于 dirty 态，这条命令只写入
 * 第一段，其余段落被吞（同一会话内不会自愈）。真正的 `paste` 事件走 PASTE_COMMAND，
 * 不吞段 —— 这就是「直接粘贴正常、先打字再粘贴丢内容」的分叉点。
 * 上游报告：https://github.com/deepseek-ai/deepseek-harness/discussions/8823
 *
 * 修法（不改宿主）：document 捕获期拦下「可信的 insertText + 多行文本 + 落在 composer
 * 编辑面内」的 beforeinput，改派一个携带同一文本的合成 `paste` 事件到编辑面，让宿主走
 * 自己的 PASTE_COMMAND。先构造 DataTransfer/ClipboardEvent，构造失败就不拦，原路放行。
 *
 * DOM 契约（0.2.0-rc.2 核对）：`[data-composer-input]` 是 Lexical 的 contenteditable 根
 * （同元素带 `data-lexical-editor`）。宿主修复此 bug 后可整体删除本效果。
 */

/** composer 的 Lexical 编辑面。 */
const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/** beforeinput 中与本守卫相关的最小形状（便于纯函数单测）。 */
export interface PasteGuardInput {
  readonly inputType: string
  readonly data: string | null
  readonly isTrusted: boolean
  readonly defaultPrevented: boolean
}

/**
 * 这一次 beforeinput 是否需要改投 paste 通道。
 * 单个 '\n' 是宿主自己的换行命令（Shift+Enter / IME 换行），绝不拦。
 * @param event - beforeinput 的相关字段。
 * @returns 需要改投时为 true。
 */
export function shouldRerouteInsertText(event: PasteGuardInput): boolean {
  if (!event.isTrusted || event.defaultPrevented) return false
  if (event.inputType !== 'insertText') return false
  const text = event.data
  if (typeof text !== 'string') return false
  // 单个换行符交回宿主：'\n'（宿主换行命令）与孤立 '\r'（老式 Mac 换行）同等对待。
  // 只认 '\n' 会把单个 '\r' 当成"多行"改投合成 paste，反而给草稿插入一个字面的 CR。
  // '\r\n' 是两个字符，不走这条；宿主那条命令只匹配 data === '\n'，所以它仍按既有
  // 意图改投 paste，断行不会丢。
  if (text === '\n' || text === '\r') return false
  return text.includes('\n') || text.includes('\r')
}

/**
 * 构造携带纯文本的合成 paste 事件；环境不支持时返回 null（调用方原路放行）。
 * @param text - 要粘贴的文本。
 * @returns 合成事件或 null。
 */
function createPasteEvent(text: string): ClipboardEvent | null {
  if (typeof DataTransfer !== 'function' || typeof ClipboardEvent !== 'function') return null
  try {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
    // 少数引擎会忽略构造参数里的 clipboardData，此时合成事件对宿主是空粘贴，不能用。
    if (event.clipboardData?.getData('text/plain') !== text) return null
    return event
  } catch {
    return null
  }
}

export function installComposerPasteGuard(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: composer paste guard', () => {
    const onBeforeInput = (event: Event): void => {
      if (!(event instanceof InputEvent)) return
      if (!shouldRerouteInsertText(event)) return
      const target = event.target
      if (!(target instanceof Element)) return
      const editor = target.closest<HTMLElement>(COMPOSER_INPUT_SELECTOR)
      if (editor === null) return
      const paste = createPasteEvent(event.data ?? '')
      if (paste === null) return
      event.preventDefault()
      event.stopPropagation()
      editor.dispatchEvent(paste)
    }
    document.addEventListener('beforeinput', onBeforeInput, true)
    return () => {
      document.removeEventListener('beforeinput', onBeforeInput, true)
    }
  })
}
