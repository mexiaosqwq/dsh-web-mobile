import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * 模型 / 推理等级菜单的锚点修正（2026-09-23 店主两轮反馈）。
 *
 * 第一轮「这个模型打开，是不是有点偏左边？」；第二轮「再往左边移一点，和输入框右边的边界对齐」。
 *
 * 真机取证（360×754）：
 *   MENU  box=12,605,246,74   class=_7KE1Ra_menu  role=menu  aria-label="模型与推理等级"
 *         style="left: 12px; top: 605px"  position:fixed  **parent=BODY**（portal 出去的）
 *   CARD  [data-composer-card] = 16..342   TRIG = 219..249, 687..715（宽 30）
 *
 * 宿主按「菜单右缘贴触发器右缘」定位。模型触发器现在是图标形态、坐在输入框右半边
 * （219..249），246 宽的菜单就被推到 x=12..258 —— 菜单中心 x=135 vs 触发器中心 x=234，
 * 偏左 99px，视觉上整块贴在左半屏。
 *
 * 本插件早先用 CSS 居中过它（left:50% + translateX(-50%)），但那条规则锚在
 * `[class*="_root"]:has(> [class*="_trigger"]) > [class*="_menu"]` —— 菜单 portal 到 body 之后
 * 这条子代链断掉，规则成了**死规则**（2026-09-23 才发现，之前一直以为它在生效）。
 *
 * 定稿落位规则：
 *   1. 菜单**右缘贴输入框右边界**（店主指定）：left = card.right - menuWidth，
 *      两侧再夹 max(card.left, GUTTER) / min(card.right, 100vw - GUTTER)。
 *      真机：246 宽的菜单 ⇒ left 96（旧版居中于触发器会落在 106..352，右缘越出卡片 10px）。
 *   2. **触发器若在输入框左半边**（宿主/第三方换布局）则不贴右边界，改为居中于触发器 ——
 *      否则菜单会整体甩到远离触发器的一侧。
 *   3. 卡片缺失（宿主换锚点）⇒ 同样退回居中于触发器；两者都缺就什么都不做。
 *   只改 inline `left`，`top` 保持宿主机算好的值。
 *
 * 成本：全程只改一个 inline 属性。全文档查询（真机实测 18k 节点时约 0.57ms/次）**只在
 * 点到触发器/菜单之后**发生，并记住那个菜单节点；`scroll`/`resize` 只对记住的节点重算位置，
 * 不再查询 —— 避免会话流式输出/滚动时每帧多花约 1ms（触发器等查询实测 0.46ms/次）。
 * 这也是不用 MutationObserver 的原因（subtree 观察等于每帧扫全场）。
 */

/** 模型触发器（图标形态的 chip）。 */
const MODEL_TRIGGER = '[class*="_7KE1Ra_trigger"]'

/** 模型 / 推理等级菜单（portal 在 body 下）。 */
const MODEL_MENU = '[class*="_7KE1Ra_menu"]'

/** 输入框（composer 卡片）—— 菜单右缘贴的就是它的右边界。 */
const COMPOSER_CARD = '[data-composer-card]'

/** 贴边留白。 */
const GUTTER = 8

/** 宿主在打开动画 / 二次测量里会再写位置，补几次收尾（毫秒）。 */
const SETTLE_MS = [0, 60, 200]

export function installModelMenuAnchor(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: model menu anchor', () => {
    let raf = 0
    const timers: number[] = []
    /** 上一次确认「开着」的菜单节点；不在开态时保持 null。 */
    let active: HTMLElement | null = null

    const laidOut = (el: Element | null): DOMRect | null => {
      if (el === null) return null
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0 ? box : null
    }

    /** 只在「怀疑菜单开着」时调用：这是唯一会做全文档查询的路径。 */
    const findOpenMenu = (): HTMLElement | null => {
      for (const el of document.querySelectorAll<HTMLElement>(MODEL_MENU)) {
        if (laidOut(el) !== null) return el
      }
      return null
    }

    const place = (menu: HTMLElement): void => {
      const menuBox = laidOut(menu)
      if (menuBox === null) return
      const width = menuBox.width
      const viewport = document.documentElement.clientWidth
      const trigger = laidOut(document.querySelector<HTMLElement>(MODEL_TRIGGER))
      const card = laidOut(document.querySelector<HTMLElement>(COMPOSER_CARD))
      let left: number
      if (card !== null && (trigger === null || trigger.left + trigger.width / 2 >= card.left + card.width / 2)) {
        // 触发器在输入框右半边（官方布局）：右缘贴输入框右边界。
        const anchorRight = Math.min(card.right, viewport - GUTTER)
        const minLeft = Math.max(card.left, GUTTER)
        left = Math.max(Math.min(anchorRight - width, viewport - width - GUTTER), minLeft)
      } else if (trigger !== null) {
        // 触发器在左半边，或拿不到卡片：居中于触发器并夹在视口内。
        const center = trigger.left + trigger.width / 2
        left = Math.min(Math.max(center - width / 2, GUTTER), Math.max(GUTTER, viewport - width - GUTTER))
      } else {
        return
      }
      const next = `${Math.round(left)}px`
      // 只在真的不同时才写：避免和宿主来回抢同一帧。
      if (menu.style.left !== next) menu.style.left = next
    }

    /** 重算位置：优先用记住的节点，节点失效（关掉/重渲染）才重新查询一次。 */
    const settle = (): void => {
      if (active !== null && laidOut(active) === null) active = null
      const menu = active ?? findOpenMenu()
      if (menu === null) return
      active = menu
      place(menu)
    }

    const schedule = (): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        settle()
      })
    }

    /** 点到触发器/菜单之后补几次落位（宿主可能还会再写一次位置）。 */
    const scheduleSettle = (): void => {
      active = null
      schedule()
      for (const delay of SETTLE_MS) timers.push(window.setTimeout(schedule, delay))
      while (timers.length > SETTLE_MS.length * 2) {
        const stale = timers.shift()
        if (stale !== undefined) window.clearTimeout(stale)
      }
    }

    // 唯一会触发「查询」的入口：点到了触发器或菜单本身。
    const onPointerDown = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(MODEL_TRIGGER) !== null || target.closest(MODEL_MENU) !== null) scheduleSettle()
    }

    // 已经记住菜单节点时，滚动/改变尺寸只需重算位置（O(1)，不查询）。
    const onViewportChange = (): void => {
      if (active !== null && laidOut(active) === null) active = null
      if (active !== null) schedule()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onViewportChange)
    document.addEventListener('scroll', onViewportChange, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onViewportChange)
      document.removeEventListener('scroll', onViewportChange, true)
      if (raf !== 0) window.cancelAnimationFrame(raf)
      for (const timer of timers) window.clearTimeout(timer)
      timers.length = 0
      active = null
    }
  })
}
