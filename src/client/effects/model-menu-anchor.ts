import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installMobileEffect } from '../platform/breakpoints.ts'

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
 * 落位：菜单能完整放入视口时右缘贴触发器；窄屏越界或触发器不可用时，
 * 回退为输入框内居中。两种锚点都不可用时保持宿主位置。其它菜单不碰。
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
 *     触发器或菜单上）。查到后缓存菜单、触发器和输入框。
 *   · `follow()` —— 滚动/改变尺寸只对缓存节点重算位置，
 *     `active === null` 时**直接返回、零查询**。
 *
 * 为什么不能干脆删掉 scroll 监听：实测滚动时输入框卡片会移动（同会话内 365 → 648），
 * 菜单开着时得跟着挪，否则会和卡片错位。
 *
 * 为什么不用 MutationObserver：会话在流式输出，`subtree` 观察等于每帧扫全场。
 *
 * ## 成本（2026-10-13 第二轮，三处同帧重复工作）
 *
 * 1. **rect 一帧一读**：`findMenu()` 为判定「菜单可见」先读一次菜单盒，`place()` 紧接着
 *    又对**同一个**菜单节点读第二次（旧版 :76-77 → :84）。现在本帧内同一个元素的
 *    `getBoundingClientRect()` 只读一次、结果在帧内复用（`frameRects`）。
 * 2. **rAF 槽合并**：旧版 `if (raf !== 0) return` 是「先到者胜」——同一帧里先排了
 *    `follow()` 再来的 `refresh()` 会被整份丢掉，那次交互当帧就不落位。改成「槽位保存
 *    最新那份意图」，后到者覆盖先到者，请求不再丢。
 * 3. **还值不置空**：旧版收尾统一把 inline left 置成空串，会把宿主自己那行位置一起抹掉；
 *    现在记下第一次接管时的原值并按原值还回去。
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
    /** 本帧待跑的那一份意图。后到的请求覆盖它（见 schedule()）。 */
    let pending: (() => void) | null = null
    /**
     * 本帧的 rect 缓存（键 = 元素）。同一趟定位里同一个元素只读一次：`findMenu()` 判定
     * 可见性要读菜单盒，`place()` 又用同一个菜单盒。帧开始重建、帧结束丢弃，
     * 所以跨帧（布局可能已经变了）绝不会用到陈旧值。
     */
    let frameRects: Map<Element, DOMRect | null> | null = null
    const timers: number[] = []
    /** 已确认「开着」的菜单节点；null 表示当前没有菜单（滚动路径据此零查询）。 */
    let active: HTMLElement | null = null
    let activeTrigger: HTMLElement | null = null
    let activeCard: HTMLElement | null = null
    /**
     * 我们最后写进 inline left 的节点与值。卸载/菜单消失时要把这行还回去 ——
     * 否则宿主之后再渲染同一个菜单会带着我们留下的位置（issue #86）。
     * 只在值仍是我们写的那份时才还，避免抹掉宿主自己写的位置。
     *
     * `original` = **第一次接管这个菜单时**宿主留下的那行 inline left（可能是空串，
     * 也可能是宿主自己写过的值）。收尾按它还原 —— 旧版一律置空串，宿主的位置会被一起抹掉。
     */
    let placedLeft: { el: HTMLElement; value: string; original: string } | null = null

    /** 交还我们写过的那行 inline left（值仍是我们写的才动），并放弃所有权。 */
    const releasePlacement = (): void => {
      const placed = placedLeft
      placedLeft = null
      if (placed !== null && placed.el.style.left === placed.value) placed.el.style.left = placed.original
    }

    /**
     * 本文件**唯一**的 rect 读点。同一帧里同一个元素复用第一次的结果
     * （`frameRects` 为 null 时——理论上只在帧外——退化为裸读，行为不变）。
     */
    const laidOut = (el: Element | null): DOMRect | null => {
      if (el === null) return null
      const cached = frameRects?.get(el)
      if (cached !== undefined) return cached
      const box = el.getBoundingClientRect()
      const result = box.width > 0 && box.height > 0 ? box : null
      frameRects?.set(el, result)
      return result
    }

    /** 唯一的全文档查询入口（只在交互路径调用，见文件头「成本」）。 */
    const findMenu = (): HTMLElement | null => {
      for (const el of document.querySelectorAll<HTMLElement>(MODEL_MENU)) {
        if (laidOut(el) !== null) return el
      }
      return null
    }

    /** Align to the trigger's right edge when it fits; otherwise center on the card. */
    const place = (menu: HTMLElement): void => {
      const menuBox = laidOut(menu)
      if (menuBox === null) return
      const width = menuBox.width
      const viewport = document.documentElement.clientWidth
      const max = Math.max(GUTTER, viewport - width - GUTTER)
      const triggerBox = laidOut(activeTrigger)
      const cardBox = laidOut(activeCard)
      const flush = triggerBox === null ? null : triggerBox.right - width
      let left: number
      if (flush !== null && flush >= GUTTER && flush <= max) left = flush
      else if (cardBox !== null) left = cardBox.left + (cardBox.width - width) / 2
      else return
      const next = `${Math.round(Math.min(Math.max(left, GUTTER), max))}px`
      if (placedLeft !== null && placedLeft.el !== menu) releasePlacement()
      if (placedLeft === null) {
        // 第一次接管：先记原值，再写我们的值。
        placedLeft = { el: menu, value: next, original: menu.style.left }
      } else {
        placedLeft.value = next
      }
      if (menu.style.left !== next) menu.style.left = next
    }

    /** 交互路径：刷新缓存（会查询）并按新位置落位。 */
    const refresh = (): void => {
      active = findMenu()
      activeTrigger = active === null ? null : document.querySelector<HTMLElement>(MODEL_TRIGGER)
      activeCard = active === null ? null : document.querySelector<HTMLElement>(COMPOSER_CARD)
      if (active !== null) place(active)
    }

    /** 滚动 / 改变尺寸路径：只用缓存节点重算，不查询。 */
    const follow = (): void => {
      if (active === null) return
      if (laidOut(active) === null) {
        // 菜单已经不在了（收起/卸载）：把位置还回去，别再占着。
        releasePlacement()
        active = null
        activeTrigger = null
        activeCard = null
        return
      }
      place(active)
    }

    /**
     * 把一次定位请求排进下一帧。**合并语义**：一帧只跑一次，槽位存的是「最新那份意图」，
     * 后到的请求覆盖先到的（不是被丢掉）。
     *
     * 旧版是「先到者胜」的 `if (raf !== 0) return`：同一帧里 `follow()` 之后来的
     * `refresh()` 会被整份吃掉 —— 用户刚点开菜单、同一帧页面又在滚（流式输出时常态）时，
     * 那次交互当帧不落位，只能等 60ms/200ms 的收尾计时器兜底。
     */
    const schedule = (run: () => void): void => {
      pending = run
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        const job = pending
        pending = null
        frameRects = new Map()
        try {
          if (job !== null) job()
        } finally {
          frameRects = null
        }
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
      pending = null
      frameRects = null
      for (const timer of timers) window.clearTimeout(timer)
      timers.length = 0
      // 还回我们改写的那行 inline left（只在值仍是我们写的时候，按第一次接管时的原值还原）。
      releasePlacement()
      active = null
      activeTrigger = null
      activeCard = null
    }
  })
}
