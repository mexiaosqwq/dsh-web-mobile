import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { landingScrollTop, pickStepRow } from '../core/chat-jump.ts'
import { NS } from '../i18n/locales.ts'
import { installMobileEffect } from '../platform/breakpoints.ts'
import { addReconcilerTask } from './reconciler-adapter.ts'

const SCROLLER = '[data-conversation-scroll]'
const CHAT_FLOW = '[data-chat-flow]'
const USER_ROW = '[data-chat-flow-kind="user"]:not([hidden]):not([hidden] *)'
const FLOW_ROW = '[data-chat-flow-key]'
// The similarly named toBottomSlot is a div with no click handler.
const TO_BOTTOM = 'button[class*="_toBottom"]'
const LANDING_INSET = 6 // Must fit inside the step tolerance, even after rounding.
const GESTURE_WINDOW_MS = 600
const HIDE_AFTER_MS = 1600
const REFRESH_MS = 120

const ICONS = {
  top: 'M3.5 7.5 8 3l4.5 4.5m-9 5L8 8l4.5 4.5',
  prev: 'M3.5 10.5 8 6l4.5 4.5',
  next: 'M3.5 5.5 8 10l4.5-4.5',
  bottom: 'M3.5 3.5 8 8l4.5-4.5m-9 5L8 13l4.5-4.5',
}
type Direction = keyof typeof ICONS

const rowsOf = (element: HTMLElement): HTMLElement[] => [...element.querySelectorAll<HTMLElement>(USER_ROW)]
const topOf = (element: HTMLElement): number => element.getBoundingClientRect().top
// layout.css.ts extends the scrollport under the opaque header and echoes the
// overlap in its padding. Read the effective padding, not a global estimate.
const bandTopOf = (element: HTMLElement): number => topOf(element) + (parseFloat(getComputedStyle(element).paddingTop) || 0)
const flowHead = (element: HTMLElement): string | undefined =>
  element.querySelector<HTMLElement>(FLOW_ROW)?.dataset.chatFlowKey
const sessionIdOf = (element: HTMLElement): string | undefined => element.parentElement?.dataset.conversationSession

/**
 * #299: keep the four keys outside the scrollport, use host rows as stops,
 * and delegate history and tail-following to the host. A plain tap or a
 * programmatic scroll with no recent wheel/touch movement keeps them hidden.
 */
export function installChatJump(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  installMobileEffect(ctx, 'dsh-web-mobile: chat jump', () => {
    let scroller: HTMLElement | null = null
    let flow: HTMLElement | null = null
    let owner: string | undefined
    let cluster: HTMLDivElement | null = null
    let buttons: HTMLButtonElement[] = []
    let paging: symbol | null = null
    let hideTimer = 0
    let lastGestureAt = -Infinity
    let lastRefreshAt = -Infinity
    let lastVisibleScroll = 0

    const ownsFlow = (element: HTMLElement): boolean => flow !== null && flow.isConnected &&
      element.contains(flow) && sessionIdOf(element) === owner

    const sessionOf = (element: HTMLElement) => {
      const id = sessionIdOf(element)
      return id ? ctx.sessions.binding(id)?.session : undefined
    }

    const offsetsOf = (element: HTMLElement, rows: HTMLElement[]): number[] => {
      const top = bandTopOf(element)
      return rows.map((row) => topOf(row) - top)
    }

    const syncButtons = (element: HTMLElement, rows: HTMLElement[]): void => {
      const offsets = offsetsOf(element, rows)
      const hasMore = sessionOf(element)?.getSnapshot().hasMore === true
      const busy = paging !== null
      const disabled = [
        busy || rows.length === 0,
        busy || rows.length === 0 || (!hasMore && pickStepRow(offsets, 'prev') < 0),
        busy || pickStepRow(offsets, 'next') < 0 || element.scrollHeight - element.clientHeight - element.scrollTop < 1,
        busy,
      ]
      buttons.forEach((button, index) => { button.disabled = disabled[index] === true })
    }

    const setShown = (shown: boolean): void => {
      if (cluster === null) return
      cluster.inert = !shown
      cluster.dataset.mobileNavShown = shown ? '1' : '0'
    }

    const refreshHide = (): void => {
      const wait = HIDE_AFTER_MS - (performance.now() - lastVisibleScroll)
      if (wait > 0) {
        hideTimer = window.setTimeout(refreshHide, wait)
      } else {
        hideTimer = 0
        setShown(false)
      }
    }

    const keepVisible = (): void => {
      lastVisibleScroll = performance.now()
      if (hideTimer === 0) hideTimer = window.setTimeout(refreshHide, HIDE_AFTER_MS)
    }

    const land = (element: HTMLElement, row: HTMLElement): void => {
      lastGestureAt = -Infinity
      element.scrollTop = landingScrollTop(element.scrollTop, topOf(row), bandTopOf(element), LANDING_INSET)
    }

    const jump = async (direction: Direction): Promise<void> => {
      const element = scroller
      if (element === null || paging !== null || !ownsFlow(element)) return
      keepVisible()
      if (direction === 'bottom') {
        lastGestureAt = -Infinity
        const button = element.querySelector<HTMLButtonElement>(TO_BOTTOM)
        if (button !== null) button.click()
        else element.scrollTop = element.scrollHeight
        syncButtons(element, rowsOf(element))
        return
      }

      const rows = rowsOf(element)
      if (rows.length === 0) return
      const first = rows[0]
      const target = direction === 'top' ? undefined : rows[pickStepRow(offsetsOf(element, rows), direction)]
      if (target !== undefined) {
        land(element, target)
        syncButtons(element, rows)
        return
      }
      if (direction === 'next' || first === undefined) return
      const session = sessionOf(element)
      if (!session?.getSnapshot().hasMore) {
        if (direction === 'top') land(element, first)
        syncButtons(element, rows)
        return
      }
      if (session.getSnapshot().loadingOlder) return
      const ticket = Symbol()
      paging = ticket
      syncButtons(element, rows)
      try {
        const anchorKey = first.dataset.chatFlowKey
        const stillHere = (): boolean => paging === ticket && ownsFlow(element) && sessionOf(element) === session
        let head = flowHead(element)
        let loaded = rows
        do {
          await session.loadOlder()
          if (!stillHere()) return
          // Service completion does not imply the React rows have committed.
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          if (!stillHere()) return
          const nextHead = flowHead(element)
          if (nextHead === head && session.getSnapshot().hasMore) return
          head = nextHead
          loaded = rowsOf(element)
          if (direction === 'prev') {
            const anchorIndex = loaded.findIndex((row) => row.dataset.chatFlowKey === anchorKey)
            const previous = loaded[anchorIndex - 1]
            if (previous !== undefined) {
              land(element, previous)
              return
            }
          }
        } while (session.getSnapshot().hasMore)
        if (direction === 'top' && loaded[0] !== undefined) land(element, loaded[0])
      } catch (error) {
        console.warn('[dsh-web-mobile] chat jump history load failed', error)
      } finally {
        if (paging === ticket) {
          paging = null
          if (ownsFlow(element)) {
            syncButtons(element, rowsOf(element))
            keepVisible()
          }
        }
      }
    }

    const onGesture = (): void => { lastGestureAt = performance.now() }
    const onScroll = (): void => {
      const element = scroller
      const now = performance.now()
      if (element === null || now - lastGestureAt >= GESTURE_WINDOW_MS || !ownsFlow(element)) return
      if (cluster?.inert || now - lastRefreshAt >= REFRESH_MS) {
        const rows = rowsOf(element)
        if (rows.length === 0) return
        lastRefreshAt = now
        syncButtons(element, rows)
        setShown(true)
      }
      keepVisible()
    }

    const detach = (): void => {
      window.clearTimeout(hideTimer)
      hideTimer = 0
      lastGestureAt = lastRefreshAt = -Infinity
      paging = null
      scroller?.removeEventListener('scroll', onScroll)
      scroller?.removeEventListener('touchmove', onGesture)
      scroller?.removeEventListener('wheel', onGesture)
      cluster?.remove()
      scroller = cluster = flow = null
      owner = undefined
      buttons = []
    }

    const mount = (): void => {
      const element = document.querySelector<HTMLElement>(SCROLLER)
      const host = element?.parentElement
      const id = host?.dataset.conversationSession
      const nextFlow = element?.querySelector<HTMLElement>(CHAT_FLOW) ?? null
      if (element === scroller && nextFlow === flow && id === owner && cluster?.parentElement === host) return
      detach()
      if (element === null || host == null || nextFlow === null || !id) return
      scroller = element
      flow = nextFlow
      owner = id
      cluster = document.createElement('div')
      cluster.dataset.mobileNav = 'chat-jump'
      cluster.setAttribute('role', 'group')
      cluster.setAttribute('aria-label', t('chatJumpLabel'))
      setShown(false)
      const labels = { top: t('chatJumpTop'), prev: t('chatJumpPrev'), next: t('chatJumpNext'), bottom: t('chatJumpBottom') }
      for (const direction of Object.keys(ICONS) as Direction[]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.mobileNav = `chat-jump-${direction}`
        button.setAttribute('aria-label', labels[direction])
        button.innerHTML = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${ICONS[direction]}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        button.addEventListener('click', () => {
          if (cluster !== null && button.parentElement === cluster && !cluster.inert) void jump(direction)
        })
        cluster.appendChild(button)
        buttons.push(button)
      }
      host.appendChild(cluster)
      element.addEventListener('scroll', onScroll, { passive: true })
      element.addEventListener('touchmove', onGesture, { passive: true })
      element.addEventListener('wheel', onGesture, { passive: true })
    }

    return addReconcilerTask({ name: 'chat-jump', scopes: ['*'], ensure: mount, dispose: detach })
  })
}
