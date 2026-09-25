import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MobileNavToggle } from './components/MobileNavToggle.tsx'
import { MobileDrawerFooter } from './components/MobileDrawerFooter.tsx'
import { ComposerFileButton } from './components/ComposerFileButton.tsx'
import { openFilesPanel } from './components/open-files-panel.ts'
import { MOBILE_CSS } from './styles/index.ts'

import { installFrameController, installOverlayInteractions, installPhoneChrome, installReconciler, registerReconcileTasks, MOBILE_QUERY } from './effects/phone-chrome.ts'
import { installSidebarSwipe } from './effects/sidebar-swipe.ts'
import { installSubagentChipTouch } from './effects/subagent-chip-touch.ts'
import { installSessionMenuDelete } from './effects/session-menu.ts'
import { installComposerKeyboardGuard } from './effects/composer-keyboard-guard.ts'
import { installComposerPlusToggle } from './effects/composer-plus-toggle.ts'
import { installWorkspaceChipToggle } from './effects/workspace-chip-toggle.ts'
import { installTeamChipToggle } from './effects/team-chip-toggle.ts'
import { installModelMenuAnchor } from './effects/model-menu-anchor.ts'
import { installShortcutModalKeyboardGuard } from './effects/shortcut-modal-keyboard-guard.ts'
import { installAionuiCompat } from './effects/aionui-compat.ts'
import { createPanelExit, installPanelRowExit } from './effects/panel-exit.ts'
import { createRafScheduler } from './core/raf-scheduler.ts'
import { installDebugBadge } from './debug.ts'
import { NS, en, zh } from './i18n/locales.ts'
import type { MobileNavKey } from './i18n/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Directory-drawer controls copy. */
    'mobileNav': MobileNavKey
  }
}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'layout', 'locale', 'sessionLogDownload', 'sessions', 'workspaces']

/**
 * Session-id shape the installed host's sessionLogDownload.download expects.
 * Derived, never imported, so one program type-checks against every host
 * generation: 0.1.1 types the parameter as plain string, 0.1.2-alpha.1 brands
 * it Branded<'SessionId'>. The runtime value is always the host's own id.
 */
type DownloadSessionId = Parameters<ClientContext['sessionLogDownload']['download']>[0]

/**
 * Mobile-adaptive shell, browser half: injects the mobile stylesheet, then
 * contributes the directory toggle to the session header and the backdrop +
 * floating button to the shell overlay.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-web-mobile: dictionaries')

  ctx.effect(() => {
    // 先清掉可能残留的同 id 样式表。
    // 2026-09-23：app 的 P8 自愈会把 client.js 换回上游版、页面里也随之挂着
    // **上游那份 CSS**；我们重新部署产物后，只 append 不清旧的话，页面里那份旧表
    // 仍然压在上面（实测：开关/权限图标/头部留白改完"看着没生效"）。
    // 本插件是原地热重载（不整页刷新），所以这一步必须自己保证"页面里的样式表
    // 就是当前产物里的这一份"。
    for (const stale of document.querySelectorAll('style[data-plugin-css="dsh-web-mobile/mobile.css"]')) {
      stale.remove()
    }
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-web-mobile'
    tag.dataset.pluginCss = 'dsh-web-mobile/mobile.css'
    tag.textContent = MOBILE_CSS
    document.head.appendChild(tag)
    // Keep this stylesheet last in <head> so its overrides win over the
    // host UI's own styles (some host rules also use !important).
    setTimeout(() => {
      if (tag.isConnected) document.head.appendChild(tag)
    }, 0)
    return () => {
      tag.remove()
    }
  }, 'dsh-web-mobile: styles')

  // Hard-fix the installed-plugins list text layout: the host market UI
  // injects its own CSS after this plugin's stylesheet, so CSS overrides can
  // be beaten. Inline !important styles win over every external rule. Keep
  // the selector on outer rows only; irowActions/irowTrailing are nested
  // flex containers and must retain the market's own action geometry.
  ctx.effect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const rowSelector = '[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"])'
    const set = (el: HTMLElement, props: Record<string, string>): void => {
      for (const [key, value] of Object.entries(props)) {
        el.style.setProperty(key, value, 'important')
      }
    }
    const unset = (el: HTMLElement, props: readonly string[]): void => {
      for (const key of props) el.style.removeProperty(key)
    }
    const rowProps = ['flex-wrap', 'align-items', 'gap'] as const
    const firstProps = ['flex', 'max-width', 'min-width'] as const
    const textProps = ['white-space', 'overflow', 'text-overflow', 'max-width'] as const
    const clear = (): void => {
      document.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
        unset(row, rowProps)
        const first = row.children[0] as HTMLElement | undefined
        if (first) unset(first, firstProps)
        row.querySelectorAll<HTMLElement>(':scope > button, :scope > [class*="owner"], :scope > [class*="grow"]').forEach((el) => {
          unset(el, ['order'])
        })
        const spec = row.querySelector<HTMLElement>('[class*="spec"]')
        const nm = row.querySelector<HTMLElement>('[class*="nm"]')
        if (spec) unset(spec, textProps)
        if (nm) unset(nm, textProps)
      })
    }
    const apply = (): void => {
      // The market rows only exist while the market UI is mounted (inside a
      // settings dialog). Skip the full-document class-substring scan on every
      // streamed mutation frame with no dialog open; dshmarket keeps the
      // data-dsh-market-root marker (1.20.x), [role="dialog"] covers the
      // settings dialog generically so a marker change degrades to cost, not
      // to a silently dead effect.
      if (document.querySelector('[data-dsh-market-root], [role="dialog"]') === null) return
      document.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
        set(row, {
          'flex-wrap': 'wrap',
          'align-items': 'center',
          'gap': '4px 10px',
        })
        const first = row.children[0] as HTMLElement | undefined
        if (first) {
          set(first, {
            'flex': '1 1 100%',
            'max-width': '100%',
            'min-width': '0',
          })
        }
        const spec = row.querySelector<HTMLElement>('[class*="spec"]')
        const nm = row.querySelector<HTMLElement>('[class*="nm"]')
        if (spec) {
          set(spec, {
            'white-space': 'nowrap',
            'overflow': 'hidden',
            'text-overflow': 'ellipsis',
            'max-width': '100%',
          })
        }
        if (nm) {
          set(nm, {
            'white-space': 'nowrap',
            'overflow': 'hidden',
            'text-overflow': 'ellipsis',
            'max-width': '100%',
          })
        }
      })
    }
    const arm = (): void => {
      clear()
      if (mq.matches) apply()
    }
    arm()
    // Streaming floods this observer with document-wide childList batches;
    // coalesce to one apply per frame and re-check the breakpoint at flush
    // time so a queued callback never writes mobile styles on desktop.
    const scheduler = createRafScheduler(
      (cb) => window.requestAnimationFrame(cb),
      (id) => window.cancelAnimationFrame(id),
    )
    const mo = new MutationObserver(() => {
      if (mq.matches) scheduler.schedule(() => { if (mq.matches) apply() })
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    mq.addEventListener('change', arm)
    return () => {
      scheduler.cancel()
      mo.disconnect()
      mq.removeEventListener('change', arm)
      clear()
    }
  }, 'dsh-web-mobile: installed-list-inline-styles')


  // Leaving a sidebar panel. The host's panels replace the main area and ship
  // no way back, so every exit route (system back, re-tapping the selected
  // panel row, the FAB) shares this one action.
  const panelExit = createPanelExit(ctx.layout)

  // Shared mobile infrastructure: frame marker ownership and the single
  // full-tree reconciler. Installed inside one effect so a plugin reload in
  // the same JS environment tears the whole reconciler down and rebuilds it.
  ctx.effect(() => {
    const stops = [
      installFrameController(),
      installReconciler(ctx),
      registerReconcileTasks(ctx, panelExit),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }, 'dsh-web-mobile: reconciler infrastructure')



  // Drawer close interactions: Escape and navigation taps inside the drawer.
  installOverlayInteractions(ctx)

  // Sidebar panel exit: re-tapping the already-selected panel row returns to
  // the conversation (the system-back route is a reconciler task; both call the
  // same action).
  installPanelRowExit(ctx, panelExit.exit)

  // Session deletion, injected into each session row's ⋯ menu (beside
  // rename / fork / archive) with a confirm dialog. Mobile-only.
  installSessionMenuDelete(ctx)

  // Sidebar swipe gestures: edge swipe-in opens the drawer, content swipe-out
  // closes it (release-classified, zero inline transforms — A 档). Since
  // 2026-09-13 the layer also owns the right-edge files gesture (leftward
  // opens the files panel via openFilesPanel, rightward closes whatever is
  // on top — the panel or the drawer); a leftward stroke never collapses
  // anything.
  installSidebarSwipe(ctx, openFilesPanel)

  // Lineage-count chip: reliable open/close on touch pointers (upstream is
  // hover-timer driven and has no onClick on the count variant).
  installSubagentChipTouch(ctx)

  // iOS: tapping the composer's send/stop/+ buttons must not re-raise the
  // dismissed keyboard (upstream keepFocus focuses the editor on mousedown).
  installComposerKeyboardGuard(ctx)
  installComposerPlusToggle(ctx)
  // Hero workspace chip: the host's picker portaled its Menu with
  // `anchor={null}`, so its own outside-pointerdown close eats the trigger's
  // tap and the chip's toggle re-opens it. Swallow that one click.
  installWorkspaceChipToggle(ctx)
  // Agent Team chip: the host trigger only opens (its onClick focuses the panel
  // when open, never toggles), so a second tap could not close it. Dispatch the
  // outside pointerdown its own dismiss hook waits for, then swallow the click.
  installTeamChipToggle(ctx)
  // Model/reasoning menu portals to <body>; the CSS centering rule died with the
  // portal move, so re-anchor it on the trigger here (owner report: opens far left).
  installModelMenuAnchor(ctx)
  // Shortcut modal (settings → 通用设置 → 快捷键): the host focuses its search
  // field on open, which raises the soft keyboard over a page the user came to
  // EDIT, and the keyboard shrinking the viewport resizes the sheet (owner
  // report: 「打开的时候还是会闪，而且还会唤起键盘」).
  installShortcutModalKeyboardGuard(ctx)

  installPhoneChrome(ctx)

  installAionuiCompat(ctx)

  // Debug badge (?mobile-nav-debug=1): live state overlay for phone-side
  // repros. No-op without the query param (docs: README, AGENTS.md).
  installDebugBadge(ctx)

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'mobile-nav-toggle',
    order: 10,
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar(),
    }),
  }, MobileNavToggle))


  // Session log download, relocated from the session header to the drawer
  // footer on mobile (the header capsule is hidden by CSS). The footer's
  // Files action was removed on 2026-09-17 — see
  // docs/specs/2026-09-17-sidebar-files-coexistence-design.md.
  //
  // Footer stacking relies on the list-slot sort by (priority, order):
  // dsh-remote-web-ui leaves it unset (default 0, its two icon buttons stay
  // on top) and dsh-usage-stats uses 10. Order 5 keeps the session-log pill
  // directly under the icon row with the usage/balance badge below it —
  // instead of a tie at 10 where registration order could wedge the badge
  // between the icons and the pill.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'mobile-nav-session-log',
    order: 5,
    locale: NS,
    inject: () => ({
      // The component's internal id is a plain string (slot runtime typing);
      // the host-generation brand boundary lives here and only here, hence
      // the double assertion (string and Branded<'SessionId'> do not overlap).
      downloadSessionLog: (sessionId: string) =>
        ctx.sessionLogDownload.download(sessionId as unknown as DownloadSessionId),
    }),
  }, MobileDrawerFooter))

  // Composer file entry (0.1.6 host): the host deleted the paperclip attach
  // button, leaving the 「文件」row inside the "+" listbox as the only file
  // entry. Re-add a permanent one in the host's own conversation.input.left
  // seat (inside the tools lane, beside the plus button). It triggers the
  // host's hidden input[type=file] — the same fileInputRef.current.click()
  // the host's own command runs — so intake validation, upload and the
  // availability policy stay host-owned.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'mobile-nav-file-upload',
    order: 10,
    locale: NS,
    inject: () => ({}),
  }, ComposerFileButton))
}

// Type-only augmentation imports: pull the layout / conversation / sidebar /
// settings SlotMap merges and the sessionLogDownload service typing into this
// program without any runtime import.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-session-log-export/client'