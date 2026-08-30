export interface RafScheduler {
  schedule: (fn: () => void) => void
  cancel: () => void
}

export function createRafScheduler(
  raf: (cb: FrameRequestCallback) => number,
  caf: (id: number) => void,
): RafScheduler {
  let pending = 0
  let queued = false
  return {
    schedule(fn: () => void): void {
      if (queued) return
      queued = true
      pending = raf(() => {
        queued = false
        fn()
      })
    },
    cancel(): void {
      if (!queued) return
      caf(pending)
      queued = false
    },
  }
}