/**
 * Session-row action-menu injection: on touch-primary devices, adds a
 * "delete session" item to the host's per-row ⋯ menu (beside the host's own
 * items — rename / fork / archive, plus the 0.1.7 pin item; blank rows stay
 * host-native) and drives the whole delete flow: row → session id
 * resolution, a confirm dialog, the host delete endpoint, and the list
 * refresh.
 *
 * The host menu is React-owned (ui-workspace) with no extension slot, so the
 * item is injected into the portaled `[role="menu"]` list by cloning the
 * host's own item markup (reusing the hashed classes keeps the styling
 * identical), and re-injected whenever React recreates the menu. Two menu
 * shapes are supported: rc.2 nests icon/label spans in the item, while 0.1.5
 * renders the label directly in the item button (shared `_item_1nxmc_92`
 * menu component, no child elements) — label reads and the injected text
 * fall back across both.
 *
 * Row → session id: session rows carry no id in the DOM, so the session is
 * resolved from the client list by display title (the row's rendered title IS
 * the summary's `displayTitle`); duplicate titles are disambiguated by the
 * row's position within its workspace group section.
 *
 * Ported from community-fork wzxmt-zhc v2.7.0; the only mainline delta is
 * where the delete-dialog CSS lives: base.css.ts, with corrected animation
 * names (`dsh-web-mobile-*`; the fork's originals referenced the pre-rename
 * `dsh-mobile-nav-*` names, which silently no-op).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MOBILE_QUERY, TOUCH_QUERY, installMobileEffect, toggleDrawer } from './phone-chrome.ts'
import { currentSessionIdOf, sessionsCanClear } from '../core/sessions-compat.ts'

// Mirrored from src/client/locales.ts: the custom client bundler cannot
// resolve `../` requires from effects/. Keep in sync.
const NS = 'mobileNav'
/** The ui-workspace dictionary namespace the host session menu labels come from. */
const WORKSPACE_NS = 'workspace'

/** Marker on the injected menu item (idempotence across React re-renders). */
const DELETE_ITEM_MARKER = 'data-mobile-nav="session-delete"'

/** Danger accent read from the theme, with a fixed fallback. */
const DANGER_COLOR = 'var(--dsw-alias-state-error-primary, #b91c1c)'

/** 16px outline trash glyph (IconTrashOutline16 path), currentColor-filled. */
const TRASH_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 14.1367 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z" fill="currentColor" /></svg>'

/** One captured session-row menu anchor. */
interface MenuAnchor {
  /** The ⋯ button that opened the menu (used to close it). */
  button: HTMLButtonElement
  /** The session row the button lives in. */
  row: HTMLElement
  /** The row's displayed session title. */
  title: string
}

/** Host delete-endpoint response shape. */
interface DeleteResponse {
  ok?: true
  deleted?: string
  error?: { code?: string; message?: string }
}

/** Escape text destined for innerHTML (session titles are user content). */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Install the mobile session-delete menu machinery. Touch-gated: the whole
 * effect arms under TOUCH_QUERY — (pointer: coarse) at EVERY width — so a
 * large tablet in landscape keeps the desktop layout but still gets the
 * delete item, while any mouse-driven or pointer-less window stays a
 * complete no-op. Returns a disposer (via installMobileEffect) that removes
 * every listener, observer, injected node, and the confirm dialog.
 * @param ctx - client root context.
 */
export function installSessionMenuDelete(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: session-menu delete', () => {
    const navT = ctx.locale.bind(NS)
    // Host workspace-browser dictionary for menu-signature detection. Bound
    // lazily so a later-registered dictionary is picked up; the general
    // overload accepts the raw namespace id.
    const wsT = (key: string, params?: Record<string, unknown>): string =>
      ctx.locale.bind(WORKSPACE_NS)(key, params)

    let anchor: MenuAnchor | null = null
    let injectRaf = 0
    let dialogHost: { backdrop: HTMLElement; card: HTMLElement } | null = null
    let closeDialogOnKey: ((event: KeyboardEvent) => void) | null = null

    /** Resolve one session id for a row: title match, group position tiebreak. */
    const resolveSessionId = (row: HTMLElement, title: string): string | undefined => {
      const sessions = ctx.sessions.list.getSnapshot()
      const workspaces = ctx.workspaces.list.getSnapshot()
      const archived = new Set(workspaces.archivedSessionIds)
      const candidates = sessions.ids.filter((id: string) => {
        const summary = sessions.byId[id]
        return summary !== undefined && !summary.blank && summary.displayTitle === title && !archived.has(id)
      })
      if (candidates.length === 1) return candidates[0]
      if (candidates.length === 0) return undefined
      // Duplicate titles: the row's position among its group's same-title
      // rows maps 1:1 onto the same-title ids of that group's account.
      const group = row.closest<HTMLElement>('[class*="_groupSection"]')
      if (group === null) return undefined
      const headerTitle = group
        .querySelector<HTMLElement>(':scope > [class*="_projectRow"] [class*="_title"]')
        ?.textContent?.trim()
      const owned = new Set(workspaces.items.flatMap((workspace: { sessionIds: readonly string[] }) => workspace.sessionIds))
      const workspace = headerTitle === undefined
        ? undefined
        : workspaces.items.find((candidate: { title: string; sessionIds: readonly string[] }) => candidate.title === headerTitle)
      const workspaceIds: readonly string[] = workspace === undefined ? [] : workspace.sessionIds
      const groupIds: readonly string[] = workspace === undefined
        ? sessions.ids.filter((id: string) => !owned.has(id) && !archived.has(id) && sessions.byId[id] !== undefined)
        : workspaceIds.filter(id => !archived.has(id) && sessions.byId[id] !== undefined)
      const sameTitleGroupIds = groupIds.filter(id => sessions.byId[id]?.displayTitle === title)
      const rows = [...group.querySelectorAll<HTMLElement>(':scope > [class*="_sessionRow"]')]
      const rowIndex = rows.indexOf(row)
      const sameTitleBefore = rowIndex === -1
        ? 0
        : rows.slice(0, rowIndex).filter(candidate =>
          candidate.querySelector<HTMLElement>('[class*="_title"]')?.textContent?.trim() === title,
        ).length
      return sameTitleGroupIds[sameTitleBefore]
    }

    /**
     * Read one menu item's visible label across host generations: rc.2 nests
     * the text in an `_itemLabel` span (beside an `_itemIcon`), while 0.1.5
     * puts it directly in the button (`_item_1nxmc_92`, no child elements).
     * Falling back to the item's own textContent covers both — svg icons
     * contribute no text, so rc.2 items read identically either way.
     */
    const itemLabel = (item: HTMLElement): string => {
      const label = item.querySelector<HTMLElement>('[class*="_itemLabel"]')
      return (label ?? item).textContent?.trim() ?? ''
    }

    /**
     * Whether a menu list is the host's per-session row menu. Containment
     * style, never an exact item count: 0.1.7 added a fourth 「置顶会话」
     * item (menu.pinSession, alongside rename / fork / archive) — a
     * `length === 3` gate silently disabled the whole feature on 0.1.7.
     * rename + fork + archiveSession is the discriminating triple (a
     * full-host label audit: the fork label exists only in ui-workspace's
     * session menu). Archived rows swap archive for 取消归档, so they do NOT
     * match this signature and get no delete item — the host's own look
     * (delete via unarchive first); resolution excludes archived ids anyway,
     * so an injected item there would be a doomed deleteErrorResolve tap
     * (#V1 N1: the removed unarchive branch used to inject exactly that).
     */
    const isSessionMenu = (menu: HTMLElement): boolean => {
      const labels = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .map(itemLabel)
      const rename = wsT('rename')
      const fork = wsT('menu.fork')
      return labels.includes(rename) && labels.includes(fork)
        && labels.includes(wsT('menu.archiveSession'))
    }

    const closeDialog = (): void => {
      if (closeDialogOnKey !== null) {
        document.removeEventListener('keydown', closeDialogOnKey, true)
        closeDialogOnKey = null
      }
      if (dialogHost !== null) {
        dialogHost.backdrop.remove()
        dialogHost.card.remove()
        dialogHost = null
      }
    }

    /** Show the delete confirmation as a centered frosted-glass modal over
     *  the frame. Mounted on <body>, NOT in the frame: the third-party mobile
     *  shim (@linxin666/dsh-web-all) listens in the CAPTURE phase on the frame
     *  and, while the drawer is open, answers every click inside the frame but
     *  outside [data-pane="sidebar"] with preventDefault + stopPropagation.
     *  A card inside the frame therefore had dead buttons — measured
     *  2026-09-14: a real touch tap on 「取消」 left the card open, and only
     *  Escape closed it. Body-level, the shim's listener never sees these
     *  clicks (its sibling menus are portaled there for the same reason), and
     *  the dialog's band lives in base.css (backdrop z 1400 above the drawer
     *  on the mobile branch). The card is appended INTO the backdrop so the
     *  backdrop's flex centers it (base.css 2026-09-24 rework). */
    const showDeleteDialog = (sessionId: string, title: string): void => {
      closeDialog()
      const host = document.body
      const backdrop = document.createElement('div')
      backdrop.dataset.mobileNav = 'delete-dialog-backdrop'
      const card = document.createElement('div')
      card.dataset.mobileNav = 'delete-dialog'
      card.setAttribute('role', 'dialog')
      card.setAttribute('aria-modal', 'true')
      card.innerHTML = `
        <div data-mobile-nav="delete-confirm-title">${escapeHtml(navT('deleteConfirmTitle'))}</div>
        <div data-mobile-nav="delete-confirm-desc">${escapeHtml(navT('deleteConfirmDesc', { title }))}</div>
        <div data-mobile-nav="delete-confirm-actions">
          <button type="button" data-mobile-nav="delete-confirm-no">${escapeHtml(navT('deleteConfirmNo'))}</button>
          <button type="button" data-mobile-nav="delete-confirm-yes">${escapeHtml(navT('deleteConfirmYes'))}</button>
        </div>
        <div data-mobile-nav="delete-error" role="alert" hidden></div>`
      const noButton = card.querySelector<HTMLButtonElement>('[data-mobile-nav="delete-confirm-no"]')
      const yesButton = card.querySelector<HTMLButtonElement>('[data-mobile-nav="delete-confirm-yes"]')
      const errorLine = card.querySelector<HTMLElement>('[data-mobile-nav="delete-error"]')
      noButton?.addEventListener('click', closeDialog)
      // The card is a CHILD of the backdrop (the CSS centers it through the
      // backdrop's flex), so close only on genuine backdrop taps — without
      // the target guard every card click (the async yes tap included) would
      // bubble here and close the dialog before the fetch settles, killing
      // the pending state and the error display path.
      backdrop.addEventListener('click', (event) => {
        if (event.target !== backdrop) return
        closeDialog()
      })
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') closeDialog()
      }
      document.addEventListener('keydown', onKey, true)
      closeDialogOnKey = onKey

      const resetButtons = (): void => {
        if (yesButton !== null) {
          yesButton.disabled = false
          yesButton.textContent = navT('deleteConfirmYes')
        }
        if (noButton !== null) noButton.disabled = false
      }
      const fail = (message: string): void => {
        if (errorLine !== null) {
          errorLine.textContent = message
          errorLine.hidden = false
        }
        resetButtons()
      }
      const mapError = (payload: DeleteResponse | null, reason: unknown): string => {
        const code = payload?.error?.code
        if (code === 'session-not-found') return navT('deleteErrorNotFound')
        if (code === 'session-busy') return navT('deleteErrorBusy')
        const message = payload?.error?.message ?? (reason instanceof Error ? reason.message : String(reason))
        return navT('deleteErrorGeneric', { message })
      }
      yesButton?.addEventListener('click', async () => {
        yesButton.disabled = true
        if (noButton !== null) noButton.disabled = true
        yesButton.textContent = navT('deletePending')
        if (errorLine !== null) errorLine.hidden = true
        const wasCurrent = currentSessionIdOf(ctx.sessions.list.getSnapshot()) === sessionId
        try {
          const response = await fetch('/api/mobile-nav.session.delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
          const payload = await response.json().catch(() => null) as DeleteResponse | null
          if (!response.ok || payload === null || payload.ok !== true) {
            fail(mapError(payload, new Error(`HTTP ${response.status}`)))
            return
          }
        } catch (reason) {
          fail(mapError(null, reason))
          return
        }
        closeDialog()
        if (wasCurrent && sessionsCanClear(ctx.sessions)) ctx.sessions.clear()
        // Repull the baseline so the deleted row disappears. Must be called AS
        // A METHOD on ctx.sessions: refresh() reads `this.manager`, and an
        // extracted reference would throw "this is undefined" — the failure
        // mode that left deleted cold sessions lingering as ghost rows.
        const sessions = ctx.sessions as { refresh?: () => Promise<void> }
        await sessions.refresh?.()
        // On the mobile branch the drawer hosts the list, so closing it is
        // the right follow-up after deleting the current session; on the
        // desktop layout (wide touch) the same call would collapse the
        // always-visible sidebar panel, so gate it on the mobile query.
        // toggleDrawer keeps that semantics (it falls back to the plain toggle
        // when the drawer is not open) while making the close a late commit,
        // so the marker cannot flip while the column is still painted — the
        // window in which the drawer band covers an open modal (2026-09-25).
        if (wasCurrent && window.matchMedia(MOBILE_QUERY).matches) toggleDrawer(ctx)
      })

      host.appendChild(backdrop)
      backdrop.appendChild(card)
      dialogHost = { backdrop, card }
    }

    /** Show a non-destructive error card (session could not be resolved). */
    const showError = (message: string): void => {
      closeDialog()
      const host = document.body
      const backdrop = document.createElement('div')
      backdrop.dataset.mobileNav = 'delete-dialog-backdrop'
      const card = document.createElement('div')
      card.dataset.mobileNav = 'delete-dialog'
      card.setAttribute('role', 'dialog')
      card.setAttribute('aria-modal', 'true')
      card.innerHTML = `
        <div data-mobile-nav="delete-confirm-title">${escapeHtml(navT('deleteSession'))}</div>
        <div data-mobile-nav="delete-error" role="alert">${escapeHtml(message)}</div>
        <div data-mobile-nav="delete-confirm-actions">
          <button type="button" data-mobile-nav="delete-confirm-no">${escapeHtml(navT('deleteConfirmNo'))}</button>
        </div>`
      card.querySelector<HTMLButtonElement>('[data-mobile-nav="delete-confirm-no"]')?.addEventListener('click', closeDialog)
      // Same child-of-backdrop target guard as showDeleteDialog: error-card
      // taps must not bubble into the backdrop's close.
      backdrop.addEventListener('click', (event) => {
        if (event.target !== backdrop) return
        closeDialog()
      })
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') closeDialog()
      }
      document.addEventListener('keydown', onKey, true)
      closeDialogOnKey = onKey
      host.appendChild(backdrop)
      backdrop.appendChild(card)
      dialogHost = { backdrop, card }
    }

    /** Inject the delete item into one open session menu (idempotent). */
    const injectInto = (menu: HTMLElement): void => {
      if (menu.querySelector(`[${DELETE_ITEM_MARKER}]`) !== null) return
      const template = menu.querySelector<HTMLElement>('[role="menuitem"]')
      const wrap = template?.parentElement
      const viewport = menu.querySelector<HTMLElement>('[class*="_viewport"]')
      if (template === null || wrap === null || wrap === undefined || viewport === null) return
      const clone = wrap.cloneNode(true) as HTMLElement
      const button = clone.querySelector<HTMLButtonElement>('[role="menuitem"]')
      if (button === null) return
      const icon = button.querySelector<HTMLElement>('[class*="_itemIcon"]')
      if (icon !== null) {
        icon.innerHTML = TRASH_SVG
        icon.style.color = DANGER_COLOR
      }
      const label = button.querySelector<HTMLElement>('[class*="_itemLabel"]')
      if (label !== null) {
        label.textContent = navT('deleteSession')
        label.style.color = DANGER_COLOR
      } else if (button.firstElementChild === null) {
        // 0.1.5 shape: the menuitem button carries its text directly (no
        // `_itemLabel` span, no icon element). Replace the whole text and let
        // the danger color ride the button itself. A button WITH element
        // children but no label span is an unknown future shape — leave its
        // text alone rather than guess.
        button.textContent = navT('deleteSession')
        button.style.color = DANGER_COLOR
      }
      button.setAttribute('data-mobile-nav', 'session-delete')
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const captured = anchor
        // Close the host menu by toggling its anchor (React-owned state).
        captured?.button.click()
        try {
          if (captured === null || captured === undefined) {
            showError(navT('deleteErrorResolve'))
            return
          }
          const sessionId = resolveSessionId(captured.row, captured.title)
          if (sessionId === undefined) {
            showError(navT('deleteErrorResolve'))
            return
          }
          showDeleteDialog(sessionId, captured.title)
        } catch (reason) {
          // Never fail silently: surface internal resolution errors instead of
          // leaving the tap with no visible result.
          console.error('[dsh-web-mobile] session delete failed:', reason)
          showError(navT('deleteErrorGeneric', {
            message: reason instanceof Error ? reason.message : String(reason),
          }))
        }
      })
      viewport.appendChild(clone)
    }

    /**
     * Inject into every open session menu. Blank (new-session) rows are
     * excluded: the host renders their title as the localized "New session"
     * label (`t("session.new")`) while the summary's `displayTitle` stays
     * empty, so the delete flow could never resolve them — the tap would
     * only end in a deleteErrorResolve card. A menu without the delete item
     * is the host's own look for those rows. Known ceiling: a normal session
     * manually titled exactly the host's "New session" label is mistaken for
     * a blank row and gets no delete item either (accepted trade-off; its
     * resolution itself would still work).
     */
    const injectAll = (): void => {
      const blankLabel = wsT('session.new')
      for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
        if (!isSessionMenu(menu)) continue
        if (anchor !== null && anchor.title === blankLabel) continue
        injectInto(menu)
      }
    }
    const scheduleInject = (): void => {
      if (injectRaf !== 0) return
      injectRaf = requestAnimationFrame(() => {
        injectRaf = 0
        injectAll()
      })
    }

    // Capture the ⋯ button click before React handles it, so the row/title
    // are known when the portaled menu appears. The host renders the anchor
    // button WITHOUT `aria-haspopup` (Menu renders `{anchor}` verbatim), so
    // the row's single button IS the ⋯ anchor — no attribute to match on.
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target === null) return
      const row = target.closest<HTMLElement>('[class*="_sessionRow"]')
      if (row === null) return
      const button = row.querySelector<HTMLButtonElement>('button')
      if (button === null) return
      const title = row.querySelector<HTMLElement>('[class*="_title"]')?.textContent?.trim() ?? ''
      anchor = { button, row, title }
      scheduleInject()
    }
    document.addEventListener('click', onDocumentClick, true)

    // Re-inject whenever a menu list mounts/updates (React recreates the list
    // on every open, so the injected node must follow).
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== 'childList') continue
        const target = record.target
        if (target === document.body) { scheduleInject(); break }
        if (target instanceof HTMLElement
          && (target.matches('[role="menu"]') || target.closest('[role="menu"]') !== null)) {
          scheduleInject()
          break
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    injectAll()
    return () => {
      document.removeEventListener('click', onDocumentClick, true)
      observer.disconnect()
      if (injectRaf !== 0) cancelAnimationFrame(injectRaf)
      closeDialog()
      anchor = null
    }
  }, TOUCH_QUERY)
}
