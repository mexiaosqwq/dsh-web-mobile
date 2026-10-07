import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { decidePluginCardTap } from '../core/plugin-card-tap-core.ts'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * 插件管理页：整卡 / 整行可点（2026-10-07 店主报障）。
 *
 * 症状：点卡片只有那行**加黑标题**能打开详情，描述/图标/留白点了没反应。
 *
 * 根因（读宿主 `dsh-client-ui-plugin-manager` 源码 + 真机截图取证）：宿主只把标题
 * 渲染成 `<button aria-label=打开…详情>`，且自己带了一层 stretched-link
 * （`.cardOpen:after{position:absolute;inset:0}` 配 `.cardLink{position:relative}`）；
 * 但卡片 DOM 顺序是 `icon → titleRow(button) → cardDesc`，描述是个 `-webkit-box`
 * 盒子，**绘制在覆盖层之后**，于是描述整块把点击吃掉。真机上给覆盖层补 `z-index`
 * 抬升仍不生效（本文件所在的同一批修复里试过），所以这里改走**行为级**：
 * 在捕获期把「卡片内、且不在任何交互控件上」的点击转发给那颗打开按钮。
 *
 * 与 CSS 的分工：layout.css.ts 里那组 `li[data-plugin-package] …::after` 规则保留
 * （负责悬停视觉与桌面浏览器上的 stretched-link 语义），点击的**确定性**由本效果保证。
 * 桌面档由 installMobileEffect 门控 ⇒ 鼠标环境零影响。
 */

/** 插件管理页条目根节点（宿主稳定标记：卡片与行式两种）。 */
const CARD = 'li[data-plugin-package], li[data-plugin-row]'

/** 条目里唯一能打开详情的按钮（卡片 `cardOpen` / 行式 `rowOpen`）。 */
const OPEN = 'button[class*="_cardOpen"], button[class*="_rowOpen"]'

/**
 * 条目内其它交互件：一律不抢。
 * `[role="switch"]` 是宿主 Switch 的既有半区；其余是防御（后代可能新增控件）。
 */
const INTERACTIVE = 'button, a, input, select, textarea, [role="switch"], [role="button"], [role="tab"], [contenteditable="true"]'

/**
 * Install the capture-phase click forwarder for plugin-manager entries.
 * @param ctx - client root context.
 */
export function installPluginCardTap(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: plugin card tap', () => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const card = target.closest(CARD)
      if (card === null) return
      const open = card.querySelector(OPEN)
      if (!(open instanceof HTMLButtonElement)) return
      const decision = decidePluginCardTap({
        insideOpen: open.contains(target),
        onInteractive: target.closest(INTERACTIVE) !== null,
      })
      if (decision === 'ignore') return
      // 只有描述/图标/留白会走到这里：别让这次点击再做别的事（选中文本、聚焦），
      // 然后替用户点一次宿主那颗按钮。转发出来的 click 会再次经过本监听器，
      // 但那时 target 就在 open 内部 ⇒ insideOpen ⇒ 直接放过，不会递归。
      event.preventDefault()
      open.click()
    }
    // 捕获期：宿主的 outside-click 之类监听器都在冒泡，先一步拿到事件。
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  })
}
