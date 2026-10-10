import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MobileNavToggle } from './components/MobileNavToggle.tsx'
import { MobileDrawerFooter } from './components/MobileDrawerFooter.tsx'
import { ComposerFileButton } from './components/ComposerFileButton.tsx'
import { openFilesPanel } from './components/open-files-panel.ts'
import { MOBILE_CSS } from './styles/index.ts'

import { installFrameController, installOverlayInteractions, installPhoneChrome, installReconciler, installSelectionChromeYield, registerReconcileTasks, MOBILE_QUERY } from './effects/phone-chrome.ts'
import { installSidebarSwipe } from './effects/sidebar-swipe.ts'
import { installSubagentChipTouch } from './effects/subagent-chip-touch.ts'
import { installSessionMenuDelete } from './effects/session-menu.ts'
import { installComposerKeyboardGuard } from './effects/composer-keyboard-guard.ts'
import { installComposerKeyboardLift } from './effects/composer-keyboard-lift.ts'
import { installComposerPlusToggle } from './effects/composer-plus-toggle.ts'
import { installWorkspaceChipToggle } from './effects/workspace-chip-toggle.ts'
import { installTeamChipToggle } from './effects/team-chip-toggle.ts'
import { installModelMenuAnchor } from './effects/model-menu-anchor.ts'
import { installShortcutModalKeyboardGuard } from './effects/shortcut-modal-keyboard-guard.ts'
import { installModelMenuKeyboardGuard } from './effects/model-menu-keyboard-guard.ts'
import { installPluginCardTap } from './effects/plugin-card-tap.ts'
import { installSessionFocusGuard } from './effects/session-focus-guard.ts'
import { installReasoningDefaults } from './effects/reasoning-defaults.ts'
import { installAionuiCompat } from './effects/aionui-compat.ts'
import { installComposerPasteGuard } from './effects/composer-paste-guard.ts'
import { installComposerFilePicker } from './effects/composer-file-picker.ts'
import { installAttachmentMention } from './effects/attachment-mention.ts'
import { installFileShare } from './effects/file-share.ts'
import { createPanelExit, installPanelRowExit } from './effects/panel-exit.ts'
import { createRafScheduler } from './core/raf-scheduler.ts'
import { installDebugBadge } from './debug.ts'
import { NS, en, zh } from './i18n/locales.ts'
import type { MobileNavKey } from './i18n/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Directory-drawer controls copy. */
    'dshWebMobileNav': MobileNavKey
  }
}

/**
 * Required services (cordis fiber inject — the loader passes all module exports
 * as an object plugin). `inject` is a HARD dependency: a missing service stops
 * the whole plugin from loading, so nothing may be listed here that the client
 * does not actually read (issue #86 removed the never-read `workspaces`).
 */
export const inject = ['slots', 'layout', 'locale', 'sessionLogDownload', 'sessions']

/**
 * Session-id shape the installed host's sessionLogDownload.download expects.
 * Derived, never imported, so one program type-checks against every host
 * generation: 0.1.1 types the parameter as plain string, 0.1.2-alpha.1 brands
 * it Branded<'SessionId'>. The runtime value is always the host's own id.
 */
type DownloadSessionId = Parameters<ClientContext['sessionLogDownload']['download']>[0]

/**
 * How long a remembered scroll position stays usable (see {@link restoreConversationScroll}).
 * The gap between our teardown and re-apply is one dynamic import inside the host's
 * client-modules queue — well under a second in practice; ten is generous.
 */
const SWAP_RESTORE_MS = 10_000

/** Scroll offsets captured right before our stylesheet is torn down by a hot swap. */
let scrollsBeforeSwap: number[] | null = null
/** Wall clock of that capture, so a stale stash can never move the user's view. */
let scrollSavedAt = 0

/** The host's conversation scrollers (`_scrollBody` is the `overflow-y:auto` box). */
function conversationScrollers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-mobile-nav="frame"] [class*="scrollBody"]')]
}

/**
 * Remember where the conversation was before a hot swap tears our stylesheet down.
 *
 * The host's `client-modules.replace()` (tearDown → import → refresh) removes this
 * plugin's `<style>` for a beat; without it the long-conversation
 * `content-visibility` rules vanish, the whole conversation re-lays out, and
 * Chromium re-anchors the scroller at the top — the owner's 2026-10-07 report
 * 「聊到一半突然闪到最上面」. Captured only when something is actually scrolled.
 */
function rememberConversationScroll(): void {
  const tops = conversationScrollers().map((element) => element.scrollTop)
  scrollsBeforeSwap = tops.some((top) => top > 0) ? tops : null
  scrollSavedAt = Date.now()
}

/**
 * Put the conversation back where {@link rememberConversationScroll} found it.
 *
 * Deliberately narrow: only a fresh stash is used, and only for a scroller that is
 * now at 0 — that is exactly the "yanked to the top" symptom. A scroller the host
 * moved on purpose (auto-scroll to the newest message) is left alone, and a normal
 * page load has no stash at all, so this is a no-op outside hot swaps.
 */
function restoreConversationScroll(): void {
  const tops = scrollsBeforeSwap
  const savedAt = scrollSavedAt
  scrollsBeforeSwap = null
  if (tops === null || Date.now() - savedAt > SWAP_RESTORE_MS) return
  requestAnimationFrame(() => {
    conversationScrollers().forEach((element, index) => {
      const top = tops[index]
      if (top !== undefined && top > 0 && element.scrollTop === 0) element.scrollTop = top
    })
  })
}

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
    // 热换后的滚动回位（2026-10-07 店主：「聊到一半突然闪到最上面」）。
    // 宿主热换插件走 client-modules.replace()：tearDown → import → refresh，
    // 我们这张表在窗口里会**整个消失**，长会话的 content-visibility 估算与布局
    // 翻转会让 Chromium 把会话滚动区重锚到顶部。卸载前记下位置、重挂后回填。
    restoreConversationScroll()
    return () => {
      rememberConversationScroll()
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

  // Selection handle drag: while a conversation selection is live the header drops
  // out of the hit test, so the native extent stays local instead of snapping to the
  // flow's first item and revealing it (teleporting to the top of the session).
  installSelectionChromeYield(ctx)



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
  // iOS: the host Lexical scroll helper mis-scrolls the window on every
  // keystroke (issue #149); pin the composer seat above the keyboard.
  installComposerKeyboardLift(ctx)
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
  // Model / reasoning-level menu (owner report 2026-10-07): drilling into the
  // model pane focuses the host's 「搜索模型…」 field from a passive effect, so the
  // keyboard covers the list the user just opened. Same method-shadow cure,
  // armed from the capture-phase tap that precedes the pane switch.
  installModelMenuKeyboardGuard(ctx)
  installPluginCardTap(ctx)
  // Entering a session (issue #140): the host's InputBar focuses the editor
  // from a [locked, sessionId, editor] passive effect on every switch, which
  // raises the soft keyboard over the history the user wanted to read. A short
  // shadow-focus window per observed session switch swallows that one
  // autofocus; real taps are unaffected.
  installSessionFocusGuard(ctx)
  installReasoningDefaults(ctx)

  // Multi-line paste after an IME commit keeps only the first line (host
  // Lexical routes Android's insertText paste through the text-insertion
  // command). Re-dispatch those as a paste event; mobile-only.
  installComposerPasteGuard(ctx)

  // Composer paperclip (owner report 2026-10-06): the system file picker is the
  // wrong shape and cannot pick "images only", so the tap opens the plugin's own
  // two-option sheet (上传图片 / 上传附件) and hands the choice back to the host's
  // hidden input. Intake stays fully host-owned.
  installComposerFilePicker(ctx)

  // @ menu 「本次附件」: mention the composer's draft attachments as locked chips.
  installAttachmentMention(ctx)

  installPhoneChrome(ctx)

  installAionuiCompat(ctx)

  // Mobile file sharing: Files-tree row buttons + preview header button
  // (official 0.2.0 slots), share sheet with download fallback.
  installFileShare(ctx)

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