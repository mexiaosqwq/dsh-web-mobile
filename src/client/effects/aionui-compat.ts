import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { getFrame } from '../platform/frame.ts'
import { installMobileEffect } from '../platform/breakpoints.ts'

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
    // bypass the suite's Android check. The spoof is global, so it must be
    // restore-safe: one in-flight timer, re-entrancy guarded, and always
    // restored on effect disposal (narrow→wide / plugin reload).
    const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    const DESKTOP_APPVERSION = '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    let restoreTimer: number | null = null
    let spoofed = false
    // Restore what was actually there: an own descriptor if the page had one,
    // otherwise REMOVE the own property we added so the prototype's getter shows
    // through again. Writing the old VALUE back as an own property leaves a
    // permanent own-property shadow behind (issue #86), which changes
    // `Object.keys(navigator)` / descriptor probes for the rest of the session.
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
}

export function createPreviewCloseTask(): ReconcilerTask {
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
      if (pv === null) return
      if (pv.style.visibility === 'hidden') {
        getFrame()?.removeAttribute('data-aionui-preview-open')
        getFrame()?.removeAttribute('data-mobile-preview-full')
      }
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
