import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { getFrame } from '../platform/frame.ts'
import { NS } from '../i18n/locales.ts'
import { installMobileEffect, TABLET_TOUCH_QUERY } from '../platform/breakpoints.ts'
import { createPreviewFullscreenTask } from './preview-fullscreen.ts'

/**
 * One Win32 navigator spoof instance for a file-row tap path. The suite checks
 * platform/userAgent/appVersion when a tree row is tapped and diverts Android
 * away from the desktop preview column; both tap paths below (mobile and
 * tablet — Android tablets match TABLET_TOUCH_QUERY too) spoof for one second
 * so the desktop preview column opens. The spoof is global, so it must be
 * restore-safe: one in-flight timer, re-entrancy guarded, and always restored
 * on effect disposal (narrow→wide / plugin reload).
 * Restore what was actually there: an own descriptor if the page had one,
 * otherwise REMOVE the own property we added so the prototype's getter shows
 * through again. Writing the old VALUE back as an own property leaves a
 * permanent own-property shadow behind (issue #86), which changes
 * `Object.keys(navigator)` / descriptor probes for the rest of the session.
 * State lives in the closure (one per install); no module-level mutable state.
 */
function createNavigatorSpoof(): { spoof: () => void; restore: () => void } {
  const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  const DESKTOP_APPVERSION = '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  let restoreTimer: number | null = null
  let spoofed = false
  const NAV_KEYS = ['platform', 'userAgent', 'appVersion'] as const
  const savedNavigator = new Map<string, PropertyDescriptor | null>()
  const restoreNavigator = (): void => {
    if (restoreTimer !== null) {
      window.clearTimeout(restoreTimer)
      restoreTimer = null
    }
    if (!spoofed) return
    spoofed = false
    for (const key of NAV_KEYS) {
      const descriptor = savedNavigator.get(key) ?? null
      if (descriptor === null) delete (navigator as unknown as Record<string, unknown>)[key]
      else Object.defineProperty(navigator, key, descriptor)
    }
    savedNavigator.clear()
  }
  const spoofDesktop = (): void => {
    if (!spoofed) {
      for (const key of NAV_KEYS) {
        savedNavigator.set(key, Object.getOwnPropertyDescriptor(navigator, key) ?? null)
      }
      Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
      Object.defineProperty(navigator, 'userAgent', { value: DESKTOP_UA, configurable: true })
      Object.defineProperty(navigator, 'appVersion', { value: DESKTOP_APPVERSION, configurable: true })
      spoofed = true
    }
    if (restoreTimer !== null) window.clearTimeout(restoreTimer)
    restoreTimer = window.setTimeout(restoreNavigator, 1000)
  }
  return { spoof: spoofDesktop, restore: restoreNavigator }
}

/** dsh-web-ui 兼容：explorer / preview 列的显隐标记与升起动画（同域同机制，合并一处）。 */
export function installAionuiCompat(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: aionui explorer close marker', () => {
    const onChevronClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target === null || !target.closest('.aionui-collapse-chevron')) return
      getFrame()?.removeAttribute('data-aionui-explorer-open')
    }
    document.addEventListener('click', onChevronClick, true)
    return () => document.removeEventListener('click', onChevronClick, true)
  })

  installMobileEffect(ctx, 'dsh-web-mobile: preview sheet open marker', () => {
    const closePreview = (): void => {
      getFrame()?.removeAttribute('data-aionui-preview-open')
      getFrame()?.removeAttribute('data-mobile-preview-full')
    }

    // Temporarily spoof platform/userAgent/appVersion to Win32 desktop to
    // bypass the suite's Android check — see createNavigatorSpoof.
    const { spoof: spoofDesktop, restore: restoreNavigator } = createNavigatorSpoof()

    const onTap = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target === null) return
      const row = target.closest('[data-aionui-explorer-col] [class*="_treeRow"]')
      if (row === null) return
      if (row.querySelector('[class*="_treeArrow"]:not([class*="_treeArrowEmpty"])') !== null) return

      spoofDesktop()
      getFrame()?.setAttribute('data-aionui-preview-open', '')
    }
    const onCollapse = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target === null) return
      if (target.closest('[data-aionui-preview-col] [class*="_panelCollapse"]') !== null) {
        closePreview()
      }
    }
    document.addEventListener('click', onTap, true)
    document.addEventListener('click', onCollapse, true)
    return () => {
      restoreNavigator()
      document.removeEventListener('click', onTap, true)
      document.removeEventListener('click', onCollapse, true)
    }
  })

  // 宽屏触屏（≥1024）没有手机壳，宿主原生预览列也没有 data-mobile-nav
  // frame。这里把平板自己的 open/close 标记挂到 <html>，由下面的轻量观察器
  // 驱动 preview-fullscreen 任务；共享 reconciler 只在 MOBILE_QUERY 武装。
  installMobileEffect(
    ctx,
    'dsh-web-mobile: tablet preview open marker',
    () => {
      // Android tablets match TABLET_TOUCH_QUERY too, and the same suite check
      // the mobile path spoofs diverts their file-row tap away from the desktop
      // preview column. iPad never reports Android, so the spoof is inert
      // there — kept for parity with the mobile tap path.
      const { spoof: spoofDesktop, restore: restoreNavigator } = createNavigatorSpoof()
      const onTap = (event: MouseEvent): void => {
        const target = event.target as HTMLElement | null
        if (target === null) return
        const row = target.closest('[data-aionui-explorer-col] [class*="_treeRow"]')
        if (row === null) return
        if (row.querySelector('[class*="_treeArrow"]:not([class*="_treeArrowEmpty"])') !== null) return
        spoofDesktop()
        document.documentElement.setAttribute('data-aionui-preview-open', '')
      }
      const onCollapse = (event: MouseEvent): void => {
        const target = event.target as HTMLElement | null
        if (target?.closest('[data-aionui-preview-col] [class*="_panelCollapse"]') === null) return
        document.documentElement?.removeAttribute('data-aionui-preview-open')
        document.documentElement?.removeAttribute('data-mobile-preview-full')
      }
      document.addEventListener('click', onTap, true)
      document.addEventListener('click', onCollapse, true)
      return () => {
        restoreNavigator()
        document.removeEventListener('click', onTap, true)
        document.removeEventListener('click', onCollapse, true)
        document.documentElement?.removeAttribute('data-aionui-preview-open')
        document.documentElement?.removeAttribute('data-mobile-preview-full')
      }
    },
    TABLET_TOUCH_QUERY,
  )

  // 宽屏触屏的全屏按钮不走共享 reconciler（它只在 MOBILE_QUERY 武装）。
  // 与 tablet-quick-settings 同口径：复用任务逻辑，自己用极轻的观察器驱动
  // ensure。只观察预览标记和子节点挂载，不读几何。
  installMobileEffect(
    ctx,
    'dsh-web-mobile: tablet preview fullscreen',
    () => {
      const task = createPreviewFullscreenTask(ctx.locale.bind(NS))
      const sync = (): void => {
        try {
          task.ensure()
        } catch (error) {
          console.error('[dsh-web-mobile] tablet-preview-fullscreen', error)
        }
      }
      let queued = false
      const schedule = (): void => {
        if (queued) return
        queued = true
        requestAnimationFrame(() => {
          queued = false
          sync()
        })
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-aionui-preview-open', 'data-mobile-preview-full'],
      })
      sync()
      return () => {
        observer.disconnect()
        task.dispose()
      }
    },
    TABLET_TOUCH_QUERY,
  )

  // 宽屏触屏的收起同步：suite 不走 _panelCollapse 收起预览列（切 / 关标签是它
  // 自己把列写成 inline visibility:hidden）时，清标记由 createPreviewCloseTask
  // 负责，而它挂在共享 reconciler 上——只在 MOBILE_QUERY 武装，平板上永不跑，
  // <html> 的标记留着，overlay 与 body overflow:hidden 就把页面锁死。与上面两
  // 个平板 effect 同口径：复用任务，自己的轻量观察器驱动 ensure。close-sync 的
  // 键是 style（suite 用 inline visibility 收列），childList 兜列的挂载/卸载。
  installMobileEffect(
    ctx,
    'dsh-web-mobile: tablet preview close sync',
    () => {
      const task = createPreviewCloseTask()
      const sync = (): void => {
        try {
          task.ensure()
        } catch (error) {
          console.error('[dsh-web-mobile] tablet-preview-close-sync', error)
        }
      }
      let queued = false
      const schedule = (): void => {
        if (queued) return
        queued = true
        requestAnimationFrame(() => {
          queued = false
          sync()
        })
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
      })
      sync()
      return () => {
        observer.disconnect()
        task.dispose()
      }
    },
    TABLET_TOUCH_QUERY,
  )
}

export function createPreviewCloseTask(): ReconcilerTask {
  // Latch: "an open column was seen". It tells the two absent-column
  // lifecycles apart (review #6872117016): a tap sets the open marker before
  // the suite has rendered the column ("not mounted yet" — absence must not
  // undo the marker), while a column that was open and then vanished
  // ("removed after opening") strands the markers — on tablet
  // html[data-mobile-preview-full] body { overflow: hidden } keys on the
  // marker alone, so the scroll lock would outlive the column. A present but
  // closed column resets the latch, so a stale latch cannot eat a freshly
  // set marker during a remove→re-add reopen.
  let openColumnSeen = false
  const clearMarkers = (): void => {
    getFrame()?.removeAttribute('data-aionui-preview-open')
    getFrame()?.removeAttribute('data-mobile-preview-full')
    document.documentElement?.removeAttribute('data-aionui-preview-open')
    document.documentElement?.removeAttribute('data-mobile-preview-full')
  }
  return {
    name: 'preview-close-sync',
    // Only acts when the suite hides the col via inline style. Deliberately
    // NOT scoped to data-aionui-preview-open: our own open marker is set
    // before the suite necessarily flips its inline visibility, so waking on
    // that marker would read the still-hidden style as a "suite close" and
    // immediately undo the file-row tap.
    scopes: ['style'],
    ensure: () => {
      const pv = document.querySelector<HTMLElement>('[data-aionui-preview-col]')
      if (pv === null) {
        // Absent after a latched open session = the suite unmounted or
        // replaced the column mid-session: release the markers (the overlay
        // CSS and the body scroll lock key on them; the fullscreen task's
        // next ensure takes the button off). Without the latch this is the
        // tap→mount window: keep the markers.
        if (openColumnSeen) {
          clearMarkers()
          openColumnSeen = false
        }
        return
      }
      if (pv.style.visibility === 'hidden') {
        clearMarkers()
        openColumnSeen = false
        return
      }
      openColumnSeen =
        getFrame()?.hasAttribute('data-aionui-preview-open') === true
        || document.documentElement.hasAttribute('data-aionui-preview-open')
    },
    dispose: () => {},
  }
}

export function createSheetRiseTask(): ReconcilerTask {
  const cols = ['[data-aionui-explorer-col]', '[data-aionui-preview-col]']
  const seen = new Map<string, boolean>()
  // 每列**我们自己**启动的那一条 Animation。只记录自有的：宿主自己创建的动画
  // （第三方包/React 组件的 WAAPI）从不进这张表，因此也**永远不会被我们 cancel**。
  const own = new Map<string, { el: Element; anim: Animation }>()
  // reduce 必须在**播放那一刻**读：用户中途改系统开关也要生效（CSS 的 animation:none
  // 管不到 WAAPI 造的动画，只能自己判）。
  const reduceMotion = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const cancelOwn = (sel: string): void => {
    const rec = own.get(sel)
    if (rec === undefined) return
    own.delete(sel)
    // cancel() 会让 finished 以一个 AbortError 拒绝，那条 promise 已经在 play 里吞掉。
    try { rec.anim.cancel() } catch { /* 已自然结束或已取消 */ }
  }
  /** 释放失效记录：元素已脱离文档，或该槽位已经换成别的节点。 */
  const sweep = (): void => {
    for (const sel of cols) {
      const rec = own.get(sel)
      if (rec === undefined) continue
      if (!rec.el.isConnected) { cancelOwn(sel); continue }
      const current = document.querySelector(sel)
      if (current !== null && current !== rec.el) cancelOwn(sel)
    }
  }
  const play = (sel: string, el: Element): void => {
    // 同列重开：先取消上一条自有动画，避免两条 fill:backwards 叠在一起互相抢手态。
    cancelOwn(sel)
    if (reduceMotion()) return
    const anim = el.animate(
      [
        { opacity: 0, transform: 'translateY(28px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 280, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' },
    )
    own.set(sel, { el, anim })
    // 自然结束后把记录摘掉（避免表无限增长）；cancel 造成的拒绝在此静默。
    anim.finished.then(() => {
      if (own.get(sel)?.anim === anim) own.delete(sel)
    }).catch(() => {})
  }
  return {
    name: 'sheet-rise-replay',
    // 含树变更键 `*`：父容器被整体从祖父节点摘掉时，childList 的 target 是**祖父**，
    // 局部观察器收不到回调；改为复用 reconciler 的共享全树观察（frame-marker /
    // header-metrics / stats-line 已用同一通道）。代价由下面的便宜路径压住：没有自有动画、
    // 也没有目标列时，只做 2 次 querySelector 就返回，**不**读样式、**不**播放、**不**写 DOM。
    scopes: [
      '*',
      'style',
      'class',
      'data-aionui-explorer-open',
      'data-aionui-preview-open',
      'data-mobile-preview-full',
    ],
    ensure: () => {
      const els = cols.map((sel) => document.querySelector(sel))
      // 便宜路径：手上没有自有动画、两个槽位也都不在 ⇒ 立刻返回。
      if (own.size === 0 && els[0] === null && els[1] === null) return
      sweep()
      for (let i = 0; i < cols.length; i++) {
        const sel = cols[i]!
        const el = els[i]!
        // 槽位缺席：释放该列的所有权记录（旧实现直接 continue，记录会一直挂着）。
        // 刻意**不**动 seen ——「摘掉再挂回来是否重播」沿用既有语义，不做行为变更。
        if (el === null) { cancelOwn(sel); continue }
        const rec = own.get(sel)
        if (rec !== undefined && rec.el !== el) cancelOwn(sel)
        const visible = getComputedStyle(el).visibility === 'visible'
        const prev = seen.get(sel) ?? false
        if (visible && !prev) play(sel, el)
        seen.set(sel, visible)
      }
    },
    dispose: () => {
      // 停用/卸载：取消自己启动的动画（fill:backwards 的起手态否则会留在元素上）。
      for (const sel of cols) cancelOwn(sel)
      own.clear()
      seen.clear()
    },
  }
}
