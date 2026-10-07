import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * 模型 / 推理等级菜单的锚点修正（2026-09-23 店主："这个模型打开，是不是有点偏左边？"）。
 *
 * 真机取证（360×754）：
 *   MENU  box=12,605,246,74   class=_7KE1Ra_menu  role=menu  aria-label="模型与推理等级"
 *         style="left: 12px; top: 605px"  position:fixed  **parent=BODY**（portal 出去的）
 *   CARD  [data-composer-card] = 16..342      TRIG = 219..249, 687..715
 *
 * 宿主按「菜单右缘贴触发器右缘」定位 ⇒ 菜单落 12..258（店主第一眼："是不是有点偏左边？"）。
 * 本插件早先用 CSS 居中过它，但菜单 portal 到 body 之后那条 `_root > _menu` 子代链断掉，
 * 规则成了**死规则**。CSS 够不到 portal 节点，所以在这里用 JS 重锚。
 *
 * 落位（三轮定稿，2026-09-23）：**菜单在输入框里水平居中** —— 菜单中心 = 输入框中心。
 * 真机：卡片中心 179、菜单宽 246 ⇒ left 56（即 56..302，左右各留约 40px）。
 * 历史对照：宿主原样 12..258（偏左）／居中于触发器 106..352（触发器在右半边 ⇒ 偏右）。
 * 拿不到卡片时退回「居中于触发器 + 视口 GUTTER」。只认模型菜单的哈希锚点，其它菜单不碰。
 *
 * ## 成本（2026-09-23 优化，店主批准）
 *
 * 本机实测（18,359 节点）：`querySelectorAll('[class*="_7KE1Ra_menu"]')` = **0.568ms/次**、
 * `querySelector('[data-composer-card]')` = 0.08ms/次。旧版把这些查询挂在
 * `pointerdown`/`click`/`resize`/`scroll` 上 ⇒ **菜单关着时每次滚动也白花约 0.65ms/帧**
 * （模型流式输出时页面每帧都在滚，最吃这一口；60Hz 帧预算的 4%、120Hz 的 8%）。
 *
 * 现在分两条路径：
 *   · `refresh()` —— **唯一的查询入口**，只在"可能开关菜单"的交互后跑（点到/聚焦/按键在
 *     触发器或菜单上）。查到就把节点记进 `active`。
 *   · `follow()` —— 滚动/改变尺寸只对 `active` 重算位置（读两个 rect，约 0.02ms），
 *     `active === null` 时**直接返回、零查询**。
 *
 * 为什么不能干脆删掉 scroll 监听：实测滚动时输入框卡片会移动（同会话内 365 → 648），
 * 菜单开着时得跟着挪，否则会和卡片错位。
 *
 * 为什么不用 MutationObserver：会话在流式输出，`subtree` 观察等于每帧扫全场。
 */

/** 模型触发器（图标形态的 chip）。 */
const MODEL_TRIGGER = '[class*="_7KE1Ra_trigger"]'

/** 模型 / 推理等级菜单（portal 在 body 下）。 */
const MODEL_MENU = '[class*="_7KE1Ra_menu"]'

/** 输入框（composer 卡片）—— 菜单在它里面水平居中。 */
const COMPOSER_CARD = '[data-composer-card]'

/** 贴边留白。 */
const GUTTER = 8

/** 宿主在打开动画/二次测量里会再写位置，补几次收尾（毫秒）。 */
const SETTLE_MS = [0, 60, 200]

export function installModelMenuAnchor(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: model menu anchor', () => {
    let raf = 0
    const timers: number[] = []
    /** 已确认「开着」的菜单节点；null 表示当前没有菜单（滚动路径据此零查询）。 */
    let active: HTMLElement | null = null
    /**
     * 我们最后写进 inline left 的节点与值。卸载/菜单消失时要把这行还回去 ——
     * 否则宿主之后再渲染同一个菜单会带着我们留下的位置（issue #86）。
     * 只在值仍是我们写的那份时才清，避免抹掉宿主自己写的位置。
     */
    let placedLeft: { el: HTMLElement; value: string } | null = null

    const laidOut = (el: Element | null): DOMRect | null => {
      if (el === null) return null
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0 ? box : null
    }

    /** 唯一的全文档查询入口（只在交互路径调用，见文件头「成本」）。 */
    const findMenu = (): HTMLElement | null => {
      for (const el of document.querySelectorAll<HTMLElement>(MODEL_MENU)) {
        if (laidOut(el) !== null) return el
      }
      return null
    }

    /** 把菜单水平居中在输入框里（拿不到卡片则居中于触发器）。只写 inline left。 */
    const place = (menu: HTMLElement): void => {
      const menuBox = laidOut(menu)
      if (menuBox === null) return
      const width = menuBox.width
      const viewport = document.documentElement.clientWidth
      const max = Math.max(GUTTER, viewport - width - GUTTER)
      const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
      const cardBox = card === null ? null : card.getBoundingClientRect()
      const trigger = cardBox !== null && cardBox.width > 0 ? null : document.querySelector<HTMLElement>(MODEL_TRIGGER)
      const triggerBox = trigger === null ? null : trigger.getBoundingClientRect()
      const center = cardBox !== null && cardBox.width > 0
        ? cardBox.left + cardBox.width / 2
        : triggerBox === null ? null : triggerBox.left + triggerBox.width / 2
      if (center === null) return
      const left = Math.min(Math.max(center - width / 2, GUTTER), max)
      const next = `${Math.round(left)}px`
      // 只在真的不同时才写：避免和宿主来回抢同一帧。
      if (menu.style.left !== next) menu.style.left = next
      placedLeft = { el: menu, value: next }
    }

    /** 交互路径：刷新缓存（会查询）并按新位置落位。 */
    const refresh = (): void => {
      active = findMenu()
      if (active !== null) place(active)
    }

    /** 滚动 / 改变尺寸路径：只用缓存节点重算，不查询。 */
    const follow = (): void => {
      if (active === null) return
      if (laidOut(active) === null) {
        active = null
        return
      }
      place(active)
    }

    const schedule = (run: () => void): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        run()
      })
    }

    /** 交互后补几次落位（宿主在打开动画/二次测量里还会再写一次）。 */
    const scheduleRefresh = (): void => {
      schedule(refresh)
      for (const delay of SETTLE_MS) timers.push(window.setTimeout(() => schedule(refresh), delay))
      // 计时器只留最近一轮，避免长会话里越积越多。
      while (timers.length > SETTLE_MS.length * 2) {
        const stale = timers.shift()
        if (stale !== undefined) window.clearTimeout(stale)
      }
    }

    /** 只有"可能开关菜单"的交互才需要查询：命中触发器或菜单本身。 */
    const touchesMenu = (event: Event): boolean => {
      const target = event.target
      if (!(target instanceof Element)) return false
      return target.closest(MODEL_TRIGGER) !== null || target.closest(MODEL_MENU) !== null
    }

    const onPointerDown = (event: Event): void => {
      if (touchesMenu(event)) scheduleRefresh()
    }
    // 键盘/无障碍路径（聚焦触发器后按 Enter）与合成 click 也要覆盖。
    const onKeyDown = (event: Event): void => {
      if (touchesMenu(event)) scheduleRefresh()
    }
    const onFocusIn = (event: Event): void => {
      if (touchesMenu(event)) scheduleRefresh()
    }
    const onClick = (event: Event): void => {
      if (touchesMenu(event)) scheduleRefresh()
    }
    // 视口变化只走"零查询"的重算路径。
    const onViewportChange = (): void => {
      schedule(follow)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('click', onClick, true)
    window.addEventListener('resize', onViewportChange)
    document.addEventListener('scroll', onViewportChange, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', onViewportChange)
      document.removeEventListener('scroll', onViewportChange, true)
      if (raf !== 0) window.cancelAnimationFrame(raf)
      for (const timer of timers) window.clearTimeout(timer)
      timers.length = 0
      // 还回我们写的那行 inline left（只在值仍是我们写的时候）。
      if (placedLeft !== null && placedLeft.el.style.left === placedLeft.value) placedLeft.el.style.left = ''
      placedLeft = null
      active = null
    }
  })
}
