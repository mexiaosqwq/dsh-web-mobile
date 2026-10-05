import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from './phone-chrome.ts'
import { normalizeNewlines, shouldRerouteToPaste } from './composer-multiline-paste-core.ts'

/**
 * 多行输入改投 paste 通道（宿主有损路径的兜底）。
 *
 * 症状（真机 + headless 双侧实锤）：中文输入法上屏几个字后，再「粘贴」一段多行
 * 文本，**只有第一行落进输入框**，其余整段丢失；而没经过输入法时粘贴同样文本却
 * 完好。A/B 实测（插件原始态 / 摘除本插件全部三处 `.blur()` / 摘除全部四个
 * composer 效果，三组逐位相同）证明**与本插件任何既有逻辑无关**，是宿主自身行为：
 * 多行走 `insertText` → 判定器 `Bn()` 命中 `a.isDirty() && _ > 1`
 * （`lib/client.js:5350`，`_` = 传入文本长度）→ `CONTROLLED_TEXT_INSERTION_COMMAND`
 * 只落首段；真粘贴走 `PASTE_COMMAND` → `insertRawText`（`:5497`）不丢。
 *
 * 为什么必须由本插件兜：Android WebView（DSHA）的 IME `commitText` 与粘贴菜单**都
 * 发 `insertText`**，不发 `paste` 事件，所以真机必然撞上；宿主包不能改（第三方
 * 源码纪律），只能在捕获阶段把多行 `insertText` 改派成一次**合成 paste 事件**。
 *
 * ⚠️ 关键实现约束（2026-10-05 实测踩坑，两次返工）：
 * 不能用 `new InputEvent('beforeinput', {inputType:'insertFromPaste', data})` 去模拟
 * ——宿主 `PASTE_COMMAND` 的处理器**不读 `event.data`**，读的是
 * `event.clipboardData`（`:12183` 还带 `instanceof ClipboardEvent` 硬判、`:16717`
 * 起手就 `event.clipboardData ?? null` 然后 `null === clipboardData → return false`），
 * 所以走那条路文字会**静默全丢**（实测：C2 由原本的正常 577 变成 0）。
 * 正确形态 = `ClipboardEvent('paste', {clipboardData: DataTransfer})`：
 * 宿主走自己真实的粘贴路径，段落完整落盘（实测 `HEAD\nLINE1\nLINE2\nTAIL` 全中）。
 *
 * 保守值域：只拦「单次传入文本含换行」的 `insertText`；单行、组合期中间态、
 * 删除/格式类输入一律放行（判定纯核见 composer-multiline-paste-core.ts）。
 */

/** 编辑面：宿主 Lexical 的 contenteditable 根。 */
const EDITOR_SELECTOR = '[data-composer-input] [contenteditable="true"], [data-lexical-editor="true"]'

export function installComposerMultilinePaste(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: composer multiline paste', () => {
    /**
     * 捕获阶段拦截：宿主的 `beforeinput` 监听挂在编辑器根上（冒泡），
     * 所以捕获阶段先看到事件、能抢在它之前把这次输入换成无损形态。
     */
    const onBeforeInput = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(EDITOR_SELECTOR) === null) return

      const input = event as InputEvent
      if (!shouldRerouteToPaste({
        inputType: input.inputType,
        data: input.data,
        isComposing: input.isComposing,
      })) return

      const data = input.data
      if (data === null) return

      // 先准备好合成剪贴板；环境不支持（老 WebView）就直接放行原事件 ——
      // 此刻还没 preventDefault，宿主仍会按既有（有损）路径处理，文字不会全丢。
      let transfer: DataTransfer
      try {
        transfer = new DataTransfer()
      } catch {
        return
      }
      transfer.setData('text/plain', normalizeNewlines(data))

      // 拦住有损的原事件：宿主自此看不到这次 insertText，只看到下面的 paste。
      // 本监听器在 document 捕获相，阻断后事件到不了编辑器根上宿主的监听器。
      // 用 stopImmediatePropagation：实测（活宿主两轮 3/3）此法下宿主不再处理原
      // insertText、改派 paste 正常落全文（580）且无重复插入。
      // 注：更温和的 stopPropagation 理论上有同样效果且爆炸半径更小，但需活宿主
      // 复测确认后才能替换——未实测前不动已验证的写法。
      event.preventDefault()
      event.stopImmediatePropagation()

      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      )
    }

    document.addEventListener('beforeinput', onBeforeInput, true)
    return () => {
      document.removeEventListener('beforeinput', onBeforeInput, true)
    }
  })
}
