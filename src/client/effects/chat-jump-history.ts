/**
 * #299 history lane: a resolved `loadOlder()` is not a committed transcript.
 * The host resolves the request before React prepends, so landing on the old
 * head in the same turn scrolls to a row that is about to be pushed down.
 * Both helpers therefore watch the flow for a prepend (or proof that the true
 * first prompt is already mounted) before the caller moves the viewport.
 */
const FLOW_ROW = '[data-chat-flow-key]'
export const USER_ROW = '[data-chat-flow-kind="user"]:not([hidden]):not([hidden] *)'

// The installed controller exposes this window; older client typings predate it.
interface ChatJumpHistory<T> {
  session: T
  eventSource?: { getSnapshot(): { hasMore: boolean; entries: readonly {
    type: string
    event: { type: string; surfaceOp?: unknown; data?: { id?: unknown; source?: { kind?: string } } }
  }[] } }
}

/** Whether the exhausted event window's first prompt is mounted; undefined without an exact target. */
export function firstPromptCommitted(binding: ChatJumpHistory<object>, row: HTMLElement | null | undefined): boolean | undefined {
  const window = binding.eventSource?.getSnapshot()
  if (window?.hasMore !== false) return undefined
  const first = window.entries.find(({ type, event }) => type === 'event' && event.type === 'user/message' &&
    event.surfaceOp === 'append' && event.data?.source?.kind === 'user')
  const id = first?.event.data?.id
  // Host chat uses conversationContextKey('input-message', id) for data-chat-node-key.
  return typeof id === 'string' ? row?.dataset.chatNodeKey === `13:input-message${id}` : undefined
}

/**
 * A successful history request is not a transcript commit. Wait for a prepend
 * or proof that the first prompt is already mounted. Keep the transport lock
 * when the view leaves or times out.
 */
export async function loadChatJumpPage<T extends object & { loadOlder(): Promise<void> }>(
  binding: ChatJumpHistory<T>, flow: HTMLElement, signal: AbortSignal, timeout: number, inFlight: WeakSet<T>, toStart: boolean,
): Promise<boolean> {
  const { session } = binding
  const head = (selector: string): string | undefined => flow.querySelector<HTMLElement>(selector)?.dataset.chatFlowKey
  const before = head(FLOW_ROW)
  if (signal.aborted || !before || timeout <= 0 || inFlight.has(session)) return false
  const beforeUser = head(USER_ROW)
  const prepended = (selector: string, previous: string): boolean => {
    const key = head(selector)
    return Boolean(key && key !== previous && flow.querySelector(`${selector}[data-chat-flow-key="${CSS.escape(previous)}"]`))
  }
  inFlight.add(session)
  let settled = false
  const loading = Promise.resolve().then(() => session.loadOlder())
  try {
    return await new Promise<boolean>((resolve) => {
      let loaded = false
      const finish = (progress: boolean): void => {
        observer.disconnect()
        window.clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve(progress)
      }
      const abort = (): void => finish(false)
      const check = (): void => {
        if (!loaded) return
        const confirmed = toStart ? firstPromptCommitted(binding, flow.querySelector<HTMLElement>(USER_ROW)) : undefined
        if (confirmed ?? (prepended(FLOW_ROW, before) || Boolean(beforeUser && prepended(USER_ROW, beforeUser)))) finish(true)
      }
      const observer = new MutationObserver(check)
      observer.observe(flow, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-flow-key', 'data-chat-node-key', 'hidden'] })
      const timer = window.setTimeout(abort, timeout)
      signal.addEventListener('abort', abort, { once: true })
      void loading.then(() => {
        settled = loaded = true
        check()
      }, (error: unknown) => {
        settled = true
        if (!signal.aborted) console.warn('[dsh-web-mobile] chat jump history load failed', error)
        finish(false)
      })
    })
  } finally {
    const unlock = (): void => { inFlight.delete(session) }
    if (settled) unlock()
    else void loading.then(unlock, unlock)
  }
}
