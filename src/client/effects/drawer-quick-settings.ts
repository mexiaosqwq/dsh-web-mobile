// 抽屉一键设置图标（2026-10-20，spec `docs/specs/2026-10-20-drawer-quick-settings.md`）。
//
// 宿主把「设置入口」并进了账户 launcher：`settingsArea` 渲染
// `renderSlot("settings.launcher", { openSettings })`，而
// `@deepseek-ai/dsh-client-ui-settings-account` 占着这个槽注册成账户菜单，
// 宿主自带的一键齿轮 fallback（`settings.trigger`）因此永不渲染。手机上打开设置
// 于是固定两步：点页脚账户行 → 点菜单第一项。
//
// 本 task 在同一行右端补一颗插件自有齿轮，一击打开设置：**复刻用户路径**
// （点账户 launcher，下一帧点菜单第一项）。没有更短的官方通道——设置面板的状态在
// settings shell 自己的 store 里，`settings.open` 快捷键命令不向第三方插件开放调用，
// 合成 KeyboardEvent 实测不生效（2026-10-20）。链的两处天花板写在下面两处注释里。
//
// 2026-10-21 用户追加两条：齿轮盒放大到 36×36（原 28）、左移 6px；账户菜单里那份
// 「设置」项收起（「把原来的打开方式进行删除，只保留这个」）——宿主 items 数组写死
// settings 打头且 DOM 无 id 可读，只能在菜单节点上打标记让 CSS 收起第一项。齿轮让位
// （连接条守卫把它隐藏）时标记摘掉，那段时间账户菜单仍是唯一入口。
// 2026-10-22 用户「还是太大了」：盒 36→30、图标 20→17（同比例），位置不动。
//
// 同一行右端还有宿主的连接状态条（`ConnectionIndicator`：connecting/disconnected
// 渲染 `button[data-phase]`，recovered 渲染 `div[role="status"]`），它 flex:none、
// 中文约 136px、英文约 190px，会把 260px 的行挤满。两者的共存由 CSS 守卫决定
// （连接条在场时齿轮让位，`styles/base.css.ts` 的 `drawer-quick-settings-chip-guard`）。
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReconcilerTask } from '../core/reconciler-core.ts'
import { NS } from '../i18n/locales.ts'
import { getFrame } from '../platform/frame.ts'

/**
 * 17px 设置描边图形：宿主 `IconSettingsOutlineMedium` 的两条 path
 * （`dsh-client-ui-primitives`，`stroke-width: 1.3`），viewBox 仍是 16 格、按 17px 渲染。
 * 2026-10-21 用户「UI太小了!」由 16px 放大到 20px；2026-10-22 用户「还是太大了」按盒子
 * 36→30 同比例缩回 17px（20 × 30/36）。内联因为本节点不经 React 构建。
 */
const SETTINGS_SVG = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke-width="1.3">'
  + '<path d="M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z" stroke="currentColor"/>'
  + '<path d="M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z" stroke="currentColor" stroke-miterlimit="10"/>'
  + '</svg>'

/**
 * 账户行的锚点：抽屉侧栏列里的 `triggerRow`（settingsArea 里那一行）。
 * 前缀匹配按仓库约定用子串，绝不用属性后缀。
 */
const ROW_SELECTOR = '[class*="sidebarCol"] [class*="triggerRow"]'

/** 账户 launcher 的唯一稳定特征：`aria-haspopup="menu"` 的按钮。 */
const ACCOUNT_TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]'

/**
 * 菜单项还没落地时的收尾时限：超时仍展开就回点 launcher 收起。
 * 400ms 覆盖宿主从 click 到 React 挂菜单的一帧 + 慢机余量。
 */
const MENU_SETTLE_MS = 400

/**
 * 标记属性：打在**账户菜单**节点上，CSS 借此收起它的第一项（设置）。
 * 值恒为空串；属性名跟 `data-mobile-nav-quick` 同族，不进 `[data-mobile-nav]` 语义。
 */
const MENU_ENTRY_ATTR = 'data-mobile-nav-quick-menu'

/** 已标记菜单的选择器（dispose 与让位时清场用）。 */
const MENU_ENTRY_SELECTOR = '[data-mobile-nav-quick-menu]'

/**
 * 抽屉页脚账户行右端的一键设置齿轮。
 *
 * 任务靠 `getFrame()` 只在移动分支存在时注入（桌面帧标记不存在 → 直接 no-op），
 * `scopes: ['*']` 让宿主 React 重建该行后由 `ensure()` 幂等重挂。
 *
 * @param ctx - 客户端根上下文：locale 文案。
 * @returns reconciler 任务。
 */
export function createDrawerQuickSettingsTask(ctx: ClientContext): ReconcilerTask {
  const t = ctx.locale.bind(NS)
  let wrap: HTMLSpanElement | null = null
  let button: HTMLButtonElement | null = null
  let pending: number | null = null

  const row = (): HTMLElement | null => {
    const frame = getFrame()
    if (frame === null) return null
    return frame.querySelector<HTMLElement>(ROW_SELECTOR)
  }

  const clearPending = (): void => {
    if (pending === null) return
    window.clearTimeout(pending)
    pending = null
  }

  /**
   * 点击链：账户 launcher → 下一帧 → 菜单第一项（宿主 `AccountMenu` 的 items
   * 顺序固定以 `settings` 开头；它按 `onSelect(id)` 分发，DOM 里没有 id 可读，
   * 所以只能认「第一个 menuitem」）。宿主的菜单是 portal 到 body 的单例列表，
   * 这里取最后一个即刚打开的那一个，并以 launcher 的 `aria-expanded` 复核。
   * 第一项此刻被 `syncMenuEntry` 的标记 + CSS `display: none` 收起了——`click()`
   * 不要求元素可见，链照旧点它；改成「点第一个可见项」会点到 Feedback。
   */
  const selectSettingsItem = (trigger: HTMLButtonElement): void => {
    const root = document.documentElement
    root.setAttribute('data-mobile-nav-quick', '')
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      clearPending()
      root.removeAttribute('data-mobile-nav-quick')
    }
    const expanded = (): boolean => trigger.getAttribute('aria-expanded') === 'true'
    if (!expanded()) trigger.click()
    // 中间帧不闪：标记在场时 CSS 让菜单不可见，`click()` 不要求元素可见。
    requestAnimationFrame(() => {
      const menus = document.querySelectorAll<HTMLElement>('[role="menu"]')
      const menu = expanded() && menus.length > 0 ? menus[menus.length - 1] : null
      const item = menu?.querySelector<HTMLElement>('[role="menuitem"]') ?? null
      if (item === null) {
        // 菜单没开或没有可选项：把我们可能开出来的菜单收回去，不留屏。
        if (expanded()) trigger.click()
        settle()
        return
      }
      item.click()
      pending = window.setTimeout(() => {
        // 选中后菜单自己会关；仍展开说明宿主结构漂移，回点一次兜底。
        if (expanded()) trigger.click()
        settle()
      }, MENU_SETTLE_MS)
    })
  }

  const onClick = (): void => {
    const target = row()
    if (target === null) return
    const trigger = target.querySelector<HTMLButtonElement>(ACCOUNT_TRIGGER_SELECTOR)
    if (trigger === null) return
    selectSettingsItem(trigger)
  }

  const build = (): void => {
    wrap = document.createElement('span')
    wrap.dataset.mobileNav = 'quick-settings-wrap'
    button = document.createElement('button')
    button.type = 'button'
    button.dataset.mobileNav = 'quick-settings'
    button.setAttribute('aria-label', t('quickSettings'))
    button.setAttribute('aria-haspopup', 'dialog')
    button.title = t('quickSettings')
    button.innerHTML = SETTINGS_SVG
    button.addEventListener('click', onClick)
    wrap.appendChild(button)
  }

  /**
   * 齿轮此刻在不在场：唯一会隐藏它的是连接条守卫（`drawer-quick-settings-chip-guard`），
   * 条件就是行的**直接孩子**里有连接条（`button[data-phase]` / `[role="status"]`）。
   * 这里镜像同一判据而不是读计算样式——两处口径必须一致，改守卫时一起改。
   */
  const gearAvailable = (target: HTMLElement): boolean =>
    ![...target.children].some((child) =>
      child.getAttribute('data-phase') !== null || child.getAttribute('role') === 'status')

  /** 摘掉所有菜单上的标记（齿轮让位或 dispose 时用）。 */
  const clearMenuEntry = (): void => {
    for (const menu of document.querySelectorAll<HTMLElement>(MENU_ENTRY_SELECTOR)) {
      menu.removeAttribute(MENU_ENTRY_ATTR)
    }
  }

  /**
   * 收起账户菜单里的「设置」项（2026-10-21 用户：「把原来的打开方式进行删除，只保留这个」）。
   *
   * 宿主 `AccountMenu` 的 items 数组把 `settings` 写在第一位、DOM 里没有 id 可读，插件也不能
   * 改宿主源码，所以只在**那一个**菜单节点上打标记、由 CSS 收起第一项。菜单 portal 到 body、
   * 与账户行没有结构关系，唯一能认出它的是点击链用的同一判据：账户 launcher 此刻
   * `aria-expanded="true"` → 文档里最后一个 `[role="menu"]` 就是它。
   *
   * 齿轮让位（连接条在场）时不打标记：那段时间账户菜单是设置的唯一入口。
   */
  const syncMenuEntry = (target: HTMLElement): void => {
    const menus = document.querySelectorAll<HTMLElement>('[role="menu"]')
    const menu = menus.length > 0 ? menus[menus.length - 1] ?? null : null
    if (menu === null) return
    const trigger = target.querySelector<HTMLButtonElement>(ACCOUNT_TRIGGER_SELECTOR)
    const keep = trigger !== null && trigger.getAttribute('aria-expanded') === 'true' && gearAvailable(target)
    if (!keep) {
      menu.removeAttribute(MENU_ENTRY_ATTR)
      return
    }
    // 幂等：写过的属性不再重写，免得自己的 mutation 把任务再唤醒一轮。
    if (!menu.hasAttribute(MENU_ENTRY_ATTR)) menu.setAttribute(MENU_ENTRY_ATTR, '')
  }

  return {
    name: 'drawer-quick-settings',
    scopes: ['*'],
    ensure: () => {
      const target = row()
      if (target === null) return
      if (button === null || wrap === null) build()
      if (wrap !== null && wrap.parentElement !== target) target.appendChild(wrap)
      syncMenuEntry(target)
    },
    dispose: () => {
      clearPending()
      document.documentElement.removeAttribute('data-mobile-nav-quick')
      clearMenuEntry()
      wrap?.remove()
      wrap = null
      button = null
    },
  }
}
