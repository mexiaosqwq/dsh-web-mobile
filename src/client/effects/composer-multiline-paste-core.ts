/**
 * 多行插入走 paste 通道的判定纯核（零 DOM、可单测）。
 *
 * 背景（宿主 `dsh-client-ui-conversation` 0.2.0-rc.2 实测）：
 * 编辑器对 `insertText` 的**多行**输入走的是一条有损路径 ——
 * `beforeinput(insertText)` → 判定器 `Bn()` 命中 `a.isDirty() && _ > 1`
 * （`lib/client.js:5350`，`_` = 传入文本长度）→ `CONTROLLED_TEXT_INSERTION_COMMAND`
 * (`je$2`)，该命令按「单次受控插入」语义处理，**换行被吞、只落第一段**。
 * 真粘贴事件走 PASTE_COMMAND (`Je$2`) → `:5497 insertRawText(t)`，整段落盘不丢。
 *
 * Android WebView 的 IME commitText 与粘贴菜单都发 `insertText`（不是 `paste`
 * 事件），所以中文输入后粘贴 / 语音输入等多行文本会撞上这条有损路径。
 *
 * 本插件不能改宿主包，只能在 `beforeinput` 捕获阶段把「多行 insertText」改投
 * paste 通道：拦下原事件、改派一次合成 `ClipboardEvent('paste')`，让宿主自己走
 * 无损路径（不自己动 DOM，焦点与选区仍归宿主管）。**必须用 ClipboardEvent 带
 * `clipboardData`**——宿主的 PASTE_COMMAND 处理器只读 `event.clipboardData`，
 * 用 `InputEvent({inputType:'insertFromPaste', data})` 会让文字静默全丢，
 * 详见 composer-multiline-paste.ts 的实测记录。
 *
 * 保守边界：只在**确实多行**时动手 —— 单行输入、纯换行串、IME 组合期的中间态
 * 一律放行，最大程度不影响正常打字。
 */

/** 判定所需的最小输入面（便于单测用普通对象构造）。 */
export interface BeforeInputLike {
  inputType: string
  data: string | null
  isComposing?: boolean
}

/**
 * 该 `beforeinput` 是否应改投 paste 通道。
 *
 * 命中条件（全部满足）：
 *  1. `inputType === 'insertText'`（宿主有损路径的入口）；
 *  2. `data` 含换行（`\n` 或 `\r`）且**至少含一个非换行字符**——纯换行串不碰，
 *     因为宿主对 `data === '\n'` 有专门分支（`:5491` `"\n" === c → INSERT_LINE_BREAK`），
 *     某些输入法/软键盘的换行键正是发 `insertText('\n')`；改道会把它从「软换行」
 *     变成「新段落」，属于不该动的既有行为；
 *  3. 不在 IME 组合期（组合中的中间文本不能改道，否则打断中文输入）。
 */
export function shouldRerouteToPaste(event: BeforeInputLike): boolean {
  if (event.inputType !== 'insertText') return false
  if (event.isComposing === true) return false
  const data = event.data
  if (data === null || data === undefined) return false
  if (!data.includes('\n') && !data.includes('\r')) return false
  // 纯换行串（'\n' / '\r\n' / '\n\n'…）留给宿主自己的行分隔分支。
  return /[^\r\n]/.test(data)
}

/**
 * 把换行规范化成宿主 `insertRawText` 期望的形态。
 *
 * 宿主 `:5497` 直接 `insertRawText(text)`，而其段落切分只认 `\n`；CRLF 会在行尾
 * 留下孤立的 `\r`。统一成 `\n`，顺带把 `\r\n` 合并（避免 `\n\n` 凭空多出空段）。
 */
export function normalizeNewlines(data: string): string {
  return data.replace(/\r\n?/g, '\n')
}
