import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from '../platform/breakpoints.ts'

/**
 * 工作区 chip「再点关闭」的接管（2026-09-23，对账 0.1.7-rc.1）。
 *
 * 症状：hero 空态的工作区 chip，第一次点开工作区列表，**再点 chip 关不掉**
 * （列表原地不动，等于又开一次）。要求的行为：单击打开、再单击关闭。
 *
 * 真根因（读宿主源码得出）：
 * `ui-conversation` 的 chip 自己是正常 toggle（`ConversationContent.tsx`）：
 *
 *   onClick: () => { setPickerOpen(open => !open) }
 *
 * 关不掉的原因在 `ui-workspace` 的 WorkspacePickFlow 怎么开这个菜单：
 *
 *   <Menu anchor={null} portal getAnchorRect={anchorRef.current.getBoundingClientRect} … />
 *
 * `anchor={null}` ⇒ Menu 的 rootRef 是一个**空 span**，触发器 chip 在 Menu 子树之外；
 * 而 `ui-primitives/Menu.tsx` 的「外部 pointerdown 关闭」只豁免 rootRef / listRef：
 *
 *   if (rootRef.current?.contains(target) === true) return
 *   if (listRef.current?.contains(target) === true) return
 *   onClose()
 *
 * ⇒ 菜单开着时点 chip：pointerdown 先被判成「外部点击」→ onClose()（翻到 false），
 *   紧接着的 click 到达 chip 的 onClick → 又翻回 true。净效果＝再开一次。
 * 旁证：同行的「预设」触发器传的是 `anchor={<button …/>}`（按钮在 rootRef 内），
 * pointerdown 不被判外部，所以它没有这个毛病 —— 同一份 Menu，两种接线。
 *
 * 修法（只补这一个缺口，宿主关闭路径原样保留）：
 *   pointerdown 捕获阶段：chip 自报 `aria-expanded="true"`（＝菜单真开着）且宿主的
 *   portal 菜单在场时，记下这一击；
 *   click 捕获阶段：同一 chip 的 click 直接 stopPropagation —— React 挂在 root 容器上
 *   的 onClick 不再执行，chip 的 toggle 不会被翻回「开」，宿主 pointerdown 的那次
 *   关闭成为唯一结果。菜单本来就关着时（第一击的开启路径）完全不介入。
 *
 * 开态读 `aria-expanded` 而不是「点在不在菜单里」：pointerdown 阶段 React 尚未重渲染，
 * 读到的是这一击之前的真实状态；等到 click 再读 DOM 会读到未冲刷的旧树。
 */

/** hero 工作区 chip：hero 行的**直接子**按钮（预设触发器在 Menu 的 anchor span 里，不是直接子）。 */
const CHIP_SELECTOR = '[class*="heroWorkspaceRow"] > button[aria-haspopup="menu"]'

/** 宿主 Menu 的 portal 列表：只有它在场，宿主的「外部 pointerdown 关闭」才存在。 */
const OPEN_MENU_SELECTOR = '[role="menu"]'

export function installWorkspaceChipToggle(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: workspace chip toggle', () => {
    /** 这一击之前 chip 报「菜单开着」的那颗 chip（否则 null）。 */
    let armed: Element | null = null

    const chipFrom = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest(CHIP_SELECTOR) : null

    const onPointerDownCapture = (event: Event): void => {
      armed = null
      const chip = chipFrom(event.target)
      if (chip === null) return
      if (chip.getAttribute('aria-expanded') !== 'true') return
      if (document.querySelector(OPEN_MENU_SELECTOR) === null) return
      armed = chip
    }

    const onClickCapture = (event: Event): void => {
      const chip = armed
      armed = null
      if (chip === null || chipFrom(event.target) !== chip) return
      event.stopPropagation()
    }

    document.addEventListener('pointerdown', onPointerDownCapture, true)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      armed = null
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      document.removeEventListener('click', onClickCapture, true)
    }
  })
}
