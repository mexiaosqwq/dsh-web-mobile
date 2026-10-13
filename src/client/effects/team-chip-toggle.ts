import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TOUCH_QUERY, installMobileEffect } from '../platform/breakpoints.ts'

/**
 * 团队 chip「再点关闭」的接管（2026-09-23，对账 0.1.7-rc.1）。
 *
 * 症状：点头部那颗智能体团队图标能打开面板，**再点同一颗关不掉**，必须点面板
 * 四周（或按 Escape）才关。要求的行为：单击打开、再单击关闭。
 *
 * 真根因（读宿主源码得出，本轮真机复现）：
 * `dsh-experimental-client-ui-agent-team/lib/client.js` 的触发器 onClick 只处理
 * 「开」，开态时改为聚焦面板 —— 它自己**永远不关**：
 *
 *   onClick: () => {
 *     cancelHoverChange()
 *     pinnedRef.current = true
 *     if (!open) changeOpen(true)
 *     else panelRef.current?.focus()   // 开着就只 focus，不 toggle
 *   }
 *
 * 关闭路径只有两条：`ui-primitives` 的 useDismissOnOutsidePointer（document 上的
 * pointerdown，靶心在 root/panel 之外即 setOpen(false)）与面板内注册的 Escape
 * keydown。桌面靠 hover 开合，这个「点了只 pin 不 toggle」不成问题；手机上就成了
 * 「点了关不掉」。
 *
 * 修法（替用户把「点四周」这件事做掉，宿主两条关闭路径原样保留）：
 *   pointerdown 捕获阶段：触发器自报 aria-expanded="true" 且宿主的 body portal
 *   面板在场时，记下这一击；
 *   click 捕获阶段：同一触发器 → 先向 document.body 派发一次合成 pointerdown
 *   （靶心在 root 与面板之外 ⇒ 命中宿主自己的 outside-dismiss ⇒ 真关闭），
 *   再 stopPropagation 掉这一击 click —— 否则宿主的 onClick 还会在旧闭包里走
 *   else 分支去 focus 面板。
 *
 * 为什么先派发再吞 click（顺序不可换）：宿主 dismiss 是 document 上的 bubble
 * 监听，我们处在 capture 阶段，同步派发即同步生效；而 click 一旦放过去，宿主的
 * onClick 会看到尚未冲刷的 open=true 并执行 focus。
 *
 * 开态读 aria-expanded 而不是「点在不在面板里」：pointerdown 阶段 React 尚未重渲染，
 * 读到的是这一击之前的真实状态（与 workspace-chip-toggle 同一条判据）。
 *
 * 门控为什么是 TOUCH_QUERY 而不是 MOBILE_QUERY（2026-10-11，用户报障「平板模式下再点
 * 收不起来」）：宽视口（平板 / 折叠屏展开 / DSHA 平板模式）下 `max-width: 1023px` 恒不命中
 * ⇒ 原先 MOBILE_QUERY 门控时本效果**根本没安装**；而宽触屏同样没有 hover 兜底，用户只剩
 * 「点面板外」或 Escape 一条路。这与 v2.4.1「删除会话三件套」同构（session-menu 走
 * TOUCH_QUERY：该特性在桌面没有等价物，宽触屏也该有）。门控取 (pointer: coarse) ⇒
 * 鼠标驱动的窗口（含窄桌面窗口）在任意宽度都不命中，桌面仍是零介入。
 */

/** 团队 chip 根：宿主 agent-team 实验插件的稳定标记。 */
const ROOT_SELECTOR = '[data-team-action]'

/** 触发器：根的直接子按钮（aria-haspopup 是 dialog，不是 menu）。 */
const TRIGGER_SELECTOR = '[data-team-action] > button[aria-haspopup="dialog"]'

/** 面板：宿主 portal 到 body、带稳定标记与 role="dialog"。 */
const PANEL_SELECTOR = '[data-team-panel]'

export function installTeamChipToggle(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: team chip toggle', () => {
    /** 这一击之前自报「面板开着」的那颗触发器（否则 null）。 */
    let armed: Element | null = null

    const triggerFrom = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest(TRIGGER_SELECTOR) : null

    const onPointerDownCapture = (event: Event): void => {
      armed = null
      const trigger = triggerFrom(event.target)
      if (trigger === null) return
      if (trigger.getAttribute('aria-expanded') !== 'true') return
      if (document.querySelector(ROOT_SELECTOR) === null) return
      if (document.querySelector(PANEL_SELECTOR) === null) return
      armed = trigger
    }

    const onClickCapture = (event: Event): void => {
      const trigger = armed
      armed = null
      if (trigger === null || triggerFrom(event.target) !== trigger) return
      // 「点四周」这一步必须用 pointerdown：宿主的 dismiss 只监听 pointerdown。
      // 靶心选 document.body —— 它既不在 root 内、也不在面板内，是最省事的真外部。
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
      event.stopPropagation()
    }

    document.addEventListener('pointerdown', onPointerDownCapture, true)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      armed = null
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, TOUCH_QUERY)
}
