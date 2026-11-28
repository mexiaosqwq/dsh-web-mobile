import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { landingScrollTop, pickStepRow } from '../core/chat-jump.ts'
import { NS } from '../i18n/locales.ts'
import { installMobileEffect } from '../platform/breakpoints.ts'
import { VISIBLE_BAND_EVENT } from '../platform/visible-band.ts'
import { firstPromptCommitted, loadChatJumpPage, USER_ROW } from './chat-jump-history.ts'
import { addReconcilerTask } from './reconciler-adapter.ts'

const SCROLLER = '[data-conversation-scroll]'
const HEADER = '[data-mobile-nav="frame"] [data-phase] header'
const SEAT = '[data-composer-seat]'
const CHAT_FLOW = '[data-chat-flow]'
const REPLY = '[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"], [hidden], [hidden] *)'
// The similarly named toBottomSlot is a div with no click handler.
const TO_BOTTOM = 'button[class*="_toBottom"]'
const LANDING_INSET = 6 // Must fit inside the step tolerance, even after rounding.
const GESTURE_START_MS = 250
const HIDE_AFTER_MS = 1600
const REFRESH_MS = 120
const PAGE_WAIT_MS = 2500
const HISTORY_WAIT_MS = 15000

const ICONS = {
  top: 'M3.5 7.5 8 3l4.5 4.5M3.5 13 8 8.5l4.5 4.5',
  prev: 'M3.5 10.25 8 5.75l4.5 4.5',
  next: 'M3.5 5.75 8 10.25l4.5-4.5',
  bottom: 'M3.5 3 8 7.5l4.5-4.5M3.5 8.5 8 13l4.5-4.5',
}
type Direction = keyof typeof ICONS

const rowsOf = (element: HTMLElement): HTMLElement[] => [...element.querySelectorAll<HTMLElement>(USER_ROW)]
const topOf = (element: HTMLElement): number => element.getBoundingClientRect().top
// layout.css.ts extends the scrollport under the opaque header and echoes the
// overlap in its padding. Read the effective padding, not a global estimate.
const bandTopOf = (element: HTMLElement): number => topOf(element) + (parseFloat(getComputedStyle(element).paddingTop) || 0)
const maxScroll = (element: HTMLElement): number => Math.max(0, element.scrollHeight - element.clientHeight)
const atTail = (element: HTMLElement): boolean => maxScroll(element) - element.scrollTop < 1
const sessionIdOf = (element: HTMLElement): string | undefined => element.closest<HTMLElement>('[data-conversation-content]')?.dataset.conversationSession

/**
 * #299: keep the four keys outside the scrollport, use host rows as stops,
 * and delegate history and tail-following to the host. A plain tap or a
 * programmatic scroll with no recent wheel/touch movement keeps them hidden.
 */
export function installChatJump(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  type Session = NonNullable<ReturnType<ClientContext['sessions']['binding']>>['session']
  const requests = new WeakSet<Session>()
  const unconfirmedFirst = new WeakMap<Session, string | undefined>()
  installMobileEffect(ctx, 'dsh-web-mobile: chat jump', (mobile) => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let scroller: HTMLElement | null = null
    let flow: HTMLElement | null = null
    let owner: string | undefined
    let cluster: HTMLDivElement | null = null
    let buttons: HTMLButtonElement[] = []
    let paging: AbortController | null = null
    let view = new AbortController()
    let selection: { key: string | undefined; top: number } | null = null
    let cue: Animation | null = null
    let tailFrame = 0
    let tailPending = 0
    let hideTimer = 0
    let gestureAt = -Infinity
    let manualScroll = false
    let touchStart: Touch | undefined
    let lastRefreshAt = -Infinity
    let lastVisibleScroll = 0

    const ownsFlow = (element: HTMLElement): boolean => element === scroller && flow !== null && flow.isConnected &&
      element.contains(flow) && !flow.closest('[hidden]') && sessionIdOf(element) === owner

    const bindingOf = (element: HTMLElement) => {
      const id = sessionIdOf(element)
      return id ? ctx.sessions.binding(id) : undefined
    }

    const stepRows = (element: HTMLElement, rows: HTMLElement[]) => {
      const key = selection?.key
      const index = key ? rows.findIndex((row) => row.dataset.chatFlowKey === key) : -1
      if (index >= 0) return { prev: rows[index - 1], next: rows[index + 1] }
      const top = bandTopOf(element)
      const offsets = rows.map((row) => topOf(row) - top)
      return { prev: rows[pickStepRow(offsets, 'prev')], next: rows[pickStepRow(offsets, 'next')] }
    }

    const syncButtons = (element: HTMLElement, rows: HTMLElement[]): void => {
      const { prev, next } = stepRows(element, rows)
      const hasMore = bindingOf(element)?.session.getSnapshot().hasMore === true
      const busy = paging !== null
      const disabled = [
        busy || rows.length === 0,
        busy || rows.length === 0 || (!hasMore && !prev),
        busy || !next || (selection === null && atTail(element)),
        busy,
      ]
      buttons.forEach((button, index) => { button.disabled = disabled[index] === true })
    }

    const setShown = (shown: boolean): void => {
      if (cluster === null || cluster.inert === !shown) return
      cluster.inert = !shown
      cluster.dataset.mobileNavShown = shown ? '1' : '0'
    }

    let bandHeight = 0
    const measure = (): void => {
      const element = scroller
      const host = cluster?.parentElement
      if (!element || !cluster || !host || !flow) return
      const viewportTop = viewport?.offsetTop ?? 0
      const top = Math.max(viewportTop, header?.getBoundingClientRect().bottom ?? bandTopOf(element))
      const bottom = Math.min(viewportTop + (viewport?.height ?? window.innerHeight),
        element.getBoundingClientRect().bottom, seat?.getBoundingClientRect().top ?? top)
      bandHeight = Math.max(0, bottom - top)
      const clearance = cluster.offsetHeight / 2 + 6
      const fits = ownsFlow(element) && bandHeight >= clearance * 2 && Boolean(flow.querySelector(USER_ROW)) && maxScroll(element) > 1
      cluster.toggleAttribute('data-mobile-nav-available', fits)
      if (!fits) {
        setShown(false)
        return
      }
      const center = Math.min(bottom - clearance, Math.max(top + clearance, top + (bottom - top) * .7))
      const next = `${center - host.getBoundingClientRect().top - host.clientTop}px`
      if (cluster.style.top !== next) cluster.style.top = next
    }
    const viewport = window.visualViewport
    const resize = new ResizeObserver(measure)
    let seat: HTMLElement | null = null
    let header: HTMLElement | null = null

    const refreshHide = (): void => {
      hideTimer = 0
      if (paging !== null) return
      const wait = HIDE_AFTER_MS - (performance.now() - lastVisibleScroll)
      if (wait > 0) hideTimer = window.setTimeout(refreshHide, wait)
      else {
        manualScroll = false
        setShown(false)
      }
    }

    const keepVisible = (): void => {
      lastVisibleScroll = performance.now()
      if (hideTimer === 0) hideTimer = window.setTimeout(refreshHide, HIDE_AFTER_MS)
    }

    const stopMotion = (): void => {
      const element = scroller
      if (selection && element && ownsFlow(element)) element.scrollTo({ top: element.scrollTop, behavior: 'instant' })
      selection = null
      cue?.cancel()
      cue = null
      if (tailFrame) cancelAnimationFrame(tailFrame)
      tailPending = tailFrame = 0
    }

    const cueRow = (row: HTMLElement): void => {
      cue?.cancel()
      if (!reducedMotion.matches) cue = row.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 230, easing: 'ease-out' })
    }

    const cueTail = (): void => {
      const element = scroller
      if (!element || !flow || !ownsFlow(element) || performance.now() >= tailPending || !atTail(element)) return
      tailPending = 0
      const row = [...flow.querySelectorAll<HTMLElement>(REPLY)].reverse().find((reply) => reply.offsetHeight > 0)
      if (!row) return
      const { top, bottom } = row.getBoundingClientRect()
      const bandTop = bandTopOf(element)
      if (top < bandTop + bandHeight && bottom > bandTop) cueRow(row)
    }

    const land = (element: HTMLElement, row: HTMLElement, paged = false): void => {
      const current = element.scrollTop
      const top = Math.min(maxScroll(element), landingScrollTop(current, topOf(row), bandTopOf(element), LANDING_INSET))
      const distance = Math.abs(top - current)
      if (distance <= 1) {
        stopMotion()
        if (paged) cueRow(row)
        return
      }
      gestureAt = -Infinity
      manualScroll = false
      const smooth = !paged && distance <= bandHeight && !reducedMotion.matches
      cue?.cancel()
      selection = smooth ? { key: row.dataset.chatFlowKey, top } : null
      element.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' })
      if (!smooth && (paged || distance > bandHeight)) cueRow(row)
    }

    const jump = async (direction: Direction): Promise<void> => {
      const element = scroller
      const chat = flow
      if (!element || !chat || paging !== null || !ownsFlow(element)) return
      keepVisible()
      if (direction === 'bottom') {
        const button = element.querySelector<HTMLButtonElement>(TO_BOTTOM)
        if (!button) return
        gestureAt = -Infinity
        manualScroll = false
        selection = null
        cue?.cancel()
        button.click()
        tailPending = performance.now() + HIDE_AFTER_MS
        if (tailFrame) cancelAnimationFrame(tailFrame)
        tailFrame = requestAnimationFrame(() => { tailFrame = 0; cueTail() })
        return
      }
      tailPending = 0
      const rows = rowsOf(chat)
      const first = rows[0]
      if (!first) return
      const binding = bindingOf(element)
      const session = binding?.session, anchorKey = first.dataset.chatFlowKey
      const atStart = direction === 'top' && binding && session?.getSnapshot().hasMore === false && !requests.has(session) &&
        (firstPromptCommitted(binding, first) ?? anchorKey !== unconfirmedFirst.get(session))
      const target = direction === 'top' ? (atStart ? first : undefined) : stepRows(element, rows)[direction]
      if (target) {
        land(element, target)
        syncButtons(element, rows)
        return
      }
      if (direction === 'next' || !binding || !session?.getSnapshot().hasMore || session.getSnapshot().loadingOlder || requests.has(session)) return
      stopMotion()
      const ticket = new AbortController(), { signal } = ticket
      const stillHere = (): boolean => mobile.matches && !signal.aborted && paging === ticket && flow === chat &&
        ownsFlow(element) && bindingOf(element)?.session === session
      paging = ticket
      syncButtons(element, rows)
      const deadline = performance.now() + HISTORY_WAIT_MS
      try {
        while (stillHere()) {
          const left = Math.min(direction === 'top' ? HISTORY_WAIT_MS : PAGE_WAIT_MS, deadline - performance.now())
          unconfirmedFirst.set(session, chat.querySelector<HTMLElement>(USER_ROW)?.dataset.chatFlowKey)
          if (!await loadChatJumpPage(binding, chat, signal, left, requests, direction === 'top') || !stillHere()) return
          unconfirmedFirst.delete(session)
          const loaded = rowsOf(chat)
          const previous = direction === 'prev' ? loaded[loaded.findIndex((row) => row.dataset.chatFlowKey === anchorKey) - 1] : undefined
          const hasMore = session.getSnapshot().hasMore
          const destination = previous ?? (direction === 'top' && !hasMore ? loaded[0] : undefined)
          if (destination) {
            land(element, destination, true)
            return
          }
          if (!hasMore) return
        }
      } finally {
        if (paging === ticket) {
          paging = null
          if (ownsFlow(element)) {
            syncButtons(element, rowsOf(chat))
            keepVisible()
          }
        }
      }
    }
    const onGesture = (): void => {
      const element = scroller
      if (!element || !flow || !ownsFlow(element)) return
      gestureAt = performance.now()
      stopMotion()
      if (paging !== null) {
        paging.abort() // Keep the transport locked until it settles.
        paging = null
        syncButtons(element, rowsOf(flow))
        keepVisible()
      }
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.isTrusted && event.deltaY && !event.ctrlKey) onGesture()
    }
    const onTouchStart = (event: TouchEvent): void => {
      touchStart = event.isTrusted && event.touches.length === 1 ? event.touches[0] : undefined
    }
    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (touchStart && touch && event.isTrusted && Math.abs(touch.clientY - touchStart.clientY) > Math.abs(touch.clientX - touchStart.clientX)) onGesture()
    }
    const onScrollEnd = (): void => {
      manualScroll = false
      gestureAt = -Infinity
      cueTail()
    }
    const onScroll = (): void => {
      const element = scroller
      if (!element || !flow || !ownsFlow(element)) return
      const now = performance.now()
      if (selection && Math.abs(element.scrollTop - selection.top) <= 1) {
        selection = null
        syncButtons(element, rowsOf(flow))
      }
      if ((!manualScroll && now - gestureAt >= GESTURE_START_MS) || !cluster?.hasAttribute('data-mobile-nav-available')) return
      manualScroll = true
      if (cluster.inert || now - lastRefreshAt >= REFRESH_MS) {
        const rows = rowsOf(flow)
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
      gestureAt = lastRefreshAt = -Infinity
      manualScroll = false
      touchStart = undefined
      paging?.abort()
      paging = null
      view.abort()
      stopMotion()
      resize.disconnect()
      seat = header = null
      cluster?.remove()
      scroller = cluster = flow = null
      owner = undefined
      buttons = []
    }

    const observeLayout = (element: HTMLElement, chat: HTMLElement): void => {
      resize.disconnect()
      resize.observe(element)
      resize.observe(chat)
      if (seat) resize.observe(seat)
      if (header) resize.observe(header)
      measure()
    }

    const mount = (): void => {
      const element = document.querySelector<HTMLElement>(SCROLLER)
      const host = element?.closest<HTMLElement>('[data-conversation-content]') ?? null
      const id = host?.dataset.conversationSession
      const nextFlow = element?.querySelector<HTMLElement>(CHAT_FLOW) ?? null
      const nextSeat = element?.querySelector<HTMLElement>(SEAT) ?? null
      const nextHeader = document.querySelector<HTMLElement>(HEADER)
      if (element && nextFlow && element === scroller && nextFlow === flow && id === owner && cluster?.parentElement === host) {
        if (seat !== nextSeat || header !== nextHeader) {
          seat = nextSeat
          header = nextHeader
          observeLayout(element, nextFlow)
        }
        return
      }
      detach()
      if (!element || !host || !nextFlow || !id) return
      view = new AbortController()
      scroller = element
      flow = nextFlow
      seat = nextSeat
      header = nextHeader
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
      observeLayout(element, nextFlow)
      const listening = { passive: true, signal: view.signal }
      element.addEventListener('scroll', onScroll, listening)
      element.addEventListener('scrollend', onScrollEnd, listening)
      element.addEventListener('touchstart', onTouchStart, listening)
      element.addEventListener('touchmove', onTouchMove, listening)
      element.addEventListener('wheel', onWheel, listening)
    }

    const removeTask = addReconcilerTask({ name: 'chat-jump', scopes: ['*'], ensure: mount, dispose: detach })
    window.addEventListener('resize', measure)
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    const onMotionChange = (): void => { if (reducedMotion.matches) stopMotion() }
    reducedMotion.addEventListener('change', onMotionChange)
    document.addEventListener(VISIBLE_BAND_EVENT, measure)
    return () => {
      removeTask()
      reducedMotion.removeEventListener('change', onMotionChange)
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
      document.removeEventListener(VISIBLE_BAND_EVENT, measure)
    }
  })
}
