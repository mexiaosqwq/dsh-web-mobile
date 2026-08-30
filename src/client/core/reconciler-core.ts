// reconciler-core.ts — DOM-free reconciler engine shared by every mobile DOM
// reconciler task. Deliberately has ZERO import statements:
//  - the custom client bundler cannot resolve `../` requires from
//    src/client/effects, and a file without imports has nothing to resolve;
//  - node:test imports it directly (Node's native type stripping) without a
//    DOM or DSH runtime, so registration / dirty routing / coalescing /
//    error-isolation can be covered by plain unit tests.
//
// The browser half (phone-chrome.ts) is a thin adapter: it owns the
// MutationObserver and requestAnimationFrame scheduler, feeds mutation keys
// into `note()`, and delegates task lifecycle to `register()` /
// `activate()` / `deactivate()`. `scopes` are opaque dirty keys — the core
// never interprets them (an attribute name like 'data-sidebar-collapsed' or
// the tree sentinel '*').

/** One unit of DOM reconciliation driven by the shared full-tree observer. */
export interface ReconcilerTask {
  readonly name: string
  /**
   * Dirty keys that must be present for this task to re-run on a flush.
   * Undefined = unscoped: run on every non-empty flush (legacy behavior).
   */
  readonly scopes?: readonly string[]
  /** Called once on activation and after every matching DOM mutation. */
  ensure(): void
  /** Called on deactivation, disposal, or explicit removal. */
  dispose(): void
}

/**
 * Schedule `flush` on the next frame and return a cancel for a still-pending
 * frame. Injected so the core stays DOM-free: browsers pass an
 * requestAnimationFrame adapter, tests pass a manual queue.
 */
export type FrameRequest = (flush: () => void) => () => void

/** Error sink for task failures. Defaults to a console.error shim. */
export type ReconcilerErrorHandler = (
  taskName: string,
  error: unknown,
  phase: 'ensure' | 'dispose',
) => void

export interface ReconcilerCoreOptions {
  readonly requestFrame: FrameRequest
  readonly onError?: ReconcilerErrorHandler
}

export interface ReconcilerCore {
  /** Number of tasks in the registry (registered but not necessarily active). */
  readonly size: number
  /** Register a task; the returned disposer removes and disposes it. */
  register(task: ReconcilerTask): () => void
  /** Snapshot the registry as the active task set and run every task once. */
  activate(): void
  /** Dispose every active task, cancel any pending frame, clear dirty keys. */
  deactivate(): void
  /** Mark scope keys dirty and schedule one coalesced flush. */
  note(keys: Iterable<string>): void
  /** Run dirty tasks now (activation runs everything; empty dirty runs none). */
  flush(): void
}

export function createReconcilerCore(options: ReconcilerCoreOptions): ReconcilerCore {
  const onError: ReconcilerErrorHandler =
    options.onError ??
    ((taskName, error, phase) => {
      console.error(
        `[dsh-web-mobile] reconciler task ${taskName}${phase === 'dispose' ? ' dispose' : ''} failed`,
        error,
      )
    })
  const registered = new Set<ReconcilerTask>()
  let active: Set<ReconcilerTask> | null = null
  let dirty = new Set<string>()
  let forceAll = false
  let pending: (() => void) | null = null

  const runEnsure = (task: ReconcilerTask): void => {
    try {
      task.ensure()
    } catch (error) {
      onError(task.name, error, 'ensure')
    }
  }
  const runDispose = (task: ReconcilerTask): void => {
    try {
      task.dispose()
    } catch (error) {
      onError(task.name, error, 'dispose')
    }
  }

  const flush = (): void => {
    if (pending !== null) {
      pending()
      pending = null
    }
    if (active === null) {
      dirty.clear()
      forceAll = false
      return
    }
    if (forceAll) {
      for (const task of active) runEnsure(task)
    } else if (dirty.size > 0) {
      for (const task of active) {
        const scopes = task.scopes
        if (scopes === undefined || scopes.some((key) => dirty.has(key))) runEnsure(task)
      }
    }
    dirty.clear()
    forceAll = false
  }

  const schedule = (): void => {
    if (pending !== null) return
    pending = options.requestFrame(() => {
      pending = null
      flush()
    })
  }

  const register = (task: ReconcilerTask): (() => void) => {
    registered.add(task)
    if (active !== null) {
      active.add(task)
      runEnsure(task)
    }
    return () => {
      registered.delete(task)
      if (active !== null) {
        active.delete(task)
        runDispose(task)
      }
    }
  }

  const activate = (): void => {
    if (active !== null) return
    active = new Set(registered)
    forceAll = true
    flush()
  }

  const deactivate = (): void => {
    if (pending !== null) {
      pending()
      pending = null
    }
    dirty.clear()
    forceAll = false
    if (active !== null) {
      const snapshot = active
      active = null
      for (const task of snapshot) runDispose(task)
    }
  }

  return {
    get size(): number {
      return registered.size
    },
    register,
    activate,
    deactivate,
    note: (keys: Iterable<string>) => {
      for (const key of keys) dirty.add(key)
      schedule()
    },
    flush,
  }
}
